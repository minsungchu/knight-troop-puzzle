/* 키를 직접 받는다.
 *
 * 글자 입력칸에 포커스를 주지 않는 것이 핵심이다. 입력칸이 없으면 브라우저의 한글
 * 조합기가 끼어들지 않고, 우리가 e.code(자판 위 물리적 자리)를 그대로 읽을 수 있다.
 * 그래서 아이의 컴퓨터가 영문 상태든 한글 상태든 똑같이 동작한다.
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

/** 물리 키보드가 있을 만한 기기인가. 없으면 안내를 띄운다. */
export const looksLikeTouchOnly = () =>
  window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(any-hover: hover)").matches;
