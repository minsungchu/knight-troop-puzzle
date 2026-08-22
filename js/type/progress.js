/* 타자 진행 — 어느 단계까지 별을 받았고, 게임 최고 점수가 얼마인가.
 *
 * 레이저 등반과 같은 방침이다. 로그인하지 않아도 놀 수 있어야 하므로 이 브라우저에
 * 먼저 남기고, 로그인하면 서버 것과 합친다. 합칠 때는 항상 '더 나은 쪽'을 남긴다 —
 * 다른 기기에서 받은 별을 이 기기의 빈 기록으로 덮으면 안 된다.
 *
 * 저장이 됐는지 안 됐는지는 밖에서 물어볼 수 있게 열어 둔다(state). 예전에는 서버가
 * 거절해도 콘솔에 한 줄 적고 말았다 — 아이는 다 저장된 줄 알고 계속 별을 모았다.
 */

import { client, ONLINE, uid, onAuth } from "../supabase.js";

const KEY = "type-progress:v1";

/** item("stage:3" · "castle") → {stars, cpm, acc, score} */
let book = new Map();
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

const blank = () => ({ stars: 0, cpm: 0, acc: 0, score: 0 });
const better = (a, b) => ({
  stars: Math.max(a.stars, b.stars), cpm: Math.max(a.cpm, b.cpm),
  acc: Math.max(a.acc, b.acc), score: Math.max(a.score, b.score),
});

function readLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return new Map(Object.entries(raw).map(([k, v]) => [k, { ...blank(), ...v }]));
  } catch { return new Map(); }
}
function writeLocal() {
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(book))); } catch {}
}

export function load() {
  book = readLocal();
  if (ONLINE) onAuth(() => { pull(); });
}

async function pull() {
  if (!ONLINE || !uid()) return;
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const { data, error } = await (await client()).rpc("type_progress_get");
      if (error) throw error;
      const server = new Map((data || []).map((r) => [r.item, { stars: r.stars, cpm: r.best_cpm, acc: r.best_acc, score: r.best_score }]));
      const changed = [];
      for (const [item, v] of server) {
        const merged = better(book.get(item) || blank(), v);
        book.set(item, merged);
      }
      for (const [item, v] of book) {
        const s = server.get(item);
        if (!s || s.stars < v.stars || s.cpm < v.cpm || s.acc < v.acc || s.score < v.score) changed.push([item, v]);
      }
      writeLocal();
      let bad = 0, why = "";
      for (const [item, v] of changed) {
        const r = await push(item, v);
        if (!r.ok) { bad++; why = r.why; }
      }
      setHealth(bad ? { ok: false, why, pending: bad } : { ok: true, why: "", pending: 0 });
      document.dispatchEvent(new CustomEvent("type-progress"));
    } catch (e) {
      console.warn("타자 진행 동기화 실패", e);
      setHealth({ ok: false, why: e?.message || "", pending: health.pending });
    } finally { syncing = null; }
  })();
  return syncing;
}

async function push(item, v) {
  if (!ONLINE || !uid()) return { ok: true };
  try {
    const { error } = await (await client()).rpc("type_progress_set", {
      p_item: item, p_stars: v.stars, p_cpm: v.cpm, p_acc: v.acc, p_score: v.score,
    });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    console.warn("타자 진행 저장 실패", e);
    return { ok: false, why: e?.message || String(e) };
  }
}

export const get = (item) => book.get(item) || blank();

/** 기록을 남긴다. 나아진 항목만 덮는다. */
export function record(item, v) {
  const merged = better(get(item), { ...blank(), ...v });
  const prev = get(item);
  if (prev.stars === merged.stars && prev.cpm === merged.cpm && prev.acc === merged.acc && prev.score === merged.score) return false;
  book.set(item, merged);
  writeLocal();
  push(item, merged).then((r) => {
    if (!ONLINE || !uid()) return;
    setHealth(r.ok ? { ok: true, why: "", pending: 0 }
                   : { ok: false, why: r.why, pending: health.pending + 1 });
  });
  document.dispatchEvent(new CustomEvent("type-progress"));
  return true;
}

/** 단계 별. 영타는 이름 앞에 'en:' 이 붙어 한글 진도와 섞이지 않는다. */
export const stageStars = (n, prefix) => get((prefix || "") + "stage:" + n).stars;

/** 별을 하나라도 받은 마지막 단계 다음까지 열어 준다. 1단계는 늘 열려 있다. */
export function unlockedThrough(stages, prefix) {
  let last = 1;
  for (const s of stages) if (stageStars(s.n, prefix) > 0) last = Math.max(last, s.n + 1);
  return Math.min(last, stages.length);
}
