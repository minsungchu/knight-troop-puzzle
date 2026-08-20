/* 성 지키기 — 낱말을 쳐서 몰려오는 적을 막는다.
 *
 * 표적은 늘 '성에 가장 가까운 적' 하나다. 아이에게 표적을 고르게 하면 어느 적을
 * 치는 중이었는지 놓치고 손이 멈춘다. 자동으로 잡아 주면 아이는 글자만 보면 된다.
 *
 * 틀린 자리는 넘어가지 않는다. 연습 화면과 같은 규칙이라야 아이가 헷갈리지 않는다.
 * 대신 게임에서는 벌이 하나 더 붙는다 — 연속 처치 배수가 끊긴다.
 *
 * 속도는 넉넉히 잡았다. 이제 배우는 아이는 분당 40~60타쯤 치므로 세 글자 낱말에
 * 10초 남짓 걸린다. 첫 물결은 성까지 30초를 준다.
 */
import { $, esc } from "../ui.js";
import * as Sfx from "../sound.js";
import { createRun } from "./engine.js";
import { lineHTML } from "./paint.js";
import * as KB from "./keyboard.js";
import { capture } from "./input.js";
import * as Progress from "./progress.js";
import * as Topics from "./topics.js";
import { shuffle } from "./curriculum.js";
import { analyze } from "./hangul.js";

const MAX_HP = 5;
const ALIVE_CAP = 5;

/* 물결이 거듭될수록 빨라지고 길어진다 */
const wave = (n) => ({
  count: 4 + n,
  cross: Math.max(12, 30 - 1.6 * (n - 1)),     // 성까지 걸리는 초
  gap: Math.max(1.6, 3.6 - 0.18 * (n - 1)),    // 적이 나오는 간격
  maxLen: n <= 2 ? 3 : n <= 5 ? 4 : 5,         // 낱말 글자 수 상한
});

let homeEl, playEl;
let game = null;

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

/* ── 한 판 ── */

function play() {
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
    <div class="ty-field" data-field>
      <div class="ty-castle">
        <svg viewBox="0 0 60 80" aria-hidden="true">
          <rect x="6" y="30" width="48" height="46" fill="#2d4159" stroke="rgba(201,151,63,.5)"/>
          <path d="M6 30h8v-8h8v8h8v-8h8v8h8v-8h8v8h6" fill="none" stroke="rgba(201,151,63,.6)" stroke-width="3"/>
          <rect x="24" y="52" width="12" height="24" rx="6" fill="#0e1726" stroke="rgba(201,151,63,.4)"/>
          <path d="M30 22V8l14 5-14 5" fill="#c9973f"/>
        </svg>
      </div>
      <div class="ty-banner" data-banner hidden></div>
    </div>
    <div class="ty-finger" data-finger>&nbsp;</div>
    <div data-kb></div>`;

  const kb = playEl.querySelector("[data-kb]");
  KB.render(kb);
  playEl.querySelector("[data-quit]").onclick = home;

  game = {
    field: playEl.querySelector("[data-field]"),
    banner: playEl.querySelector("[data-banner]"),
    elHp: playEl.querySelector("[data-hp]"),
    elWave: playEl.querySelector("[data-wave]"),
    elScore: playEl.querySelector("[data-score]"),
    elCombo: playEl.querySelector("[data-combo]"),
    elFinger: playEl.querySelector("[data-finger]"),
    kb,
    hp: MAX_HP, score: 0, streak: 0, waveNo: 0,
    foes: [], pool: [], left: 0, spawnIn: 0, cfg: null,
    last: 0, raf: 0, over: false, bad: false, typed: 0, missed: 0,
  };

  nextWave();
  drawHud();
  capture(onKey);
  game.last = performance.now();
  game.raf = requestAnimationFrame(loop);
}

export function home() {
  if (!homeEl) return;
  stop();
  playEl.hidden = true;
  playEl.innerHTML = "";
  homeEl.hidden = false;
  draw();
}

export function stop() {
  if (game) { cancelAnimationFrame(game.raf); game = null; }
  capture(null);
}

function nextWave() {
  const g = game;
  g.waveNo++;
  g.cfg = wave(g.waveNo);
  const all = Topics.words().filter((w) => [...w].length <= g.cfg.maxLen);
  // 짧은 낱말이 동나면 길이 제한을 푼다 — 주제를 하나만 골라도 판이 굴러가야 한다
  g.pool = shuffle((all.length >= 6 ? all : Topics.words()).slice());
  g.left = g.cfg.count;
  g.spawnIn = 0.6;
  banner(`물결 ${g.waveNo}`);
}

function banner(text) {
  const b = game.banner;
  b.textContent = text;
  b.hidden = false;
  b.classList.remove("show");
  void b.offsetWidth;
  b.classList.add("show");
  setTimeout(() => { if (game && game.banner === b) b.hidden = true; }, 1200);
}

function spawn() {
  const g = game;
  const used = new Set(g.foes.map((f) => f.word));
  let word = g.pool.find((w) => !used.has(w)) || g.pool[0];
  g.pool = g.pool.filter((w) => w !== word).concat(word);   // 뒤로 돌린다

  const el = document.createElement("div");
  el.className = "ty-foe";
  el.innerHTML = `<span class="ty-foe-mark">${Topics.markOf(word) || "👾"}</span><span class="ty-foe-word"></span>`;
  el.style.top = (34 + Math.random() * 40) + "%";   // 성 높이 언저리로 모은다
  g.field.appendChild(el);

  g.foes.push({ word, run: createRun(word), x: 1, el, wordEl: el.querySelector(".ty-foe-word") });
  g.left--;
  paintFoe(g.foes[g.foes.length - 1]);
}

const target = () => (game.foes.length ? game.foes.reduce((a, b) => (b.x < a.x ? b : a)) : null);

function paintFoe(f) {
  const isTarget = f === target();
  f.el.classList.toggle("target", isTarget);
  f.wordEl.innerHTML = isTarget ? lineHTML(f.run, game.bad) : esc(f.word);
}

function repaintAll() {
  game.foes.forEach(paintFoe);
  const t = target();
  const hint = KB.highlight(game.kb, t ? t.run.expected() : null);
  game.elFinger.textContent = hint || " ";
}

function drawHud() {
  const g = game;
  g.elHp.innerHTML = `${"♥".repeat(g.hp)}<span class="gone">${"♥".repeat(MAX_HP - g.hp)}</span>`;
  g.elWave.textContent = g.waveNo;
  g.elScore.textContent = g.score;
  g.elCombo.textContent = "×" + combo().toFixed(1);
}

const combo = () => Math.min(3, 1 + game.streak * 0.1);

function onKey(ev) {
  const g = game;
  if (!g || g.over) return;
  const t = target();
  if (!t) return;

  if (ev.back) { t.run.back(); g.bad = false; repaintAll(); return; }

  const r = t.run.press(ev.stroke);
  if (r === "bad") {
    g.missed++;
    g.bad = true;
    g.streak = 0;
    KB.flashBad(g.kb, ev.code);
    Sfx.miss();
    t.el.classList.remove("shake"); void t.el.offsetWidth; t.el.classList.add("shake");
    drawHud(); repaintAll();
    return;
  }
  g.bad = false;
  g.typed++;
  Sfx.key();
  if (r === "done") {
    g.score += Math.round(analyze(t.word).strokes * 10 * combo());
    g.streak++;
    Sfx.word();
    kill(t, true);
    drawHud();
  }
  repaintAll();
}

function kill(f, cheer) {
  f.el.classList.add(cheer ? "pop" : "crash");
  const el = f.el;
  setTimeout(() => el.remove(), 260);
  game.foes = game.foes.filter((x) => x !== f);
}

function loop(now) {
  const g = game;
  if (!g) return;
  const dt = Math.min(0.05, (now - g.last) / 1000);   // 탭을 갔다 오면 크게 튄다 — 잘라 낸다
  g.last = now;

  if (g.left > 0 && g.foes.length < ALIVE_CAP) {
    g.spawnIn -= dt;
    if (g.spawnIn <= 0) { spawn(); g.spawnIn = g.cfg.gap; repaintAll(); }
  }

  let reached = false;
  for (const f of g.foes.slice()) {
    f.x -= dt / g.cfg.cross;
    f.el.style.left = (6 + f.x * 88) + "%";
    f.el.classList.toggle("near", f.x < 0.22);
    if (f.x <= 0) {
      reached = true;
      g.hp--; g.streak = 0;
      Sfx.hurt();
      g.field.classList.remove("hit"); void g.field.offsetWidth; g.field.classList.add("hit");
      kill(f, false);
    }
  }
  if (reached) { drawHud(); repaintAll(); }

  if (g.hp <= 0) { finish(); return; }
  if (g.left === 0 && g.foes.length === 0) { nextWave(); drawHud(); }

  g.raf = requestAnimationFrame(loop);
}

function finish() {
  const g = game;
  g.over = true;
  cancelAnimationFrame(g.raf);
  capture(null);
  const acc = g.typed + g.missed ? Math.round((g.typed / (g.typed + g.missed)) * 100) : 100;
  const fresh = Progress.record("castle", { score: g.score, acc });
  const best = Progress.get("castle").score;
  game = null;

  playEl.innerHTML = `
    <div class="ty-done">
      <h2>성이 무너졌어요</h2>
      ${fresh ? `<p class="hint">새 최고 점수!</p>` : `<p class="hint">최고 점수는 ${best}점</p>`}
      <div class="stats">
        <div class="stat">점수<b>${g.score}</b></div>
        <div class="stat">막아 낸 물결<b>${g.waveNo - 1}</b></div>
        <div class="stat">정확도<b>${acc}%</b></div>
      </div>
      <div class="card-actions">
        <button class="btn primary" data-again>다시 지키기</button>
        <button class="btn" data-home>돌아가기</button>
      </div>
    </div>`;
  playEl.querySelector("[data-again]").onclick = play;
  playEl.querySelector("[data-home]").onclick = home;
}
