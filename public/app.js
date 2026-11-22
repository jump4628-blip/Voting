// 투표자 페이지
(function () {
  // 기기별 고유 ID (투표 수정을 위해 사용)
  let voterId = localStorage.getItem('voting_voter_id');
  if (!voterId) {
    voterId = (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));
    localStorage.setItem('voting_voter_id', voterId);
  }

  const $ = (id) => document.getElementById(id);
  let current = null;
  let myVote = null;
  let busy = false;
  let chartMode = 'bar'; // 'bar' | 'pie'
  // 서로 확실히 구분되는 색상
  const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#0ea5e9', '#e11d48'];

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

  function render() {
    const s = current;
    if (!s) return;
    document.title = s.title ? `${s.title} - Voting` : 'Voting';
    $('title').textContent = s.title;

    const closed = s.status === 'closed';
    $('statusBadge').textContent = closed ? '투표 종료' : '투표 중';
    $('statusBadge').className = 'badge ' + (closed ? 'closed' : 'open');
    $('liveBadge').classList.toggle('hidden', !(s.realtime && !closed));
    $('total').textContent = s.showResults ? `총 ${s.total}명 참여` : '';

    // 내 투표 중 삭제된 항목은 제거
    if (Array.isArray(myVote)) {
      myVote = myVote.filter((id) => s.options.some((o) => o.id === id));
      if (!myVote.length) myVote = null;
    } else if (myVote && !s.options.some((o) => o.id === myVote)) {
      myVote = null;
    }

    const notice = $('notice');
    if (closed) {
      notice.textContent = '투표가 종료되었습니다. 최종 결과입니다.';
      notice.classList.remove('hidden');
    } else if (!s.showResults) {
      notice.textContent = '🔒 결과는 투표 종료 후 공개됩니다. 종료 전까지 선택을 자유롭게 바꿀 수 있어요.';
      notice.classList.remove('hidden');
    } else {
      notice.classList.add('hidden');
    }

    $('empty').classList.toggle('hidden', s.options.length > 0);

    // 차트 토글 버튼 표시 여부
    $('chartToggleWrap').classList.toggle('hidden', !s.showResults || s.options.length === 0);

    const total = s.total || 0;
    const max = s.showResults ? Math.max(0, ...Object.values(s.results || {})) : 0;

    // 원형 그래프 렌더링
    if (s.showResults && chartMode === 'pie' && s.options.length > 0) {
      $('pieView').classList.remove('hidden');
      renderPie(s, total);
    } else {
      $('pieView').classList.add('hidden');
    }

    const selectedIds = Array.isArray(myVote) ? myVote : (myVote ? [myVote] : []);

    $('options').innerHTML = s.options
      .map((o, idx) => {
        const selected = selectedIds.includes(o.id);
        let stat = '';
        let width = 0;
        const color = COLORS[idx % COLORS.length];
        if (s.showResults) {
          const c = s.results[o.id] || 0;
          const pct = total ? Math.round((c / total) * 100) : 0;
          width = c > 0 ? Math.max(pct, 4) : 0; // 1표라도 보이도록 최소 너비
          const crown = closed && c > 0 && c === max ? '🏆 ' : '';
          stat = `<span class="stat">${crown}${c}표 <small>(${pct}%)</small></span>`;
        }
        return `<div class="option ${selected ? 'selected' : ''} ${closed ? 'disabled' : ''}" data-id="${o.id}" style="border-left: 6px solid ${color};">
          <div class="bar" style="width:${width}%; background:${color}${selected ? '66' : '40'};"></div>
          <div class="row">
            <span class="check">${selected ? '✓' : ''}</span>
            <span class="label">${esc(o.text)}</span>
            ${stat}
          </div>
        </div>`;
      })
      .join('');

    let voteDesc = '';
    if (selectedIds.length > 0) {
      const names = s.options.filter((o) => selectedIds.includes(o.id)).map((o) => o.text);
      voteDesc = `내 선택: ${names.join(', ')}`;
    } else {
      voteDesc = closed ? '' : (s.allowMultiple ? '항목을 눌러 다중 선택하세요 (다시 누르면 취소)' : '항목을 눌러 투표하세요');
    }
    $('myVoteText').textContent = voteDesc;
    $('cancelBtn').classList.toggle('hidden', selectedIds.length === 0 || closed);
  }

  async function vote(optionId) {
    if (busy || !current || current.status !== 'open') return;
    busy = true;
    try {
      const r = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voterId, optionId }),
      });
      const d = await r.json();
      if (!r.ok) return toast(d.error || '오류가 발생했습니다.');
      const prev = Array.isArray(myVote) ? myVote : myVote ? [myVote] : [];
      myVote = d.myVote;
      render();
      const now = Array.isArray(myVote) ? myVote : myVote ? [myVote] : [];
      let msg;
      if (!optionId) msg = '선택을 취소했어요.';
      else if (current.allowMultiple) msg = now.includes(optionId) ? '선택했어요!' : '선택을 해제했어요.';
      else msg = prev.length ? '투표를 변경했어요!' : '투표 완료!';
      toast(msg);
    } catch {
      toast('네트워크 오류입니다. 다시 시도하세요.');
    } finally {
      busy = false;
    }
  }

  function renderPie(s, total) {
    // 원형 그래프는 전체 표 수 기준 (복수 투표에서도 360도를 넘지 않도록)
    const sum = s.options.reduce((a, o) => a + (s.results[o.id] || 0), 0);
    if (sum === 0) {
      $('pieChart').style.background = '#e5e7eb';
      $('pieLegend').innerHTML = '<div class="muted">아직 투표한 사람이 없습니다.</div>';
      return;
    }
    // 1표라도 보이도록 조각마다 최소 각도(8도) 보장 후 360도로 맞춤
    const MIN_DEG = 8;
    const raw = s.options.map((o) => {
      const c = s.results[o.id] || 0;
      return c > 0 ? Math.max((c / sum) * 360, MIN_DEG) : 0;
    });
    const scale = 360 / raw.reduce((a, b) => a + b, 0);
    const slices = raw.filter((d) => d > 0).length;
    const GAP = slices > 1 ? 1.5 : 0; // 조각 사이 흰 구분선

    let currentDeg = 0;
    const gradients = [];
    const legends = [];
    s.options.forEach((o, idx) => {
      const c = s.results[o.id] || 0;
      const color = COLORS[idx % COLORS.length];
      const deg = raw[idx] * scale;
      if (deg > 0) {
        gradients.push(`${color} ${currentDeg}deg ${currentDeg + deg - GAP}deg`);
        if (GAP) gradients.push(`#fff ${currentDeg + deg - GAP}deg ${currentDeg + deg}deg`);
        currentDeg += deg;
      }
      const pct = total ? Math.round((c / total) * 100) : 0;
      legends.push(`
        <div class="legend-item">
          <span class="legend-color" style="background:${color}"></span>
          <span class="legend-text">${esc(o.text)}</span>
          <span class="legend-pct">${c}표 (${pct}%)</span>
        </div>
      `);
    });

    $('pieChart').style.background = `conic-gradient(${gradients.join(', ')})`;
    $('pieLegend').innerHTML = legends.join('');
  }

  $('btnBarView').addEventListener('click', () => {
    chartMode = 'bar';
    $('btnBarView').classList.add('active');
    $('btnPieView').classList.remove('active');
    render();
  });
  $('btnPieView').addEventListener('click', () => {
    chartMode = 'pie';
    $('btnPieView').classList.add('active');
    $('btnBarView').classList.remove('active');
    render();
  });

  $('options').addEventListener('click', (e) => {
    const el = e.target.closest('.option');
    if (!el) return;
    if (!current.allowMultiple && el.dataset.id === myVote) return;
    vote(el.dataset.id);
  });
  $('cancelBtn').addEventListener('click', () => vote(null));

  // 초기 상태 + 내 선택 불러오기
  fetch('/api/state?voter=' + encodeURIComponent(voterId))
    .then((r) => r.json())
    .then((d) => {
      myVote = d.myVote;
      if (!current) current = d;
      render();
    });

  // 실시간 업데이트
  const es = new EventSource('/api/events');
  es.onmessage = (e) => {
    current = JSON.parse(e.data);
    render();
  };
})();
