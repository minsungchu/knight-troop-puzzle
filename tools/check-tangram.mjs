/* 칠교 틀과 판정을 따로 검사한다.
 *
 *   node tools/check-tangram.mjs
 *
 * 틀에 적힌 조각이 정말 그 모양인지, 겹치지 않는지, 한 벌(큰 둘·중간 하나·작은 둘·
 * 정사각형·평행사변형) 안에서 나오는지 본다. 그리고 판정이 실제로 굴러가는지 —
 * 살짝 어긋나게 놓은 조각이 붙어서 맞는지, 다른 배치도 인정하는지, 틀린 배치는 거절하는지.
 */

import { KINDS, area, kindOf, placementFor, complete, snap, verts } from "../js/tangram/shapes.js";
import { QUESTS, ZONES, SPOTS, NPCS, piecesOf } from "../js/tangram/quests.js";

const bad = [];
const ok = (cond, msg) => { if (!cond) bad.push(msg); };
const SET = { L: 2, M: 1, S: 2, Q: 1, P: 1 };

for (const q of QUESTS) {
  const tag = `${q.id}번 퀘스트`;
  ok(NPCS[q.npc], `${tag}: 없는 NPC ${q.npc}`);
  ok(ZONES[q.zone], `${tag}: 없는 구역 ${q.zone}`);
  ok(SPOTS[q.zone].length >= piecesOf(q).length, `${tag}: 조각 놓을 자리가 모자란다`);
  if (q.sort) continue;

  const count = {};
  for (const s of q.frame) {
    count[s.k] = (count[s.k] || 0) + 1;
    ok(kindOf(s.v) === s.k, `${tag}: ${JSON.stringify(s.v)} 는 ${KINDS[s.k].name}이 아니다 (${kindOf(s.v)})`);
    ok(Math.abs(area(s.v) - area(KINDS[s.k].v)) < 1e-6, `${tag}: ${s.k} 넓이가 다르다`);
  }
  for (const [k, n] of Object.entries(count)) ok(n <= SET[k], `${tag}: ${KINDS[k].name}이 ${n}개 — 한 벌에 ${SET[k]}개뿐`);

  const sol = q.frame.map(placementFor);
  if (sol.some((p) => !p)) { bad.push(`${tag}: 놓을 수 없는 칸이 있다`); continue; }
  ok(complete(q.frame, sol), `${tag}: 적힌 정답이 틀을 채우지 못한다 (겹치거나 틈이 있다)`);

  // 조금 어긋나게 내려놓아도 꼭짓점에 붙어서 맞아야 한다 — 하나씩 차례로 놓는 것처럼
  const points = q.frame.flatMap((s) => s.v);
  const placed = [];
  for (const p of sol) placed.push(snap({ ...p, x: p.x + 0.23, y: p.y - 0.18 }, points.concat(placed.flatMap(verts))));
  ok(complete(q.frame, placed), `${tag}: 살짝 어긋나게 놓으면 붙지 않는다`);

  // 하나를 45° 돌리면 맞지 않아야 한다
  const turned = sol.map((p, i) => (i === 0 ? { ...p, rot: (p.rot + 1) % 8 } : p));
  ok(!complete(q.frame, turned), `${tag}: 돌아간 조각을 맞았다고 한다`);
  ok(!complete(q.frame, sol.slice(1)), `${tag}: 조각이 빠졌는데 맞았다고 한다`);
}

// 적힌 것과 다른 배치도 맞으면 인정한다 — 2번 네모를 대각선 반대로 채운다
{
  const q = QUESTS.find((x) => x.id === 2);
  const alt = [
    { k: "M", v: [[2, 2], [0, 2], [2, 0]] },
    { k: "S", v: [[0, 0], [2, 0], [1, 1]] },
    { k: "S", v: [[0, 0], [0, 2], [1, 1]] },
  ].map(placementFor);
  ok(complete(q.frame, alt), "2번 퀘스트: 다른 올바른 배치를 거절한다");
}

// 분류 퀘스트: 직각삼각형은 셋 모양 다섯 조각뿐
ok(["L", "L", "M", "S", "S", "Q", "P"].filter((k) => KINDS[k].right).length === 5, "직각삼각형 조각 수가 5가 아니다");

if (bad.length) {
  console.error(bad.map((m) => "✗ " + m).join("\n"));
  process.exit(1);
}
console.log(`✓ 퀘스트 ${QUESTS.length}개 — 틀 모양·겹침·붙이기·판정 모두 통과`);
