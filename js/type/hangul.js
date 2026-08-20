/* 두벌식 한글 조합기 — 순수 계산, DOM 없음.
 *
 * 왜 브라우저 IME 에 맡기지 않는가.
 *
 * 타자를 처음 배우는 아이에게 필요한 것은 "지금 이 자리를 정확히 눌렀는가" 다.
 * 그런데 IME 에 맡기면 조합이 끝난 뒤에야 글자가 확정되므로, ㄱ 을 눌러야 할 자리에
 * ㄷ 을 눌렀다는 것을 낱자 단위로 잡아낼 수가 없다. 게다가 아이가 한/영 상태를
 * 스스로 맞춰야 하는데, 그것부터가 이 나이대에는 큰 장벽이다.
 *
 * 그래서 키를 직접 받는다. 키보드가 영문 상태여도 한글이 나오고, 낱자 하나하나를
 * 채점할 수 있으며, "다음은 왼손 검지" 같은 안내도 가능해진다.
 * 자판이 없는 기기에서도 같은 길로 간다. 화면 자판(keyboard.js)을 손가락으로 누른
 * 것도 '어느 자리를 눌렀나'로 바뀌어 여기로 들어오므로, 폰이든 컴퓨터든 아래쪽
 * 코드는 하나뿐이다. 브라우저 조합기를 안 쓴 덕에 터치가 거저 붙었다.
 *
 * 핵심 발상: 지문은 미리 '스트로크 열'로 풀어 둔다.
 *   "값" → [ㄱ, ㅏ, ㅂ, ㅅ]      (겹받침은 두 번 누른다)
 *   "과" → [ㄱ, ㅗ, ㅏ]           (겹모음도 두 번 누른다)
 *   "깎" → [ㄲ, ㅏ, ㄲ]           (쌍자음은 shift 로 한 번)
 * 채점은 이 열과 실제 입력을 앞에서부터 맞춰 보는 것으로 끝난다.
 * 화면에 보여 줄 글자는 지금까지 누른 스트로크를 다시 조합해서 만든다.
 */

/* ── 표준 두벌식 자판 (KS X 5002) ──
   code → [평소, shift]. shift 로 달라지는 자리는 쌍자음 다섯과 ㅒㅖ 뿐이다. */
export const KEYMAP = {
  KeyQ: ["ㅂ", "ㅃ"], KeyW: ["ㅈ", "ㅉ"], KeyE: ["ㄷ", "ㄸ"], KeyR: ["ㄱ", "ㄲ"], KeyT: ["ㅅ", "ㅆ"],
  KeyY: ["ㅛ", "ㅛ"], KeyU: ["ㅕ", "ㅕ"], KeyI: ["ㅑ", "ㅑ"], KeyO: ["ㅐ", "ㅒ"], KeyP: ["ㅔ", "ㅖ"],
  KeyA: ["ㅁ", "ㅁ"], KeyS: ["ㄴ", "ㄴ"], KeyD: ["ㅇ", "ㅇ"], KeyF: ["ㄹ", "ㄹ"], KeyG: ["ㅎ", "ㅎ"],
  KeyH: ["ㅗ", "ㅗ"], KeyJ: ["ㅓ", "ㅓ"], KeyK: ["ㅏ", "ㅏ"], KeyL: ["ㅣ", "ㅣ"],
  KeyZ: ["ㅋ", "ㅋ"], KeyX: ["ㅌ", "ㅌ"], KeyC: ["ㅊ", "ㅊ"], KeyV: ["ㅍ", "ㅍ"],
  KeyB: ["ㅠ", "ㅠ"], KeyN: ["ㅜ", "ㅜ"], KeyM: ["ㅡ", "ㅡ"],
};

/* 한글이 아닌 자리 — 숫자줄과 문장부호.
 *
 * 자리 익히기만 생각하면 없어도 됐다. 글쓰기를 붙이면서 반드시 필요해졌다.
 * 아이가 자유롭게 글을 쓸 때는 목표 지문이 없으므로 무엇을 누르든 그대로 나와야
 * 하는데, 느낌표 하나를 못 받으면 "신난다!"에서 손이 멈춘다.
 *
 * 그래서 자판에 있는 것은 다 받는다. 배열은 미국식 QWERTY 그대로다. */
const SYMBOLS = {
  Backquote: ["`", "~"],
  Digit1: ["1", "!"], Digit2: ["2", "@"], Digit3: ["3", "#"], Digit4: ["4", "$"], Digit5: ["5", "%"],
  Digit6: ["6", "^"], Digit7: ["7", "&"], Digit8: ["8", "*"], Digit9: ["9", "("], Digit0: ["0", ")"],
  Minus: ["-", "_"], Equal: ["=", "+"],
  BracketLeft: ["[", "{"], BracketRight: ["]", "}"], Backslash: ["\\", "|"],
  Semicolon: [";", ":"], Quote: ["'", '"'],
  Comma: [",", "<"], Period: [".", ">"], Slash: ["/", "?"],
};

/** 화면 자판이 이 표를 그대로 그린다 — 자리와 그림이 어긋날 일이 없다. */
export { SYMBOLS };

/* 스트로크 → 어느 키를 눌러야 하나.
   한글 자리를 먼저 넣는다 — 같은 키에 자모와 기호가 겹칠 때 자모가 이긴다. */
const REVERSE = (() => {
  const m = new Map();
  for (const [code, [plain, shifted]] of Object.entries(KEYMAP)) {
    if (!m.has(plain)) m.set(plain, { code, shift: false });
    if (!m.has(shifted)) m.set(shifted, { code, shift: true });
  }
  for (const [code, [plain, shifted]] of Object.entries(SYMBOLS)) {
    if (!m.has(plain)) m.set(plain, { code, shift: false });
    if (!m.has(shifted)) m.set(shifted, { code, shift: true });
  }
  m.set(" ", { code: "Space", shift: false });
  m.set("\n", { code: "Enter", shift: false });
  return m;
})();

/** 이 스트로크를 치려면 어느 키를 어떻게 눌러야 하는가. 모르면 null. */
export function keyFor(stroke) { return REVERSE.get(stroke) || null; }

/** 눌린 키 → 스트로크. 자판에 없는 키면 null.
 *  한글 자리가 먼저다 — Comma·Period·Slash 처럼 둘 다 있는 자리는 없지만,
 *  나중에 겹치더라도 자모 쪽이 이기도록 순서를 이렇게 둔다. */
export function strokeFor(code, shift) {
  const jamo = KEYMAP[code];
  if (jamo) return jamo[shift ? 1 : 0];
  const sym = SYMBOLS[code];
  if (sym) return sym[shift ? 1 : 0];
  if (code === "Space") return " ";
  if (code === "Enter") return "\n";
  return null;
}

/* ── 운지 ──
 * 표준 운지법 그대로다. 한 손가락이 맡는 세로줄을 묶어 두고 색으로 구분한다.
 *
 * 색은 왼손과 오른손을 거울처럼 맞춰 다섯 가지만 쓴다. 아홉 색을 다 다르게 하면
 * 서로 구별이 안 될뿐더러, 아이가 외워야 할 것이 아홉 개가 된다. 짝이 되는
 * 손가락끼리 같은 색이면 "이 색은 새끼손가락" 하나로 외워진다.
 *
 * 붉은색은 쓰지 않는다 — 틀린 자리를 알리는 색으로 남겨 둬야, 강조와 오류가
 * 한 화면에서 헷갈리지 않는다. */
const HUE = {
  pinky: "#a78bfa", ring: "#4fc3d9", middle: "#f0b429", index: "#43bf8f", thumb: "#93a7c0",
};
export const FINGERS = {
  l5: { name: "왼손 새끼", short: "새끼", color: HUE.pinky },
  l4: { name: "왼손 약지", short: "약지", color: HUE.ring },
  l3: { name: "왼손 중지", short: "중지", color: HUE.middle },
  l2: { name: "왼손 검지", short: "검지", color: HUE.index },
  th: { name: "엄지", short: "엄지", color: HUE.thumb },
  r2: { name: "오른손 검지", short: "검지", color: HUE.index },
  r3: { name: "오른손 중지", short: "중지", color: HUE.middle },
  r4: { name: "오른손 약지", short: "약지", color: HUE.ring },
  r5: { name: "오른손 새끼", short: "새끼", color: HUE.pinky },
};

const FINGER_OF = {};
{
  const cols = {
    l5: ["Backquote", "Digit1", "KeyQ", "KeyA", "KeyZ", "Tab", "CapsLock", "ShiftLeft"],
    l4: ["Digit2", "KeyW", "KeyS", "KeyX"],
    l3: ["Digit3", "KeyE", "KeyD", "KeyC"],
    l2: ["Digit4", "Digit5", "KeyR", "KeyT", "KeyF", "KeyG", "KeyV", "KeyB"],
    th: ["Space"],
    r2: ["Digit6", "Digit7", "KeyY", "KeyU", "KeyH", "KeyJ", "KeyN", "KeyM"],
    r3: ["Digit8", "KeyI", "KeyK", "Comma"],
    r4: ["Digit9", "KeyO", "KeyL", "Period"],
    r5: ["Digit0", "Minus", "Equal", "KeyP", "BracketLeft", "BracketRight", "Semicolon", "Quote",
         "Slash", "Backslash", "Enter", "Backspace", "ShiftRight"],
  };
  for (const [f, codes] of Object.entries(cols)) for (const c of codes) FINGER_OF[c] = f;
}

/** 키 code → 손가락 열쇠(l2 따위). 모르면 null. */
export function fingerOf(code) { return FINGER_OF[code] || null; }

/* ── 낱자 표 ── */
const CHO = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const JUNG = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ"];
const JONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];

const CHO_I = new Map(CHO.map((c, i) => [c, i]));
const JUNG_I = new Map(JUNG.map((c, i) => [c, i]));
const JONG_I = new Map(JONG.map((c, i) => [c, i]));

/** 겹모음 → 눌러야 하는 두 자리 */
const JUNG_SPLIT = {
  "ㅘ": ["ㅗ", "ㅏ"], "ㅙ": ["ㅗ", "ㅐ"], "ㅚ": ["ㅗ", "ㅣ"],
  "ㅝ": ["ㅜ", "ㅓ"], "ㅞ": ["ㅜ", "ㅔ"], "ㅟ": ["ㅜ", "ㅣ"], "ㅢ": ["ㅡ", "ㅣ"],
};
/** 겹받침 → 눌러야 하는 두 자리 */
const JONG_SPLIT = {
  "ㄳ": ["ㄱ", "ㅅ"], "ㄵ": ["ㄴ", "ㅈ"], "ㄶ": ["ㄴ", "ㅎ"], "ㄺ": ["ㄹ", "ㄱ"], "ㄻ": ["ㄹ", "ㅁ"],
  "ㄼ": ["ㄹ", "ㅂ"], "ㄽ": ["ㄹ", "ㅅ"], "ㄾ": ["ㄹ", "ㅌ"], "ㄿ": ["ㄹ", "ㅍ"], "ㅀ": ["ㄹ", "ㅎ"], "ㅄ": ["ㅂ", "ㅅ"],
};
/* 조합할 때 쓰는 반대 방향 표 */
const JUNG_JOIN = new Map(Object.entries(JUNG_SPLIT).map(([w, [a, b]]) => [a + b, w]));
const JONG_JOIN = new Map(Object.entries(JONG_SPLIT).map(([w, [a, b]]) => [a + b, w]));

const isVowel = (s) => JUNG_I.has(s);
const isConsonant = (s) => CHO_I.has(s) || JONG_I.has(s);
/** 한글 낱자인가 (자음이든 모음이든) */
export const isJamo = (s) => isVowel(s) || isConsonant(s);

/* ── 풀기 ── */

/** 글자 하나 → 눌러야 하는 스트로크들. 한글이 아니면 그 글자 하나. */
export function decompose(ch) {
  const code = ch.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return [ch];
  const i = code - 0xac00;
  const cho = CHO[Math.floor(i / 588)];
  const jung = JUNG[Math.floor((i % 588) / 28)];
  const jong = JONG[i % 28];
  const out = [cho, ...(JUNG_SPLIT[jung] || [jung])];
  if (jong) out.push(...(JONG_SPLIT[jong] || [jong]));
  return out;
}

/** 글월 하나 → 스트로크 열 전체 */
export function strokesOf(text) {
  const out = [];
  for (const ch of String(text)) out.push(...decompose(ch));
  return out;
}

/** 이 글월을 치는 데 쓰이는 낱자 집합. 단계별로 칠 수 있는 낱말을 고를 때 쓴다. */
export function jamoSetOf(text) {
  return new Set(strokesOf(text).filter(isJamo));
}

/* ── 조합 ──
 *
 * 지금까지 누른 스트로크를 다시 글자로 붙인다. 지문에서 풀어낸 열을 그대로
 * 되돌리면 원래 글월이 정확히 다시 나오고, 도중까지만 넣으면 "ㄱ → 가 → 각"
 * 처럼 조합 중인 모습이 나온다. 화면에 보여 줄 글자를 이걸로 만든다.
 */
export function compose(strokes) {
  const out = [];
  let cho = null, jung = null, jong = null;

  const flush = () => {
    if (cho !== null && jung !== null) {
      out.push(String.fromCharCode(0xac00 + (CHO_I.get(cho) * 21 + JUNG_I.get(jung)) * 28 + (jong ? JONG_I.get(jong) : 0)));
    } else if (cho !== null) out.push(cho);
    else if (jung !== null) out.push(jung);
    cho = jung = jong = null;
  };

  for (const s of strokes) {
    if (!isJamo(s)) { flush(); out.push(s); continue; }

    if (isConsonant(s) && !isVowel(s)) {
      if (cho !== null && jung !== null && jong === null && JONG_I.has(s)) { jong = s; continue; }
      if (jong !== null && JONG_JOIN.has(jong + s)) { jong = JONG_JOIN.get(jong + s); continue; }
      flush();
      if (CHO_I.has(s)) cho = s; else out.push(s);
      continue;
    }

    // 모음
    if (cho !== null && jung === null) { jung = s; continue; }
    if (jung !== null && jong === null && JUNG_JOIN.has(jung + s)) { jung = JUNG_JOIN.get(jung + s); continue; }
    if (jong !== null) {
      // 받침이 다음 글자의 첫소리로 넘어간다 — "먹" + ㅓ → "머" + "거"
      const pair = JONG_SPLIT[jong];
      const moved = pair ? pair[1] : jong;
      jong = pair ? pair[0] : null;
      flush();
      cho = moved; jung = s;
      continue;
    }
    flush();
    jung = s;
  }
  flush();
  return out.join("");
}

/** 이 글월이 어떤 요소를 쓰는지 훑는다. 단계별로 칠 수 있는 낱말을 고를 때 쓴다.
 *  jamo   : 쓰이는 낱자 집합
 *  jong   : 받침이 있는가
 *  dblJong: 겹받침이 있는가 (ㄳ ㄺ ㅄ …)
 *  diph   : 겹모음이 있는가 (ㅘ ㅚ ㅢ …)
 *  shift  : shift 를 눌러야 하는 자리가 있는가 (쌍자음 · ㅒㅖ) */
export function analyze(text) {
  const out = { jamo: new Set(), jong: false, dblJong: false, diph: false, shift: false, strokes: 0 };
  for (const ch of String(text)) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      const i = code - 0xac00;
      const jung = JUNG[Math.floor((i % 588) / 28)];
      const jong = JONG[i % 28];
      if (jong) { out.jong = true; if (JONG_SPLIT[jong]) out.dblJong = true; }
      if (JUNG_SPLIT[jung]) out.diph = true;
    }
    for (const s of decompose(ch)) {
      out.strokes++;
      if (isJamo(s)) out.jamo.add(s);
      const k = keyFor(s);
      if (k && k.shift) out.shift = true;
    }
  }
  return out;
}
