/* 한 판의 타자 채점기 — DOM 없음.
 *
 * 지문을 스트로크 열로 풀어 두고, 눌린 것을 앞에서부터 맞춰 본다.
 * 틀리면 자리를 넘기지 않는다 — 아이가 그 자리를 다시 찾아 누를 때까지 멈춘다.
 * 대충 넘기고 뒤에서 고치는 버릇이 붙으면 자리를 영영 못 외운다.
 */

import { decompose, compose } from "./hangul.js";

/** 지문 하나를 치는 한 판을 연다. */
export function createRun(text) {
  const chars = [...String(text)];
  const strokes = [];
  const charOf = [];          // 스트로크 → 몇 번째 글자에 속하는가
  const startAt = [];         // 글자 → 그 글자의 첫 스트로크 자리
  chars.forEach((ch, ci) => {
    startAt.push(strokes.length);
    for (const s of decompose(ch)) { strokes.push(s); charOf.push(ci); }
  });
  startAt.push(strokes.length);

  let pos = 0, hits = 0, misses = 0, started = 0, ended = 0;

  const api = {
    text, strokes, total: strokes.length,
    get pos() { return pos; },
    get done() { return pos >= strokes.length; },
    get misses() { return misses; },

    /** 지금 눌러야 하는 스트로크. 다 쳤으면 null. */
    expected: () => (pos < strokes.length ? strokes[pos] : null),

    /** 스트로크 하나를 넣는다. "ok" · "bad" · "done" */
    press(stroke) {
      if (pos >= strokes.length) return "done";
      if (!started) started = performance.now();
      if (stroke !== strokes[pos]) { misses++; return "bad"; }
      pos++; hits++;
      if (pos >= strokes.length) { ended = performance.now(); return "done"; }
      return "ok";
    },

    /** 한 자리 되돌린다. 지운 것은 정타로 세지 않는다. */
    back() {
      if (pos === 0) return false;
      pos--; hits = Math.max(0, hits - 1);
      return true;
    },

    /** 화면에 뿌릴 세 토막 — 다 친 글자 · 지금 조합 중인 글자 · 남은 글자 */
    view() {
      if (pos >= strokes.length) return { hit: text, cur: "", rest: "" };
      const ci = charOf[pos];
      const partial = strokes.slice(startAt[ci], pos);
      return {
        hit: chars.slice(0, ci).join(""),
        cur: partial.length ? compose(partial) : "",
        pending: chars[ci],
        rest: chars.slice(ci + 1).join(""),
      };
    },

    /** 정확도(%)·분당 타수·걸린 시간 */
    stats() {
      const ms = started ? (ended || performance.now()) - started : 0;
      const acc = hits + misses ? Math.round((hits / (hits + misses)) * 100) : 100;
      const cpm = ms > 400 ? Math.round(hits / (ms / 60000)) : 0;
      return { acc, cpm, ms, hits, misses, total: strokes.length };
    },
  };
  return api;
}

/** 여러 줄을 이어서 치는 판 — 줄이 끝나면 다음 줄로 넘어가고 성적은 합산한다. */
export function createSeries(lines) {
  let i = 0;
  let run = createRun(lines[0]);
  let hits = 0, misses = 0, strokes = 0, started = 0;

  return {
    lines,
    get index() { return i; },
    get run() { return run; },
    get done() { return i >= lines.length; },
    next() {
      const s = run.stats();
      hits += s.hits; misses += s.misses; strokes += s.total;
      i++;
      if (i < lines.length) run = createRun(lines[i]);
      return i < lines.length;
    },
    press(stroke) {
      if (!started) started = performance.now();
      return run.press(stroke);
    },
    /** 지금까지 친 줄 + 치는 중인 줄을 합한 성적 */
    stats() {
      const cur = run.stats();
      const h = hits + cur.hits, m = misses + cur.misses;
      const ms = started ? performance.now() - started : 0;
      return {
        acc: h + m ? Math.round((h / (h + m)) * 100) : 100,
        cpm: ms > 400 ? Math.round(h / (ms / 60000)) : 0,
        ms, hits: h, misses: m, total: strokes + cur.total,
      };
    },
  };
}
