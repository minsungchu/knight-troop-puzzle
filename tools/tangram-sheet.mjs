/* 생성된 배치를 한 장에 모아 그린다 — 무엇처럼 보이는지 사람이 눈으로 고르라고.
 *
 *   node tools/tangram-gen.mjs --count 240 --seed 7 --out /tmp/gen.json
 *   node tools/tangram-sheet.mjs /tmp/gen.json /tmp/sheet.html
 *   node tools/tangram-sheet.mjs data/tangram-stages.js /tmp/stages.html --stages
 *
 * 실루엣만 칠한다(조각 경계선 없음). 아이가 어려움 단계에서 보는 그림이 이것이다.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { verts } from "../js/tangram/shapes.js";

const CELL = 150, PAD = 8;

/** 배치 하나를 한 칸짜리 SVG 로. label 은 칸 밑에 적는다. */
export function svg(pieces, label, { guides = false } = {}) {
  const polys = pieces.map((p) => (p.v ? p.v : verts(p)));
  const flat = polys.flat();
  const x0 = Math.min(...flat.map((q) => q[0])), x1 = Math.max(...flat.map((q) => q[0]));
  const y0 = Math.min(...flat.map((q) => q[1])), y1 = Math.max(...flat.map((q) => q[1]));
  const k = (CELL - PAD * 2) / Math.max(x1 - x0, y1 - y0, 1);
  const cx = (CELL - (x1 - x0) * k) / 2, cy = (CELL - (y1 - y0) * k) / 2;
  // 화면과 같게: 퍼즐 y 는 위쪽이 커진다. SVG 는 아래쪽이 커지므로 뒤집는다.
  const pt = ([x, y]) => `${(cx + (x - x0) * k).toFixed(1)},${(cy + (y1 - y) * k).toFixed(1)}`;
  const body = polys
    .map((v) => `<polygon points="${v.map(pt).join(" ")}" fill="#3d405b"${guides ? ' stroke="#fff" stroke-width="1"' : ""}/>`)
    .join("");
  return `<figure><svg width="${CELL}" height="${CELL}" viewBox="0 0 ${CELL} ${CELL}">${body}</svg><figcaption>${label}</figcaption></figure>`;
}

export function sheet(items, title) {
  return `<!DOCTYPE html><html lang="ko"><meta charset="utf-8"><title>${title}</title>
<style>
 body{background:#f6f2e8;font:13px/1.4 system-ui,sans-serif;margin:16px;color:#2b2d42}
 .grid{display:grid;grid-template-columns:repeat(8,${CELL}px);gap:10px}
 figure{margin:0;text-align:center}
 svg{background:#fff;border-radius:8px;display:block}
 figcaption{font-size:11px;margin-top:3px;color:#5c677d}
 h1{font-size:16px}
</style>
<h1>${title}</h1><div class="grid">${items.join("")}</div></html>`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , input, out = "/tmp/sheet.html", mode, fromArg] = process.argv;
  let items, title;
  if (mode === "--stages") {
    const { STAGES } = await import(input.startsWith("/") ? input : `../${input}`);
    items = STAGES.map((s) => svg(s.frame.map((f) => ({ v: f.v })), `${s.id} ${s.name}`));
    title = `스테이지 ${STAGES.length}개`;
  } else {
    const data = JSON.parse(readFileSync(input, "utf8"));
    const from = +(fromArg || 0);
    items = data.figures.map((f, i) => svg(f, `#${i}`)).slice(from, from + 96);
    title = `${input} — ${from} 부터 ${items.length}개 (씨앗 ${data.seed})`;
  }
  writeFileSync(out, sheet(items, title));
  console.log(`${items.length}개 → ${out}`);
}
