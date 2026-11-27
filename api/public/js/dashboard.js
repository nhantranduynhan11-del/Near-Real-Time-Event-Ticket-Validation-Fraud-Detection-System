// Màn hình giám sát trực tiếp cho EVENT_SUPERVISOR, hỏi dữ liệu mỗi giây từ /api/dashboard/live
(function () {
  'use strict';

  var T = window.TicketUI;
  var POLL_INTERVAL_MS = 1000;
  var activeCleanup = null;

  var RESULT_ORDER = ['VALID', 'WRONG_GATE', 'USED', 'INVALID', 'CANCELLED', 'EXPIRED'];
  var RESULT_META = {
    VALID:      { label: 'Hợp lệ (Cho vào)',   cls: 'res-valid' },
    WRONG_GATE: { label: 'Sai cổng',           cls: 'res-wrong-gate' },
    USED:       { label: 'Đã sử dụng',         cls: 'res-used' },
    INVALID:    { label: 'QR không hợp lệ',    cls: 'res-invalid' },
    CANCELLED:  { label: 'Vé đã thu hồi',      cls: 'res-cancelled' },
    EXPIRED:    { label: 'Quá giờ nhận khách', cls: 'res-expired' }
  };

  T.register('dashboard', {
    title: 'Dashboard',
    roles: ['EVENT_SUPERVISOR'],
    mount: mount,
    unmount: function () {
      if (typeof activeCleanup === 'function') activeCleanup();
      activeCleanup = null;
    }
  });

  function mount(root) {
    root.innerHTML =
      '<div class="db-conn-banner" id="db-conn-banner" role="alert" hidden>' +
        '<strong>Mất kết nối với API</strong>: Không lấy được dữ liệu mới từ <code>/api/dashboard/live</code>.' +
      '</div>' +

      '<section class="card section db-header-card">' +
        '<div class="db-header-row">' +
          '<div>' +
            '<h2 id="db-event-title">Dashboard giám sát trực tiếp</h2>' +
            '<p class="sub" id="db-event-meta" style="margin:0">Đang tải thông tin sự kiện…</p>' +
          '</div>' +
          '<div class="db-status-box">' +
            '<div class="db-conn-pill ok" id="db-conn-pill">' +
              '<span class="dot"></span>' +
              '<span id="db-conn-text">Đang kết nối (1 giây/lần)</span>' +
            '</div>' +
            '<div class="sub mini" id="db-updated-at" style="margin:4px 0 0">Cập nhật gần nhất: —</div>' +
          '</div>' +
        '</div>' +
      '</section>' +

      '<div class="db-kpi-grid">' +
        '<section class="card section db-kpi">' +
          '<span class="sub">Tổng lượt quét</span>' +
          '<div class="db-kpi-value" id="db-total-scans">0</div>' +
          '<div class="sub mini">Mọi kết quả cộng lại</div>' +
        '</section>' +
        '<section class="card section db-kpi db-kpi-fraud">' +
          '<span class="sub">Tỷ lệ gian lận (chỉ mức FRAUD)</span>' +
          '<div class="db-kpi-value deny-text" id="db-fraud-rate">0,00%</div>' +
          '<div class="sub mini">Không tính cảnh báo WARNING</div>' +
        '</section>' +
        '<section class="card section db-kpi">' +
          '<span class="sub">Cảnh báo gian lận (FRAUD)</span>' +
          '<div class="db-kpi-value deny-text" id="db-fraud-count">0</div>' +
          '<div class="sub mini">alert_level = FRAUD</div>' +
        '</section>' +
        '<section class="card section db-kpi">' +
          '<span class="sub">Cảnh báo nhắc nhở (WARNING)</span>' +
          '<div class="db-kpi-value warn-text" id="db-warning-count">0</div>' +
          '<div class="sub mini">Vào nhầm cổng dưới ngưỡng</div>' +
        '</section>' +
      '</div>' +

      '<section class="card section">' +
        '<h2>Số lượt quét theo từng kết quả</h2>' +
        '<div class="db-result-grid" id="db-by-result"></div>' +
      '</section>' +

      '<div class="db-two-col">' +
        '<section class="card section">' +
          '<h2>Biểu đồ lưu lượng theo cổng</h2>' +
          '<p class="sub">Cập nhật liên tục mỗi giây từ bảng Gold (<code>gold_gate_stats</code>)</p>' +
          '<div class="db-chart-wrap">' +
            '<canvas id="db-gate-chart"></canvas>' +
          '</div>' +
        '</section>' +

        '<section class="card section">' +
          '<h2>Chi tiết theo cổng</h2>' +
          '<p class="sub">Tổng hợp hợp lệ, từ chối và cảnh báo tại từng cổng</p>' +
          '<div class="table-wrap">' +
            '<table class="table">' +
              '<thead><tr>' +
                '<th>Cổng</th><th>Tổng</th><th>Hợp lệ</th><th>Từ chối</th><th>FRAUD</th><th>WARNING</th><th>Quét gần nhất</th>' +
              '</tr></thead>' +
              '<tbody id="db-gates-rows"><tr><td colspan="7" class="empty">Đang tải…</td></tr></tbody>' +
            '</table>' +
          '</div>' +
        '</section>' +
      '</div>' +

      '<section class="card section">' +
        '<div class="db-section-head">' +
          '<div>' +
            '<h2>Danh sách cảnh báo mới nhất</h2>' +
            '<p class="sub" style="margin:0">Sắp xếp theo thời gian mới nhất từ <code>gold_alert</code></p>' +
          '</div>' +
          '<span class="badge" id="db-alerts-count">0 cảnh báo</span>' +
        '</div>' +
        '<div class="table-wrap" style="margin-top:12px">' +
          '<table class="table">' +
            '<thead><tr>' +
              '<th>Giờ nhận</th><th>Cổng / Máy</th><th>Mức</th><th>Mã cảnh báo</th><th>Vé</th><th>Chi tiết vi phạm</th>' +
            '</tr></thead>' +
            '<tbody id="db-alerts-rows"><tr><td colspan="6" class="empty">Chưa có cảnh báo nào.</td></tr></tbody>' +
          '</table>' +
        '</div>' +
      '</section>';

    var connBanner = root.querySelector('#db-conn-banner');
    var connPill = root.querySelector('#db-conn-pill');
    var connText = root.querySelector('#db-conn-text');
    var updatedAtEl = root.querySelector('#db-updated-at');
    var eventTitleEl = root.querySelector('#db-event-title');
    var eventMetaEl = root.querySelector('#db-event-meta');
    var totalScansEl = root.querySelector('#db-total-scans');
    var fraudRateEl = root.querySelector('#db-fraud-rate');
    var fraudCountEl = root.querySelector('#db-fraud-count');
    var warningCountEl = root.querySelector('#db-warning-count');
    var byResultEl = root.querySelector('#db-by-result');
    var gatesRowsEl = root.querySelector('#db-gates-rows');
    var alertsRowsEl = root.querySelector('#db-alerts-rows');
    var alertsCountEl = root.querySelector('#db-alerts-count');
    var chartCanvas = root.querySelector('#db-gate-chart');

    var mounted = true;
    var pollTimer = null;
    var gateChart = null;
    var hasRenderedData = false;
    var lastGatesSig = '';
    var lastAlertsSig = '';

    // Tạo sẵn 6 ô kết quả để mỗi chu kỳ chỉ gán lại textContent
    var resultValEls = {};
    byResultEl.innerHTML = RESULT_ORDER.map(function (code) {
      var m = RESULT_META[code] || { label: code, cls: '' };
      return (
        '<div class="db-result-item ' + m.cls + '">' +
          '<div class="db-result-head">' +
            '<span class="db-result-code">' + T.escapeHtml(code) + '</span>' +
            '<span class="db-result-label">' + T.escapeHtml(m.label) + '</span>' +
          '</div>' +
          '<div class="db-result-num" data-res-code="' + code + '">0</div>' +
        '</div>'
      );
    }).join('');
    RESULT_ORDER.forEach(function (code) {
      resultValEls[code] = byResultEl.querySelector('[data-res-code="' + code + '"]');
    });

    // Khởi tạo biểu đồ một lần và tắt animation để cập nhật liên tục không bị giật
    function initChart() {
      if (!window.Chart || !chartCanvas) return;
      var ctx = chartCanvas.getContext('2d');
      gateChart = new window.Chart(ctx, {
        type: 'bar',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Vào hợp lệ (VALID)',
              data: [],
              backgroundColor: '#1a9d55',
              borderRadius: 4
            },
            {
              label: 'Từ chối (Rejected)',
              data: [],
              backgroundColor: '#f59e0b',
              borderRadius: 4
            },
            {
              label: 'Gian lận (FRAUD)',
              data: [],
              backgroundColor: '#d93b3b',
              borderRadius: 4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: {
            mode: 'index',
            intersect: false
          },
          plugins: {
            legend: {
              position: 'top',
              labels: { boxWidth: 12, font: { size: 12 } }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { precision: 0 }
            }
          }
        }
      });
    }

    function setConnectionState(connected, reason) {
      if (connected) {
        connBanner.hidden = true;
        connPill.className = 'db-conn-pill ok';
        connText.textContent = 'Đang kết nối trực tiếp (1 giây/lần)';
      } else {
        connBanner.hidden = false;
        var suffix = hasRenderedData
          ? '. Màn hình đang giữ lại số liệu gần nhất đã tải.'
          : '. Chưa có dữ liệu từ máy chủ.';
        connBanner.innerHTML =
          '<strong>Mất kết nối với API</strong>: ' +
          T.escapeHtml(reason || 'Không lấy được dữ liệu mới từ /api/dashboard/live') +
          suffix;
        connPill.className = 'db-conn-pill down';
        connText.textContent = 'Mất kết nối với API';
        if (!hasRenderedData) {
          eventMetaEl.textContent = 'Không tải được dữ liệu sự kiện (mất kết nối với API).';
          gatesRowsEl.innerHTML = '<tr><td colspan="7" class="empty">Chưa có dữ liệu cổng.</td></tr>';
          alertsRowsEl.innerHTML = '<tr><td colspan="6" class="empty">Chưa có cảnh báo nào.</td></tr>';
        }
      }
    }

    function formatShortTime(iso) {
      if (!iso) return '—';
      var d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleTimeString('vi-VN', { hour12: false });
    }

    function formatAlertDetail(a) {
      if (a.scan_result === 'USED') {
        var isImpossible = a.alert_code === 'IMPOSSIBLE_TRAVEL';
        var tag = isImpossible
          ? '<span class="db-detail-tag impossible">Hai người dùng chung vé</span>'
          : '<span class="db-detail-tag duplicate">Vé đã vào rồi</span>';
        var parts = [tag];
        if (a.previous_scan_gate_id) {
          parts.push('Cổng trước: <b>' + T.escapeHtml(a.previous_scan_gate_id) + '</b>');
        }
        if (a.time_since_previous_scan_ms != null) {
          parts.push('Cách: <b>' + T.escapeHtml(T.formatSeconds(a.time_since_previous_scan_ms)) + '</b>');
        }
        if (isImpossible && a.min_travel_time_ms != null) {
          parts.push('(ngưỡng đi bộ: ' + T.escapeHtml(T.formatSeconds(a.min_travel_time_ms)) + ')');
        }
        return parts.join(' · ');
      }
      if (a.scan_result === 'WRONG_GATE') {
        var wParts = [];
        if (a.ticket_assigned_gate_id) {
          wParts.push('Cổng đúng: <b>' + T.escapeHtml(a.ticket_assigned_gate_id) + '</b>');
        }
        if (a.distinct_wrong_gate_count != null) {
          wParts.push('Số cổng sai đã thử: <b>' + T.escapeHtml(a.distinct_wrong_gate_count) + '</b>');
        }
        return wParts.join(' · ') || 'Vào nhầm cổng';
      }
      if (!a.ticket_id && a.raw_qr_preview) {
        return 'QR lạ: <code>' + T.escapeHtml(a.raw_qr_preview) + '</code>';
      }
      return T.escapeHtml(T.ALERT_CODES[a.alert_code] || a.scan_result || '—');
    }

    function renderData(data) {
      if (!data) return;
      hasRenderedData = true;

      var ev = data.event || {};
      if (ev.event_id) {
        eventTitleEl.textContent = 'Dashboard giám sát - ' + ev.event_id +
          (ev.event_name ? ' · ' + ev.event_name : '');
        eventMetaEl.textContent =
          'Khung giờ nhận khách: ' + T.formatTime(ev.admission_start) +
          ' – ' + T.formatTime(ev.admission_end) +
          (ev.gate_count != null ? ' · ' + ev.gate_count + ' cổng' : '');
      }

      var totals = data.totals || {};
      var goldTime = totals.updated_at ? T.formatTime(totals.updated_at) : 'Chưa có lượt quét';
      var genTime = data.generated_at ? formatShortTime(data.generated_at) : formatShortTime(T.nowVietnamISO());
      updatedAtEl.textContent = 'Cập nhật Gold: ' + goldTime + ' · Đồng bộ lúc: ' + genTime;

      totalScansEl.textContent = Number(totals.total_scans || 0).toLocaleString('vi-VN');
      fraudRateEl.textContent = T.formatRate(totals.fraud_rate || 0);
      fraudCountEl.textContent = Number(totals.fraud_count || 0).toLocaleString('vi-VN');
      warningCountEl.textContent = Number(totals.warning_count || 0).toLocaleString('vi-VN');

      var byResult = totals.by_result || {};
      RESULT_ORDER.forEach(function (code) {
        if (resultValEls[code]) {
          resultValEls[code].textContent = Number(byResult[code] || 0).toLocaleString('vi-VN');
        }
      });

      // Chỉ cập nhật lại biểu đồ và bảng cổng khi dữ liệu thực sự thay đổi
      var gates = Array.isArray(data.gates) ? data.gates : [];
      var gatesSig = gates.map(function (g) {
        return [
          g.gate_id, g.total_scans, g.valid_entries, g.rejected_scans,
          g.fraud_count, g.warning_count, g.last_scan_at
        ].join(':');
      }).join('|');

      if (gatesSig !== lastGatesSig) {
        lastGatesSig = gatesSig;

        if (gateChart) {
          gateChart.data.labels = gates.map(function (g) {
            return g.gate_name ? (g.gate_id + ' (' + g.gate_name + ')') : g.gate_id;
          });
          gateChart.data.datasets[0].data = gates.map(function (g) { return g.valid_entries || 0; });
          gateChart.data.datasets[1].data = gates.map(function (g) { return g.rejected_scans || 0; });
          gateChart.data.datasets[2].data = gates.map(function (g) { return g.fraud_count || 0; });
          gateChart.update('none');
        }

        if (!gates.length) {
          gatesRowsEl.innerHTML = '<tr><td colspan="7" class="empty">Chưa có dữ liệu cổng.</td></tr>';
        } else {
          gatesRowsEl.innerHTML = gates.map(function (g) {
            return (
              '<tr>' +
                '<td><strong>' + T.escapeHtml(g.gate_id) + '</strong>' +
                  (g.gate_name ? '<div class="sub mini" style="margin:0">' + T.escapeHtml(g.gate_name) + '</div>' : '') +
                '</td>' +
                '<td><strong>' + Number(g.total_scans || 0).toLocaleString('vi-VN') + '</strong></td>' +
                '<td class="ok-text">' + Number(g.valid_entries || 0).toLocaleString('vi-VN') + '</td>' +
                '<td>' + Number(g.rejected_scans || 0).toLocaleString('vi-VN') + '</td>' +
                '<td class="deny-text">' + Number(g.fraud_count || 0).toLocaleString('vi-VN') +
                  ' <span class="sub mini">(' + T.escapeHtml(T.formatRate(g.fraud_rate || 0)) + ')</span></td>' +
                '<td class="warn-text">' + Number(g.warning_count || 0).toLocaleString('vi-VN') + '</td>' +
                '<td class="mini">' + T.escapeHtml(formatShortTime(g.last_scan_at)) + '</td>' +
              '</tr>'
            );
          }).join('');
        }
      }

      var alerts = Array.isArray(data.latest_alerts) ? data.latest_alerts : [];
      alertsCountEl.textContent = alerts.length + ' cảnh báo gần nhất';
      var alertsSig = alerts.map(function (a) { return a.scan_event_id; }).join('|');

      if (alertsSig !== lastAlertsSig) {
        lastAlertsSig = alertsSig;
        if (!alerts.length) {
          alertsRowsEl.innerHTML = '<tr><td colspan="6" class="empty">Chưa có cảnh báo nào.</td></tr>';
        } else {
          alertsRowsEl.innerHTML = alerts.map(function (a) {
            var isFraud = a.alert_level === 'FRAUD';
            var levelBadge = isFraud
              ? '<span class="badge st-fraud">FRAUD</span>'
              : '<span class="badge db-badge-warn">WARNING</span>';
            var codeTitle = T.ALERT_CODES[a.alert_code] || '';
            var ticketCell = a.ticket_id
              ? '<code>' + T.escapeHtml(a.ticket_id) + '</code>'
              : '<span class="sub mini">Không rõ vé</span>';

            return (
              '<tr class="' + (isFraud ? 'db-row-fraud' : 'db-row-warn') + '">' +
                '<td class="mini" style="white-space:nowrap">' + T.escapeHtml(formatShortTime(a.received_at || a.created_at)) + '</td>' +
                '<td><strong>' + T.escapeHtml(a.gate_id) + '</strong>' +
                  (a.scanner_id ? ' <span class="sub mini">· ' + T.escapeHtml(a.scanner_id) + '</span>' : '') +
                '</td>' +
                '<td>' + levelBadge + '</td>' +
                '<td><code>' + T.escapeHtml(a.alert_code) + '</code>' +
                  (codeTitle ? '<div class="mini sub" style="margin:2px 0 0">' + T.escapeHtml(codeTitle) + '</div>' : '') +
                '</td>' +
                '<td>' + ticketCell + '</td>' +
                '<td class="mini">' + formatAlertDetail(a) + '</td>' +
              '</tr>'
            );
          }).join('');
        }
      }
    }

    async function fetchLiveOnce() {
      if (!mounted) return;
      try {
        var res = await T.authFetch('/api/dashboard/live', {
          headers: { 'Accept': 'application/json' },
          cache: 'no-store'
        });

        if (!mounted) return;

        if (res.status === 200) {
          var liveData = await res.json();
          setConnectionState(true);
          renderData(liveData);
          return;
        }

        var err = await T.readError(res);
        setConnectionState(false, (err.code ? err.code + ': ' : '') + err.message);
      } catch (e) {
        if (!mounted) return;
        if (e && e.code === 'SESSION_EXPIRED') return;
        setConnectionState(false, 'Không kết nối được tới máy chủ API');
      }
    }

    // Đợi request trước trả về rồi mới hẹn 1 giây kế tiếp để tránh chồng request
    function scheduleNext() {
      if (!mounted) return;
      pollTimer = setTimeout(async function () {
        await fetchLiveOnce();
        scheduleNext();
      }, POLL_INTERVAL_MS);
    }

    activeCleanup = function () {
      mounted = false;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      if (gateChart) {
        try { gateChart.destroy(); } catch (e) {}
        gateChart = null;
      }
    };

    initChart();
    fetchLiveOnce().then(scheduleNext);
  }
})();
