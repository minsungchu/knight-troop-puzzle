/* 난이도 = 모양의 복잡도.
 *
 * 경계선을 지운 뒤로 난이도를 줄 방법은 모양뿐이다. 세 가지를 본다.
 *   · 윤곽 길이 — 같은 넓이라도 들쭉날쭉할수록 길다. 채울 자리를 가늠하기 어렵다.
 *   · 오목한 모서리 수 — 파인 곳이 많을수록 조각을 끼워 넣기 까다롭다.
 *   · 평행사변형을 뒤집어야 하는가 — 아이가 가장 자주 막히는 지점이라 크게 친다.
 *
 * 마을 안에서 점수 순으로 줄 세워 쉬움 3 · 보통 3 · 어려움 4 를 준다. 절대 기준을 쓰면
 * 마을마다 개수가 어긋난다.
 */

import { verts } from "../js/tangram/shapes.js";

const Q = { S: [0.5, 0.25], E: [0.75, 0.5], N: [0.5, 0.75], W: [0.25, 0.5] };

function inside([px, py], v) {
  let hit = false;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const [xi, yi] = v[i], [xj, yj] = v[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** 실루엣이 덮은 칸들 (칸 하나를 넷으로 나눠 센다) */
function cellsOf(frame) {
  const pts = frame.flatMap((f) => f.v);
  const x0 = Math.floor(Math.min(...pts.map((p) => p[0]))), x1 = Math.ceil(Math.max(...pts.map((p) => p[0])));
  const y0 = Math.floor(Math.min(...pts.map((p) => p[1]))), y1 = Math.ceil(Math.max(...pts.map((p) => p[1])));
  const set = new Set();
  for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) {
    for (const [q, [dx, dy]] of Object.entries(Q)) {
      if (frame.some((f) => inside([x + dx, y + dy], f.v))) set.add(`${x},${y},${q}`);
    }
  }
  return set;
}

/** 이 틀이 얼마나 까다로운가 */
export function score(frame) {
  const cells = cellsOf(frame);
  // 바깥으로 드러난 칸 경계의 수 = 윤곽 길이. 이웃이 비었으면 그쪽은 바깥이다.
  let edge = 0, notch = 0;
  const has = (x, y, q) => cells.has(`${x},${y},${q}`);
  for (const c of cells) {
    const [x, y, q] = c.split(",");
    const X = +x, Y = +y;
    const nb = { S: [X, Y - 1, "N"], N: [X, Y + 1, "S"], E: [X + 1, Y, "W"], W: [X - 1, Y, "E"] }[q];
    if (!has(nb[0], nb[1], nb[2])) edge++;
    const within = { S: ["E", "W"], E: ["S", "N"], N: ["E", "W"], W: ["S", "N"] }[q];
    // 한 칸 안에서 옆이 둘 다 비었으면 뾰족하게 튀어나온 자리다
    if (within.every((d) => !has(X, Y, d))) notch++;
  }
  const flipped = frame.some((f) => f.k === "P" && needsFlip(f));
  // 조각들이 제각기 다른 각도로 누워 있을수록 머릿속에서 돌려 보기 어렵다
  const turns = new Set(frame.map((f) => poseOf(f))).size;
  return edge + notch * 2 + turns * 2 + (flipped ? 8 : 0);
}

/** 이 자리에 놓인 조각이 몇 도로 돌아가 있나 (못 찾으면 -1) */
function poseOf(slot) {
  const c = slot.v.reduce((a, p) => [a[0] + p[0] / slot.v.length, a[1] + p[1] / slot.v.length], [0, 0]);
  const same = (a, b) => a.length === b.length && a.every((p) => b.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-3));
  for (let rot = 0; rot < 8; rot++) {
    for (const flip of [false, true]) {
      if (same(verts({ kind: slot.k, x: c[0], y: c[1], rot, flip }), slot.v)) return `${rot}${flip ? "f" : ""}`;
    }
  }
  return "-1";
}

/** 이 평행사변형 자리는 뒤집어야 놓을 수 있는가 */
function needsFlip(slot) {
  const c = slot.v.reduce((a, p) => [a[0] + p[0] / slot.v.length, a[1] + p[1] / slot.v.length], [0, 0]);
  const same = (a, b) => a.length === b.length && a.every((p) => b.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-3));
  for (let rot = 0; rot < 8; rot++) {
    if (same(verts({ kind: "P", x: c[0], y: c[1], rot, flip: false }), slot.v)) return false;
  }
  return true;
}

/** 마을 하나의 문제들에 쉬움 3 · 보통 3 · 어려움 4 를 준다 (점수 낮은 것이 쉬움) */
export function assign(stages) {
  const order = stages.map((s, i) => ({ i, score: score(s.frame) })).sort((a, b) => a.score - b.score);
  const level = ["easy", "easy", "easy", "mid", "mid", "mid", "hard", "hard", "hard", "hard"];
  const out = stages.map((s) => ({ ...s }));
  order.forEach((o, rank) => { out[o.i].difficulty = level[Math.min(rank, level.length - 1)]; });
  return out;
}
