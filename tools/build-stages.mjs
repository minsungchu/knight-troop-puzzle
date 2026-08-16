/* 솔로 100단계를 미리 만들어 data/laser-stages.json 으로 낸다.
 *
 *   node tools/build-stages.mjs
 *
 * 판을 그때그때 만들지 않고 미리 굽는 이유는 둘이다.
 *   · 어려운 사양은 한 판에 0.5초까지 걸린다. 단계를 열 때마다 기다릴 수는 없다.
 *   · 같은 단계는 누구에게나 같은 판이어야 기록을 견줄 수 있다.
 *
 * 1~20 단계는 요소를 하나씩 들여오는 익힘 구간이다. 21 단계부터는 요소를 모두 쓰고
 * 판 크기와 난이도만 올린다. 난이도는 사양이 아니라 점수로 줄 세운다 — 같은 사양
 * 안에서도 점수가 크게 갈리기 때문이다(7×7 거울4 두 판이 노드 282 / 3307,
 * 사람이 푼 시간 6.6초 / 170.5초였다).
 */

import { makePuzzle, solve, trace, targetsOf, at, EMPTY } from "../js/laser/engine.js";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";

/* ── 익힘 구간 (1~20) ────────────────────────────────────────────────
   한 단계에 하나씩만 새로 들여온다. 붙박이 거울은 중반에 들어온다. */
const TUTORIAL = [
  // 거울과 목표만
  { n: 1, W: 5, mirrors: 1, walls: 0, splitters: 0, targets: 1, fixed: 0, teach: "거울 하나로 빛을 목표까지" },
  { n: 2, W: 5, mirrors: 1, walls: 0, splitters: 0, targets: 1, fixed: 0 },
  { n: 3, W: 5, mirrors: 2, walls: 0, splitters: 0, targets: 1, fixed: 0, teach: "거울 둘" },
  { n: 4, W: 5, mirrors: 2, walls: 0, splitters: 0, targets: 1, fixed: 0 },
  // 벽
  { n: 5, W: 5, mirrors: 2, walls: 2, splitters: 0, targets: 1, fixed: 0, teach: "벽은 빛을 삼킨다" },
  { n: 6, W: 5, mirrors: 2, walls: 3, splitters: 0, targets: 1, fixed: 0 },
  { n: 7, W: 6, mirrors: 3, walls: 3, splitters: 0, targets: 1, fixed: 0 },
  // 목표 둘
  { n: 8, W: 6, mirrors: 3, walls: 2, splitters: 0, targets: 2, fixed: 0, teach: "목표는 전부 밝혀야 한다" },
  { n: 9, W: 6, mirrors: 3, walls: 3, splitters: 0, targets: 2, fixed: 0 },
  { n: 10, W: 6, mirrors: 4, walls: 3, splitters: 0, targets: 2, fixed: 0 },
  // 분광기
  { n: 11, W: 6, mirrors: 3, walls: 2, splitters: 1, targets: 2, fixed: 0, teach: "분광기는 빛을 둘로 가른다" },
  { n: 12, W: 6, mirrors: 4, walls: 3, splitters: 1, targets: 2, fixed: 0 },
  { n: 13, W: 7, mirrors: 4, walls: 3, splitters: 1, targets: 2, fixed: 0 },
  // 붙박이 거울 — 여기서부터 등장
  { n: 14, W: 7, mirrors: 3, walls: 3, splitters: 1, targets: 2, fixed: 1, teach: "박힌 거울은 옮길 수 없다" },
  { n: 15, W: 7, mirrors: 4, walls: 4, splitters: 1, targets: 2, fixed: 1 },
  { n: 16, W: 7, mirrors: 4, walls: 4, splitters: 1, targets: 2, fixed: 1 },
  // 전부 합쳐서 마무리
  // 17단계는 새 요소가 없다. teach 를 달면 일부러 쉬운 판을 골라 곡선이 꺼진다.
  { n: 17, W: 7, mirrors: 5, walls: 4, splitters: 1, targets: 2, fixed: 1 },
  { n: 18, W: 7, mirrors: 5, walls: 5, splitters: 1, targets: 2, fixed: 1 },
  { n: 19, W: 7, mirrors: 5, walls: 5, splitters: 1, targets: 3, fixed: 1 },
  { n: 20, W: 7, mirrors: 6, walls: 5, splitters: 1, targets: 3, fixed: 1 },
];

/** 한 사양으로 판을 만들어 낸다. 씨앗을 바꿔 가며 될 때까지. */
function make(spec, seed0, budgetMs) {
  const t0 = Date.now();
  for (let i = 0; i < 20000; i++) {
    if (Date.now() - t0 > budgetMs) return null;
    const p = makePuzzle({ ...spec, H: spec.W }, (seed0 + i * 7919) | 0);
    if (p) return p;
  }
  return null;
}

/** 판을 저장 가능한 꼴로 줄인다. 답은 넣지 않는다 — 클라이언트가 들고 있을 이유가 없다. */
function pack(p, stage, teach) {
  return {
    stage,
    W: p.board.W, H: p.board.H,
    cells: [...p.board.cells].join(""),
    src: p.board.src,
    mirrors: p.spec.mirrors,
    targets: p.targets,
    nodes: p.nodes,
    score: p.score,
    seed: p.seed,
    ...(teach ? { teach } : {}),
  };
}

/** 저장한 판이 실제로 풀리고, 답이 하나뿐이고, 지름길이 없는지 다시 확인한다. */
function verify(p) {
  const r = trace(p.board, p.answer);
  if (!targetsOf(p.board).every((t) => r.hits.has(t))) return "정답이 목표를 다 못 켠다";
  if (p.answer.size !== p.spec.mirrors) return "거울 수가 어긋난다";
  for (const key of p.answer.keys()) {
    const [x, y] = key.split(",").map(Number);
    if (at(p.board, x, y) !== EMPTY) return "정답이 빈 칸이 아닌 곳에 거울을 놓는다";
  }
  const s = solve(p.board, p.spec.mirrors, { maxSolutions: 200 });
  if (s.solutions !== 1) return `답이 ${s.solutions}개다`;
  for (let k = 1; k < p.spec.mirrors; k++) {
    if (solve(p.board, k, { maxSolutions: 1 }).solutions > 0) return `거울 ${k}개로도 클리어된다`;
  }
  return null;
}

const t0 = Date.now();
const stages = [];
const problems = [];

/* 익힘 구간도 후보를 여럿 만들어 고른다. 사양만 정해 두고 아무거나 쓰면
   같은 사양 안에서도 점수가 크게 갈려 곡선이 들쭉날쭉해진다.
   새 요소를 들여오는 단계(teach)에서는 일부러 가장 쉬운 판을 쓴다 —
   처음 보는 것을 어려운 판에서 배우게 하면 안 된다. */
console.log("익힘 구간 1~20 …");
let prev = 0;
for (const t of TUTORIAL) {
  const cands = [];
  const st = Date.now();
  for (let i = 0; i < 400 && cands.length < 12 && Date.now() - st < 8000; i++) {
    const p = make(t, (t.n * 104729 + i * 7919 + 17) | 0, 1200);
    if (!p) continue;
    const bad = verify(p);
    if (bad) { problems.push(`${t.n}단계 후보: ${bad}`); continue; }
    // 가르치려는 요소가 실제로 판에 있어야 한다. 목표를 둘 가르치는 단계에
    // 목표가 하나뿐인 판이 나오면 그 단계는 아무것도 못 가르친다.
    if (p.targets < t.targets) continue;
    cands.push(p);
  }
  if (!cands.length) { problems.push(`${t.n}단계: 만들지 못함`); continue; }
  cands.sort((a, b) => a.score - b.score);
  /* 새 요소를 들여오는 단계는 한 걸음 쉬워야 하지만, 절벽처럼 떨어지면 그것도 이상하다.
     앞 단계의 85% 근처를 고른다. 나머지는 앞 단계 이상에서 가장 낮은 것. */
  const pick = t.teach
    ? cands.reduce((a, c) => Math.abs(c.score - prev * 0.85) < Math.abs(a.score - prev * 0.85) ? c : a)
    : (cands.find((c) => c.score >= prev) || cands[cands.length - 1]);
  prev = pick.score;
  stages.push(pack(pick, t.n, t.teach));
}

/* 본 구간 후보는 tools/grow-pool.mjs 가 쌓아 둔 통에서 가져온다.
   큰 판은 하나에 수십 초가 걸려서, 단계를 다시 배정할 때마다 새로 만들 수 없다. */
const poolFile = new URL("../data/laser-pool.json", import.meta.url);
if (!existsSync(poolFile)) {
  console.error("후보 통이 없습니다. 먼저 `node tools/grow-pool.mjs 25` 를 돌리세요.");
  process.exit(1);
}
const pool = JSON.parse(readFileSync(poolFile));
pool.sort((a, b) => a.score - b.score);
console.log(`후보 통 ${pool.length}판, 점수 ${pool[0].score}~${pool[pool.length - 1].score}`);

/* 21~100 단계 배정.
   그냥 분위로 자르면 통에 흔한 점수대(가운데)가 단계 대부분을 먹고 곡선이 평평해진다.
   대신 목표 곡선을 먼저 그리고, 각 단계마다 목표에 가장 가까운 판을 하나씩 빼서 쓴다. */
const NEED = 100 - TUTORIAL.length;
const tutorTop = Math.max(...stages.map((s) => s.score));
if (pool.length < NEED) problems.push(`후보가 ${pool.length}판뿐 — ${NEED}판이 필요하다`);

// 끝점은 통에서 가장 어려운 판이다. 100단계가 실제로 가장 어려워야 한다.
const top = pool[pool.length - 1].score;
const used = new Array(pool.length).fill(false);
for (let i = 0; i < NEED; i++) {
  const f = i / (NEED - 1);
  /* 앞은 빨리 오르고 뒤는 완만하게(f^0.75). 처음엔 반대로 그렸는데, 그러면 중반이
     오래 평평해서 "190쯤은 별로 안 어렵다"는 구간이 스무 단계씩 이어진다. */
  const target = tutorTop + (top - tutorTop) * Math.pow(f, 0.75);
  let best = -1, bestD = Infinity;
  for (let k = 0; k < pool.length; k++) {
    if (used[k]) continue;
    const d = Math.abs(pool[k].score - target);
    if (d < bestD) { bestD = d; best = k; }
  }
  if (best < 0) break;
  used[best] = true;
  stages.push({ ...pool[best], stage: 21 + i });
}
// 배정 뒤 점수 순으로 다시 매긴다 — 가장 가까운 판을 고르다 보면 순서가 흐트러진다
const main = stages.splice(TUTORIAL.length).sort((a, b) => a.score - b.score);
main.forEach((s, i) => { s.stage = 21 + i; });
stages.push(...main);

mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
writeFileSync(new URL("../data/laser-stages.json", import.meta.url),
  JSON.stringify({ built: stages.length, stages }, null, 0));

const sc = stages.map((s) => s.score);
console.log(`\n${stages.length}단계, ${((Date.now() - t0) / 1000).toFixed(1)}초`);
console.log(`점수 ${sc[0]} → ${sc[sc.length - 1]}`);
console.log("10단계마다:", stages.filter((_, i) => i % 10 === 0).map((s) => `${s.stage}:${s.score}`).join("  "));
let dips = 0;
for (let i = 22; i < sc.length; i++) if (sc[i] < sc[i - 1]) dips++;
console.log(`본 구간에서 앞 단계보다 점수가 낮아지는 곳: ${dips}군데`);
console.log(problems.length ? `\n❌ 문제 ${problems.length}건:\n  ` + problems.slice(0, 10).join("\n  ") : "\n✅ 모든 단계가 검증을 통과");
