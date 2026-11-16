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
  const COLORS = ['#4f46e5', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#3b82f6'];

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

    // 내 투표가 삭제된 항목이면 초기화
    if (myVote && !s.options.some((o) => o.id === myVote)) myVote = null;

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

    $('options').innerHTML = s.options
      .map((o, idx) => {
        const selected = o.id === myVote;
        let stat = '';
        let width = 0;
        const color = COLORS[idx % COLORS.length];
        if (s.showResults) {
          const c = s.results[o.id] || 0;
          const pct = total ? Math.round((c / total) * 100) : 0;
          width = pct;
          const crown = closed && c > 0 && c === max ? '🏆 ' : '';
          stat = `<span class="stat">${crown}${c}표 <small>(${pct}%)</small></span>`;
        }
        return `<div class="option ${selected ? 'selected' : ''} ${closed ? 'disabled' : ''}" data-id="${o.id}">
          <div class="bar" style="width:${width}%; ${selected ? '' : 'background:' + color + '1a;'}"></div>
          <div class="row">
            <span class="check">${selected ? '✓' : ''}</span>
            <span class="label">${esc(o.text)}</span>
            ${stat}
          </div>
        </div>`;
      })
      .join('');

    const mine = s.options.find((o) => o.id === myVote);
    $('myVoteText').textContent = mine ? `내 선택: ${mine.text}` : closed ? '' : '항목을 눌러 투표하세요';
    $('cancelBtn').classList.toggle('hidden', !mine || closed);
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
      const changed = myVote && optionId && myVote !== optionId;
      myVote = d.myVote;
      render();
      toast(optionId ? (changed ? '투표를 변경했어요!' : '투표 완료!') : '선택을 취소했어요.');
    } catch {
      toast('네트워크 오류입니다. 다시 시도하세요.');
    } finally {
      busy = false;
    }
  }

  function renderPie(s, total) {
    if (total === 0) {
      $('pieChart').style.background = '#e5e7eb';
      $('pieLegend').innerHTML = '<div class="muted">아직 투표한 사람이 없습니다.</div>';
      return;
    }
    let currentDeg = 0;
    const gradients = [];
    const legends = [];

    s.options.forEach((o, idx) => {
      const c = s.results[o.id] || 0;
      const pct = (c / total) * 100;
      const deg = (c / total) * 360;
      const color = COLORS[idx % COLORS.length];
      if (deg > 0) {
        gradients.push(`${color} ${currentDeg}deg ${currentDeg + deg}deg`);
        currentDeg += deg;
      }
      legends.push(`
        <div class="legend-item">
          <span class="legend-color" style="background:${color}"></span>
          <span class="legend-text">${esc(o.text)}</span>
          <span class="legend-pct">${c}표 (${Math.round(pct)}%)</span>
        </div>
      `);
    });

    $('pieChart').style.background = gradients.length > 0
      ? `conic-gradient(${gradients.join(', ')})`
      : '#e5e7eb';
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
    const el = e.target.closest('.option');
    if (!el) return;
    if (el.dataset.id === myVote) return;
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
