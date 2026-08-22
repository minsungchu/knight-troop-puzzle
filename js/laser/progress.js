/* 솔로 진행 — 어디까지 올랐고 각 단계 최고 기록이 얼마인지.
 *
 * 계정별로 남기지만, 로그인하지 않아도 놀 수 있어야 한다. 그래서 두 곳에 둔다.
 *   · 이 브라우저(localStorage) — 로그인 전에도 이어서 하도록
 *   · 서버 — 기기를 옮겨도 이어지도록
 * 로그인하는 순간 둘을 합친다. 합칠 때는 각 단계의 '더 빠른 기록'을 남긴다.
 * 진행을 지우는 쪽으로는 절대 합치지 않는다 — 다른 기기에서 올라간 것을
 * 이 기기의 빈 기록으로 덮으면 안 된다.
 *
 * 저장이 됐는지 안 됐는지는 밖에서 물어볼 수 있게 열어 둔다(state). 예전에는 서버가
 * 거절해도 콘솔에 한 줄 적고 말았다 — 아이는 다 저장된 줄 알고 계속 올라갔다.
 */

import { client, ONLINE, uid, onAuth } from "../supabase.js";

const KEY = "laser-progress:v1";

/** stage(number) → 최고 기록(ms) */
let times = new Map();
let syncing = null;

/* 서버 저장이 지금 되고 있는가. pending 은 아직 못 올린 기록 수. */
let health = { ok: true, why: "", pending: 0 };
export const state = () => ({ ...health });
function setHealth(next) {
  if (next.ok === health.ok && next.why === health.why && next.pending === health.pending) return;
  health = next;
  document.dispatchEvent(new CustomEvent("save-state"));
}

/** 못 올린 것을 다시 올린다. 서버 것과 합치는 길이 곧 다시 올리는 길이다. */
export const retry = () => pull();

function readLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return new Map(Object.entries(raw).map(([k, v]) => [Number(k), Number(v)]));
  } catch { return new Map(); }
}

function writeLocal() {
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(times))); } catch {}
}

/** 두 기록을 합친다 — 같은 단계는 더 빠른 쪽이 남는다. */
function merge(a, b) {
  const out = new Map(a);
  for (const [s, ms] of b) if (!out.has(s) || ms < out.get(s)) out.set(s, ms);
  return out;
}

export async function load() {
  times = readLocal();
  if (ONLINE) {
    onAuth(() => { pull(); });      // 로그인·로그아웃 때마다 다시 맞춘다
  }
}

/** 서버 기록을 가져와 이 기기 것과 합치고, 합친 결과를 양쪽에 되돌린다. */
async function pull() {
  if (!ONLINE || !uid()) return;
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const { data, error } = await (await client()).rpc("laser_progress_get");
      if (error) throw error;
      const server = new Map((data || []).map((r) => [r.stage, r.best_ms]));
      const merged = merge(times, server);
      const changed = [...merged].filter(([s, ms]) => server.get(s) !== ms);
      times = merged;
      writeLocal();
      // 이 기기에만 있던 것을 서버로 올린다
      let bad = 0, why = "";
      for (const [stage, ms] of changed) {
        const r = await push(stage, ms);
        if (!r.ok) { bad++; why = r.why; }
      }
      setHealth(bad ? { ok: false, why, pending: bad } : { ok: true, why: "", pending: 0 });
      document.dispatchEvent(new CustomEvent("laser-progress"));
    } catch (e) {
      console.warn("진행 동기화 실패", e);
      setHealth({ ok: false, why: e?.message || "", pending: health.pending });
    } finally { syncing = null; }
  })();
  return syncing;
}

async function push(stage, ms) {
  if (!ONLINE || !uid()) return { ok: true };
  try {
    const { error } = await (await client()).rpc("laser_progress_set", { p_stage: stage, p_ms: ms });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    console.warn("진행 저장 실패", e);
    return { ok: false, why: e?.message || String(e) };
  }
}

/** 깬 단계 번호들 */
export function cleared() { return new Set(times.keys()); }

/** 그 단계 최고 기록(ms). 없으면 null. */
export function best(stage) { return times.get(stage) ?? null; }

/** 단계를 깼다. 더 빠를 때만 기록을 바꾼다. */
export async function clearStage(stage, ms) {
  const prev = times.get(stage);
  if (prev !== undefined && prev <= ms) return;   // 기록은 나아질 때만 덮는다
  times.set(stage, ms);
  writeLocal();
  const r = await push(stage, ms);
  if (ONLINE && uid()) {
    setHealth(r.ok ? { ok: true, why: "", pending: 0 }
                   : { ok: false, why: r.why, pending: health.pending + 1 });
  }
}
