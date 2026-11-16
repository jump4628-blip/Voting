// 관리자 페이지
(function () {
  const $ = (id) => document.getElementById(id);
  let password = sessionStorage.getItem('voting_admin_pw') || '';
  let state = null;
  let es = null;
  let qrCanvas = null;

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 1800);
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function api(action, body) {
    const r = await fetch('/api/admin/' + action, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) {
      logout();
      throw new Error(d.error);
    }
    if (!r.ok) {
      toast(d.error || '오류가 발생했습니다.');
      throw new Error(d.error);
    }
    if (d.state) {
      state = d.state;
      render();
    }
    return d;
  }

  // ---------- 로그인 ----------
  async function login(pw) {
    password = pw;
    try {
      await api('login', {});
    } catch {
      $('loginErr').textContent = '비밀번호가 올바르지 않습니다.';
      return;
    }
    sessionStorage.setItem('voting_admin_pw', pw);
    $('loginCard').classList.add('hidden');
    $('panel').classList.remove('hidden');
    $('loginErr').textContent = '';

    const info = await api('info');
    state = info.state;
    $('titleInput').value = state.title;
    render();
    setupUrls(info.urls, info.port);
    // 인터넷에 배포된 상태라면 고정 주소로 QR을 바로 만들어 둠
    if (info.publicUrl || !/localhost|127\.0\.0\.1|^192\.168\.|^10\./.test(location.hostname)) {
      setTimeout(() => $('qrBtn').click(), 300);
    }
    connect();
  }

  function logout() {
    password = '';
    sessionStorage.removeItem('voting_admin_pw');
    if (es) es.close();
    $('panel').classList.add('hidden');
    $('loginCard').classList.remove('hidden');
  }

  function connect() {
    if (es) es.close();
    es = new EventSource('/api/events?pw=' + encodeURIComponent(password));
    es.onmessage = (e) => {
      state = JSON.parse(e.data);
      render();
    };
  }

  // ---------- 렌더링 ----------
  function render() {
    if (!state) return;
    if (document.activeElement !== $('titleInput') && !$('titleInput').dataset.dirty) $('titleInput').value = state.title;
    $('realtimeToggle').checked = state.realtime;
    $('multipleToggle').checked = !!state.allowMultiple;
    const open = state.status === 'open';
    $('statusToggle').checked = open;
    $('statusText').textContent = open
      ? '투표가 진행 중입니다. 투표자는 종료 전까지 선택을 수정할 수 있습니다.'
      : '투표가 종료되었습니다. 결과가 모든 투표자에게 공개됩니다. 다시 켜면 투표가 재개됩니다.';
    $('participants').textContent = `· 총 ${state.participants}명 참여`;
    $('qrFullTitle').textContent = state.title;

    const total = state.total || 0;
    $('noOptions').classList.toggle('hidden', state.options.length > 0);
    $('adminOptions').innerHTML = state.options
      .map((o) => {
        const c = state.results[o.id] || 0;
        const pct = total ? Math.round((c / total) * 100) : 0;
        return `<div class="admin-option" data-id="${o.id}">
          <span class="name">${esc(o.text)}</span>
          <span class="cnt">${c}표 <small class="muted">${pct}%</small></span>
          <button class="secondary small" data-act="edit">수정</button>
          <button class="danger small" data-act="del">삭제</button>
        </div>`;
      })
      .join('');

    // 히스토리 렌더링
    renderHistory();
  }

  function renderHistory() {
    const list = state.history || [];
    $('noHistory').classList.toggle('hidden', list.length > 0);
    $('historyList').innerHTML = list
      .map((h) => {
        const dateStr = h.closedAt ? new Date(h.closedAt).toLocaleString('ko-KR') : '';
        const rows = (h.options || [])
          .map((opt) => {
            const count = (h.results && h.results[opt.id]) || 0;
            const pct = h.total ? Math.round((count / h.total) * 100) : 0;
            return `<div class="history-row">
              <span>${esc(opt.text)}</span>
              <b>${count}표 (${pct}%)</b>
            </div>`;
          })
          .join('');
        return `<div class="history-item">
          <div class="history-title">📌 ${esc(h.title)}</div>
          <div class="history-meta">종료 일시: ${dateStr} · 총 참여자: ${h.total || 0}명</div>
          <div>${rows || '<span class="muted">항목 없음</span>'}</div>
        </div>`;
      })
      .join('');
  }

  // ---------- 이벤트 ----------
  $('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    login($('pw').value);
  });
  $('logoutBtn').addEventListener('click', logout);

  $('titleInput').addEventListener('input', () => ($('titleInput').dataset.dirty = '1'));
  $('titleForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api('title', { title: $('titleInput').value });
    delete $('titleInput').dataset.dirty;
    toast('제목을 변경했습니다.');
  });

  $('newVoteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('newVoteTitle').value.trim();
    if (!title) return;
    if (!confirm(`'${title}' 제목으로 새 투표를 시작할까요?\n(현재 진행 중인 투표 결과는 '지난 투표 기록'에 안전하게 보관됩니다)`)) return;
    await api('new_vote', { title });
    $('newVoteTitle').value = '';
    toast('새 투표를 시작했습니다!');
  });

  $('addForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('optionInput').value.trim();
    if (!text) return;
    await api('options/add', { text });
    $('optionInput').value = '';
    $('optionInput').focus();
    toast('항목을 추가했습니다.');
  });

  $('adminOptions').addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.closest('.admin-option').dataset.id;
    const opt = state.options.find((o) => o.id === id);
    if (btn.dataset.act === 'del') {
      if (!confirm(`'${opt.text}' 항목을 삭제할까요?\n이 항목에 투표한 표도 함께 삭제됩니다.`)) return;
      await api('options/delete', { id });
      toast('삭제했습니다.');
    } else if (btn.dataset.act === 'edit') {
      const text = prompt('항목 이름 수정', opt.text);
      if (text && text.trim()) {
        await api('options/edit', { id, text });
        toast('수정했습니다.');
      }
    }
  });

  $('realtimeToggle').addEventListener('change', async (e) => {
    await api('realtime', { enabled: e.target.checked });
    toast(e.target.checked ? '실시간 결과 공개 ON' : '실시간 결과 공개 OFF');
  });

  $('multipleToggle').addEventListener('change', async (e) => {
    await api('allow_multiple', { enabled: e.target.checked });
    toast(e.target.checked ? '중복/복수 투표 허용 ON' : '중복/복수 투표 허용 OFF');
  });

  $('pwChangeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newPassword = $('newPwInput').value.trim();
    if (!newPassword || newPassword.length < 4) {
      return toast('비밀번호는 4글자 이상 입력하세요.');
    }
    if (!confirm('관리자 비밀번호를 변경하시겠습니까?')) return;
    await api('password', { newPassword });
    password = newPassword;
    sessionStorage.setItem('voting_admin_pw', newPassword);
    $('newPwInput').value = '';
    toast('관리자 비밀번호가 성공적으로 변경되었습니다!');
  });

  $('statusToggle').addEventListener('change', async (e) => {
    const open = e.target.checked;
    if (!open && !confirm('투표를 종료할까요? 종료 후에는 투표/수정이 불가능합니다.')) {
      e.target.checked = true;
      return;
    }
    await api('status', { status: open ? 'open' : 'closed' });
    toast(open ? '투표를 재개했습니다.' : '투표를 종료했습니다.');
  });

  $('resetBtn').addEventListener('click', async () => {
    if (!confirm('모든 투표 기록을 초기화할까요? 되돌릴 수 없습니다.')) return;
    await api('reset', {});
    toast('투표를 초기화했습니다.');
  });

  // ---------- QR ----------
  function setupUrls(urls, port) {
    const sel = $('urlSelect');
    const origin = location.origin + '/';
    const isLocal = /localhost|127\.0\.0\.1/.test(location.hostname);
    const list = [...urls];
    if (!isLocal && !list.includes(origin)) list.unshift(origin);
    sel.innerHTML =
      list.map((u) => `<option value="${u}">${u}</option>`).join('') +
      `<option value="">직접 입력 (외부 공개 주소 등)</option>`;
    if (!list.length) {
      sel.innerHTML = `<option value="">네트워크 주소를 찾지 못했습니다 - 직접 입력하세요</option>`;
    }
    $('qrUrl').value = list[0] || `http://localhost:${port}/`;
    sel.onchange = () => {
      if (sel.value) $('qrUrl').value = sel.value;
      else $('qrUrl').focus();
    };
  }

  function makeQrCanvas(text, scale) {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const margin = 4;
    const size = (n + margin * 2) * scale;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000';
    for (let r = 0; r < n; r++)
      for (let col = 0; col < n; col++)
        if (qr.isDark(r, col)) ctx.fillRect((col + margin) * scale, (r + margin) * scale, scale, scale);
    return c;
  }

  $('qrBtn').addEventListener('click', () => {
    const url = $('qrUrl').value.trim();
    if (!url) return toast('주소를 입력하세요.');
    if (typeof qrcode === 'undefined') {
      return toast('QR 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요.');
    }
    if (/localhost|127\.0\.0\.1/.test(url)) {
      toast('⚠️ localhost 주소는 휴대폰에서 접속할 수 없어요!');
    }
    qrCanvas = makeQrCanvas(url, 12);
    $('qrBox').innerHTML = '';
    $('qrBox').appendChild(qrCanvas);
    $('qrText').textContent = url;
    $('qrFullUrl').textContent = url;
    $('qrArea').classList.remove('hidden');
  });

  $('qrDownBtn').addEventListener('click', () => {
    if (!qrCanvas) return;
    const a = document.createElement('a');
    a.href = qrCanvas.toDataURL('image/png');
    a.download = 'voting-qr.png';
    a.click();
  });

  $('qrFullBtn').addEventListener('click', () => {
    if (!qrCanvas) return;
    const big = makeQrCanvas($('qrText').textContent, 20);
    $('qrFullBox').innerHTML = '';
    $('qrFullBox').appendChild(big);
    $('qrFull').classList.remove('hidden');
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  });
  $('qrCloseBtn').addEventListener('click', () => {
    $('qrFull').classList.add('hidden');
    if (document.fullscreenElement) document.exitFullscreen();
  });

  // 자동 로그인 (같은 탭 세션)
  if (password) login(password);
})();
