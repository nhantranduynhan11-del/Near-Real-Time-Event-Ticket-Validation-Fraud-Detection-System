# Theo dõi hệ thống (scripts/monitor.sh)

Ví dụ kết quả chạy `./scripts/monitor.sh --save` lúc 2026-11-26 22:54 (giờ Việt Nam).
Ý nghĩa từng phần: xem đầu tệp `scripts/monitor.sh` và mục 7.2 của README.

> Dòng đầu của bảng 1 (`SELECT db_id() as database_id, sm.[is_inlineable] …`, 551 ms) là truy vấn thống kê
> định kỳ của chính SQL Server, không phải của API, Spark hay Gold. Bản `monitor.sh` sau ngày 26/11 lọc bỏ
> câu này. Truy vấn chậm nhất của hệ thống là câu API hỏi kết quả lượt quét (`SELECT LOWER(CONVERT(...
> scan_event_id))`, TB 56.0 ms) và câu đọc tổng số của dashboard (TB 7.5 ms trên 60 lần).

```text
Theo dõi hệ thống — 2026-11-26 22:54:40 (giờ Việt Nam), ACTIVE_EVENT_ID=EV001

== 1. Truy vấn chạy chậm nhất (trung bình mỗi lần, tính từ lúc SQL Server bật) ==
số_lần  tb_ms  lớn_nhất_ms  tb_logical_reads  câu_lệnh
1       551.3  551.3        181657            SELECT       db_id() as database_id,       sm.[is_inlineable] AS InlineableScalarCount,   
2       56.0   63.5         4                 SELECT (     SELECT LOWER(CONVERT(NVARCHAR(36), s.scan_event_id)) AS id     FROM dbo.scan_
1       9.0    9.0          169               SELECT CONCAT(DATEDIFF_BIG(MILLISECOND, CAST('1970-01-01T00:00:00' AS DATETIME2(3)), recei
3       7.9    8.2          58                INSERT INTO dbo.gold_event_stats         (event_id, bucket_start, total_scans, cnt_valid, 
60      7.5    448.6        2                 SELECT            ISNULL(SUM(total_scans), 0) as total_scans,           ISNULL(SUM(fraud_c
1       7.2    7.2          161               SELECT CONCAT(DATEDIFF_BIG(MILLISECOND, CAST('1970-01-01T00:00:00' AS DATETIME2(3)), recei
2       6.6    7.1          645               INSERT INTO dbo.gold_alert         (scan_event_id, event_id, created_at, received_at, aler
3       6.1    6.4          75                INSERT INTO dbo.gold_gate_stats         (event_id, gate_id, total_scans, cnt_valid, cnt_in
1       6.1    6.1          168               SELECT CONCAT(DATEDIFF_BIG(MILLISECOND, CAST('1970-01-01T00:00:00' AS DATETIME2(3)), recei
211     3.1    12.2         504               INSERT INTO dbo.scan_event (scan_event_id, event_id, ticket_id, scanner_id, gate_id, opera

== 2. Kích thước và số dòng từng bảng ==
bảng              số_dòng  tổng_MB  dữ_liệu_MB  index_phụ_MB  số_index_phụ
scan_event        3000     2.28     1.26        0.81          3
gold_alert        2995     1.08     0.80        0.16          1
fraud_alert       2995     0.38     0.34        0.00          0
app_user          5        0.14     0.02        0.02          1
scanner           4        0.14     0.02        0.02          1
ticket            7        0.14     0.02        0.02          1
event             2        0.07     0.02        0.00          0
event_gate        6        0.07     0.02        0.00          0
gate              4        0.07     0.02        0.00          0
gate_travel_time  12       0.07     0.02        0.00          0
gold_event_stats  3        0.07     0.02        0.00          0
gold_gate_stats   4        0.07     0.02        0.00          0

== 3. Pipeline: độ trễ 100 lượt quét gần nhất (ingestion_lag_ms = processing_ts - received_at) ==
số_lượt  tb_ms   P50_ms  P95_ms  lớn_nhất_ms  lượt_mới_nhất
100      2824.0  2815    3734    3888         2026-11-26 22:54:30.543

Lượt quét Spark ghi trong 5 phút qua: 3000
Spark: đang chạy (pid 220413), 02:59 từ lúc bật
Kafka scan-events: 3000 bản tin; Spark đã nhận tới 3000 (đợt 64); còn tồn: 0
Gold so với Silver: Silver ghi lần cuối 2026-11-26 22:54:33.671, Gold tính lại lần cuối 2026-11-26 22:54:33.683 (Gold đã theo kịp)

== 4. Bản tin trong DLQ (scan-events-dlq) ==
Đang giữ: 0 bản tin (tổng từng nhận: 0)
```
