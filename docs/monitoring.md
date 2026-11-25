# Theo dõi hệ thống (scripts/monitor.sh)

> **Chưa có ví dụ chạy thật.** Chạy `./scripts/monitor.sh --save` khi hệ thống đang chạy để ghi đè tệp này
> bằng kết quả thật.

Một lệnh, chỉ đọc, in ra bốn phần:

| Phần | Nội dung | Lấy từ |
|---|---|---|
| 1. Truy vấn chậm nhất | 10 câu lệnh trên `ticket_system` có thời gian trung bình mỗi lần lớn nhất: số lần chạy, trung bình và lớn nhất (ms), số trang đọc trung bình | `sys.dm_exec_query_stats`, tính từ lúc SQL Server bật |
| 2. Kích thước bảng | Số dòng, tổng dung lượng, phần dữ liệu, phần index phụ, số index phụ của từng bảng | `sys.dm_db_partition_stats` |
| 3. Pipeline | Độ trễ `ingestion_lag_ms` của N lượt quét gần nhất (TB, P50, P95, lớn nhất); số lượt ghi trong 5 phút qua; Spark còn chạy không; Spark còn tồn bao nhiêu bản tin trong Kafka; Gold có theo kịp Silver không | `scan_event`, `gold_event_stats`, checkpoint Silver, `kafka-get-offsets.sh` |
| 4. DLQ | Số bản tin đang giữ trong `scan-events-dlq`, chia theo lý do: Bronze (JSON hỏng, thiếu trường) hoặc mã `dlq_reason` do Silver gắn | `kafka-get-offsets.sh`, `kafka-console-consumer.sh` |

```bash
./scripts/monitor.sh              # in ra màn hình
./scripts/monitor.sh -n 500       # độ trễ tính trên 500 lượt gần nhất (mặc định 100)
./scripts/monitor.sh --save       # in ra và ghi lại vào tệp này
./scripts/monitor.sh --no-dlq-detail   # bỏ bước đọc header DLQ (nhanh hơn vài giây)
```

Đọc kết quả: P95 độ trễ vượt khoảng 3 000 ms thì API bắt đầu trả 202 (`SCAN_WAIT_MS`); "còn tồn" tăng dần
nghĩa là Spark xử lý không kịp tốc độ quét; "Gold CHƯA theo kịp Silver" kéo dài nghĩa là `refresh_gold` đang
lỗi (xem `logs/spark.log`, dòng `[gold]`); DLQ có mã `UNKNOWN_SCANNER_GATE` hay `UNKNOWN_OPERATOR` nghĩa là
có bản tin bỏ qua kiểm tra của API.
