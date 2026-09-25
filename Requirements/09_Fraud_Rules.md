# 09 — Fraud Rules (Phase 1 · 1.5)

## Tài liệu này khác gì file 07

`07_Scan_Results.md` trả lời: **lần quét này cho ra kết quả gì, có cho vào hay không.**

Tài liệu này trả lời: **vì sao kết quả đó bị coi là gian lận, cần những dữ liệu nào để kết luận,
và ngưỡng cụ thể là bao nhiêu.**

Hai file không lặp nhau. Ở đây không định nghĩa lại tập kết quả scan, không định nghĩa lại thứ tự
ưu tiên — những thứ đó chỉ có một nguồn duy nhất là 07.

Mỗi quy tắc dưới đây được viết theo dạng "nếu điều kiện thì kết luận", đủ chi tiết để người viết
chương trình dịch thẳng thành mã mà không phải tự đoán.

---

## Bảng tổng hợp

| Quy tắc | Tên | Kết quả scan | Mã cảnh báo | Mức cảnh báo |
|---|---|---|---|---|
| **R1** | Vé không dùng được cho sự kiện này | `INVALID` | `INVALID_QR` | FRAUD |
| **R2** | Vé đã bị thu hồi | `CANCELLED` | `REVOKED_TICKET` | FRAUD |
| **R3** | Vé đã vào rồi, bị quét lại | `USED` | `DUPLICATE_SCAN` | FRAUD |
| **R4** | Hai người dùng chung một vé | `USED` | `IMPOSSIBLE_TRAVEL` | FRAUD |

### Thứ tự kiểm tra

Bốn quy tắc gắn với ba kết quả scan khác nhau, nên phần lớn thời gian chúng không đụng nhau. Thứ tự
kiểm tra giữa các kết quả scan đã nằm ở 07.

Chỉ có **R3 và R4 cùng gắn với kết quả `USED`**, nên cần nói rõ: **kiểm tra R4 trước, R3 sau.**
R4 là trường hợp hẹp hơn và nghiêm trọng hơn. Nếu R4 thỏa thì dừng ở R4, không gắn thêm R3. Nếu R4
không thỏa thì mới rơi xuống R3.

Một lần quét chỉ sinh **đúng một mã cảnh báo**.

### Một ghi chú về trường hợp thử sai hết cổng

File 07 còn một mã cảnh báo mức gian lận nữa là `WRONG_GATE_FRAUD` — vé bị quét sai ở tất cả các
cổng không phải cổng của nó. Trường hợp này **không nằm trong bốn quy tắc trên** vì nó không chặn
vé, chỉ đánh dấu để người giám sát chú ý. Phần mô tả đầy đủ nằm ở cuối `07_Scan_Results.md`.

---

## R1 — Vé không dùng được cho sự kiện này

**Điều kiện.** Một trong ba trường hợp sau xảy ra:

1. Máy quét không đọc được mã QR thành mã vé (`decode_error = true`).
2. Đọc được mã vé, nhưng mã đó không có trong cơ sở dữ liệu.
3. Mã vé có trong cơ sở dữ liệu, nhưng thuộc **một sự kiện khác** với sự kiện đang diễn ra.

**Dữ liệu cần.** `decode_error`, `ticket_id`, và trường `event_id` của vé trong bảng vé để so với sự
kiện đang mở cổng.

**Kết quả.** Kết quả scan là `INVALID`. Không cho vào. Sinh cảnh báo `INVALID_QR` ở mức gian lận.
Không có trạng thái vé nào bị thay đổi.

**Vì sao coi là gian lận.** Ba trường hợp trên đều có nghĩa là thứ vừa quét không phải một tấm vé
hợp lệ của sự kiện này. Trường hợp 1 và 2 thường là mã QR tự chế hoặc ảnh chụp bị hỏng. Trường hợp 3
là vé thật nhưng của sự kiện khác — có thể do nhầm lẫn thật, cũng có thể là cố tình dùng vé cũ. Vì
không phân biệt được ngay tại cổng nên cả ba đều xử lý như nhau và để người giám sát quyết định.

**Vì sao gộp cả ba vào một kết quả.** Nhóm đã cân nhắc tách riêng trường hợp 3 thành một kết quả mới,
nhưng bản demo chỉ chạy một sự kiện nên việc tách không mang lại giá trị tương xứng với công sửa lại
tài liệu. Nếu sau này hệ thống chạy nhiều sự kiện cùng lúc thì nên tách.

---

## R2 — Vé đã bị thu hồi

**Điều kiện.** Mã vé có trong cơ sở dữ liệu và trạng thái vé đang là `CANCELLED`.

**Dữ liệu cần.** `ticket_id`, và trạng thái vé đọc từ cơ sở dữ liệu.

**Kết quả.** Kết quả scan là `CANCELLED`. Không cho vào. Sinh cảnh báo `REVOKED_TICKET` ở mức gian
lận. Trạng thái vé giữ nguyên `CANCELLED`.

**Vì sao coi là gian lận.** Vé ở trạng thái `CANCELLED` là vé đã được hoàn tiền hoặc bị ban tổ chức
thu hồi. Người cầm vé đó đã không còn quyền vào cửa, nên việc mang ra quét là hành vi cố ý.

Điểm này khác R1 ở chỗ vé **có thật và từng hợp lệ** — nên cảnh báo cần mang mã riêng để người giám
sát biết đây là vé đã hoàn tiền chứ không phải vé giả.

---

## R3 — Vé đã vào rồi, bị quét lại

**Điều kiện.** Mã vé có trong cơ sở dữ liệu, trạng thái vé đang là `VALID_ENTRY` hoặc
`FLAGGED_FRAUD`, và **điều kiện của R4 không thỏa**.

**Dữ liệu cần.** `ticket_id`, trạng thái vé, và thông tin lần quét hợp lệ trước đó
(`previous_scan_event_id`, `previous_scan_gate_id`) để đưa vào nội dung cảnh báo.

**Kết quả.** Kết quả scan là `USED`. Không cho vào. Sinh cảnh báo `DUPLICATE_SCAN` ở mức gian lận.
Nếu vé đang ở `VALID_ENTRY` thì chuyển sang `FLAGGED_FRAUD`; nếu đã ở `FLAGGED_FRAUD` thì giữ nguyên.

**Vì sao coi là gian lận.** Hệ thống áp dụng chính sách mỗi vé chỉ vào một lần
(`06_Ticket_Lifecycle.md`). Vé đã có lần vào hợp lệ mà còn xuất hiện lần nữa thì chỉ có hai khả năng:
ai đó đang dùng bản sao của vé, hoặc chính người đó đã ra rồi quay lại. Cả hai đều không được phép
theo chính sách đã chốt.

**Lưu ý về máy quét bấm nhầm hai lần.** Trường hợp cùng một máy quét gửi hai lần cho cùng một thao
tác đã được loại từ trước, bằng cách mỗi lần gọi mang một `event_id` riêng và bước xử lý loại bỏ bản
ghi trùng. R3 chỉ nói về hai thao tác quét thật sự khác nhau.

---

## R4 — Hai người dùng chung một vé

Đây là quy tắc trung tâm của đề tài, và cũng là quy tắc duy nhất có ngưỡng thời gian.

**Ý tưởng.** Nếu một vé vừa được quét ở cổng A, rồi vài giây sau lại xuất hiện ở cổng D cách đó
mấy trăm mét, thì không thể là cùng một người. Người thật không di chuyển nhanh như vậy. Vậy chắc
chắn có hai người đang dùng chung một mã vé.

**Điều kiện.** Cả bốn điều sau cùng đúng:

1. Trạng thái vé đang là `VALID_ENTRY` hoặc `FLAGGED_FRAUD` (tức là vé đã có lần quét trước).
2. Cổng của lần quét này **khác** cổng của lần quét hợp lệ trước đó.
3. Khoảng cách thời gian giữa hai lần quét **nhỏ hơn** thời gian đi bộ tối thiểu giữa hai cổng đó.
4. Có đủ dữ liệu để tính điều 3 (tìm được lần quét trước và tra được thời gian đi bộ).

**Dữ liệu cần.**

| Dữ liệu | Lấy từ đâu |
|---|---|
| `gate_id` | Lần quét hiện tại |
| `previous_scan_gate_id` | Lần quét hợp lệ trước đó của cùng vé |
| `time_since_previous_scan_ms` | Hiệu của hai mốc `received_at`, tính sẵn ở bước xử lý |
| `min_travel_time_ms` | Tra bảng thời gian đi bộ giữa hai cổng (xem mục dưới) |

**Kết quả.** Kết quả scan là `USED`. Không cho vào. Sinh cảnh báo `IMPOSSIBLE_TRAVEL` ở mức gian lận.
Trạng thái vé chuyển như R3.

**Vì sao coi là gian lận.** R3 đã đủ để chặn vé, nhưng R3 không phân biệt được hai tình huống rất
khác nhau: một người quay lại quét nhầm lần nữa, và hai người khác nhau cùng dùng một mã vé ở hai
đầu sân. R4 tách tình huống thứ hai ra, vì nó là bằng chứng chắc chắn về việc chia sẻ vé và cần
người giám sát tới tận nơi.

### Ngưỡng thời gian

| Hạng mục | Quy định |
|---|---|
| Đại lượng đo | Khoảng cách thời gian giữa hai lần quét, tính bằng mili giây |
| Mốc bắt đầu | `received_at` của lần quét hợp lệ trước đó |
| Mốc kết thúc | `received_at` của lần quét hiện tại |
| Ngưỡng | `min_travel_time_ms` — thời gian đi bộ tối thiểu giữa hai cổng, tra theo bảng |
| Toán tử so sánh | `<` (nhỏ hơn thật sự) |
| Khi nhỏ hơn ngưỡng | Quy tắc kích hoạt → `IMPOSSIBLE_TRAVEL` |
| Khi **đúng bằng** ngưỡng | Quy tắc **không** kích hoạt → rơi xuống R3 → `DUPLICATE_SCAN` |
| Khi lớn hơn ngưỡng | Quy tắc không kích hoạt → rơi xuống R3 → `DUPLICATE_SCAN` |

Chọn `<` chứ không phải `≤` vì `min_travel_time_ms` là thời gian của người đi nhanh nhất có thể.
Đi đúng bằng thời gian đó là chuyện khả thi, nên không được coi là bằng chứng gian lận.

Dùng `received_at` (giờ máy chủ) chứ không dùng `scanned_at` (giờ máy quét), vì đồng hồ các máy quét
có thể lệch nhau vài giây và sẽ tạo ra cảnh báo oan — xem `08_Scan_Event_Specification.md`.

### Bảng thời gian đi bộ giữa hai cổng

Mỗi cặp cổng có thời gian riêng, vì khoảng cách giữa các cổng không bằng nhau. Số liệu dưới đây là
giá trị mẫu cho sự kiện bốn cổng, tính theo người đi nhanh nhất:

| Cặp cổng | Thời gian tối thiểu |
|---|---|
| A ↔ B | 45 giây |
| A ↔ C | 90 giây |
| A ↔ D | 140 giây |
| B ↔ C | 60 giây |
| B ↔ D | 100 giây |
| C ↔ D | 50 giây |

Quy ước:

- Thời gian **đối xứng**: đi từ A sang D và từ D sang A dùng chung một giá trị.
- Bảng này sẽ thành một bảng trong cơ sở dữ liệu ở giai đoạn thiết kế dữ liệu, gồm ba cột: cổng đi,
  cổng đến, thời gian tối thiểu tính bằng giây. Ghi cả hai chiều để truy vấn đơn giản.
- Số liệu là **cấu hình theo từng sự kiện**, không viết cứng trong mã. Sự kiện khác có sơ đồ cổng
  khác thì nạp bảng khác.
- Nếu không tra được giá trị cho một cặp cổng (dữ liệu thiếu), R4 **không kích hoạt** và lần quét đó
  rơi xuống R3. Thà bỏ sót một cảnh báo còn hơn báo nhầm vì dữ liệu cấu hình chưa đầy đủ.

### Vì sao dùng bảng theo cặp cổng thay vì một con số chung

Một con số chung cho mọi cặp cổng sẽ sai ở cả hai đầu. Nếu chọn số lớn, hai cổng sát nhau sẽ liên
tục báo nhầm khi khách đi vòng qua. Nếu chọn số nhỏ, hai cổng xa nhau sẽ bỏ lọt trường hợp gian lận
thật. Bảng theo cặp cổng phản ánh đúng sơ đồ mặt bằng của sự kiện.

Cái giá phải trả là thêm một bảng trong cơ sở dữ liệu và phải đo hoặc ước lượng số liệu cho từng
cặp cổng. Với bốn cổng thì chỉ có sáu cặp, không đáng kể.

---

## Ánh xạ sang các tài liệu khác

| Nội dung | Nguồn chuẩn |
|---|---|
| Tập kết quả scan, thứ tự ưu tiên | `07_Scan_Results.md` |
| Tập trạng thái vé, quy tắc chuyển trạng thái | `06_Ticket_Lifecycle.md` |
| Tên và kiểu dữ liệu của các trường | `08_Scan_Event_Specification.md` |
| Kịch bản tương tác tại cổng | `05_Use_Cases.md` |
| Các ca kiểm thử cho bốn quy tắc | `10_Test_Cases.md` |
