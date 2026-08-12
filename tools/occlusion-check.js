/* 가림 검사 — 부대말과 타일 면이 다른 칸의 후보 숫자를 덮는지 실측한다.
 *
 * 쓰는 법: 게임 페이지를 열고 개발자도구 콘솔에 이 파일을 통째로 붙여넣는다.
 * 판을 최악 배치(빈 칸 바로 아래마다 말이 오도록)로 바꾼 뒤 기울기 0~42도를 훑는다.
 *
 * 두 가지를 조심해야 한다. 둘 다 처음에 틀렸던 부분이다.
 *
 *  1. 후보 글자의 사각형으로 `.c` 의 getBoundingClientRect() 를 쓰면 안 된다.
 *     그건 1/4칸 박스라 글자 아래 빈 여백까지 포함해 없는 가림을 만들어 낸다.
 *     Range 로 텍스트 노드를 감싸 글자 자체를 재야 한다.
 *
 *  2. 아무 배치나 놓고 재면 안 된다. 빈 칸 바로 아래에 말이 없으면 애초에
 *     가려질 일이 없어서, 통과했다는 결과가 배치 운에 불과해진다.
 */
(async function occlusionCheck() {
  const grid = document.querySelector(".grid");
  const tiles = [...grid.children];
  // 열 수는 격자 정의에서 읽는다. 화면 사각형으로 나누면 3D 투영 때문에 어긋난다
  // (판이 기울어 있어 grid 폭이 실제보다 넓게 잡히고, 8열이 9열로 나온다).
  const W = getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean).length;
  const H = Math.ceil(tiles.length / W);
  const at = (r, c) => tiles[r * W + c];
  const key = (v) => document.dispatchEvent(new KeyboardEvent("keydown", { key: String(v), bubbles: true }));

  // ── 최악 배치: 홀수 행은 채우고 짝수 행은 비운다 ──
  for (let r = 1; r < H; r += 2) for (let c = 0; c < W; c++) {
    const t = at(r, c);
    if (!t || t.classList.contains("given") || t.classList.contains("filled")) continue;
    t.click(); key((c % 4) + 1);
  }
  for (let r = 0; r < H; r += 2) for (let c = 0; c < W; c++) {
    const t = at(r, c);
    if (t && t.classList.contains("placed")) { t.click(); key("Backspace"); }
  }
  await new Promise((r) => setTimeout(r, 500));

  const overlap = (a, b) => {
    const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return x > 0.5 && y > 0.5 ? x * y : 0;
  };
  const ink = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); };

  const slider = document.querySelector("#optTilt");
  const before = slider.value;
  const rows = [];

  for (const deg of [0, 6, 12, 18, 24, 30, 36, 42]) {
    slider.value = deg;
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));            // 전환이 끝난 뒤 재야 한다

    const glyphs = [...document.querySelectorAll(".tile:not(.filled) .c")]
      .map((c) => ({ i: +c.closest(".tile").dataset.i, v: c.dataset.v, r: ink(c) }));

    let hits = 0, worst = 0, sample = "";
    for (const tile of document.querySelectorAll(".tile.filled")) {
      const i = +tile.dataset.i, row = (i / W) | 0;
      for (const [el, label] of [[tile.querySelector(".face"), "면"], [tile.querySelector(".unit svg"), "말"]]) {
        if (!el) continue;
        const R = el.getBoundingClientRect();
        for (const g of glyphs) {
          if (((g.i / W) | 0) >= row) continue;              // 말보다 아래 줄이면 가려질 수 없다
          const a = overlap(R, g.r);
          if (a > 1) { hits++; if (a > worst) { worst = a; sample = `${label} ${i} → ${g.i}번 칸의 ${g.v}`; } }
        }
      }
    }
    const cs = getComputedStyle(document.documentElement);
    rows.push({
      기울기: deg + "도",
      면높이: cs.getPropertyValue("--placed-z").trim(),
      말높이: cs.getPropertyValue("--lift").trim(),
      가림: hits,
      "최대겹침(px²)": Math.round(worst),
      사례: sample,
    });
  }

  slider.value = before;
  slider.dispatchEvent(new Event("input", { bubbles: true }));

  console.table(rows);
  const bad = rows.filter((r) => r.가림 > 0);
  if (bad.length) console.warn("가림 발생:", bad.map((b) => b.기울기).join(", "));
  else console.log("%c모든 기울기에서 후보 숫자를 가리지 않습니다.", "color:#43bf8f;font-weight:700");
  return rows;
})();
