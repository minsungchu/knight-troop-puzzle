/* 대결 — 둘이서 같은 판을 나란히 치고, 먼저 끝낸 쪽이 이긴다.
 *
 * 방을 만들면 여섯 자리 코드가 나온다. 그 코드를 친구에게 알려 주면 들어온다.
 * 정원은 둘로 못박았다 — 셋이 붙으면 꼴찌가 일찍 포기하고, 초등학생 둘이서 노는
 * 것이 이 게임이 상상하는 자리다.
 *
 * 상대를 방해하는 수단은 없다. 두 사람에게 똑같은 글, 똑같은 적이 똑같은 순서로
 * 간다. 그래야 진 아이가 "왜 졌는지"를 납득한다.
 *
 * 급수(점수)는 두지 않았다. 이 게임은 "정확도만 넘으면 통과, 못한다고 겁주지
 * 않는다"를 원칙으로 잡았는데, 지면 점수가 깎여 내려가는 장치는 그것과 정면으로
 * 부딪힌다. 몇 번 이기고 졌는지만 센다.
 */
import { $, esc, toast, veil, hideVeil } from "../ui.js";
import { client, ONLINE, uid, myName, onAuth } from "../supabase.js";
import * as Sfx from "../sound.js";
import * as KB from "./keyboard.js";
import * as Topics from "./topics.js";
import * as Texts from "./texts.js";
import * as Trainer from "./trainer.js";
import { capture } from "./input.js";
import { analyze } from "./hangul.js";
import { run, CASTLE_SVG, hearts } from "./castlefield.js";
import { MODES, isMode, buildWrite, buildCastle, foePace, rank, pct, CASTLE_HP } from "./duelmatch.js";

let body = null;
let room = null;        // 지금 들어와 있는 방
let channel = null;
let poll = null;
let match = null;       // 진행 중인 판 (trainer 손잡이 또는 성 지키기 판)
let startedAt = 0;
let sentAt = 0;
let myProgress = 0;
let record = { wins: 0, losses: 0, draws: 0 };
/* 내가 먼저 끝냈을 때의 성적. 상대가 아직 치는 중이면 결과를 낼 수 없어서
   붙잡아 두었다가, 방이 닫히는 것을 보고 그때 승패를 그린다. */
let pending = null;

export function init() {
  body = $("#tyDuelBody");
  onAuth(() => { if (!room) { loadRecord(); renderLobby(); } });
}

export function home() {
  if (!body) return;
  if (room) leave();
  else renderLobby();
}

async function loadRecord() {
  if (!ONLINE || !uid()) { record = { wins: 0, losses: 0, draws: 0 }; return; }
  try {
    const { data } = await (await client()).rpc("type_my_duel_record");
    if (data) record = data;
  } catch { /* 전적은 없어도 대결은 된다 */ }
}

/* ══════════════ 로비 ══════════════ */

export async function renderLobby() {
  if (!body || room) return;

  if (!ONLINE) {
    body.innerHTML = `<div class="panel"><div class="panel-head"><h2>대결</h2>
      <p>대결은 온라인 설정이 있어야 합니다. 혼자 하는 익히기·낱말·글쓰기·성 지키기는 그대로 됩니다.</p>
      </div></div>`;
    return;
  }
  if (!uid()) {
    body.innerHTML = `<div class="panel"><div class="panel-head"><h2>대결</h2>
      <p>대결은 로그인해야 할 수 있습니다. 오른쪽 위에서 로그인해 주세요.</p></div></div>`;
    return;
  }

  let rooms = [];
  try {
    const { data, error } = await (await client()).from("type_open_rooms").select("*");
    if (error) throw error;
    rooms = data || [];
  } catch (e) { console.warn(e); }

  const r = record;
  body.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>대결</h2>
        <p>둘이서 똑같은 판을 나란히 칩니다. 방해하는 수단은 없고, 오직 빠르기로만 겨룹니다.
           ${r.wins + r.losses + r.draws ? `지금까지 <b>${r.wins}승 ${r.losses}패${r.draws ? ` ${r.draws}무` : ""}</b>.` : "아직 대결한 적이 없습니다."}</p>
      </div>
      <div class="lobby-actions">
        <button class="btn primary" data-new>방 만들기</button>
        <button class="btn" data-code>코드로 들어가기</button>
      </div>
      <div class="panel-body">
        <h3 class="ty-h3">기다리는 방 (${rooms.length})</h3>
        ${rooms.length ? `<div class="ty-list">${rooms.map((x) => `
          <div class="ty-item ty-item-row">
            <button class="ty-item-open" data-join="${esc(x.code)}" ${x.players >= 2 ? "disabled" : ""}>
              <span class="ty-item-name">${esc(x.title)}</span>
              <span class="ty-item-sub">${esc(MODES[x.mode]?.name || x.mode)} · ${x.players}/2명</span>
            </button>
            <span class="ty-item-code">${esc(x.code)}</span>
          </div>`).join("")}</div>`
         : `<div class="empty">기다리는 방이 없습니다. 하나 만들어 친구에게 코드를 알려 주세요.</div>`}
      </div>
    </div>`;

  body.querySelector("[data-new]").onclick = openCreate;
  body.querySelector("[data-code]").onclick = () => openJoin("");
  body.querySelectorAll("[data-join]").forEach((b) => { b.onclick = () => join(b.dataset.join); });
}

function openCreate() {
  veil(`<h2>방 만들기</h2>
    <div class="form">
      <div class="field"><label>무엇으로 겨룰까요</label>
        <select id="dMode">
          <option value="write">${MODES.write.name} — ${MODES.write.desc}</option>
          <option value="castle">${MODES.castle.name} — ${MODES.castle.desc}</option>
        </select></div>
      <div class="field"><label>방 이름</label>
        <input id="dTitle" maxlength="20" placeholder="${esc(myName() || "")} 의 방"></div>
    </div>
    <p class="hint">방을 만들면 여섯 자리 코드가 나옵니다. 친구에게 그 코드를 알려 주세요.</p>
    <div class="card-actions">
      <button class="btn primary" id="dGo">만들기</button>
      <button class="btn" id="dNo">그만</button>
    </div>`, { wide: true });
  $("#dNo").onclick = hideVeil;
  $("#dGo").onclick = async () => {
    try {
      const { data, error } = await (await client()).rpc("type_room_create", {
        p_title: $("#dTitle").value, p_mode: $("#dMode").value,
      });
      if (error) throw error;
      hideVeil();
      await enter(data.id);
    } catch (e) { toast(e.message || "방을 만들지 못했습니다."); }
  };
}

function openJoin(code) {
  veil(`<h2>방에 들어가기</h2>
    <div class="form">
      <div class="field"><label>입장 코드</label>
        <input id="jCode" maxlength="6" value="${esc(code)}" style="text-transform:uppercase" autocomplete="off"></div>
    </div>
    <div class="card-actions">
      <button class="btn primary" id="jGo">들어가기</button>
      <button class="btn" id="jNo">그만</button>
    </div>`);
  $("#jNo").onclick = hideVeil;
  $("#jGo").onclick = () => join($("#jCode").value);
}

async function join(code) {
  try {
    const { data, error } = await (await client()).rpc("type_room_join", { p_code: code });
    if (error) throw error;
    hideVeil();
    await enter(data);
  } catch (e) { toast(e.message || "들어가지 못했습니다."); }
}

/* ══════════════ 방 ══════════════ */

async function enter(id) {
  room = { id };
  await refresh();
  await openChannel(id);
  clearInterval(poll);
  // 실시간이 끊겨도 방이 멈추지 않도록 느슨하게 다시 확인한다
  poll = setInterval(refresh, 3000);
}

async function refresh() {
  if (!room) return;
  try {
    const { data, error } = await (await client()).rpc("type_room_state", { p_room: room.id });
    if (error) throw error;
    const was = room.status;
    room = { ...data, id: data.id };
    if (room.status === "playing" && was !== "playing") { pending = null; beginMatch(); }
    else if (room.status === "playing") paintScore();
    else if (room.status === "finished") {
      /* 먼저 끝내고 기다리던 참이라면, 방이 닫히는 지금 승패를 그려 준다.
         이걸 안 하면 빨리 친 아이가 "상대를 기다리는 중"에서 영영 멈춘다.
         전적은 상대가 끝난 뒤에야 서버에 적히므로 여기서 다시 읽는다 —
         안 그러면 이긴 아이에게 방금 이긴 판이 빠진 전적이 보인다. */
      if (pending) {
        const p = pending; pending = null;
        loadRecord().then(() => showResult(p.done, p.acc, p.ms, localRanks()));
      } else paintScore();
    }
    else renderRoom();
  } catch (e) {
    console.warn(e);
    leaveLocal();
  }
}

async function openChannel(id) {
  closeChannel();
  channel = (await client()).channel(`type-room-${id}`, { config: { presence: { key: uid() } } });
  channel.on("broadcast", { event: "state" }, () => refresh());
  channel.on("broadcast", { event: "progress" }, ({ payload }) => {
    const p = room?.players?.find((x) => x.id === payload.id);
    if (p) { p.progress = Math.max(p.progress, payload.progress); paintScore(); }
  });
  channel.subscribe();
}

function closeChannel() { try { channel?.unsubscribe(); } catch {} channel = null; }
const shout = (event, payload = {}) => channel?.send({ type: "broadcast", event, payload });

function renderRoom() {
  const host = room.host === uid();
  const mode = MODES[room.mode] || { name: room.mode, desc: "" };
  const ready = room.players.length >= 2;
  body.innerHTML = `
    <div class="ty-bar">
      <button class="btn" data-leave>◂ 나가기</button>
      <strong class="ty-title">${esc(room.title)}</strong>
      <span class="grow"></span>
      <span class="hint">입장 코드 <b class="ty-code" style="user-select:all">${esc(room.code)}</b></span>
    </div>
    <div class="panel" style="margin-top:14px">
      <div class="panel-head"><h2>${esc(mode.name)}</h2><p>${esc(mode.desc)}</p></div>
      <div class="panel-body">
        <h3 class="ty-h3">참가자 (${room.players.length} / 2)</h3>
        <div class="ty-list">${room.players.map((p) => `
          <div class="ty-item">
            <span class="ty-item-name">${esc(p.name)}${p.id === room.host ? " <span class='hint'>방장</span>" : ""}${p.id === uid() ? " <span class='hint'>(나)</span>" : ""}</span>
            <span class="ty-item-sub">${p.wins}승 ${p.losses}패${p.draws ? ` ${p.draws}무` : ""}</span>
          </div>`).join("")}</div>
        ${ready ? "" : `<div class="hint" style="margin-top:12px">친구가 <b>${esc(room.code)}</b> 코드로 들어오면 시작할 수 있습니다.</div>`}
        ${host ? `<div class="card-actions" style="justify-content:flex-start">
            <button class="btn primary" data-start ${ready ? "" : "disabled"}>시작</button>
          </div>`
          : `<div class="hint" style="margin-top:12px">방장이 시작하기를 기다리는 중입니다.</div>`}
      </div>
    </div>`;
  body.querySelector("[data-leave]").onclick = leave;
  const s = body.querySelector("[data-start]");
  if (s) s.onclick = start;
}

/* ══════════════ 시작 ══════════════ */

async function start() {
  try {
    const plan = room.mode === "write"
      ? buildWrite(Texts.textsFor(chosenTopics()) , { strokes: (l) => analyze(l).strokes })
      : buildCastle(Topics.words());
    const { error } = await (await client()).rpc("type_room_start", {
      p_room: room.id, p_payload: JSON.stringify(plan), p_total: plan.total,
    });
    if (error) throw error;
    shout("state");
    await refresh();
  } catch (e) { toast(e.message || "시작하지 못했습니다."); }
}

const chosenTopics = () => {
  const on = new Set(Topics.topics().filter((t) => Topics.isOn(t.id)).map((t) => t.id));
  return Texts.textsFor(on).length ? on : null;   // 고른 주제에 글이 없으면 전부에서 뽑는다
};

/* ══════════════ 진행 ══════════════ */

function beginMatch() {
  const plan = JSON.parse(room.payload || "{}");
  startedAt = performance.now();
  myProgress = 0;
  sentAt = 0;
  if (!isMode(plan.mode)) { toast("판을 읽지 못했습니다."); leaveLocal(); return; }
  (plan.mode === "write" ? beginWrite : beginCastle)(plan);
}

/** 진행을 알린다. 매 타마다 보내면 너무 잦아서, 잠깐씩 묶어 보낸다. */
function report(progress, force) {
  myProgress = Math.max(myProgress, progress);
  const now = performance.now();
  if (!force && now - sentAt < 700) return;
  sentAt = now;
  const me = room?.players?.find((p) => p.id === uid());
  if (me) me.progress = Math.max(me.progress, myProgress);
  paintScore();
  shout("progress", { id: uid(), progress: myProgress });
  (async () => {
    try { await (await client()).rpc("type_room_progress", { p_room: room.id, p_progress: myProgress }); }
    catch (e) { console.warn(e); }
  })();
}

function scoreHTML() {
  if (!room?.players) return "";
  const total = room.total || 1;
  const unit = MODES[room.mode]?.unit || "";
  return room.players.map((p) => {
    const mine = p.id === uid();
    const v = mine ? Math.max(p.progress || 0, myProgress) : (p.progress || 0);
    return `<div class="ty-race${mine ? " me" : ""}">
      <div class="ty-race-head">
        <span>${esc(p.name)}${mine ? " (나)" : ""}</span>
        <span class="num">${v} / ${total}${unit}${p.done_ms ? " · 완주" : ""}</span>
      </div>
      <div class="ty-race-bar"><div style="width:${pct(v, total)}%"></div></div>
    </div>`;
  }).join("");
}

function paintScore() {
  if (match?.setScore) match.setScore(scoreHTML());
  const el = body.querySelector("[data-score]");
  if (el && !match?.setScore) el.innerHTML = scoreHTML();
}

/* ── 글쓰기 대결 ── */

function beginWrite(plan) {
  match = Trainer.start(body, {
    title: `${MODES.write.name} · ${plan.title}`,
    backLabel: "기권하고 나가기",
    lines: plan.lines,
    scoreSlot: true,
    onQuit: giveUp,
    onProgress: (hits) => report(hits, false),
    onDone: (s) => {
      report(plan.total, true);
      finish(true, s.acc);
    },
  });
  paintScore();
}

/* ── 성 지키기 대결 ── */

function beginCastle(plan) {
  body.innerHTML = `
    <div class="ty-bar">
      <button class="btn" data-quit>◂ 기권하고 나가기</button>
      <strong class="ty-title">${esc(MODES.castle.name)}</strong>
      <span class="grow"></span>
      <span class="ty-hp" data-hp></span>
    </div>
    <div class="ty-score" data-score></div>
    <div class="ty-field" data-field>${CASTLE_SVG}</div>
    <div class="ty-finger" data-finger>&nbsp;</div>
    <div data-kb></div>`;

  const kb = body.querySelector("[data-kb]");
  KB.render(kb);
  const field = run(body.querySelector("[data-field]"), {
    kb,
    total: plan.total,
    hp: plan.hp || CASTLE_HP,
    nextWord: (i) => plan.words[i] || null,
    pace: foePace,
    markOf: (w) => Topics.markOf(w),
    onHint: (h) => { body.querySelector("[data-finger]").textContent = h; },
    onKill: ({ kills }) => report(kills, false),
    onUpdate: (s) => { body.querySelector("[data-hp]").innerHTML = hearts(s.hp, plan.hp || CASTLE_HP); },
    onEnd: (r) => { report(r.kills, true); finish(r.cleared, r.acc); },
  });
  match = { field, stop: () => field.stop() };
  body.querySelector("[data-quit]").onclick = giveUp;
  paintScore();
}

/* ══════════════ 끝 ══════════════ */

/** 방 안의 진행만 보고 등수를 매긴다. 서버가 이미 매겨 둔 것과 같은 규칙이고,
 *  전적은 서버가 쓴다 — 여기서 하는 일은 화면에 보여 주는 것뿐이다. */
function localRanks() {
  if (!room?.players) return [];
  const r = rank(room.players.map((p) => ({ id: p.id, progress: p.progress, done_ms: p.done_ms })));
  const firsts = r.filter((x) => x.pos === 1).length;
  return r.map((x) => ({ ...x, draw: firsts > 1 && x.pos === 1 }));
}

async function finish(done, acc) {
  const ms = Math.round(performance.now() - startedAt);
  let res = [];
  try {
    const { data } = await (await client()).rpc("type_room_finish", {
      p_room: room.id, p_ms: ms, p_done: !!done,
    });
    res = data || [];
  } catch (e) { console.warn(e); }
  shout("state");
  await loadRecord();
  // 결과가 안 나왔다면 상대가 아직 치는 중이다. 방이 닫히면 refresh 가 이어 그린다.
  pending = res.length ? null : { done, acc, ms };
  showResult(done, acc, ms, res);
}

function showResult(done, acc, ms, res) {
  match?.stop?.();
  const mine = res.find((x) => x.id === uid());
  const waiting = !res.length;
  const won = mine && mine.pos === 1 && !mine.draw;
  const drew = mine && mine.draw;
  const host = room.host === uid();

  const head = waiting ? "다 쳤어요! 상대를 기다리는 중"
    : drew ? "비겼어요"
    : won ? "이겼어요!"
    : done ? "졌어요 — 아깝다"
    : "성이 무너졌어요";

  body.innerHTML = `
    <div class="ty-done">
      <h2>${head}</h2>
      ${waiting ? `<p class="hint">상대가 끝내면 결과가 나옵니다.</p>` : ""}
      <div class="ty-score" data-score></div>
      <div class="stats">
        <div class="stat">걸린 시간<b>${(ms / 1000).toFixed(1)}초</b></div>
        <div class="stat">정확도<b>${acc}%</b></div>
        <div class="stat">전적<b>${record.wins}승 ${record.losses}패</b></div>
      </div>
      <div class="card-actions">
        ${!waiting && host ? `<button class="btn primary" data-again>한 판 더</button>` : ""}
        ${!waiting && !host ? `<span class="hint">방장이 '한 판 더'를 누르면 다시 시작합니다.</span>` : ""}
        <button class="btn" data-leave>방에서 나가기</button>
      </div>
    </div>`;
  match = null;
  paintScore();
  body.querySelector("[data-leave]").onclick = leave;
  const a = body.querySelector("[data-again]");
  if (a) a.onclick = rematch;
  if (won) Sfx.win();
}

async function rematch() {
  try {
    const { error } = await (await client()).rpc("type_room_rematch", { p_room: room.id });
    if (error) throw error;
    shout("state");
    await refresh();
  } catch (e) { toast(e.message || "다시 시작하지 못했습니다."); }
}

/* ══════════════ 나가기 ══════════════ */

function giveUp() {
  // 기권도 '끝낸 것'으로 알려야 상대가 무한정 기다리지 않는다
  if (room?.status === "playing") { finish(false, 0).then(leave); return; }
  leave();
}

async function leave() {
  const id = room?.id;
  leaveLocal();
  if (id) {
    try { await (await client()).rpc("type_room_leave", { p_room: id }); } catch {}
    shout("state");
  }
}

function leaveLocal() {
  clearInterval(poll);
  poll = null;
  pending = null;
  closeChannel();
  match?.stop?.();
  match = null;
  capture(null);
  Trainer.stop();
  room = null;
  renderLobby();
}
