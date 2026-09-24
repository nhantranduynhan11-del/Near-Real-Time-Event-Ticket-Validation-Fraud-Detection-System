# Task 1.3 - Scan Results

## Bảng kết quả

| Scan Result | Ý nghĩa | Điều kiện | Alert Level | Entry |
|---|---|---|---|---|
| `VALID` | Vé hợp lệ, có thể vô | `ticket_status = UNUSED`, đúng cổng, còn trong giờ nhận khách | NONE | Cho vô |
| `INVALID` | Vé giả / QR lỗi | Không tìm được `ticket_id` trong DB, hoặc `decode_error = true` | FRAUD (`INVALID_QR`) | Không cho vô |
| `USED` | Vé đã có entry hợp lệ, giờ bị quét lại | `ticket_status = VALID_ENTRY` hoặc `FLAGGED_FRAUD` | FRAUD (`DUPLICATE_SCAN`) | Không cho vô |
| `CANCELLED` | Vé đã hủy/hoàn tiền nhưng vẫn bị đem quét | `ticket_status = CANCELLED` | FRAUD (`REVOKED_TICKET`) | Không cho vô |
| `EXPIRED` | Vé còn `UNUSED` nhưng hết giờ nhận khách | `ticket_status = UNUSED`, đúng cổng, ngoài giờ nhận khách | NONE | Không cho vô |
| `WRONG_GATE` | Vô nhầm cổng | `ticket_status = UNUSED`, `gate_id ≠ ticket_assigned_gate_id`, còn trong giờ | WARNING hoặc FRAUD — xem mục dưới | Không cho vô |

## Thứ tự ưu tiên (precedence)

Xử lý tuần tự, dừng ở bước đầu tiên khớp điều kiện — để trả lời được câu "vé vừa CANCELLED vừa
hết giờ thì tính gì" hay "vé vừa USED vừa sai cổng thì tính gì":

```
1. decode_error = true, hoặc ticket_id không tồn tại
   → INVALID

2. ticket_status = CANCELLED
   → CANCELLED

3. ticket_status = VALID_ENTRY hoặc FLAGGED_FRAUD
   → USED
   (đã có entry hợp lệ rồi thì gate đúng/sai hay còn giờ hay không cũng không còn quan trọng nữa)

4. ticket_status = UNUSED, gate_id ≠ ticket_assigned_gate_id
   → WRONG_GATE

5. ticket_status = UNUSED, đúng gate, ngoài giờ nhận khách
   → EXPIRED

6. còn lại (UNUSED, đúng gate, còn giờ)
   → VALID (ticket chuyển UNUSED → VALID_ENTRY)
```

Lý do CANCELLED và USED (bước 2, 3) được check trước WRONG_GATE/EXPIRED (bước 4, 5): hai cái đó
là trạng thái vé đã chốt (admin đã hủy, hoặc vé đã có người vào), không phụ thuộc lần quét này ở
cổng nào/giờ nào. WRONG_GATE và EXPIRED chỉ có ý nghĩa khi vé còn `UNUSED`.

## WRONG_GATE: khi nào là WARNING, khi nào là FRAUD

Vô nhầm cổng phần lớn là khách đi lạc, không nên tính vào fraud rate ngay từ lần đầu. Nhưng nếu
một vé lần lượt bị quét sai ở **đủ hết tất cả các cổng** của sự kiện, đó không còn là đi lạc nữa
mà giống hành vi cố tình dò để gian lận hạng vé.

Cách tính: đếm `distinct_wrong_gate_count` — số **cổng khác nhau** mà vé này từng bị quét
`WRONG_GATE` (quét sai cùng một cổng nhiều lần không tính thêm, phải là cổng mới).

- `distinct_wrong_gate_count < tổng số cổng của sự kiện` → **WARNING**, mã `WRONG_GATE_WARNING`,
  không tính vào fraud rate trên dashboard.
- `distinct_wrong_gate_count = tổng số cổng của sự kiện` → **FRAUD**, mã `WRONG_GATE_FRAUD`.

