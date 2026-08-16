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

/* 어려운 쪽이 모자라므로 큰 판에 시간을 더 준다. weight 는 시간 배분 비율이다. */
const SPECS = [
  { W: 6, mirrors: 4, walls: 3, splitters: 1, targets: 2, fixed: 1, weight: 1 },
  { W: 7, mirrors: 4, walls: 4, splitters: 1, targets: 2, fixed: 1, weight: 1 },
  { W: 7, mirrors: 5, walls: 5, splitters: 1, targets: 2, fixed: 1, weight: 2 },
  { W: 7, mirrors: 6, walls: 5, splitters: 1, targets: 3, fixed: 1, weight: 3 },
  { W: 8, mirrors: 6, walls: 6, splitters: 2, targets: 3, fixed: 1, weight: 3 },
  { W: 8, mirrors: 7, walls: 7, splitters: 2, targets: 3, fixed: 2, weight: 5 },
  { W: 8, mirrors: 8, walls: 8, splitters: 2, targets: 3, fixed: 2, weight: 6 },
  { W: 9, mirrors: 8, walls: 9, splitters: 2, targets: 3, fixed: 2, weight: 8 },
  { W: 9, mirrors: 9, walls: 10, splitters: 3, targets: 4, fixed: 2, weight: 8 },
  { W: 9, mirrors: 10, walls: 10, splitters: 3, targets: 4, fixed: 2, weight: 8 },
  { W: 10, mirrors: 10, walls: 12, splitters: 3, targets: 4, fixed: 2, weight: 8 },
];

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
  seed: p.seed,
});

mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
const pool = existsSync(OUT) ? JSON.parse(readFileSync(OUT)) : [];
const seen = new Set(pool.map((p) => p.cells + "|" + p.src.x + "," + p.src.y + "," + p.src.dir));
console.log(`통에 이미 ${pool.length}판 있음. ${minutes}분 동안 불린다.`);

const totalWeight = SPECS.reduce((s, x) => s + x.weight, 0);
const t0 = Date.now();
let added = 0, rejected = 0;

for (const spec of SPECS) {
  const budget = (minutes * 60000 * spec.weight) / totalWeight;
  const st = Date.now();
  let made = 0, tries = 0;
  while (Date.now() - st < budget) {
    tries++;
    const p = makePuzzle({ ...spec, H: spec.W }, (Date.now() * 31 + tries * 7919 + spec.W * 104729) | 0);
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
}
