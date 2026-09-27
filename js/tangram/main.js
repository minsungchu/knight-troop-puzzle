/* 칠교 마을 진입점 — 퀘스트 진행과 화면 위 안내.
 *
 * 한 번에 퀘스트 하나만 한다. 퀘스트를 받으면 조각이 구역 곳곳에 떨어지고 시계가 돈다.
 * 조각을 주워(세 개까지) 제단에 올리고, 제단에서 틀을 채우면 끝. 분류 퀘스트는
 * 제단 대신 바구니에 직각삼각형만 넣는다.
 */

import { $, $$, showTab, onTab, toast, veil, hideVeil, esc, Store, fmt, fmtPrecise } from "../ui.js";
import * as Auth from "../auth.js";
import * as Sfx from "../sound.js";
import * as Saving from "../saving.js";
import { ONLINE, uid } from "../supabase.js";
import { KINDS } from "./shapes.js";
import { QUESTS, NPCS, ZONES, SPOTS, BASKET, piecesOf, isOpen } from "./quests.js";
import * as Progress from "./progress.js";
import * as StageRec from "./stages.js";
import * as Rank from "./rank.js";

const CARRY_MAX = 3;
const HINT_MS = 15000;
/* 같은 조각은 어느 퀘스트에서나 같은 색이다 — 큰 삼각형 둘, 중간, 작은 둘, 정사각형, 평행사변형 */
const COLORS = { L: [0xef476f, 0x118ab2], M: [0x8e6cd8], S: [0x06d6a0, 0xffd166], Q: [0xf78c3b], P: [0x4cc9f0] };

let W, Altar, Adventure;
let stageTab = "world";                // 3D 무대가 지금 어느 탭에 얹혀 있나
let run = null;                        // { q, start, penalty, basket, pieces: [{id, kind, color, at, place, spot}] }
let play = null;                       // 도전 한 판 { stage, start, hints, pieces }
let seq = 0;

$$(".tab[data-tab]").forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });
Sfx.listenForGesture();
Auth.init();
Progress.load();
StageRec.load();
Saving.mount("#saveNote", {
  sources: [{ src: Progress, patch: "supabase/patch-08-tangram.sql" }, { src: StageRec, patch: "supabase/patch-09-tangram-stages.sql" }],
  what: "모험·도전 기록",
});
Rank.init();
onTab((name) => {
  if (name === "rank") Rank.render();
  if (name === "adventure") Adventure?.render();
  // 무대가 얹힌 탭을 떠나면 풀던 판을 닫는다. 무대는 배우기와 도전 사이를 오간다.
  if (name !== stageTab && Altar?.isOpen()) Altar.close();
});

/* Three.js 는 CDN 에서 온다. 못 받으면 화면에 말한다 — 정적 import 로 두면 모듈 전체가 조용히 죽는다. */
Promise.all([import("./world.js"), import("./altar.js"), import("./adventure.js")]).then(([w, a, adv]) => {
  W = w; Altar = a; Adventure = adv;
  Adventure.init({ onStart: startStage });
  Adventure.render();
  W.init($("#tgStage"), { onFocus: focusChanged, onAction: act, onZone: zoneBanner });
  W.setFocusFilter((f) =>
    f.type === "altar" ? !!run && !run.q.sort && run.q.zone === f.zone
    : f.type === "basket" ? !!run && !!run.q.sort
    : true);
  W.openBridges(Progress.cleared(), false);
  refreshMarks();
  $("#tgLoading").hidden = true;
  // 좁은 화면에서는 머리말과 저장 안내가 조이스틱을 화면 밖으로 밀어낸다. 무대가 화면에 꽉 차게 내려 준다.
  // load 전에 내리면 새로고침의 스크롤 되살리기가 도로 맨 위로 올려 버린다.
  const down = () => { if (matchMedia("(max-width:520px)").matches) $("#tgStage").scrollIntoView({ block: "end" }); };
  if (document.readyState === "complete") down(); else addEventListener("load", () => setTimeout(down, 0), { once: true });
  bindControls();
  intro();
}).catch((e) => {
  console.error(e);
  $("#tgLoading").innerHTML = `<p><b>3D 화면을 불러오지 못했습니다.</b><br>인터넷 연결을 확인하고 새로고침해 보세요.</p>`;
});

document.addEventListener("tangram-progress", () => { if (W) { W.openBridges(Progress.cleared(), false); refreshMarks(); } });
document.addEventListener("tangram-stages", () => Adventure?.render());

/** 3D 무대를 탭 사이로 옮긴다. 도전 문제를 풀 때 배우기 탭으로 튕겨 나가지 않게 하려는 것이다.
 *  캔버스는 DOM 을 옮겨도 그리던 것을 그대로 들고 있다. */
function moveStage(tab) {
  if (tab === stageTab) return;
  const stage = $("#tgStage"), slot = $("#tgAdvStage"), keys = $(".tg-keys");
  if (tab === "adventure") {
    slot.hidden = false;
    slot.append(stage, keys);
    $("#tgAdvPanel").hidden = true;
  } else {
    $(".view[data-view='world']").prepend(stage);
    stage.after(keys);
    slot.hidden = true;
    $("#tgAdvPanel").hidden = false;
  }
  stageTab = tab;
}

/* ══════════════ 도전 한 판 ══════════════
   조각 모으기는 튜토리얼에서 끝났다. 여기서는 제단 화면만 열어 바로 맞춘다. */

function startStage(stage) {
  if (run) { toast(`먼저 「${run.q.title}」 부탁을 끝내 주세요.`); return; }
  if (Altar.isOpen()) Altar.close(true);
  moveStage("adventure");
  const seen = {};
  const pieces = stage.frame.map((f) => {
    const n = (seen[f.k] = (seen[f.k] || 0) + 1) - 1;
    return { id: ++seq, kind: f.k, color: COLORS[f.k][n], place: null };
  });
  play = { stage, start: performance.now(), hints: 0, pieces };
  const quest = { frame: stage.frame, title: stage.name };
  hud();
  Altar.open({
    zone: "village", quest, pieces,
    onSolved: async () => {
      const cur = play; play = null;
      hud();
      moveStage("world");
      await Adventure.finish(cur.stage, Math.round(performance.now() - cur.start), cur.hints);
      Adventure.render();
    },
    onClose: () => { play = null; hud(); moveStage("world"); W.refocus(); Adventure.render(); },
    onHint: () => { if (play) play.hints++; toast("도움을 받았어요 — 별 하나로 끝나요"); },
  });
}

/* ══════════════ 안내 ══════════════ */

function intro() {
  const KEY = "tangram-intro:v1";
  if (Store.get(KEY) === "1") return;
  veil(`<h2>칠교 마을에 온 걸 환영해요!</h2>
    <div class="tg-talk">
      <p>머리 위에 <b class="tg-bang">!</b> 가 떠 있는 사람에게 가서 말을 걸어 보세요.</p>
      <p><b>걷기</b> — 방향키나 W·A·S·D, 폰에서는 왼쪽 아래 동그라미를 끌어요.</p>
      <p><b>줍기·말 걸기</b> — 스페이스바, 폰에서는 오른쪽 아래 큰 단추.</p>
      <p>조각은 <b>${CARRY_MAX}개까지</b> 머리에 이고 다닐 수 있어요.</p>
    </div>
    <div class="card-actions"><button class="btn primary" id="tgIntroOk">시작하기</button></div>`);
  $("#tgIntroOk").onclick = () => { Store.set(KEY, "1"); hideVeil(); };
}

let zoneTimer;
function zoneBanner(zone) {
  const el = $("#tgZone");
  el.textContent = ZONES[zone].name;
  el.classList.add("show");
  clearTimeout(zoneTimer);
  zoneTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

/** 할 수 있는 새 부탁이 있는 사람 머리 위에 느낌표 */
function refreshMarks() {
  if (!W) return;
  const cleared = Progress.cleared();
  const map = {};
  const next = !run && QUESTS.find((q) => isOpen(q.id, cleared) && !cleared.has(q.id));
  if (next) map[next.npc] = true;
  W.marks(map);
}

/* ══════════════ 행동 ══════════════ */

const carried = () => (run ? run.pieces.filter((p) => p.at === "carry") : []);

function focusChanged(f) {
  const b = $("#tgAction");
  const label = !f ? "·" :
    f.type === "piece" ? "줍기" :
    f.type === "npc" ? "말 걸기" :
    f.type === "basket" ? "바구니에 넣기" :
    carried().length ? "제단에 올리기" :
    run.pieces.some((p) => p.at === "altar") ? "맞추기" : "조각을 모아 와요";
  b.textContent = label;
  b.disabled = !f;
  b.classList.toggle("ready", !!f);
}

function act(f) {
  if (f.type === "piece") pickUp(f.id);
  else if (f.type === "npc") talk(f.id);
  else if (f.type === "altar") toAltar();
  else if (f.type === "basket") toBasket();
}

function pickUp(id) {
  const p = run?.pieces.find((x) => x.id === id);
  if (!p) return;
  if (carried().length >= CARRY_MAX) {
    toast(`손이 꽉 찼어요! 조각은 ${CARRY_MAX}개까지 들 수 있어요.`);
    Sfx.miss();
    return;
  }
  p.at = "carry";
  W.take(id);
  W.carry(carried());
  W.refocus();
  Sfx.select();
  hud();
}

function toAltar() {
  for (const p of carried()) p.at = "altar";
  W.carry([]);
  const onAltar = run.pieces.filter((p) => p.at === "altar");
  if (!onAltar.length) {
    toast("아직 주운 조각이 없어요. 빛기둥이 솟은 곳에서 조각을 주워 오세요.");
    return;
  }
  Sfx.place();
  hud();
  Altar.open({
    zone: run.q.zone, quest: run.q, pieces: onAltar,
    onSolved: finish,
    onClose: () => { W.showFrame(run.q.zone, run.q.frame); W.refocus(); hud(); },
    onHint: () => { run.penalty += HINT_MS; toast(`도움을 받았어요 — 시간 +${HINT_MS / 1000}초`); },
  });
}

function toBasket() {
  const hand = carried();
  if (!hand.length) { toast("직각삼각형 조각을 주워서 가져와 주세요."); return; }
  let wrong = null;
  hand.forEach((p, i) => {
    if (KINDS[p.kind].right) { p.at = "basket"; run.basket++; return; }
    wrong = p;
    p.at = "ground";
    W.drop(p, BASKET[0] + 1.6 + i * 1.4, BASKET[1] + 2.6);   // 바구니 앞, 다온 반대쪽 — 되돌려 받은 걸 바로 보게
  });
  W.carry([]);
  W.refocus();
  W.flashBasket(!wrong);
  if (wrong) {
    Sfx.miss();
    const why = wrong.kind === "Q"
      ? "정사각형은 변이 네 개라서 삼각형이 아니야. 직각은 있지만!"
      : "평행사변형은 변이 네 개이고 직각도 없어.";
    toast(`${NPCS.kid.name}: ${why}`);
  } else Sfx.place();
  hud();
  if (run.basket === 5) finish();
}

/* ══════════════ 퀘스트 ══════════════ */

function talk(npcId) {
  const npc = NPCS[npcId];
  const cleared = Progress.cleared();
  const mine = QUESTS.filter((q) => q.npc === npcId);

  if (run) {
    if (run.q.npc !== npcId) { toast(`지금은 「${run.q.title}」 부탁을 하고 있어요.`); return; }
    veil(`<h2>${esc(npc.name)}</h2>
      <div class="tg-talk"><p>「${esc(run.q.title)}」 부탁은 잘 되고 있니?</p>
      <p class="hint">${progressLine()}</p></div>
      <div class="card-actions">
        <button class="btn primary" id="tgGo">계속하기</button>
        <button class="btn" id="tgQuit">그만두기</button>
      </div>`);
    $("#tgGo").onclick = hideVeil;
    $("#tgQuit").onclick = () => { hideVeil(); cleanup(); toast("부탁을 그만두었어요. 다시 말을 걸면 처음부터 할 수 있어요."); };
    return;
  }

  const next = mine.find((q) => isOpen(q.id, cleared) && !cleared.has(q.id));
  if (next) { offer(next, false); return; }

  const done = mine.filter((q) => cleared.has(q.id));
  if (done.length) {
    veil(`<h2>${esc(npc.name)}</h2>
      <div class="tg-talk"><p>또 와 줬구나! 더 빨리 해 볼래?</p></div>
      <div class="tg-replays">${done.map((q) => `<button class="btn" data-q="${q.id}">
        ${esc(q.title)} <span class="hint">최고 ${fmtPrecise(Progress.best(q.id))}</span></button>`).join("")}</div>
      <div class="card-actions"><button class="btn" id="tgBye">나중에</button></div>`);
    $$(".tg-replays [data-q]").forEach((b) => { b.onclick = () => offer(QUESTS.find((q) => q.id === +b.dataset.q), true); });
    $("#tgBye").onclick = hideVeil;
    return;
  }

  const waiting = QUESTS.find((q) => isOpen(q.id, cleared) && !cleared.has(q.id));
  veil(`<h2>${esc(npc.name)}</h2>
    <div class="tg-talk"><p>반갑구나! 지금은 부탁할 게 없단다.</p>
    ${waiting ? `<p>먼저 <b>${esc(NPCS[waiting.npc].name)}</b>의 부탁을 들어주고 오렴.</p>` : ""}</div>
    <div class="card-actions"><button class="btn primary" id="tgBye">알겠어요</button></div>`);
  $("#tgBye").onclick = hideVeil;
}

function offer(q, replay) {
  const best = Progress.best(q.id);
  veil(`<h2>${esc(NPCS[q.npc].name)}</h2>
    <div class="tg-quest-title">📜 ${esc(q.title)}</div>
    <div class="tg-talk">${q.talk.map((t) => `<p>${t}</p>`).join("")}</div>
    ${best ? `<p class="hint">내 최고 기록 ${fmtPrecise(best)}</p>` : ""}
    <p class="hint">부탁을 받는 순간부터 시간이 흘러요.</p>
    <div class="card-actions">
      <button class="btn primary" id="tgAccept">${replay ? "다시 도전" : "부탁 들어주기"}</button>
      <button class="btn" id="tgLater">나중에</button>
    </div>`);
  $("#tgLater").onclick = hideVeil;
  $("#tgAccept").onclick = () => {
    hideVeil();
    if (Saving.askOnce("모험 기록", () => start(q))) return;
    start(q);
  };
}

function start(q) {
  const spots = SPOTS[q.zone];
  const seen = {};
  run = {
    q, start: performance.now(), penalty: 0, basket: 0,
    pieces: piecesOf(q).map((kind, i) => {
      const n = (seen[kind] = (seen[kind] || 0) + 1) - 1;
      return { id: ++seq, kind, color: COLORS[kind][n], at: "ground", place: null, spot: spots[(i + q.id) % spots.length] };
    }),
  };
  for (const p of run.pieces) W.drop(p, p.spot[0], p.spot[1]);
  if (!q.sort) W.showFrame(q.zone, q.frame);
  W.refocus();
  refreshMarks();
  hud();
  toast(`${ZONES[q.zone].name} 곳곳에 조각이 떨어졌어요. 빛기둥을 찾아요!`);
}

function cleanup() {
  if (Altar.isOpen()) Altar.close(true);
  W.clearGround();
  W.carry([]);
  if (run && !run.q.sort) W.showFrame(run.q.zone, null);
  run = null;
  W.refocus();
  refreshMarks();
  hud();
}

async function finish() {
  const q = run.q;
  const ms = Math.round(performance.now() - run.start + run.penalty);
  const prev = Progress.best(q.id);
  cleanup();
  Sfx.win();
  const r = await Progress.clear(q.id, ms);
  W.openBridges(Progress.cleared(), true);
  refreshMarks();

  const next = QUESTS.find((x) => x.id === q.id + 1);
  const rankLine = !ONLINE ? ""
    : !uid() ? `<p class="hint">로그인하면 이 기록이 순위표에 올라요. <button class="link" id="tgLogin">로그인</button></p>`
    : r.improved && r.ok ? `<p class="hint">순위표에 기록했어요.</p>`
    : r.improved ? `<p class="hint bad">서버에 기록하지 못했어요. 위의 저장 안내를 확인해 주세요.</p>` : "";
  veil(`<h2>🎉 「${esc(q.title)}」 완성!</h2>
    <div class="tg-result">
      <div class="tg-time">${fmtPrecise(ms)}</div>
      <p class="hint">${prev == null ? "첫 기록이에요!" : ms < prev ? `최고 기록 경신! (이전 ${fmtPrecise(prev)})` : `최고 기록 ${fmtPrecise(prev)}`}</p>
      ${q.reward ? `<p class="tg-reward">${esc(q.reward)}</p>` : ""}
      ${next ? `<p>다음은 <b>${esc(NPCS[next.npc].name)}</b>에게 가 보세요. 머리 위에 <b class="tg-bang">!</b> 가 떠 있어요.</p>`
             : `<p>모든 부탁을 들어줬어요! 순위표에서 더 빠른 기록에 도전해 보세요.</p>`}
      ${rankLine}
    </div>
    <div class="card-actions">
      <button class="btn primary" id="tgOk">확인</button>
      ${ONLINE ? `<button class="btn" id="tgSeeRank">순위 보기</button>` : ""}
    </div>`);
  $("#tgOk").onclick = hideVeil;
  if ($("#tgSeeRank")) $("#tgSeeRank").onclick = () => { hideVeil(); showTab("rank"); };
  if ($("#tgLogin")) $("#tgLogin").onclick = () => { hideVeil(); Auth.openLogin(); };
}

/* ══════════════ 화면 위 안내 ══════════════ */

function progressLine() {
  if (!run) return "";
  const hand = carried().length;
  if (run.q.sort) return `바구니 ${run.basket}/5 · 들고 있는 조각 ${hand}/${CARRY_MAX}`;
  const on = run.pieces.filter((p) => p.at === "altar").length;
  return `제단 ${on}/${run.pieces.length} · 들고 있는 조각 ${hand}/${CARRY_MAX}`;
}

function hud() {
  $("#tgQuest").hidden = !run && !play;
  if (play) {
    $("#tgQuestTitle").textContent = play.stage.name;
    $("#tgQuestLine").textContent = `${Adventure.LEVEL[play.stage.difficulty].name} · 도움 ${play.hints}번`;
    return;
  }
  if (!run) return;
  $("#tgQuestTitle").textContent = run.q.title;
  $("#tgQuestLine").textContent = progressLine();
}

setInterval(() => {
  if (run) $("#tgClock").textContent = fmt(performance.now() - run.start + run.penalty);
  else if (play) $("#tgClock").textContent = fmt(performance.now() - play.start);
}, 250);

/* ══════════════ 조작 ══════════════ */

function bindControls() {
  $("#tgAction").onclick = () => W.act();

  // 화면 조이스틱 — 동그라미 가운데에서 끄는 방향으로 걷는다
  const base = $("#tgStick"), knob = $("#tgKnob");
  const R = 46;
  let id = null, cx = 0, cy = 0;
  const set = (e) => {
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    W.setStick(dx / R, -dy / R);
  };
  base.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    id = e.pointerId;
    base.setPointerCapture(id);
    const r = base.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    set(e);
  });
  base.addEventListener("pointermove", (e) => { if (e.pointerId === id) set(e); });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    knob.style.transform = "";
    W.setStick(0, 0);
  };
  base.addEventListener("pointerup", end);
  base.addEventListener("pointercancel", end);
}
