/* 성 지키기 판 — 적이 오고, 치면 죽고, 놓치면 성이 맞는다.
 *
 * 혼자 놀 때와 대결할 때가 이 판을 같이 쓴다. 두 벌로 만들면 "혼자서는 되는데
 * 대결에서는 안 되는" 차이가 반드시 생기는데, 그 차이는 아이 눈에 버그로 보인다.
 * 다른 것은 바깥에서 넣어 준다 — 어떤 낱말이 몇 번째로 오는지, 얼마나 빨리 오는지,
 * 몇 마리를 막아야 끝인지.
 *
 * 표적은 늘 '성에 가장 가까운 적' 하나다. 아이에게 고르게 하면 어느 적을 치는
 * 중이었는지 놓치고 손이 멈춘다.
 * 틀린 자리는 넘어가지 않는다 — 연습 화면과 같은 규칙이라야 헷갈리지 않는다.
 */
import { esc } from "../ui.js";
import * as Sfx from "../sound.js";
import { createRun } from "./engine.js";
import { lineHTML } from "./paint.js";
import * as KB from "./keyboard.js";
import { capture } from "./input.js";
import { analyze } from "./hangul.js";

/**
 * @param {HTMLElement} field  적이 뛰어다닐 자리
 * @param {object} cfg
 *   nextWord(i)  i 번째 적이 달고 올 낱말. null 이면 더 나오지 않는다
 *   total        막아야 하는 수 (Infinity 가능)
 *   pace(i)      {cross, gap} — 성까지 걸리는 초, 다음 적까지의 초
 *   hp           성이 견디는 횟수
 *   aliveCap     한 화면에 동시에 떠 있는 적의 최대 수
 *   markOf(word) 적 머리에 붙일 그림
 *   kb           화면 자판 (다음 자리를 짚어 준다)
 *   onUpdate(s)  hp·처치 수·연속이 바뀔 때
 *   onHint(txt)  손가락 안내가 바뀔 때
 *   onEnd(r)     끝났을 때 {cleared, kills, acc, ms, hp}
 */
export function run(field, cfg) {
  const S = {
    foes: [], spawned: 0, kills: 0, hp: cfg.hp, streak: 0,
    typed: 0, missed: 0, spawnIn: 0.6, bad: false,
    started: performance.now(), last: performance.now(), raf: 0, over: false,
  };
  const aliveCap = cfg.aliveCap || 5;
  const combo = () => Math.min(3, 1 + S.streak * 0.1);
  const target = () => (S.foes.length ? S.foes.reduce((a, b) => (b.x < a.x ? b : a)) : null);

  const push = () => cfg.onUpdate && cfg.onUpdate({
    hp: S.hp, kills: S.kills, streak: S.streak, combo: combo(),
    spawned: S.spawned, typed: S.typed, missed: S.missed,
  });

  function paintFoe(f) {
    const isTarget = f === target();
    f.el.classList.toggle("target", isTarget);
    f.wordEl.innerHTML = isTarget ? lineHTML(f.run, S.bad) : esc(f.word);
  }

  function repaint() {
    S.foes.forEach(paintFoe);
    const t = target();
    const hint = KB.highlight(cfg.kb, t ? t.run.expected() : null);
    cfg.onHint && cfg.onHint(hint || " ");
  }

  function spawn() {
    const word = cfg.nextWord(S.spawned);
    if (!word) return false;
    const el = document.createElement("div");
    el.className = "ty-foe";
    el.innerHTML = `<span class="ty-foe-mark">${(cfg.markOf && cfg.markOf(word)) || "👾"}</span>` +
                   `<span class="ty-foe-word"></span>`;
    el.style.top = (34 + Math.random() * 40) + "%";   // 성 높이 언저리로 모은다
    field.appendChild(el);
    S.foes.push({ word, run: createRun(word), x: 1, i: S.spawned, el, wordEl: el.querySelector(".ty-foe-word") });
    S.spawned++;
    return true;
  }

  function drop(f, cheer) {
    const el = f.el;
    el.classList.add(cheer ? "pop" : "crash");
    setTimeout(() => el.remove(), 260);
    S.foes = S.foes.filter((x) => x !== f);
  }

  function onKey(ev) {
    if (S.over) return;
    const t = target();
    if (!t) return;

    if (ev.back) { t.run.back(); S.bad = false; repaint(); return; }

    const r = t.run.press(ev.stroke);
    if (r === "bad") {
      S.missed++; S.bad = true; S.streak = 0;
      KB.flashBad(cfg.kb, ev.code);
      Sfx.miss();
      t.el.classList.remove("shake"); void t.el.offsetWidth; t.el.classList.add("shake");
      push(); repaint();
      return;
    }
    S.bad = false; S.typed++;
    Sfx.key();
    if (r === "done") {
      S.kills++; S.streak++;
      Sfx.word();
      const gained = Math.round(analyze(t.word).strokes * 10 * combo());
      drop(t, true);
      cfg.onKill && cfg.onKill({ kills: S.kills, word: t.word, gained });
      push();
      if (S.kills >= cfg.total) return finish(true);
    }
    repaint();
  }

  function loop(now) {
    if (S.over) return;
    const dt = Math.min(0.05, (now - S.last) / 1000);   // 탭을 갔다 오면 크게 튄다
    S.last = now;

    if (S.foes.length < aliveCap) {
      S.spawnIn -= dt;
      if (S.spawnIn <= 0) {
        if (spawn()) { S.spawnIn = cfg.pace(S.spawned - 1).gap; repaint(); }
        else S.spawnIn = 0.5;
      }
    }

    let hit = false;
    for (const f of S.foes.slice()) {
      f.x -= dt / cfg.pace(f.i).cross;
      f.el.style.left = (6 + f.x * 88) + "%";
      f.el.classList.toggle("near", f.x < 0.22);
      if (f.x <= 0) {
        hit = true;
        S.hp--; S.streak = 0;
        Sfx.hurt();
        field.classList.remove("hit"); void field.offsetWidth; field.classList.add("hit");
        drop(f, false);
        cfg.onDamage && cfg.onDamage(S.hp);
      }
    }
    if (hit) { push(); repaint(); }

    if (S.hp <= 0) return finish(false);
    S.raf = requestAnimationFrame(loop);
  }

  function finish(cleared) {
    if (S.over) return;
    S.over = true;
    cancelAnimationFrame(S.raf);
    capture(null);
    KB.highlight(cfg.kb, null);
    const acc = S.typed + S.missed ? Math.round((S.typed / (S.typed + S.missed)) * 100) : 100;
    cfg.onEnd && cfg.onEnd({
      cleared, kills: S.kills, hp: S.hp, acc,
      ms: Math.round(performance.now() - S.started),
    });
  }

  capture(onKey);
  push();
  S.raf = requestAnimationFrame(loop);

  return {
    get kills() { return S.kills; },
    get hp() { return S.hp; },
    stop() { if (!S.over) { S.over = true; cancelAnimationFrame(S.raf); capture(null); } },
  };
}

/** 성 그림 — 두 화면이 같은 성을 쓴다 */
export const CASTLE_SVG = `
  <div class="ty-castle">
    <svg viewBox="0 0 60 80" aria-hidden="true">
      <rect x="6" y="30" width="48" height="46" fill="#2d4159" stroke="rgba(201,151,63,.5)"/>
      <path d="M6 30h8v-8h8v8h8v-8h8v8h8v-8h8v8h6" fill="none" stroke="rgba(201,151,63,.6)" stroke-width="3"/>
      <rect x="24" y="52" width="12" height="24" rx="6" fill="#0e1726" stroke="rgba(201,151,63,.4)"/>
      <path d="M30 22V8l14 5-14 5" fill="#c9973f"/>
    </svg>
  </div>`;

/** 하트 줄 */
export const hearts = (hp, max) =>
  `${"♥".repeat(Math.max(0, hp))}<span class="gone">${"♥".repeat(Math.max(0, max - hp))}</span>`;
