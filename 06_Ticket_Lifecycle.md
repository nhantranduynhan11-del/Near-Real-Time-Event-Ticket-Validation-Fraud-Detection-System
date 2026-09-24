# 06 — Ticket Lifecycle (Phase 1 · 1.2)

Lưu ý quan trọng: **trạng thái ticket** (mục này) khác với **kết quả của một lần scan** (mục 1.3). Một lần scan trả về kết quả VALID/INVALID/FRAUD tức thời cho Ticket Scanner (F04) — đó không phải trạng thái lâu dài của ticket. Ticket chỉ có một trạng thái tại một thời điểm, là kết quả tổng hợp sau khi hệ thống xử lý các lần scan liên quan tới nó.

Actor tham chiếu trong tài liệu này theo đúng 02_Actors.md: **Ticket Scanner** (gây ra transition qua hành động quét), **Event Supervisor** (gây ra transition qua thao tác quản trị F08). Các bước xử lý nội bộ (validate, dedup, fraud rule) không phải actor, chỉ là hoạt động hệ thống dẫn tới transition.

## Quyết định nghiệp vụ chốt trước

**Vé đã dùng thành công có được dùng để vào lại không? → KHÔNG.** Hệ thống áp dụng chính sách single-entry: mỗi vé chỉ được ghi nhận vào hợp lệ một lần (khớp với F03 — "vé đã qua cổng nhưng được quét lại" là chính định nghĩa của gian lận trong 03_Functions.md). Bất kỳ lượt quét nào sau lần vào hợp lệ đầu tiên đều bị xử lý theo nhánh gian lận, không quay lại trạng thái đã vào hợp lệ.

## Danh sách trạng thái

| Trạng thái | Ý nghĩa |
|---|---|
| **UNUSED** | Vé hợp lệ, chưa từng được quét thành công lần nào |
| **VALID_ENTRY** | Vé đã được quét hợp lệ và cho vào ở một gate, tại một thời điểm xác định (kết quả F02 = VALID) |
| **FLAGGED_FRAUD** | Có lượt quét thứ hai (hoặc hơn) cho cùng vé sau khi đã ở VALID_ENTRY, được F03 xác nhận là gian lận |
| **EXPIRED** | Vé còn ở UNUSED nhưng sự kiện đã kết thúc mà chưa từng được quét |
| **CANCELLED** | Vé bị Event Supervisor thu hồi qua chức năng quản trị (F08) trước khi có lượt quét hợp lệ nào |

**Trạng thái đầu:** UNUSED — mọi vé nhập vào hệ thống (qua UC06 — Import Valid Ticket List) đều bắt đầu ở đây.

**Trạng thái cuối (final states):** VALID_ENTRY, FLAGGED_FRAUD, EXPIRED, CANCELLED — không trạng thái nào trong bốn trạng thái này có transition đi tiếp trong phạm vi hệ thống này.

## Bảng transition

| Từ | Đến | Hành động gây ra | Điều kiện |
|---|---|---|---|
| UNUSED | VALID_ENTRY | Ticket Scanner quét vé (UC01) | Vé hợp lệ, đúng sự kiện, còn hiệu lực, đây là lượt quét thành công đầu tiên (F01+F02) |
| UNUSED | EXPIRED | Hệ thống tự động đóng sự kiện | Sự kiện đã kết thúc, vé chưa từng được quét thành công |
| UNUSED | CANCELLED | Event Supervisor thu hồi vé (UC04) | Event Supervisor chủ động hủy vé (hoàn tiền, gian lận phát hiện trước sự kiện, v.v.) trước khi có lượt quét thành công |
| VALID_ENTRY | FLAGGED_FRAUD | Ticket Scanner quét lại cùng vé (UC01 → UC02) | Có lượt quét mới cho cùng Ticket ID sau khi đã ở VALID_ENTRY, và fraud rule (1.5) xác nhận điều kiện gian lận thỏa (F03), kéo theo cảnh báo tới Event Supervisor (F05) |

## Transition KHÔNG được phép

- **VALID_ENTRY → UNUSED**: vé đã vào hợp lệ không được đưa trở lại trạng thái chưa dùng.
- **VALID_ENTRY → VALID_ENTRY (lặp lại)**: không có "vào lần hai hợp lệ"; mọi lượt quét sau lần đầu đều dẫn tới FLAGGED_FRAUD, không giữ nguyên VALID_ENTRY.
- **FLAGGED_FRAUD → bất kỳ trạng thái nào khác**: một khi đã bị đánh dấu gian lận, ticket không quay lại được trạng thái hợp lệ trong phạm vi hệ thống này (xử lý ngoại lệ, nếu có, là quyết định của Event Supervisor ngoài hiện trường, nằm ngoài state machine).
- **EXPIRED → VALID_ENTRY** hoặc **CANCELLED → VALID_ENTRY**: vé đã hết hiệu lực hoặc đã bị hủy thì không thể quét vào được nữa; một lượt quét nhắm vào vé ở hai trạng thái này chỉ tạo ra kết quả scan INVALID (thuộc phạm vi 1.3), không làm đổi trạng thái ticket.

## Sơ đồ trạng thái (mô tả dạng text — chuyển sang state diagram ở bước vẽ hình)

```
                 ┌───────────┐
        ┌───────►│  EXPIRED  │ (final)
        │        └───────────┘
        │
┌───────────┐   Ticket Scanner quét, hợp lệ    ┌──────────────┐
│  UNUSED   ├───────────────────────────────────►│ VALID_ENTRY  │ (final)
└─────┬─────┘                                    └──────┬───────┘
      │                                                  │
      │ Event Supervisor thu hồi (F08)                   │ quét lại + fraud rule thỏa (F03)
      ▼                                                  ▼
┌───────────┐                                    ┌────────────────┐
│ CANCELLED │ (final)                            │ FLAGGED_FRAUD  │ (final)
└───────────┘                                    └────────────────┘
```

## Đối chiếu với 1.3 (Tập kết quả scan) và 1.5 (Fraud Rules)

- Mỗi transition trong bảng trên phải khớp với đúng một (hoặc một nhóm) kết quả scan sẽ được định nghĩa ở 1.3 — ví dụ transition UNUSED → VALID_ENTRY tương ứng kết quả scan "VALID" mà Ticket Scanner nhận được ở UC01.
- Điều kiện của transition VALID_ENTRY → FLAGGED_FRAUD không tự định nghĩa ở đây, mà tham chiếu tới fraud rules ở 1.5; tài liệu này chỉ chốt rằng đây là transition duy nhất dẫn tới FLAGGED_FRAUD.

## Đối chiếu với Actor & Use Case (0.2, 1.1)

- Không trạng thái nào chuyển do "System" hành động — mọi transition đều được gán cho một actor (Ticket Scanner, Event Supervisor) hoặc một sự kiện hệ thống khách quan (đóng sự kiện), đúng nguyên tắc "System không phải Actor" trong 02_Actors.md.
- UC01/UC02 tạo ra các transition xoay quanh VALID_ENTRY và FLAGGED_FRAUD; UC04 tạo ra transition tới CANCELLED — không có use case nào bị thiếu ánh xạ tới lifecycle này.
