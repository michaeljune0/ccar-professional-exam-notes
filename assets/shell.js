/* CCAR-P 개념 카드 틀 : 왼쪽 목록 여닫기(900px 미만 = 서랍) + 봄 기록 + 목록 나무 여닫기 + 테마 선택 + 규칙 링크 도착
 * (build-concepts.py 가 목차 · 개념 쪽에 링크한다)
 *
 * 봄 기록 = localStorage 'ccarp-concepts-seen' (개념 id 배열). 봄 = ● · 안 봄 = ○.
 *        저장소가 막혀 있으면(사생활 창 · 차단) 조용히 ○ 로 둔다.
 * 서랍 : 열면 본문 · 맨 아래 띠 · 사이트 이름에 inert → 초점은 목록과 여닫기 버튼 안에서만 돈다.
 *        Esc · 바깥 누르기 · 버튼으로 닫고 초점은 버튼으로 돌려준다. 넓은 화면의 목록 닫기는 그 화면 폭에서만 기억.
 * 목록 폭 (900px 이상) : 오른쪽 경계 손잡이(.side-resize, role=separator)를 끌면 <html> 의 --side-w 가 바뀌어
 *        목록 폭 · 본문 왼쪽 여백 · 맨 아래 띠가 같이 움직인다. 범위 240 ~ min(640, 창 폭 절반), 두 번 누르기 = 300
 *        (기본 폭 = concepts.css --side-w 와 같게),
 *        ← → = 16px. 저장 = localStorage 'ccarp-concepts-side-w' (쪽을 옮겨도 유지). 첫 그림 전 적용은 build-concepts.py 의
 *        SIDE_W_HEAD 인라인 스크립트 — 키 · 범위를 같이 고친다. 900px 미만(서랍)은 기본 폭 그대로.
 *        (문서 : MDN Element.setPointerCapture — 끌기 중 포인터가 손잡이 밖으로 나가도 pointermove 를 받음 · touch-action:none,
 *         MDN ARIA separator role — 초점 가능한 separator 는 aria-valuenow 필수, min/max 가 0/100 이 아니면 명시)
 */
(() => {
  'use strict';
  const SEEN_KEY = 'ccarp-concepts-seen';
  const SIDE_KEY = 'ccarp-concepts-side-closed';
  const body = document.body;
  const btn = document.querySelector('.nav-toggle');
  const nav = document.getElementById('site-nav');
  const scrim = document.querySelector('.scrim');
  if (!btn || !nav) return;

  const read = (k) => { try { return window.localStorage.getItem(k); } catch (e) { return null; } };
  const write = (k, v) => { try { window.localStorage.setItem(k, v); } catch (e) { /* 저장 못 해도 화면은 그대로 */ } };
  const forget = (k) => { try { window.localStorage.removeItem(k); } catch (e) { /* 위와 같음 */ } };

  // ---------------------------------------------------------------- 봄 기록
  let seen = [];
  try {
    const v = JSON.parse(read(SEEN_KEY) || '[]');
    if (Array.isArray(v)) seen = v.filter((x) => typeof x === 'string');
  } catch (e) { seen = []; }
  const here = body.dataset.page;
  if (here && !seen.includes(here)) {
    seen.push(here);
    write(SEEN_KEY, JSON.stringify(seen));
  }
  nav.querySelectorAll('.side-item[data-id]').forEach((a) => {
    if (!seen.includes(a.dataset.id)) return;
    // 봄 = ● · 안 봄 = ○ (✓ 는 근거 표시 '✓ 확인' 과 헷갈려 쓰지 않는다 — 목록 맨 위 범례와 같은 기호)
    a.classList.add('is-seen');
    a.querySelector('.side-mark').textContent = '●';
    a.querySelector('.side-state').textContent = ' (봄)';
  });
  // 목표 줄 끝 = 본 개수 / 개념 수 (접혀 있어도 봄 상태가 보이게 · 다 보면 파랑)
  nav.querySelectorAll('.st-goal').forEach((li) => {
    const cnt = li.querySelector('.st-cnt');
    if (!cnt) return;
    const all = li.querySelectorAll('.side-item').length;
    const got = li.querySelectorAll('.side-item.is-seen').length;
    cnt.textContent = `${got}/${all}`;
    li.classList.toggle('is-done', got === all);
  });

  // ---------------------------------------------------------------- 나무 여닫기
  // 가지 = button.st-tg[data-tree] (aria-expanded) + aria-controls 가 가리키는 ul (hidden). 기본 모양은 build-concepts.py 가
  // 적어 둠(도메인 펼침 · 목표 접힘 · 지금 쪽 가지 펼침). 보는 사람이 누른 가지만 localStorage 'ccarp-concepts-tree'
  // ({가지 이름: 1 펼침 | 0 접힘}) 에 기억해 덮고, 지금 보는 쪽의 조상 가지는 기억과 상관없이 늘 펼친다.
  // (문서 : WAI-ARIA APG Disclosure pattern — 내용이 보이면 aria-expanded=true, 숨으면 false · aria-controls = 내용 요소)
  const TREE_KEY = 'ccarp-concepts-tree';
  let tree = {};
  try {
    const v = JSON.parse(read(TREE_KEY) || '{}');
    if (v && typeof v === 'object' && !Array.isArray(v)) tree = v;
  } catch (e) { tree = {}; }
  const setBranch = (tg, open) => {
    const box = document.getElementById(tg.getAttribute('aria-controls'));
    tg.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (box) box.hidden = !open;
  };
  const toggles = nav.querySelectorAll('.st-tg[data-tree]');
  const hereItem = nav.querySelector('.side-item[aria-current="page"]');
  toggles.forEach((tg) => {
    const k = tg.dataset.tree;
    if (k in tree) setBranch(tg, tree[k] === 1);
  });
  if (hereItem) {
    for (let li = hereItem.closest('li'); li && nav.contains(li); li = li.parentElement.closest('li')) {
      const tg = li.querySelector(':scope > .st-tg');
      if (tg) setBranch(tg, true);
    }
  }
  toggles.forEach((tg) => {
    tg.addEventListener('click', () => {
      const open = tg.getAttribute('aria-expanded') !== 'true';
      setBranch(tg, open);
      tree[tg.dataset.tree] = open ? 1 : 0;
      write(TREE_KEY, JSON.stringify(tree));
    });
  });

  // ---------------------------------------------------------------- 테마
  // 선택 상자 (맨 위 띠) : auto = data-theme 없음(밝음/어둠 자동). 저장 = localStorage 'ccarp-concepts-theme'.
  // 첫 그림 전 적용은 build-concepts.py 의 THEME_HEAD 인라인 스크립트 — 키 · 값 목록을 같이 고친다.
  const THEME_KEY = 'ccarp-concepts-theme';
  const pick = document.querySelector('.theme-pick');
  if (pick) {
    const cur = document.documentElement.dataset.theme;
    pick.value = cur && [...pick.options].some((o) => o.value === cur) ? cur : 'auto';
    pick.addEventListener('change', () => {
      const t = pick.value;
      if (t === 'auto') {
        delete document.documentElement.dataset.theme;
        forget(THEME_KEY);
      } else {
        document.documentElement.dataset.theme = t;
        write(THEME_KEY, t);
      }
    });
  }

  // ---------------------------------------------------------------- 규칙 링크 도착
  // '· 규칙 ③' 링크(#<카드 id>-rule-3)의 도착 규칙이 접힌 '규칙 원문'(details) 안이면 열고 다시 스크롤한다
  // (브라우저가 조각 이동 때 details 를 스스로 여는지는 기대지 않음). 첫 열기 · 같은 쪽 안 이동(hashchange) 둘 다.
  const reveal = () => {
    let id = '';
    try { id = decodeURIComponent(window.location.hash.slice(1)); } catch (e) { return; }
    const t = id && document.getElementById(id);
    if (!t) return;
    let opened = false;
    for (let d = t.closest('details:not([open])'); d; d = d.parentElement && d.parentElement.closest('details:not([open])')) {
      d.open = true;
      opened = true;
    }
    if (opened) t.scrollIntoView();
  };
  reveal();
  window.addEventListener('hashchange', reveal);

  // 지금 보는 쪽이 목록 창 안에 보이게 (페이지는 스크롤하지 않고 목록만)
  const cur = nav.querySelector('.side-item[aria-current="page"]');
  if (cur) {
    const top = cur.getBoundingClientRect().top - nav.getBoundingClientRect().top + nav.scrollTop;
    if (top > nav.clientHeight * 0.6) nav.scrollTop = top - nav.clientHeight / 3;
  }

  // ---------------------------------------------------------------- 여닫기
  const narrow = window.matchMedia('(max-width: 899px)');
  const outside = () => document.querySelectorAll('[data-shell-outside]');
  let drawerOpen = false;

  // 접힌 가지(hidden) 안 링크는 초점을 못 받으니 가두기 끝점에서 뺀다
  const focusables = () => [btn, ...[...nav.querySelectorAll('a[href], button:not([disabled])')].filter((n) => !n.closest('[hidden]'))];

  function openDrawer() {
    drawerOpen = true;
    body.classList.add('side-open');
    btn.setAttribute('aria-expanded', 'true');
    if (scrim) scrim.hidden = false;
    outside().forEach((n) => { n.inert = true; });
    (nav.querySelector('[aria-current="page"]') || nav.querySelector('a[href]')).focus();
  }

  function closeDrawer(returnFocus) {
    if (!drawerOpen) return;
    drawerOpen = false;
    body.classList.remove('side-open');
    btn.setAttribute('aria-expanded', 'false');
    if (scrim) scrim.hidden = true;
    outside().forEach((n) => { n.inert = false; });
    if (returnFocus) btn.focus();
  }

  // ---------------------------------------------------------------- 목록 폭 (900px 이상)
  const W_KEY = 'ccarp-concepts-side-w';
  const W_DEF = 300;
  const W_MIN = 240;
  const W_CAP = 640;
  const W_STEP = 16;
  const root = document.documentElement;
  const grip = document.querySelector('.side-resize');
  const wMax = () => Math.max(W_MIN, Math.min(W_CAP, Math.floor(window.innerWidth / 2)));
  const savedW = () => { const w = parseFloat(read(W_KEY)); return w > 0 ? w : W_DEF; };
  let sideW = W_DEF;

  function setW(w) {
    sideW = Math.round(Math.min(wMax(), Math.max(W_MIN, w)));
    root.style.setProperty('--side-w', `${sideW}px`);
    if (grip) {
      grip.setAttribute('aria-valuenow', String(sideW));
      grip.setAttribute('aria-valuemax', String(wMax()));
    }
  }

  function syncW() {
    // 서랍(900px 미만)은 기본 폭 — 넓은 화면에서 바꾼 폭을 걷어낸다. 넓은 화면은 저장값을 지금 창 폭 범위로 다시 맞춘다
    if (narrow.matches) root.style.removeProperty('--side-w');
    else setW(savedW());
  }

  if (grip) {
    let drag = null;
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      // 기본 동작(mousedown) 막기 : 안 막으면 좁은 목록에서 끌기 첫 걸음에 목록 링크의 끌어놓기(dragstart)가 시작돼
      // pointercancel 로 잡기가 풀린다 (2026-09-29 실측 — 240px 에서 +400 끌기가 340 에서 멈춤). dblclick 은 그대로 온다(실측)
      e.preventDefault();
      drag = { x: e.clientX, w: sideW };
      grip.setPointerCapture(e.pointerId);
      body.classList.add('is-resizing');
    });
    grip.addEventListener('pointermove', (e) => {
      if (drag) setW(drag.w + e.clientX - drag.x);
    });
    const endDrag = () => {
      if (!drag) return;
      drag = null;
      body.classList.remove('is-resizing');
      write(W_KEY, String(sideW));
    };
    grip.addEventListener('pointerup', endDrag);
    grip.addEventListener('pointercancel', endDrag);
    grip.addEventListener('lostpointercapture', endDrag);
    grip.addEventListener('dblclick', () => {
      forget(W_KEY);
      setW(W_DEF);
    });
    grip.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowLeft' ? -W_STEP : e.key === 'ArrowRight' ? W_STEP : 0;
      if (!d) return;
      e.preventDefault();
      setW(sideW + d);
      write(W_KEY, String(sideW));
    });
  }
  window.addEventListener('resize', () => { if (!narrow.matches) setW(savedW()); });

  function sync() {
    // 폭이 바뀌면 서랍은 닫고, 버튼 상태를 그 폭의 목록 상태에 맞춘다
    closeDrawer(false);
    syncW();
    if (narrow.matches) btn.setAttribute('aria-expanded', 'false');
    else {
      const closed = read(SIDE_KEY) === '1';
      body.classList.toggle('side-closed', closed);
      btn.setAttribute('aria-expanded', closed ? 'false' : 'true');
    }
  }

  btn.addEventListener('click', () => {
    if (narrow.matches) {
      if (drawerOpen) closeDrawer(true);
      else openDrawer();
      return;
    }
    const closed = !body.classList.contains('side-closed');
    body.classList.toggle('side-closed', closed);
    btn.setAttribute('aria-expanded', closed ? 'false' : 'true');
    write(SIDE_KEY, closed ? '1' : '0');
  });

  if (scrim) scrim.addEventListener('click', () => closeDrawer(true));

  document.addEventListener('keydown', (e) => {
    if (!drawerOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDrawer(true);
      return;
    }
    if (e.key !== 'Tab') return;
    // 초점 가두기 : 버튼 ↔ 목록 끝을 잇는다 (나머지는 inert 라 초점이 가지 않음)
    const f = focusables();
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // 목록에서 같은 쪽 안 링크를 누르면(목차 첫 화면의 #) 서랍을 닫는다
  nav.addEventListener('click', (e) => {
    if (drawerOpen && e.target.closest('a[href]')) closeDrawer(false);
  });

  if (narrow.addEventListener) narrow.addEventListener('change', sync);
  else if (narrow.addListener) narrow.addListener(sync);
  sync();
})();
