/* 단계에 쓸 후보 판을 data/laser-pool.json 에 쌓는다. 여러 번 돌려도 된다 —
 * 있는 것에 덧붙인다.
 *
 *   node tools/grow-pool.mjs [분]
 *
 * 큰 판은 하나 만드는 데 수십 초가 걸린다. 단계를 다시 배정할 때마다 그걸 새로
 * 만들 수는 없으므로, 만든 것은 남겨 두고 계속 불린다. build-stages.mjs 는
 * 이 통에서 뽑아 쓰기만 한다.
 */

import { makePuzzle, solve, trace, targetsOf, at, EMPTY } from "../js/laser/engine.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const OUT = new URL("../data/laser-pool.json", import.meta.url);
const minutes = Number(process.argv[2]) || 10;
/** `node tools/grow-pool.mjs 30 hard` — hard 표시가 붙은 사양만 불린다.
    판 크기로 가르지 않는다 — 어려움을 정하는 건 크기가 아니라 거울 밀도다. */
const mode = process.argv[3] || "";        // "hard" | "top" | 빈칸(전부)

/* 어려운 쪽이 모자라므로 큰 판에 시간을 더 준다. weight 는 시간 배분 비율이다.
   opts 는 조이기에 넘길 값이다. 큰 판은 기본값(표본 40, 노드 한도 칸수×4만)으로 두면
   한 번 조일 때마다 너무 오래 걸려 40초에 한 판도 못 만든다. 표본을 줄이고 한도를
   낮추면 같은 시간에 세 판이 나오고, 점수도 오히려 높다(139 → 중앙 267). */
const SPECS = [
  // 판 크기보다 거울 밀도가 커버리지를 정한다. 9×9 에 거울 8개는 판의 28% 만 쓰지만
  // 7×7 에 거울 9개는 49%, 8×8 에 거울 10개는 44% 를 쓴다. 점수는 비슷하다.
  // 여유(fixed)는 사양마다 다르다 — 조이기가 박을 몫인데, 많이 두면 생성이 어려워져
  // 오히려 수율이 떨어진다. 사양별로 재서 가장 잘 나오는 값을 넣었다.
  { W: 5, mirrors: 3, walls: 1, splitters: 0, targets: 1, fixed: 0, weight: 1 },
  { W: 6, mirrors: 4, walls: 2, splitters: 1, targets: 2, fixed: 1, weight: 1 },
  { W: 6, mirrors: 6, walls: 3, splitters: 1, targets: 2, fixed: 1, weight: 2 },
  { W: 6, mirrors: 8, walls: 3, splitters: 1, targets: 2, fixed: 1, weight: 4 },
  { W: 7, mirrors: 6, walls: 4, splitters: 1, targets: 2, fixed: 1, weight: 3 },
  { W: 7, mirrors: 7, walls: 4, splitters: 2, targets: 3, fixed: 1, weight: 4 },
  { W: 7, mirrors: 8, walls: 4, splitters: 2, targets: 3, fixed: 2, weight: 6, hard: true },
  { W: 7, mirrors: 9, walls: 4, splitters: 2, targets: 3, fixed: 2, weight: 8, hard: true },
  { W: 8, mirrors: 9, walls: 5, splitters: 2, targets: 3, fixed: 1, weight: 8, hard: true },
  { W: 8, mirrors: 10, walls: 5, splitters: 2, targets: 3, fixed: 1, weight: 10, hard: true },
  /* 커버리지와 탐색량을 동시에 얻으려면 큰 판에 거울을 많이 놓아야 한다. 판 하나에
     40초쯤 걸리지만(성공률 1.3%) 이 구간만 이렇게 만들 수 있다. 목표 상한을 올려야
     조여진다 — 거울이 많으면 빛이 판을 덮어 벽 세울 자리가 없고, 목표 5개로는
     남은 대안을 못 죽여 조이기가 no-constraint-left 로 반 넘게 죽는다. */
  { W: 8, mirrors: 11, walls: 5, splitters: 3, targets: 4, fixed: 1, weight: 12, hard: true,
    opts: { sampleSolutions: 14, nodeLimit: 2500000, maxTargets: 8 } },
  { W: 9, mirrors: 11, walls: 6, splitters: 3, targets: 4, fixed: 1, weight: 12, hard: true,
    opts: { sampleSolutions: 14, nodeLimit: 2500000, maxTargets: 8 } },
];

/* 빛이 판을 이만큼은 써야 담는다. 답이 하나여도 한쪽 구석만 오가면 나머지는
   장식이고, 생각할 범위가 좁아 쉽게 느껴진다. */
const MIN_COVER = 0.38;


/** 저장한 판이 정말 풀리고, 답이 하나뿐이고, 지름길이 없는지 확인한다. */
function verify(p) {
  const r = trace(p.board, p.answer);
  if (!targetsOf(p.board).every((t) => r.hits.has(t))) return "정답이 목표를 다 못 켠다";
  if (p.answer.size !== p.spec.mirrors) return "거울 수가 어긋난다";
  for (const key of p.answer.keys()) {
    const [x, y] = key.split(",").map(Number);
    if (at(p.board, x, y) !== EMPTY) return "정답이 빈 칸이 아닌 곳에 거울을 놓는다";
  }
  if (solve(p.board, p.spec.mirrors, { maxSolutions: 200 }).solutions !== 1) return "답이 하나가 아니다";
  for (let k = 1; k < p.spec.mirrors; k++) {
    if (solve(p.board, k, { maxSolutions: 1 }).solutions > 0) return `거울 ${k}개로도 클리어된다`;
  }
  return null;
}

const pack = (p) => ({
  W: p.board.W, H: p.board.H,
  cells: [...p.board.cells].join(""),
  src: p.board.src,
  mirrors: p.spec.mirrors,
  targets: p.targets,
  nodes: p.nodes,
  score: p.score,
  cover: p.cover,
  seed: p.seed,
});

mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
const pool = existsSync(OUT) ? JSON.parse(readFileSync(OUT)) : [];
const seen = new Set(pool.map((p) => p.cells + "|" + p.src.x + "," + p.src.y + "," + p.src.dir));
console.log(`통에 이미 ${pool.length}판 있음. ${minutes}분 동안 불린다.`);

const totalWeight = SPECS.reduce((s, x) => s + x.weight, 0);
const t0 = Date.now();
let added = 0, rejected = 0;

/* 백그라운드로 오래 돌리면 중간에 끊겨서 뒤쪽 사양이 아예 안 돈다. 그래서
   가장 필요한 사양만 골라 짧게 여러 번 돌릴 수 있게 해 둔다. */
const active = mode === "top"  ? SPECS.filter((s) => s.hard && s.weight >= 8)
             : mode === "hard" ? SPECS.filter((s) => s.hard)
             : SPECS;
const activeWeight = active.reduce((s, x) => s + x.weight, 0);
for (const spec of active) {
  const budget = (minutes * 60000 * spec.weight) / activeWeight;
  const st = Date.now();
  let made = 0, tries = 0;
  while (Date.now() - st < budget) {
    tries++;
    const p = makePuzzle({ ...spec, H: spec.W }, (Date.now() * 31 + tries * 7919 + spec.W * 104729) | 0,
                         { ...(spec.opts || {}), minCover: MIN_COVER });
    if (!p) continue;
    const bad = verify(p);
    if (bad) { rejected++; continue; }
    const q = pack(p);
    const key = q.cells + "|" + q.src.x + "," + q.src.y + "," + q.src.dir;
    if (seen.has(key)) continue;          // 같은 판을 두 번 담지 않는다
    seen.add(key);
    pool.push(q); made++; added++;
  }
  const sc = pool.slice(-made).map((p) => p.score).sort((a, b) => a - b);
  console.log(`  ${spec.W}×${spec.W} 거울${spec.mirrors}: +${made}판` +
    (made ? `, 점수 ${sc[0]}~${sc[sc.length - 1]}` : "") +
    ` (${((Date.now() - st) / 1000).toFixed(0)}초, ${tries}회 시도)`);
  writeFileSync(OUT, JSON.stringify(pool));
}

pool.sort((a, b) => a.score - b.score);
writeFileSync(OUT, JSON.stringify(pool));
console.log(`\n${added}판 추가 (검증 탈락 ${rejected}판), 통에 모두 ${pool.length}판, ${((Date.now() - t0) / 1000).toFixed(0)}초`);
if (pool.length) {
  const s = pool.map((p) => p.score);
  const q = (f) => s[Math.floor(f * (s.length - 1))];
  console.log(`점수 ${s[0]} ~ ${s[s.length - 1]} (25% ${q(0.25)}, 50% ${q(0.5)}, 75% ${q(0.75)}, 95% ${q(0.95)})`);
  const hard = s.filter((x) => x >= 200).length;
  console.log(`200점 이상 ${hard}판, 230점 이상 ${s.filter((x) => x >= 230).length}판`);
  const cv = pool.map((p) => p.cover).filter((x) => x != null).sort((a, b) => a - b);
  if (cv.length) console.log(`커버리지 중앙 ${(cv[cv.length >> 1] * 100).toFixed(0)}%, 최저 ${(cv[0] * 100).toFixed(0)}%`);
}
