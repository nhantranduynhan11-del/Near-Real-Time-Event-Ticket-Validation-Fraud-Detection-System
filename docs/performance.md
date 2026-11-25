# Đo tải (B2)

> **Chưa có số đo.** Tệp này sẽ được `scripts/load_test.py` ghi đè bằng số thật (bảng số, cấu hình máy,
> CPU/RAM, biểu đồ `docs/images/performance_latency.svg`). Máy của người viết code chỉ có 5,9 GB RAM, không
> chạy nổi SQL Server + Kafka + Spark cùng lúc, nên cần chạy trên máy từ 8 GB RAM.

## Đo gì

| Chỉ số | Cách tính |
|---|---|
| Thông lượng Spark | Số lượt Spark ghi xong / thời gian từ lượt nhận đầu tiên tới lượt ghi xong cuối cùng |
| Đỉnh mỗi giây | Số lượt có `processing_ts` rơi vào cùng một giây, lớn nhất |
| Độ trễ | `ingestion_lag_ms = processing_ts − received_at` của từng lượt: trung bình, P50, P95, P99, lớn nhất |
| CPU, RAM | Mỗi ~2 giây: Spark (tiến trình Python và JVM, đọc `/proc`), container SQL Server, Kafka, API (`docker stats`), RAM đã dùng của cả máy ảo WSL |

Độ trễ gồm hai phần: thời gian chờ tới đợt Silver kế tiếp (chu kỳ 1 giây, trung bình khoảng 0,5 giây) và
thời gian xử lý một đợt (đọc Kafka, tra DB, tính bằng Spark, ghi trong một giao dịch, gọi Gold).

## Cách chạy

```bash
./scripts/up.sh full                 # hoặc stream; đợi Spark in "[pipeline] Đang chạy"
./scripts/dev_event_window.sh now
python3 scripts/load_test.py         # 25 lượt/giây x 120 giây = 3000 lượt
./scripts/dev_event_window.sh demo   # trả lại giờ demo
```

Đổi mức tải: `--rate` (lượt/giây), `--duration` (giây). Trong lúc đo đừng quét thêm; mở
`http://localhost:3000/app.html#dashboard` để xem số liệu và biểu đồ thay đổi liên tục.
