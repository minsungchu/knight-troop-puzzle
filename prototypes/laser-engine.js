/* Laser Maze — 엔진 프로토타입
 *
 * 판정 대상은 세 가지다(설계 합의 Q24):
 *   1. 5×5~8×8 판 하나를 500ms 안에 만들 수 있는가
 *   2. 난이도 점수가 사람이 느끼는 난이도와 같은 순서로 나오는가
 *   3. 21~100단계를 채울 만큼 난이도가 고르게 퍼지는가
 *
 * 게임 규칙
 *   · 광원에서 빛이 한 방향으로 나간다.
 *   · 거울은 정확히 N개를 받고 전부 놓아야 한다.
 *   · 모든 목표에 빛이 닿아야 한다.
 *   · 놓은 거울은 전부 빛을 받아야 한다 — 구석에 버리는 꼼수를 막는다.
 *     탐색이 빛을 따라가며 거울을 놓으므로 이 조건은 저절로 지켜진다.
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

  let nodes = 0, solutions = 0, first = null, aborted = false;

  /* decided: 칸 → "/" | "\\" | "." (비우기로 확정)
     fronts: 아직 진행해야 할 빛 갈래 */
  function walk(fronts, decided, left, hits) {
    if (aborted) return;
    if (++nodes > limit) { aborted = true; return; }

    if (!fronts.length) {
      if (left === 0 && hits.size === need) {
        solutions++;
        if (!first) first = new Map([...decided].filter(([, v]) => v !== "."));
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
  return { solutions, nodes, first, aborted };
}

/* ══════════════ 난이도 점수 ══════════════
   주 지표는 솔버가 펼친 노드 수다. 리서치에서 A* 나 BFS 가 펼친 노드 수가 사람이 느끼는
   난이도와 높은 상관을 보인다는 결과가 근거다. 해가 적을수록, 거울이 많을수록 더한다.
   절대값에는 의미가 없다 — 판들을 줄 세우는 데만 쓴다. */
export function difficulty({ nodes, solutions, mirrors }) {
  const search = Math.log2(nodes + 1) * 10;
  const scarcity = 12 / Math.min(Math.max(solutions, 1), 12) * 6;
  return Math.round(search + mirrors * 4 + scarcity);
}

/* ══════════════ 생성 ══════════════
   앞에서 뒤로 만든다 — 빛을 실제로 쏘면서 거울을 놓아 경로를 만들고,
   빛이 멎는 자리에 목표를 세운다. 그 뒤 거울을 걷어 내면 그게 문제가 된다. */

export function generate(spec, seed) {
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

  // 빛을 쏘면서 거울을 놓는다
  const placed = new Map();
  let toPlace = mirrors;
  const ends = [];
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
        const turns = [MIRROR_SLASH, MIRROR_BACK]
          .map((m) => ({ m, d: m === MIRROR_SLASH ? REFLECT_SLASH(dir) : REFLECT_BACK(dir) }))
          .filter(({ d }) => {
            const tx = x + DX[d], ty = y + DY[d];
            return inside(b, tx, ty) && at(b, tx, ty) !== WALL;   // 꺾어도 살아 있어야 의미가 있다
          });

        if (turns.length && (dying || rnd() < 0.34)) {
          const pick = turns[(rnd() * turns.length) | 0];
          placed.set(`${x},${y}`, pick.m);
          toPlace--;
          dir = pick.d;
        }
      }
    }
  }

  if (toPlace > 0) return null;                 // 거울을 다 못 놓았다 — 버린다

  /* 목표는 '다 놓은 뒤 다시 쏜' 경로를 기준으로 세운다.
     걷는 동안 모은 끝점을 쓰면 안 된다 — 분광기로 갈라진 앞 가지가 지나간 빈 칸에
     뒤 가지가 거울을 놓으면 앞 가지의 경로가 달라지기 때문이다. */
  const finalRun = trace(b, placed);
  const spots = finalRun.ends.filter(({ x, y }) => inside(b, x, y) && at(b, x, y) === EMPTY && !placed.has(`${x},${y}`));
  if (spots.length < targets) return null;
  for (let i = 0; i < targets; i++) set(b, spots[i].x, spots[i].y, TARGET);

  b.mirrors = mirrors;
  return { board: b, answer: placed };
}

/** 문제 하나를 만들고 풀어 난이도까지 매긴다. 못 만들면 null. */
export function makePuzzle(spec, seed, opts = {}) {
  const g = generate(spec, seed);
  if (!g) return null;
  // 생성기가 들고 있는 답이 실제로 통하는지 먼저 확인한다
  const check = trace(g.board, g.answer);
  const need = targetsOf(g.board);
  if (g.answer.size !== spec.mirrors || !need.every((t) => check.hits.has(t))) return null;

  const r = solve(g.board, spec.mirrors, opts);
  if (r.aborted || r.solutions === 0) return null;
  return {
    board: g.board,
    answer: g.answer,
    spec,
    seed,
    solutions: r.solutions,
    nodes: r.nodes,
    score: difficulty({ nodes: r.nodes, solutions: r.solutions, mirrors: spec.mirrors }),
  };
}
