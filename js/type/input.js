/* 입력을 한 곳으로 모은다.
 *
 * 글자 입력칸에 포커스를 주지 않는 것이 핵심이다. 입력칸이 없으면 브라우저의 한글
 * 조합기가 끼어들지 않고, 우리가 e.code(자판 위 물리적 자리)를 그대로 읽을 수 있다.
 * 그래서 아이의 컴퓨터가 영문 상태든 한글 상태든 똑같이 동작한다.
 *
 * 들어오는 길은 둘이다 — 진짜 자판의 keydown, 그리고 화면 자판을 손가락으로 누른 것.
 * 둘 다 여기서 같은 모양({stroke, code, shift} 또는 {back:true})으로 바뀌므로,
 * 이 아래(연습·게임·글쓰기·대결)는 어느 쪽으로 들어왔는지 알 필요가 없다.
 * 화면 자판을 만들어 둔 덕에 터치 지원이 자판 하나를 누를 수 있게 만드는 일로 끝났다.
 */
import { isVeilOpen } from "../ui.js";
import { strokeFor } from "./hangul.js";

let handler = null;

/** 지금 키를 받을 곳을 정한다. null 을 주면 아무도 안 받는다. */
export function capture(fn) { handler = fn || null; }

document.addEventListener("keydown", (e) => {
  if (!handler || isVeilOpen()) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;              // 단축키는 건드리지 않는다
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

  if (e.code === "Backspace") { e.preventDefault(); handler({ back: true, code: e.code }); return; }

  const stroke = strokeFor(e.code, e.shiftKey);
  if (stroke === null) return;
  e.preventDefault();          // 스페이스로 화면이 내려가지 않게
  handler({ stroke, code: e.code, shift: e.shiftKey });
});

/** 화면 자판을 눌렀을 때. 진짜 자판을 누른 것과 똑같이 흘려보낸다. */
export function inject(ev) {
  if (!handler || isVeilOpen()) return false;
  handler(ev);
  return true;
}

/** 손가락으로 만지는 기기인가. 안내 문구를 고르는 데만 쓴다. */
export const isTouch = () =>
  window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(any-hover: hover)").matches;
