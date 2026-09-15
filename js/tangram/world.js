/* 3D 마을 — 장면·캐릭터·이동·카메라.
 *
 * 무엇을 할지(퀘스트·조각 줍기 규칙)는 main.js 가 정한다. 이 파일은 그리기와 걷기만 한다.
 * 가까이 있는 것 하나를 '초점'으로 잡아 알려 주고, 행동 키가 눌리면 그 초점을 넘긴다.
 *
 * 모델 파일을 쓰지 않는다. 사람·나무·집은 기본 도형을 쌓아 만든다 — 내려받을 것이 없고,
 * 로우폴리 동화풍은 원래 그렇게 생겼다.
 */

import * as THREE from "three";
import { local } from "./shapes.js";
import { ZONES, BRIDGES, NPCS, BASKET, SPOTS } from "./quests.js";

export { THREE };
export const U = 0.5;                  // 퍼즐 한 단위 = 0.5m. 큰 삼각형 빗변이 2m.
export const PLATE_R = 7.5;            // 제단 반지름
const SPEED = 6.5;
const START = [0, 6];

let renderer, scene, camera, clock, host;
let player, carryGroup, focusRing;
const pos = new THREE.Vector3(START[0], 0, START[1]);
let heading = Math.PI;                 // 처음엔 북쪽(-z)을 본다
const keys = new Set();
const stick = { x: 0, y: 0 };
let locked = false;

const ground = new Map();              // 땅에 떨어진 조각 id → { g, beacon, x, z, p }
const npcMeshes = {};                  // npc id → { group, mark }
const altars = {};                     // zone → { group, frame, x, z }
const bridges = [];
let basket;
const obstacles = [];                  // [x, z, r]
let focus = null, focusFilter = () => true, onFocus = () => {}, onAction = () => {}, onZone = () => {};
let zoneNow = null;
const frameHooks = [];

/* 카메라 — 따라가기와 내려다보기 사이를 부드럽게 옮긴다 */
const cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), top: null };

const mat = (color, extra) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...extra });

/* ══════════════ 시작 ══════════════ */

export function init(el, hooks = {}) {
  host = el;
  if (hooks.onFocus) onFocus = hooks.onFocus;
  if (hooks.onAction) onAction = hooks.onAction;
  if (hooks.onZone) onZone = hooks.onZone;

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfe6ff);
  scene.fog = new THREE.Fog(0xbfe6ff, 38, 90);

  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  camera.up.set(0, 0, -1);             // 화면 위쪽 = 북쪽. 내려다볼 때도 뒤집히지 않는다.

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8fbf6a, 1.4));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 80 });
  scene.add(sun, sun.target);
  frameHooks.push(() => {            // 그림자 상자가 캐릭터를 따라다니게
    sun.position.set(pos.x + 12, 30, pos.z + 16);
    sun.target.position.set(pos.x, 0, pos.z);
  });

  buildLand();
  buildVillage();
  buildForest();
  buildCastle();
  for (const [zone, z] of Object.entries(ZONES)) buildAltar(zone, z.altar);
  for (const [id, n] of Object.entries(NPCS)) buildNpc(id, n);
  buildBasket();

  player = person(0x3a86ff, 0xef476f);
  carryGroup = new THREE.Group();
  carryGroup.position.y = 2.3;
  player.add(carryGroup);
  scene.add(player);

  focusRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 32), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  focusRing.rotation.x = -Math.PI / 2;
  focusRing.visible = false;
  scene.add(focusRing);

  bindKeys();
  new ResizeObserver(resize).observe(host);
  resize();
  clock = new THREE.Clock();
  renderer.setAnimationLoop(tick);
}

function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  document.dispatchEvent(new CustomEvent("tg-resize"));
}

/* ══════════════ 땅 ══════════════ */

function flat(w, h, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(color));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

function buildLand() {
  flat(140, 180, 0x8fd16a, 0, 0, -45);
  // 구역마다 풀빛을 조금씩 달리한다 — 어디까지 왔는지 눈으로 알게
  const tint = { village: 0x9edb74, forest: 0x6fb85a, castle: 0xa8d8a0 };
  for (const [k, z] of Object.entries(ZONES)) {
    const [x0, z0, x1, z1] = z.rect;
    flat(x1 - x0, z1 - z0, tint[k], (x0 + x1) / 2, 0.01, (z0 + z1) / 2);
  }
  flat(3.2, 106, 0xe9d3a0, 0, 0.02, -43);      // 가운데 흙길

  // 강 두 줄기와 다리
  for (const b of BRIDGES) {
    const [, z0, , z1] = b.rect;
    const water = flat(140, z1 - z0, 0x4fb3e8, 0, 0.04, (z0 + z1) / 2);
    frameHooks.push((t) => { water.material.color.setHSL(0.55, 0.72, 0.6 + Math.sin(t * 1.4) * 0.03); });

    const g = new THREE.Group();
    const len = z1 - z0 + 1.2;
    for (let i = 0; i < 7; i++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.18, len / 7 - 0.08), mat(0xb07a45));
      plank.position.set(0, 0.2, z0 - 0.6 + (i + 0.5) * (len / 7));
      plank.castShadow = plank.receiveShadow = true;
      g.add(plank);
    }
    for (const sx of [-1.8, 1.8]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, len), mat(0x8a5a30));
      rail.position.set(sx, 0.9, (z0 + z1) / 2);
      g.add(rail);
      for (const zz of [z0 - 0.4, (z0 + z1) / 2, z1 + 0.4]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.9, 0.18), mat(0x8a5a30));
        post.position.set(sx, 0.5, zz);
        g.add(post);
      }
    }
    g.visible = false;
    scene.add(g);
    bridges.push({ ...b, group: g, grow: 1 });
  }

  // 가장자리는 나무로 막는다. 보이지 않는 벽보다 덜 답답하다.
  const edge = [];
  for (let z = 10; z >= -96; z -= 3) edge.push([-20.5, z], [20.5, z], [-23.5, z - 1.5], [23.5, z - 1.5]);
  for (let x = -20; x <= 20; x += 3) edge.push([x, 26]);      // 카메라 뒤쪽이라 멀리 둔다 — 가까우면 화면 아래를 가린다
  trees(edge, 0x4f9d4a);
}

const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

/* 나무 여럿 — 모양이 같으니 인스턴스로 한 번에 그린다 */
function trees(list, color, solid) {
  const n = list.length;
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.24, 1, 6), mat(0x8a5a30), n);
  const low = new THREE.InstancedMesh(new THREE.ConeGeometry(1.25, 2, 7), mat(color), n);
  const high = new THREE.InstancedMesh(new THREE.ConeGeometry(0.9, 1.6, 7), mat(color), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const r = rng(n * 97 + 13);
  list.forEach(([x, z], i) => {
    const k = 0.8 + r() * 0.5;
    s.set(k, k, k);
    q.setFromAxisAngle(up, r() * 6);
    trunk.setMatrixAt(i, m.compose(new THREE.Vector3(x, 0.5 * k, z), q, s));
    low.setMatrixAt(i, m.compose(new THREE.Vector3(x, 1.8 * k, z), q, s));
    high.setMatrixAt(i, m.compose(new THREE.Vector3(x, 2.9 * k, z), q, s));
    if (solid) obstacles.push([x, z, 0.7]);
  });
  for (const im of [trunk, low, high]) { im.castShadow = true; scene.add(im); }
}

function house(x, z, wall, roof) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 3), mat(wall));
  body.position.y = 1.1;
  const top = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.7, 4), mat(roof));
  top.position.y = 3.05;
  top.rotation.y = Math.PI / 4;
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.3, 0.1), mat(0x7a4a28));
  door.position.set(0, 0.65, 1.52);
  for (const o of [body, top]) { o.castShadow = o.receiveShadow = true; }
  g.add(body, top, door);
  g.position.set(x, 0, z);
  scene.add(g);
  obstacles.push([x, z, 2.2]);
}

function buildVillage() {
  house(-12, -1, 0xfff1d0, 0xe76f51);
  house(14, -8, 0xfde2e4, 0x2a9d8f);
  house(-13, -17, 0xe8f1ff, 0x8e6cd8);
  const well = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.1, 0.8, 10), mat(0xb8b8c8));
  well.position.set(-4, 0.4, 2);
  well.castShadow = true;
  scene.add(well);
  obstacles.push([-4, 2, 1.2]);
  // 꽃밭
  const r = rng(7);
  const flowers = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.16, 0), mat(0xffffff), 60);
  const m = new THREE.Matrix4();
  const cs = [0xff8fab, 0xffd166, 0xffffff, 0xcdb4db];
  for (let i = 0; i < 60; i++) {
    m.makeTranslation(-17 + r() * 34, 0.15, -25 + r() * 34);
    flowers.setMatrixAt(i, m);
    flowers.setColorAt(i, new THREE.Color(cs[i % 4]));
  }
  scene.add(flowers);
}

function buildForest() {
  const r = rng(42);
  const keep = [...SPOTS.forest, NPCS.wood.at, NPCS.fisher.at];
  const list = [];
  for (let i = 0; i < 400 && list.length < 34; i++) {
    const x = -17 + r() * 34, z = -31.5 - r() * 27;
    if (Math.abs(x) < 3.5) continue;                                             // 길
    if (Math.hypot(x - ZONES.forest.altar[0], z - ZONES.forest.altar[1]) < PLATE_R + 2) continue;
    if (keep.some(([a, b]) => Math.hypot(x - a, z - b) < 3.2)) continue;
    if (list.some(([a, b]) => Math.hypot(x - a, z - b) < 2.6)) continue;
    list.push([x, z]);
  }
  trees(list, 0x3f8f4f, true);
  for (const [x, z] of [[-5, -33], [9, -58], [-16, -41], [15, -40]]) {   // 버섯
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.5, 6), mat(0xfff4e0));
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.45, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xe63946));
    stem.position.set(x, 0.25, z);
    cap.position.set(x, 0.45, z);
    scene.add(stem, cap);
  }
}

function buildCastle() {
  const stone = 0xd9dce8, roof = 0x5a7bd8;
  const wall = new THREE.Mesh(new THREE.BoxGeometry(30, 5, 2), mat(stone));
  wall.position.set(0, 2.5, -99);
  wall.castShadow = wall.receiveShadow = true;
  scene.add(wall);
  for (const x of [-15, -6, 6, 15]) {
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2, 8, 8), mat(stone));
    tower.position.set(x, 4, -99);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.3, 3, 8), mat(roof));
    cone.position.set(x, 9.5, -99);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.7), mat(0xffd166, { side: THREE.DoubleSide }));
    flag.position.set(x + 0.6, 11.6, -99);
    tower.castShadow = cone.castShadow = true;
    scene.add(tower, cone, flag);
    frameHooks.push((t) => { flag.rotation.y = Math.sin(t * 3 + x) * 0.4; });
  }
  const gate = new THREE.Mesh(new THREE.BoxGeometry(4, 3.6, 0.3), mat(0x7a4a28));
  gate.position.set(0, 1.8, -97.9);
  scene.add(gate);
  for (const [x, z] of [[-12, -78], [-12, -88], [15, -78], [15, -84]]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 3, 8), mat(stone));
    p.position.set(x, 1.5, z);
    p.castShadow = true;
    scene.add(p);
    obstacles.push([x, z, 0.7]);
  }
}

function buildAltar(zone, [x, z]) {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(PLATE_R, PLATE_R + 0.3, 0.3, 40), mat(0xf1ead8));
  plate.position.y = 0.15;
  plate.receiveShadow = true;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(PLATE_R, 0.12, 6, 60), mat(0xc9973f));
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.32;
  g.add(plate, rim);
  g.position.set(x, 0, z);
  scene.add(g);
  const frame = new THREE.Group();
  frame.position.set(x, 0.31, z);
  scene.add(frame);
  altars[zone] = { group: g, frame, x, z };
}

function buildBasket() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.8, 1, 10, 1, true), mat(0xc68b4e, { side: THREE.DoubleSide }));
  body.position.y = 0.5;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.1, 6, 20), mat(0x9c6a35));
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 1;
  body.castShadow = true;
  g.add(body, rim);
  g.position.set(BASKET[0], 0, BASKET[1]);
  const tag = label("바구니", { w: 0.032 });
  tag.position.y = 1.9;
  g.add(tag);
  scene.add(g);
  obstacles.push([BASKET[0], BASKET[1], 1.2]);
  basket = body;
}

/* ══════════════ 사람 ══════════════ */

function person(color, hatColor) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.5, 3, 8), mat(color));
  body.position.y = 0.8;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), mat(0xffd9b3));
  head.position.y = 1.52;
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.5, 7), mat(hatColor));
  hat.position.y = 1.95;
  const eye = new THREE.SphereGeometry(0.05, 6, 4), black = mat(0x222222);
  for (const sx of [-0.12, 0.12]) {
    const e = new THREE.Mesh(eye, black);
    e.position.set(sx, 1.56, 0.3);
    g.add(e);
  }
  const legs = [];
  for (const sx of [-0.15, 0.15]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.4, 6), mat(0x3d405b));
    leg.position.set(sx, 0.2, 0);
    legs.push(leg);
    g.add(leg);
  }
  for (const o of [body, head, hat]) o.castShadow = true;
  g.add(body, head, hat);
  g.userData.legs = legs;
  return g;
}

/* 글자 붙은 표지판 — 이름표와 머리 위 느낌표 */
function label(text, { bg = "rgba(255,255,255,.92)", fg = "#2b2d42", size = 44, w = 1.6 } = {}) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  const font = `700 ${size}px "Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif`;
  ctx.font = font;
  c.width = Math.ceil(ctx.measureText(text).width) + size;
  c.height = Math.round(size * 1.6);
  ctx.font = font;
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect(0, 0, c.width, c.height, c.height / 2); ctx.fill();
  ctx.fillStyle = fg; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // 거리와 상관없이 화면에서 같은 크기로 — 가까이 가면 이름표가 화면을 덮던 것을 막는다
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false }));
  s.scale.set((w * c.width) / c.height, w, 1);
  s.renderOrder = 10;
  return s;
}

function buildNpc(id, n) {
  const g = person(n.color, n.hat);
  g.position.set(n.at[0], 0, n.at[1]);
  g.rotation.y = 0.4;
  const tag = label(n.name, { w: 0.032 });
  tag.position.y = 2.6;
  g.add(tag);
  const mark = label("!", { bg: "#ffd166", fg: "#7a4a00", size: 64, w: 0.045 });
  mark.position.y = 3.35;
  mark.visible = false;
  g.add(mark);
  scene.add(g);
  obstacles.push([n.at[0], n.at[1], 0.7]);
  npcMeshes[id] = { group: g, mark };
}

/* ══════════════ 조각 ══════════════ */

/** 칠교 조각 한 개의 3D 모양. 무게중심이 원점이고 바닥에 눕혀 있다. */
export function pieceMesh(kind, color, scale = U) {
  const shape = new THREE.Shape(local(kind).map(([x, y]) => new THREE.Vector2(x * scale, y * scale)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1 });
  geo.rotateX(-Math.PI / 2);           // 모양의 y 가 북쪽(-z), 두께가 위(+y)
  const m = new THREE.Mesh(geo, mat(color, { roughness: 0.55 }));
  m.castShadow = true;
  const g = new THREE.Group();         // 돌리기는 바깥, 뒤집기는 안쪽에서
  g.add(m);
  g.userData.inner = m;
  return g;
}

export function posePiece(g, rot, flip) {
  g.rotation.y = (rot * Math.PI) / 4;
  g.userData.inner.scale.x = flip ? -1 : 1;
}

/** 조각을 땅에 둔다. p = {id, kind, color} */
export function drop(p, x, z) {
  take(p.id);
  const g = pieceMesh(p.kind, p.color);
  posePiece(g, (p.id * 3) % 8, false);
  g.position.set(x, 0.3, z);
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 7, 5),
    new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.4 }));
  beacon.position.set(x, 3.5, z);
  scene.add(g, beacon);
  ground.set(p.id, { g, beacon, x, z, p });
}

export function take(id) {
  const o = ground.get(id);
  if (!o) return;
  scene.remove(o.g, o.beacon);
  ground.delete(id);
}

export function clearGround() { for (const id of [...ground.keys()]) take(id); }

/** 들고 있는 조각을 머리 위에 쌓아 보인다 */
export function carry(list) {
  carryGroup.clear();
  list.forEach((p, i) => {
    const g = pieceMesh(p.kind, p.color, 0.3);
    posePiece(g, i * 2, false);
    g.position.y = i * 0.22;
    carryGroup.add(g);
  });
}

/* ══════════════ 표시 ══════════════ */

/** { npcId: true } — 머리 위에 느낌표 */
export function marks(map) {
  for (const [id, o] of Object.entries(npcMeshes)) o.mark.visible = !!map[id];
}

/** 깬 퀘스트에 따라 다리를 놓는다. animate 면 새로 놓인 다리가 솟아오른다. */
export function openBridges(cleared, animate) {
  for (const b of bridges) {
    const open = cleared.has(b.after);
    if (open && !b.group.visible) { b.group.visible = true; b.grow = animate ? 0 : 1; }
    if (!open) b.group.visible = false;
  }
}

/** 제단 위 틀. slots 가 null 이면 지운다. */
export function showFrame(zone, slots, guide) {
  const f = altars[zone].frame;
  f.clear();
  if (slots) f.add(frameMesh(slots, guide));
}

/* 틀을 그린다 — 짙은 그림자, 안내선이 있으면 조각 경계까지. 틀 가운데가 원점. */
export function frameMesh(slots, guide) {
  const g = new THREE.Group();
  const [cx, cy] = frameCenter(slots);
  const shade = new THREE.MeshBasicMaterial({ color: 0x3d405b, transparent: true, opacity: 0.62, depthWrite: false });
  const line = new THREE.LineBasicMaterial({ color: 0xffffff });
  for (const s of slots) {
    const pts = s.v.map(([x, y]) => new THREE.Vector2((x - cx) * U, (y - cy) * U));
    const m = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts)), shade);
    m.rotation.x = -Math.PI / 2;
    g.add(m);
    if (guide) {
      const lg = new THREE.BufferGeometry().setFromPoints([...pts, pts[0]].map((p) => new THREE.Vector3(p.x, 0.01, -p.y)));
      g.add(new THREE.Line(lg, line));
    }
  }
  return g;
}

export function frameCenter(slots) {
  const xs = slots.flatMap((s) => s.v.map((p) => p[0])), ys = slots.flatMap((s) => s.v.map((p) => p[1]));
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

export function flashBasket(ok) {
  basket.material.emissive.setHex(ok ? 0x2a9d8f : 0xe63946);
  setTimeout(() => basket.material.emissive.setHex(0), 400);
}

/* ══════════════ 입력 ══════════════ */

function bindKeys() {
  const MOVE = ["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"];
  window.addEventListener("keydown", (e) => {
    if (host.closest("[hidden]") || e.target.closest?.("input,textarea,select")) return;
    if (document.querySelector("#veil.show")) return;
    const k = e.key.toLowerCase();
    if (MOVE.includes(k)) { if (!locked) keys.add(k); e.preventDefault(); }
    if ((k === " " || k === "e" || k === "enter") && !e.repeat) {
      if (e.target.closest?.("button")) return;       // 단추에 초점이 있으면 그 단추가 받는다
      e.preventDefault();
      act();
    }
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener("blur", () => keys.clear());
}

/** 화면 조이스틱이 넘겨주는 방향 (-1~1, 위가 +y) */
export function setStick(x, y) { stick.x = x; stick.y = y; }

export function act() { if (!locked && focus) onAction(focus); }

/** 초점으로 잡을 수 있는지 main 이 정한다 (예: 손이 꽉 찼으면 조각은 못 잡는다) */
export function setFocusFilter(fn) { focusFilter = fn; focus = null; }

/** 걷기를 멈춘다 (제단에서 맞추는 동안). 캐릭터도 숨긴다 — 내려다보면 조각을 가린다. */
export function lock(v) {
  locked = v;
  keys.clear();
  focusRing.visible = false;
  player.visible = !v;
}

export const where = () => ({ x: pos.x, z: pos.z });

/* ══════════════ 카메라 ══════════════ */

/** 제단을 내려다본다. w·h(m) 가 화면에 다 들어오게. center 가 null 이면 캐릭터를 따라간다. */
export function viewTop(center, w, h) {
  if (!center) { cam.top = null; return; }
  const t = Math.tan((camera.fov * Math.PI) / 360);
  const height = Math.max(h / 2 / t, w / 2 / (t * camera.aspect)) * 1.06;
  cam.top = { x: center[0], z: center[1], y: height };
}

export const aspect = () => camera.aspect;

/** 화면 좌표 → 높이 y 인 평면 위의 점 */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
export function pointOnPlane(ev, y) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), hit) ? hit.clone() : null;
}

export const canvas = () => renderer.domElement;
export const add = (o) => scene.add(o);
export const remove = (o) => scene.remove(o);
export const onFrame = (fn) => frameHooks.push(fn);
export const altarAt = (zone) => [altars[zone].x, altars[zone].z];

/* ══════════════ 한 프레임 ══════════════ */

const inRect = (x, z, [x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1;

function walkable(x, z) {
  return Object.values(ZONES).some((zn) => inRect(x, z, zn.rect))
      || bridges.some((b) => b.group.visible && inRect(x, z, b.rect));
}

const blocked = (x, z) => obstacles.some(([ox, oz, r]) => Math.hypot(x - ox, z - oz) < r + 0.35);

function move(dt) {
  let dx = stick.x, dz = -stick.y;
  if (keys.has("arrowleft") || keys.has("a")) dx -= 1;
  if (keys.has("arrowright") || keys.has("d")) dx += 1;
  if (keys.has("arrowup") || keys.has("w")) dz -= 1;
  if (keys.has("arrowdown") || keys.has("s")) dz += 1;
  const len = Math.hypot(dx, dz);
  const legs = player.userData.legs;
  if (locked || len < 0.08) { legs[0].rotation.x = legs[1].rotation.x = 0; return false; }
  const k = (Math.min(len, 1) / len) * SPEED * dt;
  // 축마다 따로 움직여 막힌 곳을 따라 미끄러지게 한다
  const nx = pos.x + dx * k, nz = pos.z + dz * k;
  if (walkable(nx, pos.z) && !blocked(nx, pos.z)) pos.x = nx;
  if (walkable(pos.x, nz) && !blocked(pos.x, nz)) pos.z = nz;
  let d = Math.atan2(dx, dz) - heading;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  heading += d * Math.min(1, dt * 12);
  const swing = Math.sin(clock.elapsedTime * 14) * 0.6;
  legs[0].rotation.x = swing; legs[1].rotation.x = -swing;
  return true;
}

function findFocus() {
  let best = null, bd = Infinity;
  const consider = (f, x, z, range) => {
    const d = Math.hypot(pos.x - x, pos.z - z);
    if (d < range && d < bd && focusFilter(f)) { best = { ...f, x, z }; bd = d; }
  };
  for (const [id, o] of ground) consider({ type: "piece", id }, o.x, o.z, 1.9);
  if (best) return best;                               // 발밑 조각이 먼저
  for (const [id, n] of Object.entries(NPCS)) consider({ type: "npc", id }, n.at[0], n.at[1], 2.8);
  for (const [zone, a] of Object.entries(altars)) consider({ type: "altar", zone }, a.x, a.z, PLATE_R + 1.2);
  consider({ type: "basket" }, BASKET[0], BASKET[1], 3);
  return best;
}

const sameFocus = (a, b) => (a && b ? a.type === b.type && a.id === b.id && a.zone === b.zone : a === b);

/** 초점을 다시 셈하게 한다 — 들고 있는 수가 바뀌어 잡을 수 있는 것이 달라졌을 때 */
export function refocus() { focus = undefined; }

const goalPos = new THREE.Vector3(), goalLook = new THREE.Vector3();

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  const moved = move(dt);
  player.position.set(pos.x, moved ? Math.abs(Math.sin(t * 14)) * 0.08 : 0, pos.z);
  player.rotation.y = heading;
  carryGroup.rotation.y = -heading + Math.sin(t * 2) * 0.2;

  for (const o of ground.values()) {
    o.g.position.y = 0.35 + Math.sin(t * 2.4 + o.p.id) * 0.12;
    o.g.rotation.y += dt * 0.8;
  }
  for (const o of Object.values(npcMeshes)) if (o.mark.visible) o.mark.position.y = 3.35 + Math.sin(t * 4) * 0.12;
  for (const b of bridges) {
    if (b.group.visible && b.grow < 1) b.grow = Math.min(1, b.grow + dt * 0.8);
    b.group.position.y = (b.grow - 1) * 2;
  }

  if (!locked) {
    const f = findFocus();
    if (!sameFocus(f, focus)) { focus = f; onFocus(f); }
    focusRing.visible = !!f && f.type === "piece";
    if (focusRing.visible) {
      focusRing.position.set(f.x, 0.08, f.z);
      focusRing.scale.setScalar(1.3 + Math.sin(t * 6) * 0.08);
    }
    const z = Object.keys(ZONES).find((k) => inRect(pos.x, pos.z, ZONES[k].rect));
    if (z && z !== zoneNow) { zoneNow = z; onZone(z); }
  } else if (focus) { focus = null; onFocus(null); }

  frameHooks.forEach((fn) => fn(t, dt));

  if (cam.top) { goalPos.set(cam.top.x, cam.top.y, cam.top.z); goalLook.set(cam.top.x, 0, cam.top.z); }
  else {
    // 세로 화면은 옆이 좁다. 그만큼 멀리서 본다.
    const k = Math.min(1.6, Math.max(1, 1 / Math.sqrt(camera.aspect)));
    goalPos.set(pos.x, 9.5 * k, pos.z + 11 * k); goalLook.set(pos.x, 0.8, pos.z - 1.5);
  }
  const a = cam.pos.lengthSq() === 0 ? 1 : Math.min(1, dt * 5);
  cam.pos.lerp(goalPos, a);
  cam.look.lerp(goalLook, a);
  camera.position.copy(cam.pos);
  camera.lookAt(cam.look);

  renderer.render(scene, camera);
}
