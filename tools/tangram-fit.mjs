/* 글자 그림으로 그린 실루엣에 칠교 일곱 조각을 채워 넣는다.
 *
 *   import { fit, gridArea } from "./tangram-fit.mjs";
 *   fit(["..9#7..", "..###..", "..1#3.."])   →  [{k:"L", v:[[x,y]…]}, …] 또는 null
 *
 * 왜 이렇게 하나: 무작위로 만든 배치는 대부분 무엇인지 알 수 없는 덩어리다. 아이에게는
 * '토끼', '배' 처럼 알아볼 수 있는 모양이 필요하다. 그래서 모양은 사람이 그리고, 그 모양을
 * 조각으로 정확히 채우는 일만 기계가 한다.
 *
 * 글자 한 칸 = 1×1 정사각형. 칠교 조각은 모두 이 칸들을 대각선으로 자른 조각들의 모임이라
 * (작은 삼각형 하나가 정사각형 한 칸 넓이다) 아래 다섯 글자면 어떤 배치든 적을 수 있다.
 *
 *   #  칸 전부        7  왼쪽 위 반        9  오른쪽 위 반
 *   .  빈 칸          1  왼쪽 아래 반      3  오른쪽 아래 반
 *
 * 채우기는 네 조각 방향(0·90·180·270°)만 쓴다. 45° 로 돌린 조각은 꼭짓점이 이 격자에서
 * 벗어난다 — 칠교의 고전 그림 대부분이 이 격자 안에 있다.
 */

import { readFileSync } from "node:fs";
import { verts } from "../js/tangram/shapes.js";

const SET = ["L", "L", "M", "S", "S", "Q", "P"];
/* 칸 하나를 네 조각(아래·오른쪽·위·왼쪽)으로 나눠 센다. 조각 경계가 늘 이 선 위에 있다. */
const QUARTER = { S: [0.5, 0.25], E: [0.75, 0.5], N: [0.5, 0.75], W: [0.25, 0.5] };
const CHAR = { "#": ["S", "E", "N", "W"], 7: ["N", "W"], 9: ["N", "E"], 1: ["S", "W"], 3: ["S", "E"] };
/* 조각이 덮는 칸 수. 넓이를 그때그때 재면 1.0000000000000004 같은 값이 나와 멀쩡한 자리가 걸러진다. */
const QUARTERS = { L: 16, M: 8, S: 4, Q: 8, P: 8 };

/** 글자 그림 → 채울 칸들 { "x,y,방향" } 과 크기. 맨 윗줄이 y 가 가장 큰 줄이다. */
export function cells(rows) {
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const set = new Set();
  rows.forEach((row, r) => {
    const y = h - 1 - r;
    [...row].forEach((ch, x) => {
      if (ch === "." || ch === " ") return;
      const qs = CHAR[ch];
      if (!qs) throw new Error(`알 수 없는 글자 ${JSON.stringify(ch)} (${r + 1}줄 ${x + 1}칸)`);
      for (const q of qs) set.add(`${x},${y},${q}`);
    });
  });
  return { set, w, h };
}

export const gridArea = (rows) => cells(rows).set.size / 4;

function inside([px, py], v) {
  let hit = false;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const [xi, yi] = v[i], [xj, yj] = v[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** 놓인 조각이 덮는 칸들. 칸 가운데 점이 조각 안에 있으면 그 칸을 덮는다. */
function covered(v, w, h) {
  const xs = v.map((p) => p[0]), ys = v.map((p) => p[1]);
  const out = [];
  for (let x = Math.max(0, Math.floor(Math.min(...xs))); x < Math.min(w, Math.ceil(Math.max(...xs))); x++) {
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y < Math.min(h, Math.ceil(Math.max(...ys))); y++) {
      for (const [q, [dx, dy]] of Object.entries(QUARTER)) {
        if (inside([x + dx, y + dy], v)) out.push(`${x},${y},${q}`);
      }
    }
  }
  return out;
}

/** 이 실루엣 안에 온전히 들어가는 조각 놓임새 전부 */
function candidates(kind, want, w, h) {
  const out = [], seen = new Set();
  const flips = kind === "P" ? [false, true] : [false];
  for (const flip of flips) {
    for (const rot of [0, 2, 4, 6]) {
      // 조각의 꼭짓점 하나를 격자점에 맞춰 옮긴다. 무게중심을 정수로 옮기면 격자에서 어긋난다
      // — 조각마다 무게중심이 칸 가운데가 아니기 때문이다.
      const base = verts({ kind, x: 0, y: 0, rot, flip });
      for (let gx = 0; gx <= w; gx++) {
        for (let gy = 0; gy <= h; gy++) {
          for (const b of base) {
            const p = { kind, x: gx - b[0], y: gy - b[1], rot, flip };
            const v = verts(p);
            const cs = covered(v, w, h);
            if (cs.length !== QUARTERS[kind]) continue;         // 실루엣 밖으로 삐져나갔다
            if (!cs.every((c) => want.has(c))) continue;
            const k = cs.slice().sort().join("|");
            if (seen.has(k)) continue;                          // 같은 자리를 여러 꼭짓점으로 만든 것
            seen.add(k);
            out.push({ p, v, cells: cs });
          }
        }
      }
    }
  }
  return out;
}

/**
 * 글자 그림을 칠교 일곱 조각으로 채운다. 찾으면 틀([{k, v}])을, 못 찾으면 null.
 * 아직 안 덮인 칸 하나를 잡고 그 칸을 덮는 자리만 시도한다 — 같은 배치를 순서만 바꿔
 * 다시 세지 않으려는 것이다.
 */
export function fit(rows) {
  const { set: want, w, h } = cells(rows);
  if (want.size !== 64) return null;                           // 일곱 조각의 넓이는 늘 16 이다
  const byKind = {};
  for (const k of new Set(SET)) byKind[k] = candidates(k, want, w, h);
  if (Object.values(byKind).some((c) => !c.length)) return null;

  const left = { L: 2, M: 1, S: 2, Q: 1, P: 1 };
  const filled = new Set();
  const placed = [];
  const order = [...want];

  const solve = () => {
    if (placed.length === SET.length) return true;
    const cell = order.find((c) => !filled.has(c));
    if (!cell) return false;
    const opts = [];
    for (const [kind, n] of Object.entries(left)) {
      if (!n) continue;
      for (const c of byKind[kind]) {
        if (!c.cells.includes(cell)) continue;
        if (c.cells.some((x) => filled.has(x))) continue;
        opts.push({ kind, c });
      }
    }
    for (const { kind, c } of opts) {
      c.cells.forEach((x) => filled.add(x));
      left[kind]--; placed.push({ k: kind, v: c.v });
      if (solve()) return true;
      placed.pop(); left[kind]++;
      c.cells.forEach((x) => filled.delete(x));
    }
    return false;
  };

  return solve() ? placed.map(({ k, v }) => ({ k, v: v.map(([x, y]) => [round(x), round(y)]) })) : null;
}

const round = (n) => Math.round(n * 1e6) / 1e6;

/* ── 실행: 글자 그림 파일을 주면 풀어서 보여 준다 ── */
if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = readFileSync(process.argv[2], "utf8").replace(/\n$/, "").split("\n");
  const frame = fit(rows);
  if (!frame) {
    console.error(`못 채웠다 (넓이 ${gridArea(rows)} — 16 이어야 하고, 조각으로 정확히 나뉘어야 한다)`);
    process.exit(1);
  }
  console.log(JSON.stringify(frame));
  console.log(frame.map((f) => f.k).sort().join("") === SET.slice().sort().join("") ? "조각 한 벌 ✓" : "조각 구성 다름 ✗");
}

/* ══════════════ 비슷하게 채우기 ══════════════
 *
 * 밑그림과 '똑같이' 채우려면 넓이도 16 이어야 하고 조각으로 정확히 나뉘어야 해서, 사람이
 * 그린 그림은 대개 실패한다. 그래서 목표를 낮춘다 — 밑그림과 가장 많이 겹치는 진짜 배치를
 * 찾는다. 나온 배치는 늘 풀 수 있는 문제이고, 모양은 밑그림에 가깝다.
 *
 * 조각을 하나씩 붙여 나가되, 밑그림 안을 많이 덮는 자리를 우선 고른다(조금은 무작위로).
 * 여러 번 다시 해서 제일 잘 겹친 것을 남긴다.
 */

const QDIRS = Object.entries(QUARTER);

/** 놓인 조각이 덮는 칸들 — 격자 밖도 센다 (밑그림 밖으로 나간 만큼이 손해다) */
function cellsOfPiece(v) {
  const xs = v.map((p) => p[0]), ys = v.map((p) => p[1]);
  const out = [];
  for (let x = Math.floor(Math.min(...xs)); x < Math.ceil(Math.max(...xs)); x++) {
    for (let y = Math.floor(Math.min(...ys)); y < Math.ceil(Math.max(...ys)); y++) {
      for (const [q, [dx, dy]] of QDIRS) if (inside([x + dx, y + dy], v)) out.push(`${x},${y},${q}`);
    }
  }
  return out;
}

const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

/** 밑그림과 가장 많이 겹치는 배치. { frame, score } — score 는 겹친 칸 ÷ 합친 칸 (1 이면 완전히 같다) */
export function fitNear(rows, { tries = 600, seed = 1 } = {}) {
  const { set: want } = cells(rows);
  const rnd = rng(seed);
  const kinds = ["L", "L", "M", "S", "S", "Q", "P"];
  let best = null;

  for (let t = 0; t < tries; t++) {
    const left = kinds.slice();
    const placed = [];
    const used = new Set();
    // 첫 조각은 큰 삼각형을 밑그림 안 아무 자리에나 놓는다
    const first = firstPlacement(want, rnd);
    if (!first) break;
    place(first);
    left.splice(left.indexOf("L"), 1);

    while (left.length) {
      const kind = left[Math.floor(rnd() * left.length)];
      const opts = nextPlacements(kind, placed, used, want);
      if (!opts.length) break;
      // 밑그림을 많이 덮는 자리를 앞세우되 가끔 다른 것도 고른다
      opts.sort((a, b) => b.gain - a.gain);
      const pick = opts[Math.min(opts.length - 1, Math.floor((rnd() ** 3) * Math.min(opts.length, 8)))];
      place(pick);
      left.splice(left.indexOf(kind), 1);
    }
    if (left.length) continue;

    if (hasHole(used)) continue;                  // 가운데가 뚫린 모양은 실루엣으로 못 쓴다
    let hit = 0;
    for (const c of used) if (want.has(c)) hit++;
    const score = hit / (used.size + want.size - hit);
    if (!best || score > best.score) best = { score, frame: placed.map(({ kind, v }) => ({ k: kind, v: v.map(([x, y]) => [round(x), round(y)]) })) };
    if (best.score === 1) break;

    function place(p) {
      placed.push(p);
      p.cells.forEach((c) => used.add(c));
    }
  }
  return best;
}

function firstPlacement(want, rnd) {
  const pts = [...want].map((c) => c.split(",").map(Number));
  if (!pts.length) return null;
  const [gx, gy] = pts[Math.floor(rnd() * pts.length)];
  const rot = [0, 2, 4, 6][Math.floor(rnd() * 4)];
  const base = verts({ kind: "L", x: 0, y: 0, rot, flip: false });
  const b = base[Math.floor(rnd() * base.length)];
  const v = verts({ kind: "L", x: gx - b[0], y: gy - b[1], rot, flip: false });
  return { kind: "L", v, cells: cellsOfPiece(v) };
}

/** 이미 놓인 조각에 변으로 붙고 겹치지 않는 자리들. gain 은 밑그림을 새로 덮는 칸 수. */
function nextPlacements(kind, placed, used, want) {
  const anchors = [];
  const seen = new Set();
  for (const p of placed) for (const a of p.v) {
    const k = `${a[0].toFixed(3)},${a[1].toFixed(3)}`;
    if (!seen.has(k)) { seen.add(k); anchors.push(a); }
  }
  const out = [];
  const flips = kind === "P" ? [false, true] : [false];
  for (const flip of flips) {
    for (const rot of [0, 2, 4, 6]) {
      const base = verts({ kind, x: 0, y: 0, rot, flip });
      for (const a of anchors) {
        for (const b of base) {
          const v = verts({ kind, x: a[0] - b[0], y: a[1] - b[1], rot, flip });
          const cs = cellsOfPiece(v);
          if (cs.length !== QUARTERS[kind]) continue;
          if (cs.some((c) => used.has(c))) continue;              // 겹친다
          let gain = 0;
          for (const c of cs) if (want.has(c)) gain++;
          // 변이 실제로 맞닿는지: 이웃 칸을 하나라도 공유해야 한다
          if (!touching(cs, used)) continue;
          out.push({ kind, v, cells: cs, gain });
        }
      }
    }
  }
  return out;
}

/** 칸 경계로 맞닿았는가 — 같은 칸의 다른 방향이거나 옆 칸이면 붙어 있는 것으로 본다 */
function touching(cs, used) {
  for (const c of cs) {
    const [x, y, q] = c.split(",");
    const nb = [`${x},${y},S`, `${x},${y},E`, `${x},${y},N`, `${x},${y},W`,
      `${+x - 1},${y},E`, `${+x + 1},${y},W`, `${x},${+y - 1},N`, `${x},${+y + 1},S`];
    for (const n of nb) if (used.has(n)) return true;
  }
  return false;
}

/** 배치 가운데가 뚫렸는가 — 빈 칸(반 칸까지)을 바깥에서 타고 들어가 본다.
    바깥과 이어지지 않는 빈 칸이 남으면 구멍이다. 구멍 난 실루엣은 아이가 보기에
    '깨진 그림' 이라 문제로 쓰지 않는다. 칸 하나를 네 조각으로 나눠 세므로 반 칸 구멍도 잡는다. */
function hasHole(used) {
  const pts = [...used].map((c) => c.split(",").map(Number));
  const x0 = Math.min(...pts.map((p) => p[0])) - 1, x1 = Math.max(...pts.map((p) => p[0])) + 1;
  const y0 = Math.min(...pts.map((p) => p[1])) - 1, y1 = Math.max(...pts.map((p) => p[1])) + 1;
  const id = (x, y, q) => `${x},${y},${q}`;
  const inBox = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  /* 한 칸 안에서는 이웃한 방향끼리, 칸을 넘어서는 마주 보는 방향끼리 붙어 있다 */
  const near = (x, y, q) => {
    const within = { S: ["E", "W"], E: ["S", "N"], N: ["E", "W"], W: ["S", "N"] }[q].map((d) => [x, y, d]);
    const across = { S: [x, y - 1, "N"], N: [x, y + 1, "S"], E: [x + 1, y, "W"], W: [x - 1, y, "E"] }[q];
    return within.concat([across]).filter(([nx, ny]) => inBox(nx, ny));
  };
  const empty = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    for (const q of ["S", "E", "N", "W"]) if (!used.has(id(x, y, q))) empty.push([x, y, q]);
  }
  const outside = new Set();
  const stack = [[x0, y0, "S"]];
  outside.add(id(x0, y0, "S"));
  while (stack.length) {
    const [x, y, q] = stack.pop();
    for (const [nx, ny, nq] of near(x, y, q)) {
      const k = id(nx, ny, nq);
      if (outside.has(k) || used.has(k)) continue;
      outside.add(k); stack.push([nx, ny, nq]);
    }
  }
  return empty.some(([x, y, q]) => !outside.has(id(x, y, q)));
}
