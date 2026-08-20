/* 주제 고르기 — 공룡이든 바다든, 아이가 좋아하는 낱말로 연습한다.
 *
 * 고른 주제는 연습·낱말·게임 세 곳에서 함께 쓴다. 한 번 고르면 계속 따라다니고,
 * 언제든 다시 바꿀 수 있다. 하나도 안 고른 상태는 두지 않는다 — 낼 낱말이 없어진다.
 */
import { Store, esc } from "../ui.js";

const KEY = "type-topics:v1";

let data = null;                 // {topics:[{id,name,mark,words}]}
let chosen = null;               // Set<id>

export async function load() {
  if (data) return data;
  const res = await fetch("data/type-words.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("낱말을 불러오지 못했습니다");
  data = await res.json();
  const saved = (Store.get(KEY) || "").split(",").filter(Boolean);
  const valid = saved.filter((id) => data.topics.some((t) => t.id === id));
  chosen = new Set(valid.length ? valid : data.topics.map((t) => t.id));
  return data;
}

export const topics = () => (data ? data.topics : []);
export const isOn = (id) => chosen.has(id);

/** 고른 주제의 낱말 전부 */
export function words() {
  return topics().filter((t) => chosen.has(t.id)).flatMap((t) => t.words);
}

/** 낱말 하나가 어느 주제 것인지 — 게임에서 표시에 쓴다 */
export function markOf(word) {
  const t = topics().find((x) => x.words.includes(word));
  return t ? t.mark : "";
}

export function toggle(id) {
  if (chosen.has(id)) {
    if (chosen.size === 1) return false;      // 마지막 하나는 끄지 못한다
    chosen.delete(id);
  } else chosen.add(id);
  Store.set(KEY, [...chosen].join(","));
  document.dispatchEvent(new CustomEvent("type-topics"));
  return true;
}

/** 주제 고르는 칩 줄. 누르면 스스로 다시 그린다. */
export function chips(el) {
  const draw = () => {
    el.innerHTML = `<div class="ty-topics">${topics().map((t) =>
      `<button class="chip ty-topic${chosen.has(t.id) ? " on" : ""}" data-id="${t.id}">
         <span class="ty-mark">${t.mark}</span>${esc(t.name)}</button>`).join("")}</div>`;
    el.querySelectorAll(".ty-topic").forEach((b) => {
      b.onclick = () => { if (toggle(b.dataset.id)) draw(); };
    });
  };
  draw();
  return draw;
}
