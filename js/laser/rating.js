/* 대전 점수와 급수.
 *
 * 요구는 이랬다 — 기본 1000점, 1000점 단위로 등급, 1000점이 9급, 2000점이 8급.
 * 같은 등급끼리는 10점씩 오르내리고, 등급이 다르면 낮은 쪽이 더 많이 오르고 높은
 * 쪽은 덜 오르며, 등급 차가 클수록 그 정도가 심해진다.
 *
 * 이건 Elo 그대로다. K=20, 눈금 S=1000 으로 두면 요구가 정확히 맞는다.
 *   · 점수가 같으면 기대 승률 0.5 → 이긴 쪽 +10, 진 쪽 -10
 *   · 1000점 아래인 쪽이 이기면 +18.2, 1000점 위인 쪽이 이기면 +1.8
 *   · 2000점 차이면 +19.8 대 +0.2 — 차가 벌어질수록 더 극단이 된다
 * 따로 식을 만들 이유가 없어 Elo 를 쓴다.
 */

export const BASE = 1000;
const K = 20;
const SCALE = 1000;

/** 점수 → 급수. 낮은 급이 높다(1급이 가장 높다). */
export function grade(rating) {
  const g = 10 - Math.floor(rating / 1000);
  return Math.min(15, Math.max(1, g));
}

/** 화면에 쓰는 이름 */
export function gradeName(rating) { return `${grade(rating)}급`; }

/** a 가 b 를 이길 기대 확률 */
export function expected(a, b) {
  return 1 / (1 + Math.pow(10, (b - a) / SCALE));
}

/**
 * 한 판이 끝난 뒤 점수를 다시 매긴다.
 *
 * 셋 이상이면 짝마다 Elo 를 적용하고 K 를 (인원-1) 로 나눈다. 그래야 네 명이서
 * 한 판 한 것이 두 명이서 세 판 한 것처럼 부풀지 않는다.
 *
 * @param {Array<{id:string, rating:number, rank:number}>} players
 *        rank 는 1등이 1. 같은 등수(무승부)는 같은 값을 준다.
 * @returns {Map<string, {before:number, after:number, delta:number}>}
 */
export function rerate(players) {
  const n = players.length;
  const out = new Map();
  if (n < 2) {
    for (const p of players) out.set(p.id, { before: p.rating, after: p.rating, delta: 0 });
    return out;
  }
  const k = K / (n - 1);

  for (const a of players) {
    let delta = 0;
    for (const b of players) {
      if (a.id === b.id) continue;
      // 이겼으면 1, 비겼으면 0.5, 졌으면 0
      const s = a.rank < b.rank ? 1 : a.rank > b.rank ? 0 : 0.5;
      delta += k * (s - expected(a.rating, b.rating));
    }
    const d = Math.round(delta);
    out.set(a.id, { before: a.rating, after: Math.max(100, a.rating + d), delta: d });
  }
  return out;
}
