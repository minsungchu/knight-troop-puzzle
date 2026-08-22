/* 레이저 미로 진입점 */
import { $$, showTab, onTab } from "../ui.js";
import * as Auth from "../auth.js";
import * as Sfx from "../sound.js";
import * as Solo from "./solo.js";
import * as Versus from "./versus.js";
import * as Rank from "./rank.js";
import * as Progress from "./progress.js";
import * as Saving from "../saving.js";

$$(".tab[data-tab]").forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });

/* 브라우저는 사용자가 화면을 건드리기 전에는 소리를 못 내게 막는다.
   한 번만 시도하면 놓치므로 살아날 때까지 조작마다 다시 깨운다. */
Sfx.listenForGesture();

Auth.init();
/* 혼자 하기도 기록은 계정에 남아야 한다. 지금 어디에 남는지 화면 위에 적어 둔다. */
Saving.mount("#saveNote", {
  src: Progress, patch: "supabase/patch-02-laser.sql", what: "등반 기록",
});
Solo.bind();
Solo.init();
Versus.init();
Rank.init();

// 급수 탭은 열 때 불러온다 — 안 보는 화면을 미리 채울 이유가 없다
onTab((name) => { if (name === "rank") Rank.render(); });

// 로그인하면 서버 진행과 합쳐지므로 지도를 다시 그린다
document.addEventListener("laser-progress", () => Solo.refresh());
