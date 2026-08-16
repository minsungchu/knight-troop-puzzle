/* 등반 지도 — 산 아래에서 정상까지, 단계가 오를수록 위로 간다.
 *
 * 100개를 한 화면에 욱여넣으면 점이 너무 작아 누를 수 없다. 지도를 세로로 길게
 * 그리고 감싼 자리만 스크롤시킨다. 지금 단계는 열 때 화면 가운데로 데려온다.
 *
 * 좌표계는 아래가 0, 위가 1 인 '오른 높이'로 잡고 마지막에 뒤집는다.
 * 그래야 산등성이도 단계 위치도 같은 식으로 쓸 수 있다.
 */

/* 좌표는 픽셀과 1:1 로 잡는다. viewBox 폭을 100 으로 두고 화면 폭에 맞춰 늘리면
   세로도 같은 배율로 늘어나, 100단계 지도가 39,000px 짜리가 된다. */
const VW = 320;            // 지도 폭(px)
const ROW = 40;            // 단계 한 칸의 세로 간격(px)
const PAD_TOP = 70;        // 정상 위 여백
const PAD_BOTTOM = 34;

/** 단계 번호 → 그림 좌표. 지그재그로 올라간다. */
function place(stage, total, H) {
  const i = stage - 1;
  const up = i / (total - 1);                    // 0(아래) ~ 1(정상)
  const y = H - PAD_BOTTOM - up * (H - PAD_TOP - PAD_BOTTOM);
  /* 산이니 위로 갈수록 폭이 좁아야 한다. 지그재그 진폭을 높이에 따라 줄인다. */
  const amp = 108 - 84 * up;
  const x = VW / 2 + Math.sin(i * 0.82) * amp;
  return { x, y };
}

/** 산등성이 — 가운데가 정상이고 아래로 갈수록 벌어진다. */
function ridge(H) {
  const pts = [];
  for (let k = 0; k <= 24; k++) {
    const up = k / 24;
    const y = H - PAD_BOTTOM + 8 - up * (H - PAD_TOP - PAD_BOTTOM + 8);
    // 정상 부근은 뾰족하고 아래는 완만하게 — 지수로 벌린다
    const w = 24 + 132 * Math.pow(1 - up, 1.5);
    pts.push([VW / 2 - w, y], [VW / 2 + w, y]);
  }
  const left = pts.filter((_, i) => i % 2 === 0);
  const right = pts.filter((_, i) => i % 2 === 1).reverse();
  return [...left, ...right].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

/**
 * @param {HTMLElement} host
 * @param {object} o  total · cleared(Set) · current · onPick(stage)
 */
export function drawMountain(host, o) {
  const total = o.total;
  const H = PAD_TOP + PAD_BOTTOM + (total - 1) * ROW;

  const nodes = [];
  for (let s = 1; s <= total; s++) {
    const { x, y } = place(s, total, H);
    const done = o.cleared.has(s);
    const now = s === o.current;
    // 깬 단계와 지금 단계, 그리고 지금 단계까지는 다시 들어갈 수 있다
    const lock = s > o.current;
    const cls = ["lz-node", done ? "done" : "", now ? "now" : "", lock ? "lock" : ""].filter(Boolean).join(" ");
    nodes.push(
      `<g class="${cls}" data-stage="${s}" tabindex="${lock ? -1 : 0}" role="button" aria-label="${s}단계${done ? " 완료" : lock ? " 잠김" : ""}">` +
      `<circle class="ring" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${now ? 15 : 12.5}"/>` +
      `<text class="num" x="${x.toFixed(1)}" y="${y.toFixed(1)}">${s}</text></g>`
    );
  }

  // 단계를 잇는 등산로
  const path = [];
  for (let s = 1; s <= total; s++) {
    const { x, y } = place(s, total, H);
    path.push(`${s === 1 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`);
  }

  const summit = place(total, total, H);

  host.innerHTML =
    `<svg class="lz-map" viewBox="0 0 ${VW} ${H}" width="${VW}" height="${H}" aria-label="등반 지도">
       <defs>
         <linearGradient id="lzRock" x1="0" y1="0" x2="0" y2="1">
           <stop offset="0" stop-color="#33445f"/><stop offset="1" stop-color="#141f31"/>
         </linearGradient>
       </defs>
       <polygon points="${ridge(H)}" fill="url(#lzRock)" stroke="rgba(201,151,63,.22)" stroke-width="1.2"/>
       <path d="${path.join("")}" fill="none" stroke="rgba(201,151,63,.3)"
             stroke-width="2" stroke-dasharray="5 5"/>
       <text class="lz-summit" x="${VW / 2}" y="${(summit.y - 34).toFixed(1)}">정상</text>
       ${nodes.join("")}
     </svg>`;

  host.querySelectorAll(".lz-node").forEach((g) => {
    if (g.classList.contains("lock")) return;
    const go = () => o.onPick(+g.dataset.stage);
    g.addEventListener("click", go);
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  });

  // 지금 단계를 화면 가운데로. 지도가 길어서 안 하면 늘 맨 위(정상)만 보인다.
  const now = host.querySelector(".lz-node.now") || host.querySelector(".lz-node");
  if (now) {
    const box = now.getBoundingClientRect(), wrap = host.getBoundingClientRect();
    host.scrollTop += (box.top - wrap.top) - wrap.height / 2 + box.height / 2;
  }
}
