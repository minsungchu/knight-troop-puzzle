/* 화면 키보드 — 다음에 누를 자리와 어느 손가락인지 짚어 준다.
 *
 * 자리를 외우기 전까지는 이게 전부다. 아이가 자판을 내려다보는 대신 화면을 보게
 * 만드는 것이 목표라, 다음 자리는 크게 빛나고 손가락은 색으로 구분한다.
 * shift 가 필요한 자리는 반대쪽 손 새끼손가락의 shift 도 함께 빛난다.
 */
import { KEYMAP, SYMBOLS, keyFor, fingerOf, FINGERS } from "./hangul.js";

/* 실제 자판 그대로다.
 *
 * 자리 익히기만 생각하면 가운데 세 줄이면 충분했다. 글쓰기를 붙이면서 숫자줄과
 * 기호 자리가 필요해졌다 — 아이가 느낌표를 칠 차례인데 화면이 아무 데도 짚어 주지
 * 못하면, 그 자리에서 글이 끊긴다.
 *
 * Tab 과 CapsLock 은 이 게임에서 아무 일도 하지 않지만 그려는 둔다. 이 두 자리를
 * 빼면 줄이 어긋나 아랫줄이 반 칸씩 밀리는데, 그러면 화면 자판과 손 밑의 자판이
 * 다른 모양이 되어 버린다. 자리를 외우는 데 쓰는 그림이니 모양이 같아야 한다.
 *
 * w 는 키 너비 배수다. 실제 자판의 비율을 그대로 쓴다. */
const ROWS = [
  [["Backquote"], ["Digit1"], ["Digit2"], ["Digit3"], ["Digit4"], ["Digit5"], ["Digit6"],
   ["Digit7"], ["Digit8"], ["Digit9"], ["Digit0"], ["Minus"], ["Equal"], ["Backspace", 2, "지우기"]],
  [["Tab", 1.5, "tab"], ["KeyQ"], ["KeyW"], ["KeyE"], ["KeyR"], ["KeyT"], ["KeyY"], ["KeyU"],
   ["KeyI"], ["KeyO"], ["KeyP"], ["BracketLeft"], ["BracketRight"], ["Backslash", 1.5]],
  [["CapsLock", 1.75, "caps"], ["KeyA"], ["KeyS"], ["KeyD"], ["KeyF"], ["KeyG"], ["KeyH"],
   ["KeyJ"], ["KeyK"], ["KeyL"], ["Semicolon"], ["Quote"], ["Enter", 2.25, "줄 바꾸기"]],
  [["ShiftLeft", 2.25, "shift"], ["KeyZ"], ["KeyX"], ["KeyC"], ["KeyV"], ["KeyB"], ["KeyN"],
   ["KeyM"], ["Comma"], ["Period"], ["Slash"], ["ShiftRight", 2.75, "shift"]],
  [["Space", 8, "사이 띄우기"]],
];

/* 눌러도 아무 일이 없는 자리. 그림을 맞추려고 그려 둘 뿐이다. */
const DEAD = new Set(["Tab", "CapsLock"]);
/* 왼쪽 반에 있는 자리는 오른쪽 shift 로 누른다. 같은 손으로 누르면 손이 꺾인다. */
const LEFT_HALF = new Set(["Backquote", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5",
                           "KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyA", "KeyS", "KeyD", "KeyF", "KeyG",
                           "KeyZ", "KeyX", "KeyC", "KeyV", "KeyB"]);

/** 컨테이너 안에 자판을 그린다. 한 번만 부르면 된다. */
export function render(el) {
  el.classList.add("ty-kb");
  el.innerHTML = ROWS.map((row) => `<div class="ty-kb-row">${row.map(([code, w, label]) => {
    const f = fingerOf(code);
    const style = `style="--w:${w || 1}${f ? `; --fg:${FINGERS[f].color}` : ""}"`;
    const cls = "ty-k" + (DEAD.has(code) ? " ty-k-dead" : "") +
                (code === "KeyF" || code === "KeyJ" ? " ty-k-home" : "");
    const pair = KEYMAP[code] || SYMBOLS[code];
    const face = label
      ? `<span class="ty-k-main ty-k-word">${label}</span>`
      : (pair[1] !== pair[0] ? `<span class="ty-k-up">${pair[1]}</span>` : "") +
        `<span class="ty-k-main">${pair[0]}</span>`;
    return `<div class="${cls}" data-code="${code}" ${style}>${face}</div>`;
  }).join("")}</div>`).join("");
}

const keyEls = (el, code) => el.querySelectorAll(`.ty-k[data-code="${code}"]`);

/** 다음에 누를 스트로크를 짚는다. null 이면 표시를 지운다.
 *  @returns {string} 손가락 안내 글 ("오른손 검지" 따위) */
export function highlight(el, stroke) {
  el.querySelectorAll(".ty-k.on, .ty-k.on-shift").forEach((k) => k.classList.remove("on", "on-shift"));
  if (!stroke) return "";
  const k = keyFor(stroke);
  if (!k) return "";
  keyEls(el, k.code).forEach((n) => n.classList.add("on"));
  if (k.shift) {
    const side = LEFT_HALF.has(k.code) ? "ShiftRight" : "ShiftLeft";
    keyEls(el, side).forEach((n) => n.classList.add("on-shift"));
  }
  const f = fingerOf(k.code);
  if (!f) return "";
  const name = FINGERS[f].name;
  return k.shift ? `${name} + 반대쪽 새끼손가락으로 shift` : name;
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

/** 범례 — 손가락 색이 무슨 뜻인지.
 *  왼손과 오른손이 색을 나눠 쓰므로 다섯 줄이면 끝난다. */
export function legend() {
  return `<div class="ty-legend">${["l5", "l4", "l3", "l2", "th"].map((f) =>
    `<span><i style="background:${FINGERS[f].color}"></i>${FINGERS[f].short === "엄지" ? "엄지" : FINGERS[f].short}손가락</span>`).join("")}</div>`;
}
