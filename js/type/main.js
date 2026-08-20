/* 타자 도장 진입점 */
import { $, $$, showTab, onTab, toast } from "../ui.js";
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
import { looksLikeTouchOnly } from "./input.js";

$$(".tab[data-tab]").forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });

Sfx.listenForGesture();
Auth.init();
Progress.load();
Writings.load();

/* 탭을 옮기면 치던 판을 접는다. 키를 받는 곳이 둘이 되면 안 된다. */
onTab(() => { Practice.home(); Words.home(); Write.home(); Castle.home(); Duel.home(); });

/* 이 게임은 자판을 직접 읽는다 — 화면 키보드로는 놀 수 없다.
   되지도 않는데 이유를 모른 채 두드리게 하는 것이 가장 나쁘다. */
if (looksLikeTouchOnly()) {
  $("#tyNeedKeyboard").hidden = false;
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
