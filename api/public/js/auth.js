// Quản lý phiên đăng nhập JWT lưu trong localStorage
(function (global) {
  'use strict';

  var STORAGE_KEY = 'ticket_control.session';
  var LOGIN_PAGE = 'index.html';

  function b64urlDecode(str) {
    var b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return decodeURIComponent(escape(atob(b64)));
  }

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
    } catch (e) {}
  }

  function clearSession() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }

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

  // Claim exp của JWT tính bằng giây
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

  function displayName(session) {
    var u = session && session.user;
    if (!u) return '';
    var name = ((u.last_name ? u.last_name + ' ' : '') + (u.first_name || '')).trim();
    return name || u.username || u.user_id || '';
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
      return {
        ok: false,
        code: 'NETWORK_ERROR',
        message: 'Không kết nối được tới máy chủ API.'
      };
    }

    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }

    if (res.ok && data && data.access_token) {
      return { ok: true, session: data };
    }

    return {
      ok: false,
      code: (data && data.error && data.error.code) || 'INTERNAL_ERROR',
      message: (data && data.error && data.error.message) || ''
    };
  }

  // Tự gắn Bearer token; nếu nhận 401 thì xóa phiên và quay lại trang đăng nhập
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
