/* 진입점 — 모듈을 잇고 첫 판을 띄운다 */
import { $, $$, showTab } from "./ui.js";
import { Game, restoreSolo } from "./game.js";
import * as Auth from "./auth.js";
import * as Rank from "./rank.js";
import * as Room from "./room.js";
import * as Sfx from "./sound.js";

$$(".tab").forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });

/* 소리 — 브라우저는 사용자가 화면을 건드리기 전에는 소리를 못 내게 막는다.
   첫 조작에서 한 번만 깨우고 그 뒤로는 신경 쓰지 않는다. */
const wake = () => Sfx.wake();
["pointerdown", "keydown"].forEach((e) =>
  window.addEventListener(e, wake, { once: true, capture: true }));

const soundBox = $("#optSound");
soundBox.checked = !Sfx.isMuted();
soundBox.addEventListener("change", () => {
  Sfx.wake();
  Sfx.setMuted(!soundBox.checked);
  if (soundBox.checked) Sfx.select();      // 켠 것을 귀로 확인시켜 준다
});

Game.init();
Auth.init();
Rank.init();
Room.init();

// 완주 기록 등록은 랭킹 모듈이 맡는다 (대전 기록도 같은 경로로 올라간다)
Game.on("win", Rank.onWin);

if (!restoreSolo()) Game.newGame(8, 8, 2);
