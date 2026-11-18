/* =====================================================================
   app.js — Khung giao diện sau đăng nhập (Phase 6 · Role D).

   - Bảo vệ phiên: không có phiên hợp lệ thì quay về trang đăng nhập.
   - Điều hướng theo vai trò (file 15 mục 0): GATE_OPERATOR chỉ thấy
     "Quét vé"; EVENT_SUPERVISOR thấy "Quản trị vé" và "In vé".
   - Bộ định tuyến theo location.hash: #scan, #tickets, #print.
   - Các nhãn/tiện ích dùng chung đặt trong window.TicketUI.
   ===================================================================== */
(function (global) {
  'use strict';

  var session = TicketAuth.requireAuth();
  if (!session) return;

  var role = (session.user && session.user.role) || '';

  /* ------------------- Tiện ích dùng chung ------------------- */
  var TicketUI = {};

  // fetch có gắn token + tự quay về đăng nhập khi 401.
  TicketUI.authFetch = TicketAuth.apiFetch;

  // Kết quả quét (file 07) — màu và chữ dễ phân biệt (Role D, 10/11).
  TicketUI.SCAN_RESULTS = {
    VALID:      { label: 'Cho vào',  detail: 'Vé hợp lệ',       cls: 'ok' },
    INVALID:    { label: 'Từ chối',  detail: 'Vé không hợp lệ',  cls: 'deny' },
    USED:       { label: 'Từ chối',  detail: 'Vé đã được dùng',  cls: 'deny' },
    CANCELLED:  { label: 'Từ chối',  detail: 'Vé đã bị thu hồi', cls: 'deny' },
    EXPIRED:    { label: 'Từ chối',  detail: 'Vé đã hết hạn',    cls: 'deny' },
    WRONG_GATE: { label: 'Từ chối',  detail: 'Sai cổng',         cls: 'warn' }
  };

  // Mã cảnh báo (file 07 / UC02).
  TicketUI.ALERT_CODES = {
    INVALID_QR:         'Mã QR sai chữ ký hoặc không hợp lệ',
    DUPLICATE_SCAN:     'Vé đã dùng, bị quét lại',
    IMPOSSIBLE_TRAVEL:  'Di chuyển bất thường giữa hai cổng',
    REVOKED_TICKET:     'Vé đã bị thu hồi',
    WRONG_GATE_WARNING: 'Vào nhầm cổng',
    WRONG_GATE_FRAUD:   'Cố tình dò nhiều cổng'
  };

  // Trạng thái vé (file 06).
  TicketUI.TICKET_STATUSES = {
    UNUSED:        'Chưa dùng',
    VALID_ENTRY:   'Đã vào',
    FLAGGED_FRAUD: 'Nghi gian lận',
    EXPIRED:       'Hết hạn',
    CANCELLED:     'Đã thu hồi'
  };

  TicketUI.statusLabel = function (s) {
    return TicketUI.TICKET_STATUSES[s] || s || '—';
  };

  TicketUI.statusClass = function (s) {
    return {
      UNUSED: 'st-unused',
      VALID_ENTRY: 'st-valid',
      FLAGGED_FRAUD: 'st-fraud',
      EXPIRED: 'st-expired',
      CANCELLED: 'st-cancelled'
    }[s] || 'st-unknown';
  };

  TicketUI.escapeHtml = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  // Giờ hiện tại ở Việt Nam (UTC+7, không DST), định dạng ISO 8601 kèm offset.
  TicketUI.nowVietnamISO = function () {
    return new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace('Z', '+07:00');
  };

  TicketUI.formatTime = function (iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('vi-VN');
  };

  // Đọc lỗi chuẩn { error: { code, message, details } } (file 15).
  TicketUI.readError = async function (res) {
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    var err = data && data.error;
    return {
      code: err && err.code ? err.code : ('HTTP_' + res.status),
      message: err && err.message ? err.message : ('Lỗi ' + res.status)
    };
  };

  TicketUI.fmt = function (str, args) {
    return String(str).replace(/\{(\d+)\}/g, function (m, i) {
      return args[i] == null ? '' : String(args[i]);
    });
  };

  global.TicketUI = TicketUI;

  /* ------------------- Đăng ký view ------------------- */
  var views = {};
  TicketUI.register = function (name, def) { views[name] = def; };

  /* ------------------- Điều hướng ------------------- */
  var NAV = [];
  if (role === 'GATE_OPERATOR') {
    NAV = [{ hash: 'scan', label: 'Quét vé' }];
  } else if (role === 'EVENT_SUPERVISOR') {
    NAV = [
      { hash: 'tickets', label: 'Quản trị vé' },
      { hash: 'print', label: 'In vé' }
    ];
  }

  var navEl = document.getElementById('nav');
  var viewEl = document.getElementById('view');

  function defaultHash() { return NAV.length ? NAV[0].hash : ''; }

  function renderNav(activeHash) {
    navEl.textContent = '';
    NAV.forEach(function (item) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn nav-item' + (item.hash === activeHash ? ' active' : '');
      b.textContent = item.label;
      b.addEventListener('click', function () { location.hash = item.hash; });
      navEl.appendChild(b);
    });
  }

  function route() {
    var hash = (location.hash || '').replace(/^#\/?/, '') || defaultHash();
    var view = views[hash];
    if (!view || !view.roles || view.roles.indexOf(role) === -1) {
      hash = defaultHash();
      view = views[hash];
    }
    if (!view) return;

    renderNav(hash);
    viewEl.textContent = '';
    view.mount(viewEl);
  }

  window.addEventListener('hashchange', route);

  /* ------------------- Thanh trên cùng ------------------- */
  var who = document.getElementById('who');
  who.textContent = TicketAuth.displayName(session) + (role ? ' · ' + role : '');

  document.getElementById('logout').addEventListener('click', function () {
    TicketAuth.clearSession();
    location.replace('index.html');
  });

  // Kiểm tra phiên định kỳ: token hết hạn thì quay về trang đăng nhập.
  setInterval(function () {
    if (!TicketAuth.hasValidSession()) TicketAuth.redirectToLogin();
  }, 5000);

  // Chờ tất cả script view (scan/tickets/print) đăng ký xong rồi mới điều hướng.
  window.addEventListener('DOMContentLoaded', route);
})(window);
