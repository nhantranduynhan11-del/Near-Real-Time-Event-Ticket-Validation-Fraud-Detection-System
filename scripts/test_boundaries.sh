#!/usr/bin/env bash
# =============================================================================
# scripts/test_boundaries.sh - B1: kiểm ba ca ranh giới qua Kafka -> Spark -> SQL Server
#
#   (1) TC08 hai phía ngưỡng A<->D 140 000 ms: cách ĐÚNG 140 000 ms ra DUPLICATE_SCAN,
#       cách 139 999 ms ra IMPOSSIBLE_TRAVEL
#   (2) Mốc cuối giờ nhận khách: quét đúng admission_end (vd 20:00:00.000) VẪN trong giờ,
#       1 ms sau mới là EXPIRED; expire_tickets.sql cũng theo đúng mốc đó
#   (3) Cổng sai thứ N-1 (= 3) ra WRONG_GATE_FRAUD nhưng vé vẫn UNUSED, rồi vẫn vào đúng cổng được
#
# Cách làm: đặt admission_end của sự kiện = X (10 phút trước, tròn giây), gửi lượt quét có giờ nhận
# tính từ X chính xác tới mili giây (send_scans.py --base), chạy Spark --once, đối chiếu DB.
#
# Cần: ./scripts/up.sh stream (hoặc full) đã chạy. Script XÓA dữ liệu quét (reset.sh) và tắt Spark;
# xong thì trả khung giờ demo và nhắc bật lại Spark.
#   ./scripts/test_boundaries.sh
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/_db.sh
require_stack

PASS=0; FAIL=0
expect() {
  if [ "$2" = "$3" ]; then printf '[ OK ] %s\n' "$1"; PASS=$((PASS + 1))
  else printf '[FAIL] %s\n         nhận     : %s\n         mong đợi : %s\n' "$1" "$2" "$3"; FAIL=$((FAIL + 1)); fi
}
row() {
  sql "SELECT scan_result + '|' + ISNULL(alert_code, '-') + '|' + ISNULL(ticket_status_before, '-')
              + '|' + ISNULL(ticket_status_after, '-')
       FROM dbo.scan_event WHERE scan_event_id = '$1';"
}
ticket_status() { sql "SELECT ticket_status FROM dbo.ticket WHERE ticket_id = N'$1';"; }
sql_file() {  # chạy một tệp SQL (đọc từ stdin) bằng sqlcmd trong container
  "${COMPOSE[@]}" exec -T -e SQLCMDPASSWORD="$DB_PASSWORD" sqlserver \
    "$SQLCMD_BIN" -S localhost -U "$DB_USER" -d "$DB_NAME" -C -b -I -f 65001 > /dev/null
}

restore_window() { bash scripts/dev_event_window.sh demo > /dev/null 2>&1 || true; }
trap restore_window EXIT

mkdir -p logs
echo "Đưa dữ liệu về ban đầu..."
bash scripts/reset.sh -y > /dev/null

# X: 10 phút trước, tròn giây, giờ Việt Nam. Mọi received_at <= X + 140 s < bây giờ (CK_scan_event_ts).
X="$(TZ=Asia/Ho_Chi_Minh date -d '10 minutes ago' +%Y-%m-%dT%H:%M:%S)"
sql "UPDATE dbo.[event]
     SET admission_start = DATEADD(HOUR, -2, CAST('$X' AS DATETIME2(3))),
         admission_end   = CAST('$X' AS DATETIME2(3))
     WHERE event_id = N'$ACTIVE_EVENT_ID';"
echo "Khung giờ nhận khách tạm: 2 giờ trước $X -> đúng $X.000"

SPECS=(
  "TK001@GATE_A@0=VALID|-|UNUSED|VALID_ENTRY"
  "TK004@GATE_B@0.001=EXPIRED|-|UNUSED|UNUSED"
  "TK001@GATE_D@139.999=USED|IMPOSSIBLE_TRAVEL|VALID_ENTRY|FLAGGED_FRAUD"
  "TK006@GATE_A@-300=VALID|-|UNUSED|VALID_ENTRY"
  "TK006@GATE_D@-160=USED|DUPLICATE_SCAN|VALID_ENTRY|FLAGGED_FRAUD"
  "TK007@GATE_A@-100=WRONG_GATE|WRONG_GATE_WARNING|UNUSED|UNUSED"
  "TK007@GATE_B@-90=WRONG_GATE|WRONG_GATE_WARNING|UNUSED|UNUSED"
  "TK007@GATE_D@-80=WRONG_GATE|WRONG_GATE_FRAUD|UNUSED|UNUSED"
  "TK007@GATE_C@-70=VALID|-|UNUSED|VALID_ENTRY"
)
LABELS=(
  "(2) quét đúng admission_end ($X.000) -> vẫn trong giờ"
  "(2) 1 ms sau admission_end -> EXPIRED"
  "(1) cách 139 999 ms, A->D -> IMPOSSIBLE_TRAVEL"
  "(1) chuẩn bị: TK006 vào ở GATE_A"
  "(1) cách đúng 140 000 ms, A->D -> DUPLICATE_SCAN"
  "(3) cổng sai thứ 1 -> WARNING"
  "(3) cổng sai thứ 2 -> WARNING"
  "(3) cổng sai thứ 3 = N-1 -> WRONG_GATE_FRAUD, vé vẫn UNUSED"
  "(3) sau đó quét đúng cổng -> VALID"
)
specs=(); wants=()
for pair in "${SPECS[@]}"; do specs+=("${pair%%=*}"); wants+=("${pair#*=}"); done

mapfile -t IDS < <(python3 scripts/send_scans.py --base "$X.000+07:00" "${specs[@]}" | cut -f1)
[ "${#IDS[@]}" -eq "${#specs[@]}" ] || die "gửi được ${#IDS[@]}/${#specs[@]} lượt."
echo "Chạy Spark --once (khoảng 20-60 giây)..."
bash spark/run_pipeline.sh --once > "logs/test_boundaries_$(date +%H%M%S).log" 2>&1 \
  || die "Spark --once lỗi, xem logs/test_boundaries_*.log"

echo
for i in "${!specs[@]}"; do
  line="$(row "${IDS[$i]}")"
  expect "${LABELS[$i]}" "${line:-<không có dòng>}" "${wants[$i]}"
done
expect "(1) khoảng cách ghi trong scan_event: 139999 và 140000" \
  "$(sql "SELECT CONCAT((SELECT time_since_previous_scan_ms FROM dbo.scan_event WHERE scan_event_id = '${IDS[2]}'), N' và ',
                        (SELECT time_since_previous_scan_ms FROM dbo.scan_event WHERE scan_event_id = '${IDS[4]}'));")" \
  "139999 và 140000"
expect "(3) số cổng sai khác nhau 1, 2, 3" \
  "$(sql "SELECT STRING_AGG(CAST(distinct_wrong_gate_count AS NVARCHAR(5)), ',') WITHIN GROUP (ORDER BY received_at)
          FROM dbo.scan_event WHERE ticket_id = N'TK007' AND scan_result = N'WRONG_GATE';")" "1,2,3"

# (2) expire_tickets.sql: tại đúng X chưa chuyển vé nào; 1 ms sau thì TK002, TK004 (còn UNUSED) thành EXPIRED
sed "s/@now_override DATETIME2(3) = NULL/@now_override DATETIME2(3) = '$X.000'/" database/expire_tickets.sql | sql_file
expect "(2) expire_tickets.sql lúc đúng admission_end: TK004 vẫn UNUSED" "$(ticket_status TK004)" "UNUSED"
sed "s/@now_override DATETIME2(3) = NULL/@now_override DATETIME2(3) = '$X.001'/" database/expire_tickets.sql | sql_file
expect "(2) expire_tickets.sql 1 ms sau: TK002, TK004 thành EXPIRED" \
  "$(ticket_status TK002),$(ticket_status TK004)" "EXPIRED,EXPIRED"

echo
echo "KẾT QUẢ: $PASS đạt, $FAIL không đạt."
echo "Đã trả khung giờ demo. Spark đang tắt: bật lại bằng ./scripts/up.sh stream (hoặc full); dữ liệu đưa về ban đầu bằng ./scripts/reset.sh -y."
[ "$FAIL" -eq 0 ]
