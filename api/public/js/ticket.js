/* =====================================================================
   tickets.js — Trang quản trị vé (Phase 6 · Role D · 12/11).

   UC04 + file 15 mục 3:
   - Danh sách vé (GET /api/tickets), tìm kiếm + lọc trạng thái, phân trang.
   - Thêm vé (POST /api/tickets), sửa cổng (PUT /api/tickets/:id),
     xóa (DELETE /api/tickets/:id), thu hồi (POST /api/tickets/:id/cancel).
   - Xem lịch sử quét của một vé (GET /api/tickets/:id).
   ===================================================================== */
(function () {
  'use strict';

  var T = window.TicketUI;

  T.register('tickets', {
    title: 'Quản trị vé',
    roles: ['EVENT_SUPERVISOR'],
    mount: mount
  });

  function mount(root) {
    var STATUS_OPTIONS = Object.keys(T.TICKET_STATUSES);

    root.innerHTML =
      '<section class="card section">' +
        '<h2>Quản trị vé</h2>' +
        '<div class="toolbar">' +
          '<input id="tk-q" class="input" type="text" placeholder="Tìm mã vé (tiền tố)…" autocapitalize="characters" spellcheck="false">' +
          '<select id="tk-status" class="input">' +
            '<option value="">Mọi trạng thái</option>' +
            STATUS_OPTIONS.map(function (s) {
              return '<option value="' + s + '">' + s + ' · ' + T.statusLabel(s) + '</option>';
            }).join('') +
          '</select>' +
          '<button id="tk-search" type="button" class="btn">Tìm</button>' +
          '<button id="tk-reset" type="button" class="btn">Xóa lọc</button>' +
          '<span class="spacer"></span>' +
          '<button id="tk-add-toggle" type="button" class="btn btn-primary">+ Thêm vé</button>' +
        '</div>' +

        '<div id="tk-add-panel" class="add-panel" hidden>' +
          '<h3>Thêm vé mới</h3>' +
          '<div class="form-row">' +
            '<label class="field">Mã vé <span class="req">*</span>' +
              '<input id="tk-add-id" type="text" placeholder="TK010" autocapitalize="characters" spellcheck="false">' +
            '</label>' +
            '<label class="field">Sự kiện <span class="req">*</span>' +
              '<select id="tk-add-event"></select>' +
            '</label>' +
            '<label class="field">Cổng (bỏ trống = cổng nào cũng được)' +
              '<select id="tk-add-gate"><option value="">— Không giới hạn —</option></select>' +
            '</label>' +
          '</div>' +
          '<div class="foot">' +
            '<button id="tk-add-submit" type="button" class="btn btn-primary">Tạo vé</button>' +
            '<button id="tk-add-cancel" type="button" class="btn">Hủy</button>' +
            '<span id="tk-add-msg" class="form-error" hidden></span>' +
          '</div>' +
        '</div>' +

        '<div class="table-wrap">' +
          '<table class="table">' +
            '<thead><tr>' +
              '<th>Mã vé</th><th>Sự kiện</th><th>Cổng</th><th>Trạng thái</th><th class="th-actions">Thao tác</th>' +
            '</tr></thead>' +
            '<tbody id="tk-rows"><tr><td colspan="5" class="empty">Đang tải…</td></tr></tbody>' +
          '</table>' +
        '</div>' +

        '<div class="pager">' +
          '<button id="tk-prev" type="button" class="btn">Trước</button>' +
          '<span id="tk-page-info" class="sub" style="margin:0"></span>' +
          '<button id="tk-next" type="button" class="btn">Sau</button>' +
        '</div>' +
        '<p class="form-error" id="tk-error" role="alert" hidden></p>' +
      '</section>' +

      '<section class="card section" id="tk-detail" hidden></section>' +

      '<div class="overlay" id="tk-modal" hidden>' +
        '<div class="modal card">' +
          '<h3 id="tk-modal-title">Sửa cổng</h3>' +
          '<div id="tk-modal-body"></div>' +
          '<div class="modal-foot">' +
            '<button id="tk-modal-cancel" type="button" class="btn">Hủy</button>' +
            '<button id="tk-modal-ok" type="button" class="btn btn-primary">Lưu</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    // ----- Tham chiếu DOM -----
    var qInput = root.querySelector('#tk-q');
    var statusSel = root.querySelector('#tk-status');
    var searchBtn = root.querySelector('#tk-search');
    var resetBtn = root.querySelector('#tk-reset');
    var addToggle = root.querySelector('#tk-add-toggle');
    var addPanel = root.querySelector('#tk-add-panel');
    var addId = root.querySelector('#tk-add-id');
    var addEvent = root.querySelector('#tk-add-event');
    var addGate = root.querySelector('#tk-add-gate');
    var addSubmit = root.querySelector('#tk-add-submit');
    var addCancel = root.querySelector('#tk-add-cancel');
    var addMsg = root.querySelector('#tk-add-msg');
    var rowsEl = root.querySelector('#tk-rows');
    var prevBtn = root.querySelector('#tk-prev');
    var nextBtn = root.querySelector('#tk-next');
    var pageInfo = root.querySelector('#tk-page-info');
    var errEl = root.querySelector('#tk-error');
    var detailEl = root.querySelector('#tk-detail');
    var modal = root.querySelector('#tk-modal');
    var modalTitle = root.querySelector('#tk-modal-title');
    var modalBody = root.querySelector('#tk-modal-body');
    var modalOk = root.querySelector('#tk-modal-ok');
    var modalCancel = root.querySelector('#tk-modal-cancel');

    var state = { q: '', status: '', page: 1, pageSize: 50, total: 0, pages: 1 };
    var gates = [];
    var events = [];

    function showListError(msg) { errEl.textContent = msg; errEl.hidden = false; }
    function clearListError() { errEl.textContent = ''; errEl.hidden = true; }

    /* ---------- Nạp dữ liệu nền (cổng + sự kiện) ---------- */
    async function loadMeta() {
      try {
        var gRes = await T.authFetch('/api/gates');
        var eRes = await T.authFetch('/api/events?page=1&page_size=200');
        gates = gRes.ok ? await gRes.json() : [];
        events = eRes.ok ? (await eRes.json()).items : [];

        addGate.textContent = '';
        var ph0 = document.createElement('option');
        ph0.value = ''; ph0.textContent = '— Không giới hạn —';
        addGate.appendChild(ph0);
        gates.forEach(function (g) {
          var o = document.createElement('option');
          o.value = g.gate_id;
          o.textContent = g.gate_id + ' · ' + (g.gate_name || '');
          addGate.appendChild(o);
        });

        addEvent.textContent = '';
        events.forEach(function (e) {
          var o = document.createElement('option');
          o.value = e.event_id;
          o.textContent = e.event_id + ' · ' + (e.event_name || '');
          addEvent.appendChild(o);
        });
      } catch (e) {
        /* không chặn danh sách vé nếu meta lỗi */
      }
    }

    function gateOptionsForEvent(eventId, selected) {
      var ev = events.find(function (e) { return e.event_id === eventId; });
      var ids = ev && ev.gate_ids ? ev.gate_ids : gates.map(function (g) { return g.gate_id; });
      return ids.map(function (gid) {
        var name = gid;
        var g = gates.find(function (x) { return x.gate_id === gid; });
        if (g && g.gate_name) name = gid + ' · ' + g.gate_name;
        var sel = gid === selected ? ' selected' : '';
        return '<option value="' + gid + '"' + sel + '>' + T.escapeHtml(name) + '</option>';
      }).join('');
    }

    /* ---------- Danh sách vé ---------- */
    async function loadTickets() {
      clearListError();
      rowsEl.innerHTML = '<tr><td colspan="5" class="empty">Đang tải…</td></tr>';

      var qs = new URLSearchParams({
        page: String(state.page),
        page_size: String(state.pageSize)
      });
      if (state.q) qs.set('q', state.q);
      if (state.status) qs.set('ticket_status', state.status);

      try {
        var res = await T.authFetch('/api/tickets?' + qs.toString());
        if (!res.ok) {
          var err = await T.readError(res);
          showListError((err.code ? err.code + ': ' : '') + err.message);
          rowsEl.innerHTML = '';
          return;
        }
        var data = await res.json();
        state.total = data.total || 0;
        state.pages = Math.max(1, Math.ceil(state.total / state.pageSize));
        renderRows(data.items || []);
        renderPager();
      } catch (e) {
        showListError('Không tải được danh sách vé: ' + (e && e.message ? e.message : e));
        rowsEl.innerHTML = '';
      }
    }

    function renderRows(items) {
      rowsEl.textContent = '';
      if (!items.length) {
        rowsEl.innerHTML = '<tr><td colspan="5" class="empty">Không có vé nào.</td></tr>';
        return;
      }
      items.forEach(function (t) {
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td><code>' + T.escapeHtml(t.ticket_id) + '</code></td>' +
          '<td>' + T.escapeHtml(t.event_id) + '</td>' +
          '<td>' + (t.assigned_gate_id ? T.escapeHtml(t.assigned_gate_id) : '—') + '</td>' +
          '<td><span class="badge ' + T.statusClass(t.ticket_status) + '">' +
            T.escapeHtml(T.statusLabel(t.ticket_status)) + '</span></td>' +
          '<td class="actions">' +
            '<button data-act="view" class="btn btn-sm">Xem</button>' +
            '<button data-act="edit" class="btn btn-sm">Sửa</button>' +
            '<button data-act="cancel" class="btn btn-sm">Thu hồi</button>' +
            '<button data-act="delete" class="btn btn-sm btn-danger">Xóa</button>' +
          '</td>';

        tr.querySelector('[data-act="view"]').addEventListener('click', function () { showDetail(t); });
        tr.querySelector('[data-act="edit"]').addEventListener('click', function () { openEdit(t); });
        tr.querySelector('[data-act="cancel"]').addEventListener('click', function () { doCancel(t); });
        tr.querySelector('[data-act="delete"]').addEventListener('click', function () { doDelete(t); });
        rowsEl.appendChild(tr);
      });
    }

    function renderPager() {
      pageInfo.textContent = 'Trang ' + state.page + ' / ' + state.pages + ' · ' + state.total + ' vé';
      prevBtn.disabled = state.page <= 1;
      nextBtn.disabled = state.page >= state.pages;
    }

    /* ---------- Thêm vé ---------- */
    function resetAddForm() {
      addId.value = '';
      addEvent.selectedIndex = 0;
      addGate.selectedIndex = 0;
      addMsg.hidden = true;
    }

    addToggle.addEventListener('click', function () {
      addPanel.hidden = !addPanel.hidden;
      if (!addPanel.hidden) { resetAddForm(); addId.focus(); }
    });
    addCancel.addEventListener('click', function () { addPanel.hidden = true; });

    addSubmit.addEventListener('click', async function () {
      addMsg.hidden = true;
      var ticketId = addId.value.trim().toUpperCase();
      var eventId = addEvent.value;
      var gateId = addGate.value || null;

      if (!ticketId) { addMsg.textContent = 'Nhập mã vé.'; addMsg.hidden = false; return; }
      if (!eventId) { addMsg.textContent = 'Chưa có sự kiện để chọn.'; addMsg.hidden = false; return; }

      var body = { ticket_id: ticketId, event_id: eventId };
      if (gateId) body.assigned_gate_id = gateId;

      addSubmit.disabled = true;
      try {
        var res = await T.authFetch('/api/tickets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (res.ok) {
          resetAddForm();
          addPanel.hidden = true;
          state.q = ticketId;
          state.page = 1;
          qInput.value = ticketId;
          statusSel.value = '';
          state.status = '';
          await loadTickets();
        } else {
          var err = await T.readError(res);
          addMsg.textContent = (err.code ? err.code + ': ' : '') + err.message;
          addMsg.hidden = false;
        }
      } catch (e) {
        addMsg.textContent = 'Không tạo được vé: ' + (e && e.message ? e.message : e);
        addMsg.hidden = false;
      } finally {
        addSubmit.disabled = false;
      }
    });

    /* ---------- Sửa (đổi cổng) ---------- */
    function openEdit(t) {
      modalTitle.textContent = 'Sửa cổng của ' + t.ticket_id;
      modalBody.innerHTML =
        '<label class="field">Cổng' +
          '<select id="tk-edit-gate">' +
            '<option value="">— Không giới hạn —</option>' +
            gateOptionsForEvent(t.event_id, t.assigned_gate_id) +
          '</select>' +
        '</label>' +
        '<p class="sub">Chỉ sửa được vé còn trạng thái "Chưa dùng" (UNUSED).</p>';
      modal.hidden = false;

      var onOk = async function () {
        var newGate = modalBody.querySelector('#tk-edit-gate').value || null;
        modalOk.disabled = true;
        try {
          var res = await T.authFetch('/api/tickets/' + encodeURIComponent(t.ticket_id), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assigned_gate_id: newGate })
          });
          if (res.ok) {
            closeModal();
            await loadTickets();
          } else {
            var err = await T.readError(res);
            alert((err.code ? err.code + ': ' : '') + err.message);
          }
        } catch (e) {
          alert('Không sửa được vé: ' + (e && e.message ? e.message : e));
        } finally {
          modalOk.disabled = false;
        }
      };
      modalOk.onclick = onOk;
    }

    /* ---------- Thu hồi ---------- */
    async function doCancel(t) {
      if (!window.confirm('Thu hồi vé ' + t.ticket_id + '? Vé sẽ thành CANCELLED (chỉ khi đang UNUSED).')) return;
      try {
        var res = await T.authFetch('/api/tickets/' + encodeURIComponent(t.ticket_id) + '/cancel', {
          method: 'POST'
        });
        if (res.ok) {
          await loadTickets();
          // Làm mới chi tiết nếu đang xem vé này.
          if (!detailEl.hidden && detailEl.dataset.ticketId === t.ticket_id) {
            showDetail(t);
          }
        } else {
          var err = await T.readError(res);
          alert((err.code ? err.code + ': ' : '') + err.message);
        }
      } catch (e) {
        alert('Không thu hồi được vé: ' + (e && e.message ? e.message : e));
      }
    }

    /* ---------- Xóa ---------- */
    async function doDelete(t) {
      if (!window.confirm('Xóa vé ' + t.ticket_id + '? Vé đã có lượt quét thì sẽ bị từ chối (409).')) return;
      try {
        var res = await T.authFetch('/api/tickets/' + encodeURIComponent(t.ticket_id), { method: 'DELETE' });
        if (res.ok) {
          if (!detailEl.hidden && detailEl.dataset.ticketId === t.ticket_id) {
            detailEl.hidden = true;
          }
          await loadTickets();
        } else {
          var err = await T.readError(res);
          alert((err.code ? err.code + ': ' : '') + err.message);
        }
      } catch (e) {
        alert('Không xóa được vé: ' + (e && e.message ? e.message : e));
      }
    }

    /* ---------- Chi tiết + lịch sử quét ---------- */
    async function showDetail(t) {
      detailEl.hidden = false;
      detailEl.dataset.ticketId = t.ticket_id;
      detailEl.innerHTML = '<p class="sub">Đang tải lịch sử quét…</p>';

      try {
        var res = await T.authFetch('/api/tickets/' + encodeURIComponent(t.ticket_id));
        if (!res.ok) {
          var err = await T.readError(res);
          detailEl.innerHTML = '<p class="form-error">' +
            T.escapeHtml((err.code ? err.code + ': ' : '') + err.message) + '</p>';
          return;
        }
        var d = await res.json();
        renderDetail(d);
      } catch (e) {
        detailEl.innerHTML = '<p class="form-error">Không tải được chi tiết vé: ' +
          T.escapeHtml(e && e.message ? e.message : e) + '</p>';
      }
    }

    function renderDetail(d) {
      var scans = d.scans || [];
      var scanRows = scans.map(function (s) {
        var alert = (s.alert_level && s.alert_level !== 'NONE')
          ? '<div class="mini">' + T.escapeHtml(s.alert_level) +
            (s.alert_code ? ' · ' + T.escapeHtml(s.alert_code) : '') + '</div>'
          : '';
        var wrong = (s.scan_result === 'WRONG_GATE' && s.ticket_assigned_gate_id)
          ? '<div class="mini warn-text">Cổng đúng: ' + T.escapeHtml(s.ticket_assigned_gate_id) + '</div>'
          : '';
        return '<tr>' +
          '<td>' + T.escapeHtml(T.formatTime(s.received_at)) + '</td>' +
          '<td>' + T.escapeHtml(s.gate_id) + '</td>' +
          '<td><span class="mini ' + resultCls(s.scan_result) + '">' + T.escapeHtml(s.scan_result) + '</span></td>' +
          '<td>' + alert + wrong + '</td>' +
        '</tr>';
      }).join('');

      detailEl.innerHTML =
        '<h2>Vé ' + T.escapeHtml(d.ticket_id) + '</h2>' +
        '<div class="detail-grid">' +
          '<div><span class="sub">Sự kiện</span><div>' + T.escapeHtml(d.event_id) + '</div></div>' +
          '<div><span class="sub">Cổng</span><div>' + (d.assigned_gate_id ? T.escapeHtml(d.assigned_gate_id) : '— (cổng nào cũng được)') + '</div></div>' +
          '<div><span class="sub">Trạng thái</span><div><span class="badge ' + T.statusClass(d.ticket_status) + '">' +
            T.escapeHtml(T.statusLabel(d.ticket_status)) + '</span></div></div>' +
          '<div><span class="sub">Số lượt quét</span><div>' + (d.scan_count || 0) + '</div></div>' +
        '</div>' +
        '<h3>Lịch sử quét (' + scans.length + ')</h3>' +
        (scans.length
          ? '<div class="table-wrap"><table class="table">' +
              '<thead><tr><th>Thời điểm</th><th>Cổng</th><th>Kết quả</th><th>Cảnh báo</th></tr></thead>' +
              '<tbody>' + scanRows + '</tbody></table></div>'
          : '<p class="sub">Chưa có lượt quét nào.</p>');
    }

    function resultCls(r) {
      return { VALID: 'ok-text', WRONG_GATE: 'warn-text' }[r] || 'deny-text';
    }

    /* ---------- Modal ---------- */
    function closeModal() { modal.hidden = true; }
    modalCancel.addEventListener('click', closeModal);
    modal.addEventListener('click', function (ev) { if (ev.target === modal) closeModal(); });

    /* ---------- Tìm kiếm / phân trang ---------- */
    searchBtn.addEventListener('click', function () {
      state.q = qInput.value.trim();
      state.status = statusSel.value;
      state.page = 1;
      loadTickets();
    });
    qInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); searchBtn.click(); }
    });
    resetBtn.addEventListener('click', function () {
      qInput.value = '';
      statusSel.value = '';
      state.q = '';
      state.status = '';
      state.page = 1;
      loadTickets();
    });
    prevBtn.addEventListener('click', function () {
      if (state.page > 1) { state.page--; loadTickets(); }
    });
    nextBtn.addEventListener('click', function () {
      if (state.page < state.pages) { state.page++; loadTickets(); }
    });

    loadMeta();
    loadTickets();
  }
})();
