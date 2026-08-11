/* 진입점 — 모듈을 잇고 첫 판을 띄운다 */
import { $$, showTab } from "./ui.js";
import { Game, restoreSolo } from "./game.js";
import * as Auth from "./auth.js";
import * as Rank from "./rank.js";
import * as Room from "./room.js";

$$(".tab").forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });

Game.init();
Auth.init();
Rank.init();
Room.init();

// 완주 기록 등록은 랭킹 모듈이 맡는다 (대전 기록도 같은 경로로 올라간다)
Game.on("win", Rank.onWin);

if (!restoreSolo()) Game.newGame(8, 8, 2);
