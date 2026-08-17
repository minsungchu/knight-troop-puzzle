/* 급수 순위표.
 *
 * 대전 점수만 줄 세운다. 등반 기록은 순위로 매기지 않는다 — 판이 계정마다 같아서
 * 견줄 수는 있지만, 100단계를 다 오른 사람이 몇 초 빨랐는지는 급수와 다른 이야기다.
 * 등반은 '내가 어디까지 올랐나' 만 보여 주고 끝낸다.
 */

import { $, esc } from "../ui.js";
import { client, ONLINE, uid, myName, onAuth } from "../supabase.js";
import { grade, gradeName, BASE } from "./rating.js";

let drawn = false;

export function init() {
  onAuth(() => { if (drawn) render(); });
}

export async function render() {
  drawn = true;
  const body = $("#rkBody");
  if (!body) return;
  if (!ONLINE) { body.innerHTML = `<p class="hint">순위표는 온라인 설정이 있어야 합니다.</p>`; return; }

  body.innerHTML = `<div class="hint">불러오는 중…</div>`;

  let rows = [], mine = null;
  try {
    const { data, error } = await (await client()).rpc("laser_leaderboard", { p_limit: 100 });
    if (error) throw error;
    rows = data || [];
  } catch (e) {
    body.innerHTML = `<p class="hint">순위표를 불러오지 못했습니다. ${esc(e.message || "")}</p>`;
    return;
  }
  if (uid()) {
    try {
      const { data } = await (await client()).rpc("laser_my_rating");
      mine = data;
    } catch { /* 없어도 순위표는 보여 준다 */ }
  }

  const me = myName();
  body.innerHTML =
    (mine ? `<div class="lz-goal"><b>${gradeName(mine.rating)}</b> · ${mine.rating}점` +
       (mine.wins + mine.losses ? ` · ${mine.wins}승 ${mine.losses}패` : " · 아직 대전 기록이 없습니다") +
       `<br><span class="hint">기본 1000점에서 시작합니다. 1000점마다 한 급 올라가고, 1000점이 9급입니다.
        같은 점수끼리는 10점을 주고받고, 점수 차가 클수록 낮은 쪽이 더 많이 받습니다.</span></div>` : "") +
    `<div class="panel">
       <h2>급수 순위</h2>
       ${rows.length ? `<table>
         <thead><tr><th>순위</th><th>이름</th><th>급</th><th>점수</th><th>전적</th></tr></thead>
         <tbody>${rows.map((r) => `<tr${r.username === me ? ' style="background:rgba(201,151,63,.1)"' : ""}>
           <td class="num">${r.rank}</td>
           <td>${esc(r.username)}</td>
           <td class="num">${grade(r.rating)}급</td>
           <td class="num">${r.rating}</td>
           <td class="num">${r.wins}승 ${r.losses}패</td>
         </tr>`).join("")}</tbody></table>`
        : `<div class="hint">아직 대전을 치른 사람이 없습니다. 대전 탭에서 방을 만들어 보세요.</div>`}
     </div>`;
}
