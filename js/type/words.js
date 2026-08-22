/* 낱말 연습 — 자리 진도를 따지지 않고, 고른 주제의 낱말을 그대로 친다.
 *
 * 자리 익히기가 '배우는 곳'이라면 여기는 '써먹는 곳'이다. 잠금도 별도 없고,
 * 최고 기록만 남는다. 자리를 다 못 뗀 아이도 좋아하는 낱말로 놀 수 있어야 한다.
 */
import { $ } from "../ui.js";
import * as Sfx from "../sound.js";
import { buildWordRun, buildEnWordRun } from "./curriculum.js";
import * as Progress from "./progress.js";
import * as Topics from "./topics.js";
import * as Lang from "./lang.js";
import * as Trainer from "./trainer.js";
import * as Saving from "../saving.js";

const COUNT = 20;        // 한 판에 치는 낱말 수
const PER_LINE = 5;

let homeEl, playEl;

export function init() {
  homeEl = $("#tyWordHome");
  playEl = $("#tyWordPlay");
  document.addEventListener("type-progress", () => { if (playEl.hidden) draw(); });
  document.addEventListener("type-lang", () => { if (playEl.hidden) draw(); });
}

export function draw() {
  if (!homeEl) return;
  const en = Lang.isEn();
  const best = Progress.get(Lang.item("words"));
  const n = en ? Lang.words().length : Topics.words().length;
  homeEl.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>낱말 연습</h2>
        <p>${en ? `영어 낱말 ${COUNT}개를 뽑아 냅니다. 가진 낱말은 ${n}개.`
                : `고른 주제에서 낱말 ${COUNT}개를 뽑아 냅니다. 지금 고른 주제의 낱말은 ${n}개.`}</p>
      </div>
      <div class="panel-body">
        <div data-lang></div>
        ${en ? "" : `<div data-topics style="margin-top:12px"></div>`}
        ${best.cpm ? `<p class="hint" style="margin-top:14px">최고 기록 — 분당 ${best.cpm}타 · 정확도 ${best.acc}%</p>` : ""}
        <div class="card-actions" style="justify-content:flex-start; margin-top:16px">
          <button class="btn primary" data-go${n ? "" : " disabled"}>시작하기</button>
        </div>
        ${n ? "" : `<p class="hint">낼 낱말이 없습니다.</p>`}
      </div>
    </div>`;
  Lang.switcher(homeEl.querySelector("[data-lang]"), draw);
  if (!en) Topics.chips(homeEl.querySelector("[data-topics]"));
  homeEl.querySelector("[data-go]").onclick = () => { Sfx.select(); play(); };
}

function play() {
  if (Saving.askOnce("별과 최고 기록", () => play())) return;   // 고르고 나서 시작한다
  const en = Lang.isEn();
  const run = en ? buildEnWordRun(Lang.words(), COUNT) : buildWordRun(Topics.words(), COUNT);
  Lang.apply();
  const lines = [];
  for (let i = 0; i < run.length; i += PER_LINE) lines.push(run.slice(i, i + PER_LINE).join(" "));
  homeEl.hidden = true;
  playEl.hidden = false;
  Trainer.start(playEl, {
    title: `${en ? "영문 " : ""}낱말 ${COUNT}개`,
    backLabel: "돌아가기",
    lines,
    onQuit: home,
    onDone: finish,
  });
}

export function home() {
  if (!homeEl) return;
  Trainer.stop();
  playEl.hidden = true;
  playEl.innerHTML = "";
  homeEl.hidden = false;
  draw();
}

function finish(s) {
  const fresh = Progress.record(Lang.item("words"), { cpm: s.cpm, acc: s.acc });
  Sfx.win();
  playEl.innerHTML = `
    <div class="ty-done">
      <h2>${COUNT}개 다 쳤어요</h2>
      ${fresh ? `<p class="hint">새 최고 기록!</p>` : ""}
      <div class="stats">
        <div class="stat">정확도<b>${s.acc}%</b></div>
        <div class="stat">분당 타수<b>${s.cpm}</b></div>
        <div class="stat">친 글자<b>${s.hits}</b></div>
      </div>
      <div class="card-actions">
        <button class="btn primary" data-again>한 판 더</button>
        <button class="btn" data-home>돌아가기</button>
      </div>
    </div>`;
  playEl.querySelector("[data-again]").onclick = play;
  playEl.querySelector("[data-home]").onclick = home;
}
