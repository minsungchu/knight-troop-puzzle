/* 자리 익히기 차례 — 무엇을 언제 배우는가.
 *
 * 두벌식은 왼손이 자음, 오른손이 모음을 맡는다. 그래서 홈row 여덟 자리
 * (ㅁㄴㅇㄹ · ㅗㅓㅏㅣ)만으로도 "오리" "머리" 같은 말이 바로 나온다.
 * 여기서 시작해 검지를 뻗는 자리, 윗줄, 아랫줄 순으로 넓힌다.
 *
 * 주제 낱말과 자리 진도가 부딪히는 지점이 있다. ㅁㄴㅇㄹ 여덟 자리만 배운 아이는
 * '공룡'을 칠 수 없다. 그래서 문제를 이렇게 만든다 —
 *   · 그 단계까지 배운 자리로 칠 수 있는 주제 낱말을 먼저 골라 넣고,
 *   · 모자란 만큼을 배운 자리로 만든 음절로 채운다.
 * 초반 단계에서는 걸리는 낱말이 거의 없어 저절로 음절 연습이 되고, 자리가 늘수록
 * 아이가 고른 주제의 낱말이 스스로 섞여 들어온다. 규칙 하나로 둘 다 된다.
 */

import { analyze, compose } from "./hangul.js";

/* 별을 주는 기준. 통과는 정확도로만 가른다 — 손이 느린 아이가 한 단계에 갇혀
   그만두는 일이 없어야 한다. 속도는 별 두 개·세 개로 따로 갚는다. */
export const PASS_ACC = 90;   // 이 정확도를 넘으면 다음 단계가 열린다
export const CPM_2 = 80;      // 분당 타수 — 별 둘
export const CPM_3 = 140;     // 분당 타수 — 별 셋

/** 정확도(%)와 분당 타수로 별 개수를 매긴다. 0이면 통과하지 못한 것. */
export function starsFor(acc, cpm) {
  if (acc < PASS_ACC) return 0;
  if (cpm >= CPM_3) return 3;
  if (cpm >= CPM_2) return 2;
  return 1;
}

const V = (s) => s.split("");

/* add  : 이 단계에서 새로 배우는 자리
   jong : 받침을 쓰는가        diph: 겹모음을 쓰는가
   dbl  : 겹받침을 쓰는가      punct: 공백 말고 문장부호도 나오는가 */
export const STAGES = [
  { n: 1,  title: "기본 자리",     sub: "왼손 ㅁㄴㅇㄹ · 오른손 ㅗㅓㅏㅣ",  add: V("ㅁㄴㅇㄹㅗㅓㅏㅣ") },
  { n: 2,  title: "검지 뻗기",     sub: "ㅎ 과 ㅡ — 검지를 옆으로",         add: V("ㅎㅡ") },
  { n: 3,  title: "검지 위아래",   sub: "ㄱㅅ · ㅜㅠ",                       add: V("ㄱㅅㅜㅠ") },
  { n: 4,  title: "윗줄 왼손",     sub: "ㅂㅈㄷ 과 ㅐㅔ",                    add: V("ㅂㅈㄷㅐㅔ") },
  { n: 5,  title: "아랫줄 왼손",   sub: "ㅋㅌㅊㅍ",                          add: V("ㅋㅌㅊㅍ") },
  { n: 6,  title: "윗줄 오른손",   sub: "ㅛㅕㅑ — 이제 자리를 다 배웠다",    add: V("ㅛㅕㅑ") },
  { n: 7,  title: "받침 붙이기",   sub: "새 자리는 없다. 밑에 자음을 하나 더", add: [], jong: true },
  { n: 8,  title: "쌍자음",        sub: "새끼손가락으로 shift 를 누른 채",   add: V("ㄲㄸㅃㅆㅉ"), jong: true },
  { n: 9,  title: "겹모음",        sub: "ㅘ ㅚ ㅢ … 모음 두 개를 이어서",     add: V("ㅒㅖ"), jong: true, diph: true,
    focus: ["ㅒ", "ㅖ", "ㅘ", "ㅙ", "ㅚ", "ㅝ", "ㅞ", "ㅟ", "ㅢ"] },
  { n: 10, title: "모두 모아",     sub: "겹받침까지 — 배운 것 전부",         add: [], jong: true, diph: true, dbl: true, punct: true },
];

/* 각 단계까지 배운 자리를 미리 쌓아 둔다.
   focus 는 '이번에 집중할 것' — 보통은 새로 배우는 자리와 같지만, 겹모음처럼
   새 자리가 아니라 조합을 배우는 단계에서는 따로 적어 준다. */
{
  const seen = new Set();
  for (const s of STAGES) {
    s.add.forEach((j) => seen.add(j));
    s.all = new Set(seen);
    if (!s.focus) s.focus = s.add;
  }
}

export const stageOf = (n) => STAGES.find((s) => s.n === n) || null;

/** 이 단계에서 그 낱말을 칠 수 있는가 */
export function fits(stage, word) {
  const a = analyze(word);
  if (a.jong && !stage.jong) return false;
  if (a.dblJong && !stage.dbl) return false;
  if (a.diph && !stage.diph) return false;
  for (const j of a.jamo) if (!stage.all.has(j)) return false;
  return true;
}

/* ── 음절 만들기 ── */

const CHO_ALL = V("ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ");
const JUNG_ALL = V("ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅜㅛㅠㅡㅣ");
const DIPH = ["ㅘ", "ㅙ", "ㅚ", "ㅝ", "ㅞ", "ㅟ", "ㅢ"];
const DIPH_PARTS = { "ㅘ": "ㅗㅏ", "ㅙ": "ㅗㅐ", "ㅚ": "ㅗㅣ", "ㅝ": "ㅜㅓ", "ㅞ": "ㅜㅔ", "ㅟ": "ㅜㅣ", "ㅢ": "ㅡㅣ" };
/* 받침으로 쓰는 자음.
   자리로만 따지면 ㅊㅋㅌㅍ 도 받침이 될 수 있지만, 그렇게 뽑으면 "앶" "븇" 같은
   한국어에 없는 덩어리가 나온다. 아이가 읽지도 못하는 글자를 치게 할 이유가 없어
   실제로 흔한 받침만 쓴다. */
const JONG_ALL = V("ㄱㄲㄴㄹㅁㅂㅅㅆㅇ");

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function poolsFor(stage) {
  const has = (j) => stage.all.has(j);
  const cho = CHO_ALL.filter(has);
  const jung = JUNG_ALL.filter(has);
  const diph = stage.diph ? DIPH.filter((d) => V(DIPH_PARTS[d]).every(has)) : [];
  const jong = stage.jong ? JONG_ALL.filter(has) : [];
  return { cho, jung: jung.concat(diph), jong };
}

/** 그 단계에서 낼 수 있는 음절 하나. 새로 배운 자리가 되도록 자주 나오게 한다. */
function syllable(stage, pools) {
  const fresh = stage.focus;
  const freshCho = fresh.filter((j) => pools.cho.includes(j));
  const freshJung = fresh.filter((j) => pools.jung.includes(j));

  let cho = pick(pools.cho);
  let jung = pick(pools.jung);
  // 새 자리가 있으면 절반 넘게 끼워 넣는다 — 배우러 온 자리를 안 만나면 뜻이 없다
  if (freshCho.length && Math.random() < 0.55) cho = pick(freshCho);
  if (freshJung.length && Math.random() < 0.55) jung = pick(freshJung);

  const parts = [cho, ...V(DIPH_PARTS[jung] || jung)];
  if (pools.jong.length && Math.random() < 0.45) parts.push(pick(pools.jong));
  return compose(parts);
}

/* ── 한 판 만들기 ──
 *
 * 한 단계는 다섯 줄이다. 한 줄은 낱말·음절을 공백으로 이어 붙인 것으로,
 * 스물 몇 타쯤 되게 끊는다. 한 줄이 너무 길면 아이가 어디를 치는지 놓친다.
 */
const LINES = 5;
const STROKES_PER_LINE = 26;
const MAX_ITEMS = 8;

/**
 * 그 단계의 문제를 만든다.
 * @param {object} stage
 * @param {string[]} words 아이가 고른 주제의 낱말 전부 (아직 못 치는 것도 섞여 있어도 된다)
 * @returns {string[]} 줄 다섯
 */
export function buildStage(stage, words) {
  const pools = poolsFor(stage);
  const usable = shuffle((words || []).filter((w) => fits(stage, w)));
  let wi = 0;

  const lines = [];
  for (let l = 0; l < LINES; l++) {
    const items = [];
    let strokes = 0;
    while (strokes < STROKES_PER_LINE && items.length < MAX_ITEMS) {
      /* 칠 수 있는 낱말이 많아질수록 낱말 쪽으로 기운다. 초반 단계는 걸리는 낱말이
         거의 없어 저절로 음절 연습이 되고, 자리를 다 배운 뒤에는 뜻 있는 말만 친다.
         음절이 아주 사라지지는 않게 둔다 — 새로 배운 자리를 콕 집어 반복시키는 데는
         낱말보다 음절이 낫다. */
      const wordOdds = usable.length >= 40 ? 0.85 : usable.length >= 10 ? 0.65 : usable.length ? 0.45 : 0;
      const useWord = Math.random() < wordOdds;
      const item = useWord ? usable[wi++ % usable.length] : syllable(stage, pools);
      items.push(item);
      strokes += analyze(item).strokes + 1;
    }
    /* 마침표와 물음표만 낸다. 느낌표는 숫자줄 shift 자리라, 화면 자판에 숫자줄이
       없는 지금은 어디를 누르라고 짚어 줄 수가 없다. 짚어 주지 못할 자리는 내지 않는다. */
    lines.push(items.join(" ") + (stage.punct && l % 2 === 1 ? pick([".", "?"]) : ""));
  }
  return lines;
}

/** 낱말 연습 한 판 — 배운 자리를 따지지 않고 고른 주제에서 그대로 낸다. */
export function buildWordRun(words, count) {
  const list = shuffle(words.slice());
  const out = [];
  for (let i = 0; i < (count || 20); i++) out.push(list[i % list.length]);
  return out;
}

export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
