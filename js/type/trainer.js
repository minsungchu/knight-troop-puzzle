/* 치는 화면 — 자리 익히기와 낱말 연습이 함께 쓴다.
 *
 * 보여 주는 것은 넷뿐이다: 지금 치는 줄, 다음 줄, 손가락 안내, 화면 자판.
 * 초등학생이 한 화면에서 눈을 굴릴 수 있는 곳은 그 정도가 한계다.
 */
import { $, esc } from "../ui.js";
import * as Sfx from "../sound.js";
import { createSeries } from "./engine.js";
import * as KB from "./keyboard.js";
import { capture } from "./input.js";
import { lineHTML } from "./paint.js";

let live = null;

/**
 * @param {HTMLElement} el   그릴 자리
 * @param {object} opt {title, lines, backLabel, onDone(stats), onQuit()}
 */
export function start(el, opt) {
  stop();

  const series = createSeries(opt.lines);
  const state = { bad: false };

  el.innerHTML = `
    <div class="ty-bar">
      <button class="btn" data-quit>◂ ${esc(opt.backLabel || "그만하기")}</button>
      <strong class="ty-title">${esc(opt.title || "")}</strong>
      <span class="grow"></span>
      <span class="ty-step" data-step></span>
    </div>
    <div class="ty-head">
      <span>정확도<b data-acc>100%</b></span>
      <span>분당 타수<b data-cpm>0</b></span>
    </div>
    <div class="ty-paper">
      <div class="ty-line" data-cur></div>
      <div class="ty-next" data-next></div>
    </div>
    <div class="ty-finger" data-finger>&nbsp;</div>
    <div data-kb></div>
    ${KB.legend()}`;

  const kb = el.querySelector("[data-kb]");
  KB.render(kb);
  el.querySelector("[data-quit]").onclick = () => { stop(); opt.onQuit && opt.onQuit(); };

  const elCur = el.querySelector("[data-cur]");
  const elNext = el.querySelector("[data-next]");
  const elStep = el.querySelector("[data-step]");
  const elAcc = el.querySelector("[data-acc]");
  const elCpm = el.querySelector("[data-cpm]");
  const elFinger = el.querySelector("[data-finger]");

  function drawLine() {
    const run = series.run;
    elCur.innerHTML = lineHTML(run, state.bad);
    elNext.textContent = series.lines[series.index + 1] || "";
    elStep.textContent = `${series.index + 1} / ${series.lines.length}`;
    elFinger.textContent = KB.highlight(kb, run.expected()) || " ";
  }

  function drawStats() {
    const s = series.stats();
    /* 처음 몇 타는 정확도를 안 띄운다. 첫 자리를 한 번 놓쳤다고 "0%" 가 뜨면
       그 자리에서 그만두는 아이가 생긴다. 표본이 쌓인 뒤에 보여 준다. */
    elAcc.textContent = s.hits + s.misses < 8 ? "—" : s.acc + "%";
    elCpm.textContent = s.cpm;
  }

  drawLine(); drawStats();
  const tick = setInterval(drawStats, 400);

  capture((ev) => {
    if (ev.back) { series.run.back(); state.bad = false; drawLine(); return; }
    const r = series.press(ev.stroke);
    if (r === "bad") {
      state.bad = true;
      KB.flashBad(kb, ev.code);
      Sfx.miss();
      drawLine(); drawStats();
      return;
    }
    state.bad = false;
    Sfx.key();
    if (r === "done") {
      if (!series.next()) {
        clearInterval(tick);
        capture(null);
        const s = series.stats();
        live = null;
        opt.onDone && opt.onDone(s);
        return;
      }
    }
    drawLine(); drawStats();
  });

  live = { tick };
}

export function stop() {
  if (live) { clearInterval(live.tick); live = null; }
  capture(null);
}
