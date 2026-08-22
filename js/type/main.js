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
import * as Lang from "./lang.js";
import * as Duel from "./duel.js";
import * as Saving from "../saving.js";
import { isTouch } from "./input.js";

$$(".tab[data-tab]").forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });

Sfx.listenForGesture();
Auth.init();
/* 혼자 하는 익히기·낱말·성 지키기도 기록은 계정에 남아야 한다. 지금 어디에 남는지 적어 둔다. */
Saving.mount("#saveNote", {
  sources: [
    { src: Progress, patch: "supabase/patch-04-type.sql" },
    { src: Writings, patch: "supabase/patch-05-type-write-duel.sql" },
  ],
  what: "별·기록과 쓴 글",
});
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
  const done = () => { box.hidden = true; Store.set(TIP, "1"); };
  $("#tyTipOk").onclick = done;
  /* 화면 자판을 한 번 누르면 그걸로 안 것이다. 읽었다고 눌러 주기를 기다리면
     상자가 계속 자리를 차지하고, 짧은 화면에서는 그만큼 자판이 아래로 밀린다. */
  document.addEventListener("pointerdown", (e) => {
    if (e.target.closest && e.target.closest(".ty-k")) done();
  }, { capture: true });
  // 자판이 화면에 서면 안내는 제 몫을 다했다. 눈앞에 있는 것을 더 설명할 이유가 없다.
  document.addEventListener("ty-keyboard", done);
}

Promise.all([Topics.load(), Texts.load(), Lang.load()]).then(() => {
  Practice.init(); Practice.drawMap();
  Words.init();    Words.draw();
  Write.init();    Write.draw();
  Castle.init();   Castle.draw();
  Duel.init();
}).catch((e) => {
  console.error(e);
  toast("낱말과 지문을 불러오지 못했습니다. 새로고침해 보세요.");
});
