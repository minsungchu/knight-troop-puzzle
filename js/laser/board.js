/* 레이저 판 하나를 그리고 조작받는다.
 *
 * 프로토타입에서 얻은 것들을 그대로 옮겼다.
 *   · 칸 사이를 grid gap 으로 벌리면 그 띠가 아무에게도 속하지 않아 판의 12%가
 *     죽은 영역이 된다. 칸은 빈틈없이 붙이고 보이는 타일만 안쪽에 그린다.
 *   · 호버로 칸을 움직이면 커서가 틈에 빠졌다 나왔다 하며 클릭이 먹지 않는다.
 *   · click 은 누른 곳과 뗀 곳이 같아야 한다. 작은 칸에서는 pointerdown 이 맞다.
 *   · 발광은 SVG 필터가 아니라 선을 겹쳐서 낸다. 수직·수평선은 바운딩 박스가
 *     납작해 objectBoundingBox 기준 필터 영역이 사라진다.
 */

import {
  makeBoard, setSource, trace, targetsOf, at, inside,
  EMPTY, WALL, TARGET, SPLIT_SLASH, SPLIT_BACK, FIXED_SLASH, FIXED_BACK,
  MIRROR_SLASH, MIRROR_BACK,
} from "./engine.js";

/** 저장된 단계 자료(cells 문자열)에서 판을 되살린다. */
export function boardFrom(data) {
  const b = makeBoard(data.W, data.H);
  const cells = data.cells.split("");
  for (let i = 0; i < cells.length; i++) b.cells[i] = Number(cells[i]);
  setSource(b, data.src.x, data.src.y, data.src.dir);
  return b;
}

export class LaserBoard {
  /**
   * @param {HTMLElement} host  판을 그릴 자리
   * @param {object} opts  onChange(state) · onWin(state) · readOnly
   */
  constructor(host, opts = {}) {
    this.host = host;
    this.opts = opts;
    this.placed = new Map();
    this.data = null;
    this.board = null;
    this.won = false;

    host.addEventListener("pointerdown", (e) => this.onPress(e));

    /* 폭 변화는 window resize 가 아니라 자리 자체를 지켜본다. 화면 회전이나 글꼴
       로딩처럼 창 크기는 그대로인데 쓸 수 있는 폭만 바뀌는 경우가 있다.
       관찰자는 변수에 붙들어 둬야 한다 — new ResizeObserver(...).observe(...) 로
       쓰면 참조가 남지 않아 콜백이 한 번 돌기도 전에 수거된다. */
    this.lastRoom = 0;
    this.room = host.parentElement || host;
    this.watch = new ResizeObserver(() => {
      const room = Math.round(this.room.clientWidth);
      if (!this.board || room === this.lastRoom) return;
      this.lastRoom = room;
      this.fit();
      this.render();
    });
    this.watch.observe(this.room);
  }

  destroy() { this.watch.disconnect(); }

  load(data) {
    this.data = data;
    this.board = boardFrom(data);
    this.placed = new Map();
    this.won = false;
    this.build();
  }

  /** 놓은 거울을 전부 걷는다. */
  clear() {
    if (!this.board) return;
    this.placed = new Map();
    this.won = false;
    this.render();
  }

  /** 마지막에 놓은 거울 하나를 무른다. */
  undo() {
    const last = [...this.placed.keys()].pop();
    if (!last) return false;
    this.placed.delete(last);
    this.won = false;
    this.render();
    return true;
  }

  get state() {
    const need = targetsOf(this.board);
    const r = trace(this.board, this.placed);
    const lit = need.filter((t) => r.hits.has(t)).length;
    return {
      mirrors: this.placed.size, mirrorsNeeded: this.data.mirrors,
      lit, targets: need.length,
      done: this.placed.size === this.data.mirrors && lit === need.length,
    };
  }

  /* ── 크기 ─────────────────────────────────────────────────────────
     칸 크기를 못박으면 좁은 화면에서 오른쪽이 잘린다. 쓸 수 있는 폭에서
     받침대가 삐져나온 몫을 뺀 나머지를 칸 수로 나눈다. 광선 굵기·목표
     테두리·글자는 모두 --cell 에 비례하므로 여기만 정하면 따라온다. */
  fit() {
    const W = this.board.W;
    /* 판 자신이 아니라 판이 놓인 자리를 잰다. 판은 flex 항목이라 폭이 내용에 맞춰
       줄어드는데, 그 내용(칸 크기)을 여기서 정한다 — 자신을 재면 닭과 달걀이 되어
       늘 최소 칸(18px)으로 굳는다. */
    const room = (this.host.parentElement || this.host).clientWidth;
    const narrow = room < 420;
    const gap = narrow ? 3 : 4;
    const plinth = narrow ? 10 : 18;
    const max = W >= 9 ? 46 : 56;
    // 받침대 테두리 1px 과 반올림 오차 때문에 2px 을 더 비워 둔다
    const cell = Math.max(18, Math.min(max, Math.floor((room - plinth * 2 - 2) / W)));
    const s = this.host.style;
    s.setProperty("--cell", cell + "px");
    s.setProperty("--gap", gap + "px");
    s.setProperty("--plinth", plinth + "px");
  }

  build() {
    const b = this.board;
    this.fit();
    this.host.innerHTML =
      `<div class="lz-plinth"></div><div class="lz-grid"></div>`;
    const g = this.host.querySelector(".lz-grid");
    g.style.gridTemplateColumns = `repeat(${b.W}, var(--cell))`;

    let html = "";
    for (let y = 0; y < b.H; y++) for (let x = 0; x < b.W; x++) {
      const c = at(b, x, y);
      let cls = "lz-cell", inner = "";
      if (c === WALL) cls += " wall";
      else if (c === TARGET) { cls += " target"; inner = `<i class="lz-t c${(y * b.W + x) % 2}"></i>`; }
      else if (c === SPLIT_SLASH) { cls += " fixed"; inner = `<span class="lz-mark split">／</span>`; }
      else if (c === SPLIT_BACK) { cls += " fixed"; inner = `<span class="lz-mark split">＼</span>`; }
      else if (c === FIXED_SLASH) { cls += " fixed pinned"; inner = `<span class="lz-mark mirror">／</span>`; }
      else if (c === FIXED_BACK) { cls += " fixed pinned"; inner = `<span class="lz-mark mirror">＼</span>`; }
      html += `<div class="${cls}" data-x="${x}" data-y="${y}">${inner}</div>`;
    }
    g.innerHTML = html + `<div class="lz-emit"></div><svg class="lz-beam"></svg>`;
    this.render();
  }

  px(name) { return parseFloat(getComputedStyle(this.host).getPropertyValue(name)); }

  render() {
    const b = this.board;
    // 간격이 칸 안쪽으로 들어갔으므로 칸 사이 거리는 칸 크기 그대로다
    const cs = this.px("--cell"), step = cs;
    const r = trace(b, this.placed);

    for (const el of this.host.querySelectorAll(".lz-cell")) {
      const x = +el.dataset.x, y = +el.dataset.y, c = at(b, x, y);
      if (c === TARGET) { el.classList.toggle("lit", r.hits.has(y * b.W + x)); continue; }
      if (c !== EMPTY) continue;
      const m = this.placed.get(`${x},${y}`);
      el.innerHTML = m ? `<span class="lz-mark mirror">${m === MIRROR_SLASH ? "／" : "＼"}</span>` : "";
    }

    const cx = (v) => v * step + cs / 2;
    const svg = this.host.querySelector(".lz-beam");
    const layer = (cls) => r.segs.map((s) =>
      `<line class="${cls}" x1="${cx(s.x1)}" y1="${cx(s.y1)}" x2="${cx(s.x2)}" y2="${cx(s.y2)}"/>`).join("");
    svg.innerHTML = layer("bm-halo") + layer("bm-mid") + layer("bm-core");

    // 광원은 판 바깥(-1 또는 W)에 있다. 격자 칸이 아니라서 절대 배치로 얹는다.
    const em = this.host.querySelector(".lz-emit"), s = b.src;
    em.style.left = (cx(s.x) - cs / 2) + "px";
    em.style.top = (cx(s.y) - cs / 2) + "px";
    em.innerHTML = `<span class="lz-arrow">${["▶", "▼", "◀", "▲"][s.dir]}</span>`;

    const st = this.state;
    this.opts.onChange?.(st);
    if (st.done && !this.won) { this.won = true; this.opts.onWin?.(st); }
  }

  onPress(e) {
    if (this.opts.readOnly || !this.board || this.won) return;
    const el = e.target.closest(".lz-cell");
    if (!el) return;
    const x = +el.dataset.x, y = +el.dataset.y;
    if (at(this.board, x, y) !== EMPTY) return;
    const k = `${x},${y}`, cur = this.placed.get(k);
    if (!cur) {
      if (this.placed.size >= this.data.mirrors) { this.opts.onFull?.(); return; }
      this.placed.set(k, MIRROR_SLASH);
    } else if (cur === MIRROR_SLASH) {
      this.placed.set(k, MIRROR_BACK);
    } else {
      this.placed.delete(k);
    }
    this.opts.onPlace?.(this.placed.get(k) || null);
    this.render();
  }
}
