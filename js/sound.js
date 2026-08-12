/* 소리 — Web Audio 로 즉석에서 합성한다.
 *
 * 음원 파일을 두지 않는 이유: 정적 배포에 내려받을 것이 늘지 않고, 돌·놋쇠 질감을
 * 이 게임 톤에 맞춰 직접 깎을 수 있으며, 전부 합쳐 몇 KB 다.
 *
 * 브라우저는 사용자가 화면을 건드리기 전에는 소리를 못 내게 막는다.
 * 그래서 AudioContext 를 첫 조작 때 만들고, 그전 호출은 조용히 버린다.
 */
import { Store } from "./ui.js";

const MUTE_KEY = "knight-troop-puzzle:mute";

let ctx = null;
let master = null;
let muted = Store.get(MUTE_KEY) === "1";
let noiseBuf = null;

export const isMuted = () => muted;

export function setMuted(v) {
  muted = !!v;
  Store.set(MUTE_KEY, muted ? "1" : "0");
  if (master) master.gain.value = muted ? 0 : 0.9;
}

/** 오디오를 깨운다. 조작이 있을 때마다 불러도 되고, 여러 번 불러도 안전하다.
 *
 *  한 번만 시도하면 안 된다. 컨텍스트가 suspended 로 만들어지는 경우가 있고,
 *  resume() 은 비동기라 그 자리에서 성공한다는 보장이 없다. 한 번 실패한 뒤
 *  다시 시도할 기회가 없으면 소리가 영영 안 난다 — 소리 켜기를 껐다 켜야만
 *  들리던 증상이 이것이었다(그 경로가 wake 를 다시 불러 주고 있었다). */
export function wake() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);

    // 잡음 한 조각을 미리 만들어 두고 돌 부딪는 소리의 재료로 재활용한다
    const n = ctx.sampleRate * 0.4;
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state !== "running") ctx.resume().catch(() => {});
}

/** 사용자가 화면을 건드릴 때마다, 소리가 살아날 때까지 깨우기를 다시 시도한다.
 *  살아나면 스스로 물러난다. */
export function listenForGesture() {
  const events = ["pointerdown", "keydown", "touchstart", "click"];
  const on = () => {
    wake();
    if (ctx && ctx.state === "running") {
      events.forEach((e) => window.removeEventListener(e, on, true));
    }
  };
  events.forEach((e) => window.addEventListener(e, on, true));

  // 다른 탭에 갔다 오면 브라우저가 다시 재울 수 있다
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  });
}

const ready = () => ctx && ctx.state === "running" && !muted;

/* ── 재료 ── */

/** 감쇠하는 발음체 하나 */
function tone({ freq, type = "sine", dur = 0.12, gain = 0.2, at = 0, glide = 0, curve = 3 }) {
  const t0 = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * glide), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.004);
  g.gain.setTargetAtTime(0, t0 + 0.006, dur / curve);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.08);
}

/** 잡음 한 조각 — 돌이 닿는 순간의 '탁' */
function noise({ dur = 0.06, gain = 0.15, at = 0, lo = 400, hi = 4000, q = 0.7 }) {
  const t0 = ctx.currentTime + at;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = Math.sqrt(lo * hi);
  bp.Q.value = q;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = lo;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.003);
  g.gain.setTargetAtTime(0, t0 + 0.005, dur / 3);
  s.connect(bp).connect(hp).connect(g).connect(master);
  s.start(t0);
  s.stop(t0 + dur + 0.05);
}

/* ── 상황별 소리 ── */

let lastHover = 0;

/** 칸 위를 지나갈 때. 아주 잦게 울리므로 작고 짧아야 하고, 너무 붙으면 건너뛴다. */
export function hover() {
  if (!ready()) return;
  const now = performance.now();
  if (now - lastHover < 45) return;
  lastHover = now;
  noise({ dur: 0.02, gain: 0.025, lo: 2200, hi: 7000, q: 1.2 });
}

/** 칸을 고를 때 — 돌 위에 손가락이 닿는 정도 */
export function select() {
  if (!ready()) return;
  noise({ dur: 0.045, gain: 0.09, lo: 700, hi: 3000 });
  tone({ freq: 190, type: "sine", dur: 0.07, gain: 0.1, glide: 0.75 });
}

/** 후보 숫자를 지울 때 — 마르고 짧은 '틱' */
export function candOff() {
  if (!ready()) return;
  noise({ dur: 0.03, gain: 0.075, lo: 1600, hi: 6000, q: 1.1 });
  tone({ freq: 620, type: "triangle", dur: 0.04, gain: 0.05, glide: 0.7 });
}

/** 지웠던 후보를 되살릴 때 — 같은 틱을 위로 */
export function candOn() {
  if (!ready()) return;
  noise({ dur: 0.028, gain: 0.05, lo: 1800, hi: 6500, q: 1.1 });
  tone({ freq: 520, type: "triangle", dur: 0.05, gain: 0.06, glide: 1.45 });
}

/** 부대를 확정할 때 — 돌판에 말이 놓이는 '툭' 에 놋쇠 울림을 얹는다 */
export function place() {
  if (!ready()) return;
  noise({ dur: 0.05, gain: 0.13, lo: 300, hi: 2200 });
  tone({ freq: 130, type: "sine", dur: 0.16, gain: 0.24, glide: 0.62 });
  tone({ freq: 880, type: "triangle", dur: 0.16, gain: 0.035, at: 0.012 });
}

/** 배치를 물릴 때 — 놓을 때를 뒤집은 느낌 */
export function unplace() {
  if (!ready()) return;
  noise({ dur: 0.04, gain: 0.07, lo: 500, hi: 2600 });
  tone({ freq: 150, type: "sine", dur: 0.12, gain: 0.13, glide: 1.6 });
}

/** 힌트 — 놋쇠 종 */
export function hint() {
  if (!ready()) return;
  tone({ freq: 784, type: "sine", dur: 0.35, gain: 0.1, curve: 5 });
  tone({ freq: 1176, type: "sine", dur: 0.3, gain: 0.045, at: 0.02, curve: 5 });
}

/** 완주 — 짧은 놋쇠 나팔 */
export function win() {
  if (!ready()) return;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    tone({ freq: f, type: "triangle", dur: 0.5, gain: 0.12, at: i * 0.11, curve: 6 });
    tone({ freq: f * 2, type: "sine", dur: 0.4, gain: 0.03, at: i * 0.11, curve: 6 });
  });
}
