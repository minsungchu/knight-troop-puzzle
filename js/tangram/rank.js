/* 순위표 — 퀘스트마다 가장 빨리 깬 사람들 */

import { $, esc, fmtPrecise, fmtDate } from "../ui.js";
import { client, ONLINE, myName, readableError } from "../supabase.js";
import { QUESTS } from "./quests.js";
import * as Progress from "./progress.js";

let quest = 1, token = 0;

export function init() {
  const chips = $("#tgRankQuests");
  chips.innerHTML = QUESTS.map((q) =>
    `<button class="chip${q.id === quest ? " on" : ""}" data-q="${q.id}">${q.id}. ${esc(q.title)}</button>`).join("");
  chips.addEventListener("click", (e) => {
    const b = e.target.closest("[data-q]");
    if (!b) return;
    quest = +b.dataset.q;
    chips.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", +c.dataset.q === quest));
    render();
  });
}

export async function render() {
  const body = $("#tgRankBody");
  const mine = Progress.best(quest);
  const note = mine ? `<p class="hint tg-mine">내 최고 기록 <b>${fmtPrecise(mine)}</b></p>` : "";
  if (!ONLINE) { body.innerHTML = note + `<div class="empty">순위표는 온라인 설정이 있어야 합니다.</div>`; return; }

  const my = ++token;
  body.innerHTML = note + `<div class="empty"><div class="spin"></div>불러오는 중…</div>`;
  const sb = await client();
  const { data, error } = sb
    ? await sb.rpc("tangram_leaderboard", { p_quest: quest, p_limit: 100 })
    : { error: { message: "서버에 연결하지 못했습니다" } };
  if (my !== token) return;                              // 그 사이 다른 퀘스트를 눌렀다
  if (error) {
    // 서버에 패치를 아직 안 돌렸으면 그렇게 말한다 — 원문 오류로는 무엇을 해야 할지 모른다 (saving.js 와 같은 판별)
    const gone = /PGRST202|Could not find the function|does not exist|schema cache/i.test(error.message || "");
    body.innerHTML = note + `<div class="empty">순위표를 불러오지 못했습니다.<br>${gone
      ? "서버에 순위 기능이 아직 없습니다 — Supabase SQL Editor 에서 <b>supabase/patch-08-tangram.sql</b> 을 실행하세요."
      : esc(readableError(error))}</div>`;
    return;
  }
  const rows = data || [];
  const name = myName();
  body.innerHTML = note + (rows.length
    ? `<div class="tbl-scroll"><table class="tbl">
        <thead><tr><th></th><th>이름</th><th style="text-align:right">기록</th><th>달성</th></tr></thead>
        <tbody>${rows.map((r) => `<tr class="${r.rank === 1 ? "top1 " : ""}${r.username === name ? "me" : ""}">
          <td class="rank">${r.rank}</td>
          <td class="name">${esc(r.username)}</td>
          <td class="num">${fmtPrecise(r.ms)}</td>
          <td class="when">${fmtDate(r.cleared_at)}</td>
        </tr>`).join("")}</tbody>
      </table></div>`
    : `<div class="empty">아직 이 퀘스트를 깬 사람이 없습니다.<br>로그인하고 깨면 <b>첫 기록</b>이 됩니다.</div>`);
}
