# Task 1.3 - Scan Results

Tài liệu này là **nguồn chuẩn duy nhất** cho tập kết quả scan và thứ tự ưu tiên xử lý.
Các tài liệu khác (04, 05, 08, 09) tham chiếu tới đây, không viết lại.

## Bảng kết quả

| Scan Result | Ý nghĩa | Điều kiện | Alert Level | Entry |
|---|---|---|---|---|
| `VALID` | Vé hợp lệ, cho vào | `ticket_status = UNUSED`, còn trong giờ nhận khách, đúng cổng | NONE | Cho vào |
| `INVALID` | Vé giả, QR lỗi, hoặc vé của sự kiện khác | `decode_error = true`, hoặc không tìm được `ticket_id` trong DB, hoặc vé tồn tại nhưng `event_id` của vé khác sự kiện đang mở cổng | FRAUD (`INVALID_QR`) | Không cho vào |
| `USED` | Vé đã có entry hợp lệ, giờ bị quét lại | `ticket_status = VALID_ENTRY` hoặc `FLAGGED_FRAUD` | FRAUD (`DUPLICATE_SCAN` hoặc `IMPOSSIBLE_TRAVEL` — xem `09_Fraud_Rules.md`) | Không cho vào |
| `CANCELLED` | Vé đã hủy/hoàn tiền nhưng vẫn bị đem quét | `ticket_status = CANCELLED` | FRAUD (`REVOKED_TICKET`) | Không cho vào |
| `EXPIRED` | Vé chưa dùng nhưng đã hết giờ nhận khách | `ticket_status = EXPIRED`, **hoặc** `ticket_status = UNUSED` và `received_at` nằm ngoài giờ nhận khách | NONE | Không cho vào |
| `WRONG_GATE` | Vào nhầm cổng | `ticket_status = UNUSED`, còn trong giờ nhận khách, `gate_id ≠ ticket_assigned_gate_id` | WARNING hoặc FRAUD — xem mục riêng bên dưới | Không cho vào |

### Vì sao vé của sự kiện khác cũng cho ra `INVALID`

Vé thật nhưng thuộc sự kiện khác vẫn là vé không dùng được cho sự kiện đang diễn ra, và ở cổng thì
nhân viên không phân biệt được nó với vé giả. Nhóm đã cân nhắc tách thành một kết quả riêng nhưng
bản demo chỉ chạy một sự kiện nên không tách. Nếu sau này hệ thống phục vụ nhiều sự kiện cùng lúc
thì nên tách để thống kê rõ hơn.

### Vì sao `EXPIRED` có hai điều kiện

`EXPIRED` là **trạng thái lưu trong DB** (xem `06_Ticket_Lifecycle.md`): khi hết giờ nhận khách,
một tiến trình định kỳ chuyển mọi vé còn `UNUSED` sang `EXPIRED`.

Nhưng tiến trình đó chạy theo chu kỳ, không tức thời. Một lượt quét rơi vào khoảng giữa thời điểm
đóng cổng và thời điểm tiến trình chạy sẽ vẫn thấy `ticket_status = UNUSED`. Vì vậy ngoài việc đọc
trạng thái lưu, bước xử lý còn phải **so `received_at` với giờ nhận khách** ngay tại thời điểm quét.

Hai điều kiện này cho cùng một kết quả `EXPIRED`, chỉ khác ở chỗ trạng thái đã kịp cập nhật hay chưa.

## Thứ tự ưu tiên (precedence)

Xử lý tuần tự, **dừng ở bước đầu tiên khớp điều kiện**:

```
1. decode_error = true,
   hoặc ticket_id không tồn tại trong DB,
   hoặc vé tồn tại nhưng thuộc sự kiện khác
   → INVALID

2. ticket_status = CANCELLED
   → CANCELLED

3. ticket_status = VALID_ENTRY hoặc FLAGGED_FRAUD
   → USED

4. ticket_status = EXPIRED
   HOẶC (ticket_status = UNUSED và received_at ngoài giờ nhận khách)
   → EXPIRED

5. ticket_status = UNUSED, còn trong giờ nhận khách,
   và gate_id ≠ ticket_assigned_gate_id
   → WRONG_GATE

6. Còn lại (UNUSED, còn trong giờ, đúng cổng)
   → VALID   →  ticket chuyển UNUSED → VALID_ENTRY
```

Mốc thời gian dùng ở bước 4 và 5 là `received_at` (đồng hồ server), **không phải** `scanned_at`
(đồng hồ máy quét, có thể lệch) — xem `08_Scan_Event_Specification.md`.

### Giải thích thứ tự

**Bước 2 và 3 đứng trước 4 và 5** vì `CANCELLED`, `VALID_ENTRY`, `FLAGGED_FRAUD` là những trạng thái
đã chốt của vé: admin đã hủy, hoặc vé đã có người vào. Những trạng thái đó không phụ thuộc vào việc
lần quét này diễn ra ở cổng nào hay vào giờ nào.

**Bước 3 đứng trước bước 4** vì một vé đã có entry hợp lệ thì việc quét lại là hành vi đáng ngờ,
bất kể còn giờ hay đã hết giờ. Nếu đảo lại, một vé bị dùng lại sau giờ đóng cổng sẽ bị ghi nhận là
`EXPIRED` và **không sinh cảnh báo** — đúng thời điểm kẻ gian dễ lợi dụng nhất.

**Bước 4 đứng trước bước 5** vì khi đã hết giờ nhận khách thì việc vé thuộc cổng nào không còn ý
nghĩa: dù đúng cổng hay sai cổng, khách đều bị từ chối. Cho ra `EXPIRED` (Alert NONE) thay vì
`WRONG_GATE` (Alert WARNING/FRAUD) tránh việc dashboard bị đầy cảnh báo giả vào lúc đóng cổng,
khi khách đến muộn thường đi lạc nhiều nhất.

### Bảng đối chiếu các tình huống chồng điều kiện

| Tình huống | Kết quả | Bước khớp |
|---|---|---|
| Vé đã `VALID_ENTRY`, quét lại ở cổng khác, còn giờ | `USED` | 3 |
| Vé đã `VALID_ENTRY`, quét lại sau giờ đóng cổng | `USED` | 3 |
| Vé đã `FLAGGED_FRAUD`, quét lần thứ ba | `USED` | 3 |
| Vé `CANCELLED`, quét sau giờ đóng cổng | `CANCELLED` | 2 |
| Vé `UNUSED`, sai cổng, đã hết giờ nhận khách | `EXPIRED` | 4 |
| Vé `UNUSED`, sai cổng, còn trong giờ | `WRONG_GATE` | 5 |
| Vé `EXPIRED` (đã được batch cập nhật), quét ở đúng cổng | `EXPIRED` | 4 |

## WRONG_GATE: khi nào WARNING, khi nào FRAUD

Vào nhầm cổng phần lớn là khách đi lạc, không nên tính vào fraud rate ngay từ lần đầu. Nhưng nếu
một vé lần lượt bị quét sai ở **tất cả các cổng không phải cổng của nó**, đó không còn giống đi lạc
mà giống hành vi cố tình dò để gian lận hạng vé.

Cách tính: đếm `distinct_wrong_gate_count` — số **cổng khác nhau** mà vé này từng bị quét
`WRONG_GATE`. Quét sai lặp lại ở cùng một cổng không cộng thêm, phải là cổng mới.

**Ngưỡng:** gọi `N` là tổng số cổng của sự kiện.

- `distinct_wrong_gate_count < N − 1` → **WARNING**, mã `WRONG_GATE_WARNING`,
  không tính vào fraud rate trên dashboard.
- `distinct_wrong_gate_count = N − 1` → **FRAUD**, mã `WRONG_GATE_FRAUD`.

Ngưỡng là `N − 1` chứ không phải `N`, vì quét ở đúng cổng của vé không sinh `WRONG_GATE`, nên
`distinct_wrong_gate_count` **không bao giờ đạt tới `N`**. Với sự kiện 4 cổng, ngưỡng FRAUD là 3.

### `WRONG_GATE_FRAUD` không làm đổi `ticket_status`

Vé bị gắn `WRONG_GATE_FRAUD` vẫn giữ nguyên `ticket_status = UNUSED`. Sau đó nếu mang đúng cổng ra
quét, vé vẫn được `VALID` và cho vào bình thường.

Đây là quyết định có chủ đích, không phải thiếu sót:

- `WRONG_GATE` đã từ chối cho vào ở mọi cổng sai. "Vé còn hiệu lực" ở đây chỉ có nghĩa là người đó
  vẫn vào được **đúng cổng của mình** — tức là đúng thứ vé của họ cho phép. Thử sai hết các cổng rồi
  quay về cổng đúng không mang lại lợi ích gian lận nào.
- Chi phí chặn nhầm rất cao. Khách cầm vé Gate C, đi lạc qua A, B, D rồi mới tới C là kịch bản
  thường gặp ở sự kiện đông người. Nếu tự động vô hiệu vé, khách mua vé thật bị chặn, và
  `FLAGGED_FRAUD` là trạng thái cuối nên không có đường khôi phục.

Vì vậy mức `FRAUD` ở đây mang nghĩa **đánh dấu để Event Supervisor xử lý tại chỗ**, không phải
tự động vô hiệu hoá vé. Không có transition `UNUSED → FLAGGED_FRAUD` trong `06_Ticket_Lifecycle.md`.
