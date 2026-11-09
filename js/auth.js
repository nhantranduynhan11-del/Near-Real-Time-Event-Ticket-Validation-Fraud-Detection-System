/* =====================================================================
   auth.js — Tiện ích đăng nhập dùng chung cho toàn bộ giao diện.

   Nhiệm vụ Phase 5 · Role D (GIAO DIỆN) · Thứ Sáu 6/11:
   - Lưu token nhận từ POST /api/login vào localStorage.
   - Giải mã JWT để đọc claim `exp`, tự biết token hết hạn.
   - Gọi API có gắn header Authorization: Bearer; gặp 401 thì quay về
     trang đăng nhập.
   - Trước khi API /api/login của Role C xong: tự dùng dữ liệu giả
     (tài khoản demo khớp seed.sql mục 6, mật khẩu Demo@123).
     Khi endpoint /api/login đã có, trang tự chuyển sang API thật,
     không cần sửa code.

   Cấu trúc token thật theo file 15 mục 0: JWT, claim `sub` = user_id,
   `role` = vai trò, thời hạn 12 giờ.
   ===================================================================== */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'ticket_control.session';
  var LOGIN_PAGE = 'index.html';

  // Thời hạn token giả (giây) = 12 giờ, khớp JWT_EXPIRES_IN của file 15.
  var MOCK_EXPIRES_IN_SECONDS = 43200;

  // Tài khoản demo — khớp database/seed.sql mục 6.
  var MOCK_PASSWORD = 'Demo@123';
  var MOCK_USERS = {
    op_gate_a:  { user_id: 'OP_A', username: 'op_gate_a',  last_name: 'Nguyễn', first_name: 'An',    role: 'GATE_OPERATOR' },
    op_gate_b:  { user_id: 'OP_B', username: 'op_gate_b',  last_name: 'Trần',   first_name: 'Bình',  role: 'GATE_OPERATOR' },
    op_gate_c:  { user_id: 'OP_C', username: 'op_gate_c',  last_name: 'Lê',     first_name: 'Chi',   role: 'GATE_OPERATOR' },
    op_gate_d:  { user_id: 'OP_D', username: 'op_gate_d',  last_name: 'Phạm',   first_name: 'Dũng',  role: 'GATE_OPERATOR' },
    supervisor: { user_id: 'SUP1', username: 'supervisor', last_name: 'Võ',     first_name: 'Giang', role: 'EVENT_SUPERVISOR' }
  };

  /* ----- base64url (an toàn với UTF-8) ----- */
  function b64urlEncode(str) {
    var b64 = btoa(unescape(encodeURIComponent(str)));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlDecode(str) {
    var b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return decodeURIComponent(escape(atob(b64)));
  }

  /* ----- Quản lý phiên ----- */
  function getSession() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveSession(session) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch (e) { /* localStorage không dùng được: bỏ qua */ }
  }

  function clearSession() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* bỏ qua */ }
  }

  /* ----- JWT ----- */
  function decodeJwt(token) {
    if (typeof token !== 'string') return null;
    var parts = token.split('.');
    if (parts.length < 2) return null;
    try {
      return JSON.parse(b64urlDecode(parts[1]));
    } catch (e) {
      return null;
    }
  }

  // Hết hạn khi thời điểm hiện tại đã qua `exp` (giây kể từ epoch).
  function isExpired(token) {
    var payload = decodeJwt(token);
    if (!payload || typeof payload.exp !== 'number') return false;
    return Date.now() >= payload.exp * 1000;
  }

  function hasValidSession() {
    var s = getSession();
    return !!(s && typeof s.access_token === 'string' && s.access_token &&
              !isExpired(s.access_token));
  }

  function isOnLoginPage() {
    var p = (location.pathname || '').replace(/\/+$/, '');
    return p === '' || p === '/' || /\/index\.html$/.test(p);
  }

  function redirectToLogin() {
    clearSession();
    if (!isOnLoginPage()) location.replace(LOGIN_PAGE);
  }

  // Tên hiển thị: "Họ Tên" (ví dụ "Nguyễn An"), thiếu thì dùng username.
  function displayName(session) {
    var u = session && session.user;
    if (!u) return '';
    var name = ((u.last_name ? u.last_name + ' ' : '') + (u.first_name || '')).trim();
    return name || u.username || u.user_id || '';
  }

  /* ----- Đăng nhập (API thật, fallback dữ liệu giả) ----- */
  function mockResult(username, password) {
    var u = MOCK_USERS[username];
    if (!u || password !== MOCK_PASSWORD) {
      return { ok: false, mock: true, code: 'INVALID_CREDENTIALS' };
    }
    var now = Math.floor(Date.now() / 1000);
    var header = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    var payload = b64urlEncode(JSON.stringify({
      sub: u.user_id,
      role: u.role,
      iat: now,
      exp: now + MOCK_EXPIRES_IN_SECONDS
    }));
    var token = header + '.' + payload + '.' + b64urlEncode('mock-signature');
    return {
      ok: true,
      mock: true,
      session: {
        access_token: token,
        token_type: 'Bearer',
        expires_in: MOCK_EXPIRES_IN_SECONDS,
        user: {
          user_id: u.user_id,
          username: u.username,
          last_name: u.last_name,
          first_name: u.first_name,
          role: u.role
        }
      }
    };
  }

  async function login(username, password) {
    var res;
    try {
      res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password })
      });
    } catch (e) {
      res = null; // không nối được API
    }

    // Endpoint /api/login chưa có (404) hoặc API không nối được → dữ liệu giả.
    if (!res || res.status === 404) {
      return mockResult(username, password);
    }

    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }

    if (res.ok && data && data.access_token) {
      return { ok: true, mock: false, session: data };
    }

    return {
      ok: false,
      mock: false,
      code: (data && data.error && data.error.code) || 'INTERNAL_ERROR',
      message: (data && data.error && data.error.message) || ''
    };
  }

  // fetch có gắn token. Gặp 401 (thiếu token / token hết hạn) → quay về đăng nhập.
  async function apiFetch(url, options) {
    var opts = options || {};
    var headers = Object.assign({}, opts.headers || {});
    var s = getSession();
    if (s && s.access_token) headers.Authorization = 'Bearer ' + s.access_token;

    var res = await fetch(url, Object.assign({}, opts, { headers: headers }));

    if (res.status === 401) {
      redirectToLogin();
      var err = new Error('Phiên đăng nhập đã hết hạn.');
      err.code = 'SESSION_EXPIRED';
      throw err;
    }
    return res;
  }

  // Chặn màn hình cần đăng nhập: không có phiên hợp lệ thì quay về đăng nhập.
  function requireAuth() {
    if (!hasValidSession()) {
      redirectToLogin();
      return null;
    }
    return getSession();
  }

  global.TicketAuth = {
    LOGIN_PAGE: LOGIN_PAGE,
    getSession: getSession,
    saveSession: saveSession,
    clearSession: clearSession,
    decodeJwt: decodeJwt,
    isExpired: isExpired,
    hasValidSession: hasValidSession,
    login: login,
    apiFetch: apiFetch,
    requireAuth: requireAuth,
    redirectToLogin: redirectToLogin,
    displayName: displayName
  };
})(window);
