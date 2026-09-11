# CLAUDE.md

## 이 저장소에 대하여

claude-native-workflow 자신의 저장소다. **`main` 브랜치는 v2 구현**
(단일 설치형, DB 기반 문서/워크플로우 관리 시스템)이고, 이전
3단계(Tier1/2/3) 구현은 `concept` 브랜치에 그대로 보존돼 있다 - 서로
다른 시스템이니 섞어서 참고하지 않는다.

작업 시작 전에 먼저 [README.md](README.md)(현재 상태/실행 방법)와
[DESIGN-NOTES.md](DESIGN-NOTES.md)(Phase 진행 기록)를 확인한다. 이
저장소 자신의 설계 논의는 아직 정식 워크플로우 없이 이 두 마크다운
파일로만 기록한다(시스템이 자기 자신을 담을 만큼 성숙하면 가이디드
마이그레이션으로 옮길 예정). 기능별 사용 시나리오·QA 체크리스트·
추가 개발 계획은 [QA-SCENARIOS.md](QA-SCENARIOS.md)에 별도로 정리
되어 있다 - "완료 로그"인 DESIGN-NOTES.md와 달리 계속 갱신되는
참고 문서다. 새 QA 패스나 기능 라운드를 시작하기 전에 먼저 훑어보면
어느 영역이 아직 실측 검증(`[ ]`) 안 됐는지, 어떤 개발 계획이
승인 대기 중인지 바로 알 수 있다.

## 이 문서 vs 배포되는 기본 CLAUDE.md 템플릿 — 혼동 금지

**이 파일**(`/CLAUDE.md`)은 claude-native-workflow **자신**을 개발할 때
쓰는 지시문이다. 반면 `backend/prisma/seed-templates/CLAUDE.md`는 이
시스템이 **관리하는 다른 프로젝트들**에 배포되는 기본 템플릿 원본이다
(서버 기동 시 `TemplateFile` 전역 기본값으로 시드됨 - `docs template
get CLAUDE.md`로 조회 가능). 완전히 다른 대상을 향한 별개의 문서이니,
한쪽을 고친다고 다른 쪽이 바뀌지 않는다는 걸 항상 염두에 둔다.

같은 이유로 `.claude/skills/claude-native-workflow/SKILL.md`(이 저장소
자신의 Claude 세션이 쓰는 스킬)와 `backend/prisma/seed-templates/
SKILL.md`(관리되는 프로젝트에 배포되는 원본)도 지금은 내용이 같은
사본이지만 서로 다른 파일이다 - 하나를 고치면 다른 쪽도 의도적으로
동기화해야 한다(자동 동기화 없음, Phase 1 시점 기준).

## 작업 방식

- 각 Phase 착수 전에 그 Phase의 상세 설계를 먼저 정리해 승인받는다
  (Plan Mode로 계획을 작성 → 승인 → 구현). 로드맵과 각 Phase의 상세
  계획은 대화 세션의 plan 파일에 있다 - 다음 Phase를 시작하기 전에
  이전 Phase가 실제로 커밋·검증됐는지 먼저 확인한다.
- 새 기능은 실제로 기동해서 왕복 검증한 뒤에만 "완료"로 보고한다
  (로컬 SQLite 기동 → API/CLI/MCP 왕복 확인 - `concept` 브랜치 QA에서
  반복적으로 확인된 원칙).
- git 커밋/푸시는 사용자가 명시적으로 요청했을 때만 한다.
