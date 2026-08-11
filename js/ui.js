/* 공통 UI — 선택자 · 토스트 · 오버레이 · 탭 · 저장소 · 시간 포맷 */

export const $ = (s, root) => (root || document).querySelector(s);
export const $$ = (s, root) => Array.from((root || document).querySelectorAll(s));

/** HTML 문자열에 넣기 전에 사용자 입력을 이스케이프 */
export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/* ── 토스트 ── */
let toastTimer = null;
export function toast(msg) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

/* ── 오버레이 ──
   veil 이 열려 있는 동안에는 판의 키보드 조작을 막아야 하므로 상태를 공개한다. */
let veilOpen = false;
export const isVeilOpen = () => veilOpen;

export function veil(html, opts) {
  const card = $("#card");
  card.className = "card" + (opts && opts.wide ? " wide" : "");
  card.innerHTML = html;
  $("#veil").classList.add("show");
  veilOpen = true;
  const first = card.querySelector("input, button");
  if (first) setTimeout(() => first.focus(), 30);
  return card;
}

export function hideVeil() {
  $("#veil").classList.remove("show");
  veilOpen = false;
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && veilOpen && !$("#veil").dataset.locked) hideVeil();
});

/* ── 탭 ── */
const tabListeners = [];
export const onTab = (fn) => tabListeners.push(fn);

export function showTab(name) {
  $$(".view").forEach((v) => { v.hidden = v.dataset.view !== name; });
  $$(".tab").forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  tabListeners.forEach((fn) => fn(name));
}

export const currentTab = () => ($(".tab.on") || {}).dataset?.tab || "game";

/* ── 저장소: localStorage → 메모리 ── */
const mem = {};
export const Store = {
  get(k) {
    try { return window.localStorage.getItem(k); } catch { return mem[k] ?? null; }
  },
  set(k, v) {
    try { window.localStorage.setItem(k, v); } catch { mem[k] = v; }
  },
  del(k) {
    try { window.localStorage.removeItem(k); } catch { delete mem[k]; }
  },
};

/* ── 시간 ── */
/** 밀리초 → "분:초" */
export function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return ((s / 60) | 0) + ":" + String(s % 60).padStart(2, "0");
}

/** 밀리초 → "분:초.십분의일초" (랭킹 표시용) */
export function fmtPrecise(ms) {
  const s = Math.floor(ms / 1000);
  return ((s / 60) | 0) + ":" + String(s % 60).padStart(2, "0") + "." + String(Math.floor((ms % 1000) / 100));
}

/** ISO 문자열 → "2026-08-12 14:22" */
export function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
