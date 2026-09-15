/* 제단에서 맞추기 — 카메라가 제단을 내려다보고, 아이는 조각을 끌어다 틀에 놓는다.
 *
 *   끌기  : 조각을 옮긴다. 놓으면 가까운 꼭짓점에 붙는다.
 *   누르기: 45° 돌린다.
 *   뒤집기: 평행사변형은 뒤집어야 맞는 틀이 있다. 단추로.
 *
 * 조각이 어디 놓였는지(place)는 main 이 가진 조각 객체에 그대로 적는다. 나갔다 다시 와도
 * 놓아 둔 자리가 남는다.
 */

import * as W from "./world.js";
import { verts, snap, complete, fits, placementFor, inside, KINDS } from "./shapes.js";
import * as Sfx from "../sound.js";
import { $, toast } from "../ui.js";

const TOP = 0.34;                      // 제단 윗면 높이
const CELL = 4.8;                      // 받침 칸 크기 (퍼즐 단위)

let s = null;                          // 지금 열린 판

export const isOpen = () => !!s;

/**
 * @param o.zone     제단이 있는 구역
 * @param o.quest    퀘스트 (frame, guide)
 * @param o.pieces   제단에 올린 조각들 [{id, kind, color, place}] — place 가 없으면 받침에 둔다
 * @param o.onSolved 다 맞췄을 때
 * @param o.onClose  나가기
 * @param o.onHint   도움을 썼을 때 (시간을 더한다)
 */
export function open(o) {
  close(true);
  const frame = o.quest.frame;
  const xs = frame.flatMap((f) => f.v.map((p) => p[0])), ys = frame.flatMap((f) => f.v.map((p) => p[1]));
  const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };

  // 아직 자리가 없는 조각은 틀 옆 받침에 줄 세운다 — 세로 화면이면 아래로, 가로 화면이면 오른쪽으로
  const tall = W.aspect() < 1;
  const used = o.pieces.filter((p) => p.place).length;
  let n = 0;
  for (const p of o.pieces) {
    if (p.place) continue;
    const i = used + n++, a = i % 3, b = Math.floor(i / 3);
    const at = tall
      ? [(box.x0 + box.x1) / 2 + (a - 1) * CELL, box.y0 - 3 - b * CELL]
      : [box.x1 + 3.2 + b * CELL, (box.y0 + box.y1) / 2 + (1 - a) * CELL];
    p.place = { kind: p.kind, x: at[0], y: at[1], rot: 0, flip: false };
  }

  const all = o.pieces.flatMap((p) => verts(p.place)).concat(frame.flatMap((f) => f.v));
  const bx = all.map((v) => v[0]), by = all.map((v) => v[1]);
  const lay = { x0: Math.min(...bx) - 0.8, x1: Math.max(...bx) + 0.8, y0: Math.min(...by) - 0.8, y1: Math.max(...by) + 0.8 };
  const [ax, az] = W.altarAt(o.zone);
  const mid = [(lay.x0 + lay.x1) / 2, (lay.y0 + lay.y1) / 2];

  s = { ...o, frame, lay, ax, az, mid, meshes: new Map(), order: o.pieces.slice(), sel: null, drag: null, done: false };

  // 월드에 걸린 틀 미리보기는 치우고, 이 판의 좌표에 맞춰 다시 그린다
  W.showFrame(o.zone, null);
  const fm = W.frameMesh(frame, o.quest.guide);
  const fc = toWorld((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2);
  fm.position.set(fc[0], TOP - 0.005, fc[1]);        // 조각 바로 밑 — 높이 차가 크면 원근 때문에 크기가 달라 보인다
  W.add(fm);
  s.frameMesh = fm;

  for (const p of o.pieces) {
    const g = W.pieceMesh(p.kind, p.color, W.U, true);
    W.add(g);
    s.meshes.set(p.id, g);
  }
  draw();

  W.lock(true);
  view();
  const cv = W.canvas();
  cv.addEventListener("pointerdown", down);
  cv.addEventListener("pointermove", moveTo);
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);
  document.addEventListener("keydown", key);
  document.addEventListener("tg-resize", view);

  $("#tgAltarBar").hidden = false;
  $("#tgFlip").onclick = () => turn(0, true);
  $("#tgTurn").onclick = () => turn(1, false);
  $("#tgHint").onclick = hint;
  $("#tgLeave").onclick = () => close();
  $("#tgAltarTip").innerHTML = o.quest.guide
    ? "조각을 <b>끌어서</b> 하얀 선 안에 놓으세요. <b>톡 누르면</b> 돌아갑니다."
    : "이번엔 <b>윤곽만</b> 있어요. 조각을 끌어 모양을 채우세요. <b>톡 누르면</b> 돌아갑니다.";
  syncButtons();
}

/** 판을 닫는다. quiet 면 onClose 를 부르지 않는다. */
export function close(quiet) {
  if (!s) return;
  // 다 맞춘 뒤 축하가 끝나기 전(0.9초)에 나가기·Esc·탭 이동이 오면 무시한다. 그대로 닫으면
  // 기다리던 onSolved 가 불리지 않아 깬 퀘스트가 기록 없이 사라진다. 끝내는 쪽은 quiet 로 닫는다.
  if (s.done && !quiet) return;
  const cur = s;
  s = null;
  for (const g of cur.meshes.values()) W.remove(g);
  W.remove(cur.frameMesh);
  const cv = W.canvas();
  cv.removeEventListener("pointerdown", down);
  cv.removeEventListener("pointermove", moveTo);
  cv.removeEventListener("pointerup", up);
  cv.removeEventListener("pointercancel", up);
  document.removeEventListener("keydown", key);
  document.removeEventListener("tg-resize", view);
  $("#tgAltarBar").hidden = true;
  W.viewTop(null);
  W.lock(false);
  if (!quiet && cur.onClose) cur.onClose();
}

/* 퍼즐 좌표 ↔ 월드 좌표. 판 전체의 가운데가 제단 가운데에 온다. */
const toWorld = (u, v) => [s.ax + (u - s.mid[0]) * W.U, s.az - (v - s.mid[1]) * W.U];
const toPuzzle = (x, z) => [s.mid[0] + (x - s.ax) / W.U, s.mid[1] - (z - s.az) / W.U];

function view() {
  if (!s) return;
  // 화면 아래에는 조작 막대가, 위에는 퀘스트 카드가 뜬다. 그만큼 세로로 여유를 두고
  // 판을 조금 위로 올려 막대가 조각을 가리지 않게 한다.
  const h = (s.lay.y1 - s.lay.y0) * W.U;
  const c = toWorld(s.mid[0], s.mid[1]);
  W.viewTop([c[0], c[1] + h * 0.14], (s.lay.x1 - s.lay.x0) * W.U, h * 1.5);
}

function draw() {
  s.order.forEach((p, i) => {
    const g = s.meshes.get(p.id);
    const [x, z] = toWorld(p.place.x, p.place.y);
    // 조각은 틀과 같은 높이에 눕힌다. 띄우면 원근 때문에 틀보다 커 보인다 — 끄는 동안만 아주 조금 든다.
    // 골라 둔 조각은 띄우는 대신 밝게 비춰 돌리기 단추가 어느 조각에 먹는지 보인다.
    const lift = s.drag && s.drag.moved && s.drag.p === p ? 0.04 : 0;
    g.position.set(x, TOP + i * 0.004 + lift, z);
    W.posePiece(g, p.place.rot, p.place.flip);
    const snug = s.quest.guide && s.frame.some((f) => fits(p.place, f));
    g.userData.inner.material.emissive.setHex(s.sel === p ? 0x5a5a5a : snug ? 0x16402c : 0);
  });
}

function pick(u, v) {
  for (let i = s.order.length - 1; i >= 0; i--) if (inside([u, v], verts(s.order[i].place))) return s.order[i];
  return null;
}

function down(e) {
  if (!s || s.done) return;
  const pt = W.pointOnPlane(e, TOP);
  if (!pt) return;
  const [u, v] = toPuzzle(pt.x, pt.z);
  const p = pick(u, v);
  if (!p) return;
  e.preventDefault();
  W.canvas().setPointerCapture(e.pointerId);
  s.order = s.order.filter((x) => x !== p).concat(p);        // 잡은 조각이 맨 위로
  s.sel = p;
  s.drag = { p, id: e.pointerId, off: [u - p.place.x, v - p.place.y], sx: e.clientX, sy: e.clientY, moved: false };
  Sfx.select();
  syncButtons();
  draw();
}

function moveTo(e) {
  if (!s || !s.drag || e.pointerId !== s.drag.id) return;
  if (!s.drag.moved && Math.hypot(e.clientX - s.drag.sx, e.clientY - s.drag.sy) < 9) return;
  s.drag.moved = true;
  const pt = W.pointOnPlane(e, TOP);
  if (!pt) return;
  const [u, v] = toPuzzle(pt.x, pt.z);
  const p = s.drag.p.place;
  p.x = Math.min(s.lay.x1, Math.max(s.lay.x0, u - s.drag.off[0]));
  p.y = Math.min(s.lay.y1, Math.max(s.lay.y0, v - s.drag.off[1]));
  draw();
}

function up(e) {
  if (!s || !s.drag || e.pointerId !== s.drag.id) return;
  const { p, moved } = s.drag;
  s.drag = null;
  if (moved) settle(p);
  else turn(1, false, p);
}

/** 돌리거나 뒤집는다 — 고른 조각이 없으면 아무 일 없다 */
function turn(step, flip, target) {
  const p = target || s?.sel;
  if (!s || !p || s.done) return;
  p.place.rot = (p.place.rot + step) % 8;
  if (flip) p.place.flip = !p.place.flip;
  settle(p);
}

/* 가까운 꼭짓점에 붙이고, 틀에 들어맞으면 알리고, 다 채웠는지 본다 */
function settle(p) {
  // ponytail: 윤곽만 보이는 판에서도 숨은 정답 꼭짓점에 붙는다. 3학년이 채우는 감을 잡게 하려는 것 — 너무 쉬우면 바깥 윤곽 꼭짓점만 남긴다.
  const points = s.frame.flatMap((f) => f.v)
    .concat(s.order.filter((x) => x !== p).flatMap((x) => verts(x.place)));
  p.place = snap(p.place, points);
  if (s.frame.some((f) => fits(p.place, f))) Sfx.place(); else Sfx.unplace();
  draw();
  check();
}

function check() {
  if (!complete(s.frame, s.pieces.map((p) => p.place))) return;
  s.done = true;
  s.sel = null;
  draw();
  Sfx.win();
  const cur = s;
  setTimeout(() => { if (s === cur) { close(true); cur.onSolved(); } }, 900);
}

/* 도움 — 아직 안 맞은 틀 칸 하나에 맞는 조각을 옮겨 놓아 준다 */
function hint() {
  if (!s || s.done) return;
  const taken = new Set();
  const loose = s.pieces.filter((p) => {
    const i = s.frame.findIndex((f, j) => !taken.has(j) && fits(p.place, f));
    if (i < 0) return true;
    taken.add(i);
    return false;
  });
  const slot = s.frame.find((f, i) => !taken.has(i) && loose.some((p) => p.kind === f.k));
  if (!slot) {
    const need = s.frame.find((f, i) => !taken.has(i));
    toast(need ? `${KINDS[need.k].name} 조각이 아직 제단에 없어요.` : "이미 다 맞았어요!");
    return;
  }
  const p = s.sel && loose.includes(s.sel) && s.sel.kind === slot.k ? s.sel : loose.find((x) => x.kind === slot.k);
  p.place = placementFor(slot);
  s.order = s.order.filter((x) => x !== p).concat(p);
  s.sel = p;
  Sfx.hint();
  s.onHint();
  syncButtons();
  draw();
  check();
}

function key(e) {
  if (!s || document.querySelector("#veil.show")) return;
  const k = e.key.toLowerCase();
  if (k === "r") turn(1, false);
  else if (k === "f") turn(0, true);
  else if (k === "h") hint();
  else if (k === "escape") close();
  else return;
  e.preventDefault();
}

function syncButtons() {
  $("#tgFlip").disabled = !s.sel || s.sel.kind !== "P";
  $("#tgTurn").disabled = !s.sel;
}
