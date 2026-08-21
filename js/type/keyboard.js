/* 화면 자판 — 다음에 누를 자리를 짚어 주고, 손가락으로 눌러 칠 수도 있다.
 *
 * 두 가지 일을 한다.
 *   · 자리를 아직 못 외운 아이에게 다음 자리와 어느 손가락인지 알려 준다
 *   · 진짜 자판이 없는 기기(스마트폰·태블릿)에서 이것이 곧 자판이 된다
 *
 * 두 번째가 거저 얻어진 이유가 있다. 이 게임은 브라우저 한글 조합기를 쓰지 않고
 * '어느 자리를 눌렀나'만 받아서 스스로 글자를 만든다. 그래서 손가락으로 누른 것도
 * 진짜 자판을 누른 것과 똑같은 모양으로 흘려보내면 그만이다 — 아래쪽 화면들은
 * 어느 쪽으로 들어왔는지 알 필요가 없다.
 *
 * 배열은 두 벌이다. 넓은 화면에는 진짜 자판 그대로(15칸)를 그린다. 좁은 화면에는
 * 그게 안 들어간다 — 폰 너비를 15로 나누면 키 하나가 손끝보다 작아진다. 그래서
 * 10칸짜리 배열을 따로 두고, 숫자·기호는 한 겹 뒤로 넘긴다. 폰 자판이 다 그렇게 한다.
 */
import { pairOf, getLayout, keyFor, strokeFor, fingerOf, FINGERS } from "./hangul.js";
import { inject } from "./input.js";

/* 키 하나: [code, 너비, 글자, shift 를 물고 있는 자리인가] */
const k = (code, w, label, shift) => ({ code, w: w || 1, label, shift: !!shift });

/* ── 넓은 화면: 진짜 자판 그대로 ──
 *
 * Tab 과 CapsLock 은 이 게임에서 아무 일도 하지 않지만 그려는 둔다. 이 둘을 빼면
 * 줄이 어긋나 아랫줄이 반 칸씩 밀리는데, 그러면 화면 자판과 손 밑의 자판이 다른
 * 모양이 된다. 자리를 외우는 데 쓰는 그림이니 모양이 같아야 한다. */
const FULL = [[
  k("Backquote"), k("Digit1"), k("Digit2"), k("Digit3"), k("Digit4"), k("Digit5"), k("Digit6"),
  k("Digit7"), k("Digit8"), k("Digit9"), k("Digit0"), k("Minus"), k("Equal"), k("Backspace", 2, "지우기"),
], [
  k("Tab", 1.5, "tab"), k("KeyQ"), k("KeyW"), k("KeyE"), k("KeyR"), k("KeyT"), k("KeyY"), k("KeyU"),
  k("KeyI"), k("KeyO"), k("KeyP"), k("BracketLeft"), k("BracketRight"), k("Backslash", 1.5),
], [
  k("CapsLock", 1.75, "caps"), k("KeyA"), k("KeyS"), k("KeyD"), k("KeyF"), k("KeyG"), k("KeyH"),
  k("KeyJ"), k("KeyK"), k("KeyL"), k("Semicolon"), k("Quote"), k("Enter", 2.25, "줄 바꾸기"),
], [
  k("ShiftLeft", 2.25, "shift"), k("KeyZ"), k("KeyX"), k("KeyC"), k("KeyV"), k("KeyB"), k("KeyN"),
  k("KeyM"), k("Comma"), k("Period"), k("Slash"), k("ShiftRight", 2.75, "shift"),
], [
  k("Space", 8, "사이 띄우기"),
]];

/* ── 좁은 화면: 손가락으로 누르는 10칸 배열 ── */
const COMPACT = [[
  k("KeyQ"), k("KeyW"), k("KeyE"), k("KeyR"), k("KeyT"), k("KeyY"), k("KeyU"), k("KeyI"), k("KeyO"), k("KeyP"),
], [
  k("KeyA"), k("KeyS"), k("KeyD"), k("KeyF"), k("KeyG"), k("KeyH"), k("KeyJ"), k("KeyK"), k("KeyL"),
], [
  k("ShiftLeft", 1.5, "⇧"), k("KeyZ"), k("KeyX"), k("KeyC"), k("KeyV"), k("KeyB"), k("KeyN"), k("KeyM"),
  k("Backspace", 1.5, "⌫"),
], [
  k("Layer", 1.5, "!#1"), k("Comma"), k("Space", 5, "사이 띄우기"), k("Period"), k("Enter", 1.5, "⏎"),
]];

/* 숫자·기호 겹. 아이가 실제로 쓰는 것을 앞줄에 둔다. */
const COMPACT_SYM = [[
  k("Digit1"), k("Digit2"), k("Digit3"), k("Digit4"), k("Digit5"),
  k("Digit6"), k("Digit7"), k("Digit8"), k("Digit9"), k("Digit0"),
], [
  k("Digit1", 1, null, true), k("Slash", 1, null, true), k("Period"), k("Comma"),
  k("Backquote", 1, null, true), k("Minus"), k("Digit9", 1, null, true), k("Digit0", 1, null, true),
  k("Quote", 1, null, true), k("Quote"),
], [
  k("Semicolon", 1, null, true), k("Semicolon"), k("Slash"), k("Equal"), k("Equal", 1, null, true),
  k("BracketLeft"), k("BracketRight"), k("Backslash"), k("Backquote"), k("Backspace", 1, "⌫"),
], [
  k("Layer", 1.5, "글자"), k("Space", 6, "사이 띄우기"), k("Enter", 2.5, "⏎"),
]];

/* 눌러도 아무 일이 없는 자리. 그림을 맞추려고 그려 둘 뿐이다. */
const DEAD = new Set(["Tab", "CapsLock"]);
/* 왼쪽 반에 있는 자리는 오른쪽 shift 로 누른다. 같은 손으로 누르면 손이 꺾인다. */
const LEFT_HALF = new Set(["Backquote", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5",
                           "KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyA", "KeyS", "KeyD", "KeyF", "KeyG",
                           "KeyZ", "KeyX", "KeyC", "KeyV", "KeyB"]);

/** 좁은 화면인가. 진짜 자판 15칸이 들어가지 않는 너비면 10칸 배열로 간다. */
export const isNarrow = () => window.innerWidth < 780;

const state = new WeakMap();          // el → {compact, layer, sticky}
const live = new Set();               // 화면에 떠 있는 자판들 (화면 회전 때 다시 그린다)

function labelOf(key) {
  if (key.label) return key.label;
  const pair = pairOf(key.code);
  if (!pair) return "";
  return pair[key.shift ? 1 : 0];
}

/** 이 자리를 지금 누르면 무슨 글자가 나오는가 (sticky shift 까지 셈에 넣는다) */
function strokeOf(key, sticky) {
  return strokeFor(key.code, key.shift || sticky);
}

/** 컨테이너 안에 자판을 그린다. 여러 번 불러도 된다. */
export function render(el, opts = {}) {
  /* 자판이 화면에 섰다는 것을 알린다. '화면 자판을 눌러 치세요' 안내 상자는
     이 순간부터 자리만 차지한다 — 짧은 폰에서는 그 상자 때문에 정작 자판이
     화면 밖으로 밀려나, 안내하려던 것을 눌러 볼 수조차 없었다. */
  document.dispatchEvent(new CustomEvent("ty-keyboard"));
  const compact = opts.compact ?? isNarrow();
  const prev = state.get(el);
  const st = { compact, layer: prev && prev.compact === compact ? prev.layer : "main",
               sticky: false, last: prev ? prev.last : null };
  state.set(el, st);
  live.add(el);
  paint(el);
}

function rowsFor(st) {
  if (!st.compact) return FULL;
  return st.layer === "sym" ? COMPACT_SYM : COMPACT;
}

function paint(el) {
  const st = state.get(el);
  el.classList.add("ty-kb");
  el.classList.toggle("ty-kb-compact", st.compact);
  el.dataset.layout = getLayout();
  el.innerHTML = rowsFor(st).map((row) => `<div class="ty-kb-row">${row.map((key) => {
    const f = fingerOf(key.code);
    const dead = DEAD.has(key.code);
    const wide = key.label && key.code !== "Layer";
    const cls = ["ty-k",
      dead ? "ty-k-dead" : "",
      key.code === "Layer" ? "ty-k-layer" : "",
      wide ? "ty-k-cmd" : "",
      (key.code === "KeyF" || key.code === "KeyJ") && !st.compact ? "ty-k-home" : "",
      key.code.startsWith("Shift") && st.sticky ? "sticky" : ""].filter(Boolean).join(" ");
    const pair = pairOf(key.code);
    const up = !st.compact && pair && pair[1] !== pair[0] ? `<span class="ty-k-up">${pair[1]}</span>` : "";
    const face = key.label
      ? `<span class="ty-k-main ty-k-word">${key.label}</span>`
      : `${up}<span class="ty-k-main">${labelOf(key)}</span>`;
    const style = `--w:${key.w}${f ? `; --fg:${FINGERS[f].color}` : ""}`;
    return `<div class="${cls}" data-code="${key.code}"${key.shift ? ' data-shift="1"' : ""} style="${style}">${face}</div>`;
  }).join("")}</div>`).join("");

  /* 다시 그리면 짚어 두었던 자리가 지워진다. 겹을 넘기거나 shift 를 누른 직후가
     바로 그 순간인데, 아이는 그때 안내를 가장 필요로 한다 — 되살려 놓는다. */
  applyHighlight(el);
}

/* ── 손가락으로 누르기 ──
 * pointerdown 으로 받는다. click 을 기다리면 한 박자 늦고, 빨리 치는 아이는 그 차이를
 * 바로 느낀다. 기본 동작은 막는다 — 안 막으면 누를 때마다 화면이 밀리고 확대된다. */
document.addEventListener("pointerdown", (e) => {
  const kb = e.target.closest?.(".ty-kb");
  if (!kb || !state.has(kb)) return;
  const el = e.target.closest(".ty-k");
  if (!el) return;
  e.preventDefault();
  press(kb, el);
}, { passive: false });

function press(kb, el) {
  const st = state.get(kb);
  const code = el.dataset.code;
  if (DEAD.has(code)) return;

  el.classList.add("tap");
  setTimeout(() => el.classList.remove("tap"), 120);

  if (code === "Layer") { st.layer = st.layer === "sym" ? "main" : "sym"; st.sticky = false; paint(kb); return; }
  if (code.startsWith("Shift")) { st.sticky = !st.sticky; paint(kb); return; }
  if (code === "Backspace") { inject({ back: true, code }); return; }

  const shift = el.dataset.shift === "1" || st.sticky;
  const stroke = strokeFor(code, shift);
  if (stroke === null) return;
  inject({ stroke, code, shift });
  if (st.sticky) { st.sticky = false; paint(kb); }     // shift 는 한 글자에만 걸린다
}

/* 화면을 돌리거나 창을 줄이면 배열이 바뀌어야 한다 */
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    for (const el of [...live]) {
      if (!el.isConnected) { live.delete(el); continue; }
      const st = state.get(el);
      if (st && st.compact !== isNarrow()) render(el);
    }
  }, 150);
});

const keyEls = (el, code) => el.querySelectorAll(`.ty-k[data-code="${code}"]`);

/**
 * 다음에 누를 자리를 짚는다. null 이면 표시를 지운다.
 * 그 자리가 지금 겹에 없으면(좁은 화면에서 숫자·기호) 겹을 넘기는 자리를 짚어 준다.
 * @returns {string} 손가락 안내 글. 손가락으로 치는 배열에서는 빈 글.
 */
export function highlight(el, stroke) {
  const st = state.get(el);
  if (st) st.last = stroke || null;
  return applyHighlight(el);
}

function applyHighlight(el) {
  el.querySelectorAll(".ty-k.on, .ty-k.on-shift").forEach((n) => n.classList.remove("on", "on-shift"));
  const st = state.get(el);
  if (!st) return "";
  const stroke = st.last;
  if (!stroke) return "";

  /* 지금 겹에서 이 글자를 낼 수 있는 자리를 찾는다. shift 없이 되는 쪽이 먼저다. */
  let hit = null, needShift = false;
  for (const n of el.querySelectorAll(".ty-k[data-code]")) {
    const code = n.dataset.code;
    if (DEAD.has(code) || code === "Layer") continue;
    if (strokeFor(code, n.dataset.shift === "1") === stroke) { hit = n; needShift = false; break; }
    if (!hit && strokeFor(code, true) === stroke) { hit = n; needShift = true; }
  }

  if (!hit) {
    // 다른 겹에 있다 — 넘어가는 자리를 짚어 준다
    keyEls(el, "Layer").forEach((n) => n.classList.add("on"));
    return st.compact ? "" : "";
  }

  hit.classList.add("on");
  if (needShift && !st.sticky) {
    const side = st.compact ? "ShiftLeft" : (LEFT_HALF.has(hit.dataset.code) ? "ShiftRight" : "ShiftLeft");
    keyEls(el, side).forEach((n) => n.classList.add("on-shift"));
  }

  if (st.compact) return "";     // 손가락으로 치는데 '왼손 검지'라고 알려 줄 이유가 없다
  const f = fingerOf(hit.dataset.code);
  if (!f) return "";
  const name = FINGERS[f].name;
  return needShift ? `${name} + 반대쪽 새끼손가락으로 shift` : name;
}

/** 틀린 자리를 잠깐 붉게 흔든다. */
export function flashBad(el, code) {
  keyEls(el, code).forEach((n) => {
    n.classList.remove("bad");
    void n.offsetWidth;          // 애니메이션을 다시 태우려면 한 번 끊어야 한다
    n.classList.add("bad");
    setTimeout(() => n.classList.remove("bad"), 320);
  });
}

/** 범례 — 손가락 색이 무슨 뜻인지. 좁은 화면에서는 뜻이 없어 감춘다. */
export function legend() {
  return `<div class="ty-legend">${["l5", "l4", "l3", "l2", "th"].map((f) =>
    `<span><i style="background:${FINGERS[f].color}"></i>${FINGERS[f].short}손가락</span>`).join("")}</div>`;
}
