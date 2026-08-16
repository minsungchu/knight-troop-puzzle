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

const TIER = { low: "하", mid: "중", high: "상" };

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
    const { data } = await client().rpc("laser_my_rating");
    if (data) { myRating = data.rating; paintRating(data); }
  } catch { /* 급수는 없어도 대전은 된다 */ }
}

function paintRating(d) {
  const el = $("#vsRating");
  if (!el) return;
  el.innerHTML = `<b>${gradeName(d.rating)}</b> · ${d.rating}점` +
    (d.wins + d.losses ? ` · ${d.wins}승 ${d.losses}패` : "");
}

/* ══════════════ 로비 ══════════════ */

export async function renderLobby() {
  if (room) return;
  const body = $("#vsBody");
  if (!body) return;

  if (!ONLINE) { body.innerHTML = `<p class="hint">대전은 온라인 설정이 있어야 합니다.</p>`; return; }
  if (!uid()) { body.innerHTML = `<p class="hint">대전은 로그인해야 할 수 있습니다.</p>`; return; }
  if (!sets) { body.innerHTML = `<p class="hint">대전용 판 묶음을 불러오지 못했습니다.</p>`; return; }

  let rooms = [];
  try {
    const { data, error } = await client().from("laser_open_rooms").select("*");
    if (error) throw error;
    rooms = data || [];
  } catch (e) { console.warn(e); }

  body.innerHTML =
    `<div class="lz-bar">
       <button id="vsNew" class="on">방 만들기</button>
       <button id="vsCode">코드로 들어가기</button>
       <span style="flex:1"></span>
       <span id="vsRating" class="hint"></span>
     </div>
     <div class="panel">
       <h2>열린 방</h2>
       ${rooms.length ? `<table><thead><tr>
            <th>방</th><th>구성</th><th>인원</th><th></th></tr></thead><tbody>` +
         rooms.map((r) => `<tr>
            <td>${esc(r.title)}${r.is_private ? " 🔒" : ""}</td>
            <td class="num">하${r.n_low} 중${r.n_mid} 상${r.n_high}</td>
            <td class="num">${r.players} / ${r.max_players}</td>
            <td><button data-join="${r.code}" data-priv="${r.is_private ? 1 : 0}"
                 ${r.players >= r.max_players ? "disabled" : ""}>들어가기</button></td>
          </tr>`).join("") + `</tbody></table>`
        : `<div class="hint">기다리는 방이 없습니다. 하나 만들어 보세요.</div>`}
     </div>`;

  paintRating({ rating: myRating, wins: 0, losses: 0 });
  loadRating();
  $("#vsNew").onclick = openCreate;
  $("#vsCode").onclick = () => openJoin("");
  body.querySelectorAll("[data-join]").forEach((b) => {
    b.onclick = () => (+b.dataset.priv ? openJoin(b.dataset.join) : join(b.dataset.join, null));
  });
}

function openCreate() {
  veil(`<h3>방 만들기</h3>
    <label class="fld">방 이름<input id="cTitle" maxlength="20" placeholder="${esc(myName() || "")} 의 방"></label>
    <label class="fld">정원
      <select id="cMax"><option value="2">2인</option><option value="3">3인</option><option value="4">4인</option></select>
    </label>
    <div class="fld">판 구성 — 모두 합쳐 최대 10판
      <div class="lz-bar" style="margin-top:6px">
        <label>하 <input id="cLow" type="number" min="0" max="10" value="3" style="width:56px"></label>
        <label>중 <input id="cMid" type="number" min="0" max="10" value="3" style="width:56px"></label>
        <label>상 <input id="cHigh" type="number" min="0" max="10" value="3" style="width:56px"></label>
      </div>
      <div class="hint" id="cSum"></div>
    </div>
    <label class="fld"><input id="cPriv" type="checkbox"> 비밀방</label>
    <label class="fld" id="cPassWrap" hidden>입장 암호
      <input id="cPass" maxlength="20" autocomplete="off">
      <span class="hint">계정 비밀번호와 다른 것을 쓰세요. 이 암호는 평문으로 저장됩니다.</span>
    </label>
    <div class="row"><button id="cGo" class="on">만들기</button><button id="cNo">그만</button></div>`);

  const nums = ["#cLow", "#cMid", "#cHigh"].map((s) => $(s));
  const sum = () => nums.reduce((a, el) => a + (+el.value || 0), 0);
  const paint = () => {
    const t = sum();
    $("#cSum").innerHTML = t < 1 ? `<span class="bad">한 판 이상이어야 합니다</span>`
      : t > 10 ? `<span class="bad">모두 합쳐 10판까지입니다 (지금 ${t}판)</span>`
      : `모두 ${t}판`;
    $("#cGo").disabled = t < 1 || t > 10;
  };
  nums.forEach((el) => el.addEventListener("input", paint));
  paint();

  $("#cPriv").onchange = (e) => { $("#cPassWrap").hidden = !e.target.checked; };
  $("#cNo").onclick = hideVeil;
  $("#cGo").onclick = async () => {
    const priv = $("#cPriv").checked;
    try {
      const { data, error } = await client().rpc("laser_room_create", {
        p_title: $("#cTitle").value, p_private: priv,
        p_join_code: priv ? $("#cPass").value : null,
        p_max: +$("#cMax").value,
        p_low: +$("#cLow").value, p_mid: +$("#cMid").value, p_high: +$("#cHigh").value,
      });
      if (error) throw error;
      hideVeil();
      await enter(data[0].id);
    } catch (e) { toast(e.message || "방을 만들지 못했습니다."); }
  };
}

function openJoin(code) {
  veil(`<h3>방에 들어가기</h3>
    <label class="fld">입장 코드<input id="jCode" maxlength="6" value="${esc(code)}" style="text-transform:uppercase"></label>
    <label class="fld">암호 (비밀방만)<input id="jPass" maxlength="20" autocomplete="off"></label>
    <div class="row"><button id="jGo" class="on">들어가기</button><button id="jNo">그만</button></div>`);
  $("#jNo").onclick = hideVeil;
  $("#jGo").onclick = () => join($("#jCode").value, $("#jPass").value);
}

async function join(code, pass) {
  try {
    const { data, error } = await client().rpc("laser_room_join", { p_code: code, p_pass: pass || null });
    if (error) throw error;
    hideVeil();
    await enter(data);
  } catch (e) { toast(e.message || "들어가지 못했습니다."); }
}

/* ══════════════ 방 ══════════════ */

async function enter(id) {
  room = { id };
  await refresh();
  openChannel(id);
  clearInterval(poll);
  // 실시간이 끊겨도 방이 멈추지 않도록, 느슨하게 다시 확인한다
  poll = setInterval(refresh, 4000);
}

async function refresh() {
  if (!room) return;
  try {
    const { data, error } = await client().rpc("laser_room_state", { p_room: room.id });
    if (error) throw error;
    const was = room.status;
    room = { ...data, id: data.id };
    if (room.status === "playing" && was !== "playing") beginMatch();
    else if (room.status === "playing") paintScoreboard();
    else renderRoom();
  } catch (e) {
    console.warn(e);
    leaveLocal();
  }
}

function openChannel(id) {
  closeChannel();
  channel = client().channel(`laser-room-${id}`, { config: { presence: { key: uid() } } });
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
  $("#vsBody").innerHTML =
    `<div class="lz-bar">
       <button id="vsLeave">◂ 나가기</button>
       <strong style="font-family:var(--display); font-size:17px">${esc(room.title)}</strong>
       <span class="hint">입장 코드 <b style="user-select:all">${room.code}</b></span>
       <span style="flex:1"></span>
       ${host ? `<button id="vsStart" class="on" ${room.players.length < 2 ? "disabled" : ""}>시작</button>` : ""}
     </div>
     <div class="panel">
       <h2>구성</h2>
       <div class="hint">하 ${room.n_low}판 · 중 ${room.n_mid}판 · 상 ${room.n_high}판 — 모두 ${total}판.
         <b>먼저 전부 깨는 사람이 이깁니다.</b> 판은 모두에게 같은 순서로 나옵니다.</div>
     </div>
     <div class="panel">
       <h2>참가자 (${room.players.length} / ${room.max_players})</h2>
       <table><tbody>${room.players.map((p) => `<tr>
         <td>${esc(p.name)}${p.id === room.host ? " <span class='hint'>방장</span>" : ""}</td>
         <td class="num">${gradeName(p.rating)}</td>
         <td class="num">${p.rating}점</td>
       </tr>`).join("")}</tbody></table>
       ${room.players.length < 2 ? `<div class="hint">두 명이 모여야 시작할 수 있습니다.</div>` : ""}
     </div>`;

  $("#vsLeave").onclick = leave;
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
    const { error } = await client().rpc("laser_room_start", {
      p_room: room.id, p_boards: JSON.stringify(picked),
    });
    if (error) throw error;
    shout("state");
    await refresh();
  } catch (e) { toast(e.message || "시작하지 못했습니다."); }
}

/* ══════════════ 대전 진행 ══════════════ */

function beginMatch() {
  boards = JSON.parse(room.boards || "[]");
  idx = 0;
  startedAt = performance.now();
  renderMatch();
  openBoard();
}

function renderMatch() {
  $("#vsBody").innerHTML =
    `<div class="lz-bar">
       <button id="vsLeave">기권하고 나가기</button>
       <strong id="vsWhich" style="font-family:var(--display); font-size:17px"></strong>
       <span style="flex:1"></span>
       <button id="vsUndo">되돌리기</button>
       <button id="vsClear">전부 치우기</button>
     </div>
     <div id="vsScore" class="panel" style="padding:12px 16px"></div>
     <div class="lz-goal" id="vsGoal"></div>
     <div class="lz-head"><span>경과<b id="vsTime">0.0초</b></span></div>
     <div class="lz-stage"><div class="lz-board" id="vsBoard"></div></div>
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
  el.innerHTML = room.players.map((p) => {
    const pct = Math.round((p.solved / total) * 100);
    const mine = p.id === uid();
    return `<div style="margin:6px 0">
      <div style="display:flex; justify-content:space-between; font-size:12.5px">
        <span>${esc(p.name)}${mine ? " <span class='hint'>(나)</span>" : ""}</span>
        <span class="num">${p.solved} / ${total}${p.finish_ms ? " · 완주" : ""}</span>
      </div>
      <div style="height:7px; border-radius:99px; background:rgba(255,255,255,.08); overflow:hidden">
        <div style="height:100%; width:${pct}%; background:${mine ? "var(--brass)" : "#6fe3b0"}"></div>
      </div></div>`;
  }).join("");
}

async function onBoardWin() {
  Sfx.win?.();
  idx++;
  try { await client().rpc("laser_room_progress", { p_room: room.id, p_solved: idx }); } catch {}
  shout("progress", { id: uid(), solved: idx });

  if (idx < boards.length) {
    $("#vsDone").hidden = false;
    $("#vsDone").innerHTML = `<b>${idx}판째 통과</b> — 다음 판입니다.`;
    setTimeout(() => { if (room?.status === "playing") openBoard(); }, 700);
    return;
  }

  // 다 깼다
  clearInterval(poll);
  const ms = Math.round(performance.now() - startedAt);
  let deltas = [];
  try {
    const { data } = await client().rpc("laser_room_finish", { p_room: room.id, p_ms: ms });
    deltas = data || [];
  } catch (e) { console.warn(e); }
  shout("state");
  showResult(ms, deltas);
}

function showResult(ms, deltas) {
  const mine = deltas.find((d) => d.id === uid());
  const won = mine && mine.pos === 1;
  $("#vsDone").hidden = false;
  $("#vsDone").innerHTML =
    `<b>${won ? "이겼습니다" : "다 깼습니다"}</b> — ${(ms / 1000).toFixed(1)}초` +
    (mine ? `<div style="margin-top:6px">${gradeName(mine.before)} ${mine.before}점 →
       <b>${gradeName(mine.after)} ${mine.after}점</b> (${mine.delta >= 0 ? "+" : ""}${mine.delta})</div>` : "") +
    `<div class="lz-bar" style="justify-content:center"><button id="vsBack">방 목록으로</button></div>`;
  $("#vsBack").onclick = leaveLocal;
  loadRating();
}

/* ══════════════ 나가기 ══════════════ */

async function leave() {
  try { await client().rpc("laser_room_leave", { p_room: room.id }); } catch {}
  shout("state");
  leaveLocal();
}

function leaveLocal() {
  clearInterval(poll);
  closeChannel();
  board?.destroy();
  board = null;
  room = null;
  boards = [];
  renderLobby();
}
