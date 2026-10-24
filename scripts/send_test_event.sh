#!/usr/bin/env bash
# =============================================================================
# scripts/send_test_event.sh - đẩy tay MỘT bản tin thử vào topic scan-events (Role B)
#
# Dùng để thử đường Kafka -> Spark -> Bronze mà chưa cần API. Bản tin có đủ 9 trường
# như API sẽ gửi (file 15, mục 2.1), khóa phân vùng là ticket_id như thiết kế (file 11, mục 5).
#
# Cách dùng:
#   ./scripts/send_test_event.sh                  # bản tin hợp lệ -> vào Bronze
#   ./scripts/send_test_event.sh --ticket TK007   # đổi mã vé (cũng là khóa phân vùng)
#   ./scripts/send_test_event.sh --at 2026-12-12T18:30:00.000+07:00
#                                                 # đặt giờ nhận (thử ranh giới giờ/ngày của Bronze)
#   ./scripts/send_test_event.sh --bad-json       # JSON bị cụt -> Spark chuyển sang scan-events-dlq
#   ./scripts/send_test_event.sh --no-id          # thiếu scan_event_id -> chuyển sang DLQ
#
# Biến tùy chọn: KAFKA_CONTAINER (mặc định kafka), KAFKA_TOPIC (mặc định scan-events)
# =============================================================================
set -euo pipefail

KAFKA_CONTAINER="${KAFKA_CONTAINER:-kafka}"
TOPIC="${KAFKA_TOPIC:-scan-events}"
TICKET="TK001"
MODE="valid"
AT=""

die() { echo "LỖI: $*" >&2; exit 1; }

while (($#)); do
  case "$1" in
    --ticket)
      [[ $# -ge 2 ]] || die "--ticket cần một giá trị, ví dụ: --ticket TK007"
      TICKET="$2"
      shift
      ;;
    --at)
      [[ $# -ge 2 ]] || die "--at cần một giá trị, ví dụ: --at 2026-12-12T18:30:00.000+07:00"
      AT="$2"
      shift
      ;;
    --bad-json) MODE="bad-json" ;;
    --no-id) MODE="no-id" ;;
    -h | --help) sed -n '3,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Tham số lạ: '$1'. Xem: $0 --help" ;;
  esac
  shift
done

[[ "$TICKET" =~ ^[A-Za-z0-9_-]{1,40}$ ]] || die "Mã vé '$TICKET' không hợp lệ (chỉ chữ, số, '_' và '-')."
command -v docker >/dev/null 2>&1 || die "Không tìm thấy lệnh 'docker'."

# Mã bản tin và giờ nhận theo giờ Việt Nam, kèm +07:00 (file 15, mục 2.1: không dùng giờ UTC).
EVENT_ID="$(cat /proc/sys/kernel/random/uuid)"
NOW_VN="$(TZ=Asia/Ho_Chi_Minh date +%Y-%m-%dT%H:%M:%S.%3N%:z)"
if [[ -n "$AT" ]]; then
  # Giờ đặt tay phải là ISO 8601 có múi giờ (+07:00 hoặc Z), như API sẽ gửi.
  ISO_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?(Z|[+-][0-9]{2}:[0-9]{2})$'
  [[ "$AT" =~ $ISO_RE ]] || die "Giờ '$AT' sai dạng. Ví dụ đúng: 2026-12-12T18:30:00.000+07:00"
  NOW_VN="$AT"
fi

case "$MODE" in
  valid)
    PAYLOAD="$(printf '{"scan_event_id":"%s","raw_qr_payload":"%s.demo","ticket_id":"%s","decode_error":false,"gate_id":"GATE_A","scanner_id":"SC_A1","operator_id":null,"scanned_at":"%s","received_at":"%s"}' \
      "$EVENT_ID" "$TICKET" "$TICKET" "$NOW_VN" "$NOW_VN")"
    ;;
  no-id)
    PAYLOAD="$(printf '{"raw_qr_payload":"%s.demo","ticket_id":"%s","decode_error":false,"gate_id":"GATE_A","scanner_id":"SC_A1","operator_id":null,"scanned_at":"%s","received_at":"%s"}' \
      "$TICKET" "$TICKET" "$NOW_VN" "$NOW_VN")"
    ;;
  bad-json)
    PAYLOAD="$(printf '{"scan_event_id":"%s","raw_qr_payload":' "$EVENT_ID")"
    ;;
esac

echo "Gửi vào topic '$TOPIC' (khóa=$TICKET, kiểu=$MODE):"
echo "  $PAYLOAD"

# Công cụ gửi của Kafka tách khóa và nội dung bằng dấu '|' (parse.key). Ghi đè heap xuống nhỏ
# vì container đã đặt KAFKA_HEAP_OPTS=512m cho broker.
printf '%s|%s\n' "$TICKET" "$PAYLOAD" | docker exec -i -e KAFKA_HEAP_OPTS="-Xmx128m -Xms64m" "$KAFKA_CONTAINER" \
  /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server localhost:9092 --topic "$TOPIC" \
  --property parse.key=true --property 'key.separator=|'

echo "Đã gửi. scan_event_id=$EVENT_ID"
