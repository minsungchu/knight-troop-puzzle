/* 지금 이 기록이 어디에 남는가 — 화면에 늘 적어 둔다.
 *
 * 혼자 하기도 기록은 계정에 남아야 한다. 그런데 로그인하지 않아도 놀 수 있게 만들어 둔
 * 탓에, 로그인하지 않은 아이는 한참을 올라간 뒤에야 그 기록이 이 브라우저에만 있다는 것을
 * 알게 됐다. 브라우저를 지우거나 다른 기기로 옮기면 그대로 사라진다.
 *
 * 그래서 두 가지를 한다.
 *   · 화면 위에 지금 어디에 저장되는지 늘 적어 둔다 (mount)
 *   · 판을 처음 열 때 한 번, 로그인하고 하자고 권한다 (askOnce)
 *
 * 막을 수는 없다. 서버 설정이 없는 채로도 이 게임은 돌아가야 하고, 계정을 만들지 않고
 * 한 판 해 보는 길도 남겨 둬야 한다. 다만 모르고 지나치게 두지는 않는다.
 */

import { $, esc, veil, hideVeil } from "./ui.js";
import { ONLINE, uid, myName, onAuth } from "./supabase.js";
import { openLogin } from "./auth.js";

/* ══════════════ 늘 보이는 한 줄 ══════════════ */

/**
 * @param host     이 안에 그린다
 * @param sources  [{ src, patch }] — src 는 { state(), retry() } 를 가진 저장 모듈,
 *                 patch 는 그 기록을 맡는 SQL 파일 이름(서버에 없을 때 알려 준다).
 *                 한 화면에 여러 가지가 저장될 수 있어 여럿을 받는다 — 타자 도장은
 *                 별·기록과 쓴 글이 서로 다른 패치에 들어 있다.
 * @param src,patch  하나뿐일 때 쓰는 짧은 꼴
 * @param what     "등반 기록" 처럼, 무엇이 저장되는지 부르는 말
 */
export function mount(host, { sources, src, patch, what }) {
  const el = typeof host === "string" ? $(host) : host;
  if (!el) return;
  const all = sources || [{ src, patch }];

  const draw = () => {
    // 하나라도 막혀 있으면 그것을 말한다 — 잘 되는 쪽을 앞세우면 막힌 쪽이 묻힌다
    const hurt = all.find((x) => !x.src.state().ok);
    const s = hurt ? hurt.src.state() : { ok: true, why: "", pending: 0 };
    const patchOf = hurt ? hurt.patch : "";
    const name = myName();

    if (!ONLINE) {
      el.innerHTML = row("off", "이 컴퓨터에만 남습니다",
        `<code>js/config.js</code> 에 서버를 넣으면 계정에 저장됩니다.`);
      return;
    }
    if (!uid()) {
      el.innerHTML = row("off", `${what}이 이 브라우저에만 남습니다`,
        "로그인하면 계정에 저장되어, 다른 기기에서도 이어서 할 수 있습니다.",
        `<button class="save-do" data-do="login">로그인하고 저장하기</button>`);
      return;
    }
    if (!s.ok) {
      const gone = /PGRST202|Could not find the function|does not exist|schema cache/i.test(s.why || "");
      el.innerHTML = row("bad", `서버에 저장하지 못했습니다${s.pending ? ` (${s.pending}개 기다리는 중)` : ""}`,
        gone ? `서버에 기록 기능이 아직 없습니다 — Supabase SQL Editor 에서 <code>${esc(patchOf)}</code> 을 실행하세요.`
             : esc(s.why || "잠시 뒤에 다시 시도해 보세요."),
        `<button class="save-do" data-do="retry">다시 저장</button>`);
      return;
    }
    el.innerHTML = row("ok", `${esc(name)} 계정에 저장됩니다`, "");
  };

  const row = (kind, say, why, act) =>
    `<div class="save-note ${kind}">
       <span class="save-mark">${kind === "ok" ? "✓" : kind === "bad" ? "!" : "◍"}</span>
       <span class="save-say"><b>${say}</b>${why ? `<i>${why}</i>` : ""}</span>
       ${act || ""}
     </div>`;

  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-do]");
    if (!b) return;
    if (b.dataset.do === "login") openLogin();
    if (b.dataset.do === "retry") {
      b.disabled = true; b.textContent = "저장하는 중…";
      all.forEach((x) => x.src.retry());
    }
  });

  onAuth(draw);                                   // 로그인·로그아웃 때
  document.addEventListener("save-state", draw);  // 저장이 되고 안 되고가 바뀔 때
  draw();
}

/* ══════════════ 판을 처음 열 때 한 번 ══════════════ */

const ASKED = "save-asked:v1";

/* 로그인하지 않았으면 한 번 권한다. 한 번 고르면 이 창을 닫을 때까지 다시 묻지 않는다.
 *
 * 물었으면 true 를 돌려준다. 부르는 쪽은 그때 하던 일을 멈추고, 아이가 고른 뒤에
 * onDone 으로 다시 시작한다 — 그래야 창을 읽는 동안 시계가 돌거나 성으로 적이
 * 걸어오지 않는다. 물을 것이 없으면 false 라 아무것도 달라지지 않는다.
 *
 * @returns {boolean} 창을 띄웠는가
 */
export function askOnce(what, onDone) {
  if (!ONLINE || uid()) return false;
  try {
    if (sessionStorage.getItem(ASKED) === "1") return false;
    sessionStorage.setItem(ASKED, "1");
  } catch { /* 못 남겨도 한 번은 묻는다 */ }

  veil(`<h2>기록을 남길까요?</h2>
    <div class="save-ask">
      <p>지금은 <b>${esc(what)}이 이 브라우저에만</b> 남습니다.
         브라우저 기록을 지우거나 다른 기기에서 열면 처음부터 다시 해야 합니다.</p>
      <p>로그인하면 계정에 저장되어 <b>어디서 열어도 이어서</b> 할 수 있습니다.
         아이디와 비밀번호만 있으면 되고, 이메일은 받지 않습니다.</p>
      <p class="save-ask-note">지금까지 이 브라우저에 남은 기록은 로그인할 때 계정으로 함께 올라갑니다.</p>
    </div>
    <div class="save-ask-act">
      <button id="askGo" class="on">로그인하고 저장하기</button>
      <button id="askNo">그냥 해 보기</button>
    </div>`);
  const go = () => onDone && onDone();
  $("#askNo").onclick = () => { hideVeil(); go(); };
  /* 로그인 창을 그 자리에 이어서 연다. 로그인을 마치든 그만두든, 하던 판은 그 창이
     닫힌 뒤에 시작한다 — 로그인하는 동안 시계가 돌면 안 되는 것은 여기도 같다.
     로그인을 마쳤다면 그동안 기록까지 계정으로 올라간 상태에서 시작하게 된다. */
  $("#askGo").onclick = () => { hideVeil(); openLogin(); afterVeil(go); };
  return true;
}

/** 지금 떠 있는 창이 닫히면 한 번 부른다. 떠 있는 창이 없으면 곧바로 부른다. */
function afterVeil(fn) {
  const v = $("#veil");
  if (!v || !v.classList.contains("show")) { fn(); return; }
  const watch = new MutationObserver(() => {
    if (v.classList.contains("show")) return;
    watch.disconnect();
    fn();
  });
  watch.observe(v, { attributes: true, attributeFilter: ["class"] });
}
