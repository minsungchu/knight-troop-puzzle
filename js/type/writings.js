/* 아이가 쓴 글을 보관한다.
 *
 * 진행 기록과 같은 방침이다 — 로그인하지 않아도 쓸 수 있어야 하므로 이 브라우저에
 * 먼저 남기고, 로그인하면 서버와 합친다. 글에는 id 를 붙여 두고 id 로 합치므로
 * 같은 글이 두 벌 생기지 않는다.
 *
 * 글은 본인만 본다. 남에게 보여 주는 곳을 만들지 않았다 — 초등학생이 쓴 글이
 * 모르는 사람에게 흘러가는 경로는 아예 열지 않는 편이 낫다.
 */
import { client, ONLINE, uid, onAuth } from "../supabase.js";

const KEY = "type-writings:v1";
const MAX_LEN = 4000;

let list = [];        // [{id, prompt, text, chars, at}]  최근 것이 앞
let syncing = null;

/* 서버 보관이 지금 되고 있는가. 진행 기록과 같은 방식으로 밖에 알린다 —
   쓴 글이 이 브라우저에만 있는데 저장된 줄 알면, 지워질 때 되돌릴 길이 없다. */
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
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}
const writeLocal = () => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {} };
const sortNewest = () => list.sort((a, b) => (a.at < b.at ? 1 : -1));

export function load() {
  list = readLocal();
  sortNewest();
  if (ONLINE) onAuth(() => { pull(); });
}

export const all = () => list.slice();
export const get = (id) => list.find((w) => w.id === id) || null;

function newId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

/** 글 하나를 저장한다. id 를 주면 그 글을 고쳐 쓴다. */
export function save({ id, prompt, text }) {
  const body = String(text || "").slice(0, MAX_LEN);
  if (!body.trim()) return null;
  const row = {
    id: id || newId(),
    prompt: String(prompt || "").slice(0, 120),
    text: body,
    chars: body.replace(/\s/g, "").length,
    at: new Date().toISOString(),
  };
  const at = list.findIndex((w) => w.id === row.id);
  if (at >= 0) list[at] = row; else list.unshift(row);
  sortNewest();
  writeLocal();
  push(row).then((r) => {
    if (!ONLINE || !uid()) return;
    setHealth(r.ok ? { ok: true, why: "", pending: 0 }
                   : { ok: false, why: r.why, pending: health.pending + 1 });
  });
  document.dispatchEvent(new CustomEvent("type-writings"));
  return row;
}

export function remove(id) {
  list = list.filter((w) => w.id !== id);
  writeLocal();
  if (ONLINE && uid()) {
    (async () => {
      try { await (await client()).rpc("type_writing_delete", { p_id: id }); } catch (e) { console.warn(e); }
    })();
  }
  document.dispatchEvent(new CustomEvent("type-writings"));
}

async function pull() {
  if (!ONLINE || !uid()) return;
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const { data, error } = await (await client()).rpc("type_writing_list");
      if (error) throw error;
      const server = new Map((data || []).map((r) => [r.id, {
        id: r.id, prompt: r.prompt, text: r.body, chars: r.chars, at: r.written_at,
      }]));
      const mine = new Map(list.map((w) => [w.id, w]));
      // 같은 id 는 나중에 쓴 쪽이 이긴다. 한쪽에만 있는 것은 양쪽에 채운다.
      for (const [id, row] of server) {
        const local = mine.get(id);
        if (!local || local.at < row.at) mine.set(id, row);
      }
      list = [...mine.values()];
      sortNewest();
      writeLocal();
      let bad = 0, why = "";
      for (const w of list) {
        if (server.has(w.id) && !(server.get(w.id).at < w.at)) continue;
        const r = await push(w);
        if (!r.ok) { bad++; why = r.why; }
      }
      setHealth(bad ? { ok: false, why, pending: bad } : { ok: true, why: "", pending: 0 });
      document.dispatchEvent(new CustomEvent("type-writings"));
    } catch (e) {
      console.warn("글 동기화 실패", e);
      setHealth({ ok: false, why: e?.message || "", pending: health.pending });
    } finally { syncing = null; }
  })();
  return syncing;
}

async function push(row) {
  if (!ONLINE || !uid()) return { ok: true };
  try {
    const { error } = await (await client()).rpc("type_writing_save", {
      p_id: row.id, p_prompt: row.prompt, p_body: row.text, p_at: row.at,
    });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    console.warn("글 저장 실패", e);
    return { ok: false, why: e?.message || String(e) };
  }
}
