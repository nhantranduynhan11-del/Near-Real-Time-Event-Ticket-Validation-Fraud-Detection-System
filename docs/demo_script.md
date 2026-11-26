# KỊCH BẢN DEMO HỆ THỐNG KIỂM SOÁT VÉ VÀ PHÁT HIỆN GIAN LẬN

**Thời lượng:** 15 phút, không bao gồm thời gian chuẩn bị.

**Môi trường:** Ubuntu WSL, Docker Compose, SQL Server, Kafka,
Spark Streaming và Node.js REST API.

---

## 1. Mục tiêu demo

- Minh họa quy trình kiểm soát vé từ giao diện đến cơ sở dữ liệu.
- Chứng minh khả năng phát hiện các trường hợp gian lận.
- Minh họa kiến trúc Kafka, Bronze, Silver và Gold.
- Chứng minh Dashboard cập nhật dữ liệu gần thời gian thực.
- Minh họa các cơ chế bảo mật HMAC, JWT, RBAC và bcrypt.
- Chứng minh nguyên tắc Least Privilege trong SQL Server.

---

## 2. Chuẩn bị trước khi báo cáo

### 2.1. Khởi động hệ thống

```bash
cd ~/ticket-control

./scripts/up.sh full
```

Kiểm tra các container:

```bash
docker compose \
  -f docker/docker-compose.yml \
  --env-file docker/.env \
  --profile full \
  ps -a
```

Kiểm tra API:

```bash
curl -s http://localhost:3000/api/health \
  | python3 -m json.tool
```

Kiểm tra Spark:

```bash
pgrep -af 'stream_scan_events.py|bronze_scan_events.py'

tail -n 30 logs/spark.log
```

Điều kiện sẵn sàng:

- SQL Server và Kafka hoạt động.
- db-init kết thúc thành công.
- API trả status = ok.
- Database và Kafka đều có status = ok.
- Spark Bronze và Silver đang chạy.
- Spark sử dụng tài khoản spark_user.

### 2.2. Chuẩn bị dữ liệu sạch

Chỉ thực hiện trên môi trường demo đã được phép xóa dữ liệu.

Nếu cần giữ lại dữ liệu hiện tại, sao lưu trước:

```bash
bash scripts/backup_db.sh \
  "ticket_system_before_demo_$(date +%Y%m%d_%H%M%S).bak"
```

Reset dữ liệu:

```bash
./scripts/reset.sh -y
```

Lưu ý: reset sẽ dừng Spark, xóa lịch sử quét,
cảnh báo, Bronze, checkpoint và bản tin Kafka.

Khởi động lại pipeline:

```bash
./scripts/up.sh full
```

Đưa khung giờ nhận khách về hiện tại:

```bash
./scripts/dev_event_window.sh now
```

Kiểm tra lại health và Spark trước khi bắt đầu.

Không reset trong khi đang trình bày Dashboard
hoặc khi cần giữ lại dữ liệu minh chứng.

### 2.3. Chuẩn bị tài khoản

| Tài khoản demo | Vai trò |
|---|---|
| op_gate_a | GATE_OPERATOR |
| supervisor | EVENT_SUPERVISOR |

Mật khẩu tài khoản demo: `Demo@123`.

Đây là thông tin đăng nhập mẫu, không phải mật khẩu production.

### 2.4. Chuẩn bị vé

| Vé | Mục đích sử dụng |
|---|---|
| TK001 | Quét hợp lệ và quét lại |
| TK006 | Dùng chung vé tại hai cổng |
| TK005 | Vé thuộc sự kiện khác |
| TK007 | Quét sai cổng |
| TK002 | Kiểm thử QR sai chữ ký |
| TK003 | Vé đã thu hồi, kiểm thử dự phòng |
| TK004 | Vé dự phòng |

Kiểm tra trạng thái vé sau khi reset.
Không tiếp tục nếu vé dành cho lượt quét đầu tiên
không còn ở trạng thái UNUSED.

### 2.5. Chuẩn bị màn hình

- Trình duyệt thứ nhất: giao diện GATE_OPERATOR.
- Trình duyệt thứ hai hoặc cửa sổ ẩn danh: EVENT_SUPERVISOR.
- Terminal thứ nhất: thực hiện các lệnh demo.
- Terminal thứ hai: theo dõi log Spark.

```bash
tail -f logs/spark.log
```

Mở Dashboard trước khi bắt đầu các lượt quét.
Không refresh Dashboard trong quá trình chứng minh polling.

---

## 3. Phân bổ thời gian

| Thời gian | Nội dung |
|---|---|
| 00:00 - 01:30 | Giới thiệu kiến trúc và trạng thái hệ thống |
| 01:30 - 03:00 | Đăng nhập và quét vé hợp lệ |
| 03:00 - 04:30 | Quét lại vé và thông tin lượt quét trước |
| 04:30 - 06:00 | Phát hiện dùng chung vé |
| 06:00 - 08:00 | QR giả, vé sai sự kiện và sai cổng |
| 08:00 - 10:00 | Dashboard Live và tầng Gold |
| 10:00 - 11:00 | Quản trị vé |
| 11:00 - 12:30 | Phân quyền database |
| 12:30 - 14:00 | JWT, RBAC, HMAC và bcrypt |
| 14:00 - 15:00 | Tổng kết |

---

## 4. D1 - Giới thiệu kiến trúc hệ thống

**Thời gian:** 00:00 - 01:30.

### Thao tác

Hiển thị sơ đồ kiến trúc của nhóm.

Kiểm tra health:

```bash
curl -s http://localhost:3000/api/health \
  | python3 -m json.tool
```

### Lời thuyết trình

"Hệ thống được xây dựng nhằm kiểm soát vé tại các cổng
của sự kiện và phát hiện những hành vi gian lận.

Khi nhân viên quét vé, REST API xác thực người dùng,
kiểm tra tính hợp lệ của mã QR và gửi sự kiện vào Kafka.

Spark Streaming tiếp nhận dữ liệu, lưu dữ liệu thô
tại Bronze, xử lý nghiệp vụ tại Silver và tổng hợp
số liệu tại Gold.

Dashboard của người giám sát sử dụng dữ liệu Gold
để theo dõi tình hình kiểm soát vé."

### Kết quả mong đợi

- API hoạt động.
- SQL Server hoạt động.
- Kafka hoạt động.
- Spark đang xử lý luồng dữ liệu.

---

## 5. D2 - Đăng nhập và quét vé hợp lệ

**Thời gian:** 01:30 - 03:00.

### Thao tác

1. Đăng nhập bằng tài khoản op_gate_a.
2. Chọn GATE_A và scanner SC_A1.
3. Sinh QR hợp lệ của TK001:

```bash
python3 scripts/send_scans.py --qr TK001
```

4. Sử dụng QR vừa sinh trên giao diện quét vé.

### Lời thuyết trình

"Nhân viên soát vé phải đăng nhập trước khi sử dụng
chức năng quét vé.

API xác thực JWT và vai trò GATE_OPERATOR.
Mã QR được xác thực bằng HMAC-SHA256 trước khi
sự kiện được chuyển sang Kafka.

Vé TK001 thuộc đúng sự kiện, đúng cổng,
nằm trong khung giờ nhận khách và chưa được sử dụng.

Do đó hệ thống cho phép khách vào."

### Kết quả mong đợi

- scan_result = VALID.
- entry = ALLOW.
- ticket_status chuyển từ UNUSED sang VALID_ENTRY.
- Dashboard tăng số lượt quét hợp lệ.

---

## 6. D3 - Phát hiện quét lại vé (C1)

**Thời gian:** 03:00 - 04:30.

### Thao tác

Quét lại đúng QR của TK001 tại GATE_A.

Quan sát thông tin trả về trên giao diện.

### Lời thuyết trình

"Vé này đã được sử dụng ở lượt quét trước.

Spark kiểm tra trạng thái vé và lịch sử quét,
phát hiện hành vi sử dụng lại vé.

Ngoài kết quả USED, hệ thống còn cung cấp
cổng quét trước và khoảng thời gian giữa hai lượt quét.

Hai trường này giúp nhân viên hiểu nguyên nhân
vé bị từ chối và hỗ trợ việc xác minh gian lận."

### Kết quả mong đợi

- scan_result = USED.
- entry = DENY.
- alert_level = FRAUD.
- alert_code = DUPLICATE_SCAN.
- previous_scan_gate_id = GATE_A.
- time_since_previous_scan_ms có giá trị.
- ticket_status = FLAGGED_FRAUD.

Hai trường thông tin lượt quét trước chỉ được
trả về có giá trị đối với kết quả USED phù hợp.

---

## 7. D4 - Phát hiện dùng chung vé

**Thời gian:** 04:30 - 06:00.

### Thao tác

Sử dụng script tạo sự kiện Kafka để minh họa
hai lượt quét có thời gian cách nhau 3 giây.

```bash
python3 scripts/send_scans.py \
  TK006@GATE_A@-3 \
  TK006@GATE_D@0
```

Quan sát Spark log và Dashboard.

### Lời thuyết trình

"Trong tình huống này, hai người có thể sử dụng
cùng một mã vé tại hai cổng khác nhau.

Chúng tôi tạo hai sự kiện quét có thời gian
cách nhau 3 giây để kiểm tra logic xử lý nghiệp vụ.

Spark đối chiếu khoảng thời gian thực tế
với thời gian di chuyển tối thiểu giữa hai cổng.

Nếu khoảng thời gian không đủ để di chuyển,
hệ thống phát hiện dấu hiệu gian lận."

### Kết quả mong đợi

- Lượt đầu tiên: VALID.
- Lượt thứ hai: USED.
- alert_level = FRAUD.
- alert_code = IMPOSSIBLE_TRAVEL.
- previous_scan_gate_id = GATE_A.

Lưu ý: script send_scans.py gửi trực tiếp vào Kafka.
Ca này minh họa logic Spark, không phải kiểm thử
xác thực HMAC hoặc JWT của REST API.

---

## 8. D5 - QR giả, sai sự kiện và sai cổng

**Thời gian:** 06:00 - 08:00.

### 8.1. QR sai chữ ký HMAC

Sinh QR hợp lệ:

```bash
python3 scripts/send_scans.py --qr TK002
```

Tạo QR đã bị sửa một ký tự trong chữ ký:

```bash
python3 scripts/send_scans.py --qr TK002 \
  | python3 -c '
import sys
ticket, sig = sys.stdin.read().strip().split(".", 1)
replacement = "A" if sig[0] != "A" else "B"
print(ticket + "." + replacement + sig[1:])
'
```

Sử dụng QR bị sửa trên giao diện quét vé
để gửi yêu cầu qua REST API.

Kết quả mong đợi:

- INVALID.
- DENY.
- FRAUD.
- INVALID_QR.
- ticket_id trong Silver bằng NULL.
- Trạng thái vé thật không bị thay đổi.

### Lời thuyết trình

"Mặc dù mã vé vẫn tồn tại, chữ ký HMAC đã bị sửa.

API không tin tưởng trực tiếp mã vé do client gửi.
Hệ thống tự kiểm tra chữ ký và loại bỏ mã vé
khi chữ ký không hợp lệ.

Spark ghi nhận đây là một lượt quét không hợp lệ
và tạo cảnh báo INVALID_QR."

### 8.2. Vé sai sự kiện

```bash
python3 scripts/send_scans.py --qr TK005
```

Quét QR hợp lệ của TK005 tại GATE_A.

Kết quả mong đợi: INVALID và DENY.

Lời thuyết trình:

"Khác với trường hợp QR giả, chữ ký HMAC của vé này
có thể hoàn toàn hợp lệ.

Tuy nhiên, TK005 thuộc sự kiện EV002,
trong khi hệ thống đang kiểm soát EV001.

Do đó vé không được phép sử dụng tại sự kiện hiện tại."

### 8.3. Vé sai cổng

```bash
python3 scripts/send_scans.py --qr TK007
```

Quét TK007 tại GATE_A.

Kết quả mong đợi:

- WRONG_GATE.
- DENY.
- ticket_assigned_gate_id = GATE_C.

Lời thuyết trình:

"Vé TK007 được phân công cho cổng C.
Khi khách đến cổng A, hệ thống từ chối lượt quét
và cung cấp thông tin cổng được phân công."

---

## 9. D6 - Dashboard Live và Gold (C2)

**Thời gian:** 08:00 - 10:00.

### Thao tác

1. Chuyển sang cửa sổ EVENT_SUPERVISOR đã mở.
2. Quan sát tổng lượt quét và tỷ lệ gian lận.
3. Quan sát biểu đồ theo kết quả quét.
4. Quan sát thống kê theo từng cổng.
5. Quan sát danh sách cảnh báo.
6. Phát sinh thêm một lượt quét phù hợp.
7. Quan sát Dashboard tự cập nhật mà không nhấn F5.

### Lời thuyết trình

"Dashboard chỉ dành cho người giám sát sự kiện.

Spark tổng hợp dữ liệu Silver thành các bảng Gold.
API Dashboard đọc dữ liệu tổng hợp từ Gold
thay vì tính toán lại toàn bộ lịch sử quét
trong mỗi yêu cầu.

Giao diện thực hiện polling với khoảng nghỉ 1 giây
giữa các chu kỳ yêu cầu.

Khi Spark hoàn tất xử lý và cập nhật Gold,
Dashboard sẽ nhận được dữ liệu mới mà không cần
người dùng tải lại trang."

### Kết quả mong đợi

- Dashboard tự cập nhật.
- Tổng lượt quét thay đổi phù hợp.
- Thống kê theo cổng thay đổi.
- Cảnh báo mới xuất hiện.
- Cảnh báo USED hiển thị thông tin lượt quét trước.

Lưu ý: polling 1 giây không có nghĩa toàn bộ
độ trễ từ Kafka đến Dashboard luôn dưới 1 giây.

---

## 10. D7 - Quản trị vé

**Thời gian:** 10:00 - 11:00.

### Thao tác

1. Mở trang Quản lý vé bằng tài khoản supervisor.
2. Quan sát trạng thái các vé đã kiểm thử.
3. Thử xóa vé TK001 đã phát sinh lịch sử quét.

### Lời thuyết trình

"Người giám sát có quyền quản lý thông tin vé.

Tuy nhiên, hệ thống bảo vệ tính toàn vẹn
của dữ liệu lịch sử.

Vé đã phát sinh lượt quét không thể bị xóa
theo thao tác quản trị thông thường."

### Kết quả mong đợi

- HTTP 409 Conflict.
- Mã lỗi TICKET_IN_USE.
- Vé và lịch sử quét được giữ lại.

---

## 11. D8 - Database Least Privilege (C3)

**Thời gian:** 11:00 - 12:30.

### Thao tác 1: Kiểm tra SQL Session

```bash
docker compose \
  -f docker/docker-compose.yml \
  --env-file docker/.env \
  --profile full \
  exec -T sqlserver bash -c '
    /opt/mssql-tools18/bin/sqlcmd \
      -S localhost \
      -U sa \
      -P "$MSSQL_SA_PASSWORD" \
      -C -I -b -W \
      -d ticket_system
' <<'SQL'
SET NOCOUNT ON;

SELECT
    login_name,
    original_login_name,
    program_name,
    status,
    DB_NAME(database_id) AS database_name
FROM sys.dm_exec_sessions
WHERE is_user_process = 1
  AND login_name IN ('api_user', 'spark_user')
ORDER BY login_name;
GO
SQL
```

### Thao tác 2: Minh chứng quyền bị từ chối

Mở ảnh:

`docs/images/security_db_denied.png`

Mở ảnh kết quả 63 kiểm tra quyền:

`docs/images/security_permissions_63_pass.png`

### Lời thuyết trình

"API và Spark sử dụng hai tài khoản database riêng.

API có quyền đọc kết quả quét và quản lý vé,
nhưng không được ghi trực tiếp vào bảng scan_event.

Spark được phép ghi dữ liệu Silver,
cập nhật trạng thái vé và thực thi stored procedure
để cập nhật Gold.

Spark không được cấp quyền ghi trực tiếp
vào các bảng Gold.

Trong thực nghiệm, thao tác INSERT trái phép
bằng api_user bị SQL Server từ chối với lỗi 229.

Nhóm đã kiểm tra 63 trường hợp quyền hiệu lực
và tất cả đều đạt kết quả mong đợi."

### Kết quả mong đợi

- API session sử dụng api_user.
- Spark session sử dụng spark_user.
- Unauthorized INSERT bị từ chối.
- Kết quả kiểm thử quyền: 63/63 PASS.

---

## 12. D9 - JWT, RBAC, HMAC và Bcrypt (C4)

**Thời gian:** 12:30 - 14:00.

### 12.1. Kiểm thử HTTP 401

```bash
curl -s -i \
  http://localhost:3000/api/dashboard/live
```

Kết quả mong đợi: HTTP 401 Unauthorized.

### 12.2. Kiểm thử HTTP 403

Lấy JWT của GATE_OPERATOR:

```bash
OP_TOKEN=$(curl -fsS \
  -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"op_gate_a","password":"Demo@123"}' \
  | python3 -c '
import json, sys
d = json.load(sys.stdin)
t = d.get("access_token") or d.get("token")
if not t:
    sys.exit("Missing token")
print(t)
')
```

Gọi Dashboard bằng JWT của Operator:

```bash
curl -s -i \
  -H "Authorization: Bearer $OP_TOKEN" \
  http://localhost:3000/api/dashboard/live
```

Kết quả mong đợi: HTTP 403 Forbidden.

### 12.3. Minh chứng HMAC và Bcrypt

Mở các ảnh:

- `docs/images/security_invalid_qr.png`
- `docs/images/security_invalid_qr_db.png`
- `docs/images/security_bcrypt.png`
- `docs/images/security_git_env.png`

### Lời thuyết trình

"Hệ thống áp dụng nhiều lớp bảo mật.

JWT xác thực danh tính người dùng,
RBAC kiểm soát quyền truy cập theo vai trò.

HTTP 401 xuất hiện khi yêu cầu chưa được xác thực.
HTTP 403 xuất hiện khi người dùng đã đăng nhập
nhưng không có quyền truy cập chức năng.

HMAC-SHA256 giúp phát hiện mã QR bị sửa đổi.

Mật khẩu người dùng được băm bằng bcrypt
với cost factor bằng 10.

Các tài khoản seed dùng chung một hash
do sử dụng dữ liệu demo được tạo sẵn.
Trong production, mỗi tài khoản cần mật khẩu riêng
và được băm độc lập.

Các thông tin nhạy cảm được cấu hình trong docker/.env,
tệp này không được Git theo dõi."

---

## 13. D10 - Tổng kết

**Thời gian:** 14:00 - 15:00.

### Lời thuyết trình

"Qua phần demo, nhóm đã minh họa được quy trình
kiểm soát vé từ REST API, Kafka và Spark
đến cơ sở dữ liệu và Dashboard.

Hệ thống xử lý các trường hợp vé hợp lệ,
quét lại vé, dùng chung vé, sai chữ ký QR,
sai sự kiện và sai cổng.

Dashboard cung cấp thông tin giám sát
từ dữ liệu Gold và tự động cập nhật.

Các cơ chế JWT, RBAC, HMAC, bcrypt
và Least Privilege giúp bảo vệ hệ thống
ở nhiều lớp khác nhau.

Kết quả kiểm thử API đạt 30/30,
kiểm tra quyền database đạt 63/63,
và kiểm thử mô phỏng khởi tạo tài khoản
độc lập đạt 8/8.

Đây là các kết quả kiểm thử trong môi trường
phát triển, không phải chứng nhận bảo mật production.

Phần trình bày của nhóm đến đây là kết thúc.
Xin cảm ơn thầy cô và các bạn."

---

## 14. Demo bổ sung nếu giảng viên yêu cầu

### 14.1. Theo dõi Spark

```bash
tail -n 50 logs/spark.log
```

### 14.2. Kiểm thử tự động API

```bash
cd ~/ticket-control/api
npm test
cd ..
```

### 14.3. Kiểm tra tệp môi trường

```bash
git check-ignore docker/.env
git ls-files -- docker/.env
```

### 14.4. Sao lưu và phục hồi

Các script liên quan:

- scripts/backup_db.sh
- scripts/restore_db.sh
- scripts/demo_backup_restore.sh

Script demo_backup_restore.sh thực hiện sao lưu,
giả lập mất dữ liệu, khôi phục và so sánh số dòng
của 12 bảng trước và sau khi khôi phục.

Chỉ chạy trên môi trường demo riêng,
sau khi đã dừng API và Spark ghi dữ liệu,
xác minh cấu hình backup/restore và bảo đảm
có thể khôi phục bản sao lưu.

Lệnh chạy có xác nhận tương tác:

```bash
bash scripts/demo_backup_restore.sh
```

Không chạy script này trong demo chính
nếu chưa diễn tập và xác minh khả năng phục hồi.

Việc số dòng khớp nhau không tự chứng minh
toàn bộ nội dung dữ liệu giống nhau.

---

## 15. Dừng hệ thống sau khi báo cáo

Không reset nếu cần giữ lại kết quả demo.

### 15.1. Khôi phục khung giờ sự kiện

```bash
cd ~/ticket-control
./scripts/dev_event_window.sh demo
```

### 15.2. Dừng Spark

```bash
if [ -f .spark.pid ]; then
    SPARK_PID=$(cat .spark.pid)

    if [[ "$SPARK_PID" =~ ^[0-9]+$ ]] &&
       kill -0 "$SPARK_PID" 2>/dev/null; then

        if ps -p "$SPARK_PID" -o args= \
           | grep -Fq "$PWD/spark/stream_scan_events.py"; then

            kill "$SPARK_PID"
            echo "Spark stop signal sent."
        else
            echo "PID does not match this project."
        fi
    fi
fi
```

Kiểm tra Spark đã dừng:

```bash
pgrep -af 'stream_scan_events.py|bronze_scan_events.py' \
  || echo "Spark process not found."
```

Nếu Spark vẫn chạy, kiểm tra PID và dừng đúng
tiến trình của dự án trước khi tiếp tục.

Sau khi xác nhận Spark đã dừng:

```bash
rm -f .spark.pid
```

### 15.3. Dừng Docker Compose

```bash
docker compose \
  -f docker/docker-compose.yml \
  --env-file docker/.env \
  --profile full \
  down
```

Không thêm `-v` nếu cần giữ lại dữ liệu SQL Server
và các volume của hệ thống.

---

## 16. Phương án xử lý sự cố

| Sự cố | Cách xử lý |
|---|---|
| API không phản hồi | Kiểm tra health và log API |
| SQL Server chưa sẵn sàng | Kiểm tra docker compose ps |
| Spark không xử lý | Kiểm tra tiến trình và logs/spark.log |
| Vé bị EXPIRED | Kiểm tra khung giờ bằng dev_event_window.sh show |
| Vé đã USED ngay lần đầu | Kiểm tra trạng thái vé và sử dụng vé dự phòng |
| Dashboard chưa cập nhật | Kiểm tra Spark, Gold và kết nối Dashboard |
| API trả PROCESSING | Chờ Spark xử lý, không gửi lại lượt quét ngay |
| Token hết hạn | Đăng nhập lại |
| Demo vượt thời gian | Dùng ảnh minh chứng đã chuẩn bị |

Không tự ý reset, xóa volume hoặc thay đổi cấu hình
database trong khi xử lý sự cố trước giảng viên.
