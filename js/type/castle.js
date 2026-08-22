/* 성 지키기 — 혼자 하는 판.
 *
 * 판 자체는 castlefield.js 가 굴린다. 여기서 정하는 것은 '어떤 적이 언제 오는가'
 * 뿐이다 — 물결이 거듭될수록 낱말이 길어지고 빨라진다.
 *
 * 속도는 넉넉히 잡았다. 이제 배우는 아이는 분당 40~60타쯤 치므로 세 글자 낱말에
 * 10초 남짓 걸린다. 첫 물결은 성까지 30초를 준다.
 */
import { $ } from "../ui.js";
import * as Sfx from "../sound.js";
import * as KB from "./keyboard.js";
import * as Lang from "./lang.js";
import * as Progress from "./progress.js";
import * as Topics from "./topics.js";
import { shuffle } from "./curriculum.js";
import { run, CASTLE_SVG, hearts } from "./castlefield.js";
import * as Saving from "../saving.js";

const MAX_HP = 5;

/* 물결이 거듭될수록 빨라지고 길어진다 */
const wave = (n) => ({
  count: 4 + n,
  cross: Math.max(12, 30 - 1.6 * (n - 1)),     // 성까지 걸리는 초
  gap: Math.max(1.6, 3.4 - 0.18 * (n - 1)),    // 적이 나오는 간격
  maxLen: n <= 2 ? 3 : n <= 5 ? 4 : 5,         // 낱말 글자 수 상한
});

let homeEl, playEl, game = null;

export function init() {
  homeEl = $("#tyGameHome");
  playEl = $("#tyGamePlay");
  document.addEventListener("type-progress", () => { if (playEl.hidden) draw(); });
}

export function draw() {
  if (!homeEl) return;
  const best = Progress.get("castle");
  homeEl.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>성 지키기</h2>
        <p>적이 낱말을 달고 성으로 옵니다. 그 낱말을 쳐서 막으세요. 성이 다섯 번 맞으면 끝납니다.
           표적은 가장 앞선 적으로 저절로 잡힙니다 — 글자만 보면 됩니다.</p>
      </div>
      <div class="panel-body">
        <div data-topics></div>
        ${best.score ? `<p class="hint" style="margin-top:14px">최고 점수 <b style="color:var(--brass)">${best.score}</b></p>` : ""}
        <div class="card-actions" style="justify-content:flex-start; margin-top:16px">
          <button class="btn primary" data-go>성으로</button>
        </div>
      </div>
    </div>`;
  Topics.chips(homeEl.querySelector("[data-topics]"));
  homeEl.querySelector("[data-go]").onclick = () => { Sfx.select(); play(); };
}

export function home() {
  if (!homeEl) return;
  stop();
  playEl.hidden = true;
  playEl.innerHTML = "";
  homeEl.hidden = false;
  draw();
}

export function stop() { game?.field.stop(); game = null; }

function play() {
  // 성 지키기는 시작하는 순간 적이 걸어온다 — 물을 것이 있으면 묻고 나서 연다
  if (Saving.askOnce("최고 점수", () => play())) return;
  Lang.ko();          // 성 지키기는 한글 낱말만 쓴다
  homeEl.hidden = true;
  playEl.hidden = false;
  playEl.innerHTML = `
    <div class="ty-bar">
      <button class="btn" data-quit>◂ 그만두기</button>
      <strong class="ty-title">성 지키기</strong>
      <span class="grow"></span>
      <span class="ty-hp" data-hp></span>
    </div>
    <div class="ty-head">
      <span>물결<b data-wave>1</b></span>
      <span>점수<b data-score>0</b></span>
      <span>연속<b data-combo>×1.0</b></span>
    </div>
    <div class="ty-field" data-field>${CASTLE_SVG}<div class="ty-banner" data-banner hidden></div></div>
    <div class="ty-finger" data-finger>&nbsp;</div>
    <div data-kb></div>`;

  const kb = playEl.querySelector("[data-kb]");
  KB.render(kb);
  const el = (s) => playEl.querySelector(s);
  const banner = el("[data-banner]");

  /* 적을 미리 한 마리씩 짜 둔다. 같은 i 를 여러 번 물어도 같은 답이 나와야
     화면에서 적이 갑자기 빨라지거나 느려지지 않는다. */
  const plan = [];
  let waveNo = 0, leftInWave = 0, pool = [], cfgW = null;

  function showBanner(text) {
    banner.textContent = text;
    banner.hidden = false;
    banner.classList.remove("show");
    void banner.offsetWidth;
    banner.classList.add("show");
    setTimeout(() => { banner.hidden = true; }, 1200);
  }

  function extend() {
    if (leftInWave === 0) {
      waveNo++;
      cfgW = wave(waveNo);
      leftInWave = cfgW.count;
      const short = Topics.words().filter((w) => [...w].length <= cfgW.maxLen);
      // 짧은 낱말이 동나면 길이 제한을 푼다 — 주제를 하나만 골라도 판이 굴러가야 한다
      pool = shuffle((short.length >= 6 ? short : Topics.words()).slice());
      showBanner(`물결 ${waveNo}`);
      el("[data-wave]").textContent = waveNo;
    }
    const used = new Set(plan.slice(-4).map((p) => p.word));
    const word = pool.find((w) => !used.has(w)) || pool[0];
    pool = pool.filter((w) => w !== word).concat(word);
    plan.push({ word, cross: cfgW.cross, gap: cfgW.gap });
    leftInWave--;
  }
  const at = (i) => { while (plan.length <= i) extend(); return plan[i]; };

  let score = 0;
  const field = run(el("[data-field]"), {
    kb,
    total: Infinity,
    hp: MAX_HP,
    nextWord: (i) => at(i).word,
    pace: (i) => at(i),
    markOf: (w) => Topics.markOf(w),
    onHint: (h) => { el("[data-finger]").textContent = h; },
    onKill: ({ gained }) => { score += gained; el("[data-score]").textContent = score; },
    onUpdate: (s) => {
      el("[data-hp]").innerHTML = hearts(s.hp, MAX_HP);
      el("[data-combo]").textContent = "×" + s.combo.toFixed(1);
    },
    onEnd: (r) => finish(r, score, waveNo),
  });
  game = { field };
  el("[data-quit]").onclick = home;
}

function finish(r, score, waveNo) {
  game = null;
  const fresh = Progress.record("castle", { score, acc: r.acc });
  const best = Progress.get("castle").score;
  Sfx.hurt();
  playEl.innerHTML = `
    <div class="ty-done">
      <h2>성이 무너졌어요</h2>
      ${fresh ? `<p class="hint">새 최고 점수!</p>` : `<p class="hint">최고 점수는 ${best}점</p>`}
      <div class="stats">
        <div class="stat">점수<b>${score}</b></div>
        <div class="stat">막아 낸 적<b>${r.kills}</b></div>
        <div class="stat">정확도<b>${r.acc}%</b></div>
      </div>
      <div class="card-actions">
        <button class="btn primary" data-again>다시 지키기</button>
        <button class="btn" data-home>돌아가기</button>
      </div>
    </div>`;
  playEl.querySelector("[data-again]").onclick = play;
  playEl.querySelector("[data-home]").onclick = home;
}
