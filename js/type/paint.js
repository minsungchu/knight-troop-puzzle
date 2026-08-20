/* 치는 중인 글월을 글자 칸으로 그린다. 연습 화면과 게임이 함께 쓴다.
 *
 * 칸 하나에는 목표 글자가 작게 위에 붙고, 그 아래에 지금까지 조합된 모습이 뜬다.
 * '값'을 칠 때 ㄱ→ㅏ 를 누르면 칸에 '가'가 보이고 위에는 '값'이 그대로 남는다.
 * 어디로 가는 중인지와 어디까지 왔는지를 한 칸에서 같이 보여 주려는 것이다. */
import { esc } from "../ui.js";

export function lineHTML(run, bad) {
  const v = run.view();
  const chars = [...run.text];
  const at = [...v.hit].length;
  return chars.map((ch, i) => {
    const cls = i < at ? "hit" : i === at ? "cur" : "rest";
    const shown = i === at && v.cur ? v.cur : ch;
    const goal = i === at && v.cur && v.cur !== ch ? `<i class="ty-goal">${esc(ch)}</i>` : "";
    return `<span class="ty-ch ${cls}${ch === " " ? " sp" : ""}${bad && i === at ? " bad" : ""}">` +
           `${goal}<b>${ch === " " ? "&nbsp;" : esc(shown)}</b></span>`;
  }).join("");
}
