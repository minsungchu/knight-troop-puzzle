/* 채팅 글 다듬기 — 비속어 가리기와 일반적인 입력 정리
 *
 * 보내는 쪽과 받는 쪽 양쪽에서 돌린다. 브로드캐스트는 클라이언트가 직접 부를 수 있으므로
 * 보내는 쪽 검사만으로는 우회된다. 받는 쪽에서도 걸러야 남의 화면에 그대로 뜨지 않는다.
 *
 * 낱말 목록은 아래 BAD 에 있다. 완벽할 수 없고 완벽할 필요도 없다 —
 * 대놓고 쓰는 말을 가려 주는 정도가 목적이다.
 */

/** 한 줄 최대 길이 */
export const MAX_LEN = 200;

/** 같은 글자를 이만큼 넘게 이으면 잘라 낸다 (ㅋㅋㅋㅋㅋ… 도배 방지) */
const MAX_RUN = 8;

/* 가릴 낱말. 띄어쓰기·특수문자·숫자를 지운 형태로 비교하므로
   "ㅅ ㅂ", "시*발" 같은 변형도 걸린다. */
const BAD = [
  // 한국어
  "시발", "씨발", "씨빨", "시팔", "씨팔", "쉬발", "쒸발", "십발", "씹할", "씨발년", "시발놈",
  "병신", "븅신", "빙신", "등신",
  "새끼", "쌔끼", "개새", "개색", "좆", "존나", "졸라", "지랄", "니미", "니애미", "느금마", "니애비",
  "썅", "쌍놈", "쌍년", "개년", "개놈", "미친놈", "미친년", "또라이", "돌아이",
  "보지", "자지", "꺼져", "닥쳐",
  // 초성·자모 변형
  "ㅅㅂ", "ㅆㅂ", "ㅄ", "ㅂㅅ", "ㅈㄹ", "ㄲㅈ", "ㅁㅊ", "ㄴㅁ",
  // 영어
  "fuck", "fuk", "fck", "shit", "bitch", "asshole", "bastard", "dick", "pussy",
  "cunt", "slut", "whore", "nigger", "nigga", "retard", "faggot",
];

/* 위 낱말을 품고 있지만 욕이 아닌 말. 이쪽을 먼저 확인한다.
   예: "시발점"에는 "시발"이, "새끼손가락"에는 "새끼"가 들어 있다. */
const ALLOW = [
  "시발점", "시발역", "시발지", "시발차",
  "새끼손가락", "새끼발가락", "새끼손톱", "새끼발톱",
  "고양이새끼", "강아지새끼", "호랑이새끼",
  "보지도", "보지만", "보지는", "보지요", "보지 못", "보지 않", "돌아보지", "지켜보지",
  "자지도", "자지만", "자지는", "자지요", "자지 않",
  "analysis", "assassin", "assign", "assist", "assume", "bass", "class", "grass",
  "pass", "mass", "shiitake", "scunthorpe", "dickens", "cocktail",
];

/* 눈에 안 보이는 글자 — 제어문자, 폭 없는 공백, 방향 지정 문자.
   글자 사이에 끼워 넣어 낱말 검사를 피하는 데 쓰이므로 먼저 지운다. */
const INVISIBLE_RANGES = [
  0x00, 0x08,   0x0b, 0x1f,   0x7f, 0x9f,   // 제어문자
  0xad, 0xad,                               // soft hyphen
  0x200b, 0x200f,                           // 폭 없는 공백 · 방향 표시
  0x202a, 0x202e,                           // 방향 강제
  0x2060, 0x2064,                           // word joiner 계열
  0xfeff, 0xfeff,                           // BOM
];

function stripInvisible(s) {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0);
    let drop = false;
    for (let i = 0; i < INVISIBLE_RANGES.length; i += 2) {
      if (c >= INVISIBLE_RANGES[i] && c <= INVISIBLE_RANGES[i + 1]) { drop = true; break; }
    }
    if (!drop) out += ch;
  }
  return out;
}

/** 비교용 압축형과, 압축형 각 글자가 원문 어디서 왔는지의 대응표를 만든다. */
function compact(s) {
  const chars = [], map = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    // 한글·영문만 남긴다. 띄어쓰기·숫자·특수문자는 우회 수단이므로 지운다.
    if (/[가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z]/.test(c)) {
      chars.push(c.toLowerCase());
      map.push(i);
    }
  }
  return { text: chars.join(""), map };
}

/** 원문에서 예외 낱말이 차지한 구간을 모은다. */
function allowedSpans(original) {
  const lower = original.toLowerCase();
  const spans = [];
  for (const w of ALLOW) {
    const needle = w.toLowerCase();
    let from = 0, at;
    while ((at = lower.indexOf(needle, from)) !== -1) {
      spans.push([at, at + needle.length]);
      from = at + 1;
    }
  }
  return spans;
}

const overlaps = (spans, a, b) => spans.some(([s, e]) => a < e && b > s);

/** 비속어를 ● 로 가린다. 원문의 띄어쓰기와 문장부호는 그대로 둔다. */
export function maskProfanity(original) {
  const { text, map } = compact(original);
  if (!text) return { text: original, hits: 0 };

  const allow = allowedSpans(original);
  const chars = original.split("");
  let hits = 0;

  for (const word of BAD) {
    const needle = word.toLowerCase();
    let from = 0, at;
    while ((at = text.indexOf(needle, from)) !== -1) {
      const start = map[at], end = map[at + needle.length - 1] + 1;
      if (!overlaps(allow, start, end)) {
        for (let i = at; i < at + needle.length; i++) chars[map[i]] = "●";
        hits++;
      }
      from = at + 1;
    }
  }
  return { text: chars.join(""), hits };
}

/** 한 줄을 다듬는다. 보낼 때와 받을 때 모두 통과시킨다.
 *  @returns {{ok:boolean, text?:string, reason?:string, hits?:number}} */
export function cleanMessage(raw) {
  let s = String(raw == null ? "" : raw);

  s = stripInvisible(s);           // 안 보이는 글자 제거
  s = s.replace(/\s+/g, " ").trim();      // 줄바꿈·연속 공백을 하나로

  if (!s) return { ok: false, reason: "빈 메시지는 보낼 수 없습니다." };
  if (s.length > MAX_LEN) s = s.slice(0, MAX_LEN);

  // 같은 글자 도배를 줄인다 (ㅋ이 스무 개면 여덟 개로)
  s = s.replace(new RegExp(`(.)\\1{${MAX_RUN},}`, "gu"), (m, c) => c.repeat(MAX_RUN));

  const { text, hits } = maskProfanity(s);
  if (hits && text.replace(/[●\s]/g, "") === "") {
    return { ok: false, reason: "보낼 수 없는 말입니다." };
  }
  return { ok: true, text, hits };
}
