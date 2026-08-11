/* 전장 판 — 퍼즐 UI
 *
 * 원본 단일 파일의 게임 로직을 그대로 옮기고 다음을 더했다.
 *   · 힌트 5회 제한 (새 칸을 짚어 줄 때만 1회로 센다)
 *   · performance.now() 기반 밀리초 타이머
 *   · 대전 모드 — 외부에서 받은 퍼즐로 시작하고 진행률을 알린다
 */
import KP from "./engine.js";
import { $, toast, veil, hideVeil, isVeilOpen, currentTab, onTab, Store, fmt } from "./ui.js";
import { HINT_MAX, LEVELS, TROOPS, STORE_KEY } from "./config.js";

const bit = (v) => 1 << (v - 1);
const MATCH_KEY = STORE_KEY + ":match";

const S = {
  W: 8, H: 8, level: 2, geom: null, solution: null,
  given: null, values: null, cands: null,
  sel: -1, pick: 0, hi: { t: -1, w: [] },
  grade: 2, done: false, tiles: [], busy: false,
  hints: 0,
  ms: 0, runFrom: 0, running: false, tick: null,
  match: null,          // { roomId } — 대전 중일 때만
};

let guide = -1;
const listeners = { progress: [], win: [], hint: [] };

export const Game = { init, newGame, startMatch, endMatch, isMatch, snapshot, on, regenerate };

function on(evt, fn) { (listeners[evt] || []).push(fn); }
function emit(evt, payload) { (listeners[evt] || []).forEach((fn) => fn(payload)); }

function isMatch() { return !!S.match; }

/** 대전 전황판이 쓰는 요약 */
function snapshot() {
  let filled = 0;
  if (S.values) for (let i = 0; i < S.values.length; i++) if (S.values[i]) filled++;
  return {
    filled, total: S.geom ? S.geom.N : 0,
    hints: S.hints, ms: elapsed(), done: S.done,
    W: S.W, H: S.H, level: S.level,
    roomId: S.match ? S.match.roomId : null,
    // 같은 판을 두 번 등록하지 않기 위한 서명
    sig: S.solution ? Array.from(S.solution).join("") : "",
  };
}

/* ══════════════ 초기화 ══════════════ */

function init() {
  const selW = $("#selW"), selH = $("#selH");
  for (let n = 5; n <= 12; n++) {
    const sel = n === 8 ? " selected" : "";
    selW.insertAdjacentHTML("beforeend", `<option value="${n}"${sel}>${n}</option>`);
    selH.insertAdjacentHTML("beforeend", `<option value="${n}"${sel}>${n}</option>`);
  }

  $("#deck").innerHTML = [1, 2, 3, 4].map((v) =>
    `<button class="troop" data-v="${v}"><svg><use href="#u${v}"/></svg>` +
    `<span class="k">${v}</span><span class="nm">${TROOPS[v].n}</span>` +
    `<span class="left" data-left="${v}"></span></button>`
  ).join("");

  bindEvents();
}

function bindEvents() {
  $("#grid").addEventListener("click", (e) => {
    const c = e.target.closest(".c"), t = e.target.closest(".tile");
    if (!t) return;
    const i = +t.dataset.i;
    if (c && !S.values[i]) {
      if (S.pick) { place(i, S.pick); select(i); return; }
      select(i); toggleCand(i, +c.dataset.v); return;
    }
    if (S.pick && !S.values[i]) { place(i, S.pick); select(i); return; }
    select(i);
  });

  $("#grid").addEventListener("focus", () => { if (S.sel < 0) select(0); });

  document.addEventListener("keydown", (e) => {
    if (!S.geom) return;
    if (isVeilOpen() || currentTab() !== "game") return;
    const tag = e.target.tagName;
    if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (S.sel < 0) { if (e.key.startsWith("Arrow")) { e.preventDefault(); select(0); } return; }
    const r = (S.sel / S.W) | 0, c = S.sel % S.W;

    if (e.key >= "1" && e.key <= "4") {
      e.preventDefault(); place(S.sel, +e.key);
    } else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") {
      e.preventDefault(); unplace(S.sel);
    } else if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      let nr = r, nc = c;
      if (e.key === "ArrowUp") nr = Math.max(0, r - 1);
      if (e.key === "ArrowDown") nr = Math.min(S.H - 1, r + 1);
      if (e.key === "ArrowLeft") nc = Math.max(0, c - 1);
      if (e.key === "ArrowRight") nc = Math.min(S.W - 1, c + 1);
      select(nr * S.W + nc);
    }
  });

  document.querySelectorAll(".troop").forEach((b) => {
    b.addEventListener("click", () => {
      const v = +b.dataset.v;
      if (S.sel >= 0 && !S.values[S.sel] && !S.given[S.sel]) { place(S.sel, v); S.pick = 0; }
      else S.pick = (S.pick === v ? 0 : v);
      renderAll();
    });
  });

  $("#btnNext").onclick = onHint;
  $("#btnRelease").onclick = () => {
    const i = S.sel;
    if (i < 0 || !S.values[i] || S.given[i] || S.done) return;
    unplace(i);
    toast("배치를 해제했습니다. 후보 1·2·3·4가 다시 표시됩니다.");
  };
  $("#btnNew").onclick = () => {
    if (isMatch()) { toast("대전 중에는 새 판을 만들 수 없습니다."); return; }
    newGame(+$("#selW").value, +$("#selH").value, +$("#selL").value);
  };
  $("#optTilt").oninput = (e) => $("#board").style.setProperty("--tilt", e.target.value + "deg");

  window.addEventListener("resize", () => { if (S.geom) fit(); });

  // 숨어 있는 동안에는 폭을 잴 수 없어 최소 칸으로 굳는다 — 다시 보일 때 한 번 더 맞춘다
  onTab((name) => { if (name === "game" && S.geom) fit(); });
}

/* ══════════════ 판 만들기 ══════════════ */

/** 퍼즐 하나를 생성한다. 대전 방장이 판을 배포할 때도 쓴다. */
function regenerate(W, H, level) {
  const r = KP.generate(W, H, level, { budgetMs: 5000 });
  const enc = (a) => Array.from(a).join("");
  return { W, H, level, puzzle: enc(r.puzzle), solution: enc(r.solution), grade: Math.min(r.actualLevel, 3) };
}

function newGame(W, H, level) {
  if (S.busy) return;
  S.busy = true;
  veil(`<div class="spin"></div><h2>전장 편성 중</h2><p>${W}×${H} · ${LEVELS[level]}<br>풀 수 있는 배치만 남기고 정리하는 중입니다.</p>`);
  setTimeout(() => {
    let d;
    try { d = regenerate(W, H, level); }
    catch { hideVeil(); S.busy = false; toast("판을 만들지 못했습니다. 크기를 줄이고 다시 시도해 주세요."); return; }
    load(d);
    hideVeil();
    S.busy = false;
  }, 40);
}

/** 문자열로 받은 퍼즐/정답을 적재하고 시계를 0에서 출발시킨다. */
function load(d, resume) {
  S.W = d.W; S.H = d.H; S.level = d.level;
  S.geom = KP.buildGeom(d.W, d.H);
  S.solution = Int8Array.from(d.solution, (ch) => +ch);
  const puz = Int8Array.from(d.puzzle, (ch) => +ch);

  S.given = new Uint8Array(S.geom.N);
  S.values = resume ? Int8Array.from(resume.val, (ch) => +ch) : new Int8Array(S.geom.N);
  S.cands = resume ? Int8Array.from(resume.cand, (ch) => parseInt(ch, 16)) : new Int8Array(S.geom.N);

  for (let i = 0; i < S.geom.N; i++) {
    if (puz[i]) { S.given[i] = 1; S.values[i] = puz[i]; S.cands[i] = 0; }
    else if (!resume) { S.cands[i] = 15; }
  }

  S.grade = d.grade || d.level;
  S.sel = -1; S.pick = 0;
  S.hints = resume ? (resume.hints || 0) : 0;
  S.ms = resume ? (resume.ms || 0) : 0;
  S.running = false;
  S.done = resume ? !!resume.done : false;
  clearHi(); guide = -1;
  $("#note").hidden = true;

  $("#selW").value = d.W; $("#selH").value = d.H; $("#selL").value = d.level;

  build();
  if (!S.done) startClock(); else renderTime();
  save();
  emit("progress", snapshot());
}

function build() {
  const grid = $("#grid");
  grid.style.gridTemplateColumns = `repeat(${S.W}, var(--cell))`;
  let html = "";
  for (let i = 0; i < S.geom.N; i++) {
    html += `<div class="tile" data-i="${i}" tabindex="-1" role="gridcell">
      <div class="face">
        <div class="unit"><svg><use href="#u1"/></svg><span class="num"></span></div>
        <div class="cands">${[1, 2, 3, 4].map((v) => `<span class="c v${v}" data-v="${v}">${v}</span>`).join("")}</div>
      </div></div>`;
  }
  grid.innerHTML = html;
  S.tiles = Array.from(grid.children);
  fit();
  renderAll();
}

function fit() {
  const narrow = window.innerWidth < 620;
  const pad = narrow ? 36 : 60;               // 받침대(plinth)와 그림자가 넘칠 여백
  const avail = Math.min($(".stage").clientWidth, 1140) - pad;
  const gap = S.W > 10 ? (narrow ? 3 : 4) : 5;
  let cell = Math.floor((avail - gap * (S.W - 1)) / S.W);
  cell = Math.max(24, Math.min(cell, 72));
  document.documentElement.style.setProperty("--cell", cell + "px");
  document.documentElement.style.setProperty("--gap", gap + "px");
}

/* ══════════════ 렌더 ══════════════ */

function renderCell(i, badSet) {
  const t = S.tiles[i], v = S.values[i];
  t.className = "tile" + (v ? ` filled v${v}` : "") + (S.given[i] ? " given" : (v ? " placed" : ""))
    + (S.sel === i ? " sel" : "") + (S.sel >= 0 && S.geom.knight[S.sel].indexOf(i) >= 0 ? " link" : "")
    + (badSet && badSet.has(i) ? " bad" : "") + (S.hi.t === i ? " pick" : "") + (S.hi.w.indexOf(i) >= 0 ? " why" : "");
  if (v) {
    t.querySelector("use").setAttribute("href", "#u" + v);
    t.querySelector(".num").textContent = v;
    t.setAttribute("aria-label", `${TROOPS[v].n} 배치됨`);
  } else {
    const m = S.cands[i], only = KP.POP[m] === 1;
    t.querySelectorAll(".c").forEach((el) => {
      const v2 = +el.dataset.v;
      el.className = `c v${v2}` + ((m & bit(v2)) ? "" : " off") + (only && (m & bit(v2)) ? " only" : "");
    });
    t.setAttribute("aria-label", "빈 칸");
  }
}

function renderAll() {
  const bad = KP.violations(S.geom, S.values);   // 규칙을 실제로 어긴 칸만 표시(정답 여부는 알리지 않는다)
  for (let i = 0; i < S.geom.N; i++) renderCell(i, bad);

  let filled = 0; const cnt = [0, 0, 0, 0, 0];
  for (let i = 0; i < S.geom.N; i++) if (S.values[i]) { filled++; cnt[S.values[i]]++; }
  $("#stLeft").textContent = S.geom.N - filled;
  $("#stFill").textContent = filled + " / " + S.geom.N;
  $("#stGrade").textContent = `${S.W}×${S.H} · ${LEVELS[S.level]}`;
  $("#stMode").textContent = S.grade > 1 ? "가정 추론 필요" : "소거 추론만";
  $("#btnRelease").disabled = !(S.sel >= 0 && S.values[S.sel] && !S.given[S.sel] && !S.done);
  for (let v = 1; v <= 4; v++) document.querySelector(`[data-left="${v}"]`).textContent = cnt[v];
  document.querySelectorAll(".troop").forEach((b) => b.classList.toggle("on", +b.dataset.v === S.pick));
  renderHintBtn();
}

function renderHintBtn() {
  const b = $("#btnNext"), left = HINT_MAX - S.hints;
  b.textContent = `다음 한 수 찾기 · ${left}`;
  b.disabled = left <= 0 || S.done;
  b.classList.toggle("low", left > 0 && left <= 1);
  b.title = left > 0
    ? `힌트 ${left}회 남음 — 새 칸을 짚어 줄 때만 한 번으로 셉니다`
    : "이 판에서 쓸 수 있는 힌트를 모두 썼습니다";
}

/* ══════════════ 조작 ══════════════ */

function place(i, v) {
  if (S.given[i] || S.done) return;
  S.values[i] = v; S.cands[i] = 0;
  if (S.hi.t === i) { clearHi(); guide = -1; }
  renderAll(); save();
  emit("progress", snapshot());
  checkWin();
}

function unplace(i) {
  if (S.given[i] || !S.values[i] || S.done) return;
  S.values[i] = 0; S.cands[i] = 15;
  renderAll(); save();
  emit("progress", snapshot());
}

function toggleCand(i, v) {
  if (S.values[i] || S.done) return;
  const b = bit(v);
  if (S.cands[i] & b) {
    // 마지막 하나 남은 후보를 누르면 지우는 대신 그 부대를 확정한다
    if (KP.POP[S.cands[i]] === 1) { place(i, v); return; }
    S.cands[i] &= ~b;
  } else {
    S.cands[i] |= b;
  }
  renderAll(); save();
}

function select(i) {
  if (S.hi.t >= 0 && S.hi.t !== i) { clearHi(); guide = -1; }
  S.sel = i;
  renderAll();
  if (S.tiles[i]) S.tiles[i].focus({ preventScroll: true });
}

/* ══════════════ 힌트 ══════════════
   지금 상태에서 '소거만으로' 확정되는 칸을 찾는다. 확정된 칸의 값만 근거로 삼는다.
   후보 3개가 직접 지워지는 칸이 하나라도 있으면 찍을 필요가 없다는 뜻이다.

   횟수는 '새 칸을 처음 짚어 줄 때'만 1회로 센다.
     · 같은 칸의 근거를 다시 펴 보는 것 → 무료 (이미 낸 값)
     · 짚을 칸이 없다는 답 → 무료 (정보량이 미미한데 깎으면 5회가 3회처럼 느껴진다) */

function findDirect() {
  const out = [];
  for (let i = 0; i < S.geom.N; i++) {
    if (S.values[i]) continue;
    const why = {}, miss = [];
    for (let v = 1; v <= 4; v++) {
      let f = null;
      for (const j of S.geom.knight[i]) if (S.values[j] === v) { f = { t: "k", c: [j] }; break; }
      if (!f) for (const ti of S.geom.cellTriples[i]) {
        const o = S.geom.triples[ti].filter((x) => x !== i);
        if (S.values[o[0]] === v && S.values[o[1]] === v) { f = { t: "t", c: o }; break; }
      }
      if (f) why[v] = f; else miss.push(v);
    }
    if (miss.length === 1) out.push({ i, v: miss[0], why });
  }
  return out;
}

const rc = (i) => `${((i / S.W) | 0) + 1}행 ${(i % S.W) + 1}열`;
const note = (html) => { const n = $("#note"); n.innerHTML = html; n.hidden = false; };
const clearHi = () => { S.hi = { t: -1, w: [] }; };

function onHint() {
  if (S.done) return;
  if (S.hints >= HINT_MAX) { toast(`힌트는 한 판에 ${HINT_MAX}번까지입니다.`); return; }

  let wrong = 0;
  for (let i = 0; i < S.geom.N; i++) if (S.values[i] && S.values[i] !== S.solution[i]) wrong++;
  const warn = wrong ? `<br><b>주의</b> — 지금 확정한 칸 중 ${wrong}개가 정답과 다릅니다. 그 칸을 해제해야 이 안내가 맞아떨어집니다.` : "";

  const list = findDirect();

  // 짚을 칸이 없다 — 횟수를 세지 않는다
  if (!list.length) {
    clearHi(); guide = -1; renderAll();
    note((S.grade > 1
      ? "지금 상태에서는 소거만으로 확정되는 칸이 없습니다. <b>어려움</b>은 한 칸에 값을 가정해 모순을 확인하는 단계까지 필요합니다."
      : "지금 상태에서는 소거만으로 확정되는 칸이 없습니다.") + warn);
    return;
  }

  // 이미 짚어 준 칸의 근거 공개 — 횟수를 세지 않는다
  const cur = list.find((x) => x.i === guide);
  if (cur) {
    const cells = [];
    const li = [1, 2, 3, 4].filter((v) => v !== cur.v).map((v) => {
      const w = cur.why[v]; w.c.forEach((c) => cells.push(c));
      return w.t === "k"
        ? `<li><span class="k">${v}</span> ${TROOPS[v].n} — ${rc(w.c[0])}의 부대가 나이트 이동으로 닿습니다.</li>`
        : `<li><span class="k">${v}</span> ${TROOPS[v].n} — ${rc(w.c[0])}·${rc(w.c[1])}에 이미 2연속이라 3연속 규칙에 걸립니다.</li>`;
    }).join("");
    S.hi = { t: cur.i, w: cells }; renderAll();
    note(`<b>${rc(cur.i)}</b>에서 세 부대가 이렇게 지워집니다.<ul>${li}</ul>남는 것은 <span class="k">${cur.v}</span> ${TROOPS[cur.v].n} 하나입니다.`);
    return;
  }

  // 새 칸을 짚는다 — 여기서만 1회 차감
  S.hints++;
  const left = HINT_MAX - S.hints;
  const pick = list[(Math.random() * list.length) | 0];
  guide = pick.i; S.hi = { t: pick.i, w: [] }; S.sel = pick.i;
  renderAll(); save();
  emit("hint", snapshot());

  const budget = left > 0
    ? `힌트 <b>${left}회</b> 남았습니다.`
    : `이번이 마지막 힌트였습니다.`;
  note(`지금 <b>${list.length}개</b> 칸이 소거 추론만으로 확정됩니다 — 가정 없이 진행할 수 있습니다. `
    + `그중 하나는 <b>${rc(pick.i)}</b>. 근거를 보려면 <b>다음 한 수 찾기</b>를 한 번 더 누르세요(추가 차감 없음). `
    + budget + warn);
}

/* ══════════════ 완주 ══════════════ */

function checkWin() {
  for (let i = 0; i < S.geom.N; i++) if (S.values[i] !== S.solution[i]) return;
  S.done = true;
  stopClock();
  save();
  const result = snapshot();

  S.tiles.forEach((t, k) => setTimeout(() => {
    t.classList.add("cheer");
    setTimeout(() => t.classList.remove("cheer"), 700);
  }, (((k / S.W) | 0) + (k % S.W)) * 36));

  renderAll();
  emit("win", result);

  // 대전 중이면 결과 화면은 방 모듈이 그린다
  if (isMatch()) return;

  setTimeout(() => {
    veil(`<h2>배치 완료</h2><p>${S.W}×${S.H} · ${LEVELS[S.level]} 전장을 모두 채웠습니다.</p>
      <div class="stats">
        <div class="stat">소요 시간<b>${fmt(result.ms)}</b></div>
        <div class="stat">배치한 칸<b>${S.geom.N - count(S.given)}</b></div>
        <div class="stat">쓴 힌트<b>${result.hints}</b></div>
      </div>
      <div class="card-slot" id="winSlot"></div>
      <div class="card-actions">
        <button class="btn primary" id="againBtn">같은 조건으로 한 판 더</button>
        <button class="btn" id="closeBtn">판 둘러보기</button>
      </div>`);
    $("#againBtn").onclick = () => { hideVeil(); newGame(S.W, S.H, S.level); };
    $("#closeBtn").onclick = hideVeil;
  }, 700 + (S.W + S.H) * 36);
}

const count = (a) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i]) n++; return n; };

/* ══════════════ 시계 ══════════════
   setInterval 로 초를 세면 백그라운드 탭에서 뒤처지고 동률도 잦다.
   performance.now() 로 실제 경과를 누적하고, 화면 갱신만 주기적으로 한다. */

const elapsed = () => S.ms + (S.running ? performance.now() - S.runFrom : 0);

function startClock() {
  if (S.running || S.done) return;
  S.runFrom = performance.now();
  S.running = true;
  clearInterval(S.tick);
  let sinceSave = 0;
  S.tick = setInterval(() => {
    renderTime();
    if ((sinceSave += 250) >= 10000) { sinceSave = 0; save(); }
  }, 250);
  renderTime();
}

function stopClock() {
  if (S.running) { S.ms += performance.now() - S.runFrom; S.running = false; }
  clearInterval(S.tick); S.tick = null;
  renderTime();
}

const renderTime = () => { $("#stTime").textContent = fmt(elapsed()); };

/* ══════════════ 저장 / 복원 ══════════════ */

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!S.geom) return;
    const enc = (a, base) => Array.from(a).map((x) => x.toString(base)).join("");
    const puzzle = Array.from(S.given, (g, i) => (g ? S.values[i] : 0)).join("");
    const blob = JSON.stringify({
      W: S.W, H: S.H, level: S.level, grade: S.grade,
      solution: enc(S.solution, 10), puzzle,
      val: enc(S.values, 10), cand: enc(S.cands, 16),
      ms: Math.round(elapsed()), hints: S.hints, done: S.done,
      room: S.match ? S.match.roomId : null,
    });
    Store.set(isMatch() ? MATCH_KEY : STORE_KEY, blob);
  }, 400);
}

function read(key) {
  const raw = Store.get(key);
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    if (!d || !d.W || !d.solution || d.solution.length !== d.W * d.H) return null;
    return d;
  } catch { return null; }
}

/** 이전에 풀던 혼자 플레이 판을 되살린다. */
export function restoreSolo() {
  const d = read(STORE_KEY);
  if (!d) return false;
  load(d, d);
  toast("이전에 풀던 판을 이어서 진행합니다.");
  return true;
}

/** 대전 방 새로고침 복구 — 저장된 판이 그 방의 것일 때만 되살린다. */
export function readMatchSave(roomId) {
  const d = read(MATCH_KEY);
  return d && d.room === roomId ? d : null;
}

/* ══════════════ 대전 모드 ══════════════ */

/** roomId 를 붙여 대전 판을 적재한다. resume 이 있으면 이어서 푼다. */
function startMatch(d, resume) {
  S.match = { roomId: d.roomId };
  load(d, resume || null);
  document.body.classList.add("in-match");
  $("#matchBar").hidden = false;
}

/** 대전에서 빠져나와 혼자 플레이 판으로 돌아간다. */
function endMatch() {
  if (!S.match) return;
  S.match = null;
  Store.del(MATCH_KEY);
  document.body.classList.remove("in-match");
  $("#matchBar").hidden = true;
  stopClock();
  if (!restoreSolo()) newGame(8, 8, 2);
}
