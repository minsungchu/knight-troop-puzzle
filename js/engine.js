/* ===== 나이트 부대 배치 퍼즐 — 핵심 로직 =====
   값 1..4 를 비트마스크로 표현: v -> 1<<(v-1), FULL = 15
   규칙 R1: 각 칸은 1~4 중 하나
   규칙 R2: 나이트 이동(±1,±2)/(±2,±1)으로 연결된 두 칸은 값이 다름
   규칙 R3: 가로/세로/대각선/반대각선 방향 연속 3칸이 모두 같으면 안 됨
*/
const KP = (function () {
  const FULL = 15;
  const POP = new Uint8Array(16);
  const SVAL = new Int8Array(16);
  for (let m = 0; m < 16; m++) {
    let p = 0, last = 0;
    for (let v = 1; v <= 4; v++) if (m & (1 << (v - 1))) { p++; last = v; }
    POP[m] = p;
    SVAL[m] = p === 1 ? last : 0;
  }
  const bit = (v) => 1 << (v - 1);

  // ---- 난수 (시드 고정 가능) ----
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rnd) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // ---- 판 구조(나이트 이웃 / 3연속 트리플) ----
  const KDIR = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
  const TDIR = [[0, 1], [1, 0], [1, 1], [1, -1]];

  function buildGeom(W, H) {
    const N = W * H;
    const knight = [], cellTriples = [], triples = [];
    for (let i = 0; i < N; i++) { knight.push([]); cellTriples.push([]); }
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const i = r * W + c;
      for (const [dr, dc] of KDIR) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < H && nc >= 0 && nc < W) knight[i].push(nr * W + nc);
      }
      for (const [dr, dc] of TDIR) {
        const r2 = r + 2 * dr, c2 = c + 2 * dc;
        if (r2 < 0 || r2 >= H || c2 < 0 || c2 >= W) continue;
        const t = [i, (r + dr) * W + (c + dc), r2 * W + c2];
        const ti = triples.length;
        triples.push(t);
        for (const x of t) cellTriples[x].push(ti);
      }
    }
    return { W, H, N, knight, triples, cellTriples };
  }

  // ---- 제약 전파 ----
  function pruneTriple(cand, t, stack) {
    for (let p = 0; p < 3; p++) {
      const a = t[p], b = t[(p + 1) % 3], c = t[(p + 2) % 3];
      const ma = cand[a];
      if (POP[ma] === 1 && ma === cand[b] && (cand[c] & ma)) {
        cand[c] &= ~ma;
        if (!cand[c]) return false;
        stack.push(c);
      }
    }
    return true;
  }

  function propagate(g, cand, stack) {
    while (stack.length) {
      const i = stack.pop();
      const m = cand[i];
      if (m === 0) return false;
      if (POP[m] === 1) {
        const kn = g.knight[i];
        for (let k = 0; k < kn.length; k++) {
          const j = kn[k];
          if (cand[j] & m) {
            cand[j] &= ~m;
            if (!cand[j]) return false;
            stack.push(j);
          }
        }
      }
      const ct = g.cellTriples[i];
      for (let k = 0; k < ct.length; k++) {
        if (!pruneTriple(cand, g.triples[ct[k]], stack)) return false;
      }
    }
    return true;
  }

  function allFixed(g, cand) {
    for (let i = 0; i < g.N; i++) if (POP[cand[i]] !== 1) return false;
    return true;
  }

  // ---- 완전 탐색(정답지 생성) ----
  function dfs(g, cand, rnd, st) {
    if (++st.nodes > st.limit) { st.abort = true; return null; }
    let best = -1, bp = 9;
    for (let k = 0; k < g.N; k++) {
      const i = st.order[k], p = POP[cand[i]];
      if (p > 1 && p < bp) { bp = p; best = i; if (p === 2) break; }
    }
    if (best < 0) return cand;
    const vals = [];
    for (let v = 1; v <= 4; v++) if (cand[best] & bit(v)) vals.push(v);
    shuffle(vals, rnd);
    for (const v of vals) {
      const c2 = cand.slice();
      c2[best] = bit(v);
      if (propagate(g, c2, [best])) {
        const r = dfs(g, c2, rnd, st);
        if (r) return r;
      }
      if (st.abort) return null;
    }
    return null;
  }

  // ---- 폴백 정답지: 행 패턴 × 열 패턴 (항상 R1~R3 만족) ----
  function patternSolution(g, rnd) {
    const { W, H } = g;
    const gr = new Uint8Array(H), hc = new Uint8Array(W);
    const s0 = rnd() < 0.5 ? 0 : 1, s1 = rnd() < 0.5 ? 0 : 1;
    const t0 = rnd() < 0.5 ? 0 : 1, t1 = rnd() < 0.5 ? 0 : 1;
    for (let r = 0; r < H; r++) gr[r] = (((r % 2) ? s1 : s0) + ((r / 2) | 0)) % 2;
    for (let c = 0; c < W; c++) hc[c] = (((c % 2) ? t1 : t0) + ((c / 2) | 0)) % 2;
    const perm = shuffle([1, 2, 3, 4], rnd);
    const sol = new Int8Array(g.N);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) sol[r * W + c] = perm[2 * gr[r] + hc[c]];
    return sol;
  }

  function makeSolution(g, rnd, limit) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const cand = new Int8Array(g.N).fill(FULL);
      const stack = [];
      for (let i = 0; i < g.N; i++) stack.push(i);
      if (!propagate(g, cand, stack)) break;
      const order = shuffle(Array.from({ length: g.N }, (_, i) => i), rnd);
      const st = { nodes: 0, limit: limit || 120000, abort: false, order };
      const res = dfs(g, cand, rnd, st);
      if (res) {
        const sol = new Int8Array(g.N);
        for (let i = 0; i < g.N; i++) sol[i] = SVAL[res[i]];
        return { sol, byPattern: false };
      }
    }
    return { sol: patternSolution(g, rnd), byPattern: true };
  }

  // ---- 논리 솔버 ----
  // level 1: 확정칸 소거만 (단일 후보 확정)
  // level 2: + 깊이1 가정 소거(후보 2개 칸 한정)
  // level 3: + 깊이1 가정 소거(모든 칸) + 두 갈래 공통결론(교집합) 추론
  function logicSolve(g, puzzle, level, deadline) {
    const cand = new Int8Array(g.N).fill(FULL);
    const stack = [];
    for (let i = 0; i < g.N; i++) {
      if (puzzle[i]) cand[i] = bit(puzzle[i]);
      stack.push(i);
    }
    if (!propagate(g, cand, stack)) return null;

    for (;;) {
      if (allFixed(g, cand)) return cand;
      if (level < 2) return null;
      if (deadline && Date.now() > deadline) return null;

      let progressed = false;

      // 가정 소거
      const onlyBi = (level === 2);
      outer:
      for (let i = 0; i < g.N; i++) {
        const m = cand[i], p = POP[m];
        if (p < 2) continue;
        if (onlyBi && p !== 2) continue;
        for (let v = 1; v <= 4; v++) {
          const b = bit(v);
          if (!(m & b)) continue;
          const c2 = cand.slice();
          c2[i] = b;
          if (!propagate(g, c2, [i])) {
            cand[i] &= ~b;
            if (!cand[i]) return null;
            if (!propagate(g, cand, [i])) return null;
            progressed = true;
            break outer;
          }
        }
      }

      // 공통결론 추론
      if (!progressed && level >= 3) {
        for (let i = 0; i < g.N && !progressed; i++) {
          if (POP[cand[i]] !== 2) continue;
          const vs = [];
          for (let v = 1; v <= 4; v++) if (cand[i] & bit(v)) vs.push(v);
          const a = cand.slice(); a[i] = bit(vs[0]);
          const b = cand.slice(); b[i] = bit(vs[1]);
          if (!propagate(g, a, [i]) || !propagate(g, b, [i])) { progressed = true; break; }
          const changed = [];
          for (let j = 0; j < g.N; j++) {
            const nm = cand[j] & (a[j] | b[j]);
            if (nm !== cand[j]) {
              if (!nm) return null;
              cand[j] = nm;
              changed.push(j);
            }
          }
          if (changed.length) {
            if (!propagate(g, cand, changed)) return null;
            progressed = true;
          }
        }
      }

      if (!progressed) return null;
    }
  }

  // ---- 힌트 제거 ----
  // minGiven: 남겨둘 최소 힌트 수(난이도 하한 조절용)
  function makePuzzle(g, solution, level, rnd, deadline, minGiven) {
    const puzzle = new Int8Array(solution);
    let given = g.N;
    const order = shuffle(Array.from({ length: g.N }, (_, i) => i), rnd);
    for (const i of order) {
      if (given <= (minGiven || 0)) break;
      if (deadline && Date.now() > deadline) break;
      const save = puzzle[i];
      puzzle[i] = 0;
      if (!logicSolve(g, puzzle, level, deadline)) puzzle[i] = save;
      else given--;
    }
    return puzzle;
  }

  function gradePuzzle(g, puzzle, deadline) {
    for (let l = 1; l <= 3; l++) if (logicSolve(g, puzzle, l, deadline)) return l;
    return 4; // 논리로 못 푸는 경우(발생하면 안 됨)
  }

  // 난이도 = (허용 추론 기법, 힌트 하한)
  // 쉬움/보통은 1단계(순수 소거)만 허용 — 가정해서 찍어야 하는 순간이 생기지 않는다.
  // 어려움만 2단계(한 칸 가정 후 모순 확인)를 허용한다.
  const TECH  = { 1: 1, 2: 1, 3: 2 };
  const FLOOR = { 1: 0.50, 2: 0.32, 3: 0 };
  const ATTEMPTS = { 1: 1, 2: 2, 3: 5 };

  function generate(W, H, mode, opts) {
    const level = TECH[mode] || 1;
    opts = opts || {};
    const rnd = mulberry32(opts.seed !== undefined ? opts.seed : (Math.random() * 1e9) | 0);
    const g = buildGeom(W, H);
    const t0 = Date.now();
    const deadline = t0 + (opts.budgetMs || 6000);
    const minGiven = Math.round(FLOOR[mode] * g.N);
    let best = null;
    for (let a = 0; a < (ATTEMPTS[mode] || 1); a++) {
      const { sol, byPattern } = makeSolution(g, rnd, opts.nodeLimit);
      const puzzle = makePuzzle(g, sol, level, rnd, deadline, minGiven);
      let given = 0;
      for (let i = 0; i < g.N; i++) if (puzzle[i]) given++;
      const actualLevel = gradePuzzle(g, puzzle, Date.now() + 2000);
      const cand = { W, H, geom: g, solution: sol, puzzle, byPattern, given, ratio: given / g.N, actualLevel, needsGuess: actualLevel > 1 };
      if (!best) best = cand;
      else {
        const score = (x) => Math.min(x.actualLevel, level) * 10000 - x.given;
        if (score(cand) > score(best)) best = cand;
      }
      if (best.actualLevel === level) break;
      if (Date.now() > deadline) break;
    }
    best.ms = Date.now() - t0;
    return best;
  }

  // ---- 검증 유틸 ----
  function violations(g, values) {
    // values: 0(빈칸) 또는 1..4
    const bad = new Set();
    for (let i = 0; i < g.N; i++) {
      const v = values[i];
      if (!v) continue;
      for (const j of g.knight[i]) if (values[j] === v) { bad.add(i); bad.add(j); }
    }
    for (const t of g.triples) {
      const [a, b, c] = t;
      if (values[a] && values[a] === values[b] && values[b] === values[c]) { bad.add(a); bad.add(b); bad.add(c); }
    }
    return bad;
  }

  function checkSolution(g, values) {
    for (let i = 0; i < g.N; i++) if (!values[i]) return false;
    return violations(g, values).size === 0;
  }

  return { FULL, POP, SVAL, bit, buildGeom, propagate, logicSolve, makeSolution, makePuzzle, generate, gradePuzzle, violations, checkSolution, mulberry32, shuffle, patternSolution };
})();

export default KP;
export { KP };
