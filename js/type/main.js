/* 타자 도장 진입점 */
import { $, $$, showTab, onTab, toast, Store } from "../ui.js";
import * as Auth from "../auth.js";
import * as Sfx from "../sound.js";
import * as Topics from "./topics.js";
import * as Texts from "./texts.js";
import * as Progress from "./progress.js";
import * as Writings from "./writings.js";
import * as Practice from "./practice.js";
import * as Words from "./words.js";
import * as Write from "./write.js";
import * as Castle from "./castle.js";
import * as Duel from "./duel.js";
import { isTouch } from "./input.js";

$$(".tab[data-tab]").forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });

Sfx.listenForGesture();
Auth.init();
Progress.load();
Writings.load();

/* 탭을 옮기면 치던 판을 접는다. 키를 받는 곳이 둘이 되면 안 된다. */
onTab(() => { Practice.home(); Words.home(); Write.home(); Castle.home(); Duel.home(); });

/* 자판이 없는 기기에서는 화면 자판이 곧 자판이다. 처음 열었을 때 그걸 모르면
   아이는 아무 데나 두드리다 만다 — 한 번 알려 주고, 알겠다고 하면 다시 안 띄운다.
   좁은 화면에서 이 상자가 계속 자리를 차지하면 정작 자판이 화면 밖으로 밀린다. */
const TIP = "type-touch-tip:v1";
if (isTouch() && Store.get(TIP) !== "1") {
  const box = $("#tyNeedKeyboard");
  box.hidden = false;
  $("#tyTipOk").onclick = () => { box.hidden = true; Store.set(TIP, "1"); };
}

Promise.all([Topics.load(), Texts.load()]).then(() => {
  Practice.init(); Practice.drawMap();
  Words.init();    Words.draw();
  Write.init();    Write.draw();
  Castle.init();   Castle.draw();
  Duel.init();
}).catch((e) => {
  console.error(e);
  toast("낱말과 지문을 불러오지 못했습니다. 새로고침해 보세요.");
});
