#!/usr/bin/env python3
"""scripts/load_test.py - đo tải một mức (B2): thông lượng, độ trễ, CPU/RAM, biểu đồ.

Gửi lượt quét thẳng vào Kafka với tốc độ cố định (mặc định 25 lượt/giây trong 120 giây), giờ nhận
lấy đúng lúc gửi. Trong lúc gửi, cứ 2 giây ghi CPU và RAM của Spark (tiến trình Python + JVM),
các container SQL Server, Kafka, API và RAM của cả máy ảo WSL. Gửi xong thì đợi Spark ghi đủ rồi
đọc độ trễ từng lượt (ingestion_lag_ms = processing_ts - received_at) từ scan_event.

Kết quả:
    docs/performance.md                 bảng số, cấu hình máy, cách chạy lại
    docs/images/performance_latency.svg biểu đồ độ trễ và thông lượng theo thời gian
    docs/performance_data/scans.csv     số liệu thô từng lượt quét
    docs/performance_data/resources.csv số liệu thô CPU/RAM

Cần (trong WSL, ở gốc repo):
    ./scripts/up.sh full            (hoặc stream) - Spark phải đang chạy liên tục, không phải --once
    ./scripts/dev_event_window.sh now
    python3 scripts/load_test.py                        # 25 lượt/giây x 120 giây = 3000 lượt
    python3 scripts/load_test.py --rate 40 --duration 180

Trong lúc đo đừng quét thêm: script lọc lượt quét của mình theo khoảng giờ nhận.
Chỉ dùng thư viện chuẩn của Python.
"""
import argparse
import json
import math
import os
import platform
import random
import re
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import send_scans  # noqa: E402  (dùng lại cách tạo bản tin và ký QR)

VN = timezone(timedelta(hours=7))
ENV_FILE = ROOT / "docker" / ".env"
COMPOSE = ["docker", "compose", "-f", str(ROOT / "docker" / "docker-compose.yml"), "--env-file", str(ENV_FILE)]
SQLCMD = "/opt/mssql-tools18/bin/sqlcmd"
EPOCH = "CAST('1970-01-01T00:00:00' AS DATETIME2(3))"


def env_get(key, default=""):
    if not ENV_FILE.is_file():
        return default
    value = default
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.startswith(key + "="):
            value = line.split("=", 1)[1].strip().strip('"').strip("'") or default
    return value


def sql_rows(query):
    """Chạy câu SQL trong container sqlserver bằng tài khoản sa, trả list các dòng (cột ngăn bởi ',')."""
    cmd = COMPOSE + ["exec", "-T", "-e", f"SQLCMDPASSWORD={env_get('DB_PASSWORD')}", "sqlserver", SQLCMD,
                     "-S", "localhost", "-U", env_get("DB_USER", "sa"), "-d", env_get("DB_NAME", "ticket_system"),
                     "-C", "-b", "-I", "-h", "-1", "-W", "-s", ",", "-Q", "SET NOCOUNT ON; " + query]
    out = subprocess.run(cmd, check=True, capture_output=True, text=True, encoding="utf-8",
                         env={**os.environ, "COMPOSE_PROFILES": "full"}).stdout
    return [ln.strip() for ln in out.splitlines() if ln.strip()]


def vn_wall(dt):
    return dt.astimezone(VN).strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}"


def die(msg):
    sys.exit(f"LỖI: {msg}")


# ---------------------------------------------------------------- đo CPU/RAM
def pids_of(pattern):
    r = subprocess.run(["pgrep", "-f", pattern], capture_output=True, text=True)
    return [int(p) for p in r.stdout.split()]


def proc_times(pid):
    """(utime + stime) theo tick và RSS (MB) của một tiến trình, đọc từ /proc."""
    try:
        fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
        ticks = int(fields[11]) + int(fields[12])
        rss_kb = 0
        for line in Path(f"/proc/{pid}/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                rss_kb = int(line.split()[1])
        return ticks, rss_kb / 1024
    except (OSError, IndexError, ValueError):
        return None


def vm_used_mb():
    info = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        k, v = line.split(":", 1)
        info[k] = int(v.split()[0])
    return (info["MemTotal"] - info["MemAvailable"]) / 1024, info["MemTotal"] / 1024


def parse_mem(text):
    """'1.234GiB / 4.8GiB' -> MB của phần đầu."""
    m = re.match(r"\s*([\d.]+)\s*([KMG]i?B)", text)
    if not m:
        return 0.0
    n, unit = float(m.group(1)), m.group(2)
    return n * {"KiB": 1 / 1024, "KB": 1 / 1000, "MiB": 1, "MB": 1, "GiB": 1024, "GB": 1000}.get(unit, 1)


class Sampler(threading.Thread):
    """Cứ ~2 giây ghi một mẫu: CPU% (so với 1 lõi) và RAM (MB) của từng thành phần."""

    def __init__(self, t0):
        super().__init__(daemon=True)
        self.t0, self.samples, self.stop = t0, [], threading.Event()
        self.tick = os.sysconf("SC_CLK_TCK")

    def spark_pids(self):
        return {"spark_python": pids_of("stream_scan_events.py"),
                "spark_jvm": pids_of("SparkSubmit.*pyspark-shell")}

    def run(self):
        prev, prev_t = {}, time.monotonic()
        while not self.stop.is_set():
            now = time.monotonic()
            row = {"t": round(time.time() - self.t0, 1)}
            for name, pids in self.spark_pids().items():
                ticks = rss = 0
                for pid in pids:
                    r = proc_times(pid)
                    if r:
                        ticks += r[0]
                        rss += r[1]
                if name in prev and now > prev_t:
                    row[f"{name}_cpu"] = round((ticks - prev[name]) / self.tick / (now - prev_t) * 100, 1)
                row[f"{name}_mb"] = round(rss, 1)
                prev[name] = ticks
            prev_t = now
            try:
                out = subprocess.run(["docker", "stats", "--no-stream", "--format",
                                      "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}"],
                                     capture_output=True, text=True, timeout=20).stdout
                for line in out.splitlines():
                    name, cpu, mem = (line.split("|") + ["", "", ""])[:3]
                    key = next((k for k in ("sqlserver", "kafka", "api") if k in name), None)
                    if key:
                        row[f"{key}_cpu"] = float(cpu.strip().rstrip("%") or 0)
                        row[f"{key}_mb"] = round(parse_mem(mem), 1)
            except (subprocess.SubprocessError, ValueError):
                pass
            used, _ = vm_used_mb()
            row["wsl_vm_mb"] = round(used, 1)
            self.samples.append(row)
            self.stop.wait(max(0.0, 2.0 - (time.monotonic() - now)))


# ---------------------------------------------------------------- thống kê và biểu đồ
def pct(values, p):
    """Bách phân vị kiểu nearest-rank."""
    if not values:
        return 0
    s = sorted(values)
    k = max(0, min(len(s) - 1, math.ceil(p / 100 * len(s)) - 1))
    return s[k]


def svg_chart(per_sec, p95, path):
    """Hai khung chung trục thời gian: độ trễ (TB, lớn nhất, P95) và số lượt gửi / Spark ghi mỗi giây."""
    W, H, L, R = 900, 580, 70, 20
    top1, h1, top2, h2 = 72, 200, 362, 170  # chú thích nằm trên mỗi khung, không đè lên đường vẽ
    xs = sorted(per_sec)
    if not xs:
        return
    xmax = max(xs) + 1
    lat_max = max(max((v["lag_max"] or 0) for v in per_sec.values()), p95, 1) * 1.1
    cnt_max = max(max(max(v["sent"], v["done"]) for v in per_sec.values()), 1) * 1.15

    def x(sec):
        return L + (W - L - R) * sec / xmax

    def y1(v):
        return top1 + h1 - h1 * v / lat_max

    def y2(v):
        return top2 + h2 - h2 * v / cnt_max

    def poly(key, yf):
        return " ".join(f"{x(s):.1f},{yf(per_sec[s][key]):.1f}" for s in xs if per_sec[s].get(key) is not None)

    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
             'font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="12">',
             f'<rect width="{W}" height="{H}" fill="#ffffff"/>',
             f'<text x="{L}" y="24" font-size="15" font-weight="600" fill="#1c2421">Độ trễ xử lý '
             'ingestion_lag_ms theo thời gian (giây kể từ lúc bắt đầu gửi)</text>']
    for i in range(6):  # lưới và nhãn trục
        v1, v2 = lat_max * i / 5, cnt_max * i / 5
        parts += [f'<line x1="{L}" x2="{W - R}" y1="{y1(v1):.1f}" y2="{y1(v1):.1f}" stroke="#e3e8e5"/>',
                  f'<text x="{L - 6}" y="{y1(v1) + 4:.1f}" text-anchor="end" fill="#5b6863">{v1:,.0f}</text>',
                  f'<line x1="{L}" x2="{W - R}" y1="{y2(v2):.1f}" y2="{y2(v2):.1f}" stroke="#e3e8e5"/>',
                  f'<text x="{L - 6}" y="{y2(v2) + 4:.1f}" text-anchor="end" fill="#5b6863">{v2:,.0f}</text>']
    for i in range(7):
        sec = xmax * i / 6
        parts.append(f'<text x="{x(sec):.1f}" y="{top2 + h2 + 18}" text-anchor="middle" fill="#5b6863">'
                     f'{sec:.0f}s</text>')
    parts += [f'<text x="18" y="{top1 + h1 / 2}" transform="rotate(-90 18 {top1 + h1 / 2})" text-anchor="middle" '
              'fill="#5b6863">ms</text>',
              f'<text x="18" y="{top2 + h2 / 2}" transform="rotate(-90 18 {top2 + h2 / 2})" text-anchor="middle" '
              'fill="#5b6863">lượt/giây</text>',
              f'<polyline points="{poly("lag_max", y1)}" fill="none" stroke="#9fc9bf" stroke-width="1.5"/>',
              f'<polyline points="{poly("lag_avg", y1)}" fill="none" stroke="#0d6a5b" stroke-width="2.2"/>',
              f'<line x1="{L}" x2="{W - R}" y1="{y1(p95):.1f}" y2="{y1(p95):.1f}" stroke="#a3341f" '
              'stroke-dasharray="6 4"/>',
              f'<text x="{W - R - 4}" y="{y1(p95) - 6:.1f}" text-anchor="end" fill="#a3341f">P95 = {p95:,.0f} ms</text>']
    bw = max(1.0, (W - L - R) / xmax * 0.7)
    for s in xs:
        v = per_sec[s]["sent"]
        if v:
            parts.append(f'<rect x="{x(s) - bw / 2:.1f}" y="{y2(v):.1f}" width="{bw:.1f}" '
                         f'height="{top2 + h2 - y2(v):.1f}" fill="#d6dcd8"/>')
    parts.append(f'<polyline points="{poly("done", y2)}" fill="none" stroke="#0d6a5b" stroke-width="2"/>')
    ly1, ly2 = top1 - 18, top2 - 18  # hàng chú thích phía trên mỗi khung
    parts += [f'<line x1="{L}" x2="{L + 22}" y1="{ly1}" y2="{ly1}" stroke="#0d6a5b" stroke-width="3"/>',
              f'<text x="{L + 28}" y="{ly1 + 4}" fill="#1c2421">Độ trễ trung bình mỗi giây</text>',
              f'<line x1="{L + 230}" x2="{L + 252}" y1="{ly1}" y2="{ly1}" stroke="#9fc9bf" stroke-width="3"/>',
              f'<text x="{L + 258}" y="{ly1 + 4}" fill="#1c2421">Độ trễ lớn nhất mỗi giây</text>',
              f'<line x1="{L + 450}" x2="{L + 472}" y1="{ly1}" y2="{ly1}" stroke="#a3341f" stroke-dasharray="6 4"/>',
              f'<text x="{L + 478}" y="{ly1 + 4}" fill="#1c2421">P95 của cả lần đo</text>',
              f'<rect x="{L}" y="{ly2 - 5}" width="22" height="10" fill="#d6dcd8"/>',
              f'<text x="{L + 28}" y="{ly2 + 4}" fill="#1c2421">Lượt gửi mỗi giây</text>',
              f'<line x1="{L + 230}" x2="{L + 252}" y1="{ly2}" y2="{ly2}" stroke="#0d6a5b" stroke-width="3"/>',
              f'<text x="{L + 258}" y="{ly2 + 4}" fill="#1c2421">Lượt Spark ghi xong mỗi giây</text>',
              "</svg>"]
    path.write_text("\n".join(parts), encoding="utf-8")


def stat_cols(samples, key):
    vals = [s[key] for s in samples if s.get(key) is not None]
    if not vals:
        return "-", "-"
    return f"{sum(vals) / len(vals):,.1f}", f"{max(vals):,.1f}"


# ---------------------------------------------------------------- chương trình chính
def summarize(scans, n, send_seconds):
    """scans: list (received_ms, processing_ms, lag_ms, scan_result). Trả (chỉ số, theo từng giây,
    phân bố kết quả, mốc nhận đầu tiên)."""
    lags = [s[2] for s in scans]
    t_first = min(s[0] for s in scans)
    t_last_proc = max(s[1] for s in scans)
    span = max((t_last_proc - t_first) / 1000, 0.001)
    per_sec = {}
    for rec, proc_ms, lag, _ in scans:
        a = per_sec.setdefault((rec - t_first) // 1000, {"sent": 0, "done": 0, "lags": []})
        a["sent"] += 1
        a["lags"].append(lag)
        per_sec.setdefault((proc_ms - t_first) // 1000, {"sent": 0, "done": 0, "lags": []})["done"] += 1
    for v in per_sec.values():  # giây chỉ có lượt ghi xong, không có lượt nhận: không vẽ điểm độ trễ
        v["lag_avg"] = sum(v["lags"]) / len(v["lags"]) if v["lags"] else None
        v["lag_max"] = max(v["lags"]) if v["lags"] else None
    results = {}
    for _, _, _, res in scans:
        results[res] = results.get(res, 0) + 1
    m = {
        "count": len(scans), "sent": n, "missing": n - len(scans),
        "send_rate": n / send_seconds,
        "throughput": len(scans) / span,
        "peak": max(v["done"] for v in per_sec.values()),
        "avg": sum(lags) / len(lags), "p50": pct(lags, 50), "p95": pct(lags, 95), "p99": pct(lags, 99),
        "max": max(lags), "min": min(lags),
    }
    return m, per_sec, results, t_first


def write_docs(root, rate, duration, seed, n, m, results, samples, per_sec, scans, t_first):
    """Ghi docs/performance.md, biểu đồ SVG và số liệu thô vào thư mục root/docs."""
    docs, img, raw = root / "docs", root / "docs" / "images", root / "docs" / "performance_data"
    img.mkdir(parents=True, exist_ok=True)
    raw.mkdir(parents=True, exist_ok=True)
    svg_chart(per_sec, m["p95"], img / "performance_latency.svg")
    with open(raw / "scans.csv", "w", encoding="utf-8") as f:
        f.write("giay_tu_luc_gui,received_epoch_ms,processing_epoch_ms,ingestion_lag_ms,scan_result\n")
        for rec, proc_ms, lag, res in scans:
            f.write(f"{(rec - t_first) / 1000:.3f},{rec},{proc_ms},{lag},{res}\n")
    keys = sorted({k for s in samples for k in s})
    with open(raw / "resources.csv", "w", encoding="utf-8") as f:
        f.write(",".join(keys) + "\n")
        for s in samples:
            f.write(",".join(str(s.get(k, "")) for k in keys) + "\n")

    _, vm_total = vm_used_mb()
    cpu_model = next((ln.split(":", 1)[1].strip() for ln in Path("/proc/cpuinfo").read_text().splitlines()
                      if ln.startswith("model name")), platform.processor() or "?")
    when = datetime.now(VN).strftime("%Y-%m-%d %H:%M")
    res_rows = "\n".join(
        f"| {label} | {stat_cols(samples, k + '_cpu')[0]} | {stat_cols(samples, k + '_cpu')[1]} | "
        f"{stat_cols(samples, k + '_mb')[0]} | {stat_cols(samples, k + '_mb')[1]} |"
        for label, k in [("Spark: tiến trình Python", "spark_python"), ("Spark: JVM", "spark_jvm"),
                         ("SQL Server (container)", "sqlserver"), ("Kafka (container)", "kafka"),
                         ("API (container)", "api")])
    vm_avg, vm_max = stat_cols(samples, "wsl_vm_mb")
    by_result = ", ".join(f"{k} {v}" for k, v in sorted(results.items()))
    (docs / "performance.md").write_text(f"""# Đo tải (B2)

Một mức tải: **{rate:g} lượt quét/giây trong {duration} giây** ({n} lượt), gửi thẳng vào Kafka
bằng `scripts/load_test.py`, giờ nhận lấy đúng lúc gửi. Độ trễ là `ingestion_lag_ms = processing_ts −
received_at` của từng dòng `scan_event`: gồm thời gian chờ tới đợt kế tiếp (chu kỳ 1 giây) và thời gian
Spark xử lý một đợt (đọc Kafka, tra DB, tính, ghi trong một giao dịch).

Đo lúc {when} (giờ Việt Nam).

## Cấu hình máy và pipeline

| Hạng mục | Giá trị |
|---|---|
| CPU | {cpu_model}, {os.cpu_count()} luồng thấy được trong WSL |
| RAM máy ảo WSL | {vm_total:,.0f} MB (Docker Desktop chạy chung máy ảo này) |
| Hệ điều hành | {platform.platform()} |
| Spark | PySpark 4.1.3, `local[2]`, Bronze và Silver chung một tiến trình |
| Chu kỳ đợt Silver | 1 giây (`--silver-trigger-seconds`), tối đa 2000 bản tin/đợt (`--max-offsets-per-trigger`) |
| Chu kỳ đợt Bronze | 5 giây |
| Kafka | 1 broker, topic `scan-events` 3 phân vùng |
| Dữ liệu vé | 7 vé mẫu và mã vé giả trộn ngẫu nhiên (70% vé thật), hạt giống {seed} |

## Kết quả

| Chỉ số | Giá trị |
|---|---|
| Lượt gửi / Spark đã ghi | {n} / {m['count']} (thiếu {m['missing']}) |
| Tốc độ gửi thực tế | {m['send_rate']:.1f} lượt/giây |
| Thông lượng Spark (lượt ghi xong / thời gian từ lượt nhận đầu tới lượt ghi cuối) | **{m['throughput']:.1f} lượt/giây** |
| Đỉnh lượt ghi xong trong một giây | {m['peak']} lượt |
| Độ trễ trung bình | **{m['avg']:,.0f} ms** |
| P50 / P95 / P99 | {m['p50']:,} / **{m['p95']:,}** / {m['p99']:,} ms |
| Nhỏ nhất / lớn nhất | {m['min']:,} / **{m['max']:,}** ms |
| Phân bố kết quả | {by_result} |

![Độ trễ và thông lượng theo thời gian](images/performance_latency.svg)

## CPU và RAM lúc chạy (mẫu mỗi ~2 giây)

CPU tính theo phần trăm của một lõi (200% = dùng trọn 2 lõi), giống cách `docker stats` báo.

| Thành phần | CPU TB % | CPU lớn nhất % | RAM TB MB | RAM lớn nhất MB |
|---|---|---|---|---|
{res_rows}
| Cả máy ảo WSL (đã dùng) | - | - | {vm_avg} | {vm_max} |

Số liệu thô: `docs/performance_data/scans.csv`, `docs/performance_data/resources.csv`.

## Chạy lại

```bash
./scripts/up.sh full                 # hoặc stream; đợi Spark in "[pipeline] Đang chạy"
./scripts/dev_event_window.sh now
python3 scripts/load_test.py --rate {rate:g} --duration {duration}
./scripts/dev_event_window.sh demo   # trả lại giờ demo
```

Trong lúc đo đừng quét thêm (script lọc lượt của mình theo khoảng giờ nhận). Mở
`http://localhost:3000/app.html#dashboard` cùng lúc để xem số liệu tăng dần.
""", encoding="utf-8")
    print("Đã ghi docs/performance.md, docs/images/performance_latency.svg, docs/performance_data/")


def main():
    p = argparse.ArgumentParser(description="Đo tải một mức: thông lượng, độ trễ, CPU/RAM, biểu đồ")
    p.add_argument("--rate", type=float, default=25, help="lượt quét mỗi giây (mặc định 25)")
    p.add_argument("--duration", type=int, default=120, help="số giây gửi (mặc định 120)")
    p.add_argument("--wait", type=int, default=300, help="đợi Spark ghi đủ tối đa bao nhiêu giây (mặc định 300)")
    p.add_argument("--seed", type=int, default=2026)
    p.add_argument("--no-docs", action="store_true", help="chỉ in kết quả, không ghi docs/")
    args = p.parse_args()
    os.chdir(ROOT)

    if not ENV_FILE.is_file():
        die("chưa có docker/.env")
    if not pids_of("stream_scan_events.py"):
        die("Spark chưa chạy. Bật bằng ./scripts/up.sh stream (hoặc full), đợi '[pipeline] Đang chạy'.")
    n = int(args.rate * args.duration)
    if n <= 0:
        die("--rate x --duration phải lớn hơn 0")
    window = sql_rows(f"SELECT CONCAT(CONVERT(VARCHAR(23), admission_start, 126), ',', "
                      f"CONVERT(VARCHAR(23), admission_end, 126)) FROM dbo.[event] "
                      f"WHERE event_id = N'{env_get('ACTIVE_EVENT_ID', 'EV001')}';")
    print(f"Khung giờ nhận khách: {window[0] if window else '?'} (nên bao trùm bây giờ: dev_event_window.sh now)")

    specs = send_scans.burst_specs(n, random.Random(args.seed))
    secret = send_scans.qr_secret()
    proc = subprocess.Popen(send_scans.producer_cmd(os.environ.get("KAFKA_CONTAINER", "kafka"),
                                                    env_get("KAFKA_TOPIC", "scan-events")),
                            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, text=True, encoding="utf-8")
    t0 = time.time()
    first = datetime.now(VN) - timedelta(seconds=1)
    sampler = Sampler(t0)
    sampler.start()
    print(f"Gửi {n} lượt quét, {args.rate:g} lượt/giây trong {args.duration} giây...")
    start = time.monotonic()
    for i, (ticket, gate, _) in enumerate(specs):
        delay = start + i / args.rate - time.monotonic()
        if delay > 0:
            time.sleep(delay)
        ev = send_scans.make_event(ticket, gate, datetime.now(VN), None, secret)
        proc.stdin.write(f"{ev['ticket_id'] or ''}|{json.dumps(ev, ensure_ascii=False)}\n")
        proc.stdin.flush()
    send_seconds = time.monotonic() - start
    proc.stdin.close()
    if proc.wait(timeout=120) != 0:
        die("kafka-console-producer thất bại")
    last = datetime.now(VN) + timedelta(seconds=1)

    where = f"received_at >= '{vn_wall(first)}' AND received_at <= '{vn_wall(last)}'"
    print(f"Đã gửi trong {send_seconds:.1f} giây. Đợi Spark ghi đủ {n} lượt...")
    deadline = time.time() + args.wait
    got = 0
    while time.time() < deadline:
        got = int(sql_rows(f"SELECT COUNT(*) FROM dbo.scan_event WHERE {where};")[0])
        if got >= n:
            break
        time.sleep(2)
    time.sleep(3)  # thêm một mẫu CPU/RAM sau khi xong
    sampler.stop.set()
    sampler.join(timeout=30)

    rows = sql_rows(f"SELECT CONCAT(DATEDIFF_BIG(MILLISECOND, {EPOCH}, received_at), ',', "
                    f"DATEDIFF_BIG(MILLISECOND, {EPOCH}, processing_ts), ',', ingestion_lag_ms, ',', scan_result) "
                    f"FROM dbo.scan_event WHERE {where} ORDER BY received_at;")
    scans = []
    for r in rows:
        rec, proc_ms, lag, res = r.split(",")
        scans.append((int(rec), int(proc_ms), int(lag), res))
    if not scans:
        die("không đọc được lượt quét nào (Spark có ghi không? khung giờ có bao trùm bây giờ không?)")

    m, per_sec, results, t_first = summarize(scans, n, send_seconds)
    print(f"\nĐã ghi {m['count']}/{n} lượt. Thông lượng {m['throughput']:.1f} lượt/giây (đỉnh {m['peak']}/giây). "
          f"Độ trễ TB {m['avg']:.0f} ms, P50 {m['p50']}, P95 {m['p95']}, P99 {m['p99']}, lớn nhất {m['max']} ms.")
    if args.no_docs:
        return

    write_docs(ROOT, args.rate, args.duration, args.seed, n, m, results, sampler.samples, per_sec, scans, t_first)


if __name__ == "__main__":
    main()
