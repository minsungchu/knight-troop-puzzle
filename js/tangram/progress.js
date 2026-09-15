/* 모험 기록 — 어느 퀘스트를 깼고 각각 가장 빨리 깬 시간이 얼마인지.
 *
 * 레이저 미로의 진행 저장(js/laser/progress.js)과 같은 방침이다.
 *   · 이 브라우저(localStorage) — 로그인 전에도 이어서 하도록
 *   · 서버 — 기기를 옮겨도 이어지고, 순위표에 오르도록
 * 로그인하면 둘을 합치고, 같은 퀘스트는 더 빠른 기록을 남긴다. 지우는 쪽으로는 합치지 않는다.
 */

import { client, ONLINE, uid, onAuth } from "../supabase.js";

const KEY = "tangram-progress:v1";

let times = new Map();                 // quest id → 최고 기록(ms)
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
    return new Map(Object.entries(raw).map(([k, v]) => [Number(k), Number(v)]).filter(([k, v]) => k > 0 && v > 0));
  } catch { return new Map(); }
}

function writeLocal() {
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(times))); } catch {}
}

export function load() {
  times = readLocal();
  if (ONLINE) onAuth(() => { pull(); });
}

async function pull() {
  if (!ONLINE || !uid()) return;
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const { data, error } = await (await client()).rpc("tangram_records_get");
      if (error) throw error;
      const server = new Map((data || []).map((r) => [r.quest, r.best_ms]));
      for (const [q, ms] of server) if (!times.has(q) || ms < times.get(q)) times.set(q, ms);
      writeLocal();
      let bad = 0, why = "";
      for (const [q, ms] of times) {
        if (server.get(q) === ms) continue;              // 이 기기에만 있거나 더 빠른 것만 올린다
        const r = await push(q, ms);
        if (!r.ok) { bad++; why = r.why; }
      }
      setHealth(bad ? { ok: false, why, pending: bad } : { ok: true, why: "", pending: 0 });
      document.dispatchEvent(new CustomEvent("tangram-progress"));
    } catch (e) {
      console.warn("모험 기록 동기화 실패", e);
      setHealth({ ok: false, why: e?.message || "", pending: health.pending });
    } finally { syncing = null; }
  })();
  return syncing;
}

async function push(quest, ms) {
  if (!ONLINE || !uid()) return { ok: true };
  try {
    const { error } = await (await client()).rpc("tangram_record_set", { p_quest: quest, p_ms: ms });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    console.warn("모험 기록 저장 실패", e);
    return { ok: false, why: e?.message || String(e) };
  }
}

export const cleared = () => new Set(times.keys());
export const best = (quest) => times.get(quest) ?? null;

/** 퀘스트를 깼다. 더 빠를 때만 기록을 바꾼다. */
export async function clear(quest, ms) {
  const prev = times.get(quest);
  if (prev !== undefined && prev <= ms) return { improved: false, ok: true };
  times.set(quest, ms);
  writeLocal();
  const r = await push(quest, ms);
  if (ONLINE && uid()) {
    setHealth(r.ok ? { ok: true, why: "", pending: 0 } : { ok: false, why: r.why, pending: health.pending + 1 });
  }
  return { improved: true, ok: r.ok };
}
