/* 랭킹 — 보드 조회와 기록 등록 */
import { $, esc, veil, hideVeil, toast, onTab, Store, fmtPrecise, fmtDate } from "./ui.js";
import { ONLINE, PRESET_SIZES, LEVELS, STORE_KEY } from "./config.js";
import { client, myName, uid, onAuth, sessionValid, readableError } from "./supabase.js";
import { requireLogin } from "./auth.js";

const SUBMITTED_KEY = STORE_KEY + ":submitted";

let size = 8, level = 2;
let loadToken = 0;

/** 이 규격·난이도가 랭킹 보드에 있는가 */
export const isRanked = (W, H, lv) => W === H && PRESET_SIZES.includes(W) && lv >= 1 && lv <= 3;

/* ══════════════ 화면 ══════════════ */

export function init() {
  $("#rankSizes").innerHTML = PRESET_SIZES.map((n) =>
    `<button class="chip${n === size ? " on" : ""}" data-size="${n}" role="tab">${n}×${n}</button>`).join("");
  $("#rankLevels").innerHTML = [1, 2, 3].map((n) =>
    `<button class="chip${n === level ? " on" : ""}" data-level="${n}" role="tab">${LEVELS[n]}</button>`).join("");

  $("#rankSizes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-size]"); if (!b) return;
    size = +b.dataset.size; syncChips(); load();
  });
  $("#rankLevels").addEventListener("click", (e) => {
    const b = e.target.closest("[data-level]"); if (!b) return;
    level = +b.dataset.level; syncChips(); load();
  });

  onTab((name) => { if (name === "rank") load(); });
  onAuth(() => { if (!$(".view[data-view='rank']").hidden) load(); });
}

function syncChips() {
  document.querySelectorAll("#rankSizes .chip").forEach((b) => b.classList.toggle("on", +b.dataset.size === size));
  document.querySelectorAll("#rankLevels .chip").forEach((b) => b.classList.toggle("on", +b.dataset.level === level));
}

/** 랭킹 보드를 열 때 규격·난이도를 지정할 수 있다. */
export function show(s, l) {
  if (s) size = s;
  if (l) level = l;
  syncChips();
  load();
}

async function load() {
  const body = $("#rankBody");
  if (!ONLINE) {
    body.innerHTML = `<div class="empty">랭킹은 온라인 기능입니다.<br>
      <b>js/config.js</b> 에 Supabase 설정을 채우면 켜집니다.</div>`;
    return;
  }

  const token = ++loadToken;
  body.innerHTML = `<div class="empty"><div class="spin"></div>불러오는 중…</div>`;

  const sb = await client();
  if (!sb) { body.innerHTML = `<div class="empty">서버에 연결하지 못했습니다.</div>`; return; }

  const [top, mine] = await Promise.all([
    sb.rpc("leaderboard", { p_size: size, p_level: level, p_limit: 100 }),
    uid() ? sb.rpc("my_rank", { p_size: size, p_level: level }) : Promise.resolve({ data: [] }),
  ]);
  if (token !== loadToken) return;                       // 그 사이 다른 보드를 눌렀다

  if (top.error) {
    body.innerHTML = `<div class="empty">랭킹을 불러오지 못했습니다.<br>${esc(readableError(top.error))}</div>`;
    return;
  }

  const rows = top.data || [];
  const my = (mine && mine.data && mine.data[0]) || null;
  const name = myName();

  if (!rows.length) {
    body.innerHTML = `<div class="empty">${size}×${size} · ${LEVELS[level]} 보드에 아직 기록이 없습니다.<br>
      힌트 없이 완주하면 <b>첫 기록</b>이 됩니다.</div>`;
    return;
  }

  const line = (r, cls) => `<tr class="${cls}">
      <td class="rank">${r.rank}</td>
      <td class="name">${esc(r.username)}</td>
      <td class="num">${fmtPrecise(r.ms)}</td>
      <td class="when">${fmtDate(r.created_at)}</td>
    </tr>`;

  const inTop = my && rows.some((r) => r.username === name);
  const tail = my && !inTop
    ? `<tr class="tbl-sep"><td colspan="4"></td></tr>`
      + line({ rank: my.rank, username: name, ms: my.ms, created_at: my.created_at }, "me")
    : "";

  body.innerHTML = `<div class="tbl-scroll"><table class="tbl">
      <thead><tr><th></th><th>이름</th><th style="text-align:right">기록</th><th>달성</th></tr></thead>
      <tbody>
        ${rows.map((r) => line(r, (r.rank === 1 ? "top1 " : "") + (r.username === name ? "me" : ""))).join("")}
        ${tail}
      </tbody>
    </table></div>`;
}

/* ══════════════ 기록 등록 ══════════════ */

const submitted = () => {
  try { return new Set(JSON.parse(Store.get(SUBMITTED_KEY) || "[]")); } catch { return new Set(); }
};
const markSubmitted = (sig) => {
  const s = submitted(); s.add(sig);
  Store.set(SUBMITTED_KEY, JSON.stringify(Array.from(s).slice(-200)));
};

/** 완주 결과를 받아 조건을 따져 등록하고, 완주 화면에 한 줄 남긴다. */
export async function onWin(r) {
  const ranked = isRanked(r.W, r.H, r.level);

  if (!ONLINE) return;

  if (!myName()) {
    if (ranked && !r.hints) {
      fillWinSlot(`<div class="form-note">로그인하면 이 기록을 랭킹에 올릴 수 있습니다.
        <br><button class="link" id="winLogin">지금 로그인</button></div>`, () => {
        const b = $("#winLogin");
        if (b) b.onclick = () => { hideVeil(); requireLogin("완주 기록을 랭킹에 올리려면 로그인이 필요합니다."); };
      });
    }
    return;
  }

  if (submitted().has(r.sig)) return;                    // 같은 판 중복 등록 방지
  if (!(await sessionValid())) return;

  const sb = await client();
  if (!sb) return;

  const { error } = await sb.rpc("submit_score", {
    p_size: r.W, p_level: r.level, p_ms: Math.round(r.ms),
    p_hints: r.hints, p_room: r.roomId || null,
  });

  if (error) { console.warn("[rank] 기록 등록 실패", error); return; }
  markSubmitted(r.sig);

  if (!ranked) {
    fillWinSlot(`<div class="form-note">${r.W}×${r.H} 는 랭킹 보드가 없는 규격입니다.
      기록은 <b>내 기록</b>에 남았습니다.</div>`);
    return;
  }
  if (r.hints) {
    fillWinSlot(`<div class="form-note">힌트를 ${r.hints}번 썼기 때문에 랭킹에는 오르지 않습니다.
      기록은 <b>내 기록</b>에 남았습니다.</div>`);
    return;
  }

  // 등록됐으니 이 판의 내 순위를 알려 준다
  const { data } = await sb.rpc("my_rank", { p_size: r.W, p_level: r.level });
  const my = data && data[0];
  const best = my && Math.round(r.ms) <= my.ms + 1;
  fillWinSlot(
    `<div class="form-note">${my
      ? `${r.W}×${r.W} · ${LEVELS[r.level]} 랭킹 <b>${my.rank}위</b>${best ? " — 개인 최고 기록입니다." : ` (내 최고 ${fmtPrecise(my.ms)})`}`
      : "랭킹에 등록했습니다."}
      <br><button class="link" id="winRank">랭킹 보기</button></div>`,
    () => {
      const b = $("#winRank");
      if (b) b.onclick = () => { hideVeil(); show(r.W, r.level); document.querySelector('.tab[data-tab="rank"]').click(); };
    }
  );
}

/** 완주 오버레이는 조금 뒤에 뜨므로, 자리가 생길 때까지 잠깐 기다렸다 채운다. */
function fillWinSlot(html, after) {
  let tries = 0;
  const put = () => {
    const slot = $("#winSlot");
    if (slot) { slot.innerHTML = html; if (after) after(); return; }
    if (++tries < 30) setTimeout(put, 120);
  };
  put();
}

/* ══════════════ 내 기록 ══════════════ */

export async function openMyRecords() {
  if (!requireLogin("내 기록을 보려면 로그인이 필요합니다.")) return;

  veil(`<h2>내 기록</h2><div class="spin"></div>`, { wide: true });
  const sb = await client();
  const { data, error } = await sb.rpc("my_scores", { p_limit: 50 });

  if (error) { toast(readableError(error)); hideVeil(); return; }
  if (!data || !data.length) {
    veil(`<h2>내 기록</h2><p>아직 완주 기록이 없습니다.</p>
      <div class="card-actions"><button class="btn" id="closeBtn">닫기</button></div>`, { wide: true });
    $("#closeBtn").onclick = hideVeil;
    return;
  }

  veil(`<h2>내 기록</h2>
    <div class="tbl-scroll"><table class="tbl">
      <thead><tr><th>규격</th><th>난이도</th><th style="text-align:right">기록</th><th></th><th>완주</th></tr></thead>
      <tbody>${data.map((s) => `<tr>
        <td class="name">${s.size}×${s.size}</td>
        <td>${LEVELS[s.level]}</td>
        <td class="num">${fmtPrecise(s.ms)}</td>
        <td>${s.hints_used ? `<span class="badge">힌트 ${s.hints_used}</span>`
             : (s.room_id ? `<span class="badge">대전</span>` : "")}</td>
        <td class="when">${fmtDate(s.created_at)}</td>
      </tr>`).join("")}</tbody>
    </table></div>
    <div class="card-actions"><button class="btn" id="closeBtn">닫기</button></div>`, { wide: true });
  $("#closeBtn").onclick = hideVeil;
}
