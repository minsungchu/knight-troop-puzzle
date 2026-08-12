/* 방 채팅 — 휘발성
 *
 * 어디에도 저장하지 않는다. DB 테이블도 없고 localStorage 도 쓰지 않는다.
 * Realtime 브로드캐스트로만 흐르고, 화면에 남는 것은 최근 MAX_KEEP 줄뿐이며
 * 방을 나가거나 새로고침하면 사라진다. 늦게 들어온 사람은 그 전 대화를 볼 수 없다.
 *
 * 거르기는 보낼 때와 받을 때 모두 한다. 브로드캐스트는 클라이언트가 직접 부를 수 있어
 * 보내는 쪽 검사만으로는 우회되기 때문이다.
 */
import { $, esc } from "./ui.js";
import { cleanMessage, MAX_LEN } from "./filter.js";

/** 화면에 남겨 두는 최대 줄 수. 넘으면 오래된 것부터 버린다. */
const MAX_KEEP = 60;

/** 도배 막기 — 이 간격보다 자주, 또는 이 창 안에서 이만큼 넘게 보낼 수 없다 */
const MIN_GAP_MS = 700;
const WINDOW_MS = 10000;
const WINDOW_MAX = 8;

let rows = [];              // { who, name, text, mine, kind }
let sendFn = null;          // room.js 가 넘겨주는 실제 전송 함수
let open = false;
let unread = 0;
let lastSentAt = 0;
let recent = [];            // 최근 보낸 시각들
let lastText = "";
let repeatCount = 0;

/* ══════════════ 화면 ══════════════ */

function el() { return $("#chatDock"); }

/** 방에 들어갈 때 부른다. send(text) 는 실제 브로드캐스트를 맡는다. */
export function mount(send, title) {
  sendFn = send;
  rows = []; unread = 0; recent = []; lastText = ""; repeatCount = 0;

  let dock = el();
  if (!dock) {
    dock = document.createElement("div");
    dock.id = "chatDock";
    dock.className = "chat-dock";
    document.body.appendChild(dock);
  }
  dock.hidden = false;
  dock.innerHTML = `
    <div class="chat-pop" id="chatPop" aria-live="polite"></div>
    <button class="chat-tab" id="chatTab" aria-expanded="${open}">
      <span>대화</span><span class="chat-badge" id="chatBadge" hidden>0</span>
    </button>
    <div class="chat-body" id="chatBody" ${open ? "" : "hidden"}>
      <div class="chat-head">
        <b>${esc(title || "방 대화")}</b>
        <span class="chat-note">기록은 남지 않습니다</span>
      </div>
      <div class="chat-log" id="chatLog" role="log" aria-live="polite"></div>
      <form class="chat-form" id="chatForm">
        <input type="text" id="chatInput" maxlength="${MAX_LEN}" autocomplete="off"
               placeholder="메시지를 입력하세요" aria-label="채팅 입력">
        <button class="btn" type="submit">보내기</button>
      </form>
      <p class="chat-err" id="chatErr" role="alert"></p>
    </div>`;

  $("#chatTab").onclick = toggle;
  $("#chatForm").addEventListener("submit", onSubmit);
  render();
  system("방에 들어왔습니다. 대화는 이 방에서만 오가고 어디에도 저장되지 않습니다.");
}

/** 방을 나갈 때 부른다. 남은 대화를 전부 버린다. */
export function unmount() {
  rows = []; sendFn = null; unread = 0;
  const dock = el();
  if (dock) { dock.hidden = true; dock.innerHTML = ""; }
}

function toggle() {
  open = !open;
  const body = $("#chatBody");
  if (body) body.hidden = !open;
  $("#chatTab").setAttribute("aria-expanded", String(open));
  if (open) { unread = 0; badge(); clearBubbles(); scrollDown(); $("#chatInput")?.focus(); }
}

function badge() {
  const b = $("#chatBadge");
  if (!b) return;
  b.hidden = unread === 0;
  b.textContent = unread > 99 ? "99+" : String(unread);
}

function scrollDown() {
  const log = $("#chatLog");
  if (log) log.scrollTop = log.scrollHeight;
}

function render() {
  const log = $("#chatLog");
  if (!log) return;
  log.innerHTML = rows.map((r) => r.kind === "system"
    ? `<div class="chat-sys">${esc(r.text)}</div>`
    : `<div class="chat-row${r.mine ? " mine" : ""}">
         <span class="chat-who">${esc(r.name)}</span>
         <span class="chat-text">${esc(r.text)}</span>
       </div>`).join("");
  scrollDown();
}

function push(row) {
  rows.push(row);
  if (rows.length > MAX_KEEP) rows.splice(0, rows.length - MAX_KEEP);
  render();
  if (!open && row.kind !== "system") { unread++; badge(); popBubble(row); }
}

/* ── 접혀 있을 때의 말풍선 ──
   창을 닫아 둔 채 판을 풀고 있으면 배지 숫자만으로는 누가 뭘 말했는지 모른다.
   짧게 띄웠다 스스로 사라지고, 누르면 대화창이 열린다. */
const BUBBLE_MS = 5000;
const BUBBLE_MAX = 3;
const BUBBLE_CHARS = 42;

function popBubble(row) {
  const box = $("#chatPop");
  if (!box) return;
  const short = row.text.length > BUBBLE_CHARS ? row.text.slice(0, BUBBLE_CHARS - 1) + "…" : row.text;

  const el = document.createElement("div");
  el.className = "chat-bubble";
  el.innerHTML = `<b>${esc(row.name)}</b>${esc(short)}`;
  el.title = "누르면 대화창이 열립니다";
  el.addEventListener("click", () => { if (!open) toggle(); });
  box.appendChild(el);

  while (box.childElementCount > BUBBLE_MAX) box.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 300);
  }, BUBBLE_MS);
}

const clearBubbles = () => { const b = $("#chatPop"); if (b) b.innerHTML = ""; };

/** 안내문. 상대에게 전송되지 않고 내 화면에만 남는다. */
export function system(text) {
  if (el()) push({ kind: "system", text });
}

function showErr(msg) {
  const e = $("#chatErr");
  if (!e) return;
  e.textContent = msg || "";
  if (msg) setTimeout(() => { if (e.textContent === msg) e.textContent = ""; }, 2600);
}

/* ══════════════ 보내기 ══════════════ */

function onSubmit(ev) {
  ev.preventDefault();
  const input = $("#chatInput");
  const raw = input.value;

  const now = Date.now();
  recent = recent.filter((t) => now - t < WINDOW_MS);
  if (now - lastSentAt < MIN_GAP_MS) { showErr("너무 빠릅니다. 잠시 뒤에 보내세요."); return; }
  if (recent.length >= WINDOW_MAX) { showErr("잠깐 쉬었다 보내 주세요."); return; }

  const r = cleanMessage(raw);
  if (!r.ok) { showErr(r.reason); return; }

  if (r.text === lastText) {
    if (++repeatCount >= 3) { showErr("같은 말을 반복하고 있습니다."); return; }
  } else { lastText = r.text; repeatCount = 0; }

  input.value = "";
  showErr("");
  lastSentAt = now;
  recent.push(now);

  if (sendFn) sendFn(r.text);
}

/** 브로드캐스트로 들어온 줄. 보낸 쪽을 믿지 않고 여기서 한 번 더 거른다. */
export function receive({ name, text, mine }) {
  const r = cleanMessage(text);
  if (!r.ok) return;
  push({ kind: "msg", name: String(name || "?").slice(0, 16), text: r.text, mine: !!mine });
}
