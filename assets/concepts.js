/* CCAR-P 개념 카드 페이지 : 흐름 그림 엔진 v2 + 지문 따라가기 + 반복(여러 번 돌려 보기) + 갈림길 "경로 따라가기"
 * (build-concepts.py 가 링크한다. 문법 = concepts/writer-spec.md 의 흐름 · v2 확장 절)
 *
 * 흐름 그림 = <figure class="fl"> 안의 <script type="application/json" class="fl-data"> 를 읽어 그린다.
 *   데이터 : { cols:[칸 이름…], blocks:[{name, var}], rules:[칸마다 규칙 글 | null], question:묻는 말 | null,
 *             scenes:[{name, verdict:'ok'|'ng', blocks|null, steps:[…]}] }
 *   걸음 : start {at, label, art} · move {step, from:{col|block}, to, label, art} · mark {step, at:{col|block}, label, art}
 *          skip {at} · timer {at, label} · end {label}
 *   실물 art = {kind:'say', text} (말풍선) | {kind:'slip', lines:[…]} (쪽지)
 * 칸 = 격자(그림 폭 600px 이상 가로, 미만 세로 — concepts.css 컨테이너 쿼리). 도착한 실물·표지는 칸에 쌓여 남는다.
 * 되돌아감 · 칸 넘김 선은 출발·도착 실물에 묶어 기록하고, 칸이 자랄 때마다 다시 그린다(도착 끝 = 화살촉).
 * 끝 상태에서는 그 장면에서 안 쓴 칸과 그 칸에 닿는 화살표를 흐린다(건너뜀 표지와 달리 글자 없음).
 * 움직임은 Web Animations API 만. 화면에 절반 보이면 첫 장면 1회 자동 재생 · 화면 밖으로 나가면 끝 상태로 · 줄이기 설정이면 끝 상태 즉시.
 * 데이터 글은 innerHTML 로 넣지 않는다 — textContent + <code> 노드로 만든다 (`코드` 표기).
 */
(() => {
  'use strict';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const SVG = 'http://www.w3.org/2000/svg';
  const IDENT = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
  const T = { place: 650, ask: 1500, askAfter: 200, move: 700, curve: 1000, mark: 550, timer: 1400, after: 250, skip: 450 };
  const EXPIRE_RE = /만료|수명|초과|사라|expire|TTL/i;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const svg = (tag, attrs) => {
    const n = document.createElementNS(SVG, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
    return n;
  };
  // 글 → 노드 : `코드` 만 <code>, 나머지는 글자 그대로
  const rich = (text) => {
    const f = document.createDocumentFragment();
    String(text).split(/(`[^`]+`)/).forEach((part) => {
      if (!part) return;
      if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) f.append(el('code', null, part.slice(1, -1)));
      else f.append(document.createTextNode(part));
    });
    return f;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, reduce.matches ? 0 : ms));
  // 표지 문구의 ≠ / ✓ 가 색을 정한다 (글자는 문구에 그대로 있음 — 색만으로 구분하지 않는다)
  const tone = (label) => (!label ? 'on' : label.includes('≠') ? 'ng' : label.includes('✓') ? 'ok' : 'on');
  const pop = (n) => n.animate([{ opacity: 0, transform: 'translateY(4px) scale(0.97)' }, { opacity: 1, transform: 'none' }],
    { duration: 220, easing: 'ease-out' });

  const arrow = () => {
    const a = el('div', 'flx-arrow');
    a.setAttribute('aria-hidden', 'true');
    const s = svg('svg', { viewBox: '0 0 28 16', focusable: 'false' });
    s.append(svg('path', { d: 'M1 8 H24 M18 2 L25 8 L18 14' }));
    a.append(s);
    return a;
  };

  // ---------------------------------------------------------------- 흐름 : 그리기
  function build(fig, data) {
    const st = { fig, data, scene: 0, run: 0, timers: [], running: false, done: false, autoplayed: false,
      pending: false, visible: false, blockEls: {}, lastW: 0 };
    const ctl = el('div', 'fl-ctl');
    const group = el('div', 'fl-scenes');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', '장면');
    st.sceneBtns = data.scenes.map((s, i) => {
      const b = el('button', 'fl-sb', `${s.name} ${s.verdict === 'ok' ? '✓' : '≠'}`);
      b.type = 'button';
      b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
      b.addEventListener('click', () => { select(st, i); play(st); });
      group.append(b);
      return b;
    });
    st.playBtn = el('button', 'fl-play', '재생');
    st.playBtn.type = 'button';
    st.playBtn.addEventListener('click', () => play(st));
    ctl.append(group, st.playBtn);

    const stage = el('div', 'flx-stage');
    const hasBlocks = data.blocks.length + data.scenes.filter((s) => s.blocks).length > 0;
    const tracks = [];
    st.arrows = [];
    st.lanes = data.cols.map((name, i) => {
      const lane = el('div', 'flx-lane');
      const lab = el('p', 'flx-lab', name);
      lane.append(lab);
      let list = null;
      if (i === 0 && hasBlocks) {
        list = el('ol', 'fl-blocks');
        lane.append(list);
      }
      const ruleText = data.rules && data.rules[i];
      if (ruleText) {
        const rule = el('div', 'flx-rule');
        rule.append(el('span', 'flx-rule-h', '규칙'), rich(ruleText));
        lane.append(rule);
      }
      const skip = el('p', 'flx-skip'); // 글은 건너뜀 걸음이 장면 판정에 맞춰 넣는다 (apply 'skip')
      lane.append(skip);
      const tray = el('div', 'flx-tray');
      lane.append(tray);
      if (i) {
        const a = arrow();
        stage.append(a);
        st.arrows.push(a);
        tracks.push('26px');
      }
      stage.append(lane);
      tracks.push(list ? 'minmax(0, 1.3fr)' : 'minmax(0, 1fr)');
      return { lane, lab, list, tray, skip, rule: !!ruleText };
    });
    stage.style.setProperty('--flx-cols', tracks.join(' '));
    // 오른쪽 → 왼쪽 이동이 있으면 칸 위로 휘는 곡선 자리를 위에 비워 둔다
    if (data.scenes.some((s) => s.steps.some((x) => x.kind === 'move' && x.to < colOf(x.from)))) stage.classList.add('has-back');
    st.lines = svg('svg', { class: 'flx-skipline', 'aria-hidden': 'true', focusable: 'false' });
    // 도착 끝 화살촉 : 되돌아감(회색) · 건너뜀(amber) — 색은 CSS 토큰이라 밝음·다크를 따라감
    const defs = svg('defs');
    st.mk = {};
    [['is-back', 'flx-head-back'], ['is-skip', 'flx-head-skip']].forEach(([cls, head]) => {
      const id = `${fig.id || 'fl'}-${head}`;
      const m = svg('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 8, markerHeight: 8,
        markerUnits: 'userSpaceOnUse', orient: 'auto' });
      m.append(svg('path', { class: head, d: 'M0,1 L9,5 L0,9 Z' }));
      defs.append(m);
      st.mk[cls] = id;
    });
    st.paths = svg('g');
    st.lines.append(defs, st.paths);
    st.links = [];
    st.dot = el('span', 'flx-dot');
    st.dot.setAttribute('aria-hidden', 'true');
    st.ask = el('div', 'flx-ask');
    st.ask.setAttribute('role', 'status');
    stage.append(st.lines, st.dot, st.ask);
    st.stage = stage;
    st.verdict = el('p', 'flx-verdict');
    st.verdict.setAttribute('aria-live', 'polite');
    const before = fig.querySelector('.flx-note') || fig.querySelector('.fl-alt');
    [ctl, stage, st.verdict].forEach((n) => fig.insertBefore(n, before));
    return st;
  }

  function setBlocks(st) {
    const sc = st.data.scenes[st.scene];
    const list = st.lanes[0].list;
    st.blockEls = {};
    if (!list) return;
    list.textContent = '';
    (sc.blocks || st.data.blocks).forEach((b) => {
      const li = el('li', 'fl-b' + (b.var ? ' is-var' : ''));
      const mk = el('span', 'fl-mk');
      mk.setAttribute('aria-hidden', 'true');
      li.append(mk);
      if (IDENT.test(b.name)) li.append(el('code', null, b.name));
      else li.append(document.createTextNode(b.name));
      list.append(li);
      st.blockEls[b.name] = li;
    });
  }

  function reset(st) {
    st.run += 1;
    st.timers.forEach(clearTimeout);
    st.timers = [];
    st.running = false;
    st.done = false;
    st.fig.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    setBlocks(st);
    st.lanes.forEach((L) => {
      L.lane.classList.remove('is-on', 'is-skipped');
      L.tray.textContent = '';
    });
    st.arrows.forEach((a) => a.classList.remove('is-off', 'is-idle'));
    st.stage.classList.remove('is-ask', 'is-done');
    st.stage.classList.toggle('is-okscene', okScene(st)); // ✓ 장면이면 건너뜀을 회색으로 (concepts.css)
    st.stage.style.paddingBottom = '';
    st.skipped = new Set();
    st.seq = 0;
    st.paths.textContent = '';
    st.links = [];
    st.arrive = null;
    st.dot.className = 'flx-dot';
    st.dot.style.opacity = '0';
    st.ask.classList.remove('is-show');
    st.ask.textContent = '';
    st.verdict.className = 'flx-verdict';
    st.verdict.textContent = '';
    st.playBtn.textContent = '재생';
  }

  function select(st, i) {
    st.scene = i;
    st.sceneBtns.forEach((b, k) => b.setAttribute('aria-pressed', k === i ? 'true' : 'false'));
  }

  // ---------------------------------------------------------------- 흐름 : 걸음 → 시각표
  const colOf = (ref) => (ref.block != null ? 0 : ref.col);
  // ✓ 장면의 건너뜀 = 옳게 안 거침(필요 없음) → 회색 · ≠ 장면만 amber(건너뛰어서 문제)
  const okScene = (st) => st.data.scenes[st.scene].verdict === 'ok';

  function timeline(st) {
    const scene = st.data.scenes[st.scene];
    const ev = [];
    let t = 0;
    let asked = !st.data.question;
    let lastArt = -1;
    scene.steps.forEach((s, i) => { if (s.art) lastArt = i; });
    scene.steps.forEach((s, i) => {
      const fin = i === lastArt ? scene.verdict : null;
      if (s.kind === 'start') {
        ev.push([t, { kind: 'place', at: s.at, art: s.art, label: s.label, fin }]);
        t += T.place;
      } else if (s.kind === 'move') {
        if (!asked) {
          asked = true;
          ev.push([t, { kind: 'ask' }]);
          t += T.ask;
          ev.push([t, { kind: 'unask' }]);
          t += T.askAfter;
        }
        ev.push([t, { kind: 'dot', from: s.from, to: s.to }]);
        t += s.to < colOf(s.from) || s.to - colOf(s.from) > 1 ? T.curve : T.move;
        ev.push([t, { kind: 'place', at: s.to, art: s.art, label: s.label, step: s.step, fin }]);
        t += T.place;
      } else if (s.kind === 'mark') {
        ev.push([t, { kind: 'mark', at: s.at, art: s.art, label: s.label, step: s.step, fin }]);
        t += T.mark;
      } else if (s.kind === 'skip') {
        ev.push([t, s]);
        t += T.skip;
      } else if (s.kind === 'timer') {
        ev.push([t, s]);
        t += T.timer;
        // 만료를 뜻하는 타이머만 그 칸 앞 실물을 흐리게 (기다림·걸리는 시간 타이머는 원만 줄어듦 — grader-choice "느리고 비쌈" 이 지워지던 결함)
        if (EXPIRE_RE.test(s.label || '')) ev.push([t, { kind: 'expire', at: s.at }]);
        t += T.after;
      } else if (s.kind === 'end') {
        ev.push([t, { kind: 'end', label: s.label, verdict: scene.verdict }]);
      }
    });
    return ev;
  }

  // ---------------------------------------------------------------- 흐름 : 점이 나가고 들어오는 자리 (그림 기준 좌표)
  const vertical = (st) => getComputedStyle(st.stage).gridTemplateColumns.trim().split(/\s+/).length === 1;
  function rel(st, n) {
    const s = st.stage.getBoundingClientRect();
    const r = n.getBoundingClientRect();
    return { l: r.left - s.left, t: r.top - s.top, r: r.right - s.left, b: r.bottom - s.top, w: r.width, h: r.height };
  }
  const lastShown = (box) => Array.from(box.children).reverse().find((c) => c.getBoundingClientRect().height > 0) || null;
  // 칸 안에서 보이는 마지막 부품 (쌓인 실물 → 블록 목록 → 칸 이름)
  const laneBottom = (L) => lastShown(L.tray) || lastShown(L.lane);

  function srcEl(st, from) {
    if (from.block != null && st.blockEls[from.block]) return st.blockEls[from.block];
    const L = st.lanes[colOf(from)];
    return lastShown(L.tray) || L.list || L.lab;
  }

  function outPt(st, from, dir) {
    const r = rel(st, srcEl(st, from));
    if (vertical(st)) return dir > 0 ? { x: r.l + 40, y: r.b + 4 } : { x: r.l + 40, y: r.t - 4 };
    const y = r.t + Math.min(r.h / 2, 28);
    return dir > 0 ? { x: r.r + 3, y } : { x: r.l - 3, y };
  }

  function inPt(st, i, dir) {
    const tray = st.lanes[i].tray;
    const r = rel(st, tray);
    const last = lastShown(tray);
    if (vertical(st)) return { x: r.l + 40, y: last ? rel(st, last).b + 8 : r.t + 6 };
    const y = last ? rel(st, last).b + 14 : r.t + 24;
    return dir > 0 ? { x: r.l + 6, y } : { x: r.r - 6, y };
  }

  // ---------------------------------------------------------------- 흐름 : 선 (되돌아감 · 칸 넘김)
  // 선은 걸음마다 기록한다 — 출발 = 그때 그 칸의 마지막 실물(또는 블록), 도착 = 그 걸음에 놓인 실물.
  // 세로 배치에서는 뒤 걸음 실물이 칸을 밀어 한 번 잰 좌표가 낡는다 → 놓을 때마다 · 끝 상태 · 폭이 바뀔 때 전부 다시 계산.
  // 겹치는 선은 층을 달리한다 : 가로 되돌아감 = 높이(긴 곡선이 위) · 세로 = 칸 바깥 x(긴 괄호가 바깥).
  const cubicPts = (p0, c1, c2, p1, n) => Array.from({ length: n + 1 }, (_, i) => {
    const u = i / n;
    const v = 1 - u;
    const w = [v * v * v, 3 * v * v * u, 3 * v * u * u, u * u * u];
    return { x: w[0] * p0.x + w[1] * c1.x + w[2] * c2.x + w[3] * p1.x, y: w[0] * p0.y + w[1] * c1.y + w[2] * c2.y + w[3] * p1.y };
  });
  const cubicD = (p0, c1, c2, p1) => `M${p0.x},${p0.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p1.x},${p1.y}`;
  // 꺾은선 → 모서리만 둥근 경로 (반지름 = r 과 양옆 마디 절반 중 작은 값). 끝 마디 방향 = 화살촉 방향
  function roundPath(P, r) {
    let d = `M${P[0].x},${P[0].y}`;
    for (let i = 1; i < P.length - 1; i += 1) {
      const [a, b, c] = [P[i - 1], P[i], P[i + 1]];
      const l1 = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const l2 = Math.hypot(c.x - b.x, c.y - b.y) || 1;
      const q = Math.min(r, l1 / 2, l2 / 2);
      d += ` L${b.x - ((b.x - a.x) / l1) * q},${b.y - ((b.y - a.y) / l1) * q}`
        + ` Q${b.x},${b.y} ${b.x + ((c.x - b.x) / l2) * q},${b.y + ((c.y - b.y) / l2) * q}`;
    }
    const z = P[P.length - 1];
    return `${d} L${z.x},${z.y}`;
  }
  // 칸 바깥 세로 괄호 : (xe, y0) → 바깥 x → 세로 → (xe, y1). 끝 마디가 가로라 화살촉이 칸 쪽을 가리킨다
  const bracket = (xe, x, y0, y1) => roundPath([{ x: xe, y: y0 }, { x, y: y0 }, { x, y: y1 }, { x: xe, y: y1 }], 5);

  function addLink(st, e) {
    const a0 = colOf(e.from);
    if (e.to >= a0 && e.to - a0 <= 1) return null; // 바로 옆 칸 = 칸 사이 화살표를 탐 (선 없음)
    const mids = [];
    for (let m = a0 + 1; m < e.to; m += 1) mids.push(m);
    const k = { kind: e.to < a0 ? 'back' : 'fwd', a0, to: e.to, mids, block: e.from.block != null && !!st.blockEls[e.from.block],
      src: srcEl(st, e.from), dst: null, track: 0, viaSkip: mids.some((m) => st.skipped.has(m)) };
    // 되돌아감은 늘 실선, 앞쪽 칸 넘김은 사이에 건너뛴 칸이 있을 때만 점선 (없으면 점만 돌아감).
    // 건너뜀 점선 색 = 장면 판정 : ✓ 장면은 회색(옳게 안 거침) · ≠ 장면만 amber
    if (k.kind === 'back' || k.viaSkip) {
      const gray = k.kind === 'back' || okScene(st);
      k.path = svg('path', { class: k.kind === 'back' ? 'is-back' : gray ? 'is-skip is-fine' : 'is-skip',
        'marker-end': `url(#${st.mk[gray ? 'is-back' : 'is-skip']})` });
      st.paths.append(k.path);
    }
    st.links.push(k);
    return k;
  }

  // 선이 닿는 상자 : 쌓인 것이면 그 안의 실물(말풍선·쪽지·표지) — 걸음 이름 머리·아래 설명 글이 아니라
  const box = (st, n) => rel(st, (n.classList.contains('flx-item')
    && n.querySelector(':scope > .flx-say, :scope > .flx-slip, :scope > .flx-tag')) || n);

  // 도착 자리 : 놓인 실물 · 아직이면(점이 나는 중) 그 칸 맨 아래에 놓일 자리
  function arrBox(st, k) {
    if (k.dst) return box(st, k.dst);
    const tray = st.lanes[k.to].tray;
    const r = rel(st, tray);
    const last = lastShown(tray);
    const t = last ? rel(st, last).b + 8 : r.t;
    return { l: r.l, r: r.r, t, b: t + 36, w: r.w, h: 36 };
  }

  function geom(st, k, vert) {
    const s = box(st, k.src);
    const t = arrBox(st, k);
    if (vert) {
      // 세로 : 되돌아감 = 칸 왼쪽 바깥 괄호(위로) · 칸 넘김 = 오른쪽 바깥 괄호(아래로). 그림 안쪽 여백(14px) 안
      const back = k.kind === 'back';
      const W = st.stage.clientWidth;
      const xe = back ? -2 : W + 2;
      const x = back ? -13 + 4.5 * k.track : W + 11 - 4.5 * k.track;
      // 가까운 가장자리끼리 : 위로 가면 출발 윗부분 → 도착 아랫부분, 아래로 가면 반대
      const y0 = back ? s.t + Math.min(s.h / 3, 12) : s.b - Math.min(s.h / 3, 12);
      const y1 = back ? t.b - Math.min(t.h / 3, 12) : t.t + Math.min(t.h / 3, 12);
      const ix = (b) => (back ? b.l + 14 : b.r - 14);
      return { d: bracket(xe, x, y0, y1), lo: Math.min(y0, y1), hi: Math.max(y0, y1),
        pts: [{ x: ix(s), y: y0 }, { x: xe, y: y0 }, { x, y: y0 }, { x, y: y1 }, { x: xe, y: y1 }, { x: ix(t), y: y1 }] };
    }
    if (k.kind === 'back') {
      // 가로 되돌아감 : 칸 위로 휘는 곡선. 출발 = 칸 가운데 왼쪽, 도착 = 가운데 오른쪽 (이어지는 두 곡선이 한 줄로 붙지 않게)
      const la = rel(st, st.lanes[k.a0].lane);
      const lb = rel(st, st.lanes[k.to].lane);
      const p0 = { x: (la.l + la.r) / 2 - 8, y: la.t - 4 };
      const p1 = { x: (lb.l + lb.r) / 2 + 8, y: lb.t - 4 };
      const peak = Math.min(la.t, lb.t) - 24 + 8 * k.track;
      const cy = (peak - (p0.y + p1.y) / 8) / 0.75; // 두 끝이 수직인 3차 곡선의 꼭대기 = peak
      const c1 = { x: p0.x, y: cy };
      const c2 = { x: p1.x, y: cy };
      return { d: cubicD(p0, c1, c2, p1), lo: k.to, hi: k.a0,
        pts: [{ x: (s.l + s.r) / 2, y: s.t + 6 }, ...cubicPts(p0, c1, c2, p1, 12), { x: p1.x, y: t.t + 10 }] };
    }
    // 가로 칸 넘김 : 출발 칸 맨 아래에서 내려가 → 사이 칸들의 가장 낮은 부품보다 16px 아래를 평평하게 → 도착 칸 앞 틈에서
    // 올라가 실물 쪽으로 꺾임. 직선 + 둥근 모서리 — 3차 곡선은 조절점 깊이의 3/4 까지만 내려가 사이 칸 '안 거침' 상자를 뚫었다.
    // 블록에서 떠나도 선은 칸 맨 아래에서 시작 (아래 블록·실물을 안 뚫게) — 점만 블록에서 출발
    const a = rel(st, st.lanes[k.a0].tray);
    const x0 = a.r - 24;
    const y0 = a.b + 6;
    const low = Math.max(y0, ...k.mids.map((m) => {
      const n = laneBottom(st.lanes[m]);
      return n ? rel(st, n).b : 0;
    })) + 16;
    const xr = t.l - 13; // 도착 칸 앞 틈(26px) 가운데
    // 도착 높이 = 실물 윗부분. 틈의 ▸ 화살표 글자와 겹치면 그 아래로 (실물 안에서)
    const arr = st.arrows[k.to - 1] ? rel(st, st.arrows[k.to - 1]) : null;
    let y1 = t.t + Math.min(t.h / 2, 14);
    if (arr && y1 < arr.b + 5) y1 = Math.min(t.b - 4, arr.b + 5);
    const P = [{ x: x0, y: y0 }, { x: x0, y: low }, { x: xr, y: low }, { x: xr, y: y1 }, { x: t.l - 2, y: y1 }];
    return { d: roundPath(P, 10), low, pts: [...(k.block ? [{ x: s.r - 16, y: s.t + s.h / 2 }] : []), ...P] };
  }

  // 겹치는 선끼리 층 나누기 : 긴 것부터, 열린 구간이 겹치면 다음 층 (같은 칸 쌍 = 같은 곡선이라 한 층을 같이 씀)
  function stack(list) {
    const done = [];
    list.sort((a, b) => (b.g.hi - b.g.lo) - (a.g.hi - a.g.lo)).forEach((k) => {
      const twin = k.key && done.find((o) => o.key === k.key);
      let n = 0;
      if (twin) n = twin.track;
      else while (done.some((o) => o.track === n && Math.max(o.g.lo, k.g.lo) < Math.min(o.g.hi, k.g.hi))) n += 1;
      k.track = Math.min(n, 2);
      done.push(k);
    });
  }

  function drawLinks(st) {
    if (!st.links.length) return;
    const vert = vertical(st);
    st.stage.style.paddingBottom = '';
    st.links.forEach((k) => {
      k.track = 0;
      k.key = !vert && k.kind === 'back' ? `${k.a0}>${k.to}` : null;
      k.g = geom(st, k, vert);
    });
    const drawn = st.links.filter((k) => k.path && k.g.lo != null);
    if (vert) {
      stack(drawn.filter((k) => k.kind === 'back'));
      stack(drawn.filter((k) => k.kind === 'fwd'));
    } else stack(drawn);
    let low = 0;
    st.links.forEach((k) => {
      if (k.track) k.g = geom(st, k, vert);
      if (k.path) k.path.setAttribute('d', k.g.d);
      if (k.g.low != null) low = Math.max(low, k.g.low);
    });
    // 가로 칸 넘김 곡선(점이 도는 길 포함)이 그림 안에 들어오게 아래 여백을 늘린다
    const need = low + 8 - st.stage.clientHeight;
    if (need > 0) st.stage.style.paddingBottom = `${(parseFloat(getComputedStyle(st.stage).paddingBottom) || 0) + need}px`;
  }

  function moveDot(st, e, anim) {
    const k = addLink(st, e);
    st.arrive = k; // 바로 다음 놓기가 이 선의 도착 끝을 놓인 실물에 묶는다
    if (!anim) return;
    let pts;
    if (k) {
      drawLinks(st);
      ({ pts } = k.g);
    } else pts = [outPt(st, e.from, 1), inPt(st, e.to, 1)];
    st.dot.classList.toggle('is-ng', !!(k && k.viaSkip) && !okScene(st)); // 건너뛰어 도는 점도 ≠ 장면만 amber
    // keyframe 간격 = 길이 비례 (괄호처럼 마디 길이가 제각각인 길에서도 점이 고른 빠르기로)
    const len = [0];
    for (let i = 1; i < pts.length; i += 1) len.push(len[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const total = len[len.length - 1];
    const frames = pts.map((p, i) => ({ transform: `translate(${p.x}px, ${p.y}px)`, opacity: 1,
      offset: total ? len[i] / total : i / (pts.length - 1) }));
    const run = st.run;
    const an = st.dot.animate(frames, { duration: k ? T.curve : T.move, easing: 'cubic-bezier(.45,.05,.3,1)', fill: 'forwards' });
    an.finished.then(() => {
      if (st.run === run) st.dot.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
    }).catch(() => {});
  }

  // ---------------------------------------------------------------- 흐름 : 칸에 쌓기
  function makeItem(e, at) {
    const item = el('div', 'flx-item');
    const k = e.fin || tone(e.label);
    if (k !== 'on') item.classList.add('is-' + k);
    if (e.art) {
      // 걸음 이름(요청 1 · 요청 2 처럼 차례를 가르는 이름)은 실물 위 작은 머리로 — 순서 번호 배지 오른쪽
      if (e.step) {
        item.classList.add('has-step');
        item.append(el('span', 'flx-step', e.step));
      }
      if (e.art.kind === 'say') {
        const b = el('div', 'flx-say' + (at > 0 ? ' is-reply' : ''));
        b.append(rich(e.art.text));
        item.append(b);
      } else {
        const s = el('div', 'flx-slip');
        e.art.lines.forEach((ln) => {
          const l = el('span', 'flx-ln' + (/^=\s/.test(ln) ? ' is-tot' : ''));
          l.append(rich(ln));
          s.append(l);
        });
        item.append(s);
      }
      if (e.label) {
        const c = el('p', 'flx-cap');
        c.append(rich(e.label));
        item.append(c);
      }
    } else {
      // 실물 없는 옛 문법 : 표지 문구가 상자 (걸음 이름은 작게 위에 — 요청 1 · 요청 2 처럼 차례를 가르는 이름)
      const tag = el('div', 'flx-tag');
      if (e.step) tag.append(el('span', 'flx-step', e.step));
      tag.append(rich(e.label));
      item.append(tag);
    }
    return item;
  }

  function place(st, e, at, anim) {
    const L = st.lanes[at];
    L.lane.classList.add('is-on');
    let item = null;
    if (e.art || e.label) {
      item = makeItem(e, at);
      // 도착 순서 번호 : 칸마다 쌓여도 전체 순서가 보이게 (칸을 오가는 흐름 — stop_reason 루프 등)
      st.seq = (st.seq || 0) + 1;
      item.prepend(el('span', 'flx-no', String(st.seq)));
      L.tray.append(item);
      if (anim) pop(item);
    }
    // 방금 이동의 선 끝을 도착한 실물에 묶는다 (실물이 없으면 칸 이름)
    if (st.arrive && st.arrive.to === at) st.arrive.dst = item || L.lab;
    st.arrive = null;
  }

  function apply(st, e, anim) {
    if (e.kind === 'place') {
      place(st, e, e.at, anim);
    } else if (e.kind === 'ask') {
      st.stage.classList.add('is-ask');
      st.ask.textContent = st.data.question;
      if (anim) st.ask.classList.add('is-show');
    } else if (e.kind === 'unask') {
      st.stage.classList.remove('is-ask');
      st.ask.classList.remove('is-show');
    } else if (e.kind === 'dot') {
      st.lanes[colOf(e.from)].lane.classList.add('is-on'); // 출발만 한 칸도 쓴 칸 (끝 상태 흐림에서 뺌 — 보정하는 '사람' 등)
      moveDot(st, e, anim);
    } else if (e.kind === 'mark') {
      if (e.at.block != null) {
        // 블록 강조 : 블록에 ✓/≠ 표지, 문구·실물은 그 칸(첫 칸)에 쌓음
        const li = st.blockEls[e.at.block];
        const k = tone(e.label);
        if (li) {
          li.classList.remove('is-ok', 'is-ng', 'is-on');
          li.classList.add('is-' + k);
          li.querySelector('.fl-mk').textContent = k === 'ok' ? '✓' : k === 'ng' ? '≠' : '';
          if (anim) pop(li);
        }
        place(st, e, 0, anim);
      } else {
        place(st, e, e.at.col, anim);
      }
    } else if (e.kind === 'skip') {
      st.skipped.add(e.at);
      const L = st.lanes[e.at];
      L.lane.classList.add('is-skipped');
      L.skip.textContent = okScene(st) ? '안 거침 — 필요 없음' : L.rule ? '안 거침 — 규칙이 안 쓰임' : '안 거침';
      if (st.arrows[e.at - 1]) st.arrows[e.at - 1].classList.add('is-off');
      if (st.arrows[e.at]) st.arrows[e.at].classList.add('is-off');
    } else if (e.kind === 'timer') {
      const L = st.lanes[e.at];
      L.lane.classList.add('is-on');
      const tm = el('div', 'flx-item flx-timer');
      const ring = svg('svg', { viewBox: '0 0 40 40', focusable: 'false', 'aria-hidden': 'true' });
      const fg = svg('circle', { class: 'flx-ring', cx: 20, cy: 20, r: 16, pathLength: 100 });
      // 시계 바늘 (svg 가 −90° 돌아 있어 +x = 12시 · +y = 3시) — 끝 상태의 빈 원이 선택 단추(○)처럼 읽히지 않게
      ring.append(svg('circle', { class: 'flx-ring-bg', cx: 20, cy: 20, r: 16 }), fg,
        svg('path', { class: 'flx-hand', d: 'M20,20 H29 M20,20 V26' }));
      const lab = el('span');
      lab.append(rich(e.label));
      tm.append(ring, lab);
      L.tray.append(tm);
      // 만료 타이머 = 원이 다 줄어듦(남은 수명) · 기다림·걸리는 시간 타이머 = 원이 차오름(걸린 시간, 끝에 찬 원)
      const [a, b] = EXPIRE_RE.test(e.label || '') ? [0, 100] : [100, 0];
      if (anim) {
        pop(tm);
        fg.animate([{ strokeDashoffset: a }, { strokeDashoffset: b }], { duration: T.timer, fill: 'forwards' });
      } else fg.style.strokeDashoffset = String(b);
    } else if (e.kind === 'expire') {
      // 수명이 다 됨 → 그 칸에 쌓인 것이 사라진 것으로 (지우지 않고 흐리게 — 순서가 보이게)
      const tray = st.lanes[e.at].tray;
      const tm = tray.lastElementChild;
      if (tm) tm.querySelector('.flx-ring').style.strokeDashoffset = '100';
      Array.from(tray.children).forEach((c) => { if (c !== tm) c.classList.add('is-gone'); });
    } else if (e.kind === 'end') {
      const ok = e.verdict === 'ok';
      st.verdict.className = 'flx-verdict is-' + (ok ? 'ok' : 'ng');
      st.verdict.textContent = '';
      st.verdict.append(el('span', 'fl-v is-' + (ok ? 'ok' : 'ng'), ok ? '✓' : '≠'), rich(e.label));
      if (anim) pop(st.verdict);
    }
    // 칸이 자라는 걸음(놓기 · 강조 · 타이머 · 안 거침 표지) 뒤 선을 다시 계산 — 튀어나오는 중(pop)에 잰 좌표라 끝난 뒤 한 번 더
    if (anim && st.links.length && (e.kind === 'place' || e.kind === 'mark' || e.kind === 'timer' || e.kind === 'skip')) {
      drawLinks(st);
      const run = st.run;
      st.timers.push(setTimeout(() => { if (st.run === run) drawLinks(st); }, 240));
    }
  }

  // 끝 상태 마무리 : 선을 마지막 자리로 다시 계산 + 이 장면에서 안 쓴 칸(건너뜀 표지 없는)과 그 칸에 닿는 화살표를 흐림
  function settle(st) {
    drawLinks(st);
    const on = st.lanes.map((L) => L.lane.classList.contains('is-on'));
    st.arrows.forEach((a, i) => a.classList.toggle('is-idle', !on[i] || !on[i + 1])); // 화살표 i = 칸 i → i+1
    st.stage.classList.add('is-done');
  }

  // 끝 상태를 움직임 없이 바로 그림 (줄이기 설정 · 화면 밖으로 나감 · 폭이 바뀜 · IntersectionObserver 없음)
  function finish(st) {
    reset(st);
    timeline(st).forEach(([, e]) => apply(st, e, false));
    settle(st);
    st.done = true;
    st.playBtn.textContent = '다시 보기';
  }

  function play(st) {
    if (reduce.matches || !st.visible) { finish(st); return; }
    reset(st);
    const run = st.run;
    const ev = timeline(st);
    st.running = true;
    ev.forEach(([t, e], i) => {
      st.timers.push(setTimeout(() => {
        if (st.run !== run) return;
        apply(st, e, true);
        if (i === ev.length - 1) {
          st.running = false;
          st.done = true;
          st.playBtn.textContent = '다시 보기';
          settle(st);
        }
      }, t));
    });
    st.playBtn.textContent = '재생 중';
  }

  const flows = new Map(); // figure id → 상태
  const byStage = new Map();
  const enough = (en) => en.isIntersecting && (en.intersectionRatio >= 0.5
    || (en.rootBounds && en.intersectionRect.height >= 0.5 * en.rootBounds.height));
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      const st = byStage.get(en.target);
      if (!st) return;
      st.visible = en.isIntersecting;
      if (enough(en)) {
        if (st.pending) { st.pending = false; play(st); } else if (!st.autoplayed) { st.autoplayed = true; play(st); }
      } else if (!en.isIntersecting && st.running) {
        finish(st); // 보이지 않는 그림은 움직이지 않는다
      }
    });
  }, { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] }) : null;
  // 폭이 바뀌면(가로 ↔ 세로 · 창 크기) 점선·점 좌표가 낡는다 → 끝 상태로 다시 그림
  const ro = 'ResizeObserver' in window ? new ResizeObserver((entries) => {
    entries.forEach((en) => {
      const st = byStage.get(en.target);
      if (!st) return;
      const w = Math.round(en.contentRect.width);
      if (Math.abs(w - st.lastW) <= 1) return;
      const first = st.lastW === 0;
      st.lastW = w;
      if (!first && (st.done || st.running)) finish(st);
    });
  }) : null;

  document.querySelectorAll('figure.fl').forEach((fig) => {
    const src = fig.querySelector('script.fl-data');
    let data;
    try {
      data = JSON.parse(src.textContent);
    } catch (err) {
      console.warn('흐름 그림 데이터 읽기 실패', fig.id, err);
      return;
    }
    const st = build(fig, data);
    flows.set(fig.id, st);
    byStage.set(st.stage, st);
    st.visible = !io; // 관찰기가 없으면 보인다고 보고 끝 장면만 그림
    if (reduce.matches || !io) finish(st);
    else { reset(st); io.observe(st.stage); }
    if (ro) ro.observe(st.stage);
  });
  // 글꼴이 늦게 오면 칸 높이가 바뀐다 → 끝 상태를 다시 그림 (점선 좌표)
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => flows.forEach((st) => { if (st.done && !st.running) finish(st); }));
  }

  // 다른 절(지문)에서 부르는 장면 재생 : 그림으로 스크롤한 뒤 보이면 재생
  function showScene(id, i) {
    const st = flows.get(id);
    if (!st) return;
    select(st, Math.max(0, Math.min(i, st.data.scenes.length - 1)));
    st.autoplayed = true;
    st.fig.scrollIntoView({ behavior: reduce.matches ? 'auto' : 'smooth', block: 'start' });
    if (reduce.matches || !io) { finish(st); return; }
    const r = st.stage.getBoundingClientRect();
    const vis = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
    if (vis >= 0.5 * Math.min(r.height, window.innerHeight)) { play(st); return; }
    st.pending = true;
    // 더 스크롤할 수 없는 자리(쪽 끝)라 관찰기가 다시 안 부를 때를 대비
    setTimeout(() => { if (st.pending) { st.pending = false; play(st); } }, 1500);
  }

  // ---------------------------------------------------------------- 지문 : 딱지 구절 → 나무 경로 → (흐름 장면)
  document.querySelectorAll('.csx[data-path]').forEach((cs) => {
    const tree = document.getElementById(cs.dataset.tree);
    let path;
    try {
      path = JSON.parse(cs.dataset.path);
    } catch (err) {
      console.warn('지문 경로 읽기 실패', cs.id, err);
      return;
    }
    const go = cs.querySelector('.csx-go');
    const toFlow = cs.querySelector('.csx-flow');
    const marks = Array.from(cs.querySelectorAll('.csx-m'));
    if (!tree || !go) return;
    const toScene = () => showScene(cs.dataset.flow, Number(cs.dataset.scene) || 0);
    const beh = () => (reduce.matches ? 'auto' : 'smooth');
    // 나무가 화면보다 길면 지문 칸의 단추는 화면 위 밖에 있다 → 답 칸 바로 아래(나무 안)에도 같은 단추
    const leaf = path.length ? tree.querySelector(`[data-p="${path[path.length - 1][0]}"]`) : null;
    let atAns = null;
    if (toFlow && leaf) {
      atAns = el('p', 't5-at');
      atAns.hidden = true;
      const b = el('button', 't5-go', toFlow.textContent);
      b.type = 'button';
      b.addEventListener('click', toScene);
      atAns.append(b);
      leaf.after(atAns); // 답 상자 밖 — 같은 갈래 답 상자 높이 맞춤(evenLeaves)에 안 섞이게
    }
    const flowOn = (on) => {
      if (toFlow) toFlow.hidden = !on;
      if (atAns) atAns.hidden = !on;
    };
    let run = 0;
    go.addEventListener('click', async () => {
      run += 1;
      const my = run;
      flowOn(false);
      marks.forEach((m) => m.classList.remove('is-lit'));
      tree.getAnimations({ subtree: true }).forEach((a) => a.cancel());
      tree.querySelectorAll('.t5-hl.is-lit').forEach((h) => h.classList.remove('is-lit'));
      // 첫 자리 : 나무가 보이는 칸(위·아래 띠 뺀 높이)에 들어가면 가운데, 길면 머리부터
      const sp = getComputedStyle(document.documentElement);
      const room = window.innerHeight - (parseFloat(sp.scrollPaddingTop) || 0) - (parseFloat(sp.scrollPaddingBottom) || 0);
      tree.scrollIntoView({ behavior: beh(), block: tree.getBoundingClientRect().height <= room ? 'center' : 'start' });
      await wait(500);
      for (const [pid, tag] of path) {
        if (my !== run) return;
        const n = tree.querySelector(`[data-p="${pid}"]`);
        const h = n && n.querySelector(':scope > .t5-hl');
        if (h) h.classList.add('is-lit');
        // 켠 마디가 화면 밖이면 가장 적게 스크롤해 들임 (이미 보이면 그대로)
        if (n) n.scrollIntoView({ behavior: beh(), block: 'nearest' });
        // 한 걸음 딱지 = 글자 하나 또는 목록 ('[넓은 deny · 좁은 allow]')
        [].concat(tag || []).forEach((t) => marks.filter((m) => m.dataset.tag === t).forEach((m) => m.classList.add('is-lit')));
        await wait(750);
      }
      if (my !== run) return;
      // 경로 걸음에 안 쓰인 딱지(다른 나무를 거르는 신호 등)도 끝에 켠다 — 따라가기 전후 한 번도 안 보이던 결함
      marks.forEach((m) => m.classList.add('is-lit'));
      flowOn(true);
      if (atAns) atAns.scrollIntoView({ behavior: beh(), block: 'nearest' });
    });
    if (toFlow) toFlow.addEventListener('click', toScene);
  });

  // ---------------------------------------------------------------- 반복 : 결과 줄 (같은 입력을 여러 번)
  document.querySelectorAll('.rpx').forEach((rp) => {
    const runs = rp.querySelector('.rpx-runs');
    const go = rp.querySelector('.rpx-go');
    if (runs && go) {
      const rows = [];
      Array.from(runs.children).forEach((c) => {
        if (c.classList.contains('rpx-rl')) rows.push([]);
        else if (rows.length && !c.classList.contains('is-none')) rows[rows.length - 1].push(c);
      });
      const sums = Array.from(rp.querySelectorAll('.rpx-sum > li'));
      let run = 0;
      go.addEventListener('click', async () => {
        run += 1;
        const my = run;
        rows.flat().forEach((c) => { c.className = 'rpx-cell'; c.textContent = ''; });
        sums.forEach((li) => { li.hidden = true; });
        const n = Math.max(...rows.map((r) => r.length));
        for (let i = 0; i < n; i += 1) {
          for (let r = 0; r < rows.length; r += 1) {
            if (my !== run) return;
            const c = rows[r][i];
            if (!c) continue;
            const bad = c.hasAttribute('data-bad');
            c.className = 'rpx-cell ' + (bad ? 'is-bad' : 'is-fill');
            c.append(rich(c.dataset.v));
            if (bad) c.append(el('span', 'vh', ' 틀림'));
            if (!reduce.matches) pop(c);
            await wait(r === rows.length - 1 ? 320 : 180);
          }
        }
        if (my === run) sums.forEach((li) => { li.hidden = false; });
      });
    }
    const sim = rp.querySelector('.rpx-sim');
    if (sim) initSim(sim);
  });

  // ---------------------------------------------------------------- 반복 : 확률 모의 (과제 100개 × k 번 시도, pass@k · pass^k)
  function rng(a) {
    // mulberry32 — 시드가 같으면 같은 칸 (다시 돌리기 = 시드 + 1)
    return () => {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function initSim(sim) {
    const p = Number(sim.dataset.p) / 100;
    let k = Number(sim.dataset.k);
    let view = 'at';
    // 첫 화면 시드 : pass-at-k(75% · k 1,3,5,10)에서 모의값이 계산값과 2%p 안 — 카드 답 숫자(pass^3 ≈ 42%) 옆에서 어긋나 보이지 않게.
    // 시드 7 은 새 뽑기(과제마다 한 번)에서 k=3 pass^3 가 52/100 이었다. '다시 돌리기' 는 여전히 시드 + 1
    let seed = 9;
    let run = 0;
    let draws = []; // 과제 100개 × 가장 큰 k 번 — 시드마다 한 번만 뽑는다
    const grid = sim.querySelector('.rpx-grid');
    const kBtns = Array.from(sim.querySelectorAll('[data-k]'));
    const kMax = Math.max(k, ...kBtns.map((b) => Number(b.dataset.k) || 0));
    const picks = Array.from(sim.querySelectorAll('.rpx-pick'));
    const meter = (v) => ({
      n: sim.querySelector(`.rpx-n[data-view="${v}"]`),
      fill: sim.querySelector(`.rpx-bar[data-view="${v}"] .rpx-fill`),
      th: sim.querySelector(`.rpx-bar[data-view="${v}"] .rpx-th`),
    });
    const mAt = meter('at');
    const mAll = meter('all');
    // k 를 바꾸면 같은 과제의 앞 k 번만 보인다 (k 1→3 에서 첫 시도가 그대로 · 새로 뽑는 건 '다시 돌리기' 뿐)
    const simulate = () => {
      const r = rng(seed * 101);
      draws = Array.from({ length: 100 }, () => Array.from({ length: kMax }, () => r() < p));
    };
    const paint = (n) => {
      const tasks = draws.map((t) => t.slice(0, k));
      grid.textContent = '';
      tasks.forEach((t, i) => {
        const d = el('div', 'rpx-task');
        const pass = view === 'at' ? t.some(Boolean) : t.every(Boolean);
        if (i < n && pass) d.classList.add('is-pass');
        t.forEach((x) => d.append(el('i', i < n ? (x ? 'is-s' : 'is-f') : null)));
        grid.append(d);
      });
      const done = tasks.slice(0, n);
      const at = done.filter((t) => t.some(Boolean)).length;
      const all = done.filter((t) => t.every(Boolean)).length;
      const thAt = 1 - Math.pow(1 - p, k);
      const thAll = Math.pow(p, k);
      mAt.n.textContent = `${at}/${n || 100} · 계산 ${(thAt * 100).toFixed(1)}%`;
      mAll.n.textContent = `${all}/${n || 100} · 계산 ${(thAll * 100).toFixed(1)}%`;
      mAt.fill.style.width = `${n ? (at / n) * 100 : 0}%`;
      mAll.fill.style.width = `${n ? (all / n) * 100 : 0}%`;
      mAt.th.style.left = `${thAt * 100}%`;
      mAll.th.style.left = `${thAll * 100}%`;
    };
    const runSim = async () => {
      run += 1;
      const my = run;
      simulate();
      if (reduce.matches) { paint(100); return; }
      for (let n = 10; n <= 100; n += 10) {
        if (my !== run) return;
        paint(n);
        await wait(110);
      }
    };
    kBtns.forEach((b) => b.addEventListener('click', () => {
      k = Number(b.dataset.k);
      kBtns.forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      run += 1; // 돌던 모의를 멈추고 같은 시행에서 막대만 늘리고 줄임
      paint(100);
    }));
    picks.forEach((b) => b.addEventListener('click', () => {
      view = b.dataset.view;
      picks.forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      run += 1;
      paint(100);
    }));
    const again = sim.querySelector('.rpx-rerun');
    if (again) again.addEventListener('click', () => { seed += 1; runSim(); });
    simulate();
    paint(100);
  }

  // ---------------------------------------------------------------- 갈림길 : 뿌리 → 각 답까지 경로를 차례로 밝힘
  document.querySelectorAll('.tree[data-paths]').forEach((tree) => {
    const paths = tree.dataset.paths.split('|').map((p) => p.split(' '));
    const hl = (k) => tree.querySelector(`[data-p="${k}"] > .t5-hl`);
    const all = Array.from(tree.querySelectorAll('.t5-hl'));
    const btn = tree.querySelector('.t5-pp');
    let shown = -1; // 줄이기 설정 : 누를 때마다 다음 경로 하나를 바로 밝힘
    btn.addEventListener('click', () => {
      tree.getAnimations({ subtree: true }).forEach((a) => a.cancel());
      all.forEach((h) => h.classList.remove('is-lit'));
      if (reduce.matches) {
        shown = (shown + 1) % paths.length;
        paths[shown].forEach((k) => hl(k).classList.add('is-lit'));
        return;
      }
      let t = 0;
      paths.forEach((p, pi) => {
        p.forEach((k) => {
          hl(k).animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: t, fill: 'forwards' });
          t += 300;
        });
        if (pi < paths.length - 1) {
          t += 500;
          p.forEach((k) => hl(k).animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, delay: t, fill: 'forwards' }));
          t += 300;
        }
      });
    });
  });

  // 갈림길 : 같은 갈래(fork)의 답 상자 높이를 맞춘다 (가로 나무만 · 중첩 질문이 있는 갈래는 빼고)
  function evenLeaves(body) {
    body.querySelectorAll('.t5-fork').forEach((fork) => {
      const arms = Array.from(fork.children).filter((a) => a.classList.contains('is-leaf'));
      const edges = arms.map((a) => a.querySelector(':scope > .t5-edge'));
      const leaves = arms.map((a) => a.querySelector(':scope > .t5-leaf'));
      edges.forEach((e) => { if (e) e.style.marginBottom = ''; });
      leaves.forEach((l) => { if (l) l.style.minHeight = ''; });
      if (arms.length < 2 || getComputedStyle(fork).display !== 'grid' || edges.includes(null) || leaves.includes(null)) return;
      const eh = edges.map((e) => e.getBoundingClientRect().height);
      const emax = Math.max(...eh);
      const mb = parseFloat(getComputedStyle(edges[0]).marginBottom) || 0;
      edges.forEach((e, i) => { if (emax - eh[i] > 0.5) e.style.marginBottom = `${mb + emax - eh[i]}px`; });
      const h = Math.max(...leaves.map((l) => l.getBoundingClientRect().height));
      leaves.forEach((l) => { l.style.minHeight = `${h}px`; });
    });
  }
  // 갈림길 : 가로 나무인데 배치 뒤 답 상자가 140px 보다 좁으면 세로 나무로 — 생성기 규칙(답 5개 · 중첩 2단 · 답 4개 + 중첩)이
  // 못 잡은 좁은 칸 보정. 생성기가 붙인 is-deep 은 그대로 두고 JS 가 붙인 것(data-auto-deep)만 폭이 바뀔 때마다 다시 잰다
  // (떼고 → 재고 → 붙이기가 한 번에 일어나 깜빡이지 않음)
  const MIN_LEAF = 140;
  function fitTree(body) {
    if (body.classList.contains('is-deep') && !body.hasAttribute('data-auto-deep')) return;
    body.classList.remove('is-deep');
    body.removeAttribute('data-auto-deep');
    const ws = Array.from(body.querySelectorAll('.t5-leaf')).map((l) => l.getBoundingClientRect().width).filter((w) => w > 0);
    if (ws.length && Math.min(...ws) < MIN_LEAF) {
      body.classList.add('is-deep');
      body.setAttribute('data-auto-deep', '');
    }
  }
  const bodies = Array.from(document.querySelectorAll('.tree .tree-body'));
  const evenAll = () => bodies.forEach((b) => { fitTree(b); evenLeaves(b); });
  evenAll();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(evenAll);
  if ('ResizeObserver' in window) {
    const widths = new Map();
    let queued = false;
    const tro = new ResizeObserver((entries) => {
      let changed = false;
      entries.forEach((en) => {
        const w = Math.round(en.contentRect.width);
        if (widths.get(en.target) !== w) { widths.set(en.target, w); changed = true; }
      });
      if (changed && !queued) {
        queued = true;
        requestAnimationFrame(() => { queued = false; evenAll(); });
      }
    });
    bodies.forEach((b) => tro.observe(b));
  }
})();
