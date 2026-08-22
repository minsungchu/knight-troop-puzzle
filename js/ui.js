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
  card.scrollTop = 0;
  /* 첫 칸으로 초점을 옮기되 화면은 건드리지 않는다. 긴 대화상자에서는 첫 단추가 맨 아래에
     있을 수 있는데, 그냥 focus() 하면 브라우저가 거기까지 스크롤해 제목이 잘려 나간다. */
  const first = card.querySelector("input, button");
  if (first) setTimeout(() => first.focus({ preventScroll: true }), 30);
  return card;
}

export function hideVeil() {
  $("#veil").classList.remove("show");
  veilOpen = false;
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && veilOpen && !$("#veil").dataset.locked) hideVeil();
});

/* ── 조용히 죽지 않게 ──
   어딘가에서 붙잡히지 않은 오류가 나면 그 뒤의 코드가 통째로 멈춘다. 화면은 멀쩡한데
   무엇을 눌러도 아무 일이 없는 상태가 되고, 그것을 보는 사람에게는 원인을 찾을 실마리가
   하나도 없다. 콘솔은 폰에서 열 수도 없다. 무슨 일이 났는지 화면으로 말한다. */
const said = new Set();
function surface(what, err) {
  const msg = (err && (err.message || err.reason?.message || err.reason)) || err || "알 수 없는 오류";
  const key = String(msg).slice(0, 120);
  if (said.has(key)) return;               // 같은 오류로 화면을 도배하지 않는다
  said.add(key);
  console.error(what, err);
  toast(`문제가 생겼습니다 — ${key}`);
}
window.addEventListener("error", (e) => surface("error", e.error || e.message));
window.addEventListener("unhandledrejection", (e) => surface("unhandledrejection", e.reason));

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

/* ── 저장소 ──
   Store    : localStorage — 기기 단위. 풀던 판·기록 같은 것.
   TabStore : sessionStorage — 탭 단위. 새로고침에는 남고 새 탭에는 안 따라간다.
              '한 계정 동시접속 1곳'의 '1곳'을 탭으로 세기 위해 쓴다. */
function makeStore(pick) {
  const mem = {};
  return {
    get(k) { try { return pick().getItem(k); } catch { return mem[k] ?? null; } },
    set(k, v) { try { pick().setItem(k, v); } catch { mem[k] = v; } },
    del(k) { try { pick().removeItem(k); } catch { delete mem[k]; } },
  };
}

export const Store = makeStore(() => window.localStorage);
export const TabStore = makeStore(() => window.sessionStorage);

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
