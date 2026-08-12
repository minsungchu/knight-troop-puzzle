/* 가림 검사 — 입체 부대말이 다른 칸의 후보 숫자(1·2·3·4)를 덮는지 실측한다.
 *
 * 쓰는 법: 게임 페이지를 열고 개발자도구 콘솔에 이 파일 내용을 통째로 붙여넣는다.
 * 기울기 0~42도를 훑으면서 모든 칸을 검사하고, 가려진 숫자가 있으면 알려 준다.
 *
 * 원리: getBoundingClientRect() 는 3D 변환이 적용된 뒤의 화면상 사각형을 준다.
 * 배치된 칸의 말이 차지한 사각형과, 다른 칸의 후보 글자 사각형이 겹치는지 본다.
 * 겹치더라도 말이 뒤에 있으면 안 가리므로, 말이 더 앞(아래쪽 행)일 때만 문제로 센다.
 */
(function occlusionCheck() {
  const W = document.querySelectorAll(".grid > .tile").length
    ? Math.round(document.querySelector(".grid").getBoundingClientRect().width /
      (document.querySelector(".tile").getBoundingClientRect().width + 5))
    : 8;

  const overlap = (a, b) => {
    const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return x > 0.5 && y > 0.5 ? x * y : 0;
  };

  const slider = document.querySelector("#optTilt");
  const tilts = [0, 6, 12, 18, 26, 34, 42];
  const results = [];

  for (const t of tilts) {
    slider.value = t;
    slider.dispatchEvent(new Event("input", { bubbles: true }));

    // transition 이 끝난 좌표를 봐야 하므로 잠깐 기다린다 (동기 측정용으로 강제 리플로우)
    document.body.offsetHeight;

    const pieces = [...document.querySelectorAll(".tile.filled .unit")].map((u) => ({
      i: +u.closest(".tile").dataset.i,
      r: u.getBoundingClientRect(),
    }));
    const glyphs = [...document.querySelectorAll(".tile:not(.filled) .c")]
      .filter((c) => !c.classList.contains("off"))
      .map((c) => ({ i: +c.closest(".tile").dataset.i, v: c.dataset.v, r: c.getBoundingClientRect() }));

    let hits = 0, worst = 0, sample = null;
    for (const p of pieces) {
      const prow = (p.i / W) | 0;
      for (const g of glyphs) {
        const grow = (g.i / W) | 0;
        if (grow >= prow) continue;              // 말보다 앞줄(아래)이면 가려지지 않는다
        const area = overlap(p.r, g.r);
        if (area > 1) {
          hits++;
          if (area > worst) { worst = area; sample = `${p.i}번 말 → ${g.i}번 칸의 ${g.v}`; }
        }
      }
    }
    results.push({ tilt: t, hits, worst: Math.round(worst), sample });
  }

  slider.value = 18;
  slider.dispatchEvent(new Event("input", { bubbles: true }));

  console.table(results);
  const bad = results.filter((r) => r.hits > 0);
  if (bad.length) {
    console.warn(`가림 발생: ${bad.map((b) => b.tilt + "도").join(", ")}`);
    bad.forEach((b) => console.warn(`  ${b.tilt}도 — ${b.hits}건, 가장 큰 겹침 ${b.worst}px² (${b.sample})`));
  } else {
    console.log("%c모든 기울기에서 후보 숫자를 가리지 않습니다.", "color:#43bf8f;font-weight:700");
  }
  return results;
})();
