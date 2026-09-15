/* 칠교 조각의 모양과 판정 — 순수 계산, DOM·Three 없음.
 *
 * 단위: 일곱 조각을 모은 큰 정사각형의 한 변이 4 다.
 *   큰 삼각형 L  빗변 4   (넓이 4) × 2
 *   중간 삼각형 M 빗변 2√2 (넓이 2) × 1
 *   작은 삼각형 S 빗변 2   (넓이 1) × 2
 *   정사각형 Q    한 변 √2 (넓이 2) × 1
 *   평행사변형 P  두 변 2·√2 (넓이 2) × 1
 *
 * 조각 하나는 { kind, x, y, rot, flip } 로만 들고, 꼭짓점은 늘 원래 모양에서 새로 셈한다.
 * 돌린 꼭짓점을 다시 돌리면 오차가 쌓여 딱 맞던 조각이 틈을 벌린다.
 */

export const KINDS = {
  L: { name: "큰 삼각형",   right: true,  v: [[0, 0], [4, 0], [2, 2]] },
  M: { name: "중간 삼각형", right: true,  v: [[0, 0], [2, 0], [0, 2]] },
  S: { name: "작은 삼각형", right: true,  v: [[0, 0], [2, 0], [1, 1]] },
  Q: { name: "정사각형",   right: false, v: [[1, 0], [2, 1], [1, 2], [0, 1]] },
  P: { name: "평행사변형", right: false, v: [[0, 0], [2, 0], [3, 1], [1, 1]] },
};

export function centroid(v) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < v.length; i++) {
    const [x0, y0] = v[i], [x1, y1] = v[(i + 1) % v.length];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function area(v) {
  let a = 0;
  for (let i = 0; i < v.length; i++) {
    const [x0, y0] = v[i], [x1, y1] = v[(i + 1) % v.length];
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
}

/* 원래 모양을 무게중심에 맞춰 둔다. 돌리기가 제자리에서 돌게. */
const LOCAL = Object.fromEntries(Object.entries(KINDS).map(([k, s]) => {
  const c = centroid(s.v);
  return [k, s.v.map(([x, y]) => [x - c[0], y - c[1]])];
}));

/** 무게중심 기준 원래 모양 (3D 조각을 만들 때 쓴다) */
export const local = (kind) => LOCAL[kind];

/** 놓인 조각의 꼭짓점. rot 는 45° 단위(0~7), flip 은 좌우 뒤집기. */
export function verts(p) {
  const t = (p.rot * Math.PI) / 4, c = Math.cos(t), s = Math.sin(t);
  return LOCAL[p.kind].map(([x, y]) => {
    if (p.flip) x = -x;
    return [p.x + x * c - y * s, p.y + x * s + y * c];
  });
}

export function inside([px, py], v) {
  let hit = false;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const [xi, yi] = v[i], [xj, yj] = v[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const EPS = 1e-3;
const same = (a, b) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;

/** 꼭짓점 묶음이 같은가 — 순서는 따지지 않는다. 대칭인 조각은 어느 쪽으로 돌려 놓아도 같다. */
export function sameVerts(a, b) {
  return a.length === b.length && a.every((p) => b.some((q) => same(p, q)));
}

/**
 * 조각을 가까운 꼭짓점에 붙인다. 조각 꼭짓점 하나가 후보 점과 reach 안이면
 * 그만큼 옮긴 새 조각을 돌려준다. 붙을 데가 없으면 그대로.
 */
export function snap(p, points, reach = 0.6) {
  let best = null, bd = reach * reach;
  for (const a of verts(p)) {
    for (const b of points) {
      const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
      if (d < bd) { bd = d; best = [b[0] - a[0], b[1] - a[1]]; }
    }
  }
  return best ? { ...p, x: p.x + best[0], y: p.y + best[1] } : p;
}

/** 틀 안내선 한 칸에 그대로 들어맞는가 */
export const fits = (p, slot) => p.kind === slot.k && sameVerts(verts(p), slot.v);

/* 판정용 표본점. x·y 에 서로 다른 어긋남을 줘서 가로·세로·45° 변 위에 점이 떨어지지 않게 한다. */
function samples(v, step = 0.1) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of v) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const out = [];
  for (let x = Math.floor(x0) + 0.031; x < x1; x += step)
    for (let y = Math.floor(y0) + 0.067; y < y1; y += step) out.push([x, y]);
  return out;
}

/**
 * 틀을 다 채웠는가. 어떤 배치든 윤곽을 겹침 없이 꼭 채우고 밖으로 삐져나오지 않으면 된다 —
 * 정답이 하나만 있는 게 아니다.
 * @param slots  틀 [{k, v}]
 * @param pieces 놓인 조각 [{kind,x,y,rot,flip}]
 */
export function complete(slots, pieces) {
  if (pieces.length !== slots.length) return false;
  const polys = pieces.map(verts);
  return !overlapOrGap(slots.map((s) => s.v), polys);
}

/** 틀(polys a)과 조각(polys b)이 어긋나는 첫 표본점. 딱 맞으면 null. */
export function overlapOrGap(frame, polys) {
  for (const pt of samples(frame.flat().concat(polys.flat()))) {
    const want = frame.some((v) => inside(pt, v)) ? 1 : 0;
    let n = 0;
    for (const v of polys) if (inside(pt, v)) n++;
    if (n !== want) return pt;
  }
  return null;
}

/** 이 꼭짓점 묶음이 어떤 조각 모양인가 (틀 검사용). 아무것도 아니면 null. */
export function kindOf(v) {
  const c = centroid(v);
  for (const k of Object.keys(KINDS))
    for (let rot = 0; rot < 8; rot++)
      for (const flip of [false, true])
        if (sameVerts(verts({ kind: k, x: c[0], y: c[1], rot, flip }), v)) return k;
  return null;
}

/** 틀 칸에 딱 맞는 조각 놓임새 하나 (힌트·검사용) */
export function placementFor(slot) {
  const c = centroid(slot.v);
  for (let rot = 0; rot < 8; rot++)
    for (const flip of [false, true]) {
      const p = { kind: slot.k, x: c[0], y: c[1], rot, flip };
      if (fits(p, slot)) return p;
    }
  return null;
}
