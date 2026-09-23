# Task 1.3 - Scan Results

| Scan Result | Ý nghĩa | Điều kiện trả về | Fraud alert | Entry |
|---|---|---|---|---|
| `VALID` | Vé hợp lệ, có thể vô | Chưa có lần quét nào trước đó | Không | Cho vô |
| `INVALID` | Vé giả | Không tìm được id của vé trong `ticket_id` | `INVALID_QR` | Không cho vô |
| `USED` | Vé đã sử dụng và đang dùng để quét lại | Đã từng được quét trước đó | `DUPLICATE_SCAN` | Không cho vô |
| `CANCELLED` | Vé đã hủy hay được hoàn tiền nhưng người dùng vẫn lấy để quét |Vé đã hủy/hoàn tiền | `REVOKED_TICKET` | Không cho vô |
| `EXPIRED` | Vé valid nhưng đã hết giờ nhận khách | Hết thời gian nhận khách | Không | Không cho vô |
| `WRONG_GATE` | Vô nhầm cổng | Vé bị quét ở nhầm cổng | `WRONG_GATE` | Không cho vô |



