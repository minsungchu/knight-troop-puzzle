# knight-troop-puzzle

나이트 이동과 3연속 금지 규칙으로 푸는 논리 퍼즐. 빌드 도구 없는 정적 사이트로
GitHub Pages에 배포하고, 로그인·랭킹·대전·채팅은 Supabase가 맡는다.
설계 배경은 `DESIGN.md`, 설정 절차는 `README.md`.

## Agent skills

### Issue tracker

이슈는 GitHub Issues에서 관리한다 (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

정규 다섯 역할을 이름 그대로 쓴다. See `docs/agents/triage-labels.md`.

### Domain docs

단일 컨텍스트 — 루트 `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
