# 06 — Ticket Lifecycle (Phase 1 · 1.2)

## Quyết định nghiệp vụ chốt trước

**Vé đã dùng thành công có được dùng để vào lại không? → KHÔNG.** Hệ thống áp dụng chính sách single-entry: mỗi vé chỉ được ghi nhận vào hợp lệ một lần (khớp F03 — "vé đã qua cổng nhưng được quét lại" là định nghĩa gian lận). Bất kỳ lượt quét nào sau lần vào hợp lệ đầu tiên đều bị xử lý theo nhánh gian lận, chuyển ticket sang `FLAGGED_FRAUD`, không quay lại trạng thái đã vào hợp lệ.

## Danh sách trạng thái

| Trạng thái | Ý nghĩa |
|---|---|
| **UNUSED** | Vé hợp lệ, chưa từng được quét thành công lần nào |
| **VALID_ENTRY** | Vé đã được quét hợp lệ và cho vào, tại một gate, một thời điểm xác định |
| **FLAGGED_FRAUD** | Có lượt quét thứ hai (hoặc hơn) cho cùng vé sau khi đã ở `VALID_ENTRY`, được xác nhận là gian lận |
| **EXPIRED** | Vé còn ở `UNUSED` nhưng sự kiện đã kết thúc mà chưa từng được quét |
| **CANCELLED** | Vé bị Event Supervisor thu hồi qua chức năng quản trị (F08/UC04) |

**Trạng thái đầu:** `UNUSED` — mọi vé nhập vào hệ thống (qua UC06, nếu giữ) đều bắt đầu ở đây.

**Trạng thái cuối:** `VALID_ENTRY`, `FLAGGED_FRAUD`, `EXPIRED`, `CANCELLED` — không có transition đi tiếp trong phạm vi hệ thống này.

## Bảng transition

| Từ | Đến | Hành động gây ra | Điều kiện |
|---|---|---|---|
| `UNUSED` | `VALID_ENTRY` | Gate Operator quét vé (UC01) | Lượt quét đầu tiên, không CANCELLED, còn trong giờ nhận khách, đúng cổng |
| `UNUSED` | `EXPIRED` | Hệ thống tự động đóng sự kiện | Sự kiện đã kết thúc, vé chưa từng được quét thành công |
| `UNUSED` | `CANCELLED` | Event Supervisor thu hồi vé (UC04) | Thao tác quản trị chủ động, trước khi vé được dùng |
| `VALID_ENTRY` | `FLAGGED_FRAUD` | Gate Operator quét lại cùng vé (UC01 → UC02) | Có lượt quét mới cho cùng vé sau khi đã `VALID_ENTRY`, fraud rule xác nhận điều kiện gian lận thỏa |

## Transition KHÔNG được phép

- **VALID_ENTRY → UNUSED**: vé đã vào hợp lệ không được đưa trở lại trạng thái chưa dùng.
- **VALID_ENTRY → VALID_ENTRY (lặp lại)**: không có "vào lần hai hợp lệ"; mọi lượt quét sau lần đầu đều dẫn tới `FLAGGED_FRAUD`.
- **FLAGGED_FRAUD → bất kỳ trạng thái nào khác**: một khi đã bị đánh dấu gian lận, ticket không quay lại được trạng thái hợp lệ trong phạm vi hệ thống này.
- **EXPIRED → VALID_ENTRY** hoặc **CANCELLED → VALID_ENTRY**: vé đã hết hiệu lực hoặc đã bị hủy thì không thể quét vào được nữa.

## Sơ đồ trạng thái (mô tả dạng text)

```
                 ┌───────────┐
        ┌───────►│  EXPIRED  │ (final)
        │        └───────────┘
        │
┌───────────┐   Gate Operator quét, scan_result = VALID  ┌──────────────┐
│  UNUSED   ├─────────────────────────────────────────────►│ VALID_ENTRY  │ (final)
└─────┬─────┘                                              └──────┬───────┘
      │                                                           │
      │ Event Supervisor thu hồi (UC04)                           │ quét lại, scan_result = USED + fraud rule thỏa
      ▼                                                           ▼
┌───────────┐                                            ┌────────────────┐
│ CANCELLED │ (final)                                     │ FLAGGED_FRAUD  │ (final)
└───────────┘                                             └────────────────┘
```
