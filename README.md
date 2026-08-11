# 나이트 부대 배치 — 전장 퍼즐

1~4번 부대를 판에 배치하는 논리 퍼즐. 나이트 이동으로 닿는 칸은 서로 달라야 하고,
어느 방향으로도 같은 부대가 3칸 연속으로 늘어설 수 없다.

**기능** — 혼자 플레이 · 한 판에 힌트 5회 · 로그인 · 규격/난이도별 랭킹 · 최대 4인 실시간 대전

설계 문서: [DESIGN.md](DESIGN.md)

---

## 구성

정적 파일뿐이라 빌드 도구가 필요 없다.

```
index.html          셸 — 머리말 · 탭 · 오버레이
css/theme.css       색 토큰 · 지면 · 공통 컨트롤
css/board.css       3D 전장 판 · 부대 팔레트
css/app.css         탭 · 계정 · 랭킹 · 대전
js/config.js        ★ Supabase 설정을 여기에 넣는다
js/engine.js        퍼즐 생성 · 논리 솔버 (순수 계산, DOM 없음)
js/game.js          판 UI · 힌트 제한 · 타이머
js/ui.js            토스트 · 오버레이 · 탭 · 저장소
js/supabase.js      클라이언트 · 세션 · 동시접속 제한
js/auth.js          로그인 · 가입 · 계정 메뉴
js/rank.js          랭킹 보드 · 기록 등록
js/room.js          대전 로비 · 방 · 실시간 진행률
js/app.js           진입점
supabase/schema.sql DB 스키마 (한 번만 실행)

knight-troop-puzzle.html   분리 이전의 단일 파일 — 인터넷 없이 열리는 오프라인 버전
```

`js/config.js`를 비워 두면 **혼자 플레이 모드**로 동작한다. 랭킹·대전 탭은 설정이 필요하다고
안내하고, 게임 자체는 완전히 정상으로 돌아간다.

---

## 로컬에서 열기

ES Modules는 `file://`에서 동작하지 않으므로 서버로 띄워야 한다.

```bash
python3 -m http.server 8000     # 또는  npx serve .
open http://localhost:8000
```

---

## 배포 — GitHub Pages

1. 저장소 **Settings → Pages**
2. **Source** 를 `Deploy from a branch`, 브랜치를 `main` / `/ (root)` 로 지정
3. 몇 분 뒤 `https://<사용자>.github.io/knight-troop-puzzle/` 에서 열린다

푸시할 때마다 자동으로 다시 배포된다.

---

## 온라인 기능 켜기 — Supabase

무료 티어로 충분하고 카드 등록이 필요 없다.

### 1. 프로젝트 만들기

[supabase.com](https://supabase.com) 에서 새 프로젝트를 만든다. 리전은 가까운 곳(예: Northeast Asia)으로.

### 2. 스키마 적용

대시보드 **SQL Editor** 에 [`supabase/schema.sql`](supabase/schema.sql) 전체를 붙여넣고 실행한다.
여러 번 실행해도 안전하다.

`schema.sql` 에는 최신 내용이 다 들어 있으므로 **새 프로젝트는 이것만 실행하면 된다.**
이미 예전 `schema.sql` 로 만들어 둔 프로젝트라면 `supabase/patch-*.sql` 을 번호 순서대로 실행한다.

### 3. 이메일 확인 끄기 ⚠️

**Authentication → Sign In / Providers → Email** 에서 **Confirm email 을 반드시 끈다.**

이 게임은 이메일을 받지 않고 아이디만 받는다. 내부적으로 `아이디@users.knight-puzzle.app`
형태의 주소를 만들어 Supabase Auth에 넘기는데, 확인 메일을 켜 두면 존재하지 않는 주소로
메일이 나가고 가입이 끝나지 않는다.

### 4. 키 넣기

**Project Settings → API** 에서 두 값을 복사해 `js/config.js` 에 넣는다.

```js
export const SUPABASE_URL = "https://xxxxxxxxxxxx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOi...";
```

`anon` 키는 공개용이라 저장소에 커밋해도 된다. 실제 권한은 DB의 RLS 정책과
`SECURITY DEFINER` 함수가 정한다. **`service_role` 키는 절대 넣지 말 것** — 그 키는
모든 정책을 우회한다.

커밋하고 푸시하면 랭킹과 대전이 켜진다.

---

## 알아두면 좋은 것

**무료 프로젝트는 오래 쓰지 않으면 일시정지된다.** 정지 중에는 로그인·랭킹·대전이 멈추고
혼자 플레이만 된다. 대시보드에서 수동으로 재개하면 되고, 방문이 뜸할 것 같으면
GitHub Actions 크론으로 하루 한 번 가벼운 요청을 보내 두면 된다.

**비밀번호는 복구할 수 없다.** 이메일을 받지 않기 때문이다. 나중에 선택 입력으로 이메일을
받으면 Supabase의 재설정 메일 기능을 그대로 켤 수 있다.

**기록 시간은 클라이언트가 보고한 값이다.** RLS가 막아 주는 것은 남의 이름으로 기록을
올리는 것과 남의 기록을 지우는 것이고, 자기 기록의 시간 자체는 개발자 도구로 위조할 수 있다.

**대전에서 상대에게 가는 정보는 채운 칸 수 하나뿐이다.** 판의 값이나 위치는 전송하지 않으므로
구조적으로 베낄 방법이 없다.

---

## 규칙

- 모든 칸에 1~4번 부대 중 하나가 들어간다
- 나이트 이동(직선 한 칸 + 이어서 대각선 한 칸)으로 닿는 두 칸은 같은 부대일 수 없다
- 가로·세로·대각선 어느 방향으로도 같은 부대가 3칸 연속으로 늘어설 수 없다

출제기는 정답지에서 칸을 지우되 **해당 난이도의 논리 솔버가 끝까지 푸는 경우에만** 지운
상태를 유지한다. 논리만으로 완주된다는 것은 해가 유일하다는 뜻이므로, 유일해와 풀이
가능성이 동시에 보장된다.
