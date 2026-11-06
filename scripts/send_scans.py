#!/usr/bin/env python3
"""scripts/send_scans.py - đẩy lượt quét thử thẳng vào Kafka, có đặt được received_at (Role B).

Khác send_test_event.sh: gửi nhiều lượt một lần, chọn vé và cổng, đặt giờ nhận TƯƠNG ĐỐI so với
bây giờ. Cần vì CK_scan_event_ts (processing_ts >= received_at) không cho ghi lượt quét có giờ
nhận ở tương lai, nên thử trước ngày demo phải dời khung giờ sự kiện về hiện tại
(scripts/dev_event_window.sh now) rồi gửi giờ nhận tính lùi từ bây giờ.

Cách dùng (trong WSL, Kafka đang chạy):
    python3 scripts/send_scans.py TK001@GATE_A TK001@GATE_D          # hai lượt, giờ nhận = bây giờ
    python3 scripts/send_scans.py TK002@GATE_B@-1800 TK002@GATE_B    # lượt đầu cách đây 30 phút
    python3 scripts/send_scans.py QR_ERROR@GATE_A FAKE_TK999@GATE_A  # QR hỏng, vé giả
    python3 scripts/send_scans.py FORGED:TK001@GATE_A                # QR giả chữ ký của TK001
    python3 scripts/send_scans.py --burst 100                        # 100 lượt ngẫu nhiên
    python3 scripts/send_scans.py --burst 100 --interval-ms 200      # rải đều, mỗi 200 ms một lượt
    python3 scripts/send_scans.py --qr TK001                         # chỉ in chuỗi QR đã ký của TK001

SPEC = VÉ@CỔNG[@GIÂY]
    VÉ    mã vé, hoặc
          QR_ERROR      máy quét không đọc được QR (decode_error=true, ticket_id=null)
          FORGED:<mã>   QR mang mã vé thật nhưng chữ ký sai: gửi đúng như API làm khi kiểm chữ
                        ký thất bại (decode_error=true, ticket_id=null, giữ nguyên chuỗi QR)
    CỔNG  GATE_A..GATE_D; máy quét là SC_<chữ cuối của cổng>1 (khớp seed.sql)
    GIÂY  giờ nhận so với bây giờ, âm là trong quá khứ (mặc định 0). Mọi SPEC dùng chung một mốc
          "bây giờ", nên khoảng cách là chính xác: TK001@GATE_A@-140 TK001@GATE_D cách đúng
          140 000 ms (TC08 của file 10)

Chuỗi QR theo file 15 ("Định dạng mã QR và cách ký"): <ticket_id>.<chữ ký 22 ký tự>, ký bằng
QR_HMAC_SECRET (lấy từ biến môi trường hoặc docker/.env). Thiếu secret thì phần chữ ký là UNSIGNED.
Gửi thẳng vào Kafka là bỏ qua bước API kiểm chữ ký: chỉ dùng để thử pipeline.

In ra stdout, mỗi lượt một dòng theo đúng thứ tự gửi:  scan_event_id<TAB>vé<TAB>cổng<TAB>received_at
"""
import argparse
import base64
import hashlib
import hmac
import json
import os
import random
import re
import subprocess
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

VN = timezone(timedelta(hours=7))
SPEC_RE = re.compile(r"^([^@\s|]{1,64})@(GATE_[A-Z])(?:@(-?\d+(?:\.\d+)?))?$")
BURST_TICKETS = ["TK001", "TK002", "TK003", "TK004", "TK005", "TK006", "TK007"]
GATES = ["GATE_A", "GATE_B", "GATE_C", "GATE_D"]
ENV_FILE = Path(__file__).resolve().parent.parent / "docker" / ".env"


def vn_iso(dt):
    return dt.astimezone(VN).strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}+07:00"


def qr_secret():
    """QR_HMAC_SECRET: biến môi trường trước, rồi docker/.env. Không có thì trả chuỗi rỗng."""
    if os.environ.get("QR_HMAC_SECRET"):
        return os.environ["QR_HMAC_SECRET"]
    if ENV_FILE.is_file():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            if line.startswith("QR_HMAC_SECRET="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def qr_signature(ticket_id, secret):
    """File 15: base64url(HMAC-SHA256(secret, ticket_id)) lấy 16 byte đầu -> 22 ký tự, bỏ '='.
    Khóa là chuỗi secret dạng UTF-8, giống crypto.createHmac('sha256', secret) của Node."""
    digest = hmac.new(secret.encode("utf-8"), ticket_id.encode("utf-8"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest[:16]).rstrip(b"=").decode("ascii")


def qr_payload(ticket_id, secret):
    return f"{ticket_id}.{qr_signature(ticket_id, secret) if secret else 'UNSIGNED'}"


def make_event(ticket, gate, now, operator, secret):
    """now = giờ nhận (received_at) của lượt quét này."""
    if ticket == "QR_ERROR":
        raw, ticket_id = "#unreadable#", None
    elif ticket.startswith("FORGED:"):
        # Kẻ gian tự ghép mã vé thật với chữ ký đoán bừa; API kiểm sai nên xóa ticket_id
        raw, ticket_id = qr_payload(ticket[len("FORGED:"):], "khong-phai-secret-that"), None
    else:
        raw, ticket_id = qr_payload(ticket, secret), ticket
    return {
        "scan_event_id": str(uuid.uuid4()),
        "raw_qr_payload": raw,
        "ticket_id": ticket_id,
        "decode_error": ticket_id is None,
        "gate_id": gate,
        "scanner_id": f"SC_{gate[-1]}1",
        "operator_id": operator,
        "scanned_at": vn_iso(now),
        "received_at": vn_iso(now),
    }


def parse_specs(specs):
    out = []
    for s in specs:
        m = SPEC_RE.match(s)
        if not m:
            sys.exit(f"LỖI: '{s}' sai dạng. Ví dụ đúng: TK001@GATE_A hoặc TK001@GATE_A@-30")
        out.append((m.group(1), m.group(2), float(m.group(3) or 0)))
    return out


def burst_specs(n, rng):
    specs = []
    for i in range(n):
        ticket = rng.choice(BURST_TICKETS) if rng.random() < 0.7 else f"FAKE_{i:05d}"
        specs.append((ticket, rng.choice(GATES), 0.0))
    return specs


def producer_cmd(container, topic):
    # linger.ms=0: gửi ngay từng bản tin (mặc định của công cụ là gom 1 giây, làm sai số đo độ trễ)
    return ["docker", "exec", "-i", "-e", "KAFKA_HEAP_OPTS=-Xmx128m -Xms64m", container,
            "/opt/kafka/bin/kafka-console-producer.sh", "--bootstrap-server", "localhost:9092",
            "--topic", topic, "--property", "parse.key=true", "--property", "key.separator=|",
            "--producer-property", "linger.ms=0"]


def main():
    p = argparse.ArgumentParser(description="Đẩy lượt quét thử vào Kafka (bỏ qua API)")
    p.add_argument("specs", nargs="*", help="VÉ@CỔNG[@GIÂY]")
    p.add_argument("--burst", type=int, default=0, help="thêm N lượt ngẫu nhiên (vé mẫu + vé giả)")
    p.add_argument("--interval-ms", type=int, default=0,
                   help="nghỉ giữa hai lượt; received_at lấy đúng lúc gửi từng lượt")
    p.add_argument("--operator", default=None, help="operator_id (mặc định null)")
    p.add_argument("--seed", type=int, default=None, help="hạt giống ngẫu nhiên cho --burst")
    p.add_argument("--container", default=os.environ.get("KAFKA_CONTAINER", "kafka"))
    p.add_argument("--topic", default=os.environ.get("KAFKA_TOPIC", "scan-events"))
    p.add_argument("--dry-run", action="store_true", help="chỉ in bản tin, không gửi")
    p.add_argument("--qr", metavar="MÃ_VÉ", help="chỉ in chuỗi QR đã ký của một vé rồi thoát")
    args = p.parse_args()

    secret = qr_secret()
    if args.qr:
        if not secret:
            sys.exit("LỖI: chưa có QR_HMAC_SECRET (biến môi trường hoặc docker/.env).")
        print(qr_payload(args.qr, secret))
        return
    if not secret:
        print("CHÚ Ý: chưa có QR_HMAC_SECRET, chuỗi QR gửi đi mang chữ ký UNSIGNED.", file=sys.stderr)
    elif len(secret) < 32:
        print("CHÚ Ý: QR_HMAC_SECRET ngắn hơn 32 ký tự, API sẽ từ chối khởi động (file 15). "
              "Tạo mới: openssl rand -hex 32", file=sys.stderr)

    specs = parse_specs(args.specs) + burst_specs(args.burst, random.Random(args.seed))
    if not specs:
        p.error("cần ít nhất một SPEC hoặc --burst N")

    proc = None
    if not args.dry_run:
        proc = subprocess.Popen(producer_cmd(args.container, args.topic), stdin=subprocess.PIPE,
                                stdout=subprocess.DEVNULL, text=True, encoding="utf-8")
    sent = []
    # Mọi SPEC của một lần chạy dùng CHUNG một mốc "bây giờ", nên GIÂY là khoảng cách chính xác
    # tới từng mili giây (TC08 cần cách đúng 140 000 ms). Có --interval-ms thì lấy giờ lúc gửi.
    base = datetime.now(VN)
    try:
        for i, (ticket, gate, offset_s) in enumerate(specs):
            if i and args.interval_ms:
                time.sleep(args.interval_ms / 1000)
                base = datetime.now(VN)
            ev = make_event(ticket, gate, base + timedelta(seconds=offset_s), args.operator, secret)
            line = f"{ev['ticket_id'] or ''}|{json.dumps(ev, ensure_ascii=False)}\n"
            if proc:
                proc.stdin.write(line)
                proc.stdin.flush()
            else:
                print(line, end="", file=sys.stderr)
            sent.append((ticket, ev))
    finally:
        if proc:
            proc.stdin.close()
            if proc.wait(timeout=120) != 0:
                sys.exit("LỖI: kafka-console-producer thất bại (Kafka đang chạy? topic đã tạo?)")
    for ticket, ev in sent:
        print(f"{ev['scan_event_id']}\t{ticket}\t{ev['gate_id']}\t{ev['received_at']}")
    print(f"{'Chạy thử, KHÔNG gửi' if args.dry_run else 'Đã gửi'} {len(sent)} lượt quét "
          f"vào '{args.topic}'.", file=sys.stderr)


if __name__ == "__main__":
    main()
