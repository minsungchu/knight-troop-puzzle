/* 글쓰기 — 베껴쓰기와 자유 작문.
 *
 * 두 가지를 한 탭에 둔 것은 순서가 있어서다. 남의 글을 그대로 옮겨 치면서 손이
 * 문장에 익숙해지고, 그다음에 자기 글을 쓴다. 베껴쓰기는 연습 화면을 그대로 쓰고
 * (규칙이 같아야 아이가 헷갈리지 않는다), 자유 작문만 다른 판을 쓴다.
 */
import { $, esc, toast } from "../ui.js";
import * as Sfx from "../sound.js";
import * as Progress from "./progress.js";
import * as Topics from "./topics.js";
import * as Texts from "./texts.js";
import * as Trainer from "./trainer.js";
import * as Writings from "./writings.js";
import { createComposer } from "./composer.js";
import { capture } from "./input.js";
import * as KB from "./keyboard.js";
import { analyze } from "./hangul.js";

let homeEl, playEl;
let mode = "copy";          // "copy" | "free"

export function init() {
  homeEl = $("#tyWriteHome");
  playEl = $("#tyWritePlay");
  document.addEventListener("type-topics", () => { if (playEl.hidden) draw(); });
  document.addEventListener("type-writings", () => { if (playEl.hidden && mode === "free") draw(); });
  document.addEventListener("type-progress", () => { if (playEl.hidden && mode === "copy") draw(); });
}

export function home() {
  if (!homeEl) return;
  Trainer.stop();
  capture(null);
  playEl.hidden = true;
  playEl.innerHTML = "";
  homeEl.hidden = false;
  draw();
}

const chosen = () => new Set(Topics.topics().filter((t) => Topics.isOn(t.id)).map((t) => t.id));

export function draw() {
  if (!homeEl) return;
  homeEl.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>글쓰기</h2>
        <p>남의 글을 그대로 옮겨 치면서 문장에 손을 익히고, 그다음 내 글을 씁니다.</p>
      </div>
      <div class="picker">
        <div class="picker-row">
          <button class="chip${mode === "copy" ? " on" : ""}" data-mode="copy">베껴쓰기</button>
          <button class="chip${mode === "free" ? " on" : ""}" data-mode="free">자유 작문</button>
        </div>
        <div data-topics></div>
      </div>
      <div class="panel-body" data-body></div>
    </div>`;

  homeEl.querySelectorAll("[data-mode]").forEach((b) => {
    b.onclick = () => { mode = b.dataset.mode; Sfx.select(); draw(); };
  });
  Topics.chips(homeEl.querySelector("[data-topics]"));
  (mode === "copy" ? drawCopyList : drawFreeList)(homeEl.querySelector("[data-body]"));
}

/* ══════════════ 베껴쓰기 ══════════════ */

function drawCopyList(body) {
  const list = Texts.textsFor(chosen());
  const best = Progress.get("copy");
  body.innerHTML =
    (best.cpm ? `<p class="hint" style="margin-bottom:12px">최고 기록 — 분당 ${best.cpm}타 · 정확도 ${best.acc}%</p>` : "") +
    (list.length ? `<div class="ty-list">${list.map((t, i) => {
      const strokes = t.lines.reduce((a, l) => a + analyze(l).strokes, 0);
      return `<button class="ty-item" data-text="${i}">
        <span class="ty-item-name">${esc(t.title)}</span>
        <span class="ty-item-sub">${t.lines.length}문장 · ${strokes}타</span>
      </button>`;
    }).join("")}</div>`
     : `<div class="empty">고른 주제에 맞는 글이 없습니다. 주제를 더 골라 보세요.</div>`);

  body.querySelectorAll("[data-text]").forEach((b) => {
    b.onclick = () => { Sfx.select(); playCopy(list[+b.dataset.text]); };
  });
}

function playCopy(t) {
  homeEl.hidden = true;
  playEl.hidden = false;
  Trainer.start(playEl, {
    title: t.title,
    backLabel: "글 목록으로",
    lines: t.lines,
    onQuit: home,
    onDone: (s) => finishCopy(t, s),
  });
}

function finishCopy(t, s) {
  const fresh = Progress.record("copy", { cpm: s.cpm, acc: s.acc });
  Sfx.win();
  playEl.innerHTML = `
    <div class="ty-done">
      <h2>다 옮겨 썼어요</h2>
      <p class="hint">${esc(t.title)}${fresh ? " · 새 최고 기록!" : ""}</p>
      <div class="stats">
        <div class="stat">정확도<b>${s.acc}%</b></div>
        <div class="stat">분당 타수<b>${s.cpm}</b></div>
        <div class="stat">친 글자<b>${s.hits}</b></div>
      </div>
      <div class="card-actions">
        <button class="btn primary" data-again>한 번 더</button>
        <button class="btn" data-free>이제 내 글 쓰기</button>
        <button class="btn" data-home>글 목록으로</button>
      </div>
    </div>`;
  playEl.querySelector("[data-again]").onclick = () => playCopy(t);
  playEl.querySelector("[data-free]").onclick = () => { mode = "free"; home(); };
  playEl.querySelector("[data-home]").onclick = home;
}

/* ══════════════ 자유 작문 ══════════════ */

function drawFreeList(body) {
  const prompts = Texts.promptsFor(chosen());
  const mine = Writings.all();
  body.innerHTML = `
    <h3 class="ty-h3">글감 고르기</h3>
    ${prompts.length ? `<div class="ty-list">${prompts.map((p, i) => `
      <button class="ty-item" data-prompt="${i}">
        <span class="ty-item-name">${esc(p.text)}</span>
        <span class="ty-item-sub">${esc(p.hint)}</span>
      </button>`).join("")}</div>`
     : `<div class="empty">고른 주제에 맞는 글감이 없습니다.</div>`}
    <div class="card-actions" style="justify-content:flex-start; margin:14px 0 4px">
      <button class="btn" data-blank>글감 없이 그냥 쓰기</button>
    </div>

    <h3 class="ty-h3" style="margin-top:22px">내가 쓴 글 (${mine.length})</h3>
    ${mine.length ? `<div class="ty-list">${mine.map((w) => `
      <div class="ty-item ty-item-row">
        <button class="ty-item-open" data-open="${esc(w.id)}">
          <span class="ty-item-name">${esc(w.prompt || "제목 없는 글")}</span>
          <span class="ty-item-sub">${w.chars}자 · ${esc(w.at.slice(0, 10))} — ${esc(w.text.slice(0, 40))}${w.text.length > 40 ? "…" : ""}</span>
        </button>
        <button class="btn ty-item-del" data-del="${esc(w.id)}" aria-label="지우기">지우기</button>
      </div>`).join("")}</div>`
     : `<div class="empty">아직 쓴 글이 없습니다. 위에서 글감을 골라 보세요.</div>`}`;

  body.querySelectorAll("[data-prompt]").forEach((b) => {
    b.onclick = () => { Sfx.select(); desk({ prompt: prompts[+b.dataset.prompt] }); };
  });
  body.querySelector("[data-blank]").onclick = () => { Sfx.select(); desk({}); };
  body.querySelectorAll("[data-open]").forEach((b) => {
    b.onclick = () => desk({ existing: Writings.get(b.dataset.open) });
  });
  body.querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = () => { Writings.remove(b.dataset.del); toast("글을 지웠습니다."); };
  });
}

/** 글 쓰는 책상 */
function desk({ prompt, existing }) {
  homeEl.hidden = true;
  playEl.hidden = false;

  const title = existing ? existing.prompt : prompt ? prompt.text : "";
  const hint = prompt ? prompt.hint : "";

  playEl.innerHTML = `
    <div class="ty-bar">
      <button class="btn" data-back>◂ 돌아가기</button>
      <strong class="ty-title">${esc(title || "그냥 쓰기")}</strong>
      <span class="grow"></span>
      <span class="ty-step"><b data-chars>0</b>자</span>
      <button class="btn primary" data-save>저장하기</button>
    </div>
    ${hint ? `<div class="ty-hintline">${esc(hint)}</div>` : ""}
    <div class="ty-paper ty-desk" data-paper tabindex="-1"></div>
    <div class="ty-finger">글자를 지우려면 <b>지우기</b>, 줄을 바꾸려면 <b>줄 바꾸기</b>를 누르세요.</div>
    <div data-kb></div>`;

  const kb = playEl.querySelector("[data-kb]");
  KB.render(kb);

  const elChars = playEl.querySelector("[data-chars]");
  const comp = createComposer(playEl.querySelector("[data-paper]"), {
    onChange: ({ chars }) => { elChars.textContent = chars; },
  });
  if (existing) comp.setText(existing.text);

  capture((ev) => {
    if (comp.handle(ev)) { if (!ev.back) Sfx.key(); }
  });

  playEl.querySelector("[data-back]").onclick = () => {
    if (comp.chars() && !confirm("저장하지 않고 나가면 쓴 글이 사라집니다. 나갈까요?")) return;
    home();
  };
  playEl.querySelector("[data-save]").onclick = () => {
    const row = Writings.save({ id: existing?.id, prompt: title, text: comp.text() });
    if (!row) { toast("글을 조금이라도 써야 저장할 수 있어요."); return; }
    Sfx.win();
    toast(`${row.chars}자를 저장했습니다.`);
    home();
  };
}
