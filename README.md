# Ticket Control

## 1. Cài máy trắng

```powershell
wsl --install -d Ubuntu
```
Khởi động lại máy, mở **Ubuntu**, tạo tên người dùng/mật khẩu.

Cài **Docker Desktop**, vào Settings (biểu tượng bánh răng) → Resources → WSL integration, bật cho Ubuntu.

Tạo `C:\Users\<tên bạn>\.wslconfig`:
```
[wsl2]
memory=5GB
processors=4
```
```powershell
wsl --shutdown
```
Mở lại Ubuntu, kiểm tra:
```bash
docker --version
docker compose version
```

## 2. Lấy mã nguồn

```bash
cd ~
git clone https://github.com/nhantranduynhan11-del/Near-Real-Time-Event-Ticket-Validation-Fraud-Detection-System/tree/main ticket-control
cd ticket-control
cp docker/.env.example docker/.env
nano docker/.env.example 
```
Mở `docker/.env`, điền `DB_PASSWORD`.
`Ctrl + o` sau đó enter để lưu sau khi nhập.
`Ctrl + x` để thoát

## 3. Cài môi trường Spark (một lần)

```bash
sudo apt update
sudo apt install -y openjdk-21-jdk-headless python3 python3-venv
java -version   # phải ra 21
```
```bash
cat >> ~/.bashrc <<'EOF'
export JAVA_HOME="/usr/lib/jvm/java-21-openjdk-$(dpkg --print-architecture)"
export PATH="$JAVA_HOME/bin:$PATH"
EOF
source ~/.bashrc
```
```bash
cd ~/ticket-control
python3 -m venv .venv
source .venv/bin/activate
pip install -r spark/requirements.txt
python spark/check_env.py   # mọi dòng phải là [ OK ]
```

## 4. Bật hệ thống

```bash
chmod +x scripts/*.sh    #chỉ cần làm trong lần chạy đầu
./scripts/up.sh app      # SQL Server + API
./scripts/up.sh stream   # SQL Server + Kafka + Spark
./scripts/up.sh full     # tất cả
```
Lần đầu Spark tải gói Kafka, đợi 1-3 phút.

**Xong khi:**
```bash
docker compose -f docker/docker-compose.yml --env-file docker/.env ps
```
mọi container `running`/`healthy`, và mở được `http://localhost:3000`.

## 5. Thử một lượt quét

Chỉ chế độ `stream`/`full`, Spark đang chạy. Gửi thẳng một bản tin vào Kafka (không qua API):

```bash
./scripts/send_test_event.sh                  # hợp lệ -> vào Bronze
./scripts/send_test_event.sh --bad-json       # hỏng -> sang topic scan-events-dlq
```

Hoặc đi qua API:

```bash
curl -X POST http://localhost:3000/api/scan \
  -H "Content-Type: application/json" \
  -d '{"raw_qr_payload":"TK001.demo","ticket_id":"TK001","decode_error":false,"gate_id":"GATE_A","scanner_id":"SC_A1","scanned_at":"2026-12-12T19:00:01.000+07:00"}'

sleep 10
find data/bronze -name '*.parquet'
```
Có file `.parquet` mới là đạt.

## 6. Đưa dữ liệu về ban đầu

```bash
./scripts/reset.sh      # có hỏi xác nhận; xóa cả bản tin trong Kafka nếu Kafka đang chạy
./scripts/reset.sh -y   # bỏ qua hỏi
find data/bronze -name '*.parquet' #để kiểm tra lại, nếu không tìm thấy file thì đạt.
```

## 7. Tắt

```bash
docker compose -f docker/docker-compose.yml --env-file docker/.env --profile full down
kill "$(cat .spark.pid)" 2>/dev/null   # nếu Spark đang chạy
```
Thêm `-v` vào lệnh `down` để xóa luôn dữ liệu SQL Server.

## 8. Lỗi hay gặp

| Lỗi | Cách xử lý |
|---|---|
| `no configuration file provided: not found` | Chưa đứng đúng thư mục gốc repo, hoặc chưa `git pull` |
| API treo, log Kafka báo `ENOTFOUND kafka` liên tục | Đang chạy `app` nhưng API đợi Kafka — dùng `stream`/`full`, hoặc chờ A sửa |
| `LỖI: chưa có môi trường ảo` khi bật Spark | Chưa tạo `.venv` — làm lại mục 3 |
| `UnknownTopicOrPartitionException` | Topic chưa có — chạy `bash scripts/create_topics.sh` |
| `DELETE failed ... QUOTED_IDENTIFIER` khi chạy `reset.sh` | Đã sửa trong `reset.sh` (cờ `-I`); tải lại bản mới nhất |
| Giờ lệch 7 tiếng | Thiếu `TZ=Asia/Ho_Chi_Minh` ở một thành phần nào đó |
|The command 'docker' could not be found in this WSL 2 distro.| Chưa bật `Docker Desktop`. Nếu đã bật vẫn không được thì thoát và bật lại|
