# 10 — Test Cases (Phase 1 · 1.6)

## Phạm vi

Tám ca dưới đây **chỉ kiểm tra bốn quy tắc gian lận** ở `09_Fraud_Rules.md`. Đây không phải bộ kiểm
thử cho toàn hệ thống.

Mỗi quy tắc có hai ca:

- **Ca bắt được** — tình huống được dựng để thỏa đúng điều kiện của quy tắc.
- **Ca không báo nhầm** — tình huống **gần sát** điều kiện đó nhưng thiếu một yếu tố, nên quy tắc
  phải đứng yên.

Ca không báo nhầm cố tình dựng sát ranh giới chứ không lấy một tình huống hoàn toàn khác. Lấy một
tình huống không liên quan thì ca kiểm thử luôn đúng mà không chứng minh được gì.

---

## Dữ liệu mẫu bắt buộc

Tám ca dưới đây dùng đúng bộ dữ liệu này. Bộ dữ liệu phải được đưa vào tệp nạp dữ liệu mẫu ở giai
đoạn thiết kế dữ liệu, nếu không các ca kiểm thử sẽ không chạy lại được.

**Sự kiện**

| Mã sự kiện | Tên | Giờ nhận khách |
|---|---|---|
| `EV001` | Concert Demo | 18:00:00 – 20:00:00 |
| `EV002` | Sự kiện khác | 18:00:00 – 22:00:00 |

**Cổng của EV001**

`GATE_A`, `GATE_B`, `GATE_C`, `GATE_D`

**Máy quét**

| Mã máy quét | Đặt tại cổng |
|---|---|
| `SC_A1` | `GATE_A` |
| `SC_B1` | `GATE_B` |
| `SC_C1` | `GATE_C` |
| `SC_D1` | `GATE_D` |

**Thời gian đi bộ tối thiểu giữa các cổng** (đối xứng, tính bằng giây)

| Cặp cổng | A | B | C | D |
|---|---|---|---|---|
| **A** | — | 45 | 90 | 140 |
| **B** | 45 | — | 60 | 100 |
| **C** | 90 | 60 | — | 50 |
| **D** | 140 | 100 | 50 | — |

**Vé**

| Mã vé | Sự kiện | Cổng được gán | Trạng thái ban đầu |
|---|---|---|---|
| `TK001` | `EV001` | `GATE_A` | `UNUSED` |
| `TK002` | `EV001` | `GATE_B` | `UNUSED` |
| `TK003` | `EV001` | `GATE_C` | `CANCELLED` |
| `TK004` | `EV001` | `GATE_B` | `UNUSED` |
| `TK005` | `EV002` | cổng của `EV002` | `UNUSED` |
| `TK006` | `EV001` | `GATE_A` | `UNUSED` |
| `TK007` | `EV001` | `GATE_C` | `UNUSED` |

**Quy ước chung**

- Mọi mốc giờ đều thuộc cùng một ngày và cùng một múi giờ, viết cho dễ đọc. Hệ thống lưu theo giờ
  chuẩn quốc tế.
- Mốc giờ trong cột đầu vào là `received_at` — giờ máy chủ nhận được lượt quét, theo quy định ở
  `09_Fraud_Rules.md`.
- **Trước mỗi ca, nạp lại dữ liệu mẫu về trạng thái ban đầu.** Các ca không nối tiếp nhau.
- Cột Kết quả thực tế và Đạt/Không để trống ở bước thiết kế, điền sau khi chạy.

---

## Bảng tổng hợp

| Mã ca | Quy tắc | Tình huống | Kết quả scan mong đợi | Mã cảnh báo mong đợi | Kết quả thực tế | Đạt/Không |
|---|---|---|---|---|---|---|
| TC01 | R1 | Vé thật nhưng thuộc sự kiện khác | `INVALID` | `INVALID_QR` | | |
| TC02 | R1 | Vé đúng sự kiện, quét ngay sau một vé bị từ chối | `VALID` | không có | | |
| TC03 | R2 | Vé đã bị thu hồi | `CANCELLED` | `REVOKED_TICKET` | | |
| TC04 | R2 | Vé cùng đợt phát hành nhưng chưa bị thu hồi | `VALID` | không có | | |
| TC05 | R3 | Vé đã vào, quét lại ở cùng cổng sau 30 phút | `USED` | `DUPLICATE_SCAN` | | |
| TC06 | R3 | Vé khác quét ở cùng cổng, cách 2 giây | `VALID` | không có | | |
| TC07 | R4 | Cùng vé, hai cổng xa nhau, cách 3 giây | `USED` | `IMPOSSIBLE_TRAVEL` | | |
| TC08 | R4 | Cùng vé, hai cổng xa nhau, cách **đúng bằng** ngưỡng | `USED` | `DUPLICATE_SCAN` | | |

---

## TC01 — R1 bắt được: vé thuộc sự kiện khác

| | |
|---|---|
| **Quy tắc kiểm tra** | R1 — Vé không dùng được cho sự kiện này |
| **Điều kiện ban đầu** | Sự kiện đang mở cổng là `EV001`. Vé `TK005` tồn tại trong cơ sở dữ liệu, thuộc `EV002`, trạng thái `UNUSED`. |

**Các bước**

1. Tại `GATE_A`, dùng máy quét `SC_A1` quét vé `TK005`.
2. Lượt quét đến máy chủ lúc `19:05:00`.

**Kết quả mong đợi**

- Kết quả scan: `INVALID`
- Mức cảnh báo: FRAUD, mã `INVALID_QR`
- Không cho vào cổng
- Trạng thái `TK005` giữ nguyên `UNUSED`

**Ca này chứng minh điều gì.** Vé có thật, mã QR đọc được bình thường, nhưng thuộc sự kiện khác.
Nếu hệ thống chỉ kiểm tra "mã vé có tồn tại không" mà quên so sự kiện thì ca này sẽ cho ra `VALID`
và người cầm vé sự kiện khác sẽ vào được.

---

## TC02 — R1 không báo nhầm: vé hợp lệ quét ngay sau một vé bị từ chối

| | |
|---|---|
| **Quy tắc kiểm tra** | R1 |
| **Điều kiện ban đầu** | Giống TC01. Vừa có một lượt quét bị từ chối trên cùng máy quét. |

**Các bước**

1. Tại `GATE_A`, máy quét `SC_A1` quét vé `TK005` lúc `19:05:00` — bị từ chối như TC01.
2. Cũng tại `GATE_A`, cũng máy quét `SC_A1`, quét vé `TK006` lúc `19:05:02`.

**Kết quả mong đợi** (cho bước 2)

- Kết quả scan: `VALID`
- Mức cảnh báo: NONE, không có mã cảnh báo
- Cho vào cổng
- Trạng thái `TK006` chuyển từ `UNUSED` sang `VALID_ENTRY`

**Ca này chứng minh điều gì.** Việc từ chối một vé không làm ảnh hưởng vé quét ngay sau đó trên cùng
máy quét. Đây là lỗi hay gặp khi chương trình giữ lại trạng thái của lượt quét trước.

---

## TC03 — R2 bắt được: vé đã bị thu hồi

| | |
|---|---|
| **Quy tắc kiểm tra** | R2 — Vé đã bị thu hồi |
| **Điều kiện ban đầu** | Vé `TK003` thuộc `EV001`, được gán `GATE_C`, trạng thái `CANCELLED`. |

**Các bước**

1. Tại `GATE_C`, dùng máy quét `SC_C1` quét vé `TK003`.
2. Lượt quét đến máy chủ lúc `19:15:00`.

**Kết quả mong đợi**

- Kết quả scan: `CANCELLED`
- Mức cảnh báo: FRAUD, mã `REVOKED_TICKET`
- Không cho vào cổng
- Trạng thái `TK003` giữ nguyên `CANCELLED`

**Ca này chứng minh điều gì.** Vé đúng sự kiện, đúng cổng, đúng giờ — mọi thứ hợp lệ trừ việc nó đã
bị thu hồi. Nếu bước kiểm tra trạng thái bị bỏ qua thì vé đã hoàn tiền vẫn vào được.

---

## TC04 — R2 không báo nhầm: vé cùng đợt nhưng chưa bị thu hồi

| | |
|---|---|
| **Quy tắc kiểm tra** | R2 |
| **Điều kiện ban đầu** | Vé `TK007` thuộc `EV001`, gán `GATE_C`, trạng thái `UNUSED`. Cùng cổng và cùng đợt phát hành với `TK003` đã bị thu hồi. |

**Các bước**

1. Tại `GATE_C`, dùng máy quét `SC_C1` quét vé `TK007`.
2. Lượt quét đến máy chủ lúc `19:15:03`, ngay sau lượt quét bị từ chối ở TC03.

**Kết quả mong đợi**

- Kết quả scan: `VALID`
- Mức cảnh báo: NONE
- Cho vào cổng
- Trạng thái `TK007` chuyển từ `UNUSED` sang `VALID_ENTRY`

**Ca này chứng minh điều gì.** Thu hồi một vé không kéo theo vé khác cùng cổng, cùng đợt. Nếu truy
vấn kiểm tra trạng thái viết sai điều kiện lọc, cả nhóm vé sẽ bị chặn oan.

---

## TC05 — R3 bắt được: vé đã vào, quét lại ở cùng cổng

| | |
|---|---|
| **Quy tắc kiểm tra** | R3 — Vé đã vào rồi, bị quét lại |
| **Điều kiện ban đầu** | Vé `TK002` đã được quét hợp lệ tại `GATE_B` lúc `19:10:00`, trạng thái hiện tại là `VALID_ENTRY`. |

**Các bước**

1. Tại `GATE_B`, dùng máy quét `SC_B1` quét lại vé `TK002`.
2. Lượt quét đến máy chủ lúc `19:40:00` — cách lần trước 1800 giây.

**Kết quả mong đợi**

- Kết quả scan: `USED`
- Mức cảnh báo: FRAUD, mã `DUPLICATE_SCAN`
- Không cho vào cổng
- Trạng thái `TK002` chuyển từ `VALID_ENTRY` sang `FLAGGED_FRAUD`

**Ca này chứng minh điều gì.** Hai lượt quét ở **cùng một cổng** nên điều kiện thứ hai của R4 (cổng
phải khác nhau) không thỏa. R4 đứng yên, R3 xử lý. Mã cảnh báo phải là `DUPLICATE_SCAN`, không được
là `IMPOSSIBLE_TRAVEL`.

---

## TC06 — R3 không báo nhầm: vé khác quét ở cùng cổng, cách 2 giây

| | |
|---|---|
| **Quy tắc kiểm tra** | R3 |
| **Điều kiện ban đầu** | Vé `TK002` vừa được quét hợp lệ tại `GATE_B` lúc `19:10:00`. Vé `TK004` thuộc `EV001`, gán `GATE_B`, trạng thái `UNUSED`. |

**Các bước**

1. Tại `GATE_B`, dùng máy quét `SC_B1` quét vé `TK004`.
2. Lượt quét đến máy chủ lúc `19:10:02` — chỉ 2 giây sau lượt quét của `TK002`.

**Kết quả mong đợi**

- Kết quả scan: `VALID`
- Mức cảnh báo: NONE
- Cho vào cổng
- Trạng thái `TK004` chuyển từ `UNUSED` sang `VALID_ENTRY`

**Ca này chứng minh điều gì.** Cùng cổng, cùng máy quét, cách nhau 2 giây — mọi thứ đều giống một
lượt quét trùng, chỉ khác mã vé. Nếu chương trình kiểm tra trùng lặp theo cổng và thời gian thay vì
theo mã vé thì ca này sẽ bị báo nhầm, và hàng người vào cửa sẽ liên tục bị chặn.

---

## TC07 — R4 bắt được: cùng vé, hai cổng xa nhau, cách 3 giây

| | |
|---|---|
| **Quy tắc kiểm tra** | R4 — Hai người dùng chung một vé |
| **Điều kiện ban đầu** | Vé `TK001` đã được quét hợp lệ tại `GATE_A` lúc `19:00:01`, trạng thái hiện tại là `VALID_ENTRY`. Thời gian đi bộ tối thiểu `GATE_A` ↔ `GATE_D` là 140 giây. |

**Các bước**

1. Tại `GATE_D`, dùng máy quét `SC_D1` quét vé `TK001`.
2. Lượt quét đến máy chủ lúc `19:00:04`.

**Tính toán**

- Khoảng cách thời gian: `19:00:04` − `19:00:01` = **3 giây**
- Ngưỡng: **140 giây**
- So sánh: 3 < 140 → điều kiện thứ ba của R4 thỏa

**Kết quả mong đợi**

- Kết quả scan: `USED`
- Mức cảnh báo: FRAUD, mã `IMPOSSIBLE_TRAVEL`
- Không cho vào cổng
- Trạng thái `TK001` chuyển từ `VALID_ENTRY` sang `FLAGGED_FRAUD`
- Nội dung cảnh báo có cổng lần trước (`GATE_A`) và khoảng cách thời gian (3 giây)

**Ca này chứng minh điều gì.** Đây chính là kịch bản trong phần đặt vấn đề của đề tài: một người quét
vé hợp lệ, vài giây sau người khác dùng ảnh chụp cùng mã vé ở cổng khác. Không ai đi từ cổng A sang
cổng D trong 3 giây, nên chắc chắn là hai người.

---

## TC08 — R4 không báo nhầm: cách đúng bằng ngưỡng

| | |
|---|---|
| **Quy tắc kiểm tra** | R4 |
| **Điều kiện ban đầu** | Giống TC07. Vé `TK001` đã `VALID_ENTRY` tại `GATE_A` lúc `19:00:01`. Ngưỡng `GATE_A` ↔ `GATE_D` là 140 giây. |

**Các bước**

1. Tại `GATE_D`, dùng máy quét `SC_D1` quét vé `TK001`.
2. Lượt quét đến máy chủ lúc `19:02:21`.

**Tính toán**

- Khoảng cách thời gian: `19:02:21` − `19:00:01` = **140 giây**
- Ngưỡng: **140 giây**
- So sánh: 140 < 140 là **sai** → điều kiện thứ ba của R4 không thỏa → R4 đứng yên → rơi xuống R3

**Kết quả mong đợi**

- Kết quả scan: `USED`
- Mức cảnh báo: FRAUD, mã **`DUPLICATE_SCAN`** — không phải `IMPOSSIBLE_TRAVEL`
- Không cho vào cổng
- Trạng thái `TK001` chuyển từ `VALID_ENTRY` sang `FLAGGED_FRAUD`

**Ca này chứng minh điều gì.** Đây là ca quan trọng nhất trong tám ca, vì nó chạm đúng ranh giới của
ngưỡng.

Lưu ý cách đọc kết quả: **"không báo nhầm" ở đây không có nghĩa là cho vé qua.** Vé vẫn bị chặn và
vẫn bị coi là gian lận, vì nó đã vào rồi. Thứ đang kiểm tra là **mã cảnh báo**: hệ thống phải phân
biệt được "vé bị dùng lại" với "chắc chắn có hai người dùng chung vé", và không được gắn nhãn nặng
hơn khi chưa đủ bằng chứng.

Nếu chương trình viết nhầm dấu so sánh thành `≤` thay vì `<`, ca này sẽ cho ra `IMPOSSIBLE_TRAVEL`
và không đạt. Đó chính là lỗi mà ca này được dựng ra để bắt.

---

## Bảng đối chiếu độ phủ

| Quy tắc | Ca bắt được | Ca không báo nhầm | Yếu tố bị thiếu ở ca không báo nhầm |
|---|---|---|---|
| R1 | TC01 | TC02 | Vé đúng sự kiện |
| R2 | TC03 | TC04 | Vé chưa bị thu hồi |
| R3 | TC05 | TC06 | Khác mã vé |
| R4 | TC07 | TC08 | Khoảng cách thời gian không nhỏ hơn ngưỡng |

Đủ bốn quy tắc, mỗi quy tắc một ca kích hoạt và một ca không kích hoạt.
