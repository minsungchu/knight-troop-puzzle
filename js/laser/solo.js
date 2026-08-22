/* 솔로 — 100단계 등반.
 *
 * 진행은 계정별로 남긴다. 로그인 전이면 이 브라우저에만 남겨 두었다가,
 * 로그인하는 순간 서버 것과 합친다(둘 중 더 멀리 간 쪽을 남긴다).
 */

import { $, toast } from "../ui.js";
import { LaserBoard } from "./board.js";
import { drawMountain } from "./mountain.js";
import * as Progress from "./progress.js";
import * as Sfx from "../sound.js";
import * as Saving from "../saving.js";

const TOTAL = 100;

let stages = [];
let board = null;
let cur = 0;              // 지금 열어 둔 단계 (0 이면 지도 화면)
let startedAt = 0;
let timer = null;

export async function init() {
  const res = await fetch("data/laser-stages.json");
  if (!res.ok) { $("#lzMapBody").innerHTML = `<p class="hint">단계 자료를 불러오지 못했습니다.</p>`; return; }
  stages = (await res.json()).stages;
  await Progress.load();
  showMap();
}

/** 진행 상황이 바뀌면(로그인 등) 다시 그린다. */
export function refresh() {
  if (!cur) showMap();
}

/* ══════════════ 지도 ══════════════ */

export function showMap() {
  cur = 0;
  clearInterval(timer);
  $("#lzPlay").hidden = true;
  $("#lzMap").hidden = false;

  const cleared = Progress.cleared();
  const next = Math.min(TOTAL, cleared.size ? Math.max(...cleared) + 1 : 1);

  $("#lzProgress").innerHTML =
    `<span>오른 단계 <b>${cleared.size}</b> / ${TOTAL}</span>` +
    `<span>지금 <b>${next}</b>단계</span>` +
    (cleared.size >= TOTAL ? `<span class="good">정상에 올랐습니다</span>` : "");

  drawMountain($("#lzMapBody"), {
    total: TOTAL, cleared, current: next,
    onPick: (s) => openStage(s),
  });
}

/* ══════════════ 단계 ══════════════ */

function openStage(n) {
  const data = stages.find((s) => s.stage === n);
  if (!data) { toast("그 단계를 찾지 못했습니다."); return; }
  // 로그인 안 했으면 한 번만 권한다. 고르고 나면 다시 불려 그때 판이 열린다 —
  // 창을 읽는 동안 시계가 돌면 첫 기록이 그만큼 늦어진다.
  if (Saving.askOnce("등반 기록", () => openStage(n))) return;
  cur = n;
  $("#lzMap").hidden = true;
  $("#lzPlay").hidden = false;

  $("#lzTitle").textContent = `${n}단계`;
  const teach = $("#lzTeach");
  if (data.teach) { teach.hidden = false; teach.textContent = data.teach; }
  else teach.hidden = true;

  const best = Progress.best(n);
  $("#lzBest").innerHTML = best
    ? `내 최고 기록<b>${(best / 1000).toFixed(1)}초</b>`
    : `<span class="hint">첫 도전</span>`;

  board?.destroy();
  board = new LaserBoard($("#lzBoard"), {
    onChange: paintGoal,
    onWin: onWin,
    onPlace: (m) => (m ? Sfx.place?.() : Sfx.unplace?.()),
    onFull: () => toast(`거울은 ${data.mirrors}개까지만 놓을 수 있습니다. 하나를 빼세요.`),
  });
  board.load(data);

  $("#lzDone").hidden = true;
  startedAt = performance.now();
  clearInterval(timer);
  timer = setInterval(() => {
    $("#lzTime").textContent = ((performance.now() - startedAt) / 1000).toFixed(1) + "초";
  }, 100);
}

function paintGoal(st) {
  const mark = (ok, txt) => `<span class="${ok ? "ok" : "no"}">${ok ? "✓" : "•"} ${txt}</span>`;
  $("#lzGoal").innerHTML =
    `${mark(st.mirrors === st.mirrorsNeeded, `거울 <b>${st.mirrorsNeeded}개를 모두</b> 놓기 (지금 ${st.mirrors}개)`)}` +
    ` &nbsp;그리고&nbsp; ${mark(st.lit === st.targets, `목표 <b>${st.targets}곳 전부</b> 밝히기 (지금 ${st.lit}곳)`)}` +
    (st.mirrors === st.mirrorsNeeded && st.lit !== st.targets
      ? `<br><span class="hint">거울은 다 놓았지만 아직 어두운 목표가 있습니다 — 배치를 바꿔 보세요.</span>` : "");
}

async function onWin() {
  clearInterval(timer);
  const ms = Math.round(performance.now() - startedAt);
  Sfx.win?.();

  const prev = Progress.best(cur);
  await Progress.clearStage(cur, ms);

  const last = cur >= TOTAL;
  $("#lzDone").hidden = false;
  $("#lzDone").innerHTML =
    `<b>${cur}단계 완료</b> — ${(ms / 1000).toFixed(1)}초` +
    (prev && ms < prev ? ` · <b>최고 기록 경신</b>` : prev ? ` (최고 ${(prev / 1000).toFixed(1)}초)` : "") +
    `<div class="lz-bar" style="justify-content:center">` +
    (last ? "" : `<button id="lzNext">${cur + 1}단계로</button>`) +
    `<button id="lzBack">지도로</button></div>` +
    (last ? `<div style="margin-top:8px">정상에 올랐습니다.</div>` : "");

  $("#lzNext")?.addEventListener("click", () => openStage(cur + 1));
  $("#lzBack").addEventListener("click", showMap);
}

/* ══════════════ 화면 단추 ══════════════ */

export function bind() {
  $("#lzToMap").addEventListener("click", showMap);
  $("#lzClear").addEventListener("click", () => { board?.clear(); Sfx.unplace?.(); });
  $("#lzUndo").addEventListener("click", () => { if (board?.undo()) Sfx.unplace?.(); });
  $("#lzRetry").addEventListener("click", () => openStage(cur));
}
