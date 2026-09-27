/* 어드벤처 — 마을 열 곳, 마을마다 문제 열 개.
 *
 * 튜토리얼(3D 마을에서 조각을 주워 나르기)에서 조작을 배운 다음 여기서 본격적으로 푼다.
 * 조각 모으기는 없다. 문제를 고르면 제단 화면이 그대로 열리고, 맞추면 별을 받는다.
 *
 *   ★   깼다
 *   ★★  도움 없이 깼다
 *   ★★★ 목표 시간 안에 도움 없이 깼다
 *
 * 마을은 앞 마을에서 별을 모으면 열린다.
 */

import { $, esc, veil, hideVeil, fmtPrecise } from "../ui.js";
import { VILLAGES, STAGES } from "../../data/tangram-stages.js";
import * as Rec from "./stages.js";

/* 난이도는 모양의 복잡도다 — 안내선은 어디에도 없다. 목표 시간만 다르다. */
export const LEVEL = {
  easy: { name: "쉬움", goal: 90000, tip: "조각이 적게 꺾인 단순한 모양이에요." },
  mid: { name: "보통", goal: 150000, tip: "군데군데 들쭉날쭉한 모양이에요." },
  hard: { name: "어려움", goal: 240000, tip: "복잡하고, 조각을 뒤집어야 할 수도 있어요." },
};
const NEED_STARS = 12;                 // 다음 마을을 열려면 앞 마을에서 모아야 하는 별

const stagesOf = (village) => STAGES.filter((s) => s.village === village);
let start = () => {};
let openVillage = null;

export function init(opts) { start = opts.onStart; }

/** 이 마을을 열 수 있는가 — 첫 마을은 늘 열려 있고, 다음부터는 앞 마을 별로 연다 */
export function unlocked(i) {
  if (i === 0) return true;
  return Rec.starsIn(stagesOf(VILLAGES[i - 1].id)) >= NEED_STARS;
}

export function render() {
  if (openVillage) drawStages(openVillage); else drawVillages();
}

function drawVillages() {
  const body = $("#tgAdvBody");
  const total = STAGES.length, done = STAGES.filter((s) => Rec.cleared(s.id)).length;
  body.innerHTML = `<p class="hint tg-adv-top">문제 ${done}/${total}개를 깼어요. 마을 하나에 열 문제가 있어요.</p>
    <div class="tg-villages">${VILLAGES.map((v, i) => {
      const list = stagesOf(v.id);
      const open = unlocked(i);
      const stars = Rec.starsIn(list), max = list.length * 3;
      return `<button class="tg-village${open ? "" : " locked"}" data-v="${v.id}"${open ? "" : " disabled"}>
        <b>${esc(v.name)}</b>
        <span class="tg-village-theme">${esc(v.theme)}</span>
        ${open
          ? `<span class="tg-stars">★ ${stars} / ${max}</span><span class="hint">${Rec.clearedIn(list)}/${list.length} 깸</span>`
          : `<span class="tg-lock">앞 마을에서 별 ${NEED_STARS}개를 모으면 열려요</span>`}
      </button>`;
    }).join("")}</div>`;
  body.querySelectorAll("[data-v]").forEach((b) => { b.onclick = () => { openVillage = b.dataset.v; render(); }; });
}

function drawStages(village) {
  const v = VILLAGES.find((x) => x.id === village);
  const list = stagesOf(village);
  const body = $("#tgAdvBody");
  body.innerHTML = `<div class="tg-adv-head">
      <button class="btn" id="tgAdvBack">◂ 마을 고르기</button>
      <b>${esc(v.name)}</b><span class="hint">${esc(v.theme)} · ★ ${Rec.starsIn(list)}/${list.length * 3}</span>
    </div>
    <div class="tg-quizgrid">${list.map((s, i) => {
      const r = Rec.get(s.id), lv = LEVEL[s.difficulty];
      return `<button class="tg-quiz ${s.difficulty}" data-s="${s.id}">
        <span class="tg-quiz-no">${i + 1}</span>
        <span class="tg-quiz-name">${esc(s.name)}</span>
        <span class="tg-quiz-lv">${lv.name}</span>
        <span class="tg-quiz-star">${r ? "★".repeat(r.stars) + "☆".repeat(3 - r.stars) : "☆☆☆"}</span>
        <span class="hint">${r ? fmtPrecise(r.ms) : "아직 안 깸"}</span>
      </button>`;
    }).join("")}</div>`;
  $("#tgAdvBack").onclick = () => { openVillage = null; render(); };
  body.querySelectorAll("[data-s]").forEach((b) => { b.onclick = () => offer(STAGES.find((s) => s.id === b.dataset.s)); });
}

function offer(stage) {
  const lv = LEVEL[stage.difficulty], r = Rec.get(stage.id);
  veil(`<h2>${esc(stage.name)}</h2>
    <div class="tg-talk">
      <p>${esc(lv.name)} · ${esc(lv.tip)}</p>
      <p>목표 시간 <b>${fmtPrecise(lv.goal)}</b> 안에 <b>도움 없이</b> 맞추면 별 셋이에요.</p>
      ${r ? `<p class="hint">내 기록 ${fmtPrecise(r.ms)} · ${"★".repeat(r.stars)}</p>` : ""}
    </div>
    <div class="card-actions">
      <button class="btn primary" id="tgGo">시작하기</button>
      <button class="btn" id="tgNo">나중에</button>
    </div>`);
  $("#tgNo").onclick = hideVeil;
  $("#tgGo").onclick = () => { hideVeil(); start(stage); };
}

/** 한 판이 끝났다 — 별을 셈해 기록하고 결과 창을 띄운다 */
export async function finish(stage, ms, hints) {
  const lv = LEVEL[stage.difficulty];
  const stars = hints ? 1 : ms <= lv.goal ? 3 : 2;
  const list = stagesOf(stage.village);
  const starsBefore = Rec.starsIn(list);
  const res = await Rec.clear(stage.id, ms, stars);
  const i = VILLAGES.findIndex((v) => v.id === stage.village);
  const nextVillage = VILLAGES[i + 1];
  const justOpened = nextVillage && starsBefore < NEED_STARS && Rec.starsIn(list) >= NEED_STARS;

  veil(`<h2>🎉 ${esc(stage.name)} 완성!</h2>
    <div class="tg-result">
      <div class="tg-time">${fmtPrecise(ms)}</div>
      <div class="tg-bigstars">${"★".repeat(stars)}${"☆".repeat(3 - stars)}</div>
      <p class="hint">${hints ? "도움을 써서 별 하나예요. 도움 없이 깨면 별 둘!"
        : stars === 3 ? "목표 시간 안에 도움 없이 깼어요!"
        : `목표 시간 ${fmtPrecise(lv.goal)} 안에 깨면 별 셋이에요.`}</p>
      ${res.improved ? "" : `<p class="hint">이전 기록이 더 좋아서 그대로 뒀어요.</p>`}
      ${justOpened ? `<p class="tg-reward">${esc(nextVillage.name)}이 열렸어요!</p>` : ""}
    </div>
    <div class="card-actions">
      <button class="btn primary" id="tgAdvNext">다음 문제</button>
      <button class="btn" id="tgAdvList">마을로</button>
    </div>`);
  const back = () => { hideVeil(); render(); };
  $("#tgAdvList").onclick = back;
  $("#tgAdvNext").onclick = () => {
    const next = list[list.findIndex((s) => s.id === stage.id) + 1];
    hideVeil();
    if (next) start(next); else back();
  };
}
