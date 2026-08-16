/* 레이저 미로 진입점 */
import { $$, showTab } from "../ui.js";
import * as Auth from "../auth.js";
import * as Sfx from "../sound.js";
import * as Solo from "./solo.js";

$$(".tab[data-tab]").forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });

/* 브라우저는 사용자가 화면을 건드리기 전에는 소리를 못 내게 막는다.
   한 번만 시도하면 놓치므로 살아날 때까지 조작마다 다시 깨운다. */
Sfx.listenForGesture();

Auth.init();
Solo.bind();
Solo.init();

// 로그인하면 서버 진행과 합쳐지므로 지도를 다시 그린다
document.addEventListener("laser-progress", () => Solo.refresh());
