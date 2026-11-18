/* =====================================================================
   scan.js — Trang quét vé (Phase 6 · Role D · 10/11).

   UC01 + file 15 mục 2:
   - Chọn cổng và máy quét (GET /api/gates, GET /api/scanners).
   - Mở camera đọc QR (vendor/jsqr.js), hoặc nhập tay chuỗi QR.
   - Gửi POST /api/scan. Nhận 202 thì hỏi lại GET /api/scan/:id,
     KHÔNG gửi lại lượt quét.
   - Hiện kết quả: Cho vào / Từ chối, scan_result, alert_code,
     cổng đúng nếu quét sai cổng. Mỗi kết quả có màu riêng.
   ===================================================================== */
(function () {
  'use strict';

  var T = window.TicketUI;

  T.register('scan', {
    title: 'Quét vé',
    roles: ['GATE_OPERATOR'],
    mount: mount
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
      video.srcObject = null;
      startBtn.hidden = false;
      stopBtn.hidden = true;
      hint.textContent = 'Nhấn "Bật camera" rồi đưa mã QR vào khung.';
      hint.classList.remove('active');
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
        showError('Không gửi được lượt quét: ' + (e && e.message ? e.message : e));
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

    /* ---------- Hiển thị kết quả ---------- */
    function resultInfo(r) {
      var info = T.SCAN_RESULTS[r.scan_result] || { label: '—', detail: r.scan_result, cls: 'deny' };
      var allow = r.entry === 'ALLOW';
      return { info: info, allow: allow };
    }

    function showResult(r) {
      resultBox.hidden = false;
      againBtn.hidden = false;
      var ri = resultInfo(r);
      var alertText = (r.alert_level && r.alert_level !== 'NONE')
        ? '<div class="result-alert">Cảnh báo <b>' + T.escapeHtml(r.alert_level) + '</b>' +
          (r.alert_code ? ' · ' + T.escapeHtml(r.alert_code) + ' — ' +
            T.escapeHtml(T.ALERT_CODES[r.alert_code] || '') : '') + '</div>'
        : '';

      var wrongGate = (r.scan_result === 'WRONG_GATE' && r.ticket_assigned_gate_id)
        ? '<div class="result-wrong-gate">Cổng đúng của vé: <b>' +
          T.escapeHtml(r.ticket_assigned_gate_id) + '</b></div>'
        : '';

      resultBox.innerHTML =
        '<div class="result-banner ' + ri.info.cls + '">' +
          '<div class="result-entry">' + (ri.allow ? 'CHO VÀO' : 'TỪ CHỐI') + '</div>' +
          '<div class="result-result">' + T.escapeHtml(ri.info.detail) +
            ' <span class="result-code">(' + T.escapeHtml(r.scan_result) + ')</span></div>' +
        '</div>' +
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
