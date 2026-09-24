# 05 — Use Cases (Phase 1 · 1.1)

Actor dùng trong tài liệu này lấy đúng theo **02_Actors.md**: **Ticket Scanner**, **Event Supervisor**, **Ticketing Partner** (external, tùy chọn). Theo quy ước tại mục 3 của 02_Actors.md, **"System" không được biểu diễn như Actor** — mọi xử lý ngầm (validate, dedup, fraud rule, ghi dữ liệu) là hoạt động nội bộ, xuất hiện trong main flow như hành động của hệ thống chứ không phải actor riêng.

6 use case dưới đây bao phủ đủ 8 function F01–F08 của 03_Functions.md, không phát sinh chức năng mới.

---

## UC01 — Scan Ticket at Gate (Quét vé tại cổng)

| | |
|---|---|
| **Actor** | Ticket Scanner |
| **Function liên quan** | F01 (Scan Ingestion), F02 (Ticket Validation), F04 (Entry Feedback) |
| **Precondition** | Ticket Scanner đã được gán vào một gate cụ thể (Gate A/B/C/D); thiết bị quét kết nối ổn định tới hệ thống |

**Main flow**
1. Ticket Scanner quét mã QR trên vé của khách tại gate được phân công.
2. Hệ thống tiếp nhận lượt soát vé: mã vé, cổng, mã máy quét, thời điểm quét (F01).
3. Hệ thống xác thực tính hợp lệ cơ bản: vé tồn tại, đúng định dạng, đúng sự kiện, đúng cổng (F02).
4. Hệ thống kiểm tra vé chưa từng được ghi nhận vào hợp lệ trước đó.
5. Hệ thống trả kết quả VALID về thiết bị của Ticket Scanner (F04); Ticket Scanner cho khách vào cổng.

**Exception flow**
- Mã vé không tồn tại / sai định dạng / sai sự kiện / sai cổng → hệ thống trả kết quả INVALID kèm lý do; Ticket Scanner từ chối cho vào.
- Vé đã từng được ghi nhận vào hợp lệ trước đó (bị quét lại) → chuyển sang **UC02** để xử lý gian lận; Ticket Scanner nhận kết quả FRAUD từ hệ thống và từ chối cho vào.

**Postcondition** — Một kết quả soát vé (VALID/INVALID) được ghi nhận; ticket chuyển sang trạng thái VALID_ENTRY nếu kết quả là VALID.

---

## UC02 — Receive Fraud Alert (Nhận cảnh báo gian lận)

| | |
|---|---|
| **Actor** | Event Supervisor |
| **Function liên quan** | F03 (Fraud Detection), F05 (Fraud Alerting) |
| **Precondition** | Event Supervisor đã đăng nhập dashboard giám sát trung tâm; hệ thống đang xử lý các lượt quét trực tiếp |

**Main flow**
1. Trong lúc xử lý một lượt quét ở UC01, hệ thống tự động phát hiện mẫu hành vi vi phạm: vé đã qua cổng nhưng bị quét lại, hoặc cùng một vé xuất hiện ở hai cổng khác nhau trong khoảng thời gian phi thực tế (F03).
2. Hệ thống sinh cảnh báo kèm chi tiết vi phạm: vé nào, cổng hiện tại, cổng lần vào trước, lệch nhau bao lâu.
3. Hệ thống bắn cảnh báo lên dashboard giám sát trung tâm gần như ngay lập tức (F05).
4. Event Supervisor nhận cảnh báo, xem chi tiết vi phạm.
5. Event Supervisor điều phối xử lý tại hiện trường (nằm ngoài phạm vi hệ thống).

**Exception flow**
- Nghi vấn trùng lặp do lỗi kỹ thuật (cùng gate, cách nhau cực ngắn do gửi trùng event) → không tính là gian lận thật, bị loại theo điều kiện của fraud rule tương ứng (1.5), không sinh cảnh báo.

**Postcondition** — Cảnh báo gian lận xuất hiện trên dashboard trong vòng vài giây kể từ lượt quét vi phạm; ticket chuyển sang trạng thái FLAGGED_FRAUD.

---

## UC03 — Monitor Live Dashboard (Giám sát trực tiếp)

| | |
|---|---|
| **Actor** | Event Supervisor |
| **Function liên quan** | F07 (Live Monitoring Dashboard) |
| **Precondition** | Event Supervisor đã đăng nhập; dashboard kết nối được tới dữ liệu đã xử lý |

**Main flow**
1. Event Supervisor mở dashboard giám sát trong lúc sự kiện diễn ra.
2. Dashboard hiển thị theo thời gian thực: tổng số lượt quét, lưu lượng vào theo từng cổng, tỷ lệ gian lận, danh sách cảnh báo mới nhất.
3. Event Supervisor theo dõi liên tục để nắm tình hình vận hành các cổng.

**Exception flow**
- Mất kết nối giữa dashboard và nguồn dữ liệu → dashboard hiển thị trạng thái "mất kết nối", giữ lại số liệu gần nhất đã tải.

**Postcondition** — Event Supervisor có bức tranh tổng thể, cập nhật liên tục về tình trạng soát vé toàn hệ thống.

---

## UC04 — Manage Ticket & Event Data (Quản lý dữ liệu sự kiện và vé)

| | |
|---|---|
| **Actor** | Event Supervisor |
| **Function liên quan** | F08 (Ticket & Event CRUD) |
| **Precondition** | Event Supervisor đã đăng nhập với quyền quản trị |

**Main flow**
1. Event Supervisor chọn thao tác: tạo mới, cập nhật, tra cứu hoặc xóa dữ liệu sự kiện / loại vé / vé phát hành.
2. Hệ thống hiển thị form hoặc kết quả tương ứng.
3. Event Supervisor xác nhận thao tác.
4. Hệ thống cập nhật dữ liệu và phản hồi kết quả.

**Exception flow**
- Dữ liệu nhập không hợp lệ (thiếu trường bắt buộc, trùng ID) → hệ thống từ chối lưu, báo lỗi cụ thể.
- Xóa dữ liệu đang được tham chiếu (VD: sự kiện đã có vé phát hành) → hệ thống cảnh báo và yêu cầu xác nhận, hoặc từ chối xóa.

**Postcondition** — Dữ liệu sự kiện/vé trong hệ thống được cập nhật đúng theo thao tác của Event Supervisor.

---

## UC05 — Review Audit Log (Đối soát và kiểm toán)

| | |
|---|---|
| **Actor** | Event Supervisor |
| **Function liên quan** | F06 (Event Audit Logging) |
| **Precondition** | Đã có dữ liệu lượt quét thô và lịch sử quyết định soát vé được ghi nhận |

**Main flow**
1. Event Supervisor chọn vé hoặc khoảng thời gian cần đối soát/điều tra.
2. Hệ thống truy vấn toàn bộ lượt quét thô và các quyết định soát vé liên quan.
3. Hệ thống hiển thị danh sách theo trình tự thời gian.
4. Event Supervisor đối chiếu để xác minh sự cố hoặc phục vụ kiểm toán sau sự kiện.

**Exception flow**
- Không tìm thấy dữ liệu cho khoảng thời gian/vé được chọn → hệ thống báo "không có dữ liệu".

**Postcondition** — Event Supervisor có đầy đủ căn cứ để tái hiện sự cố hoặc hoàn tất kiểm toán sau sự kiện.

---

## UC06 — Import Valid Ticket List (Nhập danh sách vé hợp lệ)

| | |
|---|---|
| **Actor** | Ticketing Partner *(tùy chọn, theo 02_Actors.md)* |
| **Function liên quan** | Hỗ trợ F02 — nguồn dữ liệu đối chiếu tính hợp lệ của vé |
| **Precondition** | Ticketing Partner đã hoàn tất phát hành và thanh toán vé cho sự kiện |

**Main flow**
1. Ticketing Partner gửi danh sách vé đã phát hành và thanh toán vào hệ thống, qua tập tin dữ liệu hoặc API nhập liệu, trước thời điểm sự kiện diễn ra.
2. Hệ thống tiếp nhận và lưu danh sách vé hợp lệ làm cơ sở đối chiếu cho F02.
3. Hệ thống xác nhận đã nhập thành công.

**Exception flow**
- Dữ liệu gửi lên sai định dạng hoặc thiếu trường bắt buộc → hệ thống từ chối, trả lỗi định dạng cho Ticketing Partner.
- Vé trùng ID với vé đã có trong hệ thống → hệ thống từ chối bản ghi trùng, báo danh sách bị từ chối.

**Postcondition** — Danh sách vé hợp lệ sẵn sàng trong hệ thống trước khi sự kiện diễn ra, làm căn cứ cho mọi lượt soát vé sau đó.

---

### Đối chiếu với Function List (0.3)

| Use Case | Function bao phủ |
|---|---|
| UC01 — Scan Ticket at Gate | F01, F02, F04 |
| UC02 — Receive Fraud Alert | F03, F05 |
| UC03 — Monitor Live Dashboard | F07 |
| UC04 — Manage Ticket & Event Data | F08 |
| UC05 — Review Audit Log | F06 |
| UC06 — Import Valid Ticket List | Hỗ trợ F02 (nguồn dữ liệu, actor ngoại vi) |

Đủ F01–F08, không có function nào bị bỏ sót và không phát sinh function mới ngoài 03_Functions.md.

### Đối chiếu với Actor List (0.2)

- Không use case nào dùng "System" làm actor — đúng quy ước tại mục 3 của 02_Actors.md.
- Ticket Scanner chỉ xuất hiện ở UC01 — đúng vai trò "thao tác quét mã, nhận phản hồi tức thì" đã định nghĩa.
- Event Supervisor xuất hiện ở UC02–UC05 — đúng vai trò "giám sát, nhận cảnh báo, quản trị dữ liệu" đã định nghĩa.
- Ticketing Partner chỉ xuất hiện ở UC06, đánh dấu rõ là actor tùy chọn.
