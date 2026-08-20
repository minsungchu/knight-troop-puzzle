/* 자유 작문 판 — 아이가 스스로 글을 쓴다.
 *
 * 연습·게임과 규칙이 하나 다르다. 거기서는 목표 글자가 있어서 틀린 자리를 막을 수
 * 있었지만, 여기서는 무엇을 쓸지 아이가 정하므로 맞고 틀림이 없다. 누른 대로 나온다.
 *
 * 그래서 입력칸도 다르게 만들었다. textarea 를 쓰면 브라우저 한글 조합기가 끼어들어
 * 이 게임의 다른 화면과 손맛이 달라지고, 한/영 상태에 따라 영어가 튀어나온다.
 * 우리 조합기를 그대로 쓰되, 글은 **끝에서만** 쓰고 지운다 — 가운데를 고치는 편집은
 * 커서 옮기기·선택·잘라내기까지 딸려 오는데, 이제 자판을 외우는 아이에게는
 * 그 전부가 방해다. 지우고 다시 쓰면 된다.
 */
import { compose, strokesOf } from "./hangul.js";

export function createComposer(el, opts = {}) {
  let strokes = [];

  const text = () => compose(strokes);
  /** 공백과 줄바꿈을 뺀 글자 수 — 아이에게 보여 줄 '몇 자 썼나' */
  const chars = () => text().replace(/\s/g, "").length;

  function paint() {
    const t = text();
    el.innerHTML = `<span class="ty-w-text"></span><span class="ty-caret"></span>`;
    el.firstChild.textContent = t;
    el.scrollTop = el.scrollHeight;
    opts.onChange && opts.onChange({ text: t, chars: chars() });
  }

  paint();

  return {
    text, chars,
    /** 저장해 둔 글을 다시 불러온다. 글자를 낱자로 되풀어 이어 쓸 수 있게 한다. */
    setText(t) { strokes = strokesOf(t || ""); paint(); },
    clear() { strokes = []; paint(); },
    /** 입력 하나를 받는다. input.js 가 주는 모양 그대로. */
    handle(ev) {
      if (ev.back) { if (!strokes.length) return false; strokes.pop(); paint(); return true; }
      if (ev.stroke == null) return false;
      strokes.push(ev.stroke);
      paint();
      return true;
    },
  };
}
