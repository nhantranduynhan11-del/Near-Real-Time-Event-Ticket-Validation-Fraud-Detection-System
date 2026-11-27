// Khung điều hướng theo vai trò và các hàm dùng chung trên giao diện
(function (global) {
  'use strict';

  var session = TicketAuth.requireAuth();
  if (!session) return;

  var role = (session.user && session.user.role) || '';

  var TicketUI = {};

  TicketUI.authFetch = TicketAuth.apiFetch;

  TicketUI.SCAN_RESULTS = {
    VALID:      { label: 'Cho vào',  detail: 'Vé hợp lệ',       cls: 'ok' },
    INVALID:    { label: 'Từ chối',  detail: 'Vé không hợp lệ',  cls: 'deny' },
    USED:       { label: 'Từ chối',  detail: 'Vé đã được dùng',  cls: 'deny' },
    CANCELLED:  { label: 'Từ chối',  detail: 'Vé đã bị thu hồi', cls: 'deny' },
    EXPIRED:    { label: 'Từ chối',  detail: 'Vé đã hết hạn',    cls: 'deny' },
    WRONG_GATE: { label: 'Từ chối',  detail: 'Sai cổng',         cls: 'warn' }
  };

  TicketUI.ALERT_CODES = {
    INVALID_QR:         'Mã QR sai chữ ký hoặc không hợp lệ',
    DUPLICATE_SCAN:     'Vé đã vào rồi',
    IMPOSSIBLE_TRAVEL:  'Hai người dùng chung vé',
    REVOKED_TICKET:     'Vé đã bị thu hồi',
    WRONG_GATE_WARNING: 'Vào nhầm cổng',
    WRONG_GATE_FRAUD:   'Cố tình dò nhiều cổng'
  };

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

  // Cộng 7 tiếng để tạo chuỗi ISO 8601 theo giờ Việt Nam có đuôi +07:00
  TicketUI.nowVietnamISO = function () {
    return new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace('Z', '+07:00');
  };

  TicketUI.formatTime = function (iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('vi-VN');
  };

  TicketUI.formatSeconds = function (ms) {
    if (ms == null || isNaN(Number(ms))) return null;
    var sec = Math.max(0, Math.round(Number(ms) / 1000));
    return sec + ' giây';
  };

  TicketUI.formatRate = function (rate) {
    var n = Number(rate);
    if (rate == null || isNaN(n)) return '0,00%';
    return (n * 100).toFixed(2).replace('.', ',') + '%';
  };

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

  var views = {};
  TicketUI.register = function (name, def) { views[name] = def; };

  var NAV = [];
  if (role === 'GATE_OPERATOR') {
    NAV = [{ hash: 'scan', label: 'Quét vé' }];
  } else if (role === 'EVENT_SUPERVISOR') {
    NAV = [
      { hash: 'dashboard', label: 'Dashboard' },
      { hash: 'tickets', label: 'Quản trị vé' },
      { hash: 'print', label: 'In vé' }
    ];
  }

  var navEl = document.getElementById('nav');
  var viewEl = document.getElementById('view');
  var activeView = null;

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

    // Dọn timer hoặc camera của tab trước khi chuyển sang tab mới
    if (activeView && typeof activeView.unmount === 'function') {
      try { activeView.unmount(); } catch (e) {}
    }
    activeView = view;

    renderNav(hash);
    viewEl.textContent = '';
    view.mount(viewEl);
  }

  window.addEventListener('hashchange', route);

  var who = document.getElementById('who');
  who.textContent = TicketAuth.displayName(session) + (role ? ' · ' + role : '');

  document.getElementById('logout').addEventListener('click', function () {
    TicketAuth.clearSession();
    location.replace('index.html');
  });

  setInterval(function () {
    if (!TicketAuth.hasValidSession()) TicketAuth.redirectToLogin();
  }, 5000);

  window.addEventListener('DOMContentLoaded', route);
})(window);
