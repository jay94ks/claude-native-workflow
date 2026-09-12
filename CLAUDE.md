# CLAUDE.md

## 이 저장소에 대하여

claude-native-workflow 자신의 저장소다. **`main` 브랜치는 v2 구현**
(단일 설치형, DB 기반 문서/워크플로우 관리 시스템)이고, 이전
3단계(Tier1/2/3) 구현은 `concept` 브랜치에 그대로 보존돼 있다 - 서로
다른 시스템이니 섞어서 참고하지 않는다.

작업 시작 전에 먼저 [README.md](README.md)(현재 상태/실행 방법)를
확인한다.

**이 저장소는 이제 자기 자신을 관리한다(가이디드 마이그레이션 완료)**
- 이 저장소의 git 원격 저장소 자체가 (설계자가 운영하는)
claude-native-workflow 설치 하나에 프로젝트로 연동돼 있다(프로젝트
이름: `claude-native-workflow`). 예전엔 DESIGN-NOTES.md/FEATURES.md/
QA-SCENARIOS.md/PLANS.md 네 파일로 이 저장소 자신의 설계 논의를
기록했지만("시스템이 자기 자신을 담을 만큼 성숙하면 옮길 예정"이라던
그 계획), 이제 그 설치의 DB 문서로 실제로 옮겨졌다:

- **DESIGN-NOTES.md → DocType `DN`("설계 노트")** - 라운드별로 문서
  하나씩(97개 문서로 분할 이전됨). **git의 DESIGN-NOTES.md는 그대로
  유지되는 "공개본" 사본**이다 - 새 라운드를 끝내면 그 설치에 `DN`
  문서를 새로 만들고(`docs new`), **git의 DESIGN-NOTES.md에도 같은
  내용을 새 절로 그대로 추가한다**(양쪽 다 갱신, 어느 한쪽만 갱신하고
  끝내지 않는다). 옛 라운드 절은 여전히 다시 옮겨 적거나 고치지
  않는다.
- **FEATURES.md → DocType `FT`("기능 카탈로그")** - 영역(옛 `## N.
  제목`)당 문서 하나씩(22개). **git의 FEATURES.md도 마찬가지로 공개본
  사본** - 기능이 바뀌면 해당 `FT` 문서를 고치고, git의 해당 절도
  같은 내용으로 갱신한다.
- **QA-SCENARIOS.md → DocType `QA`("QA 시나리오")로 완전히 이주,
  git 파일은 삭제됨** - 이제 git 사본을 안 둔다(순수 내부 QA
  체크리스트라 "공개본"으로 남길 이유가 없다는 설계자 판단). 어느
  영역이 아직 실측 검증 안 됐는지 확인하려면 그 설치에 로그인해(`docs
  auth login` - 이 컴퓨터의 접속 정보는 세션 메모리 참고, 없으면
  설계자에게 확인) `docs doctypes <projectId>`로 `QA` 타입의 id를
  찾은 뒤 `docs list <projectId> --type <그 id>`로 조회한다(CLI의
  `--type`은 코드가 아니라 docTypeId를 받는다).
- **PLANS.md → DocType `BL`("백로그 색인")로 완전히 이주, git 파일도
  삭제됨** - 위와 같은 방식으로 `BL` 타입 id를 찾아 조회한다. 색인
  표 자체는 여전히 문서 본문에 마크다운 표로 들어있다 - 다음 백로그
  항목을 고르는 방식(✅ 건너뛰고 위에서부터)은 그대로다.

**README.md/CLAUDE.md(이 파일 자체)는 절대 이 마이그레이션 대상이
아니다** - 둘 다 git 저장소를 처음 열었을 때(이 시스템에 로그인하기도
전에) 바로 읽혀야 하는 문서라 git에만 있어야 의미가 있다.

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
- **기능 자체의 설명은 `FT` 문서(+ git FEATURES.md 공개본), 구현
  변동 사항은 `DN` 문서(+ git DESIGN-NOTES.md 공개본)** - 라운드를
  끝낼 때 `FT`에는 그 기능이 지금 무엇을 하는지만(설계 배경·발견한
  버그·검증 절차 없이) 갱신하고, `DN`에는 그 라운드에서 무엇을
  어떻게/왜 바꿨는지만 새 문서로 남긴다 - 같은 내용을 두 종류 문서에
  중복해서 옮겨 적지 않는다. **DB 문서를 고친 뒤에는 반드시 git의
  FEATURES.md/DESIGN-NOTES.md에도 같은 내용을 반영한다** - 이 둘은
  "공개본"이라 DB만 갱신하고 git 파일을 그대로 두면 안 된다.
- git 커밋/푸시는 사용자가 명시적으로 요청했을 때만 한다.
- **설계자 계정/프로젝트/문서 등 기존 설치의 데이터에 영향을 주는
  스키마·구조 변경은 `prisma db push`만으로 끝내지 않는다** - 그 변경
  없이 기존 설치를 그대로 올리면 버전 호환성이 깨질 것으로 예상되는
  경우, 반드시 전용 마이그레이션 스크립트와 검증 스크립트를 둘 다
  작성한다(`#gitea-per-project-namespace` 라운드의
  `backend/scripts/migrate-gitea-namespaces.ts`+
  `verify-gitea-namespaces.ts`가 표준 패턴 - 항목별 성공/실패 결과표
  출력, 멱등/재실행 안전, `backend/package.json`에 `migrate:*`/
  `verify:*` 스크립트로 등록, README.md에 "기존 설치 업그레이드" 수동
  실행 절차 문서화). 이 저장소 자신의 `db push`(schema drift 자동
  반영)는 스키마 정의 자체의 변경에는 충분하지만, **이미 저장된
  데이터의 의미가 바뀌는 변경**(예: 외부 시스템의 네임스페이스 재구성,
  기존 레코드의 재해석이 필요한 필드 변경)에는 절대 그것만으로
  충분하다고 가정하지 않는다.

## 다른 프로젝트에 이 시스템을 도입하는 방법

설계자가 "이 시스템을 도입해줘" 같은 요청을 하면(자신의 다른 프로젝트
폴더를 claude-native-workflow로 관리하고 싶어할 때) 아래 순서로
판단한다 - 구체적인 명령/절차는 이 문서가 아니라 [README.md](README.md)
"도입 시나리오별 안내" 절과 `backend/src/cli/migrate.ts`(가이디드
마이그레이션 도구)에 있으니 거기를 참고해 실행한다.

**1단계 - 설치 시나리오 판단**: README.md "도입 시나리오별 안내"의
6가지 중 어디에 해당하는지 먼저 정한다 - 핵심 질문은 "이 PC(또는
원격 서버)에 이미 이 시스템이 설치돼 있는가"와 "그 설치가 이 폴더
전용인가, 여러 프로젝트를 담을 공용 설치인가"다. 이미 설치가 있는지는
`~/.claude-native-workflow/credentials.json` 존재 여부(로컬)나
설계자에게 서버 주소를 직접 물어보는 것으로 확인한다 - 추측하지 않는다.

**2단계 - 마이그레이션 시나리오 판단**: 연동하려는 폴더에 뭐가 이미
있는지에 따라 셋 중 하나다:
1. **CLAUDE.md나 AGENTS.md가 이미 존재** - 기존 프로젝트(다른 도구로
   관리되던 것일 수도, 이미 claude-native-workflow로 관리되던 것일
   수도 있음)로 본다.
2. **그 두 파일은 없지만 기존 콘텐츠(문서/코드)가 있음** - 마찬가지로
   기존 프로젝트로 본다.
3. **완전히 빈 프로젝트** - 마이그레이션이 아니다. 백업/MIGRATION.md
   절차 없이 곧장 1단계에서 고른 시나리오의 절차(프로젝트 생성 →
   git link → template deploy)만 따르면 된다.

**시나리오 1·2의 공통 절차**(순서를 반드시 지킨다 - 되돌릴 수 없는
작업 전에 항상 안전망을 먼저 만든다):
1. **백업**: 대상 폴더가 git 저장소면 지금 상태를 그대로 담은 백업
   브랜치를 만든다(예: `git branch backup/pre-cnwk-migration`). git
   저장소가 아니면 폴더 전체를 격리된 별도 위치로 복사해 백업한다
   (예: `../<folder>-backup-YYYYMMDD/`).
2. **`MIGRATION.md` 생성**: 마이그레이션 진행 중임을 기록하는 파일을
   대상 폴더 루트에 만들고, 무엇을 옮기는 중인지·어디까지 끝났는지를
   작업하면서 계속 갱신한다(중간에 세션이 끊겨도 다음 세션이 이
   파일만 보고 이어갈 수 있게).
3. **1단계에서 고른 설치 시나리오의 절차대로** 프로젝트를 만들고
   `git link`/`git link-external`로 연동한다.
4. **콘텐츠 이전**: 기존 문서가 concept 브랜치 스타일의 YAML
   frontmatter(`id`+`type` 필드가 있는 `.md` 파일)라면 `docs migrate
   scan <경로> > manifest.json` → manifest 검토 → `docs migrate apply
   <projectId> manifest.json`으로 자동 이전한다(README.md "CLI" 절
   참고 - 이 도구는 딱 이 형식만 다룬다). 그 외 형식의 기존 문서/코드
   설명은 이 도구가 다루지 않으므로, 직접 읽고 `docs new`로 하나씩
   옮기거나 설계자에게 어떻게 옮길지 확인한다.
5. **정리**: 이전이 끝나고 그 폴더가 이 시스템과 완전히 통합됐다고
   판단되면(모든 문서가 옮겨졌고 `docs template deploy`+`git pull`로
   CLAUDE.md/SKILL.md도 받은 상태) `MIGRATION.md`를 삭제한다 - 그 뒤로는
   이 폴더도 정상적으로 관리되는 프로젝트로 취급한다.
