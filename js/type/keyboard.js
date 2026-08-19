/* 화면 키보드 — 다음에 누를 자리와 어느 손가락인지 짚어 준다.
 *
 * 자리를 외우기 전까지는 이게 전부다. 아이가 자판을 내려다보는 대신 화면을 보게
 * 만드는 것이 목표라, 다음 자리는 크게 빛나고 손가락은 색으로 구분한다.
 * shift 가 필요한 자리는 반대쪽 손 새끼손가락의 shift 도 함께 빛난다.
 */
import { KEYMAP, keyFor, fingerOf, FINGERS } from "./hangul.js";

const ROWS = [
  ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP"],
  ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL"],
  ["ShiftLeft", "KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM", "Comma", "Period", "Slash", "ShiftRight"],
  ["Space"],
];
const WIDE = { ShiftLeft: "shift", ShiftRight: "shift", Space: "space" };
/* 한글 자리가 아니라 자판에는 있어야 하는 자리. 이게 없으면 마침표를 칠 차례에
   화면이 아무 데도 짚어 주지 못한다 — 아이는 어디를 눌러야 할지 알 길이 없다. */
const EXTRA = { Comma: [",", "<"], Period: [".", ">"], Slash: ["/", "?"] };
/* 왼쪽 반에 있는 자리는 오른쪽 shift 로 누른다. 같은 손으로 누르면 손이 꺾인다. */
const LEFT_HALF = new Set(["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyA", "KeyS", "KeyD", "KeyF", "KeyG",
                           "KeyZ", "KeyX", "KeyC", "KeyV", "KeyB"]);

/** 컨테이너 안에 자판을 그린다. 한 번만 부르면 된다. */
export function render(el) {
  el.classList.add("ty-kb");
  el.innerHTML = ROWS.map((row) => `<div class="ty-kb-row">${row.map((code) => {
    const pair = KEYMAP[code] || EXTRA[code];
    const f = fingerOf(code);
    const style = f ? ` style="--fg:${FINGERS[f].color}"` : "";
    const wide = WIDE[code] ? ` ty-k-${WIDE[code]}` : "";
    const home = code === "KeyF" || code === "KeyJ" ? " ty-k-home" : "";
    let face;
    if (code === "Space") face = `<span class="ty-k-main">사이 띄우기</span>`;
    else if (WIDE[code] === "shift") face = `<span class="ty-k-main">shift</span>`;
    else {
      const [plain, shifted] = pair || ["", ""];
      face = (shifted !== plain ? `<span class="ty-k-up">${shifted}</span>` : "") +
             `<span class="ty-k-main">${plain}</span>`;
    }
    return `<div class="ty-k${wide}${home}" data-code="${code}"${style}>${face}</div>`;
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
