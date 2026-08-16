/* 레이저 미로 — 규칙 · 빛 추적 · 솔버 · 생성기
 *
 * 게임 규칙
 *   · 광원에서 빛이 한 방향으로 나간다. 광원은 판 바깥 가장자리에 있다.
 *   · 거울은 정확히 N개를 받고 하나도 남기지 않고 놓아야 한다.
 *   · 모든 목표에 빛이 닿아야 한다.
 *   · 판마다 답은 정확히 하나다. 거울을 덜 쓰고 클리어되는 지름길도 없다.
 *     둘 다 생성 뒤 '조이기'가 보장한다.
 *
 * 브라우저와 빌드 도구(tools/) 양쪽에서 쓴다.
 */

/* ── 방향: 0=오른쪽 1=아래 2=왼쪽 3=위 ── */
export const DX = [1, 0, -1, 0];
export const DY = [0, 1, 0, -1];

/** '/' 거울: 0↔3, 1↔2 */
const REFLECT_SLASH = (d) => 3 - d;
/** '\' 거울: 0↔1, 2↔3 */
const REFLECT_BACK = (d) => d ^ 1;

/* ── 칸 종류 ── */
export const EMPTY = 0;
export const WALL = 1;
export const TARGET = 2;
export const SPLIT_SLASH = 3;   // 분광기 — 반사와 직진을 동시에
export const SPLIT_BACK = 4;
export const FIXED_SLASH = 5;   // 처음부터 박혀 있는 거울
export const FIXED_BACK = 6;

/** 플레이어가 놓는 거울 */
export const MIRROR_SLASH = "/";
export const MIRROR_BACK = "\\";

/* ── 난수 (씨앗 고정) ── */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ══════════════ 판 ══════════════ */

export function makeBoard(W, H) {
  return { W, H, cells: new Uint8Array(W * H), src: null, mirrors: 0 };
}

export const at = (b, x, y) => b.cells[y * b.W + x];
export const set = (b, x, y, v) => { b.cells[y * b.W + x] = v; };
export const inside = (b, x, y) => x >= 0 && x < b.W && y >= 0 && y < b.H;

/** 광원은 판 바깥 가장자리에 두고 안쪽을 향한다. */
export function setSource(b, x, y, dir) { b.src = { x, y, dir }; }

/* ══════════════ 빛 추적 ══════════════
   placed: Map("x,y" → "/" | "\\" | null(비움))
   반환: { hits:Set(목표 인덱스), path:[{x,y,dir}], used:놓인 거울 수, loop:무한반사 여부 } */

export function trace(b, placed) {
  const hits = new Set();
  const path = [];
  const ends = [];                 // 빛이 멎은 마지막 칸들 — 목표를 세울 자리
  const segs = [];                 // 그리기용 선분 (칸 좌표)
  const seen = new Set();
  const queue = [{ x: b.src.x, y: b.src.y, dir: b.src.dir }];
  let loop = false;

  while (queue.length) {
    let { x, y, dir } = queue.pop();
    for (;;) {
      const px = x, py = y;
      x += DX[dir]; y += DY[dir];
      segs.push({ x1: px, y1: py, x2: x, y2: y });
      if (!inside(b, x, y)) { ends.push({ x: x - DX[dir], y: y - DY[dir] }); break; }

      const key = `${x},${y},${dir}`;
      if (seen.has(key)) { loop = true; break; }
      seen.add(key);
      path.push({ x, y, dir });

      const c = at(b, x, y);
      if (c === WALL) { ends.push({ x: x - DX[dir], y: y - DY[dir] }); break; }
      if (c === TARGET) { hits.add(y * b.W + x); continue; }   // 목표는 통과

      if (c === FIXED_SLASH) { dir = REFLECT_SLASH(dir); continue; }
      if (c === FIXED_BACK) { dir = REFLECT_BACK(dir); continue; }

      if (c === SPLIT_SLASH || c === SPLIT_BACK) {
        const r = c === SPLIT_SLASH ? REFLECT_SLASH(dir) : REFLECT_BACK(dir);
        queue.push({ x, y, dir: r });                          // 반사분은 나중에
        continue;                                              // 직진분은 계속
      }

      const m = placed && placed.get(`${x},${y}`);
      if (m === MIRROR_SLASH) { dir = REFLECT_SLASH(dir); continue; }
      if (m === MIRROR_BACK) { dir = REFLECT_BACK(dir); continue; }
      // 빈 칸이면 그대로 직진
    }
  }
  return { hits, path, ends, segs, loop };
}

/** 판 위의 목표 칸 인덱스 목록 */
export function targetsOf(b) {
  const t = [];
  for (let i = 0; i < b.cells.length; i++) if (b.cells[i] === TARGET) t.push(i);
  return t;
}

/* ══════════════ 솔버 ══════════════
   모든 배치를 훑지 않는다. 빛을 따라가며 "이 칸을 비울까 / '/' 를 놓을까 / '\\' 를 놓을까"만
   가른다. 빛이 닿지 않는 칸에는 애초에 거울을 놓지 않으므로 탐색 공간이 훨씬 작고,
   "놓은 거울은 전부 빛을 받아야 한다"는 규칙도 저절로 지켜진다.

   반환: { solutions, nodes, first } — nodes 가 난이도의 주 지표다. */

export function solve(b, mirrorBudget, opts = {}) {
  const limit = opts.nodeLimit || 400000;
  const maxSolutions = opts.maxSolutions || 64;
  const targets = targetsOf(b);
  const need = targets.length;

  const collect = !!opts.collect;          // 해를 실제로 모을지 — 조이기에 쓴다
  let nodes = 0, solutions = 0, first = null, aborted = false;
  const list = [];

  /* decided: 칸 → "/" | "\\" | "." (비우기로 확정)
     fronts: 아직 진행해야 할 빛 갈래 */
  function walk(fronts, decided, left, hits) {
    if (aborted) return;
    if (++nodes > limit) { aborted = true; return; }

    if (!fronts.length) {
      if (left === 0 && hits.size === need) {
        solutions++;
        const m = new Map([...decided].filter(([, v]) => v !== "."));
        if (!first) first = m;
        if (collect) list.push(m);
      }
      return;
    }

    const front = fronts[fronts.length - 1];
    const rest = fronts.slice(0, -1);
    let { x, y, dir } = front;
    const localSeen = front.seen || new Set();

    for (;;) {
      x += DX[dir]; y += DY[dir];
      if (!inside(b, x, y)) return walk(rest, decided, left, hits);

      const key = `${x},${y},${dir}`;
      if (localSeen.has(key)) return walk(rest, decided, left, hits);  // 무한반사
      localSeen.add(key);

      const c = at(b, x, y);
      if (c === WALL) return walk(rest, decided, left, hits);

      if (c === TARGET) {
        if (!hits.has(y * b.W + x)) { hits = new Set(hits); hits.add(y * b.W + x); }
        continue;
      }
      if (c === FIXED_SLASH) { dir = REFLECT_SLASH(dir); continue; }
      if (c === FIXED_BACK) { dir = REFLECT_BACK(dir); continue; }
      if (c === SPLIT_SLASH || c === SPLIT_BACK) {
        const r = c === SPLIT_SLASH ? REFLECT_SLASH(dir) : REFLECT_BACK(dir);
        rest.push({ x, y, dir: r, seen: new Set(localSeen) });
        continue;
      }

      const cell = `${x},${y}`;
      const done = decided.get(cell);

      if (done === "/") { dir = REFLECT_SLASH(dir); continue; }
      if (done === "\\") { dir = REFLECT_BACK(dir); continue; }
      if (done === ".") continue;

      // 여기서 갈린다 — 비우거나, 거울 두 방향 중 하나
      const branches = [["."], ...(left > 0 ? [["/"], ["\\"]] : [])];
      for (const [choice] of branches) {
        const d2 = new Map(decided); d2.set(cell, choice);
        if (choice === ".") {
          walk([...rest, { x, y, dir, seen: new Set(localSeen) }], d2, left, hits);
        } else {
          const nd = choice === "/" ? REFLECT_SLASH(dir) : REFLECT_BACK(dir);
          walk([...rest, { x, y, dir: nd, seen: new Set(localSeen) }], d2, left - 1, hits);
        }
        if (aborted || solutions >= maxSolutions) return;
      }
      return;
    }
  }

  walk([{ x: b.src.x, y: b.src.y, dir: b.src.dir, seen: new Set() }], new Map(), mirrorBudget, new Set());
  return { solutions, nodes, first, aborted, list };
}

/* ══════════════ 난이도 점수 ══════════════
   두 번 재서 두 번 뒤집혔다.

   1차(느슨한 판 8개): 노드 수 ρ 0.55, 거울 개수 ρ 0.86 — 거울이 이겼다.
   2차(답이 하나뿐인 판 10개): 노드 수 ρ 0.87, 거울 개수 ρ 0.72 — 노드가 이겼다.

   뒤집힌 이유가 분명하다. 1차 때는 답이 수천 개라 탐색할 게 없었고, 그래서 노드 수가
   아무것도 재지 못했다. 판을 조여 답을 하나로 만들자 노드 수가 제 구실을 했다.
   같은 사양 안에서도 그렇다 — 7×7 거울4 두 판이 노드 282 / 3307 이었는데
   푼 시간이 6.6초 / 170.5초였다. 26배 차이를 거울 개수로는 볼 수 없다.

   그래서 노드를 주 지표로 되돌린다. 거울 항은 작게 남긴다 — 조각을 더 놓는 손품은
   실제로 들고, 노드만 쓰면 점수가 솔버 구현에 너무 민감해진다.
   지금 가중치의 순위상관은 0.84 다(노드만 쓰면 0.87, 표본 10개에서 그 차이는 잡음).

   해의 개수 항은 뺐다 — 이제 모든 판이 답 하나라서 상수였다.
   절대값에는 의미가 없다 — 판들을 줄 세우는 데만 쓴다. */
export function difficulty({ nodes, mirrors }) {
  return Math.round(Math.log2(nodes + 1) * 12 + mirrors * 4);
}

/* ══════════════ 생성 ══════════════
   앞에서 뒤로 만든다 — 빛을 실제로 쏘면서 거울을 놓아 경로를 만들고,
   빛이 멎는 자리에 목표를 세운다. 그 뒤 거울을 걷어 내면 그게 문제가 된다. */

export let lastFail = "";
export function generate(spec, seed) {
  lastFail = "";
  const { W, H, mirrors, walls = 0, splitters = 0, targets = 1 } = spec;
  const rnd = rng(seed);
  const b = makeBoard(W, H);

  // 광원 — 가장자리 바깥에서 안쪽을 향한다
  const side = (rnd() * 4) | 0;
  if (side === 0) setSource(b, -1, (rnd() * H) | 0, 0);
  else if (side === 1) setSource(b, (rnd() * W) | 0, -1, 1);
  else if (side === 2) setSource(b, W, (rnd() * H) | 0, 2);
  else setSource(b, (rnd() * W) | 0, H, 3);

  // 벽과 분광기를 먼저 흩는다
  const free = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) free.push([x, y]);
  for (let i = free.length - 1; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0; [free[i], free[j]] = [free[j], free[i]];
  }
  let fi = 0;
  for (let i = 0; i < walls && fi < free.length; i++, fi++) set(b, free[fi][0], free[fi][1], WALL);
  for (let i = 0; i < splitters && fi < free.length; i++, fi++)
    set(b, free[fi][0], free[fi][1], rnd() < 0.5 ? SPLIT_SLASH : SPLIT_BACK);

  /* 빛을 쏘면서 거울을 놓는다.
     한 번 걸어 보고 거울이 남으면 판째로 버리곤 했는데, 큰 판에서는 그것 하나로
     대부분이 날아갔다(9×9 거울11 에서 400번 중 157번). 벽과 분광기 배치는 멀쩡하니
     걷기만 다시 한다 — 꺾는 선택이 무작위라 다시 걸으면 다른 길이 나온다. */
  let placed = new Map();
  let ends = [];
  const WALKS = 24;
  let toPlace = mirrors;

  for (let attempt = 0; attempt < WALKS; attempt++) {
  placed = new Map();
  ends = [];
  toPlace = mirrors;
  const queue = [{ x: b.src.x, y: b.src.y, dir: b.src.dir }];
  const seen = new Set();
  let steps = 0;

  while (queue.length && steps < 4000) {
    let { x, y, dir } = queue.pop();
    for (;;) {
      steps++;
      x += DX[dir]; y += DY[dir];
      if (!inside(b, x, y)) { ends.push({ x: x - DX[dir], y: y - DY[dir] }); break; }
      const key = `${x},${y},${dir}`;
      if (seen.has(key)) break;
      seen.add(key);

      const c = at(b, x, y);
      if (c === WALL) { ends.push({ x: x - DX[dir], y: y - DY[dir] }); break; }
      if (c === SPLIT_SLASH || c === SPLIT_BACK) {
        queue.push({ x, y, dir: c === SPLIT_SLASH ? REFLECT_SLASH(dir) : REFLECT_BACK(dir) });
        continue;
      }
      if (placed.has(`${x},${y}`)) {
        dir = placed.get(`${x},${y}`) === MIRROR_SLASH ? REFLECT_SLASH(dir) : REFLECT_BACK(dir);
        continue;
      }

      /* 거울을 놓을지 정한다.
         그냥 확률로만 두면 빛이 금방 판 밖으로 나가 거울을 다 못 놓는다.
         그래서 다음 칸이 판 밖이거나 벽이면 — 즉 빛이 여기서 끝나려 하면 —
         남은 거울이 있는 한 강제로 꺾는다. 이것만으로 수율이 크게 오른다. */
      if (toPlace > 0) {
        const nx = x + DX[dir], ny = y + DY[dir];
        const dying = !inside(b, nx, ny) || at(b, nx, ny) === WALL;

        /** 그 방향으로 벽이나 판 끝에 닿기까지 몇 칸이 남았나 */
        const room = (d) => {
          let n = 0, cx2 = x, cy2 = y;
          for (;;) {
            cx2 += DX[d]; cy2 += DY[d];
            if (!inside(b, cx2, cy2) || at(b, cx2, cy2) === WALL) return n;
            n++;
          }
        };

        const turns = [MIRROR_SLASH, MIRROR_BACK]
          .map((m) => ({ m, d: m === MIRROR_SLASH ? REFLECT_SLASH(dir) : REFLECT_BACK(dir) }))
          .map((t) => ({ ...t, room: room(t.d) }))
          .filter((t) => t.room > 0)                    // 꺾어도 살아 있어야 의미가 있다
          .sort((a, c) => c.room - a.room);             // 넓은 쪽을 앞에 둔다

        /* 확률을 0.34 로 고정하면 남은 거울이 많을 때 빛이 먼저 판을 빠져나간다.
           7×7 에 거울 7개를 놓으려 하면 열에 아홉이 실패했다. 남은 거울이 많을수록
           자주 꺾고, 꺾을 때는 남은 길이 긴 쪽을 고른다. */
        const urgency = Math.min(0.9, 0.22 + toPlace * 0.11);

        if (turns.length && (dying || rnd() < urgency)) {
          const pick = turns.length > 1 && rnd() < 0.3 ? turns[1] : turns[0];
          placed.set(`${x},${y}`, pick.m);
          toPlace--;
          dir = pick.d;
        }
      }
    }
  }
  if (toPlace === 0) break;
  }

  if (toPlace > 0) { lastFail = `거울 ${toPlace}개 못 놓음`; return null; }

  /* 목표는 '다 놓은 뒤 다시 쏜' 경로를 기준으로 세운다.
     걷는 동안 모은 끝점을 쓰면 안 된다 — 분광기로 갈라진 앞 가지가 지나간 빈 칸에
     뒤 가지가 거울을 놓으면 앞 가지의 경로가 달라지기 때문이다. */
  const finalRun = trace(b, placed);
  const spots = finalRun.ends.filter(({ x, y }) => inside(b, x, y) && at(b, x, y) === EMPTY && !placed.has(`${x},${y}`));
  /* 목표는 한 곳만 세워도 된다. 나머지는 조이기가 빛길 위에 얹는다 —
     빛이 멎는 자리는 분광기 수에 묶여 있어, 여기서 여러 개를 요구하면
     절반 넘는 씨앗이 그것 하나로 버려진다. */
  if (spots.length < 1) { lastFail = "빛이 멎는 자리가 없음"; return null; }
  const nt = Math.min(targets, spots.length);
  for (let i = 0; i < nt; i++) set(b, spots[i].x, spots[i].y, TARGET);

  b.mirrors = mirrors;
  return { board: b, answer: placed };
}

/* ══════════════ 조이기 ══════════════
   생성기가 뱉는 판은 답이 수백~수천 개다. 넓은 빈 판에서는 빛을 목표까지 보내는 길이
   여러 개라서 그렇다. 답이 여러 개면 아무렇게나 놓아도 맞으니 푸는 맛이 없고,
   "거울을 다 써야 한다"는 규칙도 억지로 느껴진다.

   그래서 만든 뒤에 조인다. 정답 하나를 쥐고 있으니, 정답은 살리면서 다른 답만
   죽이는 제약을 하나씩 얹으면 된다. 얹을 수 있는 건 둘이다.

     · 정답의 빛이 지나가는 칸에 목표를 세운다. 빛은 목표를 통과하므로 정답은
       그대로 성립하고, 그 칸을 지나지 않는 다른 답은 전부 죽는다.
     · 정답의 빛이 지나가지 않는 칸에 벽을 세운다. 정답은 건드리지 않고,
       그 칸을 쓰던 다른 답만 죽는다.

   매번 가장 많이 죽이는 것을 고른다. 목표를 먼저 쓴다 — 벽은 판을 어둡게 만들고
   목표는 오히려 퍼즐을 재미있게 한다. */
function pathCells(b, placed) {
  const r = trace(b, placed);
  const cells = new Set();
  for (const { x, y } of r.path) cells.add(`${x},${y}`);
  return { cells, hits: r.hits };
}

function sameMap(a, c) {
  if (a.size !== c.size) return false;
  for (const [k, v] of a) if (c.get(k) !== v) return false;
  return true;
}

/** 정답의 거울 배치를 solve() 가 쓰는 표기("/", "\\")로 바꾼다. */
function asDecided(answer) {
  const m = new Map();
  for (const [k, v] of answer) m.set(k, v === MIRROR_SLASH ? "/" : "\\");
  return m;
}

export function tighten(b, answer, mirrors, opts = {}) {
  const maxTargets = opts.maxTargets ?? 5;
  /* 한도를 판 크기와 무관하게 고정해 뒀더니 큰 판이 대부분 여기서 죽었다 —
     9×9 에서 400번 중 30번이 too-many-steps, 36번이 solver-aborted 였다.
     조여야 할 대안 수도, 솔버가 펼치는 노드 수도 판이 커지면 함께 커진다. */
  const cells = b.W * b.H;
  const maxSteps = opts.maxSteps ?? Math.round(10 + cells * 0.28);
  const sample = opts.sampleSolutions ?? 40;
  const minMirrors = opts.minMirrors ?? 2;   // 플레이어가 놓을 거울의 하한
  const nodeLimit = opts.nodeLimit || Math.max(400000, cells * 40000);

  const answerLeft = new Map(answer);   // 아직 플레이어가 놓아야 할 거울
  let budget = mirrors;

  for (let step = 0; step < maxSteps; step++) {
    const want = asDecided(answerLeft);
    const r = solve(b, budget, { collect: true, maxSolutions: sample, nodeLimit });
    if (r.aborted) return { ok: false, why: "solver-aborted" };
    if (r.solutions === 0) return { ok: false, why: "answer-lost" };

    const alts = r.list.filter((m) => !sameMap(m, want));
    if (r.solutions > 1 && !alts.length) return { ok: false, why: "answer-missing" };

    /* 거울을 덜 쓰고도 목표를 다 켜지는 판이 있다. 답이 하나여도 그렇다.
       그러면 목표를 다 켜 놓고도 "거울을 더 놓으라"는 말을 듣게 돼서,
       규칙이 억지로 느껴진다. 그런 지름길도 대안으로 보고 같이 죽인다.

       단, 죽일 대안이 이미 있으면 찾지 않는다. 이 검사는 거울 개수만큼 솔버를
       돌리므로, 매 단계마다 하면 큰 판에서 시간의 대부분을 여기서 쓴다. */
    for (let k = budget - 1; k >= 1 && !alts.length; k--) {
      const sh = solve(b, k, { collect: true, maxSolutions: 8, nodeLimit });
      if (sh.aborted) break;
      alts.push(...sh.list);
    }

    if (!alts.length) return { ok: true, steps: step, mirrors: budget };

    const altPaths = alts.map((m) => {
      const asMirrors = new Map();
      for (const [k, v] of m) asMirrors.set(k, v === "/" ? MIRROR_SLASH : MIRROR_BACK);
      return { mirrors: m, cells: pathCells(b, asMirrors).cells };
    });

    const mine = pathCells(b, answerLeft).cells;
    const stillMine = new Set(answerLeft.keys());
    const targetCount = targetsOf(b).length;

    let best = null;
    const consider = (cand) => {
      if (cand.kills <= 0) return;
      // 목표 > 붙박이 거울 > 벽 순으로 선호한다. 벽은 판을 어둡게만 만든다.
      const pref = cand.kind === "target" ? 6 : cand.kind === "freeze" ? 3 : 0;
      const rankScore = cand.kills * 10 + pref;
      if (!best || rankScore > best.rankScore) best = { ...cand, rankScore };
    };

    for (let y = 0; y < b.H; y++) for (let x = 0; x < b.W; x++) {
      const key = `${x},${y}`;
      if (at(b, x, y) !== EMPTY || stillMine.has(key)) continue;
      if (mine.has(key)) {
        if (targetCount < maxTargets)
          consider({ kind: "target", x, y, kills: altPaths.filter((a) => !a.cells.has(key)).length });
      } else {
        consider({ kind: "wall", x, y, kills: altPaths.filter((a) => a.cells.has(key) || a.mirrors.has(key)).length });
      }
    }

    /* 벽과 목표만으로는 죽지 않는 대안이 남는다 — 정답과 똑같은 칸을 지나면서
       거울 방향만 다른 것들이다. 그때는 정답의 거울 하나를 판에 붙박이로 박는다.
       그 거울을 그 방향으로 쓰지 않는 대안은 전부 죽고, 플레이어가 놓을 거울은
       하나 줄어든다. 원래 Laser Maze 에도 처음부터 박혀 있는 거울이 있다. */
    /* 붙박이는 대안을 무더기로 죽이므로 그냥 두면 이것만 고른다. 그러면 거울 7개짜리
       판이 "박힌 5개 + 놓을 2개" 가 돼서 쉬워진다. 하한 아래로는 못 박게 막는다. */
    if (budget > minMirrors) {
      for (const [key, m] of answerLeft) {
        const [fx, fy] = key.split(",").map(Number);
        const kills = alts.filter((a) => a.get(key) !== m).length;
        consider({ kind: "freeze", x: fx, y: fy, key, mirror: m, kills });
      }
    }

    if (!best) return { ok: false, why: "no-constraint-left" };

    if (best.kind === "freeze") {
      set(b, best.x, best.y, best.mirror === MIRROR_SLASH ? FIXED_SLASH : FIXED_BACK);
      answerLeft.delete(best.key);
      budget--;
    } else {
      set(b, best.x, best.y, best.kind === "target" ? TARGET : WALL);
    }

    // 얹고 나서 정답이 여전히 성립하는지 확인한다
    const chk = trace(b, answerLeft);
    if (!targetsOf(b).every((t) => chk.hits.has(t))) return { ok: false, why: "answer-broken" };
  }
  return { ok: false, why: "too-many-steps" };
}

/** 문제 하나를 만들고 풀어 난이도까지 매긴다. 못 만들면 null. */
export function makePuzzle(spec, seed, opts = {}) {
  /* 조이다 보면 거울 몇 개가 판에 박힌다. 그만큼 여유를 두고 만들어야
     플레이어가 놓을 개수가 원하는 값으로 남는다. */
  const slack = spec.fixed ?? 2;
  const g = generate({ ...spec, mirrors: spec.mirrors + slack }, seed);
  if (!g) return null;
  // 생성기가 들고 있는 답이 실제로 통하는지 먼저 확인한다
  const check = trace(g.board, g.answer);
  if (g.answer.size !== spec.mirrors + slack || !targetsOf(g.board).every((t) => check.hits.has(t))) return null;

  /* 답이 하나가 될 때까지 조인다. 조이면서 거울 몇 개가 판에 박힐 수 있으므로,
     플레이어가 놓을 개수는 조이기가 알려 주는 값을 쓴다. */
  const answer = new Map(g.answer);
  let mirrors = spec.mirrors + slack;
  if (opts.unique !== false) {
    const t = tighten(g.board, answer, spec.mirrors + slack, { ...opts, minMirrors: spec.mirrors });
    if (!t.ok) return null;
    mirrors = t.mirrors;
    for (const k of [...answer.keys()]) if (at(g.board, ...k.split(",").map(Number)) !== EMPTY) answer.delete(k);
    if (answer.size !== mirrors) return null;
  }

  const r = solve(g.board, mirrors, opts);
  if (r.aborted || r.solutions === 0) return null;
  if (opts.unique !== false) {
    if (r.solutions !== 1) return null;
    // 거울을 덜 쓰는 지름길이 남아 있으면 버린다
    for (let k = 1; k < mirrors; k++) {
      if (solve(g.board, k, { maxSolutions: 1 }).solutions > 0) return null;
    }
  }
  return {
    board: g.board,
    answer,
    spec: { ...spec, mirrors },
    seed,
    solutions: r.solutions,
    nodes: r.nodes,
    targets: targetsOf(g.board).length,
    fixed: spec.mirrors + slack - mirrors,   // 판에 박힌 거울 수
    score: difficulty({ nodes: r.nodes, solutions: r.solutions, mirrors }),
  };
}
