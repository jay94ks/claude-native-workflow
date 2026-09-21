---
id: PSTRUCT01
parent_id: null
type: doc
kind: SP
state: draft
branch: null
commit_id: null
title: v3 프로젝트 구조 및 구현 현황
author: agent
related:
  - SP-XJQCTF6Y
---

# v3 프로젝트 구조 및 구현 현황 (SP-PSTRUCT01)

CLAUDE.md는 새 세션이 매번 읽는 온보딩 문서라 짧게 유지해야 한다 -
"지금 이 시스템이 뭘 갖추고 있는지"에 대한 상세 서술은 여기로 옮긴다
(design-notes.md의 라운드별 설계 논의 기록과는 성격이 다르다 - 이
문서는 "지금 시점의 완성된 구조"를 요약하는 살아있는 참고 문서다).
새 기능이 실제로 동작하는 걸 확인한 라운드마다 이 문서를 그 사실에
맞게 갱신한다(CLAUDE.md의 "새 기능 문서화" 규칙과 동일한 취지).

## 패키지 구조

`docs/design-notes.md`의 설계를 뼈대 코드로 옮긴 구조다(자세한
설계는 그 문서를 확인) - 5개의 독립 패키지로 구성되고, 루트
`package.json`은 npm workspaces만 선언한 최소 파일이다(개발 중
상호 참조 편의용일 뿐, 각 패키지는 여전히 독립적으로 빌드/배포
가능해야 한다):

- `backend/` - Express API + Prisma(PostgreSQL 전용) 스키마.
  **CLI/MCP는 `POST /api/actions` 단일 엔드포인트(+ command 패턴,
  `X-Cnw-Channel: agent` 헤더)를 그대로 쓰지만, WEB UI는 액션별
  REST 엔드포인트(`backend/src/api/rest.ts`)를 쓴다** - 아래
  "WEB REST API" 절 참고. `POST /api/auth/login`/`signup`은 둘 다에서
  공통으로 쓰는 별도 엔드포인트(액션 체계 밖).
- `shared/` - `cli`/`mcp`가 공유하는 HTTP 클라이언트(`apiclient.ts`)
  와 `.cnw/config.json`+`.cnw/session.json`+홈 디렉터리 설정 해석
  (`config.ts`) - **backend와는 무관**, CLI/MCP를 backend와 별도로
  배포할 수 있어야 한다는 지시에 따라 분리됨.
- `cli/` - `docs` 커맨드(예: `docs auth login`, `docs add`, `docs
  list`, ...), `shared`에만 의존.
- `mcp/` - `docs_query`(조회)/`docs_action`(변경) 두 도구, `shared`에만
  의존.
- `frontend/` - Quasar(Vue 3 + TypeScript) 프로젝트.

## 구현 로드맵(Phase 0~9) - 전부 완료

- 로그인/부트스트랩(계정 `admin`/`12345678`, `demo-project` 시드).
- `doc`/`plan`/`question`/`answer`/`tracker`/`test`/`opinion` **일곱
  타입 전부**의 `docs.add`/`get`/`update`/`delete`/`transition`/
  `tag`/`list`가 실제로 동작한다(etag 동시성, 챕터 참조, 문서 체인
  카디널리티, 상태 전이 액터 규칙, 연쇄 전이, `dependsOn` readiness
  정렬 포함) - `backend/src/core/{trackingCode, documentRules,
  channel, membership, refs, documents}.ts`.
- `docs.search`(Meilisearch `q` / PostgreSQL POSIX 정규식 `grep`),
  `docs.grep`, `docs.status`(집계)도 실제로 동작한다 - `backend/
  src/core/{searchIndex, grep, cache}.ts`. 백엔드 인메모리 캐시가
  `docs.list`/`docs.search`/`docs.status` 응답을 프로젝트 단위로
  캐싱하고 문서 CRUD 시 무효화한다.
- `remember.*`(개인화 메모리)/`message.*` + 표준 응답 `notices`
  piggyback(모든 액션 응답에 항상 실림, 전달 시 자동 `read` 전이)도
  실제로 동작한다 - `backend/src/core/{remember, messages, emqx}.ts`.
  질의/답변/의견 등록은 자동으로 `notice`를 남긴다. `emerg`는 EMQX로
  즉시 브로드캐스트된다(`cnw/<projectId>/emerg` 토픽). CLI에
  `remember`/`message` 서브커맨드 그룹이 있고, `notices`가 있으면
  CLI 출력에도 항상 같이 찍힌다.
- **CLI는 실행 중인 디렉터리의 실제 git branch/HEAD 커밋을 자동
  인식**해서 `docs add` 시 채운다(명시적으로 넘기면 그게 우선) -
  `shared/src/git.ts`.
- **문서 CRUD는 이제 EMQX(`cnw/<projectId>/docs` 토픽)로 브로드
  캐스트되고, Meilisearch 인덱싱/캐시 무효화는 그 브로드캐스트를
  구독하는 비동기 구독자가 처리**한다(Phase 3/4의 직접 동기 호출을
  대체) - `backend/src/core/broadcastSubscriber.ts`, 서버 기동 시
  `startBroadcastSubscriber()` 호출.
- **`repo.push`도 실제로 동작**한다 - 프로젝트마다
  `./data/repos/<projectId>`에 es-git으로 유지하는 내부 저장소를
  `Project.pushMirrorUrl`(옵션)로 push한다 - `backend/src/core/
  gitRepo.ts`. 실제 Gitea 서버 프로비저닝은 프로젝트 생성 플로우가
  갖춰지는 Phase 6에서 다룬다(지금은 로컬 저장소 유지 메커니즘만).
- **계정/프로젝트/권한도 실제로 동작한다**: 셀프 회원가입(`POST
  /api/auth/signup`), `project.create`(만든 사람이 유일한 Admin)/
  `get`/`list`/`update`(이름/설명/기본 브랜치/메시지 TTL/visibility/
  push-mirror - Admin만)/`invite`(Admin만, Read/Write만 부여)/
  `acceptInvite`/`transfer`(Admin 양도 - 대상은 이미 collaborator
  여야 함)/`destroy`(제한구역, cascade 삭제) - `backend/src/core/
  projects.ts`. **"Admin은 프로젝트당 1명"은 애플리케이션 레이어
  (create/invite/transfer 세 경로만 ADMIN을 건드리고 셋 다 이 불변식을
  지킴)뿐 아니라 DB 부분 unique 인덱스로도 이중 강제**한다 -
  `CREATE UNIQUE INDEX ... ON "ProjectMembership" ("projectId")
  WHERE ("role" = 'ADMIN')`, Prisma 스키마 DSL이 부분 인덱스를
  표현 못 해 마이그레이션 SQL에 직접 작성(`backend/prisma/migrations/
  20260921025909_admin_per_project_unique/`) - **`schema.prisma`엔
  선언돼 있지 않으므로 다음에 `prisma migrate dev`를 돌릴 때 이
  인덱스를 drift로 오인해 `DROP INDEX`를 자동 생성할 수 있다는 점을
  알아두고, 그런 줄이 보이면 그 줄만 지우고 진행할 것**(design-notes.md
  참고). `visibility: PUBLIC`이면 비멤버도 READ 가능(WRITE는
  여전히 멤버십 필요) - `docs.*`/`remember.*`/`message.*`/`repo.*`가
  전부 공유하는 `membership.ts`의 `requireMembership`에 이 예외가
  들어있다. CLI에 `project` 서브커맨드 그룹이 있다.
- **architect별 `CLAUDE.md`/`SKILL.md` 템플릿도 실제로 동작한다**:
  `template.set`/`get`/`delete`(architect 계정 하나당 템플릿 하나,
  프로젝트와 무관)와 `template.deploy`(그 프로젝트의 **Admin만**,
  자신의 템플릿을 그 프로젝트 내부 저장소에 `CLAUDE.md` +
  `.claude/skills/claude-native-workflow/SKILL.md` 두 커밋으로
  배포) - `backend/src/core/templates.ts`. CLI에 `template`
  서브커맨드 그룹(`set`/`get`/`delete`/`deploy`)이 있다. **주의**:
  내부 저장소에 파일 두 개 이상을 순차 커밋할 때는 반드시 현재
  HEAD를 `parents`로 명시해야 한다(`es-git`의 `commit()`은 HEAD를
  암묵적으로 채워주지 않음, 안 하면 두 번째 커밋부터 프로세스가
  크래시함) - `gitRepo.ts`의 `commitFile()`이 이미 이렇게 처리하므로
  내부 저장소에 새로 커밋하는 코드는 항상 이 함수를 거친다.
- **CLI에 로컬 스테이징/캐시도 있다**: `--stage` 옵션을 붙이면
  액션이 바로 전송되지 않고 `.cnw/staging.json`에 쌓이고, `docs
  push`가 쌓인 걸 한 번의 bulk 호출로 전송한다(`docs stage list`/
  `docs stage clear`로 관리) - 여러 문서를 한 번에 등록할 때 호출
  수를 줄이는 용도. `docs.list`는 이제 `content`를 뺀 요약만
  반환하고(`backend/src/core/refs.ts`의 `toDocSummary`), 본문이
  필요하면 `docs get`으로 이어서 조회한다 - `docs get`이 받은 본문은
  `.cnw/cache.json`에 남아 `docs cat <code>`로 네트워크 없이 다시
  읽을 수 있다(캐시일 뿐 정본 아님, 신선도 보장 없음). `docs
  search`는 여전히 기본적으로 본문 전체를 반환하므로(스니펫 성격이라
  의도적으로 요약화 대상에서 제외) `--codes-only`(코드/제목/타입/
  kind/state만)와 `--lines <n>`(본문 앞 n줄까지만)으로 다듬을 수
  있다 - `.cnw/staging.json`/`.cnw/cache.json` 둘 다 git 추적 안 함.
- **프론트엔드(`frontend/`, Quasar+Vue3+TS)도 실제로 동작한다**:
  로그인/회원가입, 프로젝트 목록/생성/초대 수락, 프로젝트별 7개 탭
  (Code/Pull requests/Issues/Documents/Plans/Trackers/Settings -
  Collaborators/Template은 독립 탭이 아니라 Settings 탭 안 좌측
  메뉴다, 아래 참고) 까지 전부 실제 API 왕복으로 동작한다 -
  `frontend/src/api/client.ts`가 WEB UI 전용 fetch 클라이언트다
  (`X-Cnw-Channel` 헤더를 안 보내 architect로 식별됨, CLI/MCP의
  `shared/apiclient.ts`와는 무관). **Q&A(question/answer/opinion)는
  독립 탭이 아니다** - design-notes.md "UI 설계"가 애초에 "각 문서
  화면에 통합(PR 리뷰 코멘트처럼)"이라고 명시했는데 Phase 9에서
  이를 놓치고 독립 `QaTab.vue`를 만들었던 걸 나중 라운드에
  바로잡았다 - `components/DocumentDiscussion.vue`가 `parentCode`
  prop으로 받은 그 문서 하나에 달린 질의/답변/의견만 스레드로
  보여주고, `DocTypeWorkspace.vue`(doc/plan/tracker/test/issue가
  공유하는 List+Source View+전이 워크스페이스, `readOnly` prop으로
  tracker/test는 조회 전용)의 상세 패널에 끼워 넣어서 문서 타입에
  상관없이 모든 문서 화면에 자동 적용된다. **Trackers 탭 안에
  "최근 Q&A 모아보기"(`components/RecentQaFeed.vue`, 읽기 전용)도
  있지만 어디까지나 프로젝트 전체 조회용일 뿐 실제 질문/답변/의견
  등록은 여전히 각 문서 화면의 Discussion에서만 한다** - 별도
  상호작용 창구를 새로 만들지 않기 위한 판단.
  `DocTypeWorkspace.vue`엔 related/dependsOn 태그 배지(클릭하면
  타입이 달라도 그 문서로 바로 이동)+"태그 추가" 다이얼로그+
  "의존성 순 정렬" 토글도 있다(선택 동작은 항상 다이얼로그로
  유지 - 아래 Source View/생성 페이지 절 참고). 전역 상단바
  (`MainLayout.vue`)엔 메시지 아이콘(`components/MessagesDialog.vue`
  - `message.list`/`send`/`transition`)이 있고, 모든 액션 응답의
  `notices`는 Quasar `Notify` 토스트로 뜬다(`stores/auth.ts`가
  envelope 전체를 받아 처리 - CLI/MCP가 Phase 4에서 겪은 "notices를
  버리던" 버그와 같은 걸 WEB UI도 갖고 있었다가 나중 라운드에
  고쳤다). GitHub 저장소 페이지 스타일(기능 아닌 UI 톤만 참고)로
  리디자인했다 - 탑바에 프로젝트 브레드크럼/배지/역할을 합치고
  (`ProjectShell.vue` 자체 헤더는 없앰), 탭바는 아이콘+라벨 한 줄+
  주황 밑줄, Documents 탭엔 About/Contributors/"문서 타입 구성"
  (Languages 자리) 사이드바(`components/ProjectAboutSidebar.vue`)가
  있다. Danger Zone(양도/파기)은 프로젝트 이름을 정확히 입력해야
  파기 버튼이 활성화된다. 이 화면들을 만들며 빠져있던 백엔드 조각
  `project.members`(멤버/대기 초대 목록)와 `project.get`/`list`의
  `myRole` 필드도 이번에 추가했다.
- **Code/Pull requests/Issues 탭 - es-git 기반, 외부 저장소 클론
  없이 내부 저장소를 그대로 브라우징**: `backend/src/core/
  gitRepo.ts`의 `listBranches`/`listTree`/`readFile`(512KB 상한)/
  `listCommits`/`diffBranches`/`mergeBranches`를 `backend/src/core/
  repoBrowse.ts`(신규, `repo.branches`/`tree`/`file`/`commits`/
  `writeFile`)와 `backend/src/core/pullRequests.ts`(신규, PR은
  **Document 타입 체계 밖의 별도 Prisma 모델** - git 머지 시맨틱이
  문서 상태 전이 모델과 안 맞는다는 판단, 액션 `pr.create`/`list`/
  `get`/`merge`/`close`)로 노출한다. `pr.get`의 diff는 매번
  `diffBranches`로 실시간 계산되므로 머지/닫힘 이후 브랜치가 더
  갈라지면 실제 머지 당시와 달라 보일 수 있다는 한계가 있다.
  Issues는 Plans의 재포장이 아니라 완전히 새로운 독립 타입
  (`documentRules.ts`의 `issue`, kind `IS`, open/closed 두 상태뿐,
  어느 채널이든 전이 가능)이고 `IssuesTab.vue`는 `DocTypeWorkspace`
  를 얇게 감싼 것뿐이라 Documents/Plans와 같은 화면을 재사용한다.
  Code 탭은 선택된 파일이 없고 현재 브랜치 루트에 `README.md`가
  있으면 자동으로 보기 모드로 표시하고, 없으면 "README.md
  작성하기" 버튼으로 곧장 편집 모드에 들어가 저장 시
  `repo.writeFile`로 커밋한다(`commitFile()`에 추가된 `targetBranch`
  옵션으로 항상 현재 선택된 브랜치에 정확히 커밋됨).
  **`mergeBranches()`에서 실제 머지 중 발견한 버그 두 개**: (1)
  `repo.mergeCommits()`가 반환하는 `Index`는 저장소에 바인딩되지
  않아 `.writeTree()`가 죽었다 - `setHead`+`checkoutHead(force)`+
  `merge`+(인메모리 대신) `repo.index()`로 교체. (2) **저장소가
  지저분한 상태면 `repo.merge()`가 던지는 예외를 어디서도 안
  잡아서 서버 프로세스 전체가 죽었다** - `backend/src/api/
  actions.ts`의 `dispatch()`에 모든 액션 핸들러를 감싸는 전역
  try/catch를 추가해 고쳤다(Phase 0 스캐폴딩 때부터 있던 구조적
  결함이었음 - 이제 어떤 액션이 핸들러 내부에서 uncaught exception을
  던져도 서버는 안 죽고 깨끗한 에러 응답만 돌아간다). CLI에
  `repo`(`push`/`branches`/`tree`/`file`/`commits`/`writeFile`)와
  `pr`(`create`/`list`/`get`/`merge`/`close`) 서브커맨드 그룹이
  있고, MCP는 `repo.branches`/`tree`/`file`/`commits`와 `pr.list`/
  `get`을 `docs_query`(조회)에, `pr.create`/`merge`/`close`와
  `repo.writeFile`을 `docs_action`(변경)에 노출한다.
- **"Source View"는 보기 모드(마크다운→HTML 렌더링만)/편집 모드
  (마크다운 편집) 둘로 명확히 정의되고, 에디터는 `yiitap`
  (`@yiitap/vue`, Tiptap/ProseMirror 기반)이다** -
  `frontend/src/components/MarkdownSourceView.vue`. yiitap엔
  markdown↔content 프로그래매틱 변환 API가 없어서(클립보드에만
  markdown 지원) `marked`(md→html)/`turndown`(html→md)으로 경계에서
  직접 변환한다 - 정본은 항상 마크다운 텍스트다. `YiiEditor`의
  `content` prop은 "초기 내용"일 뿐 마운트 후 반응형으로 안 바뀌므로
  (저장 후 보기 모드가 옛 내용을 보여주는 버그가 있었음) `content`
  prop 변화를 `watch`해 `key`를 바꿔 강제 리마운트한다. `hideToolbar`
  prop + `getMarkdown()` expose 함수로 뷰/편집 토글 UI 없이 순수
  컴포저로도 쓸 수 있다(다이얼로그/생성 페이지에 끼워 넣을 때 용도).
  `DocTypeWorkspace.vue`의 Source View, Code 탭의 README 뷰어가 전부
  이 컴포넌트를 쓴다.
- **PR/새 문서/새 플랜/새 이슈 등 "새 엔티티 작성"은 다이얼로그가
  아니라 별도 페이지다** - 본문이 한 줄로 끝나는 경우가 없다는
  판단. `pages/project/DocCreatePage.vue`(doc/plan/issue 공용,
  `type`/`kinds`/`createLabel`/`listRoute`/`allowChapter` props로
  재사용)과 `pages/project/PrCreatePage.vue`가 `MarkdownSourceView`
  (hideToolbar)로 본문/설명을 받는다. **"뭔가를 선택하는 동작"
  (참조/태그 추가, 브랜치 선택 등)은 계속 다이얼로그로 남긴다** -
  페이지 분리 대상은 새 엔티티 작성뿐이다. 질문하기/답변 작성/의견
  남기기(`DocumentDiscussion.vue`)는 그 문서에 종속된 짧은 댓글
  성격이라 페이지로 안 빼고 인라인 컴포저(`q-slide-transition`)로
  처리한다. **버그**: 처음엔 컴포넌트 자체의 `@save` 이벤트(내부
  "저장" 버튼을 눌러야 emit)로 부모 상태를 채우는 방식으로 짰는데,
  사용자는 실제로 페이지/다이얼로그의 "만들기"/"등록" 버튼만
  누르므로 본문이 항상 빈 문자열로 제출되는 버그가 있었다 -
  `hideToolbar` 모드에선 제출 시점에 부모가 `ref.getMarkdown()`을
  직접 호출해 현재 편집 중인 내용을 가져가는 방식으로 고쳤다.
- **Code/Pull requests/Issues/Documents/Trackers/Settings 좌측
  패널은 전부 270px 고정폭 공용 컴포넌트(`components/
  ProjectSidebar.vue`)를 쓴다** - 1024px 미만에서는 오프캔버스로
  바뀌고(`stores/ui.ts`의 `sidebarOpen` 전역 상태), `MainLayout.vue`
  로고 좌측 햄버거(프로젝트 화면일 때만 보임)로 토글한다. 라우트가
  바뀌면 `ProjectSidebar.vue` 자신이 자동으로 닫아준다. 탑바의
  "Settings" 버튼(탭과 별개로 있던 것)은 삭제됐다 - Settings **탭**
  자체는 유지. **Collaborators/Template은 독립 탭에서 Settings 탭
  안 좌측 메뉴(기본 설정/Collaborators/Template)로 통합**됐다 -
  `layouts/SettingsShell.vue`(자체 270px `ProjectSidebar` +
  `router-view`)와 `pages/project/settings/{General,Collaborators,
  Template}Page.vue` - `routes.ts`의 `settings` 라우트 아래
  `general`/`collaborators`/`template` 세 자식 라우트로 재구성(빈
  경로는 `general`로 리다이렉트). Documents 탭 우측에 있던 About
  카드(`ProjectAboutSidebar.vue`)는 Code 탭 좌측 패널 맨 위로
  옮겼다(프로젝트 진입 시 첫 화면이 Code라 About이 가장 먼저
  보여야 한다는 판단).
- **버그(심각) 발견: `MarkdownSourceView.vue`가 `YiiEditor`의
  `extensions` prop을 한 번도 넘긴 적이 없었다** - 그 prop의 문서
  주석은 "기본으로 BuiltinExtensions를 켠다"지만, 컴파일된
  `node_modules/@yiitap/vue/dist/index.mjs`를 직접 까보면 실제
  기본값은 빈 배열이고 내부 베이스 에디터도 codeBlock/blockquote/
  horizontalRule/link/document를 명시적으로 꺼둔 채 만들어진다 -
  즉 이 prop 없이는 codeBlock/blockquote/horizontalRule/link
  툴바 버튼이 **눌러도 아무 일도 안 일어났다**. `@yiitap/vue`가
  공개 export하는 `OStarterKit.configure(options)`를 `extensions`
  prop으로 넘기도록 고쳤고, 동시에 그 옵션으로 마크다운과 안 맞는
  기능(BackgroundColor/Color/FontFamily/Highlight/TextAlign/
  TextStyle/Typography/OCallout/OTable/Subscript/Superscript/Focus)
  은 확장 자체를 꺼서 제외했다. **이 라이브러리를 다룰 땐
  `.d.ts`/문서 주석을 곧이곧대로 믿지 말고 컴파일된 `dist/index.mjs`
  를 직접 grep해서 실제 기본값/동작을 확인해야 한다**. 이 수정
  하나로 `MarkdownSourceView`를 쓰는 모든 곳(Documents/Plans/Issues/
  Trackers Source View, PR 설명, Template, Discussion 작성창)이
  동시에 고쳐졌다.
- **에디터 툴바(main menu)는 항상 보이고, 보기 모드에선 비활성
  (회색+클릭 차단), 편집 모드에선 활성**이다 - `MarkdownSourceView.vue`
  가 보기 모드일 때 `.source-view-toolbar-disabled` 클래스로
  `:deep(.o-main-menu)`에 `pointer-events: none; opacity: .45`를
  건다. main-menu 항목 목록도 `MARKDOWN_MAIN_MENU`(bold/italic/
  heading/blockquote/codeBlock/link/list-dropdown/horizontalRule/
  emoji 등)로 커스텀했다.
- **Code 탭의 파일 뷰어/에디터도 yiitap 기반**이다 - `.md`가 아닌
  파일은 펜스 코드 블록(` ```lang ... ``` `)으로 감싸 넣고 저장 시
  다시 벗겨 `repo.writeFile`로 커밋한다(`CodeTab.vue`의
  `wrapAsCodeFence`/`unwrapCodeFence`). marked→turndown 코드 블록
  왕복에서 파일 끝 줄바꿈이 하나 없어지는 경우가 있어 원본이 `\n`
  으로 끝났으면 저장 직전에 되돌려준다.
- **PR 설명도 Source View로 렌더**한다 - `pr.update` 액션으로
  **PR이 `open` 상태인 동안은 수정 가능**하다(WRITE 멤버십 필요) -
  `backend/src/core/pullRequests.ts`의 `prUpdate`, REST `PATCH
  /projects/:owner/:projectId/pull-requests/:id`, CLI `pr update`,
  MCP `docs_action`에 노출. merged/closed된 PR은 여전히 읽기 전용 -
  `PullRequestsTab.vue`가 `MarkdownSourceView`의 `read-only`를
  `selected.state !== 'open'`으로 바꿔 기존 view/edit 토글+저장
  버튼을 그대로 재사용한다.
- **WEB REST API**: "/api/actions 단일 엔드포인트"는 CLI/MCP를 위한
  설계였지 WEB UI까지 몰아넣을 필요는 없다는 판단에 따라,
  `backend/src/api/rest.ts`에 프로젝트/문서/repo/PR/메시지/웹훅/
  템플릿/remember 전 영역의 REST 엔드포인트(GET/POST/PATCH/PUT/
  DELETE, 자원 기반 경로)를 만들고 WEB UI는 이걸 쓴다 - **core/*.ts
  의 액션 핸들러는 전혀 안 건드리고 그대로 재사용**한다(`rest.ts`의
  `web()` 헬퍼가 req.params/query/body를 그 핸들러의 payload
  모양으로 조립해 호출). notices piggyback은 응답 바디 대신
  `X-Cnw-Notices`(base64 JSON) 응답 헤더로 옮겼다. `/api/actions`는
  그대로 남아있고 CLI/MCP는 전혀 안 바뀌었다.
  `frontend/src/api/client.ts`를 자원별 함수 40여 개로 새로 썼다.
- **PR/커밋 diff 뷰어** - `components/DiffViewer.vue`(PR 상세/
  `pages/project/CommitDiffPage.vue`가 공유)가 파일 하나를 좌(변경
  전)/우(변경 후) 분할해서 보여준다. 라인 단위 diff 계산(`diff`
  npm 패키지 `diffLines` + ±6줄 컨텍스트만 보이고 나머지는 "변경되지
  않은 코드 보기"로 접기)은 **서버가 아니라 클라이언트**
  (`frontend/src/utils/lineDiff.ts`)가 한다. 이미지는 변경 전/후
  미리보기, 그 외 바이너리는 "Raw Contents"만 표시. 백엔드는
  `gitRepo.ts`에 `readFileAtRef`(branch/커밋 id 둘 다 받는 ref
  통일)/`readBlobRawAtRef`/`diffCommit`/`listCommitsForPath`/
  `getCommitInfo`를 추가하고 `repoBrowse.ts`의 `repo.diffFile`/
  `commitDiff`/`commitInfo`/`fileCommits` 액션으로 노출(CLI/MCP·
  REST 둘 다). Code 탭 우측 뷰어도 탭으로 나뉜다(첫 탭=파일명만,
  둘째 탭="Recent Commits"=그 파일을 건드린 커밋만) - 좌측 "최근
  커밋" 목록은 없애고 브랜치 선택기 옆 눈알 아이콘으로
  `pages/project/BranchCommitsPage.vue`(그 브랜치 커밋 목록)로
  이동한다.
- **Q&A는 실제로 계층 구조(질문→답변→그 답변에 대한 재질의→...)**
  다 - `DocumentDiscussion.vue`의 카드는 한 단계(질문+직접 답변)만
  보여주므로, 더 자식이 있으면 카드 우측 상단에 `more_horiz` 아이콘을
  붙여 `pages/project/DocumentThreadPage.vue`(`/thread/:code`)로 -
  그 문서 자신+직접 자식 목록을 보여주고 자식도 또 자식이 있으면
  같은 페이지를 재귀적으로 열어 더 내려간다. `RecentQaFeed.vue`
  (Trackers 탭 안 "RECENT Q&A")도 이 계층을 부모 배지("↳ 질문/답변/
  doc: 제목")+more 아이콘으로 보여준다. `DocumentThreadPage.vue`는
  그 항목 자신을 대상으로 한 재질의하기/답변 작성/의견 남기기
  컴포저도 갖고 있다 - 표시(더보기 아이콘+자식 목록)만 있고 실제로
  계층을 늘릴 방법이 없었던 공백을 나중 라운드에 메웠다
  (`documentRules.ts`의 `checkChainConstraint`는 애초에
  "question/opinion 부모 타입 제한 없음"이라 백엔드는 이미 임의
  깊이 중첩을 지원하고 있었다 - 막혀 있던 건 프론트엔드뿐이었다).
- **버그(심각) - "답변 작성"이 처음부터 조용히 아무 동작도 안
  했다**: `DocumentDiscussion.vue`의 답변 컴포저
  (`<MarkdownSourceView ref="answerEditorRef">`)가
  `v-for="item in thread"` **루프 안**에 있어서 Vue가 그 ref를 항상
  배열로 모으는데(v-for 안 동일 이름 ref의 공식 동작),
  `submitAnswer()`는 그걸 단일 객체처럼
  `answerEditorRef.value?.getMarkdown()`으로 불러 매번 `TypeError`
  를 던지고 있었다 - async 함수 안 uncaught promise rejection이라
  에러 메시지도 안 뜨고 로딩 스피너만 무한히 도는 것처럼 보였다.
  `answerEditorRef`를 `ref<MarkdownSourceViewRef[]>([])`로 바꾸고
  `[0]`으로 접근하도록 고쳤다. **교훈**: "버튼이 보인다"는
  "동작한다"의 증거가 아니다 - `v-for` 안의 템플릿 `ref`는 컴파일/
  타입체크/렌더링 전부 통과하고 실제로 눌러보기 전까진 문제가
  절대 드러나지 않는다.
- **yiitap의 `.ProseMirror`는 보기/편집 모드나 사이드 메뉴 표시
  여부와 무관하게 `padding-inline: 54px`를 무조건 예약해둔다** -
  `MarkdownSourceView.vue`가 보기 모드에선 `padding-inline: 0`으로
  되돌리고, 편집 모드에선 그 padding은 유지한 채 `min-height`
  (`editMinHeight` prop, Source View 기본 300px/Discussion 컴포저
  200px)와 흰 배경을 추가한다. **진짜 레이아웃 버그의 원인은 따로
  있었다**: yiitap 자체 CSS `.yiitap{display:flex;
  justify-content:center}`가 flex-direction을 안 정해줘서(기본값
  row) 툴바와 내용이 가로로 나란히 배치됐다 -
  `.yiitap-source-view :deep(main.yiitap) { flex-direction: column }`
  으로 고쳤다(이 수정 자체도 CSS 주석을 `-->`로 잘못 닫아서 처음엔
  적용 안 되는 2차 버그가 있었다 - Vue의 scoped-CSS 컴파일러가
  `:deep()`를 그대로 흘려보내 브라우저가 파싱 실패로 버렸다).
  **교훈**: CSS 버그를 고쳤다고 확신하려면 `getComputedStyle`만이
  아니라 `document.styleSheets`로 내가 쓴 셀렉터가 실제 규칙으로
  존재하는지까지 확인해야 한다.
- **`related`/`dependsOn`은 Json 컬럼이 아니라 별도 테이블**
  (`DocumentRelated`/`DocumentDependsOn`, 각각 `documentId`+
  `targetId`+`etag` + `@@index([targetId])`)이다. `backend/src/core/
  refs.ts`의 `replaceRelated`/`replaceDependsOn`(전체 교체)과
  `loadRelated`/`loadDependsOn`(+배치 버전)이 API 응답의
  `{code,etag}[]` 모양은 그대로 유지하면서 이 테이블을 조립/분해
  한다. 문서를 삭제하면 그 문서를 가리키던 참조도 FK
  `onDelete: Cascade`로 자동 정리되고, `docs.list`의 `sort:
  'dependency'`는 배치 쿼리 한 번으로 계산한다.
- **로컬 상시 개발 스택**이 있다: `docker-compose.dev.yml`
  (postgres 15432/meilisearch 17700/emqx 11883+18084 - 이 머신의
  다른 운영 중인 설치와 절대 안 겹치는 포트로 고정), CLI
  워크스페이스는 저장소 밖(`.cnw/session.json`이 실수로 git에
  섞이지 않게). `$HOME/.cnw/config.json`(홈 자격증명)과
  `<프로젝트>/.cnw/config.json`(프로젝트 설정)이 같은 파일명을
  써서 프로젝트가 홈 디렉터리 바로 아래 있으면 `findProjectRoot()`
  가 크래시하던 버그를 홈 쪽 파일명을 `credentials.json`으로 분리해
  고쳤다 - `shared/src/config.ts`. **웹훅(외부 연동)**: `Webhook`
  (projectId/url/secret) Prisma 모델 + `webhook.add`/`list`/`delete`
  (전부 그 프로젝트 **Admin만**) - 문서 CRUD가 생길 때마다 등록된
  각 URL로 `X-Cnw-Signature: sha256=<hex>` HMAC-SHA256 서명을 실어
  POST한다 - secret은 등록 시 응답에만 한 번 실리고 이후
  `webhook.list`로 다시 조회할 수 없다(재발급은 삭제 후 재등록).
  **"나에게 온 초대 목록" 조회**: `project.invitesForMe`(멤버십
  없이도 호출 가능).
- 로컬 개발 시 `MEILISEARCH_URL`/`MEILISEARCH_API_KEY`,
  `EMQX_MQTT_URL`/`EMQX_SERVICE_USERNAME`/`EMQX_SERVICE_PASSWORD`
  환경 변수로 각각 연결한다(기본값 `http://127.0.0.1:7700`,
  `mqtt://127.0.0.1:1883`) - 둘 다 없어도 문서/메시지 CRUD 자체는
  동작한다(경고만 로그).
- 액션은 전부 payload에 **명시적 `projectId`**가 필요하다(CLI/MCP는
  `.cnw/config.json`에서 자동으로 채움). 요청이 CLI/MCP를 통했는지
  (=클로드) WEB UI를 통했는지(=architect)는 `X-Cnw-Channel: agent`
  헤더 유무로 판별한다.
- **project id는 전역 유일이 아니라 그 생성자(owner)별로만 유일**
  하다("설계자 A가 pA를 가졌어도 설계자 B도 pA로 만들 수 있어야
  한다") - `Project.slug`가 `@@unique([creatorAccountId, slug])`로
  그 값을 저장하고, DB의 전역 유일 PK(`Project.id`, cuid)는 완전히
  내부용으로만 남아 Document/PullRequest 등 기존 관계 테이블 스키마는
  전혀 안 바뀌었다. 그래서 **모든 액션 payload는 `projectId`(slug)
  옆에 `owner`(그 프로젝트 생성자의 username)도 같이 실어야 한다** -
  CLI는 `.cnw/config.json`의 `owner` 필드(`docs auth login --owner
  <username>`, 생략 시 `--username`으로 기본값)로 자동 채우고, REST는
  `/projects/:owner/:projectId/...` URL 자체에 있다. owner+projectId
  (slug) -> 실제 내부 PK 변환은 `backend/src/core/projectResolve.ts`
  의 `resolveProjectId()` 하나뿐이고, 이걸 부르는 곳도
  `api/actions.ts`의 `dispatch()`(CLI/MCP)와 `api/rest.ts`의
  `web()`(WEB UI) 딱 두 진입점뿐이다 - 그 아래 `core/*.ts`의 기존
  액션 핸들러는 이 owner/slug 개념을 전혀 몰라도 되고
  (`payload.projectId`를 지금까지처럼 "이미 유일하게 식별된 값"으로
  그대로 씀), `project.create`만 예외로 호출자가 원하는 slug를 `id`
  payload 필드로 직접 골라 보낸다. **웹 접속 path도 이와 짝을 맞춰
  `/{생성자 username}/{project id}`**(및 그 아래 모든 경로) 형태다 -
  `frontend/src/router/routes.ts`의 최상위 동적 라우트가
  `:owner/:projectId`, `frontend/src/api/client.ts`의 프로젝트 스코프
  함수 전부가 `owner` 파라미터를 받는다. **owner segment는 검증하지
  않는 장식**이다(틀린 owner로 접근하면 그냥 404). owner는
  **생성자**(`creatorAccountId`, 영구)를 가리키므로 `project.transfer`
  로 Admin이 넘어가도 URL은 안 바뀐다.
- **웹 접속 path는 지금 보고 있는 항목의 추적 코드까지 반영해
  Browser History/새로고침에서 그 상태가 유지된다**(Documents/Plans/
  Issues) - `documents/:code?`처럼 optional path segment로,
  `DocTypeWorkspace.vue`의 `select()`가 선택 시 `router.push`로
  그 URL을 반영하고, `watch(() => props.code, ...)`가 브라우저
  뒤로/앞으로 가기에도 반응한다. related/dependsOn으로 다른 타입
  문서를 참조하면(`URL_SYNCED_TYPES`) 그 타입에 맞는 tab의 URL로
  이동한다(예: Plan에서 Document를 참조하면 `/documents/{code}`로).
  Trackers/Tests는 이번 스코프 밖이라 여전히 query(`open=`)로만
  연다. **PR/Code도 같은 성격의 URL 지속성을 갖춘다**(`docs/
  plan-pr-code-url-scheme.md`, 완료) - PR은 `/pull-requests/{id}`,
  Code는 `/code`(기본 브랜치)/`/code/{branch}`(특정 브랜치)/
  `/code/{branch}/{commitId}`(그 브랜치 위 특정 커밋 시점, 읽기
  전용) + `?path=`(지금 열려 있는 파일). 과거 커밋 시점 조회는
  `backend/src/core/gitRepo.ts`의 `listTreeAtRef`(신규, 기존
  `readFileAtRef`와 짝)로 - `listTree`/`readFile`(branch 전용,
  `repo.writeFile`이 실제로 커밋 가능한 "지금" 상태와 동일 경로)은
  손대지 않고 그대로 둬서 과거 시점에 쓰기가 섞여 들어갈 여지를
  API 레벨에서부터 없앴다. `DiffViewer.vue`가 PR 비교(브랜치 대
  브랜치)와 커밋 diff(그 브랜치 위 커밋)를 `branch` prop 유무로
  구분해 "코드 트리에서 보기" 링크를 각각 지금 시점/과거 시점으로
  연결한다 - **PR/커밋 diff에서 과거 커밋의 파일 원본을 실제로
  코드 탭에서 볼 수 있다**(실기동으로 그 시점 내용이 지금 tip과
  실제로 다르게 보이는 것까지 확인). **버그 발견**:
  `Project.defaultBranch`(스키마 기본값 "main")가 실제 저장소의
  브랜치 목록에 없을 수 있다(demo-project 실측: 실제 브랜치는
  master/feature-branch/another-feature뿐) - 이 값을 검증 없이
  기본 브랜치로 신뢰하면 존재하지 않는 브랜치로 API를 불러 422가
  난다 - `branchNames`에 실제로 있는지 확인한 뒤에만 쓰도록 고쳤다.
- **Q&A/opinion 카드 UI 재설계**(설계자 지시, 2026-09-21, `docs/
  plan-qa-card-redesign.md` 완료) - `DocumentDiscussion.vue`(문서
  임베드 패널)/`DocumentThreadPage.vue`(계층 드릴다운 페이지) 둘 다
  카드 레이아웃을 좌측 상단 타입뱃지+**제목**(있는데도 화면에 전혀
  안 보여줬던 실제 버그)/우측 상단 상태뱃지→작성자뱃지→more(⋮)
  아이콘으로 재배치했다. more 메뉴(`q-menu`)에 "자식 항목 보기"/
  "확인함"/"답변 작성"/"폐기"/"완료 처리"를 상태별 조건(모두
  `documentRules.ts`의 `checkTransition` 그대로 UI에 반영 - 실제
  허용 여부는 언제나 서버가 최종 판단)에 맞춰 모았다. 본문은
  `frontend/src/utils/renderMarkdown.ts`(`marked.parse` +
  `DOMPurify.sanitize`)로 렌더링 - marked v18은 자체 sanitize
  옵션이 없어져서 새 `v-html` 바인딩마다 DOMPurify를 직접 거친다.
  **새로 노출한 것**: (1) architect가 재질의로 만든 question의
  "폐기"(`documentRules.ts`상 진작 가능했는데 UI에 없었다), (2)
  "완료 처리"(answer read→done, `canMarkAnswerDone`: `answer.author
  === 'agent' && answer.state === 'read'`) - "architect가 재질의,
  agent가 답변"하는 흐름에서 그 답변을 architect가 완결 처리하는
  유일한 경로. **완료 처리 구현 중 발견한 2차 버그**: read→done만
  넣고 그 앞 단계 added→read("확인함")를 answer에도 노출해야 한다는
  걸 놓쳤다 - `documentRules.ts`상 이 read 전이도 "질의자(=answer
  작성자의 반대 채널)"만 할 수 있어서 answer.author==='agent'면
  architect(WEB UI)가 직접 눌러줘야 하는데, 그 버튼이 없으면
  "완료 처리" 자체가 영원히 도달 불가능한 죽은 기능이 된다 - 두
  컴포넌트 모두 answer 카드(및 스레드 페이지에서 kind==='AN'인
  item/child)에 "확인함"을 추가해서 고쳤다. **실기동 검증**(로컬
  dev 스택 기동 + CLI를 agent 채널로 써서 실제 질문→답변 흐름
  재현): architect 질문(QU-V5SRP63P) → CLI로 agent 답변
  (AN-C744MXDG, 마크다운 `**bold**`+리스트 본문 포함) → 웹 UI에서
  "확인함"→"완료 처리" 클릭 → 답변이 done되며 질문도 cascade로
  done, 두 카드 모두 more 아이콘 소멸 확인 - `DocumentThreadPage.vue`
  에서도 별도 시나리오(QU-FRX6TCEW/AN-38VKAM7J)로 동일하게 재현.
  마크다운은 실제 DOM에서 `<strong>`/`<ul><li>`로 렌더링되는 것까지
  확인(단, yiitap 컴포저에 타이핑한 리터럴 `**text**`는 turndown이
  일반 텍스트로 보고 그대로 escape하므로 렌더링 안 됨 - 툴바 Bold
  버튼으로 만든 실제 강조 마크나 CLI로 등록한 원문 마크다운에서만
  기대대로 동작하며, 이는 이번 라운드의 회귀가 아니라
  `MarkdownSourceView` 전체의 기존 동작이다).
- **계정 관리**(설계자 지시, 2026-09-21, `docs/plan-account-management.md`
  완료) - `v2` 브랜치 조사 결과 "시스템 전체 Admin(superAdmin)은
  별도 role 없이 부트스트랩 계정(username `"admin"`)을 그대로
  최고 관리자로 취급"하는 패턴과 "admin 대행 임시 비밀번호 재설정
  (강제 변경 없음)" 정책을 그대로 계승했고(`backend/src/core/auth.ts`의
  `isSuperAdmin()`), 계정 비활성화/삭제는 v2에도 선례가 없어 순수
  신규 설계(설계자 확인: 강제 변경 없음 + 삭제 시 콘텐츠 보존)로
  진행했다. `Account.disabledAt`(로그인 거부 사유) 추가,
  `backend/src/core/accounts.ts`(신규)의 `account.list`/
  `changePassword`/`resetPassword`/`disable`/`enable`/`delete` -
  `disable`은 `disabledAt` 설정과 동시에 기존 `ApiKey`를 전부
  삭제해 즉시 로그아웃시킨다. `ProjectMembership`/`ProjectInvite`/
  `ApiKey`/`RememberItem`/`Template`은 그 계정 자신의 소유물이라
  `onDelete: Cascade`로 계정과 함께 사라지고, `Project.creator`는
  일부러 그대로 둬(기본 Restrict) 계정 삭제가 그 사람이 만든
  프로젝트 콘텐츠까지 통째로 지우지 못하게 막는다. **실기동 검증
  중 발견한 버그**: 이 "콘텐츠 보존" 정책을 지키려면 프로젝트
  생성자를 다른 계정으로 넘기는 방법이 있어야 하는데, 기존
  `project.transfer`는 Admin **역할**만 옮길 뿐 `creatorAccountId`
  (URL `/{생성자}/{project id}`의 그 필드)는 절대 안 바꾼다는 걸
  재확인해서 - `project.transferOwnership`(신규 액션)을 추가해
  실제로 소유권(및 URL)을 옮기게 했다. **2차로 발견한 버그**:
  소유권만 옮기고 `ProjectMembership`의 ADMIN 역할은 그대로 두면
  그 계정을 지우는 순간 그 멤버십 행이 cascade로 같이 사라져
  그 프로젝트에 Admin이 한 명도 안 남는 사고가 실제로 재현됐다 -
  `account.delete`가 "생성한 프로젝트"뿐 아니라 "ADMIN으로 남아있는
  프로젝트"도 검사해서 둘 다 해소해야만 삭제를 허용한다. 프론트엔드는
  `MainLayout.vue` 상단바 아바타 메뉴(비밀번호 변경/계정 관리),
  `components/ChangePasswordDialog.vue`(셀프 비밀번호 변경),
  `pages/AccountsPage.vue`(`/accounts`, superAdmin 전용 계정
  목록+재설정/비활성화/활성화/삭제), `settings/GeneralPage.vue`
  Danger Zone에 "소유자(생성자) 변경" 카드 추가. 실기동으로 계정
  생성→재설정→로그인→비활성화→로그인 거부+apiKey 무효화→활성화→
  로그인 복구→(소유권/Admin 역할 이전 후)삭제까지 전 구간과
  superAdmin 자기 자신에 대한 disable/delete 거부를 CLI/REST/웹
  UI 모두에서 확인했다.
- **닉네임 정책 + API 키 세분화**(설계자 지시, 2026-09-21, `docs/
  plan-nickname-apikey-policy.md` 완료) - Phase 0 스캐폴딩부터
  TODO로 남아있던 v2 정책 계승 항목. `v2` 조사로 둘 다 충분히
  구체적인 기존 정책을 확인해 그대로 이식했다: **닉네임**은
  `Account.nickname`(중복 허용)+`nicknameNumber`(같은 문자열, 또는
  미설정 시 공통 풀 "설계자" 안에서의 순번 - 그 라벨로 바뀌는
  시점에만 `nextNicknameNumber()`로 재계산해 확정 저장, 매 조회마다
  다시 세지 않음)+`nicknameChangedAt`(7일 쿨다운, 같은 값 재제출은
  안 먹음)로 표시 라벨("Jay #1" 등)을 구성한다. **API 키**는
  `scope: "personal"`(로그인과 동등, 무제한)/`"project"`(그 프로젝트
  안에서만)로 나뉘고(v2의 "팀 키"는 v3에 팀이 없어 제외), 로그인이
  발급하는 키는 항상 personal이다. **스코프 강제는 v2의
  `requestScope.ts`(`AsyncLocalStorage`) 패턴을 그대로 계승** -
  `authMiddleware.ts`가 요청마다 키의 스코프를 판별해 `req.keyScope`
  에 싣고, `api/server.ts`(`/api/actions`)와 `api/rest.ts`(`web()`)
  둘 다 핸들러 실행 전체를 `runWithKeyScope()`로 감싸며,
  `membership.ts`의 `requireMembership()` 최상단에서 "이 요청이
  project 스코프 키로 인증됐는데 그 키가 발급된 프로젝트가 아니면"
  실제 멤버십 존재 여부와 무관하게 즉시 거부한다 - 액션 핸들러
  수십 개 전체(문서/PR/repo/webhook/template/remember 등)에 개별
  체크 없이 자동 적용되는 단일 choke point. `account.*`(계정 관리)
  와 `project.create`는 애초에 "특정 프로젝트로 좁힐 수 없는 시스템
  전체 동작"이라 restricted 스코프 키 자체를 별도로 거부한다. API
  키는 하드 삭제 대신 `revokedAt` soft-revoke(감사 기록 보존, v2
  판단 계승)이고, project 키는 그 프로젝트 Admin이 남의 것도 배제할
  수 있다. **실기동 검증**(curl+CLI+웹 UI) - project 키가 실제로
  다른 프로젝트에는(그 계정이 그 프로젝트의 진짜 멤버여도) 거부되는
  것, `account.list`/`project.create`가 project 키로는 아예 거부
  되는 것, Admin이 배제한 남의 project 키가 즉시 401로 막히는 것,
  닉네임 풀 번호가 실제로 순차 증가하고 7일 쿨다운이 걸리는 것까지
  전 구간 확인. **실기동 중 발견한 버그**: `pages/ApiKeysPage.vue`를
  처음 `/api-keys`에 연결했더니 Vite dev 프록시(`quasar.config`의
  `"/api": {...}`, 문자열 접두사 매치)가 "/api-keys"도 "/api"로
  시작한다며 백엔드로 그대로 포워딩해버려 화면 자체가 안 떴다
  ("Cannot GET /api-keys") - 프론트 라우트를 `/keys`로 바꿔 피했다.
  프론트엔드는 `MainLayout.vue` 상단바에 표시 라벨 노출 + 아바타
  메뉴에 "닉네임 변경"/"API 키 관리" 추가, `components/
  NicknameDialog.vue`(신규), `pages/ApiKeysPage.vue`(신규, `/keys`),
  `settings/GeneralPage.vue`에 그 프로젝트로 발급된 API 키 목록
  (Admin 전용) 카드 추가.
- **Gitea 실제 프로비저닝**(설계자 지시, 2026-09-21, `docs/
  plan-gitea-provisioning.md` 완료) - Phase 5/6 완료 기록에서
  "다음 라운드 과제"로 명시적으로 남겨뒀던 항목. `v2` 조사 결과
  v2는 Gitea 자체가 주 저장소라 설계자별 그림자 Gitea 계정까지
  필요했지만, v3는 이미 로컬 es-git 저장소가 주 저장소고 Gitea는
  옵션 push-mirror 대상일 뿐이라 그 부분은 대상이 아니었다 - "프로젝트
  당 org 하나"(`orgForProject(projectId)`, DB 컬럼 없는 순수 함수)와
  "`project.create`가 아니라 명시적 연결 시점에 생성"이라는 v2 정책
  두 가지만 계승했다. `backend/src/core/gitea.ts`(신규, org/저장소
  멱등 생성 - `auto_init:false` 필수, 아니면 Gitea가 미리 커밋해둔
  기본 브랜치와 로컬 첫 push가 갈라짐)와 `repo.connectGitea`(신규
  액션, `core/repo.ts`, Admin 전용) - 호출 시 그 프로젝트의 org+저장소
  를 만들고 `Project.pushMirrorUrl`을 **자격증명을 절대 심지 않은
  채로** 채운다(공유 Gitea 토큰을 URL에 심으면 `project.get` 응답이
  그 URL을 그대로 노출해 READ 권한자 - public 프로젝트면 비멤버까지
  - 누구나 시스템 전체 토큰을 가져갈 수 있게 된다는 걸 인지하고 막은
  설계). 대신 `gitRepo.ts`의 `pushToMirror`가 push 시점에만 그 URL이
  설정된 `GITEA_URL` 소속일 때 es-git `PushOptions.credential`
  (`{type:'Plain', username:token, password:''}`)로 메모리 상에서만
  자격증명을 얹는다. **실기동 중 발견한 버그 두 개**: (1) es-git
  (libgit2)은 `http://token@host/...`처럼 URL에 심은 자격증명으로
  인증하지 못한다(순수 git CLI는 되는데 es-git은 401 - `credential`
  옵션을 명시적으로 줘야 함, 오히려 이 발견 덕에 "토큰을 URL에 안
  심는다"는 보안 설계와 자연히 맞아떨어졌다), (2) `GITEA_URL`이
  그 Gitea의 실제 `ROOT_URL`과 문자열까지 정확히(`localhost`
  vs `127.0.0.1`도 다르게 취급됨) 일치해야 한다 - 안 그러면 토큰
  주입 조건(origin 비교)이 조용히 안 맞아서 401만 나고 원인을 알기
  어렵다. es-git엔 remote 삭제/URL 변경 API 자체가 없어서(`index.d.ts`
  확인) push-mirror 대상이 바뀌는 시나리오는 `.git/config`의
  `[remote "mirror"]` 섹션 `url=` 줄만 직접 치환(`upsertMirrorRemoteUrl`)
  하는 방식으로 해결했다(이 저장소가 child_process로 git CLI를
  셸아웃하는 선례가 없어 그 관례를 깨지 않는 선택). 실기동 검증은
  이 저장소 전용의 새 Gitea 컨테이너(`docker-compose.dev.yml`에
  `cnw-v3-dev-gitea`, 이미지 `gitea/gitea:1.22`, sqlite3, 호스트
  포트 13000 - `docker ps`에 있던 `cnw-gitea-1`은 이 저장소와 무관한
  `C:\CNW`의 별도 운영 설치 컨테이너임을 확인하고 절대 안 건드림)
  를 새로 띄워서 했다 - `repo.connectGitea` 호출 → 실제 org/저장소
  생성 확인 → `repo.push` → 실제 커밋이 그 저장소에 반영된 것까지
  Gitea REST API로 직접 확인, push-mirror 대상 변경 시나리오와
  재연결(멱등)도 재확인. 프론트엔드는 `settings/GeneralPage.vue`에
  "Gitea에 자동 연결" 버튼 추가(Admin 전용, 성공 시 push-mirror
  URL 입력창이 즉시 채워짐).
- **후속 처리 두 가지**(설계자 지시, 2026-09-21 같은 날 후속, `docs/
  plan-gitea-provisioning.md`에 기록) - (1) `project.destroy`가
  DB 삭제 직후 그 프로젝트의 Gitea org도 정리한다(`gitea.ts`의
  `deleteOrgIfExists()`, fail-soft - org 안 저장소를 전부 먼저
  지운 뒤 org를 지운다, Gitea가 저장소 남은 org의 삭제는 거부하는
  걸 실기동으로 확인해서 그 순서로 구현). (2) `project.get`/`list`
  가 `pushMirrorUrl`을 READ 권한만 있으면(공개 프로젝트면 비멤버
  에게도) 그대로 노출하던 것을 Admin에게만 보이도록 좁혔다
  (`toProjectResponse()`가 `viewerRole`을 받아 `"ADMIN"`이 아니면
  그 필드 자체를 응답에서 뺀다) - 실기동으로 Admin/WRITE 멤버/
  완전 비멤버(public 프로젝트) 세 시점에서 WRITE·비멤버 둘 다
  그 필드가 응답에 아예 안 실리는 것까지 확인했다.
- **남은 소규모 후속 처리 네 가지**(설계자 지시, 2026-09-21 같은
  날 후속) -
  1. **API 키 superAdmin 강제 배제**(`docs/plan-nickname-apikey-policy.md`)
     - 본인도 그 프로젝트 Admin도 아닌 경우를 위해 superAdmin이
     아무 키나 강제 배제할 수 있는 경로를 `apiKeys.ts`의
     `apiKeyRevoke`에 추가(project 스코프로 제한된 키로는 이 경로
     자체를 못 씀 - `accounts.ts`의 `requireSuperAdmin`과 같은 원칙).
  2. **템플릿 배포 커밋 author를 실제 계정 식별자로** - Phase 7
     완료 기록에서 "실제 계정 정보를 아직 노출 안 함, 원하면 다음
     라운드에 옵션으로"라고 남겨뒀던 것. `Account`에 v2와 달리
     실제 개인 이메일 필드가 아예 없고(username만) 그마저 이미 UI
     전반에 공개돼 있어 노출 우려가 사실상 없어졌다고 판단해 -
     `templates.ts`의 `templateDeploy`가 `ctx.channel`("agent"/
     "architect") 대신 그 계정의 표시 라벨(닉네임 정책)을 커밋
     author 이름으로 쓴다(예: `Jay #1 <admin@cnw.local>`) - 실기동
     으로 실제 커밋의 `git log`에 반영되는 것 확인.
  3. **머지 커밋 "첫 부모" 정확도** - `gitRepo.ts`의
     `getApproxParentCommitId`(이름 자체가 "근사"였다)가 es-git
     `Commit`에 parent 접근자가 없어 Revwalk를 시간순으로 훑어
     "바로 다음 것"을 부모로 근사했는데, **`Revwalk.simplifyFirstParent()`**
     (첫 부모 아닌 조상은 아예 큐에 안 넣음)가 있다는 걸 재확인해서
     `getFirstParentCommitId`로 정확하게 고쳤다. 별도 임시 저장소로
     재현 검증한 결과 기존 근사 로직은 생각보다 더 심각한 버그였다 -
     같은 타임스탬프로 빠르게 연속 커밋되면(이 앱의 흔한 패턴) 시간
     정렬이 동률 처리하면서 **머지 커밋의 부모조차 아닌 조상**을
     반환하는 경우까지 실제로 재현됐다(단순히 "머지의 두 부모 중
     잘못된 쪽"이 아니라 아예 무관한 커밋). 새 구현은 같은 재현
     조건에서 정확한 첫 부모를 반환하는 것까지 확인.
  4. **대용량 파일 diff "너무 커서 못 봄" 처리** - 512KB(`BLOB_SIZE_LIMIT`)
     를 넘는 텍스트 파일은 `readFileAtRef`가 이미 `content: ""`로
     잘라 돌려주고 있었는데, `repoDiffFile`/`DiffViewer.vue` 둘 다
     이 신호를 그냥 버려서 "파일이 너무 큼"이 "파일 전체가 삭제/
     추가됨"으로 잘못 보이는 게 실제 버그였다(design-notes.md엔
     "클라이언트 diff 계산 비용" 성능 우려로만 적혀 있었지만 실은
     이미 벌어지고 있던 정확성 버그였다). `oldTooLarge`/`newTooLarge`
     필드를 추가해 `isBinary`와 같은 자리에서 안내 문구로 먼저
     걸러내고, 그 상태에선 "Raw Content 다운로드" 버튼도 비활성화
     한다(빈 내용을 받게 되는 걸 막음 - 원본을 다시 가져오는 별도
     raw 엔드포인트는 이 라운드 범위 밖). 실기동으로 600KB 테스트
     파일을 실제 커밋해 그 진단 문구와 다운로드 버튼 비활성화를
     확인 후 커밋을 되돌려 정리했다. 서버 사이드 diff 청크 API
     자체(수만 줄 파일의 클라이언트 계산 비용 완화)는 이 저장소에
     그 정도 크기 파일이 없어 검증할 방법이 없고, 도입하면 지금의
     "왕복 없이 즉시 펼침/접힘"이라는 UX 이점을 실제로 깎아먹는
     트레이드오프라 이번에도 보류했다(가상의 시나리오를 위해 설계
     하지 않는다는 원칙).
- **전체 시스템 QA**(설계자 지시, 2026-09-21, `docs/plan-full-qa.md`
  완료) - `backend/src/api/actions.ts`의 액션 64개 전부와 프론트엔드
  전 라우트를 12개 섹션으로 나눠 순서대로 실기동 점검했다(기능별로
  막 구현한 직후에만 검증해온 지금까지와 달리, 여러 라운드를 거친
  지금 시점의 전체 시스템을 한 번에). 그 자리에서 발견하고 바로
  고친 버그 4건: (1) **Code 탭 파일 뷰어가 512KB 초과 텍스트
  파일을 빈 파일처럼 표시** - diff 뷰어(Gitea 라운드에서 이미 고침)
  와 달리 `CodeTab.vue`는 같은 크기 초과 신호(`size`/`content`)를
  전혀 안 쓰고 있었다 - 같은 방식으로 안내 문구 분기를 추가. (2)
  **CLI/MCP에 `repo.commitDiff`/`diffFile`/`fileCommits`/`commitInfo`
  4개 액션이 아예 없었음** - REST에만 노출되고 CLI/MCP 등록을
  빠뜨렸던 것, 스크립트로 registry 대 CLI/MCP 목록을 전수 대조해
  발견 - 둘 다 추가. (3) **`docs auth login`이 기존
  `.cnw/config.json`이 노후 스키마(예: `owner` 필드 없음)면 그
  이유로 로그인 명령 자체도 크래시** - "다시 로그인하라"는 자기
  에러 메시지가 실행 불가능한 자기모순이었다 - 기존 설정 읽기를
  try/catch로 감싸 실패하면 없는 것으로 취급하도록 수정. (4) **이
  저장소 자신의 dogfooding MCP 연결(`mcp/.cnw/config.json`, git에
  커밋된 파일)이 바로 그 (3)번 이유로 끊겨 있었음** - `.mcp.json`
  으로 이 세션 자체가 이 저장소의 MCP 서버에 연결돼야 하는데
  "CONNECTION_CLOSED" 상태였던 걸 원인 추적 끝에 발견, (3)번을
  고친 뒤 재로그인해서 복구(git에 커밋된 설정 파일도 갱신). 나머지
  8개 섹션(인증/계정/프로젝트/문서/Q&A/Trackers/Remember·Message/
  PR/Templates·Webhooks/Gitea)은 전부 실기동 재확인 결과 정상 -
  webhook HMAC 서명은 실제 로컬 HTTP 리스너로 바이트 단위까지
  검증했고, 머지 커밋 "첫 부모" 정확도는 격리된 임시 저장소뿐
  아니라 실제 운영 데이터(기존 병합 PR)로도 재확인했다. **부수
  발견**: `read_console_messages`가 그 브라우저 탭이 열려 있던
  전체 세션 기간의 누적 로그를 돌려준다는 것(새로고침해도 오래된
  에러가 그대로 다시 나옴)을 실증 - 다음 세션이 오래된 로그를 새
  버그로 오인하지 않도록 기록해둔다.

## 프론트엔드 UI 일관성 정리 (PL-PLANFEUI, 2026-09-22)

설계자 피드백("탑바/탭은 좋은데 그 외엔 땜빵식") 이후 실제 코드
감사 결과를 바탕으로 여러 화면에 흩어져 있던 헤더/다이얼로그/폼/
빈 상태/색 패턴을 공용 컴포넌트로 정리했다. **새 화면을 추가할 때는
아래 컴포넌트를 재사용한다 - 각 페이지가 헤더/빈 상태를 직접
마크업하지 않는다**:

- **`components/PageHeader.vue`**: 페이지 최상단 제목 영역.
  `variant="page"`(단독 페이지, `text-h5` - 예: Projects/Accounts/
  API 키), `variant="section"`(탭 콘텐츠 제목+카운트+액션 슬롯 -
  예: Documents/Plans/Issues/Trackers/PR 목록), `variant="detail"`
  (뒤로가기 화살표+`text-h6` - `backTo`(고정 라우트) 또는
  `onBack`(핸들러, 예: `router.back()`) 중 하나만 지정 - 예: 문서
  작성/PR 작성/Q&A 스레드/브랜치 커밋 목록), `variant="settings"`
  (`text-subtitle1` 단독 라벨 + 선택적 `caption` - 예: 프로젝트
  설정 하위 페이지들) 네 가지.
- **`components/EmptyState.vue`**: 빈 목록 안내 문구.
  `as="item"`(q-list 안, `<q-item>`으로 렌더링)/`as="div"`(목록
  밖) + `message` prop.
- **`components/ConfirmDestroyDialog.vue`**: "이름을 직접 입력해야
  확정되는" 삭제 확인 다이얼로그(계정 삭제/프로젝트 파기 등) -
  `title`/`bodyText`/`confirmValue`/`confirmLabel`/`actionLabel`
  prop + `confirm` emit.
- **`frontend/src/utils/fileTree.ts`**: 평평한 파일 경로 배열을
  `q-tree`용 트리 구조로 바꾸는 `buildFileTree()` - PR diff/커밋
  diff 화면이 공유한다.
- **`app.scss`의 페이지/다이얼로그 폭 토큰**: `--gh-page-width-narrow`
  (720px, 계정/키 관리 등 리스트형), `--gh-page-width-wide`(900px,
  문서 작성/스레드 등 에디터형), `--gh-dialog-width-sm/md/lg`
  (360/420/480px) - 새 페이지/다이얼로그의 `max-width`/`width`는
  이 토큰을 쓴다(리터럴 px 값을 새로 만들지 않는다).
- 다이얼로그의 취소/닫기 버튼 라벨은 **"취소"로 통일**(모든
  다이얼로그가 "확정 지을 동작" 옆에 있다고 보고 "닫기" 대신
  "취소"를 쓰기로 결정).

의도적으로 이번 라운드에서 손대지 않은 것(별도 계획으로 미룸,
`docs/plan-frontend-consistency.md` 참고): `PullRequestsTab.vue`의
목록+상세 분할 패널 구조를 `DocTypeWorkspace.vue`와 통합하는 것,
`DocumentDiscussion.vue`/`DocumentThreadPage.vue`의 중복된 Q&A
카드 렌더링을 공용 컴포넌트로 추출하는 것 - 둘 다 과거 회귀 이력이
있는 민감한 영역이라 별도 검증 라운드가 필요하다고 판단했다.

## 프론트엔드 컴포넌트 관례

`frontend/`의 모든 Vue 컴포넌트는 아래를 명시적으로 지킨다(예시:
`frontend/src/components/ProjectCard.vue`):

- TypeScript, `<script setup lang="ts">`.
- props는 런타임 선언이 아니라 **`defineProps<{ ... }>()`**로.
- 기본값이 있는 props는 **`withDefaults(defineProps<{...}>(), {...})`**
  로 감싼다.
- v-model 바인딩은 수동 `modelValue` prop + `emit` 대신
  **`defineModel<T>()`**를 쓴다.
