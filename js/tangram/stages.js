/* 어드벤처 기록 — 스테이지마다 최고 기록과 별.
 *
 * 저장 방침은 모험 기록(progress.js)과 같다: 이 브라우저와 서버 두 곳에 두고, 로그인하면
 * 합치되 더 좋은 쪽만 남긴다. 별은 깨면 ★, 도움 없이 깨면 ★★, 목표 시간 안에 깨면 ★★★.
 */

import { client, ONLINE, uid, onAuth } from "../supabase.js";

const KEY = "tangram-stages:v1";

let recs = new Map();                  // stage id → { ms, stars }
let syncing = null;

let health = { ok: true, why: "", pending: 0 };
export const state = () => ({ ...health });
function setHealth(next) {
  if (next.ok === health.ok && next.why === health.why && next.pending === health.pending) return;
  health = next;
  document.dispatchEvent(new CustomEvent("save-state"));
}
export const retry = () => pull();

function readLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return new Map(Object.entries(raw)
      .filter(([, v]) => v && v.ms > 0)
      .map(([k, v]) => [k, { ms: +v.ms, stars: +v.stars || 1 }]));
  } catch { return new Map(); }
}
const writeLocal = () => { try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(recs))); } catch {} };

/** 더 좋은 쪽을 남긴다 — 별이 많은 쪽이 우선이고, 별이 같으면 빠른 쪽이다. */
const better = (a, b) => (!a ? b : !b ? a : (b.stars > a.stars || (b.stars === a.stars && b.ms < a.ms)) ? b : a);

export function load() {
  recs = readLocal();
  if (ONLINE) onAuth(() => { pull(); });
}

async function pull() {
  if (!ONLINE || !uid()) return;
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const { data, error } = await (await client()).rpc("tangram_stage_get");
      if (error) throw error;
      const server = new Map((data || []).map((r) => [r.stage, { ms: r.best_ms, stars: r.stars }]));
      for (const [id, s] of server) recs.set(id, better(recs.get(id), s));
      writeLocal();
      let bad = 0, why = "";
      for (const [id, s] of recs) {
        const sv = server.get(id);
        if (sv && sv.ms === s.ms && sv.stars === s.stars) continue;    // 서버가 이미 아는 것
        const r = await push(id, s);
        if (!r.ok) { bad++; why = r.why; }
      }
      setHealth(bad ? { ok: false, why, pending: bad } : { ok: true, why: "", pending: 0 });
      document.dispatchEvent(new CustomEvent("tangram-stages"));
    } catch (e) {
      console.warn("어드벤처 기록 동기화 실패", e);
      setHealth({ ok: false, why: e?.message || "", pending: health.pending });
    } finally { syncing = null; }
  })();
  return syncing;
}

async function push(id, s) {
  if (!ONLINE || !uid()) return { ok: true };
  try {
    const { error } = await (await client()).rpc("tangram_stage_set", { p_stage: id, p_ms: s.ms, p_stars: s.stars });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    console.warn("어드벤처 기록 저장 실패", e);
    return { ok: false, why: e?.message || String(e) };
  }
}

export const get = (id) => recs.get(id) || null;
export const cleared = (id) => recs.has(id);
/** 이 마을에서 모은 별 */
export const starsIn = (stages) => stages.reduce((n, s) => n + (recs.get(s.id)?.stars || 0), 0);
export const clearedIn = (stages) => stages.filter((s) => recs.has(s.id)).length;

/** 한 판 끝냈다. 더 좋을 때만 남긴다. */
export async function clear(id, ms, stars) {
  const prev = recs.get(id);
  const next = better(prev, { ms, stars });
  const improved = next !== prev;
  recs.set(id, next);
  writeLocal();
  if (!improved) return { improved: false, ok: true };
  const r = await push(id, next);
  if (ONLINE && uid()) setHealth(r.ok ? { ok: true, why: "", pending: 0 } : { ok: false, why: r.why, pending: health.pending + 1 });
  return { improved: true, ok: r.ok };
}
