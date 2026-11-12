#!/usr/bin/env bash
# Chạy TC01-TC08 (Requirements/10_Test_Cases.md) qua API, mỗi ca reset trước, in bảng đạt/không đạt.
# Dùng:  scripts/run_test_cases.sh            chạy cả 8 ca
#        scripts/run_test_cases.sh TC07 TC08  chạy riêng một vài ca
#        RESET_MODE=sql scripts/run_test_cases.sh   mỗi ca chỉ reset SQL Server, không chạy scripts/reset.sh
# Cần: curl, jq, GNU date. Hệ thống phải đang chạy chế độ full (API + Kafka + Spark + SQL Server).
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

API_URL=${API_URL:-http://localhost:3000}
EVENT_ID=${EVENT_ID:-EV001}
DEMO_PASSWORD=${DEMO_PASSWORD:-Demo@123}
SUPERVISOR_USER=${SUPERVISOR_USER:-supervisor}
TC05_GAP_SECONDS=${TC05_GAP_SECONDS:-5}
TC08_GAP_SECONDS=${TC08_GAP_SECONDS:-140}
STATUS_WAIT_SECONDS=${STATUS_WAIT_SECONDS:-8}
POLL_MAX_SECONDS=${POLL_MAX_SECONDS:-30}
POST_RESET_WAIT_SECONDS=${POST_RESET_WAIT_SECONDS:-3}
RESET_CMD=${RESET_CMD:-}
RESET_MODE=${RESET_MODE:-auto}
SKIP_RESET=${SKIP_RESET:-0}

declare -A GATE_USER=([GATE_A]=op_gate_a [GATE_B]=op_gate_b [GATE_C]=op_gate_c [GATE_D]=op_gate_d)
declare -A GATE_SCANNER=([GATE_A]=SC_A1 [GATE_B]=SC_B1 [GATE_C]=SC_C1 [GATE_D]=SC_D1)
declare -A RULE_OF=([TC01]=R1 [TC02]=R1 [TC03]=R2 [TC04]=R2 [TC05]=R3 [TC06]=R3 [TC07]=R4 [TC08]=R4)
declare -A EXPECT_OF=(
  [TC01]="INVALID/INVALID_QR/DENY"
  [TC02]="VALID/NONE/ALLOW"
  [TC03]="CANCELLED/REVOKED_TICKET/DENY"
  [TC04]="VALID/NONE/ALLOW"
  [TC05]="USED/DUPLICATE_SCAN/DENY"
  [TC06]="VALID/NONE/ALLOW"
  [TC07]="USED/IMPOSSIBLE_TRAVEL/DENY"
  [TC08]="USED/DUPLICATE_SCAN/DENY"
)
declare -A TOKEN
SUP_TOKEN=""
HTTP_CODE=""
HTTP_BODY=""
ORIG_EVENT=""
WINDOW_CHANGED=0
S_ERR="" S_ID="" S_RESULT="" S_CODE="" S_ENTRY="" S_RECEIVED=""
PREP_ERR=""
ACTUAL_STATUS=""

ROW_TC=() ROW_ACT=() ROW_OK=() ROW_NOTE=() ROW_INFO=()

log() { printf '%s\n' "$*" >&2; }
die() { log "LỖI: $*"; exit 1; }

now_iso()  { TZ=Asia/Ho_Chi_Minh date -d "${1:-now}" +%Y-%m-%dT%H:%M:%S.%3N%:z; }
epoch_ms() { date -d "$1" +%s%3N; }

http() { # http METHOD PATH [TOKEN] [BODY]  ->  HTTP_CODE, HTTP_BODY
  local method=$1 path=$2 token=${3:-} body=${4:-}
  local args=(-sS -m 30 -X "$method" -H "Accept: application/json" -w '\n%{http_code}')
  [[ -n $token ]] && args+=(-H "Authorization: Bearer $token")
  [[ -n $body ]] && args+=(-H "Content-Type: application/json" --data "$body")
  local out
  if ! out=$(curl "${args[@]}" "$API_URL$path" 2>/dev/null); then
    HTTP_CODE=000
    HTTP_BODY=""
    return 1
  fi
  HTTP_CODE=${out##*$'\n'}
  HTTP_BODY=${out%$'\n'*}
}

login() { # login USERNAME  ->  in access_token ra stdout
  local body
  body=$(jq -nc --arg u "$1" --arg p "$DEMO_PASSWORD" '{username:$u,password:$p}')
  http POST /api/login "" "$body"
  [[ $HTTP_CODE == 200 ]] || return 1
  jq -r '.access_token // empty' <<<"$HTTP_BODY"
}

preflight() {
  local missing=() c
  for c in curl jq date; do command -v "$c" >/dev/null || missing+=("$c"); done
  (( ${#missing[@]} == 0 )) || die "Thiếu công cụ: ${missing[*]}. Cài bằng: sudo apt install -y ${missing[*]}"
  date -d now +%s%3N >/dev/null 2>&1 || die "Cần GNU date (Ubuntu và WSL2 có sẵn)."
  http GET /api/health || die "Không gọi được API tại $API_URL. Hệ thống đã chạy chế độ full chưa?"
  [[ $HTTP_CODE == 200 ]] || die "GET /api/health trả HTTP $HTTP_CODE: $HTTP_BODY"
  log "API: $(jq -c . <<<"$HTTP_BODY" 2>/dev/null || echo "$HTTP_BODY")"
}

login_all() {
  local gate
  SUP_TOKEN=$(login "$SUPERVISOR_USER") || die "Đăng nhập $SUPERVISOR_USER thất bại (HTTP $HTTP_CODE). Đã nạp seed.sql chưa?"
  [[ -n $SUP_TOKEN ]] || die "Đăng nhập $SUPERVISOR_USER không trả token."
  for gate in "${!GATE_USER[@]}"; do
    TOKEN[$gate]=$(login "${GATE_USER[$gate]}") || die "Đăng nhập ${GATE_USER[$gate]} thất bại (HTTP $HTTP_CODE)."
    [[ -n ${TOKEN[$gate]} ]] || die "Đăng nhập ${GATE_USER[$gate]} không trả token."
  done
}

# Qua API, received_at là giờ máy chủ thật, nên lượt quét phải nằm trong giờ nhận khách
# của sự kiện, nếu không Spark trả EXPIRED. Nếu giờ hiện tại chưa nằm trong khung (và còn
# đủ chỗ cho cả lần chạy), tạm đổi khung giờ rồi trả về như cũ khi kết thúc.
prepare_window() {
  http GET "/api/events/$EVENT_ID" "$SUP_TOKEN"
  [[ $HTTP_CODE == 200 ]] || die "Không đọc được sự kiện $EVENT_ID (HTTP $HTTP_CODE)."
  ORIG_EVENT=$HTTP_BODY
  [[ $(jq -r '.is_active' <<<"$ORIG_EVENT") == true ]] \
    || die "Sự kiện $EVENT_ID không phải ACTIVE_EVENT_ID của API và Spark. Đặt ACTIVE_EVENT_ID=$EVENT_ID rồi khởi động lại API và Spark."
  local s e now margin
  s=$(epoch_ms "$(jq -r '.admission_start' <<<"$ORIG_EVENT")")
  e=$(epoch_ms "$(jq -r '.admission_end' <<<"$ORIG_EVENT")")
  now=$(date +%s%3N)
  margin=$(( (TC08_GAP_SECONDS + 300) * 1000 ))
  if (( now >= s && now + margin <= e )); then
    log "Giờ nhận khách của $EVENT_ID đang bao phủ lúc chạy, giữ nguyên."
    return 0
  fi
  local body
  body=$(jq -c --arg s "$(now_iso '1 hour ago')" --arg e "$(now_iso '2 hours')" \
    '{event_name, gate_ids, admission_start:$s, admission_end:$e}' <<<"$ORIG_EVENT")
  http PUT "/api/events/$EVENT_ID" "$SUP_TOKEN" "$body"
  [[ $HTTP_CODE == 200 ]] || die "Không đổi được giờ nhận khách tạm thời (HTTP $HTTP_CODE): $HTTP_BODY"
  WINDOW_CHANGED=1
  log "Đã tạm đổi giờ nhận khách của $EVENT_ID sang [1 giờ trước, 2 giờ tới]; sẽ trả lại khi xong."
}

restore_window() {
  (( WINDOW_CHANGED == 1 )) || return 0
  WINDOW_CHANGED=0
  local body
  body=$(jq -c '{event_name, admission_start, admission_end, gate_ids}' <<<"$ORIG_EVENT")
  http PUT "/api/events/$EVENT_ID" "$SUP_TOKEN" "$body"
  if [[ $HTTP_CODE == 200 ]]; then
    log "Đã trả giờ nhận khách của $EVENT_ID về như cũ."
  else
    log "CẢNH BÁO: chưa trả được giờ nhận khách của $EVENT_ID (HTTP $HTTP_CODE). Hãy sửa lại bằng PUT /api/events/$EVENT_ID với: $body"
  fi
}

sql_reset() {
  local compose="$ROOT/docker/docker-compose.yml"
  [[ -f $compose ]] || compose="$ROOT/docker-compose.yml"
  docker compose -f "$compose" exec -T sqlserver bash -c \
    '/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -I -b -d ticket_system' \
    < "$ROOT/database/reset_test_data.sql"
}

# Thứ tự ưu tiên: RESET_CMD (tự đặt) > RESET_MODE=sql (chỉ reset SQL Server) > scripts/reset.sh > chỉ reset SQL Server.
reset_state() {
  local out rc=0
  if [[ -n $RESET_CMD ]]; then
    out=$(bash -c "$RESET_CMD" 2>&1 </dev/null) || rc=$?
  elif [[ $RESET_MODE == sql ]]; then
    out=$(sql_reset 2>&1) || rc=$?
  elif [[ -x $ROOT/scripts/reset.sh ]]; then
    out=$("$ROOT/scripts/reset.sh" 2>&1 </dev/null) || rc=$?
  else
    out=$(sql_reset 2>&1) || rc=$?
  fi
  if (( rc != 0 )); then
    log "Reset thất bại (mã $rc): $(tail -n 5 <<<"$out")"
    return "$rc"
  fi
  sleep "$POST_RESET_WAIT_SECONDS"
}

# Quét TICKET tại GATE bằng mã QR do API ký. Đặt S_*; trả 0 khi có kết quả, 1 khi lỗi.
scan() {
  local ticket=$1 gate=$2 payload body deadline
  S_ERR="" S_ID="" S_RESULT="" S_CODE="" S_ENTRY="" S_RECEIVED=""
  http GET "/api/tickets/$ticket/qr" "$SUP_TOKEN"
  if [[ $HTTP_CODE != 200 ]]; then
    S_ERR="không lấy được mã QR của $ticket (HTTP $HTTP_CODE)"
    return 1
  fi
  payload=$(jq -r '.qr_payload // empty' <<<"$HTTP_BODY")
  [[ -n $payload ]] || { S_ERR="API không trả qr_payload cho $ticket"; return 1; }
  body=$(jq -nc --arg p "$payload" --arg t "${payload%.*}" --arg g "$gate" \
    --arg s "${GATE_SCANNER[$gate]}" --arg at "$(now_iso)" \
    '{raw_qr_payload:$p, ticket_id:$t, decode_error:false, gate_id:$g, scanner_id:$s, scanned_at:$at}')
  http POST /api/scan "${TOKEN[$gate]}" "$body"
  case $HTTP_CODE in
    200|202) ;;
    *) S_ERR="POST /api/scan trả HTTP $HTTP_CODE: $(jq -r '.error.code // empty' <<<"$HTTP_BODY" 2>/dev/null)"; return 1 ;;
  esac
  S_ID=$(jq -r '.scan_event_id' <<<"$HTTP_BODY")
  S_RECEIVED=$(jq -r '.received_at' <<<"$HTTP_BODY")
  deadline=$((SECONDS + POLL_MAX_SECONDS))
  while [[ $(jq -r '.status' <<<"$HTTP_BODY") != COMPLETED ]]; do
    if (( SECONDS >= deadline )); then
      S_ERR="quá ${POLL_MAX_SECONDS} giây mà chưa có kết quả (Spark có đang chạy không?)"
      return 1
    fi
    sleep 0.5
    http GET "/api/scan/$S_ID" "${TOKEN[$gate]}"
    [[ $HTTP_CODE == 200 ]] || { S_ERR="GET /api/scan/$S_ID trả HTTP $HTTP_CODE"; return 1; }
  done
  S_RESULT=$(jq -r '.scan_result' <<<"$HTTP_BODY")
  S_ENTRY=$(jq -r '.entry' <<<"$HTTP_BODY")
  S_CODE=$(jq -r '.alert_code // "NONE"' <<<"$HTTP_BODY")
}

# Bước chuẩn bị của một ca: quét và bắt buộc ra đúng kết quả mong đợi.
need_scan() { # need_scan TICKET GATE KẾT_QUẢ
  if ! scan "$1" "$2"; then
    PREP_ERR="bước chuẩn bị (quét $1 tại $2): $S_ERR"
    return 1
  fi
  if [[ $S_RESULT != "$3" ]]; then
    PREP_ERR="bước chuẩn bị (quét $1 tại $2) ra $S_RESULT/$S_CODE, cần $3"
    return 1
  fi
}

wait_status() { # wait_status TICKET TRẠNG_THÁI_MONG_ĐỢI [GIÂY_CHỜ]
  local end=$((SECONDS + ${3:-$STATUS_WAIT_SECONDS}))
  while :; do
    http GET "/api/tickets/$1" "$SUP_TOKEN"
    ACTUAL_STATUS=$(jq -r '.ticket_status // empty' <<<"$HTTP_BODY" 2>/dev/null)
    [[ $ACTUAL_STATUS == "$2" ]] && return 0
    (( SECONDS >= end )) && return 1
    sleep 0.5
  done
}

record() { # record ID THỰC_TẾ ĐẠT(1/0) GHI_CHÚ [THÔNG_TIN]
  ROW_TC+=("$1"); ROW_ACT+=("$2"); ROW_OK+=("$3"); ROW_NOTE+=("$4"); ROW_INFO+=("${5:-}")
}

fail_case() { record "$1" "-" 0 "$2"; }

conclude() { # conclude ID VÉ TRẠNG_THÁI_VÉ_MONG_ĐỢI [THÔNG_TIN]
  local id=$1 ticket=$2 est=$3 info=${4:-}
  local er ec ee
  IFS=/ read -r er ec ee <<<"${EXPECT_OF[$id]}"
  local ok=1 note="" wait_s=$STATUS_WAIT_SECONDS
  if [[ $S_RESULT != "$er" || $S_CODE != "$ec" ]]; then
    ok=0; note+="kết quả quét khác mong đợi. "; wait_s=0
  fi
  if [[ $S_ENTRY != "$ee" ]]; then
    ok=0; note+="entry là $S_ENTRY, mong đợi $ee. "
  fi
  if ! wait_status "$ticket" "$est" "$wait_s"; then
    ok=0; note+="trạng thái vé $ticket là ${ACTUAL_STATUS:-?}, mong đợi $est. "
  fi
  record "$id" "$S_RESULT/$S_CODE" "$ok" "$note" "$info"
}

tc01() { # R1 bắt được: vé thuộc sự kiện khác
  scan TK005 GATE_A || { fail_case TC01 "$S_ERR"; return; }
  conclude TC01 TK005 UNUSED
}

tc02() { # R1 không báo nhầm: vé đúng sự kiện, quét ngay sau một vé bị từ chối
  need_scan TK005 GATE_A INVALID || { fail_case TC02 "$PREP_ERR"; return; }
  sleep 2
  scan TK006 GATE_A || { fail_case TC02 "$S_ERR"; return; }
  conclude TC02 TK006 VALID_ENTRY
}

tc03() { # R2 bắt được: vé đã bị thu hồi
  scan TK003 GATE_C || { fail_case TC03 "$S_ERR"; return; }
  conclude TC03 TK003 CANCELLED
}

tc04() { # R2 không báo nhầm: vé cùng cổng, cùng đợt nhưng chưa bị thu hồi
  need_scan TK003 GATE_C CANCELLED || { fail_case TC04 "$PREP_ERR"; return; }
  sleep 3
  scan TK007 GATE_C || { fail_case TC04 "$S_ERR"; return; }
  conclude TC04 TK007 VALID_ENTRY
}

tc05() { # R3 bắt được: vé đã vào, quét lại ở cùng cổng
  need_scan TK002 GATE_B VALID || { fail_case TC05 "$PREP_ERR"; return; }
  sleep "$TC05_GAP_SECONDS"
  scan TK002 GATE_B || { fail_case TC05 "$S_ERR"; return; }
  conclude TC05 TK002 FLAGGED_FRAUD "file 10 ghi cách 30 phút; ca này dùng cách ${TC05_GAP_SECONDS} giây (R3 không phụ thuộc khoảng cách thời gian). Muốn đúng 30 phút: TC05_GAP_SECONDS=1800"
}

tc06() { # R3 không báo nhầm: vé khác quét ở cùng cổng, cách 2 giây
  need_scan TK002 GATE_B VALID || { fail_case TC06 "$PREP_ERR"; return; }
  sleep 2
  scan TK004 GATE_B || { fail_case TC06 "$S_ERR"; return; }
  conclude TC06 TK004 VALID_ENTRY
}

tc07() { # R4 bắt được: cùng vé, hai cổng xa nhau, cách vài giây
  need_scan TK001 GATE_A VALID || { fail_case TC07 "$PREP_ERR"; return; }
  local first=$S_RECEIVED
  sleep 3
  scan TK001 GATE_D || { fail_case TC07 "$S_ERR"; return; }
  local gap_ms=$(( $(epoch_ms "$S_RECEIVED") - $(epoch_ms "$first") ))
  conclude TC07 TK001 FLAGGED_FRAUD "khoảng cách thực tế giữa hai lượt quét: $((gap_ms / 1000)).$(printf '%03d' $((gap_ms % 1000))) giây (ngưỡng A-D là 140 giây)"
}

tc08() { # R4 không báo nhầm: cùng vé, hai cổng xa nhau, cách bằng hoặc hơn ngưỡng
  need_scan TK001 GATE_A VALID || { fail_case TC08 "$PREP_ERR"; return; }
  local first=$S_RECEIVED first_ms target now_ms
  first_ms=$(epoch_ms "$first")
  target=$(( first_ms + TC08_GAP_SECONDS * 1000 + 500 ))
  log "   TC08: chờ ${TC08_GAP_SECONDS} giây giữa hai lượt quét..."
  while now_ms=$(date +%s%3N); (( now_ms < target )); do sleep 1; done
  scan TK001 GATE_D || { fail_case TC08 "$S_ERR"; return; }
  local gap_ms=$(( $(epoch_ms "$S_RECEIVED") - first_ms ))
  if (( gap_ms < TC08_GAP_SECONDS * 1000 )); then
    fail_case TC08 "lỗi tính giờ của script: khoảng cách thực tế $gap_ms ms nhỏ hơn ${TC08_GAP_SECONDS} giây"
    return
  fi
  conclude TC08 TK001 FLAGGED_FRAUD "khoảng cách thực tế: $((gap_ms / 1000)).$(printf '%03d' $((gap_ms % 1000))) giây, nhỉnh hơn ngưỡng một chút. Không dựng được đúng 140.000 giây nên ca này chưa phân biệt được dấu < với <= trong R4; việc đó cần kiểm tra trực tiếp trên Spark"
}

run_case() {
  local id=$1
  log "→ $id (${RULE_OF[$id]})"
  if (( SKIP_RESET != 1 )); then
    reset_state || { fail_case "$id" "reset thất bại, ca không chạy"; return; }
  fi
  "${id,,}"
}

print_table() {
  local i pass=0 total=${#ROW_TC[@]} verdict exp
  echo
  printf '%-5s %-5s %-30s %-30s %s\n' "Ca" "Rule" "Expected" "Actual" "Kết quả"
  printf '%-5s %-5s %-30s %-30s %s\n' "-----" "-----" "------------------------------" "------------------------------" "-------------"
  for i in "${!ROW_TC[@]}"; do
    exp=${EXPECT_OF[${ROW_TC[$i]}]%/*}
    if [[ ${ROW_OK[$i]} == 1 ]]; then verdict="Đạt"; pass=$((pass + 1)); else verdict="KHÔNG ĐẠT"; fi
    printf '%-5s %-5s %-30s %-30s %s\n' "${ROW_TC[$i]}" "${RULE_OF[${ROW_TC[$i]}]}" "$exp" "${ROW_ACT[$i]}" "$verdict"
  done
  echo
  echo "Tổng: $total ca, $pass đạt, $((total - pass)) không đạt."
  local printed=0
  for i in "${!ROW_TC[@]}"; do
    if [[ ${ROW_OK[$i]} != 1 && -n ${ROW_NOTE[$i]} ]]; then
      (( printed == 0 )) && { echo; echo "Chi tiết ca không đạt:"; printed=1; }
      echo "  - ${ROW_TC[$i]}: ${ROW_NOTE[$i]}"
    fi
  done
  printed=0
  for i in "${!ROW_TC[@]}"; do
    if [[ -n ${ROW_INFO[$i]} ]]; then
      (( printed == 0 )) && { echo; echo "Ghi chú:"; printed=1; }
      echo "  - ${ROW_TC[$i]}: ${ROW_INFO[$i]}"
    fi
  done
  (( pass == total ))
}

main() {
  local cases=("$@") id
  (( ${#cases[@]} )) || cases=(TC01 TC02 TC03 TC04 TC05 TC06 TC07 TC08)
  for id in "${cases[@]}"; do
    [[ -n ${RULE_OF[${id^^}]:-} ]] || die "Không có ca $id (chỉ có TC01 đến TC08)."
  done
  preflight
  login_all
  trap restore_window EXIT
  prepare_window
  for id in "${cases[@]}"; do run_case "${id^^}"; done
  restore_window
  print_table
}

main "$@"
