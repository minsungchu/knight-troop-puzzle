/* 대전에 쓸 판 묶음을 data/laser-versus.json 으로 낸다.
 *
 *   node tools/build-versus.mjs
 *
 * 솔로에 나온 판은 뺀다 — 등반에서 이미 푼 판이 대전에 나오면 그 사람만 유리하다.
 * 대전 중에 판을 만들 수는 없다(어려운 판은 하나에 수 초가 걸린다). 미리 여러 개를
 * 구워 두고, 방을 시작할 때 그 안에서 무작위로 뽑는다. 뽑는 것이 무작위이므로
 * 같은 방을 두 번 해도 같은 판이 나오지 않는다.
 *
 * 상/중/하는 난이도 점수로 가른다. 경계는 통의 분포를 보고 정했다.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const poolFile = new URL("../data/laser-pool.json", import.meta.url);
const stageFile = new URL("../data/laser-stages.json", import.meta.url);
if (!existsSync(poolFile)) { console.error("후보 통이 없습니다. grow-pool.mjs 를 먼저 돌리세요."); process.exit(1); }

const pool = JSON.parse(readFileSync(poolFile));
const solo = existsSync(stageFile) ? JSON.parse(readFileSync(stageFile)).stages : [];

/** 판을 알아보는 열쇠 — 칸 배치와 광원이 같으면 같은 판이다. */
const key = (p) => `${p.cells}|${p.src.x},${p.src.y},${p.src.dir}`;
const usedBySolo = new Set(solo.map(key));

const free = pool.filter((p) => !usedBySolo.has(key(p)));
console.log(`통 ${pool.length}판 중 솔로가 쓰는 ${pool.length - free.length}판을 빼고 ${free.length}판`);

/* 경계는 통의 분위로 잡는다. 절대 점수로 못박으면 통이 바뀔 때마다 한쪽이 비어 버린다.
   대전은 '먼저 클리어하는 쪽이 이긴다'라서, 하 는 몇 초 안에 끝날 만큼 쉬워야 하고
   상 은 승부가 갈릴 만큼 걸려야 한다. */
const sorted = [...free].sort((a, b) => a.score - b.score);
const q = (f) => sorted[Math.floor(f * (sorted.length - 1))].score;
const CUT_LOW = q(0.45);
const CUT_HIGH = q(0.85);

const tiers = { low: [], mid: [], high: [] };
for (const p of sorted) {
  const t = p.score < CUT_LOW ? "low" : p.score < CUT_HIGH ? "mid" : "high";
  tiers[t].push(p);
}

/* 각 등급에서 골고루 뽑아 쓴다. 한 등급에 수천 판을 실어 보내면 파일이 무거워지고,
   실제로 한 방에서 쓰는 건 열 판까지다. 등급마다 120판이면 충분히 겹치지 않는다. */
const WANT = 120;
const pick = (arr) => {
  if (arr.length <= WANT) return arr;
  const out = [];
  for (let i = 0; i < WANT; i++) out.push(arr[Math.floor((i / (WANT - 1)) * (arr.length - 1))]);
  return out;
};

const slim = (p) => ({
  W: p.W, H: p.H, cells: p.cells, src: p.src,
  mirrors: p.mirrors, targets: p.targets, score: p.score,
});

const out = {
  cuts: { low: CUT_LOW, high: CUT_HIGH },
  low: pick(tiers.low).map(slim),
  mid: pick(tiers.mid).map(slim),
  high: pick(tiers.high).map(slim),
};

writeFileSync(new URL("../data/laser-versus.json", import.meta.url), JSON.stringify(out));

const show = (name, arr, all) => {
  const s = arr.map((p) => p.score);
  console.log(`  ${name}: ${arr.length}판 (통에는 ${all.length}판), 점수 ${Math.min(...s)}~${Math.max(...s)}, ` +
    `판 크기 ${[...new Set(arr.map((p) => `${p.W}×${p.H}`))].join("·")}`);
};
console.log(`경계: 하 < ${CUT_LOW} ≤ 중 < ${CUT_HIGH} ≤ 상`);
show("하", out.low, tiers.low);
show("중", out.mid, tiers.mid);
show("상", out.high, tiers.high);
