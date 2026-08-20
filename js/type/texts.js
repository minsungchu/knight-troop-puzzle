/* 베껴쓰기 지문과 자유 작문 글감을 읽어 둔다.
 *
 * 낱말(topics.js)과 따로 두는 이유는 쓰임이 달라서다. 낱말은 단계에 맞춰 걸러 내야
 * 하지만 지문은 통째로 하나가 한 판이다. 주제 id 만 맞춰 두면 같은 칩으로 고를 수 있다.
 */

let data = null;

export async function load() {
  if (data) return data;
  const res = await fetch("data/type-texts.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("지문을 불러오지 못했습니다");
  data = await res.json();
  return data;
}

const has = (ids, topic) => !ids || !ids.size || ids.has(topic);

/** 고른 주제의 지문들 */
export const textsFor = (ids) => (data ? data.texts.filter((t) => has(ids, t.topic)) : []);

/** 고른 주제의 글감들 */
export const promptsFor = (ids) => (data ? data.prompts.filter((p) => has(ids, p.topic)) : []);

export const allTexts = () => (data ? data.texts : []);
