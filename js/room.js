/* 대전 — 로비 · 방 · 실시간 진행률
 *
 * 상대에게 보내는 것은 '채운 칸 수' 하나뿐이다. 판의 값이나 위치는 절대 전송하지 않으므로
 * 구조적으로 베낄 방법이 없다.
 *
 * 퍼즐은 방장이 실제로 생성한 문자열을 그대로 배포한다. 시드만 공유하면 안 된다 —
 * 생성기가 Date.now() 로 탐색을 끊기 때문에 같은 시드도 기기 속도에 따라 다른 판이 된다.
 */
import { $, esc, veil, hideVeil, toast, onTab, showTab, fmt, fmtPrecise } from "./ui.js";
import { ONLINE, LEVELS, PRESET_SIZES, ROOM_MAX_PLAYERS, PROGRESS_INTERVAL } from "./config.js";
import { client, uid, myName, onAuth, sessionValid, readableError, onKicked } from "./supabase.js";
import { requireLogin } from "./auth.js";
import { Game, readMatchSave } from "./game.js";
import * as Chat from "./chat.js";

let R = null;            // 현재 방 상태 (room_state 결과)
let chan = null;         // Realtime 채널
let live = {};           // user_id → { filled, hints, done, ms, rank }
let online = new Set();  // presence 로 확인된 접속자
let presenceSynced = false;
let lobbyTimer = null;
let roomTimer = null;    // 실시간이 끊겨도 방이 멈추지 않게 하는 느슨한 재확인
let countdownTimer = null;
let base = 0;            // 처음부터 주어진 칸 수 — 게이지는 각자 푼 몫만 잰다

const isHost = () => !!(R && R.host_id === uid());
const total = () => (R ? R.size * R.size : 0);
const countGiven = (puzzle) => (puzzle ? puzzle.split("").filter((c) => c !== "0").length : 0);

/* ══════════════ 초기화 ══════════════ */

export function init() {
  onTab((name) => {
    if (name === "room") { render(); startLobbyPolling(); }
    else stopLobbyPolling();
  });

  let resumed = false;
  onAuth((m) => {
    if (!$(".view[data-view='room']").hidden) render();
    if (m.profile && !resumed) { resumed = true; resumeIfAny(); }
    if (!m.profile && R) hardLeave();
  });
  onKicked(() => { if (R) hardLeave(); });

  Game.on("progress", reportProgress);
  Game.on("hint", reportProgress);
  Game.on("win", onWin);

  window.addEventListener("beforeunload", () => { if (chan) chan.unsubscribe(); });
}

/** 새로고침으로 돌아왔을 때 들어가 있던 방으로 복귀한다. */
async function resumeIfAny() {
  if (R) return;
  const sb = await client();
  if (!sb || !uid()) return;
  const { data, error } = await sb.rpc("my_room");
  if (error) { console.warn("[room] 복귀 확인 실패", error); return; }
  if (data) enterRoom(data, { silent: true });
}

/* ══════════════ 로비 ══════════════ */

function startLobbyPolling() {
  stopLobbyPolling();
  if (!ONLINE || R) return;
  lobbyTimer = setInterval(() => { if (!R && !$(".view[data-view='room']").hidden) renderLobby(); }, 6000);
}
function stopLobbyPolling() { clearInterval(lobbyTimer); lobbyTimer = null; }

function render() {
  const body = $("#roomBody");

  if (!ONLINE) {
    body.innerHTML = `<div class="panel"><div class="empty">대전은 온라인 기능입니다.<br>
      <b>js/config.js</b> 에 Supabase 설정을 채우면 켜집니다.</div></div>`;
    return;
  }
  if (!myName()) {
    body.innerHTML = `<div class="panel"><div class="empty">대전에 참가하려면 로그인이 필요합니다.<br>
      <button class="btn primary" id="roomLoginBtn" style="margin-top:14px">로그인</button></div></div>`;
    $("#roomLoginBtn").onclick = () => requireLogin("대전에 참가하려면 로그인이 필요합니다.");
    return;
  }
  if (R) renderRoom(); else renderLobby();
}

async function renderLobby() {
  const body = $("#roomBody");
  const first = !body.querySelector(".room-list");
  if (first) {
    body.innerHTML = `<div class="panel">
      <div class="panel-head">
        <h2>대전</h2>
        <p>같은 판을 동시에 풀고 진행률을 겨룹니다. 상대에게 보이는 것은 채운 칸 수뿐입니다.</p>
      </div>
      <div class="lobby-actions">
        <button class="btn primary" id="mkRoom">방 만들기</button>
        <button class="btn" id="joinCode">코드로 입장</button>
        <span class="grow"></span>
        <button class="btn" id="refreshRooms">새로 고침</button>
      </div>
      <div class="room-list" id="roomList"><div class="empty">불러오는 중…</div></div>
    </div>`;
    $("#mkRoom").onclick = openCreate;
    $("#joinCode").onclick = openJoinByCode;
    $("#refreshRooms").onclick = renderLobby;
  }

  const sb = await client();
  const { data, error } = await sb.from("open_rooms").select("*").order("created_at", { ascending: false }).limit(40);
  const list = $("#roomList");
  if (!list) return;

  if (error) { list.innerHTML = `<div class="empty">목록을 불러오지 못했습니다.<br>${esc(readableError(error))}</div>`; return; }
  if (!data || !data.length) {
    list.innerHTML = `<div class="empty">열려 있는 방이 없습니다.<br><b>방 만들기</b>로 첫 방을 여세요.</div>`;
    return;
  }

  list.innerHTML = data.map((r) => {
    const full = r.players >= r.max_players;
    return `<div class="room-row">
      <div class="rt">
        <b>${esc(r.title)} ${r.is_private ? '<span class="lock">🔒</span>' : ""}</b>
        <span>${r.size}×${r.size} · ${LEVELS[r.level]} · 방장 ${esc(r.host)}</span>
      </div>
      <span class="cnt${full ? " full" : ""}">${r.players}/${r.max_players}</span>
      <button class="btn" data-code="${esc(r.code)}" data-priv="${r.is_private ? 1 : 0}"
              ${full ? "disabled" : ""}>${full ? "정원" : "입장"}</button>
    </div>`;
  }).join("");

  list.querySelectorAll("[data-code]").forEach((b) => {
    b.onclick = () => (+b.dataset.priv ? openJoinByCode(b.dataset.code) : doJoin(b.dataset.code, null));
  });
}

/* ── 방 만들기 ── */

function openCreate() {
  veil(`<h2>방 만들기</h2>
    <form class="form" id="mkForm" novalidate>
      <div class="field">
        <label for="mTitle">방 이름</label>
        <input type="text" id="mTitle" maxlength="24" placeholder="비우면 '${esc(myName())}의 전장'">
      </div>
      <div class="form-row">
        <div class="field"><label for="mSize">규격</label>
          <select id="mSize">${[5, 6, 7, 8, 9, 10, 11, 12].map((n) =>
            `<option value="${n}"${n === 8 ? " selected" : ""}>${n}×${n}${PRESET_SIZES.includes(n) ? "" : " (랭킹 없음)"}</option>`).join("")}</select>
        </div>
        <div class="field"><label for="mLevel">난이도</label>
          <select id="mLevel">${[1, 2, 3].map((n) =>
            `<option value="${n}"${n === 2 ? " selected" : ""}>${LEVELS[n]}</option>`).join("")}</select>
        </div>
        <div class="field"><label for="mMax">인원</label>
          <select id="mMax">${Array.from({ length: ROOM_MAX_PLAYERS }, (_, i) => i + 1).map((n) =>
            `<option value="${n}"${n === 2 ? " selected" : ""}>${n === 1 ? "혼자" : n + "명"}</option>`).join("")}</select>
        </div>
      </div>
      <div class="field">
        <label>공개 범위</label>
        <div class="picker-row">
          <button type="button" class="chip on" id="mPub">공개방</button>
          <button type="button" class="chip" id="mPriv">비밀방</button>
        </div>
      </div>
      <div class="field" id="mPassWrap" hidden>
        <label for="mPass">입장 암호</label>
        <input type="text" id="mPass" maxlength="20" placeholder="같이 할 사람에게 알려 줄 암호">
        <p class="hint">계정 비밀번호와 다른 것을 쓰세요. 이 값은 그대로 저장됩니다.</p>
      </div>
      <p class="err" id="mErr" role="alert"></p>
      <div class="card-actions">
        <button class="btn primary" type="submit" id="mGo">만들기</button>
        <button class="btn" type="button" id="mCancel">닫기</button>
      </div>
    </form>`, { wide: true });

  let priv = false;
  $("#mPub").onclick = () => { priv = false; $("#mPub").classList.add("on"); $("#mPriv").classList.remove("on"); $("#mPassWrap").hidden = true; };
  $("#mPriv").onclick = () => { priv = true; $("#mPriv").classList.add("on"); $("#mPub").classList.remove("on"); $("#mPassWrap").hidden = false; $("#mPass").focus(); };
  $("#mCancel").onclick = hideVeil;

  // 오류를 알리려던 자리가 이미 사라졌을 수 있다(밀려남 안내가 창을 갈아 끼우는 등).
  // 그때 여기서 다시 터지면 진짜 원인이 묻히므로, 자리가 없으면 토스트로 돌린다.
  const mkErr = (msg) => {
    const el = $("#mErr");
    if (el) el.textContent = msg; else toast(msg);
  };

  $("#mkForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pass = $("#mPass").value.trim();
    if (priv && !pass) { mkErr("비밀방은 입장 암호가 필요합니다."); return; }

    const go = $("#mGo"); go.disabled = true; go.textContent = "만드는 중…";
    let roomId = null;
    try {
      if (!(await sessionValid())) throw new Error("세션이 만료되었습니다. 다시 로그인해 주세요.");
      const sb = await client();
      const { data, error } = await sb.rpc("create_room", {
        p_title: $("#mTitle").value.trim(), p_private: priv, p_pass: pass,
        p_max: +$("#mMax").value, p_size: +$("#mSize").value, p_level: +$("#mLevel").value,
      });
      if (error) throw error;
      roomId = data.id;
    } catch (e2) {
      mkErr(readableError(e2));
      if ($("#mGo")) { go.disabled = false; go.textContent = "만들기"; }
      return;
    }
    // 방은 만들어졌다. 들어가다 실패하더라도 위의 폼 오류로 되돌리지 않는다.
    hideVeil();
    await enterRoom(roomId);
  });
}

function openJoinByCode(prefill) {
  veil(`<h2>코드로 입장</h2>
    <p>방장에게 받은 6자리 코드를 넣으세요.</p>
    <form class="form" id="jForm" novalidate>
      <div class="field"><label for="jCode">입장 코드</label>
        <input type="text" id="jCode" maxlength="6" spellcheck="false"
               style="letter-spacing:.2em;text-transform:uppercase" value="${esc(prefill || "")}"></div>
      <div class="field"><label for="jPass">입장 암호 <span class="hint">(비밀방만)</span></label>
        <input type="text" id="jPass" maxlength="20" placeholder="공개방이면 비워 두세요"></div>
      <p class="err" id="jErr" role="alert"></p>
      <div class="card-actions">
        <button class="btn primary" type="submit" id="jGo">입장</button>
        <button class="btn" type="button" id="jCancel">닫기</button>
      </div>
    </form>`, { wide: true });
  $("#jCancel").onclick = hideVeil;
  if (prefill) $("#jPass").focus();

  const jErr = (msg) => {
    const el = $("#jErr");
    if (el) el.textContent = msg; else toast(msg);
  };

  $("#jForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = $("#jCode").value.trim().toUpperCase();
    if (code.length !== 6) { jErr("코드는 6자리입니다."); return; }
    const go = $("#jGo"); go.disabled = true; go.textContent = "입장 중…";
    const ok = await doJoin(code, $("#jPass").value.trim(), (m) => {
      jErr(m);
      if ($("#jGo")) { go.disabled = false; go.textContent = "입장"; }
    });
    if (ok) hideVeil();
  });
}

async function doJoin(code, pass, onError) {
  try {
    if (!(await sessionValid())) throw new Error("세션이 만료되었습니다. 다시 로그인해 주세요.");
    const sb = await client();
    const { data, error } = await sb.rpc("join_room", { p_code: code, p_pass: pass || null });
    if (error) throw error;
    await enterRoom(data);
    return true;
  } catch (e) {
    const m = readableError(e);
    if (onError) onError(m); else toast(m);
    return false;
  }
}

/* ══════════════ 방 ══════════════ */

async function enterRoom(id, opts) {
  const sb = await client();
  const { data, error } = await sb.rpc("room_state", { p_room: id });
  if (error || !data) {
    if (!opts || !opts.silent) toast(error ? readableError(error) : "방을 찾을 수 없습니다.");
    R = null; render();
    return;
  }

  R = data;
  live = {};
  online = new Set();
  base = countGiven(R.puzzle);
  R.players.forEach((p) => {
    live[p.user_id] = {
      filled: Math.max(p.filled || 0, base), hints: p.hints_used || 0,
      done: !!p.finished_at, ms: p.finish_ms || 0,
    };
  });

  await openChannel();
  stopLobbyPolling();
  Chat.mount(sendChat, R.title);

  // 이미 진행 중인 방이면 판을 되살린다
  if (R.status === "playing" && R.puzzle && !Game.isMatch()) {
    showTab("game");                       // 판 크기를 재려면 먼저 보여야 한다
    Game.startMatch(
      { W: R.size, H: R.size, level: R.level, puzzle: R.puzzle, solution: R.solution, roomId: R.id },
      readMatchSave(R.id)
    );
    toast("대전을 이어서 진행합니다.");
  }

  render();
  renderMatchBar();
}

async function openChannel() {
  closeChannel();

  /* 방 상태를 실시간 방송에만 기대면, 그 연결이 한 번 끊기는 순간 방이 통째로
     멈춘다 — 친구가 들어와도 안 보이고, 방장이 시작해도 따라가지 못한다.
     폰에서는 화면을 껐다 켜는 것만으로도 연결이 끊긴다. 느슨하게 다시 확인한다. */
  clearInterval(roomTimer);
  roomTimer = setInterval(() => { if (R) refreshState(); }, 5000);

  const sb = await client();
  chan = sb.channel(`room:${R.id}`, {
    config: { broadcast: { self: false }, presence: { key: uid() } },
  });

  chan.on("presence", { event: "sync" }, () => {
    online = new Set(Object.keys(chan.presenceState() || {}));
    presenceSynced = true;
    renderSeats();
  });

  // 누군가 들어오거나 나갔다 → 명단을 다시 읽는다
  chan.on("broadcast", { event: "roster" }, () => refreshState());

  chan.on("broadcast", { event: "start" }, ({ payload }) => beginMatch(payload));

  chan.on("broadcast", { event: "progress" }, ({ payload }) => {
    if (!payload || !payload.u) return;
    const s = live[payload.u] || (live[payload.u] = {});
    s.filled = payload.f; s.hints = payload.h;
    renderSeats();
  });

  // 채팅 — 어디에도 저장하지 않고 이 채널로만 흐른다
  chan.on("broadcast", { event: "chat" }, ({ payload }) => {
    if (!payload || !payload.u || payload.u === uid()) return;   // 내 것은 보낼 때 이미 띄웠다
    const who = R.players.find((p) => p.user_id === payload.u);
    Chat.receive({ name: who ? who.username : "알 수 없음", text: payload.t, mine: false });
  });

  chan.on("broadcast", { event: "finish" }, ({ payload }) => {
    if (!payload || !payload.u) return;
    const s = live[payload.u] || (live[payload.u] = {});
    s.done = true; s.ms = payload.ms; s.filled = total(); s.rank = payload.r;
    const who = (R.players.find((p) => p.user_id === payload.u) || {}).username || "누군가";
    toast(`${who} 완주 — ${fmt(payload.ms)} (${payload.r}위)`);
    Chat.system(`${who} 님이 ${fmt(payload.ms)} 만에 완주했습니다 (${payload.r}위).`);
    renderSeats();
  });

  await chan.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await chan.track({ u: uid(), n: myName() });
      chan.send({ type: "broadcast", event: "roster", payload: { by: uid() } });
    }
  });
}

function closeChannel() {
  if (chan) { chan.unsubscribe(); chan = null; }
  presenceSynced = false;
  clearInterval(roomTimer);
  roomTimer = null;
  clearTimeout(countdownTimer);
}

async function refreshState() {
  if (!R) return;
  const sb = await client();
  const { data } = await sb.rpc("room_state", { p_room: R.id });
  if (!data) { hardLeave(); return; }
  const wasWaiting = R.status === "waiting";

  // 누가 들어오고 나갔는지 대화창에 남긴다
  const before = new Set(R.players.map((p) => p.username));
  const after = new Set(data.players.map((p) => p.username));
  after.forEach((n) => { if (!before.has(n)) Chat.system(`${n} 님이 들어왔습니다.`); });
  before.forEach((n) => { if (!after.has(n)) Chat.system(`${n} 님이 나갔습니다.`); });

  R = data;
  R.players.forEach((p) => {
    const s = live[p.user_id] || (live[p.user_id] = { filled: 0, hints: 0, done: false, ms: 0 });
    if (p.finished_at) { s.done = true; s.ms = p.finish_ms; s.filled = total(); }
  });
  // 브로드캐스트를 놓친 사이 시작됐다면 여기서 따라잡는다
  if (wasWaiting && R.status === "playing" && R.puzzle && !Game.isMatch()) {
    beginMatch({ puzzle: R.puzzle, solution: R.solution, size: R.size, level: R.level, late: true });
  }
  render();
  renderMatchBar();
}

/* ── 방 화면 ── */

function renderRoom() {
  const waiting = R.status === "waiting";
  const meDone = live[uid()] && live[uid()].done;

  $("#roomBody").innerHTML = `<div class="panel">
    <div class="panel-head">
      <h2>${esc(R.title)} ${R.is_private ? '<span class="lock">🔒</span>' : ""}</h2>
      <p>${R.size}×${R.size} · ${LEVELS[R.level]} · 정원 ${R.max_players}명
         ${PRESET_SIZES.includes(R.size) ? "" : " · <b>이 규격은 랭킹 보드가 없습니다</b>"}</p>
    </div>

    ${waiting ? `<div class="lobby-actions" style="align-items:center">
      <span class="code">${esc(R.code)}</span>
      <span class="hint">${R.is_private ? "코드와 입장 암호를 함께 알려 주세요." : "이 코드로도 들어올 수 있습니다."}</span>
      <span class="grow"></span>
      ${isHost() ? `<button class="btn primary" id="startBtn">시작</button>` : ""}
      <button class="btn" id="leaveBtn">나가기</button>
    </div>` : `<div class="lobby-actions" style="align-items:center">
      <span class="hint">${R.status === "finished" ? "모두 끝났습니다." : "진행 중입니다."}</span>
      <span class="grow"></span>
      <button class="btn" id="toBoardBtn">판으로</button>
      <button class="btn" id="leaveBtn">${meDone || R.status === "finished" ? "나가기" : "기권하고 나가기"}</button>
    </div>`}

    <div class="seatlist" id="seatList"></div>

    ${waiting && isHost() && R.players.length < 2 && R.max_players > 1
      ? `<div class="empty" style="padding:18px">아직 혼자입니다. 코드를 알려 주고 기다리거나, 그대로 시작해도 됩니다.</div>` : ""}
  </div>`;

  if ($("#startBtn")) $("#startBtn").onclick = hostStart;
  if ($("#leaveBtn")) $("#leaveBtn").onclick = confirmLeave;
  if ($("#toBoardBtn")) $("#toBoardBtn").onclick = () => showTab("game");

  renderSeats();
}

function seatHtml(p) {
  const s = live[p.user_id] || { filled: base, hints: 0, done: false };
  // 처음부터 주어진 칸은 빼고 각자 푼 몫만 잰다 — 모두 0%에서 출발한다
  const mine = total() - base;
  const pct = s.done ? 100 : (mine > 0 ? Math.round((Math.max(0, s.filled - base) / mine) * 100) : 0);
  // 아직 presence 가 한 번도 안 왔으면 아무도 끊긴 것으로 보지 않는다. 나 자신도 마찬가지.
  const gone = presenceSynced && R.status !== "waiting"
    && p.user_id !== uid() && !online.has(p.user_id) && !s.done;
  return `<div class="seat${p.user_id === uid() ? " me" : ""}${s.done ? " done" : ""}` +
    `${p.user_id === R.host_id ? " host" : ""}${gone ? " gone" : ""}">
      <span class="sn">${p.seat + 1}</span>
      <span class="snm">${esc(p.username)}</span>
      ${R.status === "waiting" ? `<span class="grow"></span>` : `
        <span class="gauge"><i style="width:${pct}%"></i></span>
        <span class="pct">${pct}%</span>`}
      <span class="tags">
        ${s.hints ? `<span class="badge">힌트 ${s.hints}</span>` : ""}
        ${s.done ? `<span class="fin">${fmtPrecise(s.ms)}${s.rank ? ` · ${s.rank}위` : ""}</span>` : ""}
      </span>
    </div>`;
}

function renderSeats() {
  const list = $("#seatList");
  if (list && R) list.innerHTML = R.players.map((p) => seatHtml(p)).join("");
  renderMatchBar();
}

/** 전장 탭 위에 뜨는 전황 띠 */
function renderMatchBar() {
  const bar = $("#matchBar");
  if (!bar) return;
  if (!R || R.status === "waiting" || !Game.isMatch()) { bar.hidden = true; return; }

  bar.hidden = false;
  bar.innerHTML = `<div class="mb-head">
      <b>전황</b>
      <span>${esc(R.title)} · ${R.size}×${R.size} · ${LEVELS[R.level]}</span>
      <button class="btn" id="mbRoom">방 보기</button>
    </div>
    ${R.players.map((p) => seatHtml(p)).join("")}`;
  $("#mbRoom").onclick = () => showTab("room");
}

/* ══════════════ 시작 ══════════════ */

async function hostStart() {
  const btn = $("#startBtn");
  btn.disabled = true; btn.textContent = "판 만드는 중…";
  veil(`<div class="spin"></div><h2>전장 편성 중</h2>
        <p>${R.size}×${R.size} · ${LEVELS[R.level]}<br>모두에게 같은 판이 배포됩니다.</p>`);

  // 생성은 무겁다 — 화면이 한 번 그려진 뒤에 돌린다
  await new Promise((r) => setTimeout(r, 50));

  let d;
  try {
    d = Game.regenerate(R.size, R.size, R.level);
  } catch {
    hideVeil(); btn.disabled = false; btn.textContent = "시작";
    toast("판을 만들지 못했습니다. 규격을 줄여 보세요.");
    return;
  }

  try {
    const sb = await client();
    const { error } = await sb.rpc("start_room", { p_room: R.id, p_puzzle: d.puzzle, p_solution: d.solution });
    if (error) throw error;
  } catch (e) {
    hideVeil(); btn.disabled = false; btn.textContent = "시작";
    toast(readableError(e));
    return;
  }

  const payload = { puzzle: d.puzzle, solution: d.solution, grade: d.grade, size: R.size, level: R.level };
  chan.send({ type: "broadcast", event: "start", payload });
  beginMatch(payload);
}

/** 판을 받아 3초 카운트다운 뒤 동시에 출발한다.
    벽시계 대신 각자 수신 시점에서 세는 이유: 기기마다 시계가 어긋나 있어도
    브로드캐스트 지연은 수십 ms 수준이라 몇 분짜리 퍼즐에서는 무시할 수 있다. */
function beginMatch(p) {
  if (!R || !p || !p.puzzle) return;
  if (Game.isMatch() && !p.late) { /* 이미 진행 중 */ }

  R.status = "playing";
  R.puzzle = p.puzzle; R.solution = p.solution;
  base = countGiven(p.puzzle);
  R.players.forEach((q) => { live[q.user_id] = { filled: base, hints: 0, done: false, ms: 0 }; });

  const startNow = () => {
    hideVeil();
    $("#veil").dataset.locked = "";
    showTab("game");                       // 판 크기를 재려면 먼저 보여야 한다
    Game.startMatch({
      W: R.size, H: R.size, level: R.level, grade: p.grade || R.level,
      puzzle: p.puzzle, solution: p.solution, roomId: R.id,
    }, p.late ? readMatchSave(R.id) : null);
    render();
    renderMatchBar();
  };

  if (p.late) { startNow(); toast("이미 시작된 대전에 합류했습니다."); return; }
  Chat.system("대전이 시작되었습니다.");

  let n = 3;
  $("#veil").dataset.locked = "1";
  const tick = () => {
    if (n > 0) {
      veil(`<h2>곧 시작합니다</h2><div class="countdown">${n}</div>
            <p>${R.size}×${R.size} · ${LEVELS[R.level]}</p>`);
      n--;
      countdownTimer = setTimeout(tick, 900);
    } else {
      startNow();
    }
  };
  tick();
}

/** 채팅 한 줄 내보내기. 내 화면에는 바로 띄우고, 채널로 흘려보낸다. */
function sendChat(text) {
  Chat.receive({ name: myName(), text, mine: true });
  if (chan) chan.send({ type: "broadcast", event: "chat", payload: { u: uid(), t: text } });
}

/* ══════════════ 진행률 · 완주 ══════════════ */

let lastSent = 0, sendTimer = null, lastPayload = null;

/** 채운 칸 수와 힌트 사용 횟수만 내보낸다. */
function reportProgress(s) {
  if (!R || !chan || !Game.isMatch() || R.status !== "playing") return;
  const mine = live[uid()] || (live[uid()] = {});
  mine.filled = s.filled; mine.hints = s.hints;
  renderSeats();

  lastPayload = { u: uid(), f: s.filled, h: s.hints };
  const now = Date.now();
  const wait = Math.max(0, PROGRESS_INTERVAL - (now - lastSent));
  clearTimeout(sendTimer);
  sendTimer = setTimeout(() => {
    if (!chan || !lastPayload) return;
    lastSent = Date.now();
    chan.send({ type: "broadcast", event: "progress", payload: lastPayload });
  }, wait);
}

async function onWin(s) {
  if (!R || !Game.isMatch() || s.roomId !== R.id) return;

  const mine = live[uid()] || (live[uid()] = {});
  mine.done = true; mine.ms = Math.round(s.ms); mine.filled = total();

  let rank = null;
  try {
    const sb = await client();
    const { data } = await sb.rpc("finish_room", {
      p_room: R.id, p_ms: Math.round(s.ms), p_hints: s.hints,
    });
    rank = data;
  } catch (e) { console.warn("[room] 완주 등록 실패", e); }

  mine.rank = rank;
  if (chan) chan.send({ type: "broadcast", event: "finish", payload: { u: uid(), ms: Math.round(s.ms), r: rank } });
  renderSeats();

  const others = R.players.filter((p) => p.user_id !== uid());
  const left = others.filter((p) => !(live[p.user_id] || {}).done).length;

  setTimeout(() => {
    veil(`<h2>완주</h2>
      <p>${R.size}×${R.size} · ${LEVELS[R.level]}</p>
      <div class="stats">
        <div class="stat">소요 시간<b>${fmt(s.ms)}</b></div>
        ${rank ? `<div class="stat">순위<b>${rank}위</b></div>` : ""}
        <div class="stat">쓴 힌트<b>${s.hints}</b></div>
      </div>
      <div class="card-slot" id="winSlot"></div>
      <p class="hint" style="text-align:center">${left
        ? `아직 ${left}명이 풀고 있습니다. 전황을 지켜볼 수 있습니다.`
        : "모두 끝났습니다."}</p>
      <div class="card-actions">
        <button class="btn primary" id="watchBtn">전황 보기</button>
        <button class="btn" id="outBtn">방 나가기</button>
      </div>`);
    $("#watchBtn").onclick = () => { hideVeil(); showTab("room"); };
    $("#outBtn").onclick = () => { hideVeil(); doLeave(); };
  }, 700 + R.size * 2 * 36);

  refreshState();
}

/* ══════════════ 나가기 ══════════════ */

function confirmLeave() {
  const playing = R.status === "playing" && !(live[uid()] || {}).done;
  if (!playing) { doLeave(); return; }
  veil(`<h2>기권하고 나가시겠습니까?</h2>
    <p>지금 나가면 이 판의 기록은 남지 않습니다.</p>
    <div class="card-actions">
      <button class="btn primary" id="stayBtn">계속 풀기</button>
      <button class="btn" id="goBtn">나가기</button>
    </div>`);
  $("#stayBtn").onclick = hideVeil;
  $("#goBtn").onclick = () => { hideVeil(); doLeave(); };
}

async function doLeave() {
  const id = R ? R.id : null;
  try {
    const sb = await client();
    if (sb && id) {
      await sb.rpc("leave_room", { p_room: id });
      if (chan) chan.send({ type: "broadcast", event: "roster", payload: { by: uid() } });
    }
  } catch (e) { console.warn("[room] 나가기 실패", e); }
  hardLeave();
}

function hardLeave() {
  closeChannel();
  Chat.unmount();                 // 남은 대화를 버린다
  R = null; live = {}; online = new Set(); base = 0;
  Game.endMatch();
  $("#matchBar").hidden = true;
  render();
  startLobbyPolling();
}
