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
const VW = 440;            // 지도 폭(px)
const ROW = 40;            // 단계 한 칸의 세로 간격(px)
const PAD_TOP = 70;        // 정상 위 여백
const PAD_BOTTOM = 34;

/** 단계 번호 → 그림 좌표. 지그재그로 올라간다. */
function place(stage, total, H) {
  const i = stage - 1;
  const up = i / (total - 1);                    // 0(아래) ~ 1(정상)
  const y = H - PAD_BOTTOM - up * (H - PAD_TOP - PAD_BOTTOM);
  /* 산이니 위로 갈수록 폭이 좁아야 한다. 지그재그 진폭을 높이에 따라 줄인다. */
  const amp = 150 - 118 * up;
  const x = VW / 2 + Math.sin(i * 0.82) * amp;
  return { x, y };
}

/** 산등성이 — 가운데가 정상이고 아래로 갈수록 벌어진다. */
function ridge(H) {
  const pts = [];
  const N = 90;
  for (let k = 0; k <= N; k++) {
    const up = k / N;
    const y = H - PAD_BOTTOM + 8 - up * (H - PAD_TOP - PAD_BOTTOM + 8);
    // 정상 부근은 뾰족하고 아래는 완만하게 — 지수로 벌린다
    const w = 62 + 148 * Math.pow(1 - up, 1.5);
    /* 표본을 적게 잡으면 능선이 자로 그은 듯 반듯해 벽처럼 보인다.
       촘촘히 잡고 좌우를 서로 다르게 흔들어 바위 같게 만든다. */
    const jl = Math.sin(k * 1.7) * 9 + Math.sin(k * 0.53) * 14;
    const jr = Math.sin(k * 1.31 + 2) * 9 + Math.sin(k * 0.61 + 1) * 14;
    pts.push([VW / 2 - w + jl, y], [VW / 2 + w + jr, y]);
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

  /* 한 화면에는 4000px 짜리 산의 600px 만 보인다. 실루엣만으로는 산인 줄 모르므로,
     올라간 높이에 따라 바위 결과 눈을 달리 그려 어디쯤인지 느끼게 한다. */
  const strata = [];
  for (let k = 0; k < 46; k++) {
    const up = k / 45;
    const y = H - PAD_BOTTOM - up * (H - PAD_TOP - PAD_BOTTOM);
    const w = 62 + 148 * Math.pow(1 - up, 1.5);
    const wob = Math.sin(k * 2.3) * 12;
    strata.push(`<path d="M${(VW / 2 - w + 6).toFixed(1)} ${y.toFixed(1)}` +
      `q${(w * 0.6).toFixed(1)} ${(-6 + wob * 0.3).toFixed(1)} ${(2 * w - 12).toFixed(1)} 0"` +
      ` fill="none" stroke="rgba(0,0,0,.28)" stroke-width="1.5"/>`);
  }

  // 정상 부근 만년설 — 위쪽 12% 를 덮는다
  const snowTop = PAD_TOP - 10;
  const snowBot = PAD_TOP + (H - PAD_TOP - PAD_BOTTOM) * 0.12;
  const snow = [];
  for (let k = 0; k <= 12; k++) {
    const t = k / 12;
    const y = snowTop + t * (snowBot - snowTop);
    /* up 을 0~1 로 묶어 둔다. 정상 위 여백까지 눈을 덮으면 up 이 1 을 넘고,
       Math.pow(음수, 1.5) 는 NaN 이라 폴리곤 전체가 그려지지 않는다. */
    const up = Math.min(1, Math.max(0, 1 - (y - PAD_TOP) / (H - PAD_TOP - PAD_BOTTOM)));
    const w = (62 + 148 * Math.pow(1 - up, 1.5)) * (1 - t * 0.06);
    snow.push([VW / 2 - w, y], [VW / 2 + w, y]);
  }
  const snowPts = [...snow.filter((_, i) => i % 2 === 0),
                   ...snow.filter((_, i) => i % 2 === 1).reverse()]
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  host.innerHTML =
    `<svg class="lz-map" viewBox="0 0 ${VW} ${H}" width="${VW}" height="${H}" aria-label="등반 지도">
       <defs>
         <linearGradient id="lzRock" x1="0" y1="0" x2="0" y2="1">
           <stop offset="0" stop-color="#43536e"/>
           <stop offset="0.18" stop-color="#33445f"/>
           <stop offset="1" stop-color="#141f31"/>
         </linearGradient>
         <linearGradient id="lzSnow" x1="0" y1="0" x2="0" y2="1">
           <stop offset="0" stop-color="#f4f8ff" stop-opacity="0.95"/>
           <stop offset="0.55" stop-color="#dfe9f8" stop-opacity="0.55"/>
           <stop offset="1" stop-color="#dfe9f8" stop-opacity="0"/>
         </linearGradient>
       </defs>
       <polygon points="${ridge(H)}" fill="url(#lzRock)" stroke="rgba(201,151,63,.22)" stroke-width="1.2"/>
       <g>${strata.join("")}</g>
       <polygon points="${snowPts}" fill="url(#lzSnow)"/>
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
