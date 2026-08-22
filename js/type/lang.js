/* 한글이냐 영문이냐.
 *
 * 자리 익히기와 낱말 연습에만 갈래가 있다. 글쓰기·성 지키기·대결은 한글 그대로다 —
 * 영타는 자리를 익히는 것이 먼저고, 글을 쓰는 것은 그 다음 이야기다.
 *
 * 고른 것을 바꾸면 세 가지가 함께 바뀐다.
 *   · 화면 자판에 그려지는 글자와, 눌린 키가 무슨 글자가 되는가 (hangul.js 의 자판)
 *   · 단계 표와 문제 만드는 법 (curriculum.js)
 *   · 기록을 어느 이름으로 남기는가 — 'stage:3' 과 'en:stage:3' 은 다른 기록이다
 */
import { Store } from "../ui.js";
import { setLayout } from "./hangul.js";

const KEY = "type-lang:v1";
let lang = "ko";
let data = null;          // data/type-en.json

/** 지금 고른 것. "ko" 또는 "en" */
export const get = () => lang;
export const isEn = () => lang === "en";

/** 기록 이름 — 영문은 앞에 en: 을 붙여 한글 기록과 섞이지 않게 한다. */
export const item = (base) => (lang === "en" ? "en:" + base : base);

/** 바꾼다. 실제로 바뀌었으면 type-lang 을 알린다. */
export function set(v) {
  const next = v === "en" ? "en" : "ko";
  if (next === lang) return lang;
  lang = next;
  setLayout(lang);
  try { Store.set(KEY, lang); } catch { /* 안 남아도 이번 판은 된다 */ }
  document.dispatchEvent(new CustomEvent("type-lang"));
  return lang;
}

/** 영문 자료를 읽어 둔다. 못 읽으면 영문 쪽은 그 사실을 화면에 말한다. */
export async function load() {
  try {
    const res = await fetch("data/type-en.json");
    if (res.ok) data = await res.json();
  } catch { /* 화면에서 알린다 */ }
  const saved = Store.get(KEY);
  if (saved === "en" || saved === "ko") { lang = saved; setLayout(lang); }
  return data;
}

/* 판을 열 때 자판을 맞춘다. 갈래가 있는 화면은 apply(), 한글 전용 화면은 ko().
   고른 것은 그대로 두고 자판만 바꾸므로, 한글 게임을 하다 돌아와도 영문이 유지된다. */
export const apply = () => setLayout(lang);
export const ko = () => setLayout("ko");

export const ready = () => !!data;
export const words = () => (data && data.words) || [];
export const sentences = () => (data && data.sentences) || [];

/** 두 갈래를 고르는 단추 한 쌍. 누르면 set() 을 부르고 다시 그린다. */
export function switcher(host, onChange) {
  if (!host) return;
  host.innerHTML =
    `<div class="ty-lang" role="group" aria-label="한글·영문 고르기">
       <button type="button" class="ty-lang-b${lang === "ko" ? " on" : ""}" data-lang="ko">한글</button>
       <button type="button" class="ty-lang-b${lang === "en" ? " on" : ""}" data-lang="en">영문 ABC</button>
     </div>`;
  host.querySelectorAll("[data-lang]").forEach((b) => {
    b.onclick = () => { if (set(b.dataset.lang) !== undefined) onChange && onChange(); };
  });
}
