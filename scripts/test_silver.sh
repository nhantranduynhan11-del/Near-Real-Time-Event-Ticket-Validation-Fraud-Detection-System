#!/usr/bin/env bash
# =============================================================================
# scripts/test_silver.sh - kiểm tra job Silver đầu-cuối: Kafka -> Spark -> SQL Server (Role B)
#
# Đi đúng đường thật (Kafka, Spark, SQL Server) nhưng gửi thẳng vào Kafka, không qua API, để đặt
# được received_at. Spark chạy chế độ --once nên biết chắc lượt nào nằm cùng batch.
#
#   Lượt 1 (một batch): đủ 6 kết quả, vé giả + vé EV002 + QR hỏng + QR sai chữ ký ra INVALID, hai
#                       lượt TK001 gửi liền nhau ra VALID rồi USED, TK002 hai cổng xa nhau ra
#                       IMPOSSIBLE_TRAVEL. Chuỗi QR được ký bằng QR_HMAC_SECRET như API (file 15).
#   Lượt 2 (batch sau): trạng thái đọc lại từ DB: TK004 quét lại ra USED, TK007 sai đủ 3 cổng ra
#                       WRONG_GATE_FRAUD rồi vẫn vào được đúng cổng.
#   Cuối: trạng thái 7 vé, số dòng fraud_alert, mục 4 của database/check.sql trả về 0 dòng.
#
# Cần: ./scripts/up.sh stream đã chạy. Script XÓA dữ liệu quét (gọi reset.sh) và dừng Spark đang
# chạy; xong thì bật lại bằng ./scripts/up.sh stream.
#   ./scripts/test_silver.sh
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/_db.sh
require_stack

PASS=0; FAIL=0
expect() {  # expect "tên ca" "thực tế" "mong đợi"
  if [ "$2" = "$3" ]; then
    printf '[ OK ] %s\n' "$1"; PASS=$((PASS + 1))
  else
    printf '[FAIL] %s\n         nhận     : %s\n         mong đợi : %s\n' "$1" "$2" "$3"; FAIL=$((FAIL + 1))
  fi
}
row() {  # kết quả | mã cảnh báo | trạng thái trước | trạng thái sau
  sql "SELECT scan_result + '|' + ISNULL(alert_code, '-') + '|' + ISNULL(ticket_status_before, '-')
              + '|' + ISNULL(ticket_status_after, '-')
       FROM dbo.scan_event WHERE scan_event_id = '$1';"
}
col() { sql "SELECT ISNULL(CONVERT(NVARCHAR(50), $2), '-') FROM dbo.scan_event WHERE scan_event_id = '$1';"; }

# run_round "tên" SPEC=MONG_ĐỢI ... : gửi các SPEC trong một lần, chạy Spark --once, đối chiếu
declare -a IDS
run_round() {
  local title="$1"; shift
  local specs=() wants=() line
  for pair in "$@"; do specs+=("${pair%%=*}"); wants+=("${pair#*=}"); done
  echo; echo "== $title =="
  mapfile -t IDS < <(python3 scripts/send_scans.py "${specs[@]}" | cut -f1)
  [ "${#IDS[@]}" -eq "${#specs[@]}" ] || die "gửi được ${#IDS[@]}/${#specs[@]} lượt."
  echo "Chạy Spark --once (mất khoảng 20-60 giây)..."
  bash spark/run_pipeline.sh --once > "logs/test_silver_$(date +%H%M%S).log" 2>&1 \
    || die "Spark --once lỗi, xem logs/test_silver_*.log"
  for i in "${!specs[@]}"; do
    line="$(row "${IDS[$i]}")"
    expect "$(printf '%-22s -> %s' "${specs[$i]}" "${wants[$i]%%|*}")" "${line:-<không có dòng>}" "${wants[$i]}"
  done
}

mkdir -p logs
echo "Đưa dữ liệu về ban đầu và dời khung giờ ${ACTIVE_EVENT_ID} về quanh bây giờ..."
bash scripts/reset.sh -y > /dev/null
bash scripts/dev_event_window.sh now > /dev/null

run_round "Lượt 1: một batch" \
  "FAKE_TK999@GATE_A=INVALID|INVALID_QR|-|-" \
  "TK005@GATE_A=INVALID|INVALID_QR|-|-" \
  "QR_ERROR@GATE_A=INVALID|INVALID_QR|-|-" \
  "tk001@GATE_A=INVALID|INVALID_QR|-|-" \
  "TK003@GATE_C=CANCELLED|REVOKED_TICKET|CANCELLED|CANCELLED" \
  "TK006@GATE_A@-10800=EXPIRED|-|UNUSED|UNUSED" \
  "TK007@GATE_A=WRONG_GATE|WRONG_GATE_WARNING|UNUSED|UNUSED" \
  "TK001@GATE_A=VALID|-|UNUSED|VALID_ENTRY" \
  "TK001@GATE_A=USED|DUPLICATE_SCAN|VALID_ENTRY|FLAGGED_FRAUD" \
  "TK002@GATE_B@-5=VALID|-|UNUSED|VALID_ENTRY" \
  "TK002@GATE_D=USED|IMPOSSIBLE_TRAVEL|VALID_ENTRY|FLAGGED_FRAUD" \
  "TK004@GATE_B=VALID|-|UNUSED|VALID_ENTRY" \
  "FORGED:TK006@GATE_A=INVALID|INVALID_QR|-|-"
R1=("${IDS[@]}")
expect "QR sai chữ ký: giữ nguyên chuỗi QR gốc, không gắn vé" \
  "$(col "${R1[12]}" "LEFT(raw_qr_payload, 6) + '|' + ISNULL(ticket_id, '-')")" "TK006.|-"
expect "TK001 lượt 2 trỏ về lượt 1" "$(col "${R1[8]}" "LOWER(CONVERT(NVARCHAR(36), previous_scan_event_id))")" "${R1[7]}"
expect "TK001 hai lượt cùng một batch (cùng processing_ts)" \
  "$(col "${R1[7]}" "CONVERT(VARCHAR(23), processing_ts, 121)")" \
  "$(col "${R1[8]}" "CONVERT(VARCHAR(23), processing_ts, 121)")"
expect "TK002 GATE_B -> GATE_D: min_travel_time_ms" "$(col "${R1[10]}" min_travel_time_ms)" "100000"
expect "TK007 sai cổng lần 1: distinct_wrong_gate_count" "$(col "${R1[6]}" distinct_wrong_gate_count)" "1"
expect "INVALID không gắn vé: ticket_assigned_gate_id" "$(col "${R1[1]}" ticket_assigned_gate_id)" "-"

run_round "Lượt 2: batch sau, trạng thái đọc lại từ DB" \
  "TK004@GATE_B=USED|DUPLICATE_SCAN|VALID_ENTRY|FLAGGED_FRAUD" \
  "TK007@GATE_B=WRONG_GATE|WRONG_GATE_WARNING|UNUSED|UNUSED" \
  "TK007@GATE_D=WRONG_GATE|WRONG_GATE_FRAUD|UNUSED|UNUSED" \
  "TK007@GATE_C=VALID|-|UNUSED|VALID_ENTRY" \
  "TK001@GATE_A=USED|DUPLICATE_SCAN|FLAGGED_FRAUD|FLAGGED_FRAUD"
R2=("${IDS[@]}")
expect "TK004 lượt 2 trỏ về lượt VALID ở batch trước" \
  "$(col "${R2[0]}" "LOWER(CONVERT(NVARCHAR(36), previous_scan_event_id))")" "${R1[11]}"
expect "TK007 sai cổng B, D: distinct_wrong_gate_count" \
  "$(col "${R2[1]}" distinct_wrong_gate_count),$(col "${R2[2]}" distinct_wrong_gate_count)" "2,3"

echo; echo "== Sau cùng =="
expect "Trạng thái 7 vé" \
  "$(sql "SELECT STRING_AGG(ticket_id + '=' + ticket_status, ' ') WITHIN GROUP (ORDER BY ticket_id) FROM dbo.ticket WHERE ticket_id IN ('TK001','TK002','TK003','TK004','TK005','TK006','TK007');")" \
  "TK001=FLAGGED_FRAUD TK002=FLAGGED_FRAUD TK003=CANCELLED TK004=FLAGGED_FRAUD TK005=UNUSED TK006=UNUSED TK007=VALID_ENTRY"
expect "Số dòng scan_event / fraud_alert" \
  "$(sql "SELECT CONCAT((SELECT COUNT(*) FROM dbo.scan_event), '/', (SELECT COUNT(*) FROM dbo.fraud_alert));")" "18/13"
# Mục 4 của database/check.sql
expect "check.sql mục 4: số dòng lệch giữa scan_event và fraud_alert" "$(sql "
  SELECT COUNT(*) FROM (
    SELECT s.scan_event_id FROM dbo.scan_event s LEFT JOIN dbo.fraud_alert f ON f.scan_event_id = s.scan_event_id
    WHERE s.alert_level <> N'NONE' AND f.scan_event_id IS NULL
    UNION ALL
    SELECT f.scan_event_id FROM dbo.fraud_alert f JOIN dbo.scan_event s ON s.scan_event_id = f.scan_event_id
    WHERE s.alert_level = N'NONE' OR s.alert_code <> f.alert_code OR s.alert_level <> f.alert_level) x;")" "0"

echo
echo "KẾT QUẢ: $PASS đạt, $FAIL không đạt."
echo "Spark đang tắt. Bật lại: ./scripts/up.sh stream   (khung giờ ${ACTIVE_EVENT_ID} vẫn đang dời; trả lại: ./scripts/dev_event_window.sh demo)"
[ "$FAIL" -eq 0 ]
