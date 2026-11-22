// Voting - 실시간 투표 서버 (외부 의존성 없음: Node.js 내장 모듈만 사용)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';
// 클라우드 배포 시: PUBLIC_URL = 배포된 주소 (QR에 사용), DATA_DIR = 영구 저장소 경로
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/?$/, '/').replace(/^\/$/, '');
const DATA_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- 상태 ----------
let state = {
  title: '새 투표',
  options: [], // { id, text }
  votes: {}, // voterId -> optionId (단일) 또는 [optionId, ...] (복수)
  realtime: true, // 실시간 결과 공개 여부
  allowMultiple: false, // 복수/중복 투표 허용 여부
  status: 'open', // 'open' | 'closed'
  history: [], // [{ id, title, options, results, total, closedAt }]
  adminPassword: '', // 관리자가 직접 변경한 비밀번호 (있으면 우선 적용)
  templates: [], // [{ id, title, options: ['항목1', '항목2', ...] }] 미리 등록해둔 투표 템플릿
};

try {
  if (fs.existsSync(DATA_FILE)) {
    const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    state = { ...state, ...loaded };
    if (!state.history) state.history = [];
    if (!state.templates) state.templates = [];
  }
} catch (e) {
  console.error('data.json 로드 실패, 기본값 사용:', e.message);
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DATA_FILE, JSON.stringify(state, null, 2), (err) => {
      if (err) console.error('저장 실패:', err.message);
    });
  }, 200);
}

function counts() {
  const c = {};
  state.options.forEach((o) => (c[o.id] = 0));
  Object.values(state.votes).forEach((val) => {
    if (Array.isArray(val)) {
      val.forEach((id) => {
        if (id in c) c[id]++;
      });
    } else if (val in c) {
      c[val]++;
    }
  });
  return c;
}

function archiveCurrent() {
  if (!state.history) state.history = [];
  const entry = {
    id: state.archiveId || crypto.randomUUID(),
    title: state.title,
    options: JSON.parse(JSON.stringify(state.options)),
    results: counts(),
    total: Object.keys(state.votes).length,
    closedAt: new Date().toISOString(),
  };
  const i = state.history.findIndex((h) => h.id === entry.id);
  if (i >= 0) state.history[i] = entry;
  else state.history.unshift(entry);
  state.archiveId = entry.id;
}

function publicState(isAdmin) {
  const showResults = isAdmin || state.realtime || state.status === 'closed';
  return {
    title: state.title,
    options: state.options,
    realtime: state.realtime,
    allowMultiple: !!state.allowMultiple,
    status: state.status,
    showResults,
    results: showResults ? counts() : null,
    total: showResults ? Object.keys(state.votes).length : null,
    participants: isAdmin ? Object.keys(state.votes).length : undefined,
    history: isAdmin ? (state.history || []) : undefined,
    templates: isAdmin ? (state.templates || []) : undefined,
  };
}

// ---------- 실시간 (Server-Sent Events) ----------
const clients = new Set(); // { res, isAdmin }

function broadcast() {
  const voterMsg = `data: ${JSON.stringify(publicState(false))}\n\n`;
  const adminMsg = `data: ${JSON.stringify(publicState(true))}\n\n`;
  for (const c of clients) c.res.write(c.isAdmin ? adminMsg : voterMsg);
}

setInterval(() => {
  for (const c of clients) c.res.write(': ping\n\n');
}, 25000);

// ---------- 유틸 ----------
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e5) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function checkPassword(pw) {
  const currentPw = state.adminPassword || ADMIN_PASSWORD;
  const a = Buffer.from(String(pw || ''));
  const b = Buffer.from(currentPw);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function lanUrls() {
  const urls = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) urls.push(`http://${i.address}:${PORT}/`);
    }
  }
  // 일반적인 사설망 주소(192.168.x.x)를 우선
  urls.sort((a, b) => (b.includes('//192.168.') ? 1 : 0) - (a.includes('//192.168.') ? 1 : 0));
  return urls;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin') pathname = '/admin.html';
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- 라우팅 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  // 상태 확인용 (ping)
  if (p === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  // 실시간 스트림
  if (p === '/api/events' && req.method === 'GET') {
    const isAdmin = url.searchParams.has('pw') && checkPassword(url.searchParams.get('pw'));
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    const client = { res, isAdmin };
    clients.add(client);
    res.write(`data: ${JSON.stringify(publicState(isAdmin))}\n\n`);
    req.on('close', () => clients.delete(client));
    return;
  }

  // 투표자: 현재 상태 + 내 선택
  if (p === '/api/state' && req.method === 'GET') {
    const voter = url.searchParams.get('voter');
    return send(res, 200, { ...publicState(false), myVote: (voter && state.votes[voter]) || null });
  }

  // 투표 / 수정 / 취소
  if (p === '/api/vote' && req.method === 'POST') {
    const { voterId, optionId, optionIds } = await readBody(req);
    if (!voterId || typeof voterId !== 'string' || voterId.length > 100)
      return send(res, 400, { error: '잘못된 요청입니다.' });
    if (state.status !== 'open') return send(res, 403, { error: '투표가 종료되었습니다.' });

    if (state.allowMultiple) {
      // 복수 투표 모드
      if (optionIds && Array.isArray(optionIds)) {
        const valid = optionIds.filter((id) => state.options.some((o) => o.id === id));
        if (valid.length === 0) {
          delete state.votes[voterId];
        } else {
          state.votes[voterId] = valid;
        }
      } else if (optionId == null) {
        delete state.votes[voterId];
      } else {
        if (!state.options.some((o) => o.id === optionId))
          return send(res, 400, { error: '존재하지 않는 항목입니다.' });
        let userVotes = Array.isArray(state.votes[voterId]) ? [...state.votes[voterId]] : (state.votes[voterId] ? [state.votes[voterId]] : []);
        if (userVotes.includes(optionId)) {
          userVotes = userVotes.filter((id) => id !== optionId);
        } else {
          userVotes.push(optionId);
        }
        if (userVotes.length === 0) {
          delete state.votes[voterId];
        } else {
          state.votes[voterId] = userVotes;
        }
      }
    } else {
      // 단일 투표 모드
      if (optionId == null) {
        delete state.votes[voterId];
      } else {
        if (!state.options.some((o) => o.id === optionId))
          return send(res, 400, { error: '존재하지 않는 항목입니다.' });
        state.votes[voterId] = optionId;
      }
    }
    save();
    broadcast();
    return send(res, 200, { ok: true, myVote: state.votes[voterId] || null });
  }

  // ---------- 관리자 ----------
  if (p.startsWith('/api/admin/')) {
    if (!checkPassword(req.headers['x-admin-password']))
      return send(res, 401, { error: '비밀번호가 올바르지 않습니다.' });
    const action = p.slice('/api/admin/'.length);
    const body = req.method === 'POST' ? await readBody(req) : {};

    switch (action) {
      case 'login':
        return send(res, 200, { ok: true });
      case 'info':
        return send(res, 200, {
          urls: PUBLIC_URL ? [PUBLIC_URL] : lanUrls(),
          publicUrl: PUBLIC_URL || null,
          port: PORT,
          state: publicState(true),
        });
      case 'title': {
        const t = String(body.title || '').trim().slice(0, 100);
        if (!t) return send(res, 400, { error: '제목을 입력하세요.' });
        state.title = t;
        break;
      }
      case 'options/add': {
        const t = String(body.text || '').trim().slice(0, 100);
        if (!t) return send(res, 400, { error: '항목 이름을 입력하세요.' });
        state.options.push({ id: crypto.randomUUID(), text: t });
        break;
      }
      case 'options/edit': {
        const o = state.options.find((x) => x.id === body.id);
        const t = String(body.text || '').trim().slice(0, 100);
        if (!o || !t) return send(res, 400, { error: '잘못된 요청입니다.' });
        o.text = t;
        break;
      }
      case 'options/delete': {
        state.options = state.options.filter((o) => o.id !== body.id);
        for (const [v, val] of Object.entries(state.votes)) {
          if (Array.isArray(val)) {
            const rest = val.filter((id) => id !== body.id);
            if (rest.length) state.votes[v] = rest;
            else delete state.votes[v];
          } else if (val === body.id) {
            delete state.votes[v];
          }
        }
        break;
      }
      case 'realtime':
        state.realtime = !!body.enabled;
        break;
      case 'allow_multiple':
        state.allowMultiple = !!body.enabled;
        break;
      case 'password': {
        const currentPw = String(body.currentPassword || '').trim();
        const newPw = String(body.newPassword || '').trim();
        if (!checkPassword(currentPw)) {
          return send(res, 400, { error: '현재 비밀번호가 올바르지 않습니다.' });
        }
        if (!newPw || newPw.length < 4) {
          return send(res, 400, { error: '새 비밀번호는 4글자 이상이어야 합니다.' });
        }
        state.adminPassword = newPw;
        break;
      }
      case 'status': {
        const nextStatus = body.status === 'closed' ? 'closed' : 'open';
        // 종료 시 기록(history)에 자동 보관 (재개 후 다시 종료하면 같은 기록을 갱신)
        if (state.status === 'open' && nextStatus === 'closed') archiveCurrent();
        state.status = nextStatus;
        break;
      }
      case 'new_vote': {
        // 진행 중이던 투표에 표가 있으면 보관 (이미 종료되어 보관된 경우 중복 저장 안 함)
        if (state.status === 'open' && Object.keys(state.votes).length > 0) archiveCurrent();
        state.archiveId = null;
        state.title = String(body.title || '새 투표').trim().slice(0, 100) || '새 투표';
        state.options = [];
        state.votes = {};
        state.status = 'open';
        break;
      }
      case 'template/add': {
        const title = String(body.title || '').trim().slice(0, 100);
        const opts = Array.isArray(body.options)
          ? body.options.map((o) => String(o).trim().slice(0, 100)).filter(Boolean)
          : [];
        if (!title) return send(res, 400, { error: '투표 주제(제목)를 입력하세요.' });
        if (opts.length === 0) return send(res, 400, { error: '최소 1개 이상의 항목을 입력하세요.' });
        if (!state.templates) state.templates = [];
        state.templates.push({
          id: crypto.randomUUID(),
          title,
          options: opts,
        });
        break;
      }
      case 'template/delete': {
        if (!state.templates) state.templates = [];
        state.templates = state.templates.filter((t) => t.id !== body.id);
        break;
      }
      case 'template/edit': {
        if (!state.templates) state.templates = [];
        const tpl = state.templates.find((t) => t.id === body.id);
        if (!tpl) return send(res, 400, { error: '해당 템플릿을 찾을 수 없습니다.' });
        const title = String(body.title || '').trim().slice(0, 100);
        const opts = Array.isArray(body.options)
          ? body.options.map((o) => String(o).trim().slice(0, 100)).filter(Boolean)
          : [];
        if (!title) return send(res, 400, { error: '투표 주제(제목)를 입력하세요.' });
        if (opts.length === 0) return send(res, 400, { error: '최소 1개 이상의 항목을 입력하세요.' });
        tpl.title = title;
        tpl.options = opts;
        break;
      }
      case 'template/apply': {
        const tpl = (state.templates || []).find((t) => t.id === body.id);
        if (!tpl) return send(res, 400, { error: '해당 템플릿을 찾을 수 없습니다.' });
        // 진행 중이던 투표에 표가 있으면 자동 보관
        if (state.status === 'open' && Object.keys(state.votes).length > 0) archiveCurrent();
        state.archiveId = null;
        state.title = tpl.title;
        state.options = tpl.options.map((txt) => ({ id: crypto.randomUUID(), text: txt }));
        state.votes = {};
        state.status = 'open';
        break;
      }
      case 'reset':
        state.votes = {};
        state.archiveId = null;
        break;
      default:
        return send(res, 404, { error: 'not found' });
    }
    save();
    broadcast();
    return send(res, 200, { ok: true, state: publicState(true) });
  }

  if (req.method === 'GET') return serveStatic(req, res, decodeURIComponent(p));
  send(res, 404, { error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n🗳️  Voting 서버가 실행 중입니다!\n');
  console.log(`  이 컴퓨터:   http://localhost:${PORT}/`);
  lanUrls().forEach((u) => console.log(`  같은 Wi-Fi:  ${u}`));
  console.log(`  관리자 페이지: http://localhost:${PORT}/admin`);
  console.log(`  관리자 비밀번호: ${ADMIN_PASSWORD === 'admin1234' ? 'admin1234 (기본값 - ADMIN_PASSWORD 환경변수로 변경하세요)' : '(환경변수로 설정됨)'}\n`);

  // 무료 호스팅(Render 등)이 잠들지 않도록 10분마다 자기 자신에게 ping
  if (PUBLIC_URL && !/localhost|127\.0\.0\.1/.test(PUBLIC_URL)) {
    setInterval(() => {
      fetch(PUBLIC_URL + 'health').catch(() => {});
    }, 10 * 60 * 1000);
    console.log(`  Keep-alive ping 활성화: ${PUBLIC_URL}health (10분마다)\n`);
  }
});
