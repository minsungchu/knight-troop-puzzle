/* 밑그림과 실제로 채운 배치를 나란히 그려 본다 — 모양이 뜻대로 나왔는지 눈으로 보려고.
 *
 *   node tools/art-preview.mjs /tmp/art.html [tries]
 *
 * 연한 회색이 내가 그린 밑그림, 진한 색이 조각으로 채운 진짜 배치다.
 */

import { writeFileSync } from "node:fs";
import { cells } from "./tangram-fit.mjs";
import { fitNear } from "./tangram-fit.mjs";
import { VILLAGES } from "./stage-art.mjs";
import { sheet } from "./tangram-sheet.mjs";

const CELL = 170, PAD = 10;
const QPTS = { S: [[0, 0], [1, 0], [0.5, 0.5]], E: [[1, 0], [1, 1], [0.5, 0.5]], N: [[1, 1], [0, 1], [0.5, 0.5]], W: [[0, 1], [0, 0], [0.5, 0.5]] };

const tries = +(process.argv[3] || 800);
const items = [];
for (const v of VILLAGES) {
  for (const s of v.stages) {
    const { set } = cells(s.art);
    const got = fitNear(s.art, { tries });
    const target = [...set].map((c) => { const [x, y, q] = c.split(","); return QPTS[q].map(([dx, dy]) => [+x + dx, +y + dy]); });
    const polys = (got ? got.frame.map((f) => f.v) : []);
    const all = target.concat(polys).flat();
    const x0 = Math.min(...all.map((p) => p[0])), x1 = Math.max(...all.map((p) => p[0]));
    const y0 = Math.min(...all.map((p) => p[1])), y1 = Math.max(...all.map((p) => p[1]));
    const k = (CELL - PAD * 2) / Math.max(x1 - x0, y1 - y0, 1);
    const pt = ([x, y]) => `${(PAD + (x - x0) * k).toFixed(1)},${(PAD + (y1 - y) * k).toFixed(1)}`;
    const draw = (list, fill, extra = "") => list.map((p) => `<polygon points="${p.map(pt).join(" ")}" fill="${fill}" ${extra}/>`).join("");
    items.push(`<figure><svg width="${CELL}" height="${CELL}" viewBox="0 0 ${CELL} ${CELL}">
      ${draw(target, "#d8d2c4")}${draw(polys, "#3d405b", 'stroke="#fff" stroke-width="0.7"')}
    </svg><figcaption>${v.id}/${s.name} · ${s.difficulty} · ${got ? got.score.toFixed(2) : "실패"}</figcaption></figure>`);
  }
}
const out = process.argv[2] || "/tmp/art.html";
writeFileSync(out, sheet(items, `밑그림 대 실제 배치 (시도 ${tries}회)`));
console.log(`${items.length}개 → ${out}`);
