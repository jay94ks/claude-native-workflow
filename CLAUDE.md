# CLAUDE.md

## 이 저장소에 대하여

claude-native-workflow 자신의 저장소다. **`v3` 브랜치는 밑바닥부터 다시
시작하는 새 구현**이다. 이전 구현들은 참고용으로만 별도 브랜치에
보존돼 있다 - 서로 다른 시스템이니 섞어서 참고하지 않는다:

- `v2` - 직전 구현(단일 설치형, DB 기반 문서/워크플로우 관리 시스템).
- `concept` - 그 이전 3단계(Tier1/2/3) 구현.

`v2`/`concept`의 코드나 설계는 **참고 자료일 뿐**이며, `v3`가 그대로
이어받아야 할 의무는 없다. 필요하면 해당 브랜치를 열어 확인하되, 이
문서와 앞으로의 설계는 `v3` 자체의 판단으로 새로 정한다.

아직 이 저장소를 관리하는 claude-native-workflow 설치가 정해지지
않았다면, 문서/설계 기록은 우선 git 저장소 `docs/` 디렉토리에 파일로
남기고, 설치가 갖춰지면 그때 이관 여부를 판단한다. `docs/index.md`에
그 안의 문서 목차를 유지한다 - 새 문서를 추가하면 반드시 이 인덱스에도
항목을 추가한다.

**`docs/` 아래 각 문서 파일은 마이그레이션을 대비해 설계 중인 문서
엔티티 모델과 구조를 맞춘다** - 최상단에 `id`/`parent_id`/`type`/
`kind`/`state`/`branch`/`commit_id`/`title`/`author`/`related` 필드를
가진 YAML frontmatter를 두고(하위 문서가 아니면 `parent_id: null`),
`## 라운드 N` 같은 절 구분을 그 문서의 챕터로
취급한다(질의는 해당 챕터를 가리켜서 단다). `branch`/`commit_id`는
아직 커밋되지 않은 내용이면 둘 다 `null`로 둔다(설계상 "초기
설계용"과 동일한 신호) - 실제로 커밋된 뒤에는 그 커밋의 branch/
commit_id로 갱신한다.

## 프로젝트 구조 (v3 스케폴딩)

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

`docs/design-notes.md`의 "구현 로드맵"(Phase 0~9)을 **전부
완료**했다:
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
  지킴)뿐 아니라 DB 부분 unique 인덱스로도 이중 강제**한다(설계자
  요청, 2026-09-21 후속) - `CREATE UNIQUE INDEX ... ON
  "ProjectMembership" ("projectId") WHERE ("role" = 'ADMIN')`,
  Prisma 스키마 DSL이 부분 인덱스를 표현 못 해 마이그레이션 SQL에
  직접 작성(`backend/prisma/migrations/
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
  판단(설계자 명시적 요청). `pages/project/DocCreatePage.vue`
  (doc/plan/issue 공용, `type`/`kinds`/`createLabel`/`listRoute`/
  `allowChapter` props로 재사용)과 `pages/project/PrCreatePage.vue`
  가 `MarkdownSourceView`(hideToolbar)로 본문/설명을 받는다.
  **"뭔가를 선택하는 동작"(참조/태그 추가, 브랜치 선택 등)은 계속
  다이얼로그로 남긴다** - 페이지 분리 대상은 새 엔티티 작성뿐이다.
  질문하기/답변 작성/의견 남기기(`DocumentDiscussion.vue`)는 그
  문서에 종속된 짧은 댓글 성격이라 페이지로 안 빼고 다이얼로그는
  유지하되 안의 입력창만 `MarkdownSourceView`(hideToolbar)로
  바꿨다. **버그**: 처음엔 컴포넌트 자체의 `@save` 이벤트(내부
  "저장" 버튼을 눌러야 emit)로 부모 상태를 채우는 방식으로 짰는데,
  사용자는 실제로 페이지/다이얼로그의 "만들기"/"등록" 버튼만
  누르므로 본문이 항상 빈 문자열로 제출되는 버그가 있었다(PR
  생성 후 `pr.list`로 description이 비어있는 걸로 확인) -
  `hideToolbar` 모드에선 제출 시점에 부모가 `ref.getMarkdown()`을
  직접 호출해 현재 편집 중인 내용을 가져가는 방식으로 고쳤다.
- **Code/Pull requests/Issues/Documents/Trackers/Settings 좌측
  패널은 전부 270px 고정폭 공용 컴포넌트(`components/
  ProjectSidebar.vue`)를 쓴다** - 1024px 미만에서는 오프캔버스로
  바뀌고(`stores/ui.ts`의 `sidebarOpen` 전역 상태), `MainLayout.vue`
  로고 좌측 햄버거(프로젝트 화면일 때만 보임)로 토글한다. 라우트가
  바뀌면 `ProjectSidebar.vue` 자신이 자동으로 닫아준다. **탑바의
  "Settings" 버튼(탭과 별개로 있던 것)은 삭제됐다** - Settings
  **탭** 자체는 유지. **Collaborators/Template은 독립 탭에서
  Settings 탭 안 좌측 메뉴(기본 설정/Collaborators/Template)로
  통합**됐다 - `layouts/SettingsShell.vue`(신규, 자체 270px
  `ProjectSidebar` + `router-view`)와 `pages/project/settings/
  {General,Collaborators,Template}Page.vue`(구
  Settings/Collaborators/TemplateTab.vue를 옮김) -
  `routes.ts`의 `settings` 라우트 아래 `general`/`collaborators`/
  `template` 세 자식 라우트로 재구성(빈 경로는 `general`로 리다이렉트).
  Documents 탭 우측에 있던 About 카드(`ProjectAboutSidebar.vue`)는
  Code 탭 좌측 패널 맨 위로 옮겼다(프로젝트 진입 시 첫 화면이 Code라
  About이 가장 먼저 보여야 한다는 판단).
- **버그(심각) 발견: `MarkdownSourceView.vue`가 `YiiEditor`의
  `extensions` prop을 한 번도 넘긴 적이 없었다** - 그 prop의 문서
  주석은 "기본으로 BuiltinExtensions를 켠다"지만, 컴파일된
  `node_modules/@yiitap/vue/dist/index.mjs`를 직접 까보면 실제
  기본값은 빈 배열이고 내부 베이스 에디터도 codeBlock/blockquote/
  horizontalRule/link/document를 명시적으로 꺼둔 채 만들어진다 -
  즉 이 prop 없이는 codeBlock/blockquote/horizontalRule/link
  툴바 버튼이 **눌러도 아무 일도 안 일어났다**(버튼은 보이지만 그
  노드/마크가 에디터 스키마에 없어서, 예를 들어 코드 블록 버튼을
  눌러도 그냥 일반 문단이 되고 여러 줄 텍스트는 `<p><code>줄1<br>
  줄2</code></p>`처럼 인라인 code+수동 줄바꿈으로 뭉개졌다). Code
  탭 파일 편집기를 yiitap으로 바꾸다가 이 현상을 실제로 목격하고
  DOM을 까봐서 발견했다. **`@yiitap/vue`가 공개 export하는
  `OStarterKit.configure(options)`**(`@yiitap/vue-preset`은 이름과
  달리 `export default {}`뿐인 빈 메타 패키지라 쓸모없었음)를
  `extensions` prop으로 넘기도록 고쳤고, 동시에 그 옵션으로
  마크다운과 안 맞는 기능(BackgroundColor/Color/FontFamily/
  Highlight/TextAlign/TextStyle/Typography/OCallout/OTable/
  Subscript/Superscript/Focus)은 확장 자체를 꺼서 제외했다(main-menu
  에서 버튼만 숨기는 것보다 확실함 - 슬래시 커맨드 등 다른 경로로도
  못 들어옴). **이 라이브러리를 다룰 땐 `.d.ts`/문서 주석을 곧이
  곧대로 믿지 말고 컴파일된 `dist/index.mjs`를 직접 grep해서 실제
  기본값/동작을 확인해야 한다**(이번에 `showMainMenu` 등 다른 prop
  기본값도 이 방식으로 재확인했음). 이 수정 하나로 `MarkdownSourceView`
  를 쓰는 모든 곳(Documents/Plans/Issues/Trackers Source View, PR
  설명, Template, Discussion 작성창)이 동시에 고쳐졌다.
- **에디터 툴바(main menu)는 항상 보이고, 보기 모드에선 비활성
  (회색+클릭 차단), 편집 모드에선 활성**이다(설계자 요청) -
  `MarkdownSourceView.vue`가 보기 모드일 때 `.source-view-toolbar-
  disabled` 클래스로 `:deep(.o-main-menu)`에 `pointer-events: none;
  opacity: .45`를 건다(`editable: false`여도 yiitap 커맨드는
  프로그래매틱으로 실행되므로 CSS로 완전히 막아야 함). main-menu
  항목 목록도 `MARKDOWN_MAIN_MENU`(bold/italic/heading/blockquote/
  codeBlock/link/list-dropdown/horizontalRule/emoji 등)로 커스텀
  했다 - 위 extensions 커스터마이징과 짝을 맞춘 목록.
- **Code 탭의 파일 뷰어/에디터도 yiitap 기반**이다 - `.md`가 아닌
  파일은 펜스 코드 블록(` ```lang ... ``` `)으로 감싸 넣고(yiitap이
  근본적으로 마크다운/리치텍스트 에디터라 원문을 그대로 넣으면
  공백/들여쓰기가 문단으로 뭉개짐 - 펜스 코드 블록만이 공백을
  보존하는 마크다운 구조) 저장 시 다시 벗겨 `repo.writeFile`로
  커밋한다(`CodeTab.vue`의 `wrapAsCodeFence`/`unwrapCodeFence`).
  marked→turndown 코드 블록 왕복에서 파일 끝 줄바꿈이 하나
  없어지는 경우가 있어(Node 스크립트로 직접 재현) 원본이 `\n`으로
  끝났으면 저장 직전에 되돌려준다.
- **PR 설명도 Source View로 렌더**한다 - `pr.update` 액션(설계자
  요청, 2026-09-21 후속)으로 **PR이 `open` 상태인 동안은 수정
  가능**하다(WRITE 멤버십 필요) - `backend/src/core/pullRequests.ts`
  의 `prUpdate`, REST `PATCH /projects/:owner/:projectId/pull-requests/:id`,
  CLI `pr update`, MCP `docs_action`에 노출. merged/closed된 PR은
  여전히 읽기 전용(그 시점 내용과 달라 보이면 오해를 부르므로) -
  `PullRequestsTab.vue`가 `MarkdownSourceView`의 `read-only`를
  `selected.state !== 'open'`으로 바꿔 기존 view/edit 토글+저장
  버튼을 그대로 재사용한다.
- **WEB REST API**(설계자 지시, 2026-09-21): "/api/actions 단일
  엔드포인트"는 CLI/MCP를 위한 설계였지 WEB UI까지 몰아넣을 필요는
  없다는 지적에 따라, `backend/src/api/rest.ts`(신규)에 프로젝트/
  문서/repo/PR/메시지/웹훅/템플릿/remember 전 영역의 REST 엔드포인트
  (GET/POST/PATCH/PUT/DELETE, 자원 기반 경로)를 만들고 WEB UI는
  이걸 쓴다 - **core/*.ts의 액션 핸들러는 전혀 안 건드리고 그대로
  재사용**한다(`rest.ts`의 `web()` 헬퍼가 req.params/query/body를
  그 핸들러의 payload 모양으로 조립해 호출, 성공은 `data`를 그대로
  200/201, 실패는 `{error: string[]}` + 422/401/500). notices
  piggyback은 응답 바디 대신 `X-Cnw-Notices`(base64 JSON) 응답
  헤더로 옮겼다. `/api/actions`는 그대로 남아있고 CLI/MCP는 전혀
  안 바뀌었다(`X-Cnw-Channel: agent`로 여전히 정상 동작 확인함).
  `frontend/src/api/client.ts`를 자원별 함수 40여 개로 새로 썼고
  (`stores/auth.ts`의 `run`/`runBulk`는 삭제), 각 함수가 기존과
  똑같은 `{ok, data}`/`{ok:false, reason}` 모양을 돌려주게 만들어서
  14개 파일 53개 호출부를 옮기면서도 컴포넌트 로직 자체는 거의
  안 바뀌었다.
- **PR/커밋 diff 뷰어**(설계자 지시, 2026-09-21) - `components/
  DiffViewer.vue`(신규, PR 상세/`pages/project/CommitDiffPage.vue`
  가 공유)가 파일 하나를 좌(변경 전)/우(변경 후) 분할해서 보여준다.
  라인 단위 diff 계산(`diff` npm 패키지 `diffLines` + ±6줄
  컨텍스트만 보이고 나머지는 "변경되지 않은 코드 보기"로 접기)은
  **서버가 아니라 클라이언트**(`frontend/src/utils/lineDiff.ts`)가
  한다 - 서버는 그 파일의 두 시점 전체 내용만 주고, 접기/펼치기는
  브라우저가 이미 가진 내용으로 즉시 처리(왕복 없음). 이미지는
  변경 전/후 미리보기, 그 외 바이너리는 "Raw Contents"만 표시.
  툴바 우측 "코드 트리에서 보기"/"Raw Content 다운로드" 버튼.
  백엔드는 `gitRepo.ts`에 `readFileAtRef`(branch/커밋 id 둘 다 받는
  ref 통일)/`readBlobRawAtRef`/`diffCommit`(커밋 대 그 부모 -
  es-git `Commit`엔 parent 접근자가 없어 Revwalk로 다음 커밋을
  근사, 머지 커밋에서 완전히 정확하진 않을 수 있음)/
  `listCommitsForPath`(그 경로를 실제로 건드린 커밋만, 브랜치를
  훑으며 커밋마다 직접 diff 확인)/`getCommitInfo`를 추가하고
  `repoBrowse.ts`의 `repo.diffFile`/`commitDiff`/`commitInfo`/
  `fileCommits` 액션으로 노출(CLI/MCP·REST 둘 다). Code 탭 우측
  뷰어도 탭으로 나뉜다(첫 탭=파일명만, 둘째 탭="Recent Commits"=
  그 파일을 건드린 커밋만) - 좌측 "최근 커밋" 목록은 없애고 브랜치
  선택기 옆 눈알 아이콘으로 `pages/project/BranchCommitsPage.vue`
  (그 브랜치 커밋 목록)로 이동한다.
- **Q&A는 실제로 계층 구조(질문→답변→그 답변에 대한 재질의→...)
  다** - `DocumentDiscussion.vue`의 카드는 한 단계(질문+직접 답변)
  만 보여주므로, 더 자식이 있으면 카드 우측 상단에 `more_horiz`
  아이콘을 붙여 `pages/project/DocumentThreadPage.vue`(신규,
  `/projects/:id/thread/:code`)로 - 그 문서 자신+직접 자식 목록을
  보여주고 자식도 또 자식이 있으면 같은 페이지를 재귀적으로 열어
  더 내려간다. `RecentQaFeed.vue`(Trackers 탭 안 "RECENT Q&A",
  이름 변경) 항목을 누르면 parent_id를 계속 타고 올라가 Q&A 타입이
  아닌 "진짜 문서"를 찾아(추적 코드 파서가 kind 접두사 형식만
  검사하고 실제 kind 일치는 안 따진다는 점을 이용해 자리 표시
  kind로 raw id 조회) 그 문서 화면으로 이동+자동 선택+그 Q&A
  카드까지 스크롤+강조한다. **`RecentQaFeed.vue`도 이 계층을
  직접 보여준다**(설계자가 "계층 구조가 안 보인다"고 재지적 -
  `DocumentDiscussion.vue`에만 구현하고 이 목록엔 안 넣었던 게
  실제 공백이었다, 게다가 REST 전환 때 이 컴포넌트를 다시 쓰며
  원래 있던 `parent_id` 캡션 표시까지 실수로 빠뜨렸었다) - 각
  항목에 부모를 "↳ 질문/답변/doc: 제목" 배지로(raw id만이 아니라
  resolve해서 사람이 읽을 수 있게), 자식이 있으면 같은 more
  아이콘을 붙였다. 질문하기/답변 작성/의견 남기기는 다이얼로그
  대신 `q-slide-transition`으로 그 자리가 늘어나며 에디터가
  나타나고 하단 우측에 취소하기/등록하기 버튼을 둔다.
- **yiitap의 `.ProseMirror`는 보기/편집 모드나 사이드 메뉴 표시
  여부와 무관하게 `padding-inline: 54px`를 무조건 예약해둔다**
  (`node_modules/@yiitap/vue/dist/vue.css` 직접 확인 - 사이드 메뉴
  자체는 `editable && sideMenu.show`일 때만 렌더링되니 보기
  모드에선 이미 자동으로 안 뜬다, 문제는 이 padding만) -
  `MarkdownSourceView.vue`가 보기 모드에선 `padding-inline: 0`으로
  되돌리고, 편집 모드에선 그 padding은 유지한 채 `min-height`
  (`editMinHeight` prop, Source View 기본 300px/Discussion 컴포저
  200px)와 흰 배경을 추가한다. Contributors는 아바타를 나열하지
  않고 라벨에 `q-menu` 팝업을 달았다. README 없을 때 안내+버튼은
  우측 영역 중앙(`padding-top: 200px`) 정렬.
  **위 padding 수정만으로는 "툴바 밑이 아니라 옆에 내용이 보이는"
  문제가 실은 안 고쳐졌었다** - 진짜 원인은 yiitap 자체 CSS의
  `.yiitap{display:flex; justify-content:center}`가 flex-direction을
  안 정해줘서(기본값 row) 그 직속 자식인 툴바(`.o-main-menu`)와
  내용(`.editor-content`)이 가로로 나란히 배치되던 것 - yiitap
  쪽이 이 조합에 column을 걸어줄 CSS를 빠뜨린 걸로 보이는 라이브러리
  공백이다. `.yiitap-source-view :deep(main.yiitap) { flex-direction:
  column }`으로 고쳤다. **이 수정 자체도 처음엔 CSS 주석을 `-->`
  (HTML 주석 문법)로 잘못 닫아서 전혀 적용 안 되는 2차 버그가 있었다**
  - Vue의 scoped-CSS 컴파일러가 `:deep()`를 실제 셀렉터로 변환하지
  않고 그대로 흘려서 브라우저가 그 규칙 전체를 파싱 실패로 버렸다
  (`document.styleSheets`에서 그 규칙만 사라져 있었음, `curl`로
  Vite가 내려주는 컴파일된 스타일 모듈을 직접 읽어서 발견). **교훈**:
  CSS 버그를 "고쳤다"고 확신하려면 `getComputedStyle`로 속성값만
  볼 게 아니라 `document.styleSheets`로 내가 쓴 셀렉터가 실제
  규칙으로 존재하는지까지 확인해야 한다 - 특히 `:deep()`처럼 컴파일
  과정을 거치는 선택자는 조용히 깨질 수 있다.
- **`related`/`dependsOn`은 Json 컬럼이 아니라 별도 테이블
  (`DocumentRelated`/`DocumentDependsOn`, 각각 `documentId`+
  `targetId`+`etag` + `@@index([targetId])`)이다** - Phase 1
  스캐폴딩 때 "다음 라운드에서 필요하면 정규화"라고 미뤄뒀던 걸
  실제로 정규화했다(설계자 명시적 요청, 하나의 공용 조인 테이블이
  아니라 완전히 별도인 두 테이블로). `backend/src/core/refs.ts`의
  `replaceRelated`/`replaceDependsOn`(전체 교체)과
  `loadRelated`/`loadDependsOn`(+배치 버전)이 API 응답의
  `{code,etag}[]` 모양은 그대로 유지하면서 이 테이블을 조립/분해
  한다 - `docs.add`/`update`/`tag`/`get`/`list`/`search`가 전부 이
  경로를 쓴다. 문서를 삭제하면 그 문서를 가리키던 참조도 FK
  `onDelete: Cascade`로 자동 정리되고, `docs.list`의 `sort:
  'dependency'`는 이제 N+1 없이 배치 쿼리 한 번으로 계산한다(둘 다
  Json 배열 방식일 땐 없었던 부수 이득).
- **로컬 상시 개발 스택**이 있다: `docker-compose.dev.yml`
  (postgres 15432/meilisearch 17700/emqx 11883+18084 - 이 머신의
  다른 운영 중인 설치와 절대 안 겹치는 포트로 고정), CLI
  워크스페이스는 저장소 밖(`.cnw/session.json`이 실수로 git에
  섞이지 않게). **`$HOME/.cnw/config.json`(홈 자격증명)과
  `<프로젝트>/.cnw/config.json`(프로젝트 설정)이 같은 파일명을
  써서 프로젝트가 홈 디렉터리 바로 아래 있으면 `findProjectRoot()`
  가 크래시하던 버그**를 홈 쪽 파일명을 `credentials.json`으로
  분리해 고쳤다 - `shared/src/config.ts`. `.gitignore`의
  `.cnw/session.json` 같은 패턴도 `**/.cnw/session.json`으로
  고쳐야 저장소 루트가 아닌 곳(`mcp/.cnw/`처럼)에도 실제로 적용된다.
  **웹훅(외부 연동)도 Phase 9 이후 후속 라운드에서 구현했다**:
  `Webhook`(projectId/url/secret) Prisma 모델 + `webhook.add`/
  `list`/`delete`(전부 그 프로젝트 **Admin만**) - `backend/src/core/
  webhooks.ts`. 문서 CRUD가 생길 때마다(기존 EMQX `cnw/<projectId>/
  docs` 브로드캐스트를 그대로 재사용 - `broadcastSubscriber.ts`에서
  호출) 등록된 각 URL로 `X-Cnw-Signature: sha256=<hex>`
  HMAC-SHA256 서명을 실어 POST한다 - **secret은 등록 시 응답에만
  한 번 실리고 이후 `webhook.list`로 다시 조회할 수 없다**(재발급은
  삭제 후 재등록). 발송 실패는 재시도 없이 경고 로그만 남긴다(문서
  CRUD 자체를 막지 않기 위한 판단). 이벤트 종류는 현재 문서 CRUD
  하나뿐(emerg/repo.push 등으로 확장 안 함 - 필요해지면
  `webhook.add`에 `events` 필터를 추가하는 식으로 확장). v2는 이
  기능을 "Gitea 웹훅 **수신**"으로 구현했지만 v3는 아직 Gitea를
  운영하지 않아 방향을 반대로(이 시스템이 **발신**) 잡았다 - CLI
  (`webhook add/list/delete`)/MCP(`webhook.list`는 조회,
  `add`/`delete`는 변경)/Settings 탭(Admin만 노출, 추가 직후
  secret을 배너로 한 번 보여줌)에도 반영했다.
  **"나에게 온 초대 목록" 조회는 Phase 9 이후 후속 라운드에서
  채웠다**: `project.invitesForMe`(멤버십 없이도 호출 가능) -
  `backend/src/core/projects.ts`. `ProjectListPage.vue`의 "초대
  수락" 버튼이 대기 중인 초대 개수를 배지로 항상 보여주고, 다이얼로그가
  실제 목록 + 프로젝트별 "수락" 버튼으로 동작한다(프로젝트 ID를
  직접 입력하던 예전 우회 UI는 제거됨).
- 로컬 개발 시 `MEILISEARCH_URL`/`MEILISEARCH_API_KEY`,
  `EMQX_MQTT_URL`/`EMQX_SERVICE_USERNAME`/`EMQX_SERVICE_PASSWORD`
  환경 변수로 각각 연결한다(기본값 `http://127.0.0.1:7700`,
  `mqtt://127.0.0.1:1883`) - 둘 다 없어도 문서/메시지 CRUD 자체는
  동작한다(경고만 로그) - `docs.search`의 `q` 모드와 `emerg` 즉시
  브로드캐스트만 영향받는다.
- 액션은 전부 payload에 **명시적 `projectId`**가 필요하다(CLI/MCP는
  `.cnw/config.json`에서 자동으로 채움). 요청이 CLI/MCP를 통했는지
  (=클로드) WEB UI를 통했는지(=architect)는 `X-Cnw-Channel: agent`
  헤더 유무로 판별한다(`shared/apiclient.ts`가 항상 이 헤더를 싣고,
  없으면 architect로 간주).
- **project id는 전역 유일이 아니라 그 생성자(owner)별로만 유일**하다
  (설계자 요청, 2026-09-21 후속 - "설계자 A가 pA를 가졌어도 설계자
  B도 pA로 만들 수 있어야 한다") - `Project.slug`가
  `@@unique([creatorAccountId, slug])`로 그 값을 저장하고, DB의
  전역 유일 PK(`Project.id`, cuid)는 완전히 내부용으로만 남아
  Document/PullRequest 등 기존 관계 테이블 스키마는 전혀 안 바뀌었다.
  그래서 **모든 액션 payload는 `projectId`(slug) 옆에 `owner`(그
  프로젝트 생성자의 username)도 같이 실어야 한다** - CLI는
  `.cnw/config.json`의 `owner` 필드(`docs auth login --owner
  <username>`, 생략 시 `--username`으로 기본값)로 자동 채우고,
  REST는 `/projects/:owner/:projectId/...` URL 자체에 있다.
  owner+projectId(slug) -> 실제 내부 PK 변환은 `backend/src/core/
  projectResolve.ts`의 `resolveProjectId()` 하나뿐이고, 이걸 부르는
  곳도 `api/actions.ts`의 `dispatch()`(CLI/MCP)와 `api/rest.ts`의
  `web()`(WEB UI) 딱 두 진입점뿐이다 - 그 아래 `core/*.ts`의 기존
  액션 핸들러는 이 owner/slug 개념을 전혀 몰라도 되고(`payload.projectId`
  를 지금까지처럼 "이미 유일하게 식별된 값"으로 그대로 씀), `project.create`
  만 예외로 호출자가 원하는 slug를 `id` payload 필드로 직접 골라
  보낸다. **웹 접속 path도 이와 짝을 맞춰 `/{생성자 username}/
  {project id}`**(및 그 아래 모든 경로) 형태다 - `frontend/src/router/
  routes.ts`의 최상위 동적 라우트가 `:owner/:projectId`, `frontend/src/
  api/client.ts`의 프로젝트 스코프 함수 전부가 `owner` 파라미터를
  받는다. **owner segment는 검증하지 않는 장식**이다(틀린 owner로
  접근하면 그냥 404) - "잘못된 owner를 정확한 값으로 redirect"하는
  건 스코프 밖. owner는 **생성자**(`creatorAccountId`, 영구)를
  가리키므로 `project.transfer`로 Admin이 넘어가도 URL은 안 바뀐다.

## 프론트엔드 컴포넌트 관례

`frontend/`의 모든 Vue 컴포넌트는 아래를 명시적으로 지킨다(예시:
`frontend/src/components/ProjectCard.vue`):

- TypeScript, `<script setup lang="ts">`.
- props는 런타임 선언이 아니라 **`defineProps<{ ... }>()`**로.
- 기본값이 있는 props는 **`withDefaults(defineProps<{...}>(), {...})`**
  로 감싼다.
- v-model 바인딩은 수동 `modelValue` prop + `emit` 대신
  **`defineModel<T>()`**를 쓴다.

## 반드시 지켜야 하는 일곱 가지 규칙

`v2`에서 검증된 아래 작업 규율은 시스템 구현이 바뀌어도 유효하다 -
claude-native-workflow 설치가 이 저장소에 다시 연동되면 그대로
적용한다.

1. **추적 코드 명시**: 어떤 제안을 하거나 설계 내용을 작성할 때는 관련된
   문서/질의의 추적 코드(`XX-XXXXXXXX` 형식)를 정확히 인용한다. 문서
   제목만으로 가리키지 않는다.
2. **로컬 스크래치 사본은 git 커밋 금지**: 편집용으로 로컬에 내려받은
   문서 임시 파일은 이 프로젝트의 git 저장소에 커밋하지 않는다 - 문서의
   정본은 시스템 DB이고, 편집용 임시 파일이 소스 트리에 섞여 들어가면
   안 된다.
3. **코드 관계도는 실제로 기록한다**: 여러 파일을 가로지르는 탐색이라
   다시 파악하려면 비용이 드는 발견을 했으면 코드 관계도에 기록하고,
   새 탐색을 시작하기 전엔 이미 기록된 게 있는지 먼저 확인한다 - 사소한
   한 줄짜리 조회까지 전부 남기는 감사 로그는 아니다.
4. **연관 소스/브랜치/칸반 카드도 실제로 연결·기록한다**: 어떤 문서가
   구체적으로 어떤 파일을 바꿨다고 서술하면 그 핵심 파일들을 문서에
   실제로 연결해둔다. 이름 붙은 기능 브랜치에서 작업했다면 브랜치도
   연결한다. 칸반 보드가 있으면 완료한 작업 단위마다 카드를 만들거나
   진행 상황에 맞게 옮긴다.
5. **별도 계획이 필요한 항목도 실제로 기록한다**: 지금 당장 처리하지
   않고 미뤄둔 것, 앞으로 생길 것으로 예상되는 이슈/리스크, 설계자의
   결정이 필요한 사항, 이번 라운드에서 다 못 끝내고 남은 사항 등은
   별도 계획 항목으로 남겨둔다.
6. **도구 호출은 요청 횟수와 응답 내용 둘 다 최소화한다**: 본문 전체가
   꼭 필요한 게 아니면 요약/코드만 받고, 실제로 필요한 것만 이어서
   조회한다. 이미 확인한 내용을 근거 없이 다시 조회하지 않고, 여러
   건을 다뤄야 할 땐 일괄 처리 수단이 있는지 먼저 찾는다.
7. **문서 간 링크(연관 문서)도 실제로 연결한다**: 여러 문서가 서로
   참고·인용 관계에 있으면 실제로 링크를 만들어둔다 - 본문에 언급만
   하고 링크를 안 만들면 문서 관계 그래프에 나타나지 않는다. 새로
   링크하기 전에 이미 연결돼 있는지 먼저 확인한다.

## 작업 방식

1. **조사** - 비슷한 걸 `v2`/`concept`에서 이미 겪었는지 참고 자료로
   확인한다(그대로 가져다 쓰지는 않는다).
2. **구현**.
3. **검증** - 실제로 기동해서 왕복 확인한 뒤에만 "완료"로 본다.
4. **문서화** - 이 라운드에서 무엇을 어떻게/왜 바꿨는지 기록한다.
5. **기록 연결** - 위 일곱 가지 규칙대로 코드 관계/연관 소스/브랜치/
   칸반/계획/문서 링크를 실제로 남긴다.
6. **커밋/푸시/배포** - 설계자가 명시적으로 요청했을 때만 한다.

커밋/푸시는 명시적 요청이 있을 때만 하고, `main`/`master`에는
force-push하지 않는다.

## 새 기능 문서화

새 기능을 추가하거나 CLI/MCP 동작이 바뀌면, 그 라운드 안에서 이
문서(CLAUDE.md)와 해당 스킬 문서를 같이 갱신한다 - "무엇이 왜
바뀌었는지"를 기록하는 문서와 "다음 세션이 이 명령을 실제로 어떻게
써야 하는지" 안내하는 문서는 별개 목적이라 하나만 갱신하면 다음
세션이 새 동작을 놓친다.
