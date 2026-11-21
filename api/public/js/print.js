/* =====================================================================
   print.js — Trang in vé (Phase 6 · Role D · 10/11).

   - Chọn vé (gõ mã hoặc bấm gợi ý).
   - Gọi GET /api/tickets/:id/qr (file 15 mục 3.8) lấy chuỗi QR đã ký.
   - Vẽ ảnh QR bằng thư viện sinh QR trong repo (vendor/qrcode.js).
   - In ra rồi quét lại được (POST /api/scan).
   ===================================================================== */
(function () {
  'use strict';

  var T = window.TicketUI;

  var MOCK_TICKETS = [
    { ticket_id: 'TK001', event_id: 'EV001', ticket_status: 'UNUSED' },
    { ticket_id: 'TK002', event_id: 'EV001', ticket_status: 'UNUSED' },
    { ticket_id: 'TK003', event_id: 'EV001', ticket_status: 'CANCELLED' },
    { ticket_id: 'TK004', event_id: 'EV001', ticket_status: 'UNUSED' },
    { ticket_id: 'TK005', event_id: 'EV002', ticket_status: 'UNUSED' },
    { ticket_id: 'TK006', event_id: 'EV001', ticket_status: 'UNUSED' },
    { ticket_id: 'TK007', event_id: 'EV001', ticket_status: 'UNUSED' }
  ];

  function isMockSession() {
    var s = window.TicketAuth && TicketAuth.getSession && TicketAuth.getSession();
    return !!(s && typeof s.access_token === 'string' &&
      s.access_token.indexOf('.bW9jay1zaWduYXR1cmU') !== -1);
  }

  T.register('print', {
    title: 'In vé',
    roles: ['EVENT_SUPERVISOR'],
    mount: mount
  });

  function mount(root) {
    root.innerHTML =
      '<div class="grid">' +
        '<section class="card section">' +
          '<h2>Chọn vé để in</h2>' +
          '<div class="form-row">' +
            '<label class="field">Mã vé' +
              '<input id="print-id" type="text" placeholder="TK001" autocapitalize="characters" spellcheck="false">' +
            '</label>' +
            '<div class="field" style="align-self:flex-end">' +
              '<button id="print-load" type="button" class="btn btn-primary">Tạo mã QR</button>' +
            '</div>' +
          '</div>' +
          '<p class="sub">Gợi ý (bấm để chọn):</p>' +
          '<div id="print-suggestions" class="chip-list">Đang tải…</div>' +
          '<p class="form-error" id="print-error" role="alert" hidden></p>' +
        '</section>' +

        '<section class="card section" id="print-out" hidden>' +
          '<div class="print-card" id="print-area">' +
            '<div class="print-brand">Ticket Control</div>' +
            '<canvas id="print-qr"></canvas>' +
            '<div class="print-ticket-id" id="print-ticket-id"></div>' +
            '<div class="print-note">Vé hợp lệ — soát tại cổng ghi trên vé</div>' +
          '</div>' +
          '<div class="foot">' +
            '<button id="print-print" type="button" class="btn btn-primary">In vé</button>' +
            '<span class="sub" id="print-when" style="margin:0"></span>' +
          '</div>' +
        '</section>' +
      '</div>';

    var idInput = root.querySelector('#print-id');
    var loadBtn = root.querySelector('#print-load');
    var suggEl = root.querySelector('#print-suggestions');
    var errEl = root.querySelector('#print-error');
    var outEl = root.querySelector('#print-out');
    var qrCanvas = root.querySelector('#print-qr');
    var idLabel = root.querySelector('#print-ticket-id');
    var printBtn = root.querySelector('#print-print');
    var whenEl = root.querySelector('#print-when');

    function showError(msg) {
      errEl.textContent = msg;
      errEl.hidden = false;
    }
    function clearError() { errEl.textContent = ''; errEl.hidden = true; }

    // Gợi ý: 50 vé đầu để bấm chọn nhanh.
    async function loadSuggestions() {
      try {
        var res = await T.authFetch('/api/tickets?page=1&page_size=50');
        if (!res.ok) throw new Error((await T.readError(res)).message);
        var data = await res.json();
        suggEl.textContent = '';
        if (!data.items || data.items.length === 0) {
          suggEl.textContent = 'Chưa có vé nào.';
          return;
        }
        data.items.forEach(function (t) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'chip';
          b.textContent = t.ticket_id;
          b.title = t.event_id + ' · ' + T.statusLabel(t.ticket_status);
          b.addEventListener('click', function () {
            idInput.value = t.ticket_id;
            loadQr(t.ticket_id);
          });
          suggEl.appendChild(b);
        });
        if (data.total > data.items.length) {
          var more = document.createElement('span');
          more.className = 'sub';
          more.textContent = ' (còn ' + (data.total - data.items.length) + ' vé, gõ mã để chọn)';
          suggEl.appendChild(more);
        }
      } catch (e) {
        if (isMockSession()) {
          suggEl.textContent = '';
          MOCK_TICKETS.forEach(function (t) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'chip';
            b.textContent = t.ticket_id;
            b.title = t.event_id + ' · ' + T.statusLabel(t.ticket_status);
            b.addEventListener('click', function () {
              idInput.value = t.ticket_id;
              loadQr(t.ticket_id);
            });
            suggEl.appendChild(b);
          });
          return;
        }
        suggEl.textContent = 'Không tải được danh sách vé: ' + e.message;
      }
    }

    function renderQr(payload) {
      if (!window.qrcode) {
        showError('Thư viện sinh QR (qrcode.js) chưa được nạp.');
        return;
      }
      var qr = qrcode(0, 'M'); // 0 = tự chọn cỡ, sửa lỗi M
      qr.addData(payload);
      qr.make();

      var cellSize = 6;
      var margin = 4;
      var count = qr.getModuleCount();
      var size = (count + margin * 2) * cellSize;
      qrCanvas.width = size;
      qrCanvas.height = size;
      var ctx = qrCanvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#000000';
      for (var r = 0; r < count; r++) {
        for (var c = 0; c < count; c++) {
          if (qr.isDark(r, c)) {
            ctx.fillRect((c + margin) * cellSize, (r + margin) * cellSize, cellSize, cellSize);
          }
        }
      }
    }

    async function loadQr(ticketId) {
      clearError();
      ticketId = (ticketId || idInput.value || '').trim().toUpperCase();
      if (!ticketId) { showError('Nhập mã vé.'); return; }

      loadBtn.disabled = true;
      try {
        var res = await T.authFetch('/api/tickets/' + encodeURIComponent(ticketId) + '/qr');
        if (!res.ok) {
          var err = await T.readError(res);
          showError((err.code ? err.code + ': ' : '') + err.message);
          return;
        }
        var data = await res.json();
        renderQr(data.qr_payload);
        idLabel.textContent = data.ticket_id;
        outEl.hidden = false;
        whenEl.textContent = 'Tạo lúc ' + new Date().toLocaleTimeString('vi-VN');
      } catch (e) {
        if (isMockSession()) {
          var mockPayload = ticketId + '.m9f3a8b7c6d5e4f3a2b1c0';
          renderQr(mockPayload);
          idLabel.textContent = ticketId;
          outEl.hidden = false;
          whenEl.textContent = 'Tạo lúc ' + new Date().toLocaleTimeString('vi-VN') + ' (mã QR giả lập)';
          return;
        }
        showError('Không tải được mã QR: ' + (e && e.message ? e.message : e));
      } finally {
        loadBtn.disabled = false;
      }
    }

    loadBtn.addEventListener('click', function () { loadQr(); });
    idInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); loadQr(); }
    });
    printBtn.addEventListener('click', function () { window.print(); });

    loadSuggestions();
  }
})();
