#!/usr/bin/env bash
# Dời khung giờ nhận khách của sự kiện đang chạy (ACTIVE_EVENT_ID) để thử trên máy dev.
#
# Vì sao cần: ngày demo là 12/12/2026. Quét bằng giờ thật trước ngày đó thì mọi vé ra EXPIRED,
# còn gửi lượt quét có received_at = 12/12 thì bị CK_scan_event_ts (processing_ts >= received_at)
# từ chối. Nên khi thử: dời khung giờ về quanh "bây giờ", gửi received_at tính lùi từ bây giờ
# (scripts/send_scans.py VÉ@CỔNG@-GIÂY).
#
#   ./scripts/dev_event_window.sh now     # từ 2 giờ trước tới 2 giờ sau (giờ Việt Nam)
#   ./scripts/dev_event_window.sh demo    # trả về như seed.sql: 12/12/2026 18:00 - 20:00 (EV001)
#   ./scripts/dev_event_window.sh show    # chỉ xem
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/_db.sh

[[ "$ACTIVE_EVENT_ID" =~ ^[A-Z0-9_]{1,20}$ ]] || die "ACTIVE_EVENT_ID '$ACTIVE_EVENT_ID' sai định dạng."
NOW_VN="DATEADD(HOUR, 7, SYSUTCDATETIME())"

case "${1:-show}" in
  now)
    sql "UPDATE dbo.[event]
         SET admission_start = DATEADD(HOUR, -2, $NOW_VN), admission_end = DATEADD(HOUR, 2, $NOW_VN)
         WHERE event_id = N'$ACTIVE_EVENT_ID';"
    ;;
  demo)
    [ "$ACTIVE_EVENT_ID" = "EV001" ] || die "chỉ biết giờ demo của EV001 (seed.sql)."
    sql "UPDATE dbo.[event]
         SET admission_start = '2026-12-12T18:00:00', admission_end = '2026-12-12T20:00:00'
         WHERE event_id = N'EV001';"
    ;;
  show) ;;
  *) die "dùng: $0 [now|demo|show]" ;;
esac

echo "Khung giờ nhận khách hiện tại:"
sql "SELECT event_id, CONVERT(VARCHAR(23), admission_start, 121), CONVERT(VARCHAR(23), admission_end, 121)
     FROM dbo.[event] WHERE event_id = N'$ACTIVE_EVENT_ID';" | sed 's/^/  /'
