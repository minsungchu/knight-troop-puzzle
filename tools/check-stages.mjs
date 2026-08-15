/* 구워 낸 data/laser-stages.json 을 다시 읽어 독립적으로 검사한다.
 *
 *   node tools/check-stages.mjs
 *
 * 만든 쪽 말을 믿지 않는다. 파일에 적힌 것만 가지고 판을 되살려서,
 * 정말 풀리는지 · 답이 하나뿐인지 · 거울을 덜 쓰고 클리어되지 않는지 확인한다.
 */

import { solve, makeBoard, setSource, targetsOf, TARGET } from "../prototypes/laser-engine.js";
import { readFileSync } from "node:fs";

const { stages } = JSON.parse(readFileSync(new URL("../data/laser-stages.json", import.meta.url)));
const bad = [];
let hardest = 0, slowest = 0;

for (const s of stages) {
  const b = makeBoard(s.W, s.H);
  const cells = s.cells.split("").map(Number);
  if (cells.length !== s.W * s.H) { bad.push(`${s.stage}단계: 칸 수가 ${cells.length}, ${s.W * s.H} 이어야 한다`); continue; }
  cells.forEach((v, i) => { b.cells[i] = v; });
  setSource(b, s.src.x, s.src.y, s.src.dir);

  if (targetsOf(b).length !== s.targets) bad.push(`${s.stage}단계: 목표 수가 적힌 값과 다르다`);
  if (targetsOf(b).length === 0) bad.push(`${s.stage}단계: 목표가 없다`);

  const t0 = Date.now();
  const r = solve(b, s.mirrors, { maxSolutions: 200, nodeLimit: 2_000_000 });
  slowest = Math.max(slowest, Date.now() - t0);
  if (r.aborted) { bad.push(`${s.stage}단계: 솔버가 중단됐다`); continue; }
  if (r.solutions === 0) { bad.push(`${s.stage}단계: 풀 수 없다`); continue; }
  if (r.solutions !== 1) { bad.push(`${s.stage}단계: 답이 ${r.solutions}개다`); continue; }

  for (let k = 1; k < s.mirrors; k++) {
    if (solve(b, k, { maxSolutions: 1 }).solutions > 0) { bad.push(`${s.stage}단계: 거울 ${k}개로도 클리어된다`); break; }
  }
  hardest = Math.max(hardest, s.score);
}

// 난이도가 뒤로 갈수록 오르는지 (익힘 구간은 새 요소마다 일부러 낮아지므로 21단계부터 본다)
const main = stages.filter((s) => s.stage >= 21).sort((a, b) => a.stage - b.stage);
const dips = main.filter((s, i) => i > 0 && s.score < main[i - 1].score);

console.log(`단계 ${stages.length}개 검사`);
console.log(`  점수 ${Math.min(...stages.map((s) => s.score))} ~ ${hardest}`);
console.log(`  21단계 이후 점수가 낮아지는 곳: ${dips.length}군데`);
console.log(`  한 판 푸는 데 가장 오래 걸린 시간: ${slowest}ms`);
console.log(bad.length ? `\n❌ 문제 ${bad.length}건:\n  ` + bad.join("\n  ") : "\n✅ 모두 통과 — 전부 풀리고, 답이 하나뿐이고, 지름길이 없다");
process.exit(bad.length ? 1 : 0);
