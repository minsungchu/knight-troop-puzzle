/* 밑그림(tools/stage-art.mjs)을 조각 배치로 채워 data/tangram-stages.js 를 굽는다.
 *
 *   node tools/build-tangram-stages.mjs            # 굽고 검사
 *   node tools/build-tangram-stages.mjs --check    # 굽지 않고 어디가 안 되는지만 본다
 *
 * 채우지 못한 밑그림은 이름과 넓이를 함께 알려 준다. 넓이가 16 이 아니거나, 어딘가 폭이
 * 한 칸뿐이면 못 채운다.
 */

import { writeFileSync } from "node:fs";
import { fit, fitNear, gridArea } from "./tangram-fit.mjs";
import { VILLAGES } from "./stage-art.mjs";
import { assign, score } from "./difficulty.mjs";

const WANT = { easy: 3, mid: 3, hard: 4 };
const check = process.argv.includes("--check");
const triesAt = process.argv.indexOf("--tries");
const TRIES = triesAt < 0 ? 3000 : +process.argv[triesAt + 1] || 3000;

const stages = [];
const bad = [];
const weak = [];

for (const v of VILLAGES) {
  const made = [];
  v.stages.forEach((s, i) => {
    const t0 = Date.now();
    let got = null;
    try {
      // 밑그림이 넓이 16 이고 조각으로 딱 나뉘면 그대로 쓴다 — 정사각형·직사각형처럼
      // 정확히 그릴 수 있는 모양을 근사로 뭉개지 않으려는 것이다.
      const exact = gridArea(s.art) === 16 ? fit(s.art) : null;
      got = exact ? { score: 1, frame: exact } : fitNear(s.art, { tries: TRIES, seed: 1 + i });
    } catch (e) { bad.push(`${v.id}/${s.name}: ${e.message}`); return; }
    if (!got) { bad.push(`${v.id}/${s.name}: 배치를 못 찾음`); return; }
    // 밑그림과 너무 안 닮으면 알린다 — 그림을 고치거나 시도를 늘려야 한다
    // 0.5 밑이면 아예 다른 모양이다. 0.65 밑은 밑그림 넓이를 16 에 가깝게 고치면 나아진다.
    const msg = `${v.id}/${s.name}: 겹침 ${got.score.toFixed(2)} · 밑그림 넓이 ${gridArea(s.art)}`;
    if (got.score < 0.5) bad.push(msg); else if (got.score < 0.65) weak.push(msg);
    made.push({ village: v.id, name: s.name, ms: Date.now() - t0, score: +got.score.toFixed(3), frame: got.frame });
  });
  if (v.stages.length !== 10) bad.push(`${v.id}: 문제 ${v.stages.length}개 (10개여야 한다)`);
  // 난이도는 밑그림에 적은 값이 아니라 나온 모양의 복잡도로 정한다. 쉬운 것부터 차례로 둔다.
  const ranked = assign(made).sort((a, b) => score(a.frame) - score(b.frame));
  ranked.forEach((st, i) => stages.push({ ...st, id: `${v.id}-${i + 1}` }));
  for (const [d, n] of Object.entries(WANT)) {
    const got = ranked.filter((st) => st.difficulty === d).length;
    if (got !== n) bad.push(`${v.id}: ${d} ${got}개 (${n}개여야 한다)`);
  }
}

if (weak.length) console.log("밑그림과 덜 닮은 것:\n" + weak.map((w) => "  · " + w).join("\n"));
const slow = stages.filter((s) => s.ms > 4000).map((s) => `${s.id} ${s.ms}ms`);
if (slow.length) console.log("오래 걸린 밑그림:", slow.join(", "));

if (bad.length) {
  console.error(bad.map((b) => "✗ " + b).join("\n"));
  if (!check) process.exit(1);
}
const worst = stages.slice().sort((a, b) => a.score - b.score).slice(0, 6).map((s) => `${s.id} ${s.name} ${s.score}`);
console.log(`${VILLAGES.length}개 마을 · ${stages.length}개 문제 · 가장 안 닮은 것: ${worst.join(", ")}`);

if (!check) {
  const body = stages.map((s) =>
    `  { id: ${JSON.stringify(s.id)}, village: ${JSON.stringify(s.village)}, name: ${JSON.stringify(s.name)}, ` +
    `difficulty: ${JSON.stringify(s.difficulty)}, frame: ${JSON.stringify(s.frame)} },`).join("\n");
  const villages = VILLAGES.map((v) =>
    `  { id: ${JSON.stringify(v.id)}, name: ${JSON.stringify(v.name)}, theme: ${JSON.stringify(v.theme)} },`).join("\n");
  writeFileSync("data/tangram-stages.js",
`/* 어드벤처 문제 — tools/build-tangram-stages.mjs 가 만든 파일이다. 직접 고치지 말고
   tools/stage-art.mjs 의 밑그림을 고친 뒤 다시 구워라. */

export const VILLAGES = [
${villages}
];

export const STAGES = [
${body}
];
`);
  console.log("→ data/tangram-stages.js");
}
