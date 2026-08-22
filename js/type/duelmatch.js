/* 대결 한 판을 어떻게 짜고 어떻게 이겼는지 가르는가 — 순수 계산, DOM 없음.
 *
 * 화면에서 떼어 둔 이유가 있다. 대결은 서버와 상대가 있어야 돌아가서 손으로
 * 확인하기가 어려운데, 판을 뽑는 규칙과 승패를 가르는 규칙은 그것과 상관없이
 * 혼자서 검사할 수 있다. 틀리면 가장 티가 안 나면서 가장 억울한 곳이라 떼어 놓는다.
 *
 * 두 종목의 승패 기준이 다르다.
 *   글쓰기 — 같은 글을 나란히 친다. 진행은 '친 타수'. 먼저 다 친 쪽이 이긴다.
 *   성 지키기 — 같은 적이 똑같은 순서로 온다. 진행은 '막은 수'.
 *              먼저 다 막으면 이기고, 성이 먼저 무너지면 거기서 멈춘다.
 * 어느 쪽이든 순수한 속도 겨루기다. 상대를 방해하는 수단은 없다.
 */

export const MODES = {
  write: {
    name: "글쓰기 대결",
    short: "글쓰기",
    desc: "같은 글을 나란히 칩니다. 먼저 끝까지 친 사람이 이깁니다.",
    unit: "타",
  },
  castle: {
    name: "성 지키기 대결",
    short: "성 지키기",
    desc: "똑같은 적이 두 사람에게 같은 순서로 옵니다. 먼저 다 막은 사람이 이깁니다.",
    unit: "마리",
  },
};

export const isMode = (m) => Object.prototype.hasOwnProperty.call(MODES, m);

/** 판을 뽑을 때 쓰는 무작위. 시험할 때 갈아 끼울 수 있게 밖에서 받는다. */
const pickOne = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];

function shuffled(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* 글자 하나가 몇 타인지 세는 일은 hangul.analyze 가 하지만, 이 파일을 순수하게
   두려고 셈 함수를 밖에서 받는다. 기본은 '글자 수'로, 시험에는 그걸로 충분하다. */
const defaultCount = (s) => [...s].length;

/**
 * 글쓰기 대결 판. 고른 지문에서 한 편을 뽑는다.
 * @param {Array<{title:string, lines:string[]}>} texts
 * @param {{rnd?:function, strokes?:function}} [opt] strokes 는 문장 → 타수
 */
export function buildWrite(texts, opt = {}) {
  const rnd = opt.rnd || Math.random;
  const count = opt.strokes || defaultCount;
  if (!texts || !texts.length) throw new Error("쓸 글이 없습니다");
  const t = pickOne(texts, rnd);
  const lines = t.lines.slice();
  return {
    mode: "write",
    title: t.title,
    lines,
    total: lines.reduce((a, l) => a + count(l), 0),
  };
}

/** 성 지키기 대결에서 막아야 하는 적의 수 */
export const CASTLE_FOES = 12;
/** 성이 견디는 횟수 */
export const CASTLE_HP = 5;

/**
 * 성 지키기 대결 판. 낱말을 뽑아 순서를 못박는다.
 * 두 사람이 같은 낱말을 같은 순서로, 같은 속도로 받아야 하므로 시작할 때 다 정한다.
 */
export function buildCastle(words, opt = {}) {
  const rnd = opt.rnd || Math.random;
  const n = opt.count || CASTLE_FOES;
  if (!words || !words.length) throw new Error("쓸 낱말이 없습니다");
  const pool = shuffled(words, rnd);
  const picked = [];
  for (let i = 0; i < n; i++) picked.push(pool[i % pool.length]);
  return { mode: "castle", words: picked, total: n, hp: CASTLE_HP };
}

/**
 * i 번째 적이 성까지 오는 데 걸리는 시간과, 다음 적이 나오기까지의 간격(초).
 * 뒤로 갈수록 조여 오지만 바닥은 둔다 — 이제 배우는 아이가 손도 못 대면 겨루기가 안 된다.
 * 무작위를 쓰지 않는다. 두 사람이 정확히 같은 판을 받아야 하기 때문이다.
 */
export function foePace(i) {
  return {
    cross: Math.max(13, 26 - i * 0.8),
    gap: Math.max(1.8, 3.4 - i * 0.12),
  };
}

/**
 * 등수를 매긴다. 다 끝낸 사람이 먼저고, 그 안에서는 빠른 쪽이 먼저다.
 * 못 끝냈으면 더 많이 나아간 쪽이 앞선다. 완전히 같으면 같은 등수(무승부).
 * @param {Array<{id:string, progress:number, done_ms:?number}>} players
 * @returns {Array<{id:string, pos:number}>} 등수 순으로 정렬
 */
export function rank(players) {
  const sorted = players.slice().sort((a, b) => {
    const ad = a.done_ms != null, bd = b.done_ms != null;
    if (ad !== bd) return ad ? -1 : 1;
    if (ad && bd) return a.done_ms - b.done_ms;
    return (b.progress || 0) - (a.progress || 0);
  });
  const key = (p) => (p.done_ms != null ? `d${p.done_ms}` : `p${p.progress || 0}`);
  const out = [];
  let pos = 0, prev = null;
  sorted.forEach((p, i) => {
    if (key(p) !== prev) { pos = i + 1; prev = key(p); }
    out.push({ id: p.id, pos });
  });
  return out;
}

/** 진행률(%) — 화면의 막대에 쓴다 */
export function pct(progress, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((progress / total) * 100)));
}
