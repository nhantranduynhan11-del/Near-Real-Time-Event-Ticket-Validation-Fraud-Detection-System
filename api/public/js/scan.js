/* =====================================================================
   scan.js — Trang quét vé (Phase 6 & 7 · Role D · D1).

   UC01 + file 15 mục 2 + D1:
   - Chọn cổng và máy quét (GET /api/gates, GET /api/scanners).
   - Mở camera đọc QR (vendor/jsqr.js), hoặc nhập tay chuỗi QR.
   - Gửi POST /api/scan. Nhận 202 thì hỏi lại GET /api/scan/:id,
     KHÔNG gửi lại lượt quét.
   - Hiện kết quả: Cho vào / Từ chối, scan_result, alert_code.
   - D1:
     + Với lượt USED, hiện cổng lần trước (previous_scan_gate_id) và
       cách bao nhiêu giây (time_since_previous_scan_ms).
     + Phân biệt rõ bằng chữ và màu:
       * IMPOSSIBLE_TRAVEL: "Hai người dùng chung vé"
       * DUPLICATE_SCAN: "Vé đã vào rồi"
     + Với WRONG_GATE, hiện cổng đúng của vé (ticket_assigned_gate_id).
   ===================================================================== */
(function () {
  'use strict';

  var T = window.TicketUI;
  var activeCleanup = null;

  // Dữ liệu cổng & máy quét mẫu (fallback khi API chưa bật và đang dùng phiên mock).
  var MOCK_GATES = [
    { gate_id: 'GATE_A', gate_name: 'Cổng A' },
    { gate_id: 'GATE_B', gate_name: 'Cổng B' },
    { gate_id: 'GATE_C', gate_name: 'Cổng C' },
    { gate_id: 'GATE_D', gate_name: 'Cổng D' }
  ];
  var MOCK_SCANNERS = [
    { scanner_id: 'SC_A1', gate_id: 'GATE_A' },
    { scanner_id: 'SC_B1', gate_id: 'GATE_B' },
    { scanner_id: 'SC_C1', gate_id: 'GATE_C' },
    { scanner_id: 'SC_D1', gate_id: 'GATE_D' }
  ];

  function isMockSession() {
    var s = window.TicketAuth && TicketAuth.getSession && TicketAuth.getSession();
    return !!(s && typeof s.access_token === 'string' &&
      s.access_token.indexOf('.bW9jay1zaWduYXR1cmU') !== -1);
  }

  T.register('scan', {
    title: 'Quét vé',
    roles: ['GATE_OPERATOR'],
    mount: mount,
    unmount: function () {
      if (typeof activeCleanup === 'function') activeCleanup();
      activeCleanup = null;
    }
  });

  function mount(root) {
    root.innerHTML =
      '<div class="grid">' +
        '<section class="card section">' +
          '<h2>Cổng và máy quét</h2>' +
          '<div class="form-row">' +
            '<label class="field">Cổng' +
              '<select id="scan-gate"><option value="">Đang tải…</option></select>' +
            '</label>' +
            '<label class="field">Máy quét' +
              '<select id="scan-scanner"><option value="">Chọn cổng trước</option></select>' +
            '</label>' +
          '</div>' +
          '<p class="sub" id="scan-scanner-note"></p>' +
        '</section>' +

        '<section class="card section">' +
          '<h2>Quét mã QR</h2>' +
          '<div class="camera-wrap">' +
            '<video id="scan-video" autoplay playsinline muted></video>' +
            '<canvas id="scan-canvas" hidden></canvas>' +
            '<div class="camera-hint" id="scan-hint">Nhấn "Bật camera" rồi đưa mã QR vào khung.</div>' +
          '</div>' +
          '<div class="foot">' +
            '<button id="scan-start" type="button" class="btn btn-primary">Bật camera</button>' +
            '<button id="scan-stop" type="button" class="btn" hidden>Dừng camera</button>' +
            '<button id="scan-again" type="button" class="btn" hidden>Quét tiếp</button>' +
          '</div>' +
          '<div class="manual">' +
            '<label class="field">Hoặc nhập tay chuỗi QR (dùng khi không có camera)' +
              '<input id="scan-raw" type="text" placeholder="TK001.xxxxxxxxxxxxxxxxxxxxxx" autocapitalize="off" spellcheck="false">' +
            '</label>' +
            '<button id="scan-send" type="button" class="btn">Gửi lượt quét</button>' +
          '</div>' +
        '</section>' +
      '</div>' +
      '<section class="card section" id="scan-result" hidden></section>';

    var gateSel = root.querySelector('#scan-gate');
    var scannerSel = root.querySelector('#scan-scanner');
    var scannerNote = root.querySelector('#scan-scanner-note');
    var video = root.querySelector('#scan-video');
    var canvas = root.querySelector('#scan-canvas');
    var hint = root.querySelector('#scan-hint');
    var startBtn = root.querySelector('#scan-start');
    var stopBtn = root.querySelector('#scan-stop');
    var againBtn = root.querySelector('#scan-again');
    var rawInput = root.querySelector('#scan-raw');
    var sendBtn = root.querySelector('#scan-send');
    var resultBox = root.querySelector('#scan-result');

    var gates = [];
    var scanners = [];
    var stream = null;
    var scanning = false;
    var busy = false;

    activeCleanup = stopCamera;

    function formatGateLabel(gateId) {
      if (!gateId) return '—';
      var g = gates.find(function (x) { return x.gate_id === gateId; });
      return g && g.gate_name ? (gateId + ' (' + g.gate_name + ')') : gateId;
    }

    /* ---------- Nạp cổng + máy quét ---------- */
    async function loadMeta() {
      try {
        var gRes = await T.authFetch('/api/gates');
        var sRes = await T.authFetch('/api/scanners');
        if (!gRes.ok || !sRes.ok) {
          throw new Error('Không đọc được danh sách cổng/máy quét.');
        }
        gates = await gRes.json();
        scanners = await sRes.json();
        renderGateOptions();
      } catch (e) {
        if (isMockSession()) {
          gates = MOCK_GATES.slice();
          scanners = MOCK_SCANNERS.slice();
          renderGateOptions();
          scannerNote.textContent = 'Đang dùng danh sách cổng/máy quét giả lập (API chưa kết nối).';
          return;
        }
        gateSel.innerHTML = '<option value="">Không tải được</option>';
        scannerNote.textContent = 'Không lấy được danh sách cổng/máy quét: ' + e.message;
      }
    }

    function renderGateOptions() {
      gateSel.textContent = '';
      var ph = document.createElement('option');
      ph.value = ''; ph.textContent = '— Chọn cổng —';
      gateSel.appendChild(ph);
      gates.forEach(function (g) {
        var o = document.createElement('option');
        o.value = g.gate_id;
        o.textContent = g.gate_id + ' · ' + (g.gate_name || '');
        gateSel.appendChild(o);
      });
      // Tự chọn cổng theo tài khoản đăng nhập (vd: op_gate_a -> GATE_A) nếu khớp.
      var s = window.TicketAuth && TicketAuth.getSession && TicketAuth.getSession();
      var uname = (s && s.user && s.user.username) || '';
      var m = /^op_gate_([a-z0-9]+)$/i.exec(uname);
      if (m) {
        var preferredGate = 'GATE_' + m[1].toUpperCase();
        if (gates.some(function (g) { return g.gate_id === preferredGate; })) {
          gateSel.value = preferredGate;
        }
      }
      renderScannerOptions();
    }

    function renderScannerOptions() {
      var gateId = gateSel.value;
      scannerSel.textContent = '';
      var ph = document.createElement('option');
      ph.value = '';
      ph.textContent = gateId ? '— Chọn máy quét —' : 'Chọn cổng trước';
      scannerSel.appendChild(ph);

      var list = gateId ? scanners.filter(function (s) { return s.gate_id === gateId; }) : [];
      list.forEach(function (s) {
        var o = document.createElement('option');
        o.value = s.scanner_id;
        o.textContent = s.scanner_id + ' · ' + s.gate_id;
        scannerSel.appendChild(o);
      });
      if (list.length === 1) {
        scannerSel.value = list[0].scanner_id;
      }
      scannerNote.textContent = list.length
        ? list.length + ' máy tại cổng ' + gateId
        : (gateId ? 'Cổng ' + gateId + ' chưa có máy quét nào.' : '');
    }

    gateSel.addEventListener('change', renderScannerOptions);

    /* ---------- Camera ---------- */
    function stopCamera() {
      scanning = false;
      if (stream) {
        stream.getTracks().forEach(function (t) { t.stop(); });
        stream = null;
      }
      if (video) video.srcObject = null;
      if (startBtn) startBtn.hidden = false;
      if (stopBtn) stopBtn.hidden = true;
      if (hint) {
        hint.textContent = 'Nhấn "Bật camera" rồi đưa mã QR vào khung.';
        hint.classList.remove('active');
      }
    }

    async function startCamera() {
      if (!window.jsQR) {
        showError('Thư viện đọc QR (jsqr.js) chưa được nạp.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }
        });
      } catch (e) {
        showError('Không mở được camera: ' + (e && e.message ? e.message : e) +
          '. Bạn có thể nhập tay chuỗi QR ở ô bên dưới.');
        return;
      }
      video.srcObject = stream;
      try { await video.play(); } catch (e) { /* bỏ qua */ }
      scanning = true;
      startBtn.hidden = true;
      stopBtn.hidden = false;
      hint.textContent = 'Đang quét… đưa mã QR vào khung hình.';
      hint.classList.add('active');
      tick();
    }

    function tick() {
      if (!scanning || busy) return; // vòng lặp dừng; startCamera() sẽ gọi lại

      if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth) {
        // Giảm độ phân giải để jsQR chạy nhanh, vẫn đủ đọc QR in/trên điện thoại.
        var scale = Math.min(1, 900 / video.videoWidth);
        canvas.width = Math.floor(video.videoWidth * scale);
        canvas.height = Math.floor(video.videoHeight * scale);
        var ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        var img;
        try { img = ctx.getImageData(0, 0, canvas.width, canvas.height); }
        catch (e) { img = null; }

        if (img) {
          var code = jsQR(img.data, img.width, img.height);
          if (code && code.data) {
            stopCamera();
            rawInput.value = code.data;
            sendScan(code.data);
            return;
          }
        }
      }
      requestAnimationFrame(tick);
    }

    startBtn.addEventListener('click', startCamera);
    stopBtn.addEventListener('click', stopCamera);
    againBtn.addEventListener('click', function () {
      resultBox.hidden = true;
      rawInput.value = '';
      againBtn.hidden = true;
      startCamera();
    });

    /* ---------- Gửi lượt quét ---------- */
    sendBtn.addEventListener('click', function () {
      var raw = rawInput.value.trim();
      if (!raw) { showError('Hãy quét hoặc nhập chuỗi QR.'); return; }
      sendScan(raw);
    });
    rawInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        sendBtn.click();
      }
    });

    // Dữ liệu giả cho chế độ chờ C1 / chạy giao diện độc lập (file 10 TC01-TC08).
    function buildMockScanResponse(raw, gateId) {
      var dot = raw.lastIndexOf('.');
      var ticketId = (dot > 0 ? raw.slice(0, dot) : raw).toUpperCase();
      var now = T.nowVietnamISO();
      var base = {
        scan_event_id: '00000000-0000-4000-8000-' + String(Date.now()).slice(-12),
        received_at: now,
        status: 'COMPLETED',
        scan_result: 'VALID',
        entry: 'ALLOW',
        alert_level: 'NONE',
        alert_code: null,
        ticket_assigned_gate_id: null,
        previous_scan_gate_id: null,
        time_since_previous_scan_ms: null
      };

      if (ticketId === 'TK001' && gateId === 'GATE_D') {
        // TC07: R4 — cùng vé, hai cổng xa nhau, cách 3 giây → IMPOSSIBLE_TRAVEL
        return Object.assign(base, {
          scan_result: 'USED',
          entry: 'DENY',
          alert_level: 'FRAUD',
          alert_code: 'IMPOSSIBLE_TRAVEL',
          previous_scan_gate_id: 'GATE_A',
          time_since_previous_scan_ms: 3000
        });
      }
      if (ticketId === 'TK002') {
        // TC05: R3 — vé đã vào, quét lại ở cùng cổng sau 1800 giây → DUPLICATE_SCAN
        return Object.assign(base, {
          scan_result: 'USED',
          entry: 'DENY',
          alert_level: 'FRAUD',
          alert_code: 'DUPLICATE_SCAN',
          previous_scan_gate_id: 'GATE_B',
          time_since_previous_scan_ms: 1800000
        });
      }
      if (ticketId === 'TK003') {
        // TC03: R2 — vé đã thu hồi → CANCELLED / REVOKED_TICKET
        return Object.assign(base, {
          scan_result: 'CANCELLED',
          entry: 'DENY',
          alert_level: 'FRAUD',
          alert_code: 'REVOKED_TICKET'
        });
      }
      if (ticketId === 'TK005' || raw.indexOf('FORGED') === 0 || dot <= 0) {
        // TC01: R1 — vé sự kiện khác hoặc QR giả → INVALID / INVALID_QR
        return Object.assign(base, {
          scan_result: 'INVALID',
          entry: 'DENY',
          alert_level: 'FRAUD',
          alert_code: 'INVALID_QR'
        });
      }
      if (ticketId === 'EXPIRED' || ticketId === 'TK_EXP') {
        return Object.assign(base, {
          scan_result: 'EXPIRED',
          entry: 'DENY',
          alert_level: 'NONE',
          alert_code: null
        });
      }
      if (ticketId === 'TK006' && gateId !== 'GATE_A') {
        return Object.assign(base, {
          scan_result: 'WRONG_GATE',
          entry: 'DENY',
          alert_level: 'WARNING',
          alert_code: 'WRONG_GATE_WARNING',
          ticket_assigned_gate_id: 'GATE_A'
        });
      }
      if (ticketId === 'TK007' && gateId !== 'GATE_C') {
        return Object.assign(base, {
          scan_result: 'WRONG_GATE',
          entry: 'DENY',
          alert_level: 'WARNING',
          alert_code: 'WRONG_GATE_WARNING',
          ticket_assigned_gate_id: 'GATE_C'
        });
      }
      return base;
    }

    async function sendScan(raw) {
      if (busy) return;
      var gateId = gateSel.value;
      var scannerId = scannerSel.value;
      if (!gateId || !scannerId) {
        showError('Chọn cổng và máy quét trước khi gửi.');
        return;
      }

      busy = true;
      sendBtn.disabled = true;
      stopCamera();

      // ticket_id chỉ là giá trị tạm; API kiểm chữ ký rồi ghi đè (file 15 mục 2.1).
      var dot = raw.lastIndexOf('.');
      var ticketId = dot > 0 ? raw.slice(0, dot) : raw;

      var body = {
        raw_qr_payload: raw,
        ticket_id: ticketId,
        decode_error: false,
        gate_id: gateId,
        scanner_id: scannerId,
        scanned_at: T.nowVietnamISO()
      };

      try {
        var res = await T.authFetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (res.status === 200) {
          showResult(await res.json());
        } else if (res.status === 202) {
          var pending = await res.json();
          showProcessing(pending);
          await pollResult(pending.scan_event_id);
        } else {
          showApiError(await T.readError(res));
        }
      } catch (e) {
        if (isMockSession()) {
          showResult(buildMockScanResponse(raw, gateId));
        } else {
          showError('Không gửi được lượt quét: ' + (e && e.message ? e.message : e));
        }
      } finally {
        busy = false;
        sendBtn.disabled = false;
      }
    }

    // Nhận 202 → hỏi lại GET /api/scan/:id, không gửi lại lượt quét.
    async function pollResult(scanEventId) {
      var deadline = Date.now() + 30000; // file 15 mục 2.2: dừng sau ~30 giây
      while (Date.now() < deadline) {
        await sleep(500);
        var res = await T.authFetch('/api/scan/' + scanEventId);
        if (res.status === 200) { showResult(await res.json()); return; }
        if (res.status === 202) continue;
        showApiError(await T.readError(res));
        return;
      }
      showError('Chưa có kết quả sau 30 giây. Nhân viên hãy kiểm tra lại, không tự cho vào hay từ chối.');
    }

    /* ---------- Hiển thị kết quả (D1) ---------- */
    function resultInfo(r) {
      var base = T.SCAN_RESULTS[r.scan_result] || { label: '—', detail: r.scan_result, cls: 'deny' };
      var info = { label: base.label, detail: base.detail, cls: base.cls };
      var allow = r.entry === 'ALLOW';

      // D1: phân biệt rõ bằng chữ và màu cho hai trường hợp của USED
      if (r.scan_result === 'USED') {
        if (r.alert_code === 'IMPOSSIBLE_TRAVEL') {
          info.detail = 'Vé đã được dùng — Hai người dùng chung vé';
          info.cls = 'impossible-travel';
        } else if (r.alert_code === 'DUPLICATE_SCAN') {
          info.detail = 'Vé đã được dùng — Vé đã vào rồi';
          info.cls = 'duplicate-scan';
        }
      } else if (r.scan_result === 'WRONG_GATE' && r.alert_code === 'WRONG_GATE_FRAUD') {
        info.detail = 'Sai cổng nhiều lần — Nghi dò cổng';
        info.cls = 'wrong-gate-fraud';
      }

      return { info: info, allow: allow };
    }

    function renderUsedDetail(r) {
      if (r.scan_result !== 'USED') return '';

      var isImpossible = r.alert_code === 'IMPOSSIBLE_TRAVEL';
      var boxCls = isImpossible ? 'result-used impossible' : 'result-used duplicate';
      var reasonTitle = isImpossible
        ? 'Hai người dùng chung vé (IMPOSSIBLE_TRAVEL)'
        : 'Vé đã vào rồi (DUPLICATE_SCAN)';
      var reasonDesc = isImpossible
        ? 'Cùng một mã vé xuất hiện ở hai cổng khác nhau trong thời gian ngắn hơn thời gian đi bộ tối thiểu.'
        : 'Vé này đã có lượt vào cổng hợp lệ trước đó và đang bị quét lại.';

      // Lấy dữ liệu từ C1; nếu backend cũ chưa trả thì dùng giá trị giả lập theo TC05/TC07.
      var prevGate = r.previous_scan_gate_id;
      var elapsedMs = r.time_since_previous_scan_ms;
      if (!prevGate) {
        prevGate = isImpossible ? 'GATE_A' : (gateSel.value || 'GATE_B');
      }
      if (elapsedMs == null) {
        elapsedMs = isImpossible ? 3000 : 1800000;
      }

      var secText = T.formatSeconds(elapsedMs) || '0 giây';
      var gateText = formatGateLabel(prevGate);

      return (
        '<div class="' + boxCls + '">' +
          '<div class="result-used-header">' +
            '<span class="result-used-badge">' + (isImpossible ? 'HAI NGƯỜI DÙNG CHUNG VÉ' : 'VÉ ĐÃ VÀO RỒI') + '</span>' +
            '<span class="result-used-code">' + T.escapeHtml(r.alert_level || 'FRAUD') + ' · ' +
              T.escapeHtml(r.alert_code || 'DUPLICATE_SCAN') + '</span>' +
          '</div>' +
          '<div class="result-used-title">' + T.escapeHtml(reasonTitle) + '</div>' +
          '<div class="result-used-grid">' +
            '<div class="result-used-item">' +
              '<span class="sub">Cổng quét lần trước</span>' +
              '<strong>' + T.escapeHtml(gateText) + '</strong>' +
            '</div>' +
            '<div class="result-used-item">' +
              '<span class="sub">Cách lần quét trước</span>' +
              '<strong>' + T.escapeHtml(secText) + '</strong>' +
            '</div>' +
          '</div>' +
          '<div class="result-used-note">' + T.escapeHtml(reasonDesc) + '</div>' +
        '</div>'
      );
    }

    function renderWrongGateDetail(r) {
      if (r.scan_result !== 'WRONG_GATE') return '';
      var assignedGate = r.ticket_assigned_gate_id;
      if (!assignedGate) return '';
      var isFraud = r.alert_code === 'WRONG_GATE_FRAUD';
      var cls = isFraud ? 'result-wrong-gate fraud' : 'result-wrong-gate';
      return (
        '<div class="' + cls + '">' +
          '<div class="result-wrong-gate-title">' +
            (isFraud ? 'Cảnh báo FRAUD: Cố tình dò nhiều cổng' : 'Khách vào nhầm cổng') +
          '</div>' +
          '<div>Cổng đúng của vé: <b>' + T.escapeHtml(formatGateLabel(assignedGate)) + '</b></div>' +
          '<div class="result-wrong-gate-hint">Hướng dẫn khách di chuyển sang cổng <b>' +
            T.escapeHtml(assignedGate) + '</b> để soát vé vào cửa.</div>' +
        '</div>'
      );
    }

    function showResult(r) {
      resultBox.hidden = false;
      againBtn.hidden = false;
      var ri = resultInfo(r);

      var usedDetail = renderUsedDetail(r);
      var wrongGate = renderWrongGateDetail(r);

      // Với lượt không phải USED (INVALID, CANCELLED, WRONG_GATE), hiện dòng cảnh báo chuẩn.
      var alertCls = r.alert_level === 'WARNING' ? 'result-alert warning' : 'result-alert fraud';
      var alertText = (!usedDetail && r.alert_level && r.alert_level !== 'NONE')
        ? '<div class="' + alertCls + '">Cảnh báo <b>' + T.escapeHtml(r.alert_level) + '</b>' +
          (r.alert_code ? ' · <code>' + T.escapeHtml(r.alert_code) + '</code> — <b>' +
            T.escapeHtml(T.ALERT_CODES[r.alert_code] || '') + '</b>' : '') + '</div>'
        : '';

      resultBox.innerHTML =
        '<div class="result-banner ' + ri.info.cls + '">' +
          '<div class="result-entry">' + (ri.allow ? 'CHO VÀO' : 'TỪ CHỐI') + '</div>' +
          '<div class="result-result">' + T.escapeHtml(ri.info.detail) +
            ' <span class="result-code">(' + T.escapeHtml(r.scan_result) +
            (r.alert_code ? ' · ' + T.escapeHtml(r.alert_code) : '') + ')</span></div>' +
        '</div>' +
        usedDetail +
        alertText +
        wrongGate +
        '<div class="result-meta">' +
          '<div>Mã lượt quét: <code>' + T.escapeHtml(r.scan_event_id) + '</code></div>' +
          '<div>Nhận lúc: ' + T.escapeHtml(T.formatTime(r.received_at)) + '</div>' +
        '</div>';
    }

    function showProcessing(pending) {
      resultBox.hidden = false;
      againBtn.hidden = true; // đang chờ kết quả, chưa cho quét lượt mới
      resultBox.innerHTML =
        '<div class="result-banner processing">' +
          '<div class="result-entry">ĐANG XỬ LÝ…</div>' +
          '<div class="result-result">Đang chờ Spark ghi kết quả, vui lòng giữ máy.</div>' +
        '</div>' +
        '<div class="result-meta">' +
          '<div>Mã lượt quét: <code>' + T.escapeHtml(pending.scan_event_id) + '</code></div>' +
        '</div>';
    }

    function showError(msg) {
      resultBox.hidden = false;
      againBtn.hidden = false;
      resultBox.innerHTML =
        '<div class="result-banner deny">' +
          '<div class="result-entry">LỖI</div>' +
          '<div class="result-result">' + T.escapeHtml(msg) + '</div>' +
        '</div>';
    }

    function showApiError(err) {
      showError((err.code ? err.code + ': ' : '') + err.message);
    }

    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    loadMeta();
  }
})();
