# 04. MVP Scope & Flow Specification

Tài liệu này xác định phạm vi sản phẩm khả thi tối thiểu (MVP) và chuẩn hóa luồng xử lý nghiệp vụ end-to-end, đảm bảo tính khép kín từ khâu tiếp nhận dữ liệu đầu vào đến quyết định nghiệp vụ và hiển thị kết quả.

---

## 1. Phân loại phạm vi tính năng (Feature Scope Matrix)

| Chức năng bắt buộc (Must-Have for MVP) | Nếu còn thời gian (Nice-to-Have) | Không làm (Out of Scope) |
| :--- | :--- | :--- |
| **F01 (Scan Ingestion):** Tiếp nhận scan event từ thiết bị quét tại các cổng (Ticket ID, Gate ID, Scanner ID, Timestamp). | Cơ chế lưu đệm ngoại tuyến (Offline Buffering) trên thiết bị quét khi mạng chập chờn. | Cổng thanh toán trực tuyến và đặt mua vé của khán giả. |
| **F02 (Ticket Validation):** Kiểm tra mã vé tồn tại, đúng sự kiện, đúng cổng được chỉ định. | Phân quyền truy cập nâng cao (RBAC) cho từng cấp quản lý và nhân viên từng cổng. | Xác thực sinh trắc học hoặc nhận diện khuôn mặt tại cổng. |
| **F03 (Fraud Detection):** Phát hiện gian lận vé trùng lặp giữa các cổng trong khoảng thời gian ngắn (Double Scanning). | Gửi thông báo đẩy tức thời qua Telegram / Zalo / SMS cho lực lượng cơ động. | Ứng dụng di động cho khán giả lưu trữ ví vé điện tử. |
| **F04 (Entry Feedback):** Phản hồi trạng thái vé tức thì về máy quét (VALID / FRAUD / REJECT). | Phân tích cụm phát hiện bất thường (Anomaly Clustering) bằng mô hình học máy. | Hệ thống quản lý sơ đồ phân bổ ghế ngồi chi tiết 3D. |
| **F05 (Fraud Alerting):** Bắn tín hiệu cảnh báo gian lận trực tiếp lên giao diện giám sát trung tâm. | Xuất báo cáo thống kê chuyên sâu định dạng PDF / Excel có chữ ký số. | Tích hợp hệ thống cửa xoay tự động vật lý (Hardware Turnstile integration). |
| **F06 (Live Monitoring Dashboard):** Bảng hiển thị số lượt quét theo cổng, danh sách gian lận và tỷ lệ gian lận. | | |
| **F07 (Ticket & Event CRUD):** Quản trị danh mục sự kiện và danh sách mã vé (tạo mới, cập nhật, tra cứu). | | |

---

## 2. Sơ đồ luồng xử lý MVP (MVP Flow Diagram)

```
[Khán giả xuất trình vé tại cổng]
              │
              ▼
    [Ticket Scanner quét mã]
              │
              ▼ (Input Event: Ticket ID, Gate ID, Scanner ID, Timestamp)
   [Tiếp nhận lượt quét (Node.js API)]
              │
              ├────────────────────────────────────────┐
              ▼ (Lưu vết thô - Raw Events)             ▼ (Kiểm tra vé cơ bản)
      [Kho dữ liệu Audit]                   [Kiểm tra vé có tồn tại & hợp lệ?]
                                                       │
                                  ┌────────────────────┴────────────────────┐
                                  ▼ (Không hợp lệ / Sai cổng)               ▼ (Hợp lệ)
                        [Quyết định: REJECT]                      [Kiểm tra lịch sử các lần quét]
                                  │                                         │
                                  │                       ┌─────────────────┴─────────────────┐
                                  │                       ▼ (Trùng vé tại 2 cổng < 10s)       ▼ (Lần đầu quét)
                                  │             [Quyết định: FRAUD]                 [Quyết định: VALID]
                                  │                       │                                   │
                                  │             ┌─────────┴─────────┐                         │
                                  ▼             ▼                   ▼                         ▼
                    [Phản hồi từ chối về Scanner]  [Bắn Fraud Alert lên Dashboard]   [Phản hồi chấp thuận & Cho vào]
```

---

## 3. Đối soát tính nhất quán & Tiêu chuẩn nghiệm thu

1. **Tính hoàn chỉnh (End-to-End):**
   - **Điểm đầu (Input):** Thao tác quét vé của `Ticket Scanner` tại cổng vào, phát sinh dữ liệu gồm mã vé, cổng và mốc thời gian.
   - **Xử lý trung gian (Processing & Logic):** Kiểm tra tính hợp lệ cơ bản và đối chiếu dữ liệu các lượt quét gần nhất để đưa ra quyết định.
   - **Điểm cuối (Output):** Phản hồi tức thì về thiết bị soát vé tại cổng (`VALID` / `FRAUD` / `REJECT`), đồng thời hiển thị cảnh báo lên màn hình của `Event Supervisor`.

2. **Tính độc lập:**
   - Không có chức năng nào trong danh mục **Must-Have** bị phụ thuộc vào các tính năng ở cột **Nice-to-Have** hay **Out of Scope**.

3. **Nguồn gốc yêu cầu:**
   - Mọi chức năng triển khai đều ánh xạ trực tiếp từ bài toán thực tế đã nêu tại `01_Problem_Statement.md` và danh mục `03_Functions.md`.