/* =====================================================================
   dashboard.js — Trang Dashboard giám sát trực tiếp (Phase 7 · Role D · D2).

   UC03 / F07 + file 14 mục 2.1 + file 15 mục 1.1:
   - Chỉ dành cho vai trò EVENT_SUPERVISOR.
   - Tự gọi GET /api/dashboard/live mỗi 1 giây (polling tuần tự, không chồng).
   - Hiển thị:
     + Tổng lượt quét và số lượng theo từng kết quả (6 loại scan_result).
     + Tỷ lệ gian lận (chỉ tính mức FRAUD = fraud_count / total_scans).
     + Biểu đồ theo cổng bằng Chart.js (vendor/chart.umd.js trong repo) + bảng chi tiết cổng.
     + Danh sách cảnh báo mới nhất: cổng, mức, mã cảnh báo, vé, chi tiết, giờ.
     + Thời điểm cập nhật gần nhất (Gold updated_at & thời điểm đồng bộ).
     + Báo rõ khi mất kết nối với API và giữ nguyên số liệu gần nhất (UC03).
   - Khi API /api/dashboard/live của Role C (C2) chưa sẵn sàng (404 NOT_FOUND):
     tự động dùng dữ liệu giả đúng cấu trúc file 15 mục 1.1.
   ===================================================================== */
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

  // Dữ liệu giả đúng chuẩn file 15 mục 1.1 (dùng khi C2 chưa ghép route).
  function getMockLiveData() {
    var nowIso = T.nowVietnamISO();
    return {
      generated_at: nowIso,
      event: {
        event_id: 'EV001',
        event_name: 'Concert Demo',
        admission_start: '2026-12-12T18:00:00.000+07:00',
        admission_end: '2026-12-12T20:00:00.000+07:00',
        gate_count: 4
      },
      totals: {
        total_scans: 1150,
        fraud_count: 20,
        warning_count: 28,
        fraud_rate: 0.0174,
        by_result: {
          VALID: 1100,
          INVALID: 6,
          USED: 9,
          CANCELLED: 3,
          EXPIRED: 2,
          WRONG_GATE: 30
        },
        updated_at: '2026-12-12T19:30:02.000+07:00'
      },
      gates: [
        {
          gate_id: 'GATE_A',
          gate_name: 'Cổng A',
          total_scans: 300,
          valid_entries: 286,
          rejected_scans: 14,
          fraud_count: 5,
          warning_count: 8,
          fraud_rate: 0.0167,
          last_scan_at: '2026-12-12T19:30:01.874+07:00',
          updated_at: '2026-12-12T19:30:02.000+07:00'
        },
        {
          gate_id: 'GATE_B',
          gate_name: 'Cổng B',
          total_scans: 320,
          valid_entries: 308,
          rejected_scans: 12,
          fraud_count: 4,
          warning_count: 7,
          fraud_rate: 0.0125,
          last_scan_at: '2026-12-12T19:30:00.510+07:00',
          updated_at: '2026-12-12T19:30:02.000+07:00'
        },
        {
          gate_id: 'GATE_C',
          gate_name: 'Cổng C',
          total_scans: 280,
          valid_entries: 268,
          rejected_scans: 12,
          fraud_count: 5,
          warning_count: 7,
          fraud_rate: 0.0179,
          last_scan_at: '2026-12-12T19:29:58.200+07:00',
          updated_at: '2026-12-12T19:30:02.000+07:00'
        },
        {
          gate_id: 'GATE_D',
          gate_name: 'Cổng D',
          total_scans: 250,
          valid_entries: 238,
          rejected_scans: 12,
          fraud_count: 6,
          warning_count: 6,
          fraud_rate: 0.024,
          last_scan_at: '2026-12-12T19:30:01.900+07:00',
          updated_at: '2026-12-12T19:30:02.000+07:00'
        }
      ],
      latest_alerts: [
        {
          scan_event_id: '6f1c2d1e-3b8a-4c55-9a1e-0d4c7e2b9f10',
          created_at: '2026-12-12T19:30:01.900+07:00',
          received_at: '2026-12-12T19:30:01.874+07:00',
          alert_level: 'FRAUD',
          alert_code: 'IMPOSSIBLE_TRAVEL',
          scan_result: 'USED',
          ticket_id: 'TK001',
          gate_id: 'GATE_D',
          scanner_id: 'SC_D1',
          previous_scan_gate_id: 'GATE_A',
          time_since_previous_scan_ms: 3000,
          min_travel_time_ms: 140000,
          ticket_assigned_gate_id: null,
          distinct_wrong_gate_count: null,
          raw_qr_preview: null
        },
        {
          scan_event_id: '4a9b8c7d-2e1f-4a33-8b2c-1f5e6d7c8a90',
          created_at: '2026-12-12T19:29:45.120+07:00',
          received_at: '2026-12-12T19:29:45.100+07:00',
          alert_level: 'FRAUD',
          alert_code: 'DUPLICATE_SCAN',
          scan_result: 'USED',
          ticket_id: 'TK002',
          gate_id: 'GATE_B',
          scanner_id: 'SC_B1',
          previous_scan_gate_id: 'GATE_B',
          time_since_previous_scan_ms: 1800000,
          min_travel_time_ms: null,
          ticket_assigned_gate_id: null,
          distinct_wrong_gate_count: null,
          raw_qr_preview: null
        },
        {
          scan_event_id: '3c8d7e6f-1a2b-4c44-9d3e-2a4b6c8d0e12',
          created_at: '2026-12-12T19:28:30.500+07:00',
          received_at: '2026-12-12T19:28:30.480+07:00',
          alert_level: 'WARNING',
          alert_code: 'WRONG_GATE_WARNING',
          scan_result: 'WRONG_GATE',
          ticket_id: 'TK006',
          gate_id: 'GATE_B',
          scanner_id: 'SC_B1',
          previous_scan_gate_id: null,
          time_since_previous_scan_ms: null,
          min_travel_time_ms: null,
          ticket_assigned_gate_id: 'GATE_A',
          distinct_wrong_gate_count: 1,
          raw_qr_preview: null
        },
        {
          scan_event_id: '2b7c6d5e-0f1a-4b55-8c4d-3b5c7d9e1f23',
          created_at: '2026-12-12T19:25:10.220+07:00',
          received_at: '2026-12-12T19:25:10.200+07:00',
          alert_level: 'FRAUD',
          alert_code: 'REVOKED_TICKET',
          scan_result: 'CANCELLED',
          ticket_id: 'TK003',
          gate_id: 'GATE_C',
          scanner_id: 'SC_C1',
          previous_scan_gate_id: null,
          time_since_previous_scan_ms: null,
          min_travel_time_ms: null,
          ticket_assigned_gate_id: null,
          distinct_wrong_gate_count: null,
          raw_qr_preview: null
        },
        {
          scan_event_id: '1a6b5c4d-9e0f-4a66-9b5e-4c6d8e0f2a34',
          created_at: '2026-12-12T19:20:05.050+07:00',
          received_at: '2026-12-12T19:20:05.020+07:00',
          alert_level: 'FRAUD',
          alert_code: 'INVALID_QR',
          scan_result: 'INVALID',
          ticket_id: null,
          gate_id: 'GATE_A',
          scanner_id: 'SC_A1',
          previous_scan_gate_id: null,
          time_since_previous_scan_ms: null,
          min_travel_time_ms: null,
          ticket_assigned_gate_id: null,
          distinct_wrong_gate_count: null,
          raw_qr_preview: 'TK005.forged_hmac_sig_00'
        },
        {
          scan_event_id: '0f5a4b3c-8d9e-4f77-8a6f-5d7e9f1a3b45',
          created_at: '2026-12-12T19:18:12.800+07:00',
          received_at: '2026-12-12T19:18:12.770+07:00',
          alert_level: 'FRAUD',
          alert_code: 'WRONG_GATE_FRAUD',
          scan_result: 'WRONG_GATE',
          ticket_id: 'TK007',
          gate_id: 'GATE_D',
          scanner_id: 'SC_D1',
          previous_scan_gate_id: null,
          time_since_previous_scan_ms: null,
          min_travel_time_ms: null,
          ticket_assigned_gate_id: 'GATE_C',
          distinct_wrong_gate_count: 3,
          raw_qr_preview: null
        }
      ]
    };
  }

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
        '<strong>Mất kết nối với API</strong> — Không lấy được dữ liệu mới từ <code>/api/dashboard/live</code>. ' +
        'Màn hình đang giữ lại số liệu gần nhất đã tải.' +
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
        '<div class="mock-badge" id="db-mock-badge" hidden>' +
          'Đang dùng dữ liệu giả theo file 15 mục 1.1 (API /api/dashboard/live chưa sẵn sàng)' +
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
    var mockBadge = root.querySelector('#db-mock-badge');
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

    // Khởi tạo sẵn 6 ô kết quả để chỉ cập nhật số, tránh dựng lại DOM mỗi giây.
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

    // Khởi tạo biểu đồ Chart.js một lần duy nhất, tắt animation để không giật khi đo tải.
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

    function setConnectionState(connected, isMock, reason) {
      if (connected) {
        connBanner.hidden = true;
        connPill.className = 'db-conn-pill ok';
        connText.textContent = isMock
          ? 'Chế độ dữ liệu giả (1 giây/lần)'
          : 'Đang kết nối trực tiếp (1 giây/lần)';
        mockBadge.hidden = !isMock;
      } else {
        connBanner.hidden = false;
        if (reason) {
          connBanner.innerHTML =
            '<strong>Mất kết nối với API</strong> — ' + T.escapeHtml(reason) +
            '. Màn hình đang giữ lại số liệu gần nhất đã tải.';
        }
        connPill.className = 'db-conn-pill down';
        connText.textContent = 'Mất kết nối với API';
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

      // 1. Thông tin sự kiện & thời gian cập nhật
      var ev = data.event || {};
      if (ev.event_id) {
        eventTitleEl.textContent = 'Dashboard giám sát — ' + ev.event_id +
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

      // 2. Các ô tổng quan (KPI)
      totalScansEl.textContent = Number(totals.total_scans || 0).toLocaleString('vi-VN');
      fraudRateEl.textContent = T.formatRate(totals.fraud_rate || 0);
      fraudCountEl.textContent = Number(totals.fraud_count || 0).toLocaleString('vi-VN');
      warningCountEl.textContent = Number(totals.warning_count || 0).toLocaleString('vi-VN');

      // 3. Số lượng theo từng kết quả (6 giá trị scan_result)
      var byResult = totals.by_result || {};
      RESULT_ORDER.forEach(function (code) {
        if (resultValEls[code]) {
          resultValEls[code].textContent = Number(byResult[code] || 0).toLocaleString('vi-VN');
        }
      });

      // 4. Biểu đồ theo cổng & bảng theo cổng
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

      // 5. Danh sách cảnh báo mới nhất
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
          setConnectionState(true, false);
          renderData(liveData);
          return;
        }

        var err = await T.readError(res);
        // Nếu endpoint /api/dashboard/live chưa được C2 tạo (404 NOT_FOUND), dùng dữ liệu giả.
        if (res.status === 404 && err.code !== 'EVENT_NOT_FOUND') {
          setConnectionState(true, true);
          renderData(getMockLiveData());
          return;
        }

        // Lỗi 503 DASHBOARD_DATA_UNAVAILABLE hoặc lỗi khác: báo mất kết nối và giữ số liệu cũ.
        if (!hasRenderedData) renderData(getMockLiveData());
        setConnectionState(false, false, (err.code ? err.code + ': ' : '') + err.message);
      } catch (e) {
        if (!mounted) return;
        if (e && e.code === 'SESSION_EXPIRED') return;
        // Mất kết nối mạng tới API: nếu chưa có số liệu nào thì nạp khung dữ liệu mẫu, rồi báo rõ mất kết nối.
        if (!hasRenderedData) renderData(getMockLiveData());
        setConnectionState(false, false, 'Không kết nối được tới máy chủ API');
      }
    }

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
        try { gateChart.destroy(); } catch (e) { /* bỏ qua */ }
        gateChart = null;
      }
    };

    initChart();
    fetchLiveOnce().then(scheduleNext);
  }
})();
