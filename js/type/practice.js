/* 자리 익히기 — 단계 지도와 한 단계 풀기.
 *
 * 통과는 정확도로만 가른다(90%). 손이 느린 아이가 한 단계에 갇혀 그만두는 일이
 * 없어야 해서다. 빠른 것은 별 두 개·세 개로 따로 갚는다.
 */
import { $, esc } from "../ui.js";
import * as Sfx from "../sound.js";
import { STAGES, buildStage, EN_STAGES, buildEnStage, starsFor, PASS_ACC, CPM_2, CPM_3 } from "./curriculum.js";
import * as Progress from "./progress.js";
import * as Topics from "./topics.js";
import * as Lang from "./lang.js";
import * as Trainer from "./trainer.js";
import * as Saving from "../saving.js";

let mapEl, playEl;

export function init() {
  mapEl = $("#tyMap");
  playEl = $("#tyPlay");
  document.addEventListener("type-progress", () => { if (!playEl.hidden) return; drawMap(); });
  document.addEventListener("type-topics", () => { if (playEl.hidden) drawMap(); });
  document.addEventListener("type-lang", () => { if (playEl.hidden) drawMap(); });
}

/* 지금 갈래의 단계 표와 기록 이름 앞머리 */
const ladder = () => (Lang.isEn() ? EN_STAGES : STAGES);
const prefix = () => (Lang.isEn() ? "en:" : "");

const stars = (n) => `<span class="ty-stars">${"★".repeat(n)}${"☆".repeat(3 - n)}</span>`;

export function drawMap() {
  if (!mapEl) return;
  const en = Lang.isEn();
  const list = ladder();
  const open = Progress.unlockedThrough(list, prefix());
  mapEl.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>자리 익히기</h2>
        <p>${en ? "홈 자리 <b>a s d f · j k l</b> 부터 시작한다" : "기본 자리 여덟 곳부터 시작한다"}.
           한 단계를 정확도 ${PASS_ACC}% 로 마치면 다음 자리가 열린다.
           빠르게 치면 별이 늘어난다 — 분당 ${CPM_2}타에 별 둘, ${CPM_3}타에 별 셋.</p>
      </div>
      <div class="picker">
        <div data-lang></div>
        ${en
          ? `<p class="hint">${Lang.ready()
              ? "그 단계까지 배운 자리로 칠 수 있는 영어 낱말이 섞여 나옵니다. 대문자는 7단계부터."
              : "<b>영문 낱말 자료를 불러오지 못했습니다.</b> data/type-en.json 을 확인하세요."}</p>`
          : `<div data-topics></div>
             <p class="hint">고른 주제의 낱말 가운데 그 단계까지 배운 자리로 칠 수 있는 것이 섞여 나옵니다.</p>`}
      </div>
      <div class="ty-map">
        ${list.map((s) => {
          const got = Progress.stageStars(s.n, prefix());
          const locked = s.n > open;
          const rec = Progress.get(prefix() + "stage:" + s.n);
          return `<button class="ty-stage${locked ? " locked" : ""}${got ? " done" : ""}"
                    data-stage="${s.n}"${locked ? " disabled" : ""}>
            <span class="ty-no">${s.n}</span>
            <span class="ty-name">${esc(s.title)}</span>
            <span class="ty-sub">${esc(s.sub)}</span>
            ${locked ? `<span class="ty-lock">앞 단계를 먼저</span>` : stars(got)}
            ${rec.cpm ? `<span class="ty-rec">최고 ${rec.cpm}타 · ${rec.acc}%</span>` : ""}
          </button>`;
        }).join("")}
      </div>
    </div>`;
  Lang.switcher(mapEl.querySelector("[data-lang]"), drawMap);
  if (!en) Topics.chips(mapEl.querySelector("[data-topics]"));
  mapEl.querySelectorAll(".ty-stage:not(.locked)").forEach((b) => {
    b.onclick = () => { Sfx.select(); play(Number(b.dataset.stage)); };
  });
}

function play(n) {
  if (Saving.askOnce("별과 최고 기록", () => play(n))) return;   // 고르고 나서 시작한다
  const en = Lang.isEn();
  const stage = ladder().find((s) => s.n === n);
  if (!stage) return;
  const lines = en ? buildEnStage(stage, { words: Lang.words(), sentences: Lang.sentences() })
                   : buildStage(stage, Topics.words());
  Lang.apply();
  mapEl.hidden = true;
  playEl.hidden = false;
  Trainer.start(playEl, {
    title: `${en ? "영문 " : ""}${n}단계 · ${stage.title}`,
    backLabel: "지도로",
    lines,
    onQuit: home,
    onDone: (s) => finish(stage, s),
  });
}

export function home() {
  if (!mapEl) return;
  Trainer.stop();
  playEl.hidden = true;
  playEl.innerHTML = "";
  mapEl.hidden = false;
  drawMap();
}

function finish(stage, s) {
  const got = starsFor(s.acc, s.cpm);
  const before = Progress.stageStars(stage.n, prefix());
  if (got) Progress.record(prefix() + "stage:" + stage.n, { stars: got, cpm: s.cpm, acc: s.acc });
  if (got) Sfx.win(); else Sfx.hurt();

  const opened = got > 0 && before === 0 && stage.n < ladder().length;
  playEl.innerHTML = `
    <div class="ty-done">
      <h2>${got ? "잘했어요!" : "조금만 더"}</h2>
      ${got ? `<div class="ty-bigstars">${"★".repeat(got)}${"☆".repeat(3 - got)}</div>`
            : `<p class="hint">정확도 ${PASS_ACC}% 를 넘겨야 다음 단계가 열립니다. 천천히 쳐도 괜찮아요 — 정확한 게 먼저입니다.</p>`}
      <div class="stats">
        <div class="stat">정확도<b>${s.acc}%</b></div>
        <div class="stat">분당 타수<b>${s.cpm}</b></div>
        <div class="stat">친 글자<b>${s.hits}</b></div>
      </div>
      ${opened ? `<p class="hint">${stage.n + 1}단계가 열렸습니다.</p>` : ""}
      <div class="card-actions">
        <button class="btn" data-again>한 번 더</button>
        ${opened ? `<button class="btn primary" data-next>다음 단계</button>` : ""}
        <button class="btn" data-map>지도로</button>
      </div>
    </div>`;
  playEl.querySelector("[data-again]").onclick = () => play(stage.n);
  const nx = playEl.querySelector("[data-next]");
  if (nx) nx.onclick = () => play(stage.n + 1);
  playEl.querySelector("[data-map]").onclick = home;
}
