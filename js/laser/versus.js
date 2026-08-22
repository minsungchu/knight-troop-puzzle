/* 대전 — 방을 만들고, 상/중/하 판을 이어서 풀고, 먼저 다 깬 쪽이 이긴다.
 *
 * 판은 그때 만들지 않는다. 어려운 판은 하나에 수 초가 걸려서, 방을 시작할 때
 * 기다리게 할 수 없다. 미리 구워 둔 data/laser-versus.json 에서 무작위로 뽑고,
 * 뽑은 결과를 서버에 못박아 모두가 같은 판을 보게 한다.
 *
 * 솔로에 나온 판은 그 묶음에서 빠져 있다 — 등반에서 이미 푼 판이 나오면 그 사람만
 * 유리해진다.
 */

import { $, esc, toast, veil, hideVeil } from "../ui.js";
import { client, ONLINE, uid, myName, onAuth } from "../supabase.js";
import { openLogin } from "../auth.js";
import { LaserBoard } from "./board.js";
import { gradeName, BASE } from "./rating.js";
import * as Sfx from "../sound.js";

let sets = null;          // { low:[], mid:[], high:[] }
let room = null;          // 지금 들어와 있는 방 상태
let channel = null;
let board = null;
let boards = [];          // 이 대전에서 풀 판들
let idx = 0;              // 몇 번째 판을 풀고 있나
let startedAt = 0;
let poll = null;
let myRating = BASE;
let playing = false;      // 판을 붙잡고 있는 중인가 — 대전 화면을 두 번 세우지 않으려고 둔다
let deltas = null;        // 서버가 돌려준 점수 증감 (먼저 끝낸 사람만 받는다)
let shown = false;        // 결과를 이미 띄웠나

const TIER = { low: "하", mid: "중", high: "상" };

/* ══════════════ 무엇이 잘못됐는지 말해 준다 ══════════════

   대전이 안 될 때 사람이 볼 수 있던 것은 서버가 뱉은 영어 한 줄뿐이었다.
   막히는 이유는 사실 몇 가지뿐이고, 어느 쪽인지 알면 고치는 법도 한 줄이다.   */

const PATCH = "supabase/patch-03-laser-versus.sql";
const PATCH6 = "supabase/patch-06-laser-versus-result.sql";

/** 서버가 그 함수를 아직 모르는가 — 패치를 안 돌린 것이다. */
const isMissing = (e) => {
  const m = `${e?.code || ""} ${e?.message || ""} ${e?.hint || ""}`;
  return /PGRST202|Could not find the function|does not exist|schema cache/i.test(m);
};

/** 사람이 읽을 수 있는 말로 바꾼다. 서버가 이미 한국어로 말했으면 그대로 둔다. */
function explain(e, fallback) {
  if (!e) return fallback;
  if (isMissing(e)) return `서버에 대전 기능이 아직 없습니다. Supabase SQL Editor 에서 ${PATCH} 을 실행하세요.`;
  const m = e.message || "";
  if (/JWT|api key|Invalid.*key/i.test(m)) return "서버 열쇠가 맞지 않습니다. js/config.js 의 값을 다시 확인하세요.";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "서버에 닿지 못했습니다. 인터넷 연결을 확인하세요.";
  if (/[가-힣]/.test(m)) return m;              // 서버가 한국어로 이유를 말해 줬다
  return fallback + (m ? ` (${m})` : "");
}

/** 패치를 안 돌렸을 때 무엇을 실행해야 하는지 — 여러 곳에서 같은 말을 한다. */
const patchList = () => `<ol class="lz-fix">
    <li><code>${PATCH}</code> — 방과 급수</li>
    <li><code>${PATCH6}</code> — 결과 남기기·한 판 더</li>
  </ol>
  <p>Supabase 대시보드 → <b>SQL Editor</b> 에서 차례로 한 번씩 실행하세요.
     여러 번 실행해도 안전합니다.</p>`;

/* 서버와 말하는 곳은 여기 하나다.
 *
 * 대답이 없으면 영원히 기다리지 않는다. 예전에는 요청이 걸린 채로 멈추면 눌린 단추가
 * 눌린 그대로 굳어, 화면이 죽은 것처럼 보였다 — 무엇을 눌러도 아무 일도 일어나지 않고
 * 왜 그런지도 알 수 없었다. 열두 셈을 세고도 답이 없으면 그 사실을 말한다.
 *
 * 열쇠 꾸러미를 가져오는 일(client())까지 함께 센다. 그 꾸러미는 인터넷에서 받아 오므로,
 * 막힌 망에서는 서버에 닿기도 전에 여기서 멈출 수 있다. */
const TIMEOUT = 12000;

function inTime(work) {
  let timer;
  const late = new Promise((_, no) => {
    timer = setTimeout(() => no(new Error(
      "서버가 12초 안에 답하지 않았습니다. 인터넷 연결이나 Supabase 프로젝트 상태를 확인하세요.")), TIMEOUT);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

async function call(fn, args) {
  const { data, error } = await inTime((async () => (await client()).rpc(fn, args))());
  if (error) throw error;
  return data;
}

/** 표를 읽는다. 함수와 같은 시간 제한을 받는다. */
async function read(table) {
  const { data, error } = await inTime((async () => (await client()).from(table).select("*"))());
  if (error) throw error;
  return data || [];
}

/** 막힌 이유를 화면 한복판에 설명한다. */
function blocked(title, body, retry) {
  $("#vsBody").innerHTML =
    `<div class="panel lz-blocked">
       <h2>${esc(title)}</h2>
       ${body}
       ${retry ? `<div class="lz-bar" style="margin-top:12px"><button id="vsRetry" class="on">다시 확인</button></div>` : ""}
     </div>`;
  const r = $("#vsRetry");
  if (r) r.onclick = () => renderLobby();
}

export async function init() {
  onAuth(() => { renderLobby(); loadRating(); });
  try {
    const res = await fetch("data/laser-versus.json");
    if (res.ok) sets = await res.json();
  } catch { /* 목록 화면에서 알린다 */ }
  renderLobby();
}

async function loadRating() {
  if (!ONLINE || !uid()) { myRating = BASE; return; }
  try {
    const data = await call("laser_my_rating");
    if (data) { myRating = data.rating; paintRating(data); }
  } catch { /* 급수는 없어도 대전은 된다 */ }
}

function paintRating(d) {
  const el = $("#vsRating");
  if (!el) return;
  const played = (d.wins || 0) + (d.losses || 0);
  el.innerHTML =
    `<span class="lz-grade-name">${gradeName(d.rating)}</span>
     <span class="lz-grade-pt">${d.rating}점</span>` +
    (played ? `<span class="lz-grade-rec">${d.wins}승 ${d.losses}패</span>`
            : `<span class="lz-grade-rec">아직 대전 기록이 없습니다</span>`);
}

/* ══════════════ 로비 ══════════════ */

export async function renderLobby() {
  if (room) return;
  const body = $("#vsBody");
  if (!body) return;

  if (!ONLINE) {
    blocked("대전은 온라인 설정이 있어야 합니다", `<div class="hint">
      <code>js/config.js</code> 에 Supabase 주소와 anon 열쇠를 넣으면 켜집니다.
      혼자 하기(등반)는 설정 없이도 됩니다.</div>`);
    return;
  }
  if (!uid()) {
    blocked("대전은 로그인해야 할 수 있습니다", `<div class="hint">
      아이디만 있으면 됩니다 — 이메일은 받지 않습니다.</div>
      <div class="lz-bar" style="margin-top:12px"><button id="vsLogin" class="on">로그인하기</button></div>`);
    const b = $("#vsLogin");
    if (b) b.onclick = () => openLogin();
    return;
  }
  if (!sets) {
    blocked("대전용 판 묶음을 불러오지 못했습니다", `<div class="hint">
      <code>data/laser-versus.json</code> 을 읽지 못했습니다. 파일 위치나 배포 상태를 확인하세요.</div>`, true);
    return;
  }

  /* 열린 방을 읽으면서 서버가 준비돼 있는지도 함께 본다.
     예전에는 이 오류를 삼켜서, 목록은 멀쩡해 보이는데 방 만들기만 실패했다. */
  let rooms = [];
  try {
    rooms = await read("laser_open_rooms");
  } catch (e) {
    console.warn(e);
    if (isMissing(e)) {
      blocked("서버에 대전 준비가 아직 안 됐습니다", `<div class="hint">
        ${patchList()}
        <p>혼자 하기(등반)는 이것 없이도 그대로 됩니다.</p></div>`, true);
      return;
    }
    blocked("열린 방을 불러오지 못했습니다",
      `<div class="hint">${esc(explain(e, "잠시 뒤에 다시 시도해 보세요."))}</div>`, true);
    return;
  }

  body.innerHTML =
    `<div class="lz-hero">
       <div class="lz-hero-say">
         <h2>친구와 겨루기</h2>
         <p>방을 만들면 여섯 자리 코드가 나옵니다. 친구가 그 코드로 들어오면 시작합니다.</p>
         <ul class="lz-rules">
           <li>둘에게 <b>같은 판</b>이 같은 순서로 나옵니다</li>
           <li><b>먼저 전부 깬 쪽</b>이 이깁니다</li>
           <li>상대를 방해하는 수단은 없습니다 — 빠르기로만 갈립니다</li>
         </ul>
       </div>
       <div class="lz-grade" id="vsRating"></div>
     </div>
     <div class="lz-bar lz-hero-act">
       <button id="vsNew" class="on big">방 만들기</button>
       <button id="vsCode">코드로 들어가기</button>
       <button id="vsCheck" class="lz-thin">서버 점검</button>
     </div>
     <div class="panel lz-pan">
       <h2>열린 방</h2>
       ${rooms.length ? `<div class="lz-rooms">` + rooms.map((r) => {
         const full = r.players >= r.max_players;
         return `<div class="lz-room${full ? " full" : ""}">
            <div class="lz-room-a">
              <span class="lz-room-name">${esc(r.title)}${r.is_private ? ` <span class="lz-lock" title="비밀방">🔒</span>` : ""}</span>
              <span class="lz-mix">${[["low", r.n_low], ["mid", r.n_mid], ["high", r.n_high]]
                .filter(([, n]) => n > 0)
                .map(([k, n]) => `<span class="lz-t-${k}">${TIER[k]} ${n}</span>`).join("")}</span>
            </div>
            <div class="lz-room-b">
              <span class="lz-room-n">${r.players} / ${r.max_players}</span>
              <button data-join="${esc(r.code)}" data-priv="${r.is_private ? 1 : 0}"
                ${full ? "disabled" : ""}>${full ? "꽉 찼습니다" : "들어가기"}</button>
            </div>
          </div>`;
       }).join("") + `</div>`
        : `<div class="lz-empty">기다리는 방이 없습니다.<br>하나 만들어 친구에게 코드를 알려 주세요.</div>`}
     </div>`;

  paintRating({ rating: myRating, wins: 0, losses: 0 });
  loadRating();
  $("#vsNew").onclick = openCreate;
  $("#vsCode").onclick = () => openJoin("");
  $("#vsCheck").onclick = serverCheck;
  body.querySelectorAll("[data-join]").forEach((b) => {
    b.onclick = () => (+b.dataset.priv ? openJoin(b.dataset.join) : join(b.dataset.join, null));
  });
}

/* 판 수는 숫자 칸이 아니라 +/− 로 고른다. 폰에서 작은 숫자 칸에 커서를 넣고
   자판을 띄워 고치게 하면, 그것만으로 방 만들기가 성가신 일이 된다. */
const stepper = (id, name, cls, val) =>
  `<div class="lz-step">
     <span class="lz-step-name ${cls}">${name}</span>
     <button type="button" class="lz-step-btn" data-step="${id}" data-by="-1" aria-label="${name} 줄이기">−</button>
     <output class="lz-step-n" id="${id}">${val}</output>
     <button type="button" class="lz-step-btn" data-step="${id}" data-by="1" aria-label="${name} 늘리기">+</button>
   </div>`;

/* 실패한 이유는 대화상자 안에 남긴다.
   토스트는 2.6초 뒤에 사라진다 — 폰에서는 그 사이에 눈을 돌리면 아무 일도 없었던 것처럼
   보이고, 그것이 "눌러도 아무 반응이 없다"의 정체였다. 여기 적힌 것은 다시 누를 때까지
   그대로 남는다. */
function formError(e, fallback) {
  const box = $("#formErr");
  // 패치가 없다는 말은 아래 목록이 더 자세히 한다 — 제목에서 파일 이름을 두 번 읽게 하지 않는다
  const msg = isMissing(e) ? "서버에 대전 기능이 아직 없습니다." : explain(e, fallback);
  if (!box) { toast(msg); return; }
  box.hidden = false;
  box.innerHTML = `<b>${esc(msg)}</b>${isMissing(e) ? patchList() : ""}`;
  // 창이 길면 알림이 접힌 아래쪽에 생긴다. 스스로 눈앞으로 올라오게 한다.
  box.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

const formErrSlot = `<div class="lz-form-err" id="formErr" role="alert" hidden></div>`;

function openCreate() {
  veil(`<h2>방 만들기</h2>
    <div class="lz-form">
      <label class="lz-fld">
        <span class="lz-fld-name">방 이름</span>
        <input id="cTitle" maxlength="20" placeholder="${esc(myName() || "")}의 방">
      </label>

      <div class="lz-fld">
        <span class="lz-fld-name">몇 명이서</span>
        <div class="lz-choice" id="cMax">
          <button type="button" class="on" data-max="2">2명</button>
          <button type="button" data-max="3">3명</button>
          <button type="button" data-max="4">4명</button>
        </div>
      </div>

      <div class="lz-fld">
        <span class="lz-fld-name">판 구성 — 모두 합쳐 10판까지</span>
        <div class="lz-steps">
          ${stepper("cLow", "하", "lz-t-low", 2)}
          ${stepper("cMid", "중", "lz-t-mid", 1)}
          ${stepper("cHigh", "상", "lz-t-high", 0)}
        </div>
        <div class="lz-sum" id="cSum"></div>
      </div>

      <label class="lz-fld lz-check">
        <input id="cPriv" type="checkbox">
        <span>비밀방으로 만들기</span>
      </label>
      <label class="lz-fld" id="cPassWrap" hidden>
        <span class="lz-fld-name">입장 암호</span>
        <input id="cPass" maxlength="20" autocomplete="off" inputmode="text">
        <span class="lz-note">계정 비밀번호와 다른 것을 쓰세요. 이 암호는 그대로 저장됩니다.</span>
      </label>
    </div>
    ${formErrSlot}
    <div class="lz-form-act">
      <button id="cGo" class="on">만들기</button>
      <button id="cNo">그만</button>
    </div>`);

  const val = { cLow: 2, cMid: 1, cHigh: 0 };
  const paint = () => {
    for (const k in val) $("#" + k).textContent = val[k];
    const t = val.cLow + val.cMid + val.cHigh;
    $("#cSum").innerHTML = t < 1 ? `<span class="bad">한 판 이상이어야 합니다</span>`
      : `모두 <b>${t}판</b>${t >= 10 ? " — 여기까지입니다" : ""}`;
    $("#cGo").disabled = t < 1;
    $("#card").querySelectorAll("[data-step]").forEach((b) => {
      const by = +b.dataset.by, cur = val[b.dataset.step];
      b.disabled = by > 0 ? (t >= 10) : (cur <= 0);
    });
  };
  $("#card").querySelectorAll("[data-step]").forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.step;
      val[k] = Math.max(0, Math.min(10, val[k] + (+b.dataset.by)));
      paint();
    };
  });
  let max = 2;
  $("#cMax").querySelectorAll("[data-max]").forEach((b) => {
    b.onclick = () => {
      max = +b.dataset.max;
      $("#cMax").querySelectorAll("[data-max]").forEach((x) => x.classList.toggle("on", x === b));
    };
  });
  paint();

  $("#cPriv").onchange = (e) => { $("#cPassWrap").hidden = !e.target.checked; };
  $("#cNo").onclick = hideVeil;
  $("#cGo").onclick = async () => {
    const priv = $("#cPriv").checked;
    const go = $("#cGo");
    const was = go.textContent;
    go.disabled = true;
    go.textContent = "만드는 중…";
    $("#formErr").hidden = true;
    try {
      const data = await call("laser_room_create", {
        p_title: $("#cTitle").value, p_private: priv,
        p_join_code: priv ? $("#cPass").value : null,
        p_max: max,
        p_low: val.cLow, p_mid: val.cMid, p_high: val.cHigh,
      });
      if (!data || !data.id) throw new Error("서버가 방 번호를 돌려주지 않았습니다.");
      hideVeil();
      await enter(data.id);
    } catch (e) {
      console.warn(e);
      go.disabled = false;
      go.textContent = was;
      formError(e, "방을 만들지 못했습니다.");
    }
  };
}

function openJoin(code) {
  veil(`<h2>방에 들어가기</h2>
    <div class="lz-form">
      <label class="lz-fld">
        <span class="lz-fld-name">입장 코드</span>
        <input id="jCode" class="lz-code-in" maxlength="6" value="${esc(code)}"
               autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABC123">
      </label>
      <label class="lz-fld">
        <span class="lz-fld-name">암호 <i>비밀방만</i></span>
        <input id="jPass" maxlength="20" autocomplete="off">
      </label>
    </div>
    ${formErrSlot}
    <div class="lz-form-act">
      <button id="jGo" class="on">들어가기</button>
      <button id="jNo">그만</button>
    </div>`);
  $("#jNo").onclick = hideVeil;
  $("#jGo").onclick = () => join($("#jCode").value, $("#jPass").value);
  $("#jCode").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });
}

async function join(code, pass) {
  const go = $("#jGo");
  const was = go ? go.textContent : "";
  if (go) { go.disabled = true; go.textContent = "들어가는 중…"; }
  const box = $("#formErr");
  if (box) box.hidden = true;
  try {
    const id = await call("laser_room_join", { p_code: code, p_pass: pass || null });
    if (!id) throw new Error("서버가 방 번호를 돌려주지 않았습니다.");
    hideVeil();
    await enter(id);
  } catch (e) {
    console.warn(e);
    if (go) { go.disabled = false; go.textContent = was; }
    formError(e, "들어가지 못했습니다.");
  }
}

/* ══════════════ 서버 점검 ══════════════

   대전이 안 될 때 막히는 곳은 거의 언제나 "그 함수가 서버에 아직 없다" 하나다.
   그런데 눌러 본 사람은 어느 함수인지 알 길이 없었다. 여기서 필요한 것을 하나씩
   불러 보고 있는지 없는지를 표로 보여 준다.

   부르되 아무것도 바꾸지 않는다 — 없는 방 번호나 만들 수 없는 판 수를 주면,
   서버는 무엇도 건드리기 전에 먼저 거절한다. 그 거절이 곧 "이 함수는 있다"는 답이다. */

const NIL = "00000000-0000-0000-0000-000000000000";
const NEEDS = [
  ["laser_open_rooms", "열린 방 목록", null, PATCH],
  ["laser_room_create", "방 만들기", { p_title: "", p_private: false, p_join_code: null, p_max: 2, p_low: 0, p_mid: 0, p_high: 0 }, PATCH],
  ["laser_room_join", "방 들어가기", { p_code: "______", p_pass: null }, PATCH],
  ["laser_room_state", "방 상태 읽기", { p_room: NIL }, PATCH],
  ["laser_room_start", "대전 시작", { p_room: NIL, p_boards: "[]" }, PATCH],
  ["laser_room_progress", "진행 알리기", { p_room: NIL, p_solved: 0 }, PATCH],
  ["laser_room_finish", "끝내고 점수 매기기", { p_room: NIL, p_ms: 1 }, PATCH],
  ["laser_room_leave", "방 나가기", { p_room: NIL }, PATCH],
  ["laser_my_rating", "내 급수", {}, PATCH],
  ["laser_room_rematch", "한 판 더", { p_room: NIL }, PATCH6],
];

async function probe([name, , args]) {
  try {
    if (args === null) {
      await read(name);
    } else {
      await call(name, args);
    }
    return { ok: true };
  } catch (e) {
    if (isMissing(e)) return { ok: false, why: "서버에 없습니다" };
    return { ok: true, note: e?.message || "" };   // 거절당했다 = 있다
  }
}

async function serverCheck() {
  veil(`<h2>서버 점검</h2>
    <p class="lz-probe-say">대전에 필요한 것이 서버에 있는지 하나씩 불러 봅니다.
       아무것도 바꾸지 않습니다.</p>
    <div class="lz-probe" id="chkList">${NEEDS.map(([n, say]) =>
      `<div class="lz-chk" data-n="${n}"><span class="lz-chk-mark">…</span>
         <span class="lz-chk-say">${say}</span><code>${n}</code></div>`).join("")}</div>
    <div class="lz-probe-out" id="chkOut" hidden></div>
    <div class="lz-form-act"><button id="chkNo" class="on">닫기</button></div>`);
  $("#chkNo").onclick = hideVeil;

  const missing = [];
  for (const need of NEEDS) {
    const row = $(`.lz-chk[data-n="${need[0]}"]`);
    const r = await probe(need);
    if (!row) return;                      // 점검 중에 창을 닫았다
    row.classList.add(r.ok ? "yes" : "no");
    row.querySelector(".lz-chk-mark").textContent = r.ok ? "✓" : "✗";
    if (!r.ok) missing.push(need);
  }

  const out = $("#chkOut");
  if (!out) return;
  out.hidden = false;
  if (!missing.length) {
    out.innerHTML = `<b class="good">서버는 준비돼 있습니다.</b>
      <p>그래도 막힌다면 로그인 상태와 인터넷 연결을 확인해 보세요.</p>`;
    return;
  }
  const files = [...new Set(missing.map((m) => m[3]))];
  out.innerHTML = `<b class="bad">${missing.length}가지가 서버에 없습니다.</b>
    <p>아래 파일을 Supabase 대시보드 → <b>SQL Editor</b> 에서 한 번씩 실행하면 됩니다.
       여러 번 실행해도 안전합니다.</p>
    <ol class="lz-fix">${files.map((f) => `<li><code>${f}</code></li>`).join("")}</ol>`;
}

/* ══════════════ 방 ══════════════ */

async function enter(id) {
  room = { id };
  misses = 0;
  await refresh(true);
  if (!room) return;              // 첫 읽기가 막혔다 — 이유는 화면에 적혀 있다
  await openChannel(id);
  clearInterval(poll);
  // 실시간이 끊겨도 방이 멈추지 않도록, 느슨하게 다시 확인한다
  poll = setInterval(refresh, 4000);
}

/* 방 상태를 잇달아 못 읽은 횟수. 실시간이든 폴링이든 한 번쯤은 끊긴다 —
   그때마다 방에서 튕겨 나오면 대전이 성립하지 않는다. */
let misses = 0;

/* 첫 읽기(first)와 그 뒤의 되읽기를 다르게 다룬다.
   예전에는 어느 쪽이든 조용히 로비로 돌려보냈다. 방은 서버에 만들어졌는데 화면만
   목록으로 돌아오니, 누른 사람 눈에는 "만들기를 눌러도 아무 일이 없다"로 보였다. */
async function refresh(first) {
  if (!room) return;
  let data;
  try {
    data = await call("laser_room_state", { p_room: room.id });
    misses = 0;
  } catch (e) {
    console.warn(e);
    if (first) { enterFailed(e); return; }
    if (++misses < 3) return;                  // 잠깐 끊긴 것은 넘긴다
    const why = explain(e, "방을 읽지 못했습니다.");
    leaveLocal();
    toast(why);
    return;
  }
  try {
    room = { ...data, id: data.id };

    /* 세 가지 상태를 각각 다룬다. 예전에는 '진행 중이 아니면 대기실'로 뭉뚱그렸는데,
       그러면 먼저 끝낸 사람 때문에 방이 닫히는 순간 아직 풀고 있던 사람의 판이
       대기실 화면으로 덮여 버린다 — 진 사람은 자기가 왜 끝났는지도 못 본다. */
    if (room.status === "playing") {
      if (playing) paintScoreboard(); else beginMatch();
    } else if (room.status === "finished") {
      endMatch();
    } else {
      if (playing) stopMatch();
      shown = false;          // 한 판 더 — 다음 판이 끝나면 결과를 다시 띄운다
      deltas = null;
      renderRoom();
    }
  } catch (e) {
    // 그린 뒤에 터진 것은 방 문제가 아니다 — 방은 두고 이유만 말한다
    console.warn(e);
    toast("방 화면을 그리는 중에 문제가 생겼습니다: " + (e?.message || e));
  }
}

/** 만들거나 들어간 방을 처음부터 읽지 못했다. 왜인지 적고, 방은 놓아 준다. */
function enterFailed(e) {
  stopMatch();
  closeChannel();
  room = null;
  blocked("방에 들어가지 못했습니다", `<div class="hint">
    <p class="lz-why">${esc(explain(e, "방 상태를 읽지 못했습니다."))}</p>
    ${isMissing(e) ? patchList() : ""}
    <p>방 자체는 서버에 만들어졌을 수 있습니다. <b>다시 확인</b>을 누르면 목록에서 찾을 수 있습니다.</p>
  </div>`, true);
}

async function openChannel(id) {
  closeChannel();
  channel = (await client()).channel(`laser-room-${id}`, { config: { presence: { key: uid() } } });
  channel.on("broadcast", { event: "state" }, () => refresh());
  channel.on("broadcast", { event: "progress" }, ({ payload }) => {
    if (!room?.players) return;
    const p = room.players.find((x) => x.id === payload.id);
    if (p) { p.solved = Math.max(p.solved, payload.solved); paintScoreboard(); }
  });
  channel.subscribe();
}

function closeChannel() { try { channel?.unsubscribe(); } catch {} channel = null; }
const shout = (event, payload = {}) => channel?.send({ type: "broadcast", event, payload });

function renderRoom() {
  const total = room.n_low + room.n_mid + room.n_high;
  const host = room.host === uid();
  const alone = room.players.length < 2;
  $("#vsBody").innerHTML =
    `<div class="lz-bar lz-top">
       <button id="vsLeave">◂ 나가기</button>
       <strong class="lz-title">${esc(room.title)}</strong>
     </div>

     <div class="lz-code-card">
       <div class="lz-code-say">친구에게 이 코드를 알려 주세요</div>
       <div class="lz-code">${esc(room.code)}</div>
       <button id="vsCopy" class="lz-copy">코드 복사</button>
     </div>

     <div class="panel lz-pan">
       <h2>오늘의 판</h2>
       <div class="lz-mix big">${[["low", room.n_low], ["mid", room.n_mid], ["high", room.n_high]]
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `<span class="lz-t-${k}">${TIER[k]} ${n}판</span>`).join("")}
          <span class="lz-mix-all">모두 ${total}판</span></div>
       <div class="hint">쉬운 것부터 나옵니다. 둘에게 같은 판이 같은 순서로 갑니다.</div>
     </div>

     <div class="panel lz-pan">
       <h2>참가자 <span class="lz-count">${room.players.length} / ${room.max_players}</span></h2>
       <div class="lz-seats">${room.players.map((p) => `
         <div class="lz-seat${p.id === uid() ? " me" : ""}">
           <span class="lz-seat-name">${esc(p.name)}${p.id === room.host ? `<span class="lz-host">방장</span>` : ""}</span>
           <span class="lz-seat-grade">${gradeName(p.rating)} · ${p.rating}점</span>
         </div>`).join("")}
         ${alone ? `<div class="lz-seat waiting"><span class="lz-seat-name">친구를 기다리는 중…</span></div>` : ""}
       </div>
     </div>

     ${host
       ? `<div class="lz-bar lz-go"><button id="vsStart" class="on big" ${alone ? "disabled" : ""}>
            ${alone ? "두 명이 모여야 시작합니다" : "시작"}</button></div>`
       : `<div class="lz-wait">방장이 시작하기를 기다리는 중…</div>`}`;

  $("#vsLeave").onclick = leave;
  const copy = $("#vsCopy");
  if (copy) copy.onclick = async () => {
    try { await navigator.clipboard.writeText(room.code); toast("코드를 복사했습니다."); }
    catch { toast(`입장 코드는 ${room.code} 입니다.`); }
  };
  const s = $("#vsStart");
  if (s) s.onclick = start;
}

/* ══════════════ 시작 ══════════════ */

/** 등급별로 필요한 만큼 무작위로 뽑는다. 같은 판이 두 번 나오지 않게 한다. */
function drawBoards() {
  const out = [];
  const take = (tier, n) => {
    const pool = [...sets[tier]];
    for (let i = 0; i < n && pool.length; i++) {
      const k = Math.floor(Math.random() * pool.length);
      out.push({ ...pool[k], tier });
      pool.splice(k, 1);
    }
  };
  // 쉬운 것부터 나오게 — 뒤로 갈수록 어려워야 승부가 뒤에서 갈린다
  take("low", room.n_low);
  take("mid", room.n_mid);
  take("high", room.n_high);
  return out;
}

async function start() {
  try {
    const picked = drawBoards();
    await call("laser_room_start", { p_room: room.id, p_boards: JSON.stringify(picked) });
    shout("state");
    await refresh();
  } catch (e) { toast(explain(e, "시작하지 못했습니다.")); }
}

/* ══════════════ 대전 진행 ══════════════ */

function beginMatch() {
  board?.destroy();
  board = null;
  playing = true;
  deltas = null;
  shown = false;
  boards = JSON.parse(room.boards || "[]");
  idx = 0;
  startedAt = performance.now();
  renderMatch();
  openBoard();
}

/** 판을 놓는다. 시계도 판도 여기서 한 번에 걷는다. */
function stopMatch() {
  playing = false;
  clearInterval(poll);
  poll = null;
  board?.destroy();
  board = null;
}

function renderMatch() {
  /* 되돌리기·전부 치우기는 판 아래에 둔다. 폰에서는 화면 위쪽이 엄지에서 가장 멀고,
     판을 보면서 누르는 단추라 판 곁에 있는 편이 낫다. */
  $("#vsBody").innerHTML =
    `<div class="lz-bar lz-top">
       <button id="vsLeave">기권</button>
       <strong id="vsWhich" class="lz-title"></strong>
       <span style="flex:1"></span>
       <span class="lz-clock">경과 <b id="vsTime">0.0초</b></span>
     </div>
     <div id="vsScore" class="lz-score"></div>
     <div class="lz-goal" id="vsGoal"></div>
     <div class="lz-stage"><div class="lz-board" id="vsBoard"></div></div>
     <div class="lz-bar lz-tools">
       <button id="vsUndo">되돌리기</button>
       <button id="vsClear">전부 치우기</button>
     </div>
     <div class="lz-done" id="vsDone" hidden></div>`;

  $("#vsLeave").onclick = leave;
  $("#vsUndo").onclick = () => board?.undo();
  $("#vsClear").onclick = () => board?.clear();

  clearInterval(poll);
  poll = setInterval(() => {
    $("#vsTime").textContent = ((performance.now() - startedAt) / 1000).toFixed(1) + "초";
    refresh();
  }, 1000);
  paintScoreboard();
}

function openBoard() {
  const d = boards[idx];
  $("#vsWhich").textContent = `${idx + 1} / ${boards.length}판 · ${TIER[d.tier]}`;
  board?.destroy();
  board = new LaserBoard($("#vsBoard"), {
    onChange: paintGoal,
    onWin: onBoardWin,
    onPlace: (m) => (m ? Sfx.place?.() : Sfx.unplace?.()),
    onFull: () => toast(`거울은 ${d.mirrors}개까지입니다.`),
  });
  board.load(d);
  $("#vsDone").hidden = true;
}

function paintGoal(st) {
  const mark = (ok, txt) => `<span class="${ok ? "ok" : "no"}">${ok ? "✓" : "•"} ${txt}</span>`;
  $("#vsGoal").innerHTML =
    `${mark(st.mirrors === st.mirrorsNeeded, `거울 <b>${st.mirrorsNeeded}개 모두</b> (지금 ${st.mirrors}개)`)}` +
    ` &nbsp;그리고&nbsp; ${mark(st.lit === st.targets, `목표 <b>${st.targets}곳 전부</b> (지금 ${st.lit}곳)`)}`;
}

function paintScoreboard() {
  const el = $("#vsScore");
  if (!el || !room?.players) return;
  const total = boards.length || (room.n_low + room.n_mid + room.n_high);
  const lead = Math.max(...room.players.map((p) => p.solved || 0));
  el.innerHTML = room.players.map((p) => {
    const pct = Math.round(((p.solved || 0) / total) * 100);
    const mine = p.id === uid();
    const ahead = (p.solved || 0) === lead && lead > 0;
    return `<div class="lz-race${mine ? " me" : ""}${ahead ? " lead" : ""}">
      <div class="lz-race-head">
        <span class="lz-race-name">${esc(p.name)}${mine ? `<span class="lz-me">나</span>` : ""}</span>
        <span class="lz-race-num">${p.solved || 0} <i>/ ${total}</i>${p.finish_ms ? ` <b>완주</b>` : ""}</span>
      </div>
      <div class="lz-race-track"><div class="lz-race-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join("");
}

async function onBoardWin() {
  Sfx.win?.();
  idx++;
  try { await call("laser_room_progress", { p_room: room.id, p_solved: idx }); } catch (e) { console.warn(e); }
  shout("progress", { id: uid(), solved: idx });

  if (idx < boards.length) {
    $("#vsDone").hidden = false;
    $("#vsDone").innerHTML = `<b>${idx}판째 통과</b> — 다음 판입니다.`;
    setTimeout(() => { if (room?.status === "playing") openBoard(); }, 700);
    return;
  }

  // 다 깼다
  const ms = Math.round(performance.now() - startedAt);
  try {
    deltas = (await call("laser_room_finish", { p_room: room.id, p_ms: ms })) || null;
  } catch (e) { console.warn(e); }
  shout("state");
  await refresh();       // 방이 닫혔는지 확인하고 결과로 넘어간다
}

/* ══════════════ 결과 ══════════════ */

/** 방이 닫혔다. 이긴 쪽이든 진 쪽이든 여기로 온다. */
function endMatch() {
  if (shown) return;
  shown = true;
  stopMatch();
  paintResult();
  loadRating();
  // 방은 아직 살아 있다 — 방장이 한 판 더 하면 따라 들어가야 한다
  poll = setInterval(refresh, 4000);
}

/** 등수 — 다 깬 사람은 걸린 시간 순, 못 깬 사람은 깬 판 수 역순. 서버가 점수를 매기는 규칙과 같다. */
function standing() {
  const ps = [...(room.players || [])].sort((a, b) => {
    const ad = a.finish_ms != null, bd = b.finish_ms != null;
    if (ad !== bd) return ad ? -1 : 1;
    if (ad && bd) return a.finish_ms - b.finish_ms;
    return (b.solved || 0) - (a.solved || 0);
  });
  let pos = 0, prev = null;
  return ps.map((p, i) => {
    const k = p.finish_ms != null ? "d" + p.finish_ms : "s" + (p.solved || 0);
    if (k !== prev) { pos = i + 1; prev = k; }
    return { ...p, pos };
  });
}

function paintResult() {
  const rows = standing();
  const total = boards.length || (room.n_low + room.n_mid + room.n_high);
  const mine = rows.find((p) => p.id === uid());
  const won = mine?.pos === 1;
  // 점수 증감은 방을 닫은 사람만 답으로 받는다. 나머지는 방에 적힌 것을 본다.
  const d = (deltas || room.result || []).find((x) => x.id === uid());
  const host = room.host === uid();

  const alone = rows.length < 2;
  const mood = alone ? "alone" : won ? "win" : "lose";

  $("#vsBody").innerHTML =
    `<div class="lz-bar lz-top">
       <button id="vsLeave">◂ 방 목록으로</button>
       <strong class="lz-title">${esc(room.title)}</strong>
     </div>

     <div class="lz-verdict ${mood}">
       <div class="lz-verdict-mark">${alone ? "…" : won ? "★" : "◆"}</div>
       <h2>${alone ? "혼자 남았습니다" : won ? "이겼습니다" : "졌습니다"}</h2>
       <p>${alone ? "상대가 도중에 나갔습니다. 급수는 움직이지 않습니다."
          : won ? "먼저 전부 깼습니다." : "상대가 먼저 전부 깼습니다."}</p>
       ${d ? `<div class="lz-delta ${d.delta >= 0 ? "up" : "down"}">
           <span>${gradeName(d.before)} ${d.before}점</span>
           <span class="lz-arrow-to">→</span>
           <b>${gradeName(d.after)} ${d.after}점</b>
           <span class="lz-delta-n">${d.delta >= 0 ? "+" : ""}${d.delta}</span>
         </div>` : `<div class="lz-grade" id="vsRating"></div>`}
     </div>

     <div class="panel lz-pan">
       <h2>등수</h2>
       <div class="lz-ranks">${rows.map((p) => `
         <div class="lz-rank${p.id === uid() ? " me" : ""}${p.pos === 1 ? " first" : ""}">
           <span class="lz-rank-pos">${p.pos}</span>
           <span class="lz-rank-name">${esc(p.name)}${p.id === uid() ? `<span class="lz-me">나</span>` : ""}</span>
           <span class="lz-rank-solved">${p.solved} / ${total}판</span>
           <span class="lz-rank-ms">${p.finish_ms != null ? (p.finish_ms / 1000).toFixed(1) + "초" : "못 끝냄"}</span>
         </div>`).join("")}</div>
     </div>

     <div class="lz-bar lz-go">
       ${host ? `<button id="vsAgain" class="on big">한 판 더</button>`
              : `<div class="lz-wait">방장이 다시 시작하면 이어서 합니다</div>`}
     </div>`;

  $("#vsLeave").onclick = leave;
  paintRating({ rating: myRating, wins: 0, losses: 0 });

  const again = $("#vsAgain");
  if (again) again.onclick = async () => {
    again.disabled = true;
    try {
      await call("laser_room_rematch", { p_room: room.id });
      shout("state");
      await refresh();
    } catch (e) {
      again.disabled = false;
      toast(explain(e, "다시 시작하지 못했습니다."));
    }
  };
}

/* ══════════════ 나가기 ══════════════ */

async function leave() {
  try { await call("laser_room_leave", { p_room: room.id }); } catch (e) { console.warn(e); }
  shout("state");
  leaveLocal();
}

function leaveLocal() {
  stopMatch();
  closeChannel();
  room = null;
  boards = [];
  deltas = null;
  shown = false;
  renderLobby();
}
