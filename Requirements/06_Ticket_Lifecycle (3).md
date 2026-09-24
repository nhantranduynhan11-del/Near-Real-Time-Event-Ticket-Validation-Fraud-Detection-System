# 06 — Ticket Lifecycle (Phase 1 · 1.2)



## Quyết định nghiệp vụ chốt trước

**Vé đã dùng thành công có được dùng để vào lại không? → KHÔNG.** Một khi `ticket_status = USED`, mọi lượt quét sau đó đều trả `scan_result = USED` (khớp F03 — "vé đã qua cổng nhưng được quét lại") và sinh fraud alert `DUPLICATE_SCAN` (07), nhưng **không** tạo transition mới cho `ticket_status` — vé vẫn nằm ở USED.

## Danh sách trạng thái 

| Trạng thái | Ý nghĩa |
|---|---|
| **VALID** | Vé hợp lệ, chưa từng được quét thành công lần nào  |
| **USED** | Vé đã được quét hợp lệ và cho vào, tại một gate, một thời điểm xác định |
| **CANCELLED** | Vé bị Event Supervisor thu hồi qua chức năng quản trị  |

**Trạng thái đầu:** `VALID` — mọi vé nhập vào hệ thống (qua UC06, nếu giữ) đều bắt đầu ở đây.

**Trạng thái cuối:** `USED` và `CANCELLED` là final — không có transition đi tiếp. `VALID` **không** tự động chuyển sang trạng thái khác chỉ vì sự kiện kết thúc .

## Bảng transition

| Từ | Đến | Hành động gây ra | Điều kiện | scan_result tương ứng |
|---|---|---|---|---|
| `VALID` | `USED` | Gate Operator quét vé (UC01) | Lượt quét đầu tiên, không CANCELLED, còn trong giờ nhận khách, đúng cổng | `VALID` |
| `VALID` | `CANCELLED` | Event Supervisor thu hồi vé (UC04) | Thao tác quản trị chủ động, có thể xảy ra bất kỳ lúc nào trước khi vé được dùng | *(không qua UC01, đổi trực tiếp)* |



## Transition KHÔNG được phép

- **USED → VALID**: vé đã vào hợp lệ không được đưa trở lại trạng thái chưa dùng.
- **USED → CANCELLED**: vé đã vào cổng rồi thì không còn thu hồi được nữa trong phạm vi hệ thống này (nếu nhóm cần nghiệp vụ hoàn vé sau khi đã vào cổng thì phải bổ sung riêng, hiện chưa có).
- **CANCELLED → VALID** hoặc **CANCELLED → USED**: vé đã hủy không được kích hoạt lại; mọi lượt quét vào vé đã CANCELLED chỉ trả `scan_result = CANCELLED` (alert `REVOKED_TICKET`), không đổi status.
- **Không có trạng thái EXPIRED hay FLAGGED_FRAUD riêng** trong `ticket_status` — hai khái niệm này chỉ tồn tại ở tầng `scan_result`, xem bảng phân biệt ở đầu file.

## Sơ đồ trạng thái (mô tả dạng text)

```
┌─────────┐   Gate Operator quét, scan_result = VALID   ┌────────┐
│  VALID  ├───────────────────────────────────────────────►│  USED  │ (final)
└────┬────┘                                                 └────────┘
     │
     │ Event Supervisor thu hồi (F08 / UC04)
     ▼
┌────────────┐
│ CANCELLED  │ (final)
└────────────┘
```

Quét lặp lại lên vé đã ở `USED` hoặc `CANCELLED` → không có mũi tên mới, chỉ sinh `scan_result` + fraud alert tương ứng (07), vòng lặp tại chỗ.





