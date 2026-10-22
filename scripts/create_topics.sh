set -euo pipefail

# ---------- 1. Hằng số thiết kế (quyết định của nhóm, KHÔNG đổi theo máy) ----------
readonly PARTITIONS=3
readonly REPLICATION_FACTOR=1
readonly RETENTION_DAYS=7
readonly RETENTION_MS=$((RETENTION_DAYS * 24 * 60 * 60 * 1000)) # = 604800000

# ---------- 2. Cấu hình có thể khác nhau giữa các máy ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env}"
KAFKA_CONTAINER="${KAFKA_CONTAINER:-kafka}"
WAIT_TIMEOUT="${WAIT_TIMEOUT:-120}"
# Các lệnh Kafka chạy BÊN TRONG container, nên gọi cổng của chính nó.
BOOTSTRAP="localhost:9092"
KAFKA_BIN="/opt/kafka/bin"

# ---------- 3. Hàm hỗ trợ ----------
if [[ -t 1 ]]; then
  C_OK=$'\033[32m'; C_ERR=$'\033[31m'; C_OFF=$'\033[0m'
else
  C_OK=""; C_ERR=""; C_OFF=""
fi

log() { printf '%s\n' "$*"; }
ok()  { printf '%s✔%s %s\n' "$C_OK" "$C_OFF" "$*"; }
die() { printf '%s✖ LỖI:%s %s\n' "$C_ERR" "$C_OFF" "$*" >&2; exit 1; }

usage() {
  sed -n '3,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# Đọc một biến cấu hình: shell > .env > mặc định.
# Không dùng `source .env` vì .env có thể chứa ký tự đặc biệt (mật khẩu có $ hoặc !).
get_config() {
  local key="$1" default="$2" value=""
  if [[ -n "${!key:-}" ]]; then
    printf '%s' "${!key}"
    return 0
  fi
  if [[ -f "$ENV_FILE" ]]; then
    value="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '\r' || true)"
    value="${value#\"}"; value="${value%\"}"
    value="${value#\'}"; value="${value%\'}"
  fi
  printf '%s' "${value:-$default}"
}

# Tên topic Kafka chỉ được gồm chữ, số, dấu chấm, gạch dưới, gạch ngang.
validate_topic_name() {
  local name="$1"
  [[ "$name" =~ ^[A-Za-z0-9._-]{1,249}$ ]] \
    || die "Tên topic '$name' không hợp lệ (chỉ gồm chữ, số, '.', '_', '-'; tối đa 249 ký tự). Kiểm tra file .env."
}

# Chạy một công cụ Kafka trong container.
# Ghi đè heap xuống nhỏ: container đã đặt KAFKA_HEAP_OPTS=512m cho broker,
# nếu không ghi đè thì mỗi lệnh này mở thêm một JVM ăn 512 MB.
kafka_exec() {
  local tool="$1"
  shift
  docker exec -e KAFKA_HEAP_OPTS="-Xmx128m -Xms64m" "$KAFKA_CONTAINER" \
    "$KAFKA_BIN/$tool" --bootstrap-server "$BOOTSTRAP" "$@"
}

require_docker() {
  command -v docker >/dev/null 2>&1 \
    || die "Không tìm thấy lệnh 'docker'. Mở Docker Desktop và bật WSL integration cho distro Ubuntu của bạn."
}

# Chờ container Kafka lên và báo healthy. Thoát sớm nếu container không tồn tại hoặc đã chết.
wait_for_kafka() {
  local waited=0 info state health
  log "Chờ container '$KAFKA_CONTAINER' sẵn sàng (tối đa ${WAIT_TIMEOUT}s)..."
  while ((waited < WAIT_TIMEOUT)); do
    if ! info="$(docker inspect --type container \
      -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' \
      "$KAFKA_CONTAINER" 2>/dev/null)"; then
      die "Không thấy container '$KAFKA_CONTAINER'. Hãy bật Kafka trước:
       docker compose --profile stream up -d kafka
     (hoặc đổi tên bằng biến KAFKA_CONTAINER nếu container của bạn tên khác)."
    fi
    read -r state health <<<"$info"
    case "$state" in
      exited | dead)
        die "Container '$KAFKA_CONTAINER' đã dừng (trạng thái: $state). Xem nguyên nhân: docker logs $KAFKA_CONTAINER"
        ;;
      running)
        if [[ "$health" == "healthy" ]]; then
          ok "Kafka đã healthy."
          return 0
        fi
        # Container không khai healthcheck: thử gọi broker trực tiếp.
        if [[ "$health" == "no-healthcheck" ]] && kafka_exec kafka-broker-api-versions.sh >/dev/null 2>&1; then
          ok "Kafka trả lời."
          return 0
        fi
        ;;
    esac
    sleep 3
    waited=$((waited + 3))
  done
  die "Hết ${WAIT_TIMEOUT}s mà Kafka vẫn chưa healthy. Xem: docker logs $KAFKA_CONTAINER"
}

# Đọc lại topic từ broker và đối chiếu với thiết kế. Sai thì dừng, không tự sửa.
verify_topic() {
  local topic="$1" desc cfg parts rf

  desc="$(kafka_exec kafka-topics.sh --describe --topic "$topic")" \
    || die "Không đọc được mô tả topic '$topic'."
  parts="$(grep -o 'PartitionCount: *[0-9]*' <<<"$desc" | head -n 1 | grep -o '[0-9]*$' || true)"
  rf="$(grep -o 'ReplicationFactor: *[0-9]*' <<<"$desc" | head -n 1 | grep -o '[0-9]*$' || true)"
  [[ -n "$parts" && -n "$rf" ]] \
    || die "Không đọc được số phần vùng / bản sao của '$topic'. Kafka trả về:
$desc"

  if [[ "$parts" != "$PARTITIONS" ]]; then
    die "Topic '$topic' đang có $parts phần vùng, thiết kế yêu cầu $PARTITIONS.
     Script KHÔNG tự sửa: tăng số phần vùng làm đổi chỗ của khóa ticket_id
     (hash(khóa) mod số phần vùng) nên phá thứ tự các lượt quét của một vé.
     Nếu đang ở môi trường thử nghiệm và chấp nhận mất bản tin trong topic:
       docker exec $KAFKA_CONTAINER $KAFKA_BIN/kafka-topics.sh --bootstrap-server $BOOTSTRAP --delete --topic $topic
     rồi chạy lại script này."
  fi
  if [[ "$rf" != "$REPLICATION_FACTOR" ]]; then
    die "Topic '$topic' đang có $rf bản sao, thiết kế yêu cầu $REPLICATION_FACTOR."
  fi

  cfg="$(kafka_exec kafka-configs.sh --describe --entity-type topics --entity-name "$topic")" \
    || die "Không đọc được cấu hình topic '$topic'."
  # Dòng cấu hình riêng của topic có dạng:  "  retention.ms=604800000 sensitive=false ..."
  grep -qE "^[[:space:]]*retention\.ms=${RETENTION_MS}([[:space:]]|$)" <<<"$cfg" \
    || die "Topic '$topic' chưa có retention.ms=${RETENTION_MS}. Kafka trả về:
$cfg"

  ok "Topic '$topic': $parts phần vùng, $rf bản sao, giữ ${RETENTION_DAYS} ngày (retention.ms=${RETENTION_MS})."
}

# Tạo topic nếu chưa có, ép lại cấu hình, rồi kiểm tra lại.
ensure_topic() {
  local topic="$1"
  log "Xử lý topic '$topic'..."

  # --if-not-exists: có rồi thì bỏ qua, không báo lỗi (nền tảng của tính idempotent).
  kafka_exec kafka-topics.sh --create --if-not-exists \
    --topic "$topic" \
    --partitions "$PARTITIONS" \
    --replication-factor "$REPLICATION_FACTOR" \
    --config "retention.ms=${RETENTION_MS}" \
    || die "Tạo topic '$topic' thất bại."

  # Topic có thể đã tồn tại từ trước (vd. tự sinh ra với cấu hình mặc định):
  # --if-not-exists bỏ qua nó, nên ép lại retention để mọi lần chạy đều hội tụ về thiết kế.
  kafka_exec kafka-configs.sh --alter \
    --entity-type topics --entity-name "$topic" \
    --add-config "retention.ms=${RETENTION_MS}" >/dev/null \
    || die "Đặt cấu hình cho topic '$topic' thất bại."

  verify_topic "$topic"
}

# ---------- 4. Chương trình chính ----------
main() {
  case "${1:-}" in
    -h | --help)
      usage
      exit 0
      ;;
    "") ;;
    *) die "Tham số lạ: '$1'. Xem: $0 --help" ;;
  esac

  local topic_main topic_dlq
  topic_main="$(get_config KAFKA_TOPIC scan-events)"
  topic_dlq="$(get_config KAFKA_DLQ_TOPIC scan-events-dlq)"
  validate_topic_name "$topic_main"
  validate_topic_name "$topic_dlq"
  [[ "$topic_main" != "$topic_dlq" ]] \
    || die "KAFKA_TOPIC và KAFKA_DLQ_TOPIC đang trùng nhau ('$topic_main')."

  if [[ ! -f "$ENV_FILE" ]]; then
    log "(Không thấy $ENV_FILE, dùng tên topic mặc định.)"
  fi
  log "Cấu hình: topic=$topic_main, dlq=$topic_dlq, partitions=$PARTITIONS, replication=$REPLICATION_FACTOR, retention=${RETENTION_DAYS} ngày"

  require_docker
  wait_for_kafka
  ensure_topic "$topic_main"
  ensure_topic "$topic_dlq"

  log ""
  log "Danh sách topic hiện có trên broker:"
  kafka_exec kafka-topics.sh --list --exclude-internal | sed 's/^/  - /'
  ok "Hoàn tất."
}

main "$@"