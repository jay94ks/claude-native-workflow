# 설계 진행 기록

시스템이 자기 자신의 설계를 담을 만큼 성숙하기 전까지, 이 저장소의
진행 상황은 이 파일에 평범한 마크다운으로 기록한다(Phase 0 완료 후
가이디드 마이그레이션으로 시스템 안으로 옮길 예정 - 전체 배경은
[README.md](README.md) 참고).

**이 문서는 라운드별 구현 변동 사항(무엇을 어떻게 바꿨는지·왜·실측
검증 결과)만 남긴다** - "이 기능이 결국 무엇을 하는가"라는 완성된
설명은 [FEATURES.md](FEATURES.md)에 정리한다. 새 기능을 추가하거나
기존 기능의 동작을 바꾸는 라운드를 끝내면, 그 변동 사항은 여기 새
절로 남기고 FEATURES.md의 해당 항목도 함께 갱신한다 - 기능 설명을
이 문서에 다시 옮겨 적지 않는다.

## Phase 0 - 완료 (2026-09-10)

백엔드 스캐폴딩. 상세 범위는 커밋 메시지와 README 참고. 검증은 로컬
SQLite와 전체 Docker Compose 스택(Postgres+Meilisearch+EMQX+backend)
양쪽에서 CRUD/검색 동기화/실시간 발행/Question-Answer 자동 전이까지
end-to-end로 실측했다.

미구현으로 남겨둔 부분(의도된 것 - 501 스텁):
- `git log/diff/blame/show` 계열 - Gitea 연동(Phase 2) 전까지 저장소
  자체가 없음.
- `message send/receive`, `message wait` - EMQX 구독 측 인프라(Phase 4)
  전까지 발행만 가능하고 수신 경로가 없음.

## Phase 1 - 완료 (2026-09-10)

MCP 서버(`backend/src/mcp/server.ts`, `@modelcontextprotocol/sdk` +
stdio) + `TemplateFile`(CLAUDE.md/SKILL.md 템플릿, project→group→
institution→전역 기본값 override 체인) + 저장소 자체 `CLAUDE.md`/
`.claude/skills/claude-native-workflow/SKILL.md`.

- MCP 서버는 CLI와 마찬가지로 REST 클라이언트다(core 직접 호출 안 함) -
  `cli/apiclient.ts`의 `apiCall`/`loadCredentials`를 그대로 재사용해서
  `~/.claude-native-workflow/credentials.json`을 CLI와 공유한다.
  `cli/index.ts`의 명령을 1:1로 미러링한 도구 39개를 등록(auth
  register/login/logout은 비밀번호가 대화 컨텍스트에 남는 걸 피하려고
  의도적으로 도구화하지 않음 - `auth_whoami`만 진단용 예외).
- `ClaudeMdTemplateOverride`를 `TemplateFile { filename, ... }`로
  일반화(3드라이버 스키마 전부 반영) - CLAUDE.md와 SKILL.md를 별도
  테이블 없이 하나로 저장. 전역 기본값(스코프 3개 FK 전부 null)은
  nullable FK의 unique 제약이 NULL을 서로 다른 값으로 취급하는
  문제(Postgres/MySQL/SQLite 공통) 때문에 애플리케이션 레벨에서
  findFirst-then-create/update로 중복을 막는다(DB 유니크 제약에만
  의존하지 않음).
- `backend/prisma/seed-templates/{CLAUDE.md,SKILL.md}`를 원본으로 서버
  기동 시(`seedDefaultTemplates()`) 전역 기본값이 없으면 심는다 - 두
  규칙(추적 코드 명시, 로컬 스크래치 사본 git 커밋 금지)을 실제로
  포함. 같은 SKILL.md를 이 저장소 자신의
  `.claude/skills/claude-native-workflow/SKILL.md`로도 복사해둠(자동
  동기화 없음 - 한쪽을 고치면 의도적으로 맞춰야 함, 루트 `CLAUDE.md`에
  명시).
- `template deploy`(resolve된 템플릿을 프로젝트 git 저장소에 실제
  커밋)는 Gitea 통합(Phase 2)이 있어야 의미가 있어 501 스텁으로만 등록.

검증: 로컬 SQLite + 독립 Meilisearch 컨테이너로 서버 기동 → CLI로
전역 기본값 조회 → 프로젝트 스코프 override 설정 전/후 resolve 결과
확인 → MCP stdio 클라이언트로 39개 도구 전부 목록 확인 후 대표 도구
호출(`template_get`, `document_list`, `pending_list`, `git_log`,
`message_list`)이 CLI/API와 동일한 결과·동일한 501 에러를 반환하는지
직접 대조. 테스트 후 컨테이너/스크래치 DB/자격증명 파일 전부 정리.

## Phase 2 - 완료 (2026-09-10)

Gitea 자체 호스팅 git 통합 + 외부 GitHub/GitLab 연동 대안 경로 + 웹훅
수신 인프라 + `template deploy` 실제 구현.

- `docker-compose.yml`에 `gitea` 서비스 추가(내장 SQLite, SSH 미노출 -
  백엔드는 REST API로 저장소 생성/웹훅 등록/파일 커밋만 함, 실제
  clone/push는 설계자가 Gitea HTTP(S)로 직접). `ProjectGitRepo`에
  `webhookSecretEncrypted`(AES-256-GCM, 기존 `crypto.ts` 재사용) 추가.
- `core/gitea.ts`/`core/externalGit.ts`/`core/gitRepos.ts`/
  `core/pushHooks.ts` - Gitea REST 래퍼, GitHub/GitLab 웹훅 자동 등록,
  저장소 연결(자체 호스팅/외부), 웹훅 서명 검증(provider별 - Gitea
  HMAC-SHA256/GitHub HMAC-SHA256/GitLab 평문 토큰) + `PushHookPrompt`
  매칭·`PushHookQueueEntry` 적재.
- `git log/diff/show`를 실제 Gitea API 호출로 교체. **`git blame`은
  구현하지 않음** - 실제 Gitea 1.27 인스턴스에 대고 검증하는 과정에서
  발견: REST API에 blame 엔드포인트가 아예 없고(swagger.v1.json에
  "blame" 포함 경로 0개), 웹 UI의 blame 페이지도 이 환경에서는
  `context.RepoAssignment` 단계에서 404가 나서 토큰 인증으로 신뢰성
  있게 못 씀. 있는 척 호출해서 애매한 404를 내기보다, 호출 즉시
  "Gitea REST API는 blame을 지원하지 않는다"는 명확한 에러로 알린다 -
  `git log/diff/show`로 이력을 대신 확인하라고 안내. 계획했던
  `getBlame()` 구현을 실측 중에 접은 사례.
- `git diff`의 실제 경로도 계획과 달랐다 - 처음 가정한 웹 라우트
  (`/{owner}/{repo}/commit/{sha}.diff`)는 404, 실제로는
  `/api/v1/repos/{owner}/{repo}/git/commits/{sha}.diff`가 동작함(둘 다
  실제 Gitea에 쳐보고 확정 - 문서만 보고 추측하지 않음). 응답이
  JSON이 아니라 순수 텍스트라 `apiCallText()`(CLI)/전용
  `registerTool` 핸들러(MCP, `JSON.stringify`로 안 감쌈)를 새로 만듦.
- 외부 GitHub/GitLab: 자격증명이 있으면 그 API로 웹훅 자동 등록
  시도, 없거나 실패하면 링크 자체는 저장하고 수동 설정 안내(웹훅
  URL+시크릿)를 응답에 담아 폴백. 그 프로젝트의 `git log/diff/blame/
  show`는 "자체 호스팅만 지원"이라는 명확한 400.
- 웹훅 등록(및 그 전제인 `PUBLIC_BACKEND_URL`)은 realtimePublish와
  같은 fail-soft 원칙 - 없어도 저장소 생성/연결 자체는 성공하고
  웹훅만 건너뛴다(로컬 개발 환경 배려).
- `PushHookPrompt`를 실제로 만드는 CRUD/CLI는 의도적으로 아직 없음
  (Phase 3 몫) - 웹훅 수신→매칭 배관이 맞는지는 테스트에서 Prisma로
  직접 행을 심어 확인.

검증: 실제 Gitea 컨테이너(관리자 계정+PAT을 EMQX와 같은 1회성 수동
단계로 발급) + Meilisearch로 end-to-end 실측 - `git link`가 Gitea에
진짜 저장소+웹훅을 만드는지 Gitea API로 직접 대조, Gitea Contents
API로 커밋 1개를 만들어 `git log/show/diff`가 실제 데이터를 반환하는지
확인, `template deploy`가 Gitea 저장소에 CLAUDE.md/SKILL.md를 실제로
커밋하는지 대조, 웹훅 서명 검증(올바른/잘못된 서명 둘 다) +
`PushHookPrompt` 매칭 유무에 따라 큐가 쌓이는지/안 쌓이는지, 외부 링크
+ git 이력 조회 거부 메시지까지 전부 실측. 테스트 후 컨테이너/스크래치
DB/자격증명 파일 전부 정리.

## Phase 3 - 완료 (2026-09-10)

git push 훅 프롬프트 자동화(대기열 방식) + 추적 코드 발급 체계 전면
재설계(설계자 지시로 Phase 3 진행 중 끼어든 변경 - 아래 별도 항목).

- `core/pushHookPrompts.ts`: `PushHookPrompt` CRUD(create/list/delete,
  소유 프로젝트 확인 후 삭제) + `PushHookQueueEntry` 조회(join으로
  promptTemplate/triggerBranch까지 같이 반환 - 읽는 쪽이 프롬프트를
  또 조회할 필요 없게)/상태 전이(`acknowledgeQueueEntry`:
  pending→acknowledged, `completeQueueEntry`: pending/acknowledged→done,
  잘못된 전이는 명확한 에러). 변수 치환 템플릿 엔진은 만들지 않음 -
  큐 응답에 원문 그대로 담아 읽는 쪽(클로드 세션)이 조합.
- API/CLI/MCP: `hook create/list/delete`, `hook queue`, `hook ack/done`
  (+ MCP `hook_*`). 큐 라우트는 계획 문서의 `/api/push-hook-queue/:id/...`
  대신 `/api/projects/:projectId/push-hook-queue/:id/...`로
  구현(기존 `comments/:id/resolve` 패턴과 통일, `requireProjectRole`가
  projectId를 필요로 함).
- SKILL.md에 "세션을 시작하거나 프로젝트를 다시 열 때 `docs hook queue
  --status pending`을 먼저 확인한다" 절 추가 - 원래 브리핑의 "다음에
  그 프로젝트를 여는 세션이 대기열을 확인해서 실행한다"를 실제 행동
  지침으로 명문화.
- **실측 중 발견한 버그 2건(둘 다 수정)**:
  1. `PushHookQueueEntry.pushHookPrompt` FK에 `onDelete: Cascade`가
     없어서, 큐 항목이 있는 프롬프트를 `hook delete`하면 FK violation으로
     그냥 실패했다(3드라이버 스키마 전부 수정 - 실제 삭제를 시도하다가
     발견, 이론으로 짐작한 게 아님).
  2. **Gitea의 기본 SSRF 방지(`security.ALLOWED_HOST_LIST`)가 사설
     네트워크 호스트로의 웹훅 발송을 막는다** - `docker-compose.yml`의
     `gitea`와 `backend`는 같은 compose 네트워크 안에 있어도 이 설정이
     없으면 웹훅이 조용히(앱 레벨 에러 없이, Gitea 로그에만) 실패한다.
     Phase 2 검증은 웹훅 수신 라우트를 curl로 직접 두드리기만 했지
     Gitea가 실제로 발사하는 웹훅을 받아본 적이 없어서 이번에야
     드러났다 - `docker-compose.yml`의 gitea 서비스에
     `GITEA__security__ALLOWED_HOST_LIST: backend` 추가, `.env.example`의
     `PUBLIC_BACKEND_URL` 기본값을 컨테이너 내부 호스트명
     (`http://backend:8760`)으로 변경.

### 추적 코드 발급 체계 재설계 (설계자 지시)

Phase 3 작업 도중 설계자가 Phase 0의 트래킹 코드 설계에 피드백을 줬다 -
"순번 증가를 랜덤으로 한다는 게 아니다", "중앙 추적코드 DB를 만들고
발급 처리 + 사용처 태깅", "ProjectId/OrganizationId를 넣어서 기관·
프로젝트 경계를 못 넘게", "각 기관과 프로젝트의 추적코드는 서로 별도".
`backend/src/core/tracking.ts`를 다음과 같이 바꿨다:

- 신규 `TrackingCode` 모델(3드라이버 스키마 전부) -
  `{ id(cuid), code, institutionId?, projectId, which, location,
  createdAt }`, `@@unique([projectId, code])`. 코드 문자열의 유일성이
  더는 전역이 아니라 **프로젝트 단위**다 - 서로 다른 프로젝트는 같은
  코드 문자열을 독립적으로 가질 수 있다(직접 검증: 같은 코드를 두
  프로젝트에 각각 insert → 둘 다 성공, 같은 프로젝트에 두 번 insert →
  두 번째는 P2002로 실패).
- `Document`/`Question`은 지금처럼 자기 테이블에 `trackingCode` 컬럼을
  그대로 유지(레지스트리 전용 스코프로 확정 - `DocumentLink`/`Comment`가
  `Document.trackingCode`를 직접 가리키는 기존 FK는 안 건드림).
- 발급은 여전히 "영문 2글자+hex 8글자" 랜덤이지만, 이제 `TrackingCode`
  테이블에 원자적 insert로 먼저 예약한 뒤(엔티티별 `@unique`만으로는
  Document/Question처럼 서로 다른 테이블 간 충돌을 못 막았던 문제 해소)
  실제 엔티티를 만들고, 그 엔티티의 id를 레지스트리의 `location`에
  채운다 - 순번 카운터로 되돌아간 게 아니라 "예약 단계 자체가 원자적"
  이라는 게 핵심(옛 `.tracking.json` 순번 증가가 non-atomic이라 겪었던
  문제의 재발 방지 원칙은 그대로 유지).
- `withTrackingCode()`가 `projectId`/`which` 파라미터를 새로 받음 -
  `documents.ts`/`questions.ts` 호출부 갱신(둘 다 이미 `projectId`를
  갖고 있어서 큰 변경 없음).

검증: SQLite+Meilisearch 로컬 기동 → 서로 다른 두 프로젝트에서 문서
생성(각자 정상 발급) → 같은 코드를 두 프로젝트에 각각 insert(성공)/같은
프로젝트에 두 번 insert(P2002로 실패)로 스코프 경계 직접 확인 →
Question 생성도 회귀 없이 동작하는지 확인 → `TrackingCode` 행의
institutionId/projectId/which/location이 실제로 올바르게 채워지는지
대조.

## Phase 4 - 완료 (2026-09-10)

EMQX 구독 측 완성 - `message list/send/wait` 실제 구현 + JWT 기반 EMQX
클라이언트 인증/인가(미래 웹 UI가 MQTT-over-WebSocket으로 직접 붙을 때
쓸 인프라).

- 로드맵 원문의 "MCP의 MQTT 장기 연결"은 Phase 1에서 확정한 "CLI/MCP는
  REST만 호출하는 순수 클라이언트" 원칙보다 먼저 쓰인 낡은 문구라 실제
  구현 위치를 바꿨다 - CLI/MCP가 직접 MQTT를 붙들지 않고, `GET
  /api/projects/:projectId/messages/wait` 자체를 **백엔드가 내부적으로
  EMQX를 구독하는 롱폴**로 구현(`core/messages.ts`의
  `waitForMessage()`, `mqtt` npm 패키지 신규 추가). 매 호출마다 새로
  연결(개인/소규모 설치 규모에서 커넥션 풀링은 과함).
- `core/emqxAuth.ts`: **인증**은 EMQX 내장 JWT 검증기 대신, 이미
  검증된 `verifyAccessToken()`(Phase 0)을 그대로 쓰는 HTTP 훅(`POST
  /api/emqx/authn`)으로 구현 - MQTT CONNECT의 username=userId,
  password=JWT 액세스 토큰이 전제, `sub`와 username이 일치해야 허용.
  **인가**도 HTTP 훅(`POST /api/emqx/authz`)으로 `project/{projectId}/
  (changes|messages)` 패턴에서 projectId를 뽑아 `Member` 존재 여부로
  판정. 백엔드 자신의 내부 연결(`message wait`용)은 고정
  `EMQX_SERVICE_USERNAME`/`PASSWORD`로 두 훅 다 즉시 우회.
- `ensureEmqxAuthConfigured()`가 서버 기동 시 EMQX Admin API로 위 두
  HTTP 소스를 없으면 등록(Gitea PAT처럼 수동 설정 단계를 늘리지 않음).
- `realtimePublish()`를 `ChangeEvent` 고정 타입에서 제네릭으로 완화 -
  메시지 페이로드(본문 텍스트 포함)를 같은 함수로 발행하기 위해.

**실측 중 확인한 사실(추측 아님)**:
- EMQX Admin API 등록 요청 형식(`POST /api/v5/authentication`
  `{mechanism, backend, method, url, headers, body}`, `POST
  /api/v5/authorization/sources` `{type, enable, method, url, headers,
  body}`, 플레이스홀더 `${username}`/`${password}`/`${clientid}`/
  `${topic}`/`${action}`)은 실제 EMQX 5.8.6 컨테이너에 등록해보고
  확정 - 첫 시도에 그대로 맞아떨어졌다(Gitea 때와 달리 이번엔 추측이
  적중).
- EMQX 5.8.6 이미지의 `POST /api/v5/api_key`는 대시보드 로그인 토큰으로
  직접 호출하면 `expired_at` 값과 무관하게 항상 `badmatch` 내부 에러가
  난다(실제 Erlang 스택트레이스까지 확인) - 실제 대시보드 UI를 통해
  키를 발급하면 정상 동작(UI가 같은 엔드포인트를 다르게 호출하는 듯) -
  이건 이 이미지 버전의 결함으로 보이고 내 코드와는 무관(설계자용
  EMQX API Key 발급 안내가 이미 "대시보드에서 발급"으로 돼 있어 실제
  사용 흐름엔 영향 없음).
- raw MQTT 테스트 클라이언트로 4가지 시나리오 전부 직접 확인: 유효한
  JWT+자기 프로젝트 → CONNECT 성공+SUBSCRIBE 승인, 유효한 JWT+비멤버
  프로젝트 → SUBSCRIBE 거부(코드 128), 위조된 password → CONNECT
  자체 거부, JWT의 sub와 다른 username → CONNECT 자체 거부.

검증: 실제 EMQX 5.8.6 컨테이너(+Meilisearch)로 end-to-end 실측 -
authn/authz 소스가 실제로 등록됐는지 EMQX Admin API로 대조, 위 raw
MQTT 4가지 시나리오, `message send`→`message list`에 나오는지,
`message wait`를 백그라운드로 걸어두고 다른 프로세스에서 `message
send`를 호출했을 때 ~3초 만에(20초 타임아웃 중) 그 메시지를 받고
즉시 반환하는지, 메시지가 안 오면 지정한 타임아웃만큼 정확히 기다리다
빈 응답(`timedOut:true`)으로 반환하는지 둘 다 확인. 테스트 후
컨테이너/스크래치 DB/자격증명 파일 전부 정리.

## Phase 5 (1/3) - 완료 (2026-09-10)

웹 인터페이스 첫 조각: 관리 화면 + 인증. 로드맵이 "관리 화면 → 문서/
코드 에디터 → 변경 추적 뷰 순으로 점진 구현"이라고 명시해뒀으므로,
Monaco 에디터/실시간 MQTT-over-WebSocket/변경 추적 뷰는 각각 별도
설치로 미뤄둔다(한 번에 다 밀어넣으면 리뷰가 불가능한 크기가 됨).

- `frontend/`를 새 패키지로 신설(Vue 3 + Vite + Vue Router + Pinia) -
  별도 컨테이너/포트를 안 띄우고 backend가 빌드 결과물을 그대로
  정적 서빙한다("단일 설치형" 원칙). 개발 중엔 Vite 개발 서버가
  `/api`를 backend로 프록시 - 프로덕션/개발 어느 쪽이든 브라우저는
  항상 상대 경로 `/api/...`만 호출(런타임 API base URL 설정 불필요).
- 신규 백엔드 표면은 `GET /api/install-config`
  (`core/installConfig.ts`) 하나뿐 - 이 모델을 읽는 API가 지금까지
  전혀 없었음. 나머지는 전부 Phase 0~2에서 이미 있던 REST 엔드포인트를
  그대로 호출.
- 인증: 로그인/회원가입 화면 + `localStorage` 토큰 저장(CLI의 파일
  기반 자격증명과는 별개) + 401 시 refresh 토큰으로 자동 갱신 후
  재시도하는 fetch 래퍼(`frontend/src/api/client.ts`).
- 화면: 기관/프로젝트 그룹/프로젝트 목록+생성, 프로젝트 상세(연결된
  git 저장소 상태, 문서 타입 칩, 멤버 목록+추가). 멤버 추가는 CLI와
  똑같이 사용자 id를 직접 입력받는다 - 사용자 검색/목록 화면은 아직
  없음(알려진 거친 지점, 이번 설치 범위 밖).
- Docker 이미지 빌드 컨텍스트를 backend/ 단독에서 저장소 루트로 확장
  (`docker-compose.yml`의 `context: ../..`, 새 `Dockerfile`이 멀티
  스테이지로 frontend를 먼저 빌드한 뒤 backend 이미지의
  `/frontend/dist`에 복사 - `server.ts`가 `dist/api/server.js` 기준
  3단계 위에서 `frontend/dist`를 찾는 로컬 개발 레이아웃과 컨테이너
  안에서도 같은 상대 위치가 되도록 맞춤). 컨텍스트가 바뀌면서
  `backend/.dockerignore`는 더는 적용되지 않아 제거하고 저장소 루트
  `.dockerignore`로 교체.

**실측 확인**: 실제 브라우저(Claude Browser 도구)로 회원가입 → 로그인
→ 기관 생성 → 그 기관을 지정해 프로젝트 그룹 생성(드롭다운에 실제로
뜨는지) → 프로젝트 생성 → 상세 화면 진입까지 전부 직접 클릭해서
확인 - 문서 타입 칩(SP/DC/DN 기본 시드)과 owner 멤버(프로젝트 생성자
자동 추가)가 실제로 표시됨, git 저장소 미연결 상태도 깨지지 않고
안내 문구로 처리됨. `InstallConfig.institutionsEnabled`를 DB에서
직접 false로 바꾼 뒤 새로고침 → "기관" 네비게이션 항목이 실제로
사라지는지 확인(경로 직접 접근은 막지 않음 - 네비게이션만 숨김,
계획대로). 프로덕션 경로(backend가 `frontend/dist` 정적 서빙)와
개발 경로(Vite 개발 서버, `localhost`로 접속 - 이 환경의 Node가
`127.0.0.1`이 아니라 `::1`에 바인딩하는 특이성 확인, 코드 결함 아님)
둘 다 확인. 멀티스테이지 Docker 빌드도 실제로 이미지를 만들어
`/frontend/dist`와 `/app/dist/api/server.js`가 기대한 경로에 있는지
대조. 테스트 후 컨테이너/이미지/스크래치 DB 전부 정리.

## Phase 5 (2/3) - 완료 (2026-09-10)

문서 브라우저 + Monaco 마크다운 에디터, 소스 코드 브라우저 + Monaco
코드 에디터.

- 신규 백엔드: `core/gitea.ts`에 `listTree`/`getFileContent` 추가(기존
  Gitea Contents API 래퍼 위에 - 디렉터리면 배열/파일이면 객체 하나를
  돌려주는 같은 엔드포인트를 타입 있는 두 함수로 분리). `GET .../git/
  tree`, `GET .../git/file`, `PUT .../git/file` API + `docs git tree/
  cat/put` CLI + `git_tree`/`git_cat`/`git_put` MCP 도구(완전성 원칙 -
  웹 UI만 되고 CLI/MCP는 안 되는 비대칭을 안 만듦).
- 문서 쪽은 새 백엔드가 전혀 필요 없었음 - Phase 0 엔드포인트
  그대로(`GET/PUT /api/documents/:trackingCode`) 목록+에디터 화면만
  새로 만듦. 상태 전이는 CLI와 동일한 수준(상태 코드 직접 입력) -
  "허용된 다음 상태 목록" API는 CLI에도 없어서 새로 안 만듦(비대칭
  방지 원칙을 반대 방향으로도 적용 - 웹 UI가 CLI보다 더 똑똑해지지
  않게).
- Monaco 통합에서 실측 중 겪은 문제(둘 다 실제로 빌드해보고 발견 -
  추측으로 넘어가지 않음):
  1. Vite 공식 문서의 수동 `?worker` import 패턴(`monaco-editor/esm/
     vs/editor/editor.worker?worker`)이 이 Vite 6.4 + monaco-editor
     조합에서 `vite build`(프로덕션)만 "Rollup failed to resolve
     import"로 실패했다(개발 서버는 됨) - `optimizeDeps.exclude`/
     `worker.format` 조정으로도 안 풀려서, 유지보수되는 전용 플러그인
     (`vite-plugin-monaco-editor-esm`)으로 교체.
  2. 그 플러그인 최신 버전(2.0.3)을 monaco-editor 최신 버전(0.56.0)과
     같이 쓰면 워커 경로가 `esm/vs/esm/vs/editor/editor.worker.js`로
     중복돼 빌드가 깨졌다(플러그인이 이 monaco-editor 버전의
     package.json exports 맵 변경을 아직 못 따라간 것으로 보임) -
     monaco-editor를 0.52.0으로 낮춰서 해결(그 플러그인이 이미 검증된
     조합).
- **실측 중 발견한 진짜 버그(수정함)**: 문서를 만들자마자 그 에디터로
  바로 이동하면 `GET /api/documents/:trackingCode`가 간헐적으로 404를
  냈다 - Phase 0에서 이미 관찰했던 "Meilisearch 쓰기 직후 읽기
  일시적 지연"(그때는 DB 커밋 자체엔 문제 없고 재조회하면 항상
  해결되는 걸 확인하고 "실제 앱 버그 아님"으로 결론지었던 것)이 이번엔
  실제 사용자 흐름(생성 직후 에디터로 바로 이동)에서 터진 것 - 논리는
  같지만 이번엔 실제로 사용자가 마주치는 경로라 고쳤다.
  `DocumentEditorView.vue`가 최초 404에서만 500ms 대기 후 한 번 재조회
  하도록 수정(재시도로도 안 되면 진짜 에러로 표시).

검증: 실제 Gitea 컨테이너로 `docs git tree/cat/put` 왕복(Gitea
Contents API로 직접 대조) + Gitea 커밋 로그에 실제 3개 커밋이 순서대로
쌓이는지 확인. 실제 브라우저로 문서 생성→에디터 진입(404 재시도 로직
실제 발동 확인)→Monaco에서 마크다운 편집→저장→상태 전이(draft→active
배지 변화)까지, 소스 코드 화면에서 디렉터리 탐색→파일 열기→Monaco에서
수정→저장(커밋)→Gitea 쪽 raw 파일로 직접 대조, git 저장소 미연결
프로젝트에서 소스 코드 화면이 안내 문구만 보여주고 안 깨지는지까지
전부 확인. 테스트 후 컨테이너/스크래치 DB/자격증명 파일 전부 정리.

## Phase 5 (3/3) - 완료 (2026-09-10)

변경 추적 뷰(git 커밋 로그+diff, 문서 버전 이력 diff) + 메시징
패널(프로젝트 상세 화면에 임베드) - 전부 브라우저가 EMQX에
MQTT-over-WebSocket으로 직접 붙어 실시간 갱신. Phase 4가 마련해둔 JWT
기반 authn/Member 기준 authz 인프라의 첫 실제 소비자.

- **실시간 인프라**: EMQX 기본 WS 리스너(8083)를 `EMQX_WS_HOST_PORT`로
  호스트에 노출 + 새 환경변수 `PUBLIC_EMQX_WS_URL`(브라우저가 docker
  네트워크 밖에 있어 `PUBLIC_BACKEND_URL`과 같은 이유로 필요) + 새
  `GET /api/realtime-config`(웹 UI 전용 설정 조회 - `install-config`와
  같은 성격, CLI/MCP 미러 불필요). `frontend/src/realtime.ts`의
  `connectProjectRealtime()`이 `mqtt` 패키지로 접속(username=userId,
  password=JWT 액세스 토큰 - `core/emqxAuth.ts`가 그대로 검증), `project/
  {id}/changes`+`.../messages` 구독. EMQX WS 미노출/미설정이면 조용히
  비활성화(다른 모든 EMQX 통합 지점과 같은 fail-soft 원칙).
- **메시징 패널**: 백엔드 변경 없음(Phase 4 엔드포인트 재사용) -
  `MessagesPanel.vue`를 `ProjectDetailView`에 임베드, 실시간 수신
  메시지를 목록에 즉시 append.
- **변경 추적 뷰**(`/projects/:id/changes`): git 커밋 로그(기존 `git/
  log`+`git/diff/:sha` 재사용, Gitea가 이미 주는 unified diff 텍스트를
  줄 단위로 색만 입혀 렌더링) + 문서 버전 이력(신규 `GET .../documents/
  :trackingCode/revisions` + `docs revisions`/`document_revisions`
  CLI/MCP - `DocumentRevision`은 Phase 0부터 쌓여왔지만 조회 API가
  없었음). 리비전 두 개를 골라 `diff`(jsdiff) 패키지로 줄 단위 diff.
  `core/pushHooks.ts`의 `recordPushEvent()`에 `realtimePublish` 한 줄을
  추가해(`ChangeEvent`의 `"project"` entity - 지금까지 정의만 되고 아무도
  안 쓰던 값) push가 들어올 때마다 발행, git 로그 섹션도 새로고침 없이
  갱신되게 함.
- **실측 중 발견한 진짜 버그(수정함)**: 문서를 수정한 직후 그 변경이
  실시간 이벤트로 다른 브라우저 탭에 도달해 변경 추적 뷰가 즉시
  재조회하면, 문서 "현재" 본문(`GET /api/documents/:trackingCode`,
  Meilisearch 색인 경유)이 방금 반영된 내용이 아니라 그 직전 값으로
  조용히(200 OK로, 에러 없이) 돌아오는 경우가 있었다 - Phase 5(2/3)에서
  겪은 것과 같은 Meilisearch 쓰기-직후-읽기 지연이지만, 그때는 404로
  터져서 재시도가 자연스러웠던 반면 이번엔 실패 신호 자체가 없어(200 +
  낡은 데이터) 더 찾기 어려웠다 - 실제로 두 브라우저 탭(알림 수신 쪽 +
  API로 수정한 쪽)을 띄워 diff가 "변경 없음"으로 잘못 뜨는 걸 직접
  재현한 뒤에야 확인. `ChangeTrackingView.vue`의 실시간 핸들러가 해당
  문서의 변경 이벤트를 받으면 색인이 따라잡을 500ms를 기다린 뒤
  재조회하도록 수정 - 수정 후 같은 시나리오를 재현해 diff가 실제 수정
  내용(삭제/추가 줄)을 정확히 보여주는 것까지 확인.

검증: 실제 Docker Compose 스택(Postgres+Meilisearch+EMQX+Gitea+backend,
EMQX는 WS 포트까지 새로 노출) 전체를 기동, EMQX 대시보드에서 API
Key(WS 포트와는 별개로 Admin REST API용) 발급 + Gitea 관리자 계정/PAT
(repository+user 쓰기 권한 - 처음엔 user 스코프를 안 줘서 저장소 생성이
403으로 막히는 걸 겪고 다시 발급) 1회 수동 설정. 계정 3개(alice/bob/
carol)로: alice가 만든 프로젝트에 bob을 editor로 추가하고 carol은 비
멤버로 남김. 브라우저에 alice로 로그인해 프로젝트 상세/변경 추적 화면을
띄워두고, bob의 메시지 전송·문서 저장을 REST API로 별도 실행해 alice의
화면이 새로고침 없이 갱신되는지 실측(메시징 패널 즉시 append, 리비전
타임라인 즉시 갱신, 위 버그 수정 전/후 diff 결과 대조). `POST /api/emqx/
authn`/`authz`를 실제 EMQX가 호출하는 것과 같은 입력으로 직접 호출해
carol(비멤버)은 인증은 되지만 그 프로젝트 topic 구독은 거부되고,
alice(owner)는 허용되고, 틀린 비밀번호는 인증 자체가 거부되는 세 경우
모두 확인. `docs revisions`/MCP `document_revisions`가 실제 리비전
이력과 일치하는지 CLI/stdio로 직접 호출해 대조. Phase 5(2/3)의 문서
에디터/소스 브라우저 화면도 회귀 확인(정상). 테스트 후 컨테이너/볼륨/
이미지/스크래치 `.env`/CLI 자격증명 파일 전부 정리.

## Phase 6 - 완료 (2026-09-10)

가이디드 마이그레이션 도구 - `concept` 브랜치 스타일 파일 기반
프로젝트(YAML frontmatter+마크다운, `docs/<카테고리>/<TYPE>-<NNNNN>.md`)를
DB 기반 시스템으로 옮기는 `docs migrate scan`/`migrate apply` CLI+MCP
명령. 로드맵의 마지막 단계 - 이걸로 Phase 0~6 전체가 완료됐다.

- **새 백엔드 API 없음** - `scan`은 로컬 파일 시스템만 읽고(옛
  프로젝트의 `docs/`는 backend 서버가 아니라 CLI/MCP를 실행하는 이
  머신에 있음), `apply`는 로컬 매니페스트+원본 파일을 읽어 **이미
  존재하는** 문서 생성/전이/링크 API를 순서대로 호출하는 클라이언트
  오케스트레이션이다 - `backend/src/cli/migrate.ts`(새 파일, CLI/MCP가
  공유 - MCP가 `cli/apiclient.ts`를 공유하는 것과 같은 패턴) 하나로
  스키마/라우트 변경 없이 구현됐다.
- **매니페스트가 "설계자 확인" 지점**: `scan`은 다른 CLI 명령과 같은
  `printJson` 패턴으로 후보를 stdout에 출력한다(새 `--out` 플래그 안
  만듦 - `> manifest.json` 리다이렉트가 곧 로컬 스크래치 매니페스트).
  `docTypeCode`/`statusCode`/`links`/`skip`을 직접 편집해 오탐지를
  고칠 수 있고, `apply`는 이 파일과 각 문서의 원본 `sourcePath`(본문은
  매니페스트에 안 담음 - 정규화 원칙, 항상 최신 파일 내용 반영)만 읽는다.
- frontmatter 파싱은 `js-yaml`(신규 의존성) - 정규식 재파싱은 이번
  리팩터 전체가 없애려던 CRLF 버그 계열을 다시 들여오는 것이라 의도적
  회피.
- 상태는 초기 상태로 생성 후, 매니페스트의 `statusCode`가 다르면 딱
  한 번 직접 전이를 시도한다(여러 단계 전이를 자동으로 훑지 않음 -
  안 되면 명확한 경고만 남기고 문서는 초기 상태 그대로 둠). 링크는
  이번 배치 안에서 생성된 문서끼리만 해석하고, 배치 밖 문서를 가리키면
  에러가 아니라 경고로 건너뛴다. 항목 하나 실패해도 배치 전체를 막지
  않는다(`created`/`errors`/`warnings` 세 배열로 개별 결과 보고).
- **실측 중 발견한 진짜 버그(수정함)**: `concept` 브랜치의 실제
  `DN-00001.md`(결과 보고, 약 120KB)를 `migrate apply`로 옮기다가
  "request entity too large"로 실패했다 - `api/server.ts`의
  `express.json()`이 limit 옵션 없이 기본값(100kb)으로 떠 있었던
  것(Phase 6뿐 아니라 처음부터 있었던 한계 - 문서/보고서 본문이 100KB를
  넘으면 언제든 터졌을 것). `limit: "10mb"`로 올려 수정, 같은 파일로
  재현해 성공하고 본문이 원본과 바이트 단위로 일치하는지까지 확인.
- **알려진 한계(문서화만)**: 재실행은 멱등하지 않음(같은 매니페스트를
  두 번 `apply`하면 문서 중복 생성 - 실측으로 재현해 확인함), 옛
  시스템의 답변 대기 체크리스트는 Question/Answer로 자동 변환하지
  않음(본문 텍스트로만 그대로 이동 - 정규식 기반 체크리스트 파싱을
  다시 들여오지 않기 위한 의도적 범위 제외), 대상 DocType/DocStatus는
  `apply`가 자동 생성하지 않음(없으면 그 항목만 에러로 보고).

검증: `concept` 브랜치의 실제 `docs/` 전체(28개 `.md`, frontmatter
있는 실제 후보 15개)를 스크래치 디렉터리로 export해 `migrate scan`
실측(index.md/PROTOCOL.md 같은 frontmatter 없는 파일이 자동 제외되는지,
후보 개수가 수동 계산과 일치하는지 확인) - 기본 시드 타입(SP/DC/DN)으로
범위를 좁힌 매니페스트로 `migrate apply` 실측: 상태 직접 전이 성공
(SP draft→active, DC open→answered), 전이 불가 경고(DC open→applied,
2단계라 직접 전이 없음), 배치 내 링크 정상 연결(생성된 문서의
`backlinks`로 원본 링크 그래프와 대조해 정확히 일치 확인), 배치 밖
링크 경고, 잘못된 `docTypeCode`로 인한 개별 에러까지 전부 실제로
재현·확인. 재실행 시 중복 생성되는지도 실측으로 확인. 테스트 후
컨테이너/볼륨/이미지/스크래치 `.env`/CLI 자격증명/export한 concept
문서 사본 전부 정리.

## 로드맵 이후 보완: DocStatus/DocStatusTransition CLI/MCP/API 완전성 - 완료 (2026-09-10)

Phase 6(가이디드 마이그레이션) 실측 중 발견한 것 - `core/docTypes.ts`의
`addDocStatus()`/`addDocStatusTransition()`은 Phase 0부터 구현돼
있었고 `seedDefaultDocTypes()`(SP/DC/DN 기본값 심기)가 내부적으로
써왔지만 REST 라우트/CLI/MCP 어디에도 노출된 적이 없었다 - `docs
doctype-create`로 커스텀 타입을 만들면 상태가 0개라 그 타입으로 문서를
만들려는 순간 막혔다. "CLI/MCP 명령어 완전성" 원칙 위반을 로드맵 완료
후에 발견한 것이라 새 Phase 번호 없이 별도 보완으로 처리했다.

- `core/docTypes.ts`에 `getDocTypeById()`(소유권 확인용),
  `addDocStatusTransitionByCode()`(id 대신 코드로 전이를 정의하는 래퍼 -
  기존 `addDocStatusTransition()`은 `seedDefaultDocTypes` 내부용으로
  그대로 둠), `listDocStatusTransitions()`(지금까지 단일 상태발 전이만
  보던 `allowedNextStatuses()`와 달리 타입 전체 전이 목록) 추가.
- `POST /api/projects/:projectId/doc-types/:docTypeId/statuses`,
  `POST /api/projects/:projectId/doc-types/:docTypeId/transitions`
  (둘 다 owner + docTypeId가 실제로 그 프로젝트 소속인지 확인 -
  틀리면 404), `GET /api/doc-types/:docTypeId/transitions` 신설.
- CLI `doctype-status-add`/`doctype-transition-add`/
  `doctype-transitions` + MCP `doctype_status_add`/
  `doctype_transition_add`/`doctype_transitions` - 기존 `doctype-create`/
  `doctypes`가 flat 명령이라(다른 명령들처럼 하위 그룹이 아님) 같은
  스타일로 맞춤(기존 이름을 그룹으로 리네임하는 불필요한 변경은 안 함).

검증: 실제 스택(Postgres+Meilisearch+backend)에서 커스텀 타입을 만들어
"정의된 상태가 없습니다" 실패를 먼저 재현(고치기 전 증상 확인) →
`doctype-status-add`로 상태 2개(하나는 `--terminal`) 추가 →
`doctype-transition-add`로 전이 연결 → `doctype-transitions`로 조회 →
`docs new`로 그 타입 문서를 실제로 만들어 올바른 초기 상태(진입점)로
생성되는지, `docs transition`이 정의한 경로를 실제로 따라가는지,
정의 안 된 전이는 거부되는지까지 CLI로 끝까지 확인. 다른 프로젝트의
projectId로 남의 docTypeId를 겨냥하면 404가 오는지(소유권 우회 불가)
curl로 확인. MCP 도구도 stdio로 직접 호출해 CLI와 동일하게 동작하는지
대조(최초 시도에서 두 MCP 호출을 순서를 기다리지 않고 동시에 흘려보내
경쟁 상태로 하나가 실패했는데, 이는 테스트 스크립트가 응답을 기다리지
않고 요청을 몰아 보낸 문제였지 실제 코드 버그가 아님을 순차 재호출로
확인함 - 상태를 직접 조회해 실제로는 첫 호출만 반영되고 둘째 호출이
그 시점엔 아직 없던 상태를 참조해 정당하게 실패한 것이었다는 것까지
확인). 테스트 후 컨테이너/볼륨/이미지/스크래치 `.env`/CLI 자격증명
전부 정리.

## 전체 시스템 QA 패스 - 완료 (2026-09-10)

설계자 요청("QA를 하면서 개선작업을 하자") - 지금까지의 검증은 Phase
단위로 쪼개져 있었다(각 Phase가 자기 범위만 스크래치 스택으로 확인,
Gitea+EMQX+웹 UI+CLI+MCP가 전부 동시에 떠 있는 상태로 전체를 한 번에
훑은 적은 없었음). Docker Compose 풀스택(postgres+meilisearch+emqx+
gitea+backend, EMQX WS 포트까지 노출) 하나를 띄워 인증 → 기관/그룹/
프로젝트/멤버 권한 경계 → DocType/상태/전이 → 문서 CRUD/리비전/링크/
검색 → 질의응답 자동 전이 → 코멘트/보고서 → git 통합 → push 훅
자동화 → 메시징/실시간 → 템플릿 → 마이그레이션(회귀) → CLI/MCP
대칭성 → 웹 UI 종단까지 순서대로 실제로 실행하며 훑었다.

**발견해서 그 자리에서 고친 진짜 버그**: 세션(access+refresh 토큰
둘 다)이 만료되거나 무효해지면, `frontend/src/api/client.ts`의
`callWithRefresh()`가 토큰을 지우기만 하고 아무 데도 리다이렉트하지
않았다 - 코드 주석엔 "실패하면 로그인 화면으로 보내도록 호출부가
처리한다"고 적혀 있었지만, 실제로 그 리다이렉트를 구현한 화면이
프런트엔드 어디에도 없었다(문서로만 적힌 의도와 실제 동작이 어긋나 있던
경우). 그 결과 세션이 끊기면 사용자는 로그인된 것처럼 보이는 화면
뼈대(사이드바+로그아웃 버튼) 안에 갇힌 채 "Authorization 헤더(Bearer
토큰)가 필요합니다" 같은 날것의 백엔드 에러 문구만 화면마다 따로
보게 됐다. 브라우저에 일부러 무효한 토큰 쌍을 심어 재현한 뒤,
`callWithRefresh()`가 refresh까지 실패했을 때 한 곳에서
`/login`으로 리다이렉트하도록 수정(화면마다 반복 구현하지 않게) -
같은 시나리오로 재현해 이제 로그인 화면으로 정상적으로 보내지는지
확인.

**그 외 확인한 것**: 인증 엣지 케이스(토큰 없음/위조 토큰/refresh
토큰 회전 후 재사용 거부) 전부 정상. 멤버 role 경계(viewer가 owner·
editor 전용 동작 시도 시 403, 읽기는 정상) 정상. DocType/상태/전이가
문서 목록 필터·에디터 상태 전이 폼과 실제로 맞물리는지(보완 작업
이후 첫 웹 UI 회귀 확인) 정상. 문서 CRUD/리비전/링크·백링크/검색
왕복 정상. Question/Answer 자동 상태 전이 정상. 코멘트/보고서(링크
첨부 포함) 정상. git log/diff/show/tree/cat/put 왕복 + blame 명확한
미지원 에러 + 외부 저장소 연결 시 이력 조회 400 정상. push 훅 →
Gitea 실제 웹훅 발송(Gitea 배달 로그로 요청/응답 직접 대조) → 대기열
적재 → ack(중복 ack 거부까지)/done 정상(대기열이 한 번 비어보인 건
웹훅 비동기 배달을 `sleep 1` 뒤에 확인한 내 테스트 스크립트의 타이밍
문제였고, 재조회하니 정상 적재돼 있었음 - 앱 버그 아님). `message
wait` 롱폴이 실제로 발행 즉시(15초 타임아웃을 기다리지 않고) 반환되는지
정상. EMQX authn/authz 경계(비멤버 거부/멤버 허용/틀린 비밀번호 거부)
정상. 템플릿 스코프 우선순위(project override가 전역 기본값보다
우선) + `template deploy`가 실제로 resolve된(override) 내용을 커밋하는지
정상. 마이그레이션 회귀(scan→apply 소규모) 정상. CLI 69개 leaf
명령과 MCP 58개 도구를 전수 대조해 완전성 확인(README의 MCP 도구
개수 표기가 57개로 1개 적었던 것도 이번에 발견해 58개로 정정 - `git_diff`
가 응답 형식이 달라 `tool()` 헬퍼 대신 `server.registerTool()`을
직접 쓰는 바람에 이전 집계 스크립트들이 반복해서 놓쳤던 것). 웹 UI
전체(로그인/기관/그룹/프로젝트/프로젝트 상세/문서 목록·필터·에디터·
상태전이/소스 브라우저(편집→실제 커밋 대조)/변경 추적 뷰(git
로그+diff, 문서 리비전 diff)) 직접 클릭해서 확인 - 위 세션 만료
버그를 제외하면 전부 정상.

검증 방식 자체에 대한 메모: 이번 QA 중 Gitea 웹훅 배달 상세를 볼 때
Browser 도구의 스크린샷 캡처가 특정 페이지에서 계속 빈 화면을
반환하는 현상을 겪었다(페이지 자체는 `get_page_text`/`innerHTML`
길이로 확인하면 정상적으로 콘텐츠를 갖고 있었음 - 렌더링/캡처 레이어의
일시적 문제였지 앱 문제가 아님) - `javascript_tool`로 DOM을 직접
읽어 우회했다. 이 세션 내내 반복돼 온 "스크린샷 타이밍 아티팩트"
계열과 같은 종류의 도구 특이사항으로 기록만 해둔다.

테스트 후 컨테이너/볼륨/이미지/스크래치 `.env`/CLI 자격증명/브라우저
탭 전부 정리.

## QA 패스 2회차 - 완료 (2026-09-10)

설계자 요청("다른 영역도 QA 계속해줘")으로 1회차에서 안 다룬 영역을
이어서 훑었다: git 자격증명(저장·조회·삭제, 암호화 확인), 자격증명이
연결된 외부 git 연동, 기관/그룹 스코프 생성, Question/Answer 부분
답변 시 자동 전이 안 됨(모든 질문 답변 시에만 전이됨을 한 번 더 명확히
구분해 확인), 회원가입 검증(중복 아이디/이메일/비밀번호 길이), 코멘트
resolve 멱등성, 404/403 처리 일관성.

**실제로 발견해서 고친 버그 2건**:
- `core/projectGroups.ts`의 `createProjectGroup()`과
  `core/projects.ts`의 `createProject()` 둘 다, 스코프 id(`institutionId`/
  `projectGroupId`)로 **빈 문자열**을 받으면 검증을 건너뛰었다 - 코드가
  `if (institutionId)` 같은 truthy 체크만 하고 있어서, 빈 문자열은
  "안 넘김"이 아니라 "값이 있음"으로 취급돼 존재 확인 없이 그대로
  Prisma에 전달됐고, DB의 FK 제약 위반이 가공되지 않은 채(Prisma 내부
  에러 메시지 그대로) 클라이언트에 노출됐다. 실제 웹 UI(`ProjectGroupsView.vue`)는
  이미 빈 값을 `undefined`로 바꿔 보내고 있어서 이 경로로 못 들어가지만,
  CLI에 빈 환경변수를 그대로 흘려보내는 스크립트나 다른 API 호출자는
  걸릴 수 있는 경로였다. 두 함수 모두 진입 시점에 빈 문자열을
  `undefined`로 정규화하도록 수정 - 빈 institutionId/projectGroupId를
  다시 넘겨 이제 깨끗하게(institutionId: null 등으로) 처리되는지
  재검증.
- `core/auth.ts`의 `register()`에 비밀번호 최소 길이 검증이 전혀
  없었다 - 1글자 비밀번호도 그대로 통과했다(실측 중 발견). 이 시스템은
  개인 PC뿐 아니라 서버/클라우드 배포도 대상이라(README) 최소 길이가
  있어야 한다고 판단해 8자 미만을 명확한 에러로 거부하도록 추가 -
  7자/8자 경계로 재검증(7자는 거부, 8자는 통과).

**확인했지만 안 건드린 것(의도된 설계로 판단)**:
- `GET /api/projects/:projectId`처럼 존재하지 않는 프로젝트 id를
  조회하면 404가 아니라 403("최소 viewer 권한이 필요합니다")이 온다 -
  `requireProjectRole`이 멤버십부터 확인하는 구조라, 존재 여부와
  권한 없음을 구분하지 않는다. 프로젝트 id 존재 여부를 비멤버에게
  노출하지 않는 효과가 있어 의도치 않은 정보 노출 방지 쪽으로 보고
  손대지 않음.
- 문서 조회(`GET /api/documents/:trackingCode`)는 명시적으로 404를
  반환하지만, 같은 문서를 찾지 못하는 다른 여러 엔드포인트(`revisions`
  등)는 core 레이어가 던진 일반 Error가 공통 에러 핸들러를 거쳐 400이
  된다 - 이건 documents.get()의 명시적 404가 오히려 예외 케이스이고,
  "not found류 에러는 Error를 던지고 공통 핸들러가 400으로 응답"이
  Phase 0부터 수십 곳에서 이미 일관되게 쓰인 패턴이라(docType/문서
  타입/상태 등 거의 모든 "X를 찾을 수 없습니다" 에러가 이 경로) 이
  한 엔드포인트만 따로 고치면 오히려 일관성이 깨진다 - 시스템 전체의
  400/404 관례를 다시 설계하는 건 QA 중 가볍게 손댈 범위가 아니라고
  판단해 보류.
- 코멘트 `resolve`는 이미 resolved인 코멘트를 다시 resolve해도
  에러 없이 그대로 성공한다(멱등) - 문제로 보지 않음.
- 문서를 삭제하는 API/CLI/MCP가 어디에도 없다 - 의도된 설계로 보임
  (트래킹 코드는 영구 식별자로 취급되고, 문서는 감사 추적 성격이 강한
  레코드라 삭제 개념 자체가 없는 편이 설계 의도와 맞음). 버그로 보지
  않음.

**설계 판단이 필요해 고치지 않고 보고만 하는 것**: `core/docTypes.ts`의
`createDocType()`은 스키마상 institution/projectGroup/project 세 스코프
전부를 지원하도록 설계돼 있고 `TemplateFile`(CLAUDE.md/SKILL.md
템플릿)은 실제로 이 세 스코프를 CLI(`--project`/`--group`/
`--institution`)로 노출하지만, **DocType은 프로젝트 스코프 생성만
API/CLI/MCP에 노출돼 있다** - `POST /api/projects/:projectId/doc-types`
하나뿐이고 기관/그룹 스코프로 커스텀 문서 타입을 만들 방법이 없다.
지난 보완(DocStatus/DocStatusTransition 완전성)과 같은 종류의 "스키마엔
있지만 API 표면에 없는" 갭이지만, 이번엔 새 최상위 라우트(예:
`POST /api/institutions/:id/doc-types`, `POST /api/project-groups/:id/
doc-types`) + CLI 플래그 + MCP 인자 설계가 필요해 QA 중 즉석에서 고칠
범위를 넘는다고 판단 - 설계자에게 보고, 필요하면 별도 라운드로 진행.

테스트 후 컨테이너/볼륨/이미지/스크래치 `.env`/CLI 자격증명/브라우저
탭 전부 정리.

## 기관/그룹 스코프 DocType 생성 지원 - 완료 (2026-09-10)

QA 2회차에서 보고만 하고 안 고쳤던 항목 - 설계자가 이어서 만들어달라고
요청. `core/docTypes.ts`의 `createDocType()`/`listDocTypes()`는
institution/projectGroup/project 세 스코프를 스키마상 다 지원하도록
설계돼 있었지만, API/CLI/MCP엔 프로젝트 스코프 생성만 노출돼 있었다.

- **생성만으론 부족했다** - 라우트를 추가하는 것만으로는 실제로
  못 쓰는 반쪽짜리 기능이 된다는 걸 구현 전에 확인했다:
  `documents.ts`의 `createDocument()`가 쓰는 `findDocTypeByCode
  (projectId, code)`가 `WHERE projectId = X`로만 조회해서, 기관/그룹
  스코프 타입을 만들어도 그 프로젝트에서 `docs new`로 쓸 방법이
  없었다. `templates.ts`의 `resolveTemplate()`이 이미 하던 체인
  (project → 그 project의 group → 그 group의 institution, 구체적인
  쪽이 우선)을 `findDocTypeByCode()`에 그대로 옮겨왔다(같은 함수/
  시그니처라 유일한 호출부가 자동으로 혜택을 받음). `GET /api/projects/
  :projectId/doc-types`(문서 생성 화면 드롭다운이 쓰는 목록)도 새
  `listDocTypesForProject()`로 바꿔 상속된 타입까지 같이 보여주게
  했다 - TemplateFile과 달리 DocType엔 스코프 없는 전역 기본값
  개념이 없어 체인 끝에 전역 폴백은 없음.
- **인가는 templates.ts의 기존 선례를 그대로 따름** - 프로젝트
  Member는 projectId에만 연결되고 기관/그룹 단위 "관리자" 역할
  개념이 아직 없다(설치 단위 admin role은 범위 밖, 이미 Phase 1부터
  문서화된 한계). `PUT /api/templates`가 기관/그룹 스코프에
  `authenticate`만 요구하는 것과 똑같이 새 라우트도 그렇게 했다 -
  기존 프로젝트 스코프 라우트(`requireProjectRole("owner")`)는 전혀
  안 건드림.
- 새 라우트: `POST/GET /api/institutions/:institutionId/doc-types`,
  `POST/GET /api/project-groups/:groupId/doc-types`. 새 CLI
  `institution-doctype-create`/`institution-doctypes`/
  `group-doctype-create`/`group-doctypes` + 대응 MCP 4종.
- **실측 중 발견한 또 다른 버그(같이 고침)**: `createDocType()`도
  QA 2회차에서 `createProjectGroup`/`createProject`에 있던 것과 똑같은
  문제(빈 문자열 스코프 id가 검증을 건너뛰고 원본 Prisma FK 에러로
  샘)를 그대로 갖고 있었다 - 존재하지 않는 institutionId/
  projectGroupId를 만들기 전에 검증하도록 같이 고침.

**의도적으로 이번 범위 밖으로 둔 것**: `doctype-status-add`/
`doctype-transition-add`는 여전히 프로젝트 스코프 전용이다 - 그룹/기관
스코프 타입에 상태를 못 붙이므로, 만들어도 당장은 실제 문서 생성엔
못 쓴다(실측으로 확인 - 상태 없이 `docs new`를 시도하면 "정의된 상태가
없습니다"). 무한정 범위를 넓히지 않기 위한 판단 - SKILL.md에 알려진
제한으로 명시했다. 상태/전이까지 스코프 확장이 필요해지면 별도 라운드로.

검증: 기관 생성 → `institution-doctype-create`로 타입 생성 →
`institution-doctypes`로 조회. 그룹 생성(그 기관 소속) →
`group-doctype-create` → `group-doctypes` 조회. 그 그룹 소속 프로젝트를
새로 만들어 `doctypes <projectId>`가 프로젝트 자신의 SP/DC/DN + 그룹의
GX + 기관의 IX까지 5개를 전부 보여주는지 확인. **체인 조회 자체는
간접적으로 확실하게 검증**: 상태가 없는 그룹/기관 스코프 타입 코드로
`docs new`를 시도해 "타입을 찾을 수 없습니다"가 아니라 "정의된 상태가
없습니다"가 나오는지 확인(전자면 체인 조회 실패, 후자면 타입은 찾았고
그다음 단계에서만 막힌 것 - 실제로 후자가 나와 체인이 정확히 동작함을
확인) - 존재하지 않는 코드로는 실제로 "타입을 찾을 수 없습니다"가
나오는 것도 대조 확인. 존재하지 않는 institutionId/groupId로 생성
시도 시 원본 Prisma 에러가 아니라 명확한 에러 확인. 기존 프로젝트
스코프 문서 생성이 회귀 없이 그대로 동작하는지 확인. MCP 도구도 stdio로
직접 호출해 CLI와 동일한 결과 확인. 테스트 후 컨테이너/볼륨/이미지/
스크래치 `.env`/CLI 자격증명 전부 정리.

## 그룹/기관 스코프 DocType 상태/전이 지원 - 완료 (2026-09-10)

직전 라운드에서 의도적으로 남겨둔 마지막 조각 - 그룹/기관 스코프
DocType은 생성·조회·상속까진 됐지만 `doctype-status-add`/
`doctype-transition-add`가 프로젝트 스코프 전용이라 상태를 못 붙여서
실제 문서 생성엔 못 썼다. 설계자가 이어서 확장해달라고 요청 - 이걸로
그룹/기관 스코프 DocType이 생성부터 문서 생성까지 완전히 동작한다.

- 직전 라운드(생성/목록)와 정확히 같은 패턴을 그대로 반복 -
  `getDocTypeById()`가 institutionId/projectGroupId도 같이 반환하도록
  확장, `requireOwnedDocType`과 같은 모양의
  `requireOwnedDocTypeByInstitution`/`requireOwnedDocTypeByGroup` 추가,
  새 라우트 4개(`POST /api/institutions/:institutionId/doc-types/
  :docTypeId/statuses`+`/transitions`, `POST /api/project-groups/
  :groupId/doc-types/:docTypeId/statuses`+`/transitions` - 인가는
  `authenticate`만, 직전 라운드의 생성/목록 라우트와 동일한 수준),
  CLI 4개(`institution-doctype-status-add`/
  `institution-doctype-transition-add`/`group-doctype-status-add`/
  `group-doctype-transition-add`) + MCP 4개. 기존 프로젝트 스코프
  라우트/CLI/MCP는 전혀 안 건드림.
- SKILL.md(양쪽 사본)의 "알려진 제한" 문구를 지우고 새 명령 안내로
  교체.

검증: 기관→그룹→프로젝트 계층 준비(직전 라운드와 같은 구조) →
`institution-doctype-status-add`로 기관 스코프 타입에 상태 2개(하나는
`--terminal`) → `institution-doctype-transition-add`로 전이 연결 →
**이번엔 실제로 `docs new`로 그 프로젝트에서 그 타입의 문서를 만들어**
올바른 초기 상태(진입점)로 생성되는지, `docs transition`이 정의한
경로를 실제로 따라가는지, 정의 안 된 전이는 거부되는지까지 끝까지
확인(직전 라운드는 "타입은 찾지만 상태가 없어 막힘"까지만 확인했던
것과 달리, 이번엔 문서 생성 → 상태 전이까지 완주). 그룹 스코프도
동일하게 한 번 더 반복 확인. 다른 기관 id로 남의 docTypeId를 겨냥하면
404(소유권 우회 불가) 확인. 기존 프로젝트 스코프 `doctype-status-add`
회귀 없음 확인. MCP 도구 stdio 직접 호출로 CLI와 대조. 테스트 후
컨테이너/볼륨/이미지/스크래치 `.env`/CLI 자격증명 전부 정리.

## 웹 UI에서 DocType(프로젝트/그룹/기관 스코프) 관리 - 완료 (2026-09-10)

지금까지 CLI/MCP로만 되던 DocType 생성·상태·전이 관리를 웹 UI에서도
할 수 있게 해달라는 요청. 확인해보니 **어느 스코프도 웹 UI에 생성
UI가 아예 없었다** - `ProjectDetailView.vue`의 "문서 타입" 섹션이
목록을 읽기 전용 칩으로만 보여줄 뿐, 만들기/상태 추가/전이 추가는
프로젝트 스코프조차 CLI 전용이었다. 요청 문구의 "그룹/기관 스코프
**도**"대로 프로젝트 스코프만 골라 만들면 오히려 더 불일치했을 것이라
세 스코프 다 동일한 방식으로 관리 가능하게 만들었다 - CLI가 이미
세 스코프 다 대칭 지원하는 걸 웹 UI가 따라잡은 것.

- 백엔드는 라우트 하나만 추가 - `GET /api/projects/:projectId/
  doc-types`는 지난 라운드부터 "이 프로젝트가 쓸 수 있는 타입
  전체"(상속 병합)라, 관리 UI엔 "이 프로젝트가 직접 정의한 것만"이
  필요했다(상속된 타입은 그걸 실제 소유한 그룹/기관 화면에서
  관리해야 함) - 새 `GET /api/projects/:projectId/doc-types/own`
  (`listDocTypes({projectId})` 그대로 노출). 그룹/기관은 이미 "직접
  정의분만" 보는 라우트라 그대로 재사용.
- 프런트엔드는 재사용 컴포넌트 하나 - `frontend/src/components/
  DocTypeManager.vue`(props: `scope`/`scopeId`) - 스코프별 API 접두사만
  계산해서 쓰고 나머지 로직(타입 생성, 펼치면 상태/전이 목록+추가
  폼)은 공통이다. 세 화면에 그대로 임베드: `ProjectDetailView.vue`(기존
  읽기 전용 칩 목록은 그대로 두고 그 아래 새 섹션으로),
  `InstitutionsView.vue`/`ProjectGroupsView.vue`(각 행에 "문서 타입
  관리" 토글 버튼 - 펼치면 그 행 아래 인라인으로 표시).

검증: 실제 브라우저로 처음부터 끝까지 클릭해서 확인 - 기관 만들고
그 기관 "문서 타입 관리"에서 타입(`WU`) 생성 → 상태 2개(하나는 종료
뱃지 표시 확인) → 전이 연결(`pending → approved` 표시 확인) → 그
기관 소속 그룹 생성 → 그 그룹 소속 프로젝트 생성 → 프로젝트 상세
화면에서 "문서 타입"(위, 읽기 전용)엔 프로젝트 자신의 SP/DC/DN에 더해
기관에서 상속된 WU까지 보이고, "문서 타입 관리"(아래, 편집 가능)엔
프로젝트 자신의 SP/DC/DN만 보이는지(WU는 안 보임 - 상속과 직접 정의
구분이 실제로 지켜지는지) 확인 → 문서 목록 화면에서 타입 드롭다운에
WU가 실제로 나오는지, WU로 새 문서를 만들면 올바른 초기 상태(`pending`)
로 생성되는지, 상태 전이 폼으로 `approved`까지 실제로 전이되는지
전부 브라우저에서 직접 확인. 그룹 화면의 "문서 타입 관리" 패널도
별도로 펼쳐 정상 렌더링 확인. 테스트 후 컨테이너/볼륨/이미지/스크래치
`.env`/CLI 자격증명/브라우저 탭 전부 정리.

## 질의/답변(Question/Answer) + 코멘트 웹 UI - 완료 (2026-09-10)

로드맵/QA/DocType 확장까지 전부 끝난 뒤 "다음 기능"을 설계자에게
물어 우선순위를 받았다 - CLI/MCP에는 있지만 웹 UI에 전혀 없던 영역 중
질의/답변+코멘트를 선택받음(문서를 보다가 질문을 남기거나 답하려면
지금까지 터미널로 전환해야 했음).

코드를 보던 중 기존 버그 하나를 발견해 같이 고쳤다 - `POST
/api/documents/:trackingCode/questions`(질문 등록)와 `POST
/api/questions/:trackingCode/answer`(답변)가 `authenticate`만 검사하고
프로젝트 멤버십/역할을 전혀 확인하지 않았다(바로 옆 동급 기능인
코멘트 라우트는 `requireProjectRole("editor")`가 정확히 걸려 있었는데
질문/답변만 누락 - `requireProjectRole` 미들웨어가 `req.params.
projectId`를 요구하는데 이 두 라우트는 경로에 projectId가 없어서
애초에 못 걸었던 것으로 보임). 두 핸들러 안에서 `getDocument()`/
`getQuestionProjectId()`로 projectId를 구해 `getMemberRole`+
`roleSatisfies("editor")`를 인라인으로 검사하도록 고쳤다(기존
`requireOwnedDocType` 스타일의 인라인 체크 패턴 재사용). 실제 검증:
viewer 역할(및 비멤버)이 질문 등록/답변을 시도하면 403(수정 전이었다면
뚫렸을 것), owner는 여전히 정상 동작(브라우저로 전체 흐름을 실제
완주해 확인).

- `core/questions.ts`에 `listQuestions(documentTrackingCode)` 추가 -
  문서 하나의 전체 질문(open+answered)을 답변과 함께 순서대로 반환
  (기존 `listPendingQuestions`는 프로젝트 전체의 open만 봄). 새 라우트
  `GET /api/documents/:trackingCode/questions` + CLI `docs questions
  <trackingCode>` + MCP `question_list`(완전성 원칙 - 새 조회 경로라
  CLI/MCP도 같이 추가). 기존 `question`/`pending`/`reply` 명령/도구는
  시그니처 그대로.
- `frontend/src/components/QAPanel.vue`/`CommentsPanel.vue`(신규,
  `MessagesPanel.vue` 스타일 재사용) - 문서 에디터 화면
  (`DocumentEditorView.vue`)에 임베드. QAPanel은 질문 등록/답변 폼 +
  답변 시 `documentStatusTransitioned` 안내, `connectProjectRealtime`의
  `onChange`(`entity === "question"/"answer"`)를 구독해 다른 세션의
  변경도 반영. CommentsPanel도 같은 패턴(`entity === "comment"`).
- **구현 중 발견해 같이 고친 두 번째 문제**: QAPanel에서 답변으로 자동
  상태 전이가 일어나도 `DocumentEditorView.vue` 상단의 상태 배지가
  갱신되지 않았다(별개 컴포넌트라 상태 공유가 안 됨) - 처음엔 QAPanel이
  이벤트만 emit하고 부모가 문서를 다시 GET하는 방식으로 고쳤으나,
  Meilisearch 색인 반영 지연(이 세션에서 반복 확인된 known quirk) 때문에
  전이 직후 재조회하면 옛 상태가 잠깐 다시 보이는 걸 실측으로 확인 -
  재조회 대신 답변 API 응답에 이미 있는 `documentStatusTransitioned`
  값을 그대로 emit해 부모가 즉시 반영하도록 수정(재조회 자체를
  없앰 - 지연에 영향받지 않음). 실제 브라우저로 답변 직후 새로고침
  없이 배지가 바뀌는지 DOM 직접 조회로 확인.
- `ProjectDetailView.vue`에 "답변 대기 질문" 섹션 추가(기존 `GET
  /api/projects/:projectId/pending` 그대로 재사용, 백엔드 변경 없음) -
  각 항목이 해당 문서로 링크. `docs pending <projectId>`가 프로젝트
  전체를 보여주는 것과 대응되는 웹 화면이 지금까지 없었음.

검증: CLI(`docs question`/`questions`/`reply`)·MCP(`question_list`
stdio 직접 호출)·웹 UI 세 경로로 같은 질문/답변 스레드를 만들어
결과가 동일한지 대조. 코멘트 등록·해결도 웹에서 실제 클릭으로 확인.
`npx tsc --noEmit`(backend)/`vue-tsc -b`(frontend) 클린 확인.

## 사이드바 문서 탐색기 개편 - 완료 (2026-09-10)

설계자가 실행 중인 화면에 직접 주석을 달아 전달한 요청 - 좌측
사이드바가 기관/그룹/프로젝트로 가는 평평한 링크 3개뿐이라, 프로젝트
안에 들어가도 "지금 어느 프로젝트에 있는지"가 화면 어디에도 안
보였다(`DocumentsView.vue`는 `<h1>문서</h1>`만 있고 프로젝트 이름이
없었음). 순수 프런트엔드 레이아웃/라우팅 개편 - 새 REST 엔드포인트
없이 기존 `ProjectDetailView.vue`/`DocumentsView.vue`가 쓰던 API만
재사용.

- **`frontend/src/router/index.ts`**를 평평한 형제 라우트에서
  `/projects/:id` 부모 + 자식(홈/문서/문서 에디터/소스 코드/변경 추적/
  설정) 중첩 구조로 전환 - Vue Router 4가 자식의 `props: true`에 부모가
  매칭한 `:id`까지 포함한 전체 `route.params`를 넘기므로 기존 뷰들의
  `defineProps<{ id: string }>()`는 코드 변경 없이 그대로 동작.
- **`ProjectShellView.vue`**(신규, 부모 라우트 컴포넌트) - 프로젝트
  이름 + 탭형 툴바(홈/문서/소스 코드/변경 추적/설정, `router-link-
  exact-active`로 활성 탭 표시) + `<router-view />`.
- **`AppLayout.vue`**에 조건 분기 - `route.params.id`가 있으면(프로젝트
  컨텍스트) 사이드바가 새 `DocumentExplorer.vue`(문서 타입별 그룹핑
  트리 + 그룹 헤더의 "+"로 인라인 문서 생성 + 현재 문서 강조 +
  `connectProjectRealtime`로 실시간 갱신)로 바뀌고, 맨 위 "← 전체
  프로젝트" 링크로 돌아가면 기존 기관/그룹/프로젝트 평평한 nav가
  복귀한다(별도 상태 없이 라우트만으로 분기 - "관리 메뉴"와 "문서
  탐색기"가 같은 사이드바 자리를 공유).
- **`ProjectDetailView.vue` 분리**: 설계자 확인에 따라 `ProjectHomeView.
  vue`(메시징 패널 + 답변 대기 질문만)와 `ProjectSettingsView.vue`
  (git 저장소 상태 + 문서 타입 관리 + 멤버 관리, 신규)로 나눴다 - 옛
  파일은 삭제.
- `DocumentsView.vue`/`SourceBrowserView.vue`/`ChangeTrackingView.vue`의
  자체 `<h1>`은 제거(이제 `ProjectShellView`가 프로젝트 이름을 공통으로
  보여줌) - 나머지 로직은 안 건드림.
- **구현 중 발견해 같이 고친 기존 버그**: `DocumentEditorView.vue`가
  `fetchDocument()`의 404 재시도(Meilisearch 색인 반영 지연 대응, 이미
  known quirk)가 실패했을 때 에러 메시지를 `v-else-if="doc"` 블록
  안에서만 보여주고 있어서, `doc`이 끝내 null이면 에러 텍스트 없이
  완전히 빈 화면이 떴다(사이드바 트리에서 방금 만든 문서로 바로
  이동하는 흐름을 실측하다 재현 - 실제로 문서는 만들어져 있었는데
  화면만 비어 있었음). `error && !doc` 케이스를 별도 분기로 추가해
  고침.

검증: 실제 브라우저로 로그인 → 프로젝트 밖에서 평평한 nav 확인 →
프로젝트 진입 시 사이드바가 문서 탐색기로 전환되는지 → 그룹 헤더
"+"로 문서 생성 → 트리에 반영되고 자동으로 에디터 이동 확인(이 과정에서
위 버그를 실측으로 발견) → 다섯 탭 전부 클릭해 올바른 화면 + 활성
스타일 확인 → "설정" 탭에 git/문서타입/멤버 관리가 전부 정상 렌더링
(멤버 목록까지 실제 표시 확인) → "홈" 탭엔 메시지+답변 대기만 → "←
전체 프로젝트"로 돌아가면 평평한 nav 복귀 → `InstallConfig.
institutionsEnabled`를 DB에서 직접 껐다 켜서 기관 메뉴 숨김/복귀
회귀 확인 → 문서 에디터의 QAPanel/CommentsPanel(직전 라운드) 새
레이아웃에서도 정상 렌더링 재확인. `vue-tsc -b`/`npm run build`
클린 확인.

## 웹 UI git 저장소 연결(3가지 방식) + DocType 자연어 지침 - 완료 (2026-09-10)

"다음 단계" 1번(웹 UI git 저장소 생성)과 2번(DocType 지침 필드)을
같이 진행해달라는 요청 - 1번은 대화 중 피드백으로 범위가 "생성 버튼
하나"에서 "연결 방식 3가지(생성/이주/연동) + 인증 필요 시 자동
재시도 + 외부-권위 저장소와의 동기화 제안" 전체 재설계로 크게
넓어졌다.

### git 저장소 연결 3가지 방식

- **옵션 1(새 저장소 생성)**: 기존 `linkSelfHostedRepo` 그대로(빈
  Gitea 저장소).
- **옵션 2(외부 저장소 완전 이주)**: `linkSelfHostedRepo`에
  `importFrom` 파라미터 추가 - `gitea.migrateRepo(slug, url,
  {mirror:false})`로 히스토리를 통째로 가져온 독립 저장소로 시작.
  결과는 옵션 1과 똑같이 `provider:"self_hosted"`(연결 시점 한 번의
  선택일 뿐 그 이후 동작은 완전히 동일하므로 구분 저장 안 함).
- **옵션 3(외부 저장소를 주된 저장소로 연동)**: 신규
  `linkExternalAsPrimary()`(기존 `linkExternalRepo` 대체) - Gitea에
  미러(`${slug}-mirror`, `mirror:true` - 외부를 주기적으로 pull하는
  읽기 전용 사본)와 작업 저장소(`${slug}-work`, `mirror:false` - 이
  시스템이 실제로 커밋하는 곳) 두 개를 만든다. 두 슬러그는 새 DB
  컬럼 없이 `slugForProject()`에서 결정론적으로 파생. `provider`에
  새 값 `"external_linked"` 추가. 신규 `requireGiteaWorkingSlug()`
  (기존 `requireSelfHostedRepo` 대체)가 provider별로 실제 슬러그를
  돌려줘서, git log/diff/show/tree/file(GET·PUT)/template-deploy
  9개 라우트 전부가 `external_linked` 프로젝트에서도 동작하게 됨
  (예전엔 "외부 호스팅 미지원" 400이었음 - 이번에 해소된 기존 한계).

### 인증이 필요한 외부 저장소

옵션 2/3에서 비공개 저장소를 자격증명 없이 시도하면 Gitea의 migrate
API가 실패한다 - `gitea.ts`에 `GitAuthRequiredError`를 신설해 401/403/
인증 관련 본문 패턴을 구분해서 던지고, API 레이어(`POST .../git/link`,
`.../git/link-external`)가 이걸 `422 {error:"git_auth_required",
hostPattern}`으로 응답한다(401이 아니라 422를 쓴 이유 - `client.ts`의
`callWithRefresh()`가 모든 401을 "액세스 토큰 만료"로 해석해 리프레시를
시도하는 기존 인터셉터와 충돌하는 걸 피하려고, 구현 중 발견). 웹 UI
(`GitRepoPanel.vue`, 신규)는 이 응답을 보면 그 자리에 자격증명 입력
폼을 띄우고, 저장(`POST /credentials` - 기존 `addGitCredential`,
AES-256-GCM 암호화 재사용) 후 같은 요청을 자동 재시도한다.

**구현 중 발견해 같이 고친 버그**: Gitea의 migrate API는 저장소 레코드를
먼저 만들고 그다음 clone을 시도한다 - clone이 인증 실패로 죽으면 빈
stub 저장소만 남는다. 이 상태로 같은 slug(프로젝트당 결정론적이라
항상 같음)를 재시도하면 "이미 존재합니다"로 막혀서, 자격증명을 새로
넣고 재시도해도 **영원히 실패**하는 심각한 버그였다(자격증명 프롬프트
전체 UX가 사실상 못 쓰는 상태). `gitea.deleteRepo()` 신설 +
`migrateRepoOrCleanUp()` 래퍼로 실패 시 stub을 지우고 원래 에러를
던지도록 고침 - 옵션 3은 미러/작업 두 저장소 중 하나만 실패해도 둘 다
정리(절반만 연결된 상태 방지). 실제 Gitea 컨테이너에 비공개 저장소를
대상으로(같은 Gitea 인스턴스를 임시로 "외부"인 척 가리키는 방식 -
`GITEA__migrations__ALLOW_LOCALNETWORKS`를 검증 중에만 켰다가 원복)
"인증 없이 시도 → 422 확인 → stub 정리 확인 → 자격증명 저장 → 재시도
→ 성공"까지 웹 브라우저로 전체 흐름을 실측했다.

### 동기화 상태 확인 - 큐 메커니즘

**설계자 지적으로 재설계**: Gitea의 mirror-sync 트리거는 비동기
큐잉이다(호출이 성공해도 실제 pull은 아직 안 끝났을 수 있음) - 처음엔
"트리거 → 즉시 비교"로 구현했는데, 이러면 옛 상태를 읽을 위험이 있다는
지적을 받고 요청/조회를 분리했다: `POST .../git/sync-status`가 트리거만
하고 즉시 반환(`scheduled`/`already-scheduled` - 이미 진행 중이면 새로
트리거 안 함, 메모리 맵 `syncStateByProject`로 프로젝트당 하나만
추적), 백그라운드에서 `mirror_updated` 타임스탬프가 실제로 바뀔 때까지
짧게 폴링(최대 20초)한 뒤 미러/작업 저장소 전체 트리(`gitea.
getFullTree()` - 재귀 blob 목록, 신규) 비교 결과를 캐시. `GET .../git/
sync-status`가 그 캐시를 조회(`none`/`pending`/`ready`). 웹 UI 버튼은
`pending`이면 "동기화 확인 예정됨..."으로 비활성화되고 1.5초 간격으로
자동 폴링, 화면 진입 시에도 이미 진행 중인 요청이 있으면 처음부터
비활성 상태로 보여준다. CLI(`docs git sync-status`)/MCP
(`git_sync_status`)는 트리거 후 `ready`가 될 때까지 명령 자체가
대기했다가 결과를 반환(`docs message wait`와 같은 "한 번의 호출로
비동기를 기다리는" 패턴). `docs git sync-proposal --out <dir>`는 달라진
파일을 로컬에 그대로 써준다(직접 커밋·PR은 설계자 몫 - 자동 PR 생성은
범위 밖, 항상 사람 검토를 거치게 하려는 의도).

### DocType 자연어 지침

`DocType`에 nullable `guideline` 컬럼 추가(3드라이버 스키마) -
`createDocType()`에 선택 파라미터로, 신규 `setDocTypeGuideline()`으로
나중에 수정도 가능(빈 문자열은 지우기). 세 스코프 생성 라우트/CLI(
`--guideline` 옵션)/MCP에 전부 반영, 새 PUT 라우트 3개(스코프별) +
CLI(`*-doctype-guideline-set`)/MCP(`doctype_guideline_set*`) 3개씩.
`DocTypeManager.vue`에 생성 폼 textarea + 펼침 패널에 보기/수정 UI.
기본 시드 타입(SP/DC/DN) 세 개에도 예시 지침을 채워 새 프로젝트를
만들자마자 기능을 보여줌. 실제로 쓸모 있으려면 생성 시점에 보여야
하므로 `DocumentsView.vue`/`DocumentExplorer.vue`(사이드바 인라인
생성)에 선택한 타입의 지침을 힌트로 노출.

**구현 중 발견해 같이 고친 버그**: 옵션 3 연동 성공 후 보여주는
"`docs migrate scan`으로 가져올 수 있습니다" 안내 문구가 템플릿상
"연결 안 됨" 분기 안에만 있어서, 연결이 실제로 성공하는 순간
`v-else-if="gitRepo"` 분기로 바뀌며 안내가 아예 안 보이는 죽은
코드였다 - 연결됨 분기로 옮겨서 고침(실제 브라우저로 옵션 3 연동을
왕복하다 발견).

검증: 실제 Gitea 컨테이너 + 공개 GitHub 저장소(octocat/Hello-World)로
옵션 1/2/3 전부 실측(옵션 2는 실제 커밋 히스토리 3개가 그대로
들어왔는지, 옵션 3은 미러/작업 저장소 둘 다 실제로 생성됐는지 Gitea
API로 대조) → 소스 에디터로 작업 저장소 파일 수정·커밋 → 동기화 상태
확인이 실제로 `changed`를 잡아내는지 → 동기화 제안이 수정한 내용
그대로를 반환하는지 → CLI `sync-status`/`sync-proposal --out`, MCP
`git_sync_status`/`git_sync_proposal`이 웹과 동일한 결과를 내는지
대조. 인증 필요 케이스 전체 흐름(422 → stub 정리 확인 → 자격증명 저장 →
자동 재시도 → 성공)을 옵션 2/3 둘 다 curl과 실제 브라우저 양쪽으로
왕복 실측. `npx tsc --noEmit`(backend), `vue-tsc -b`+`npm run
build`(frontend) 클린 확인.

## 최초 설치 시 고정 관리자 계정 시드 - 완료 (2026-09-11)

설계자 지시 - 최초 설치(계정이 하나도 없는 빈 DB) 시 관리자 계정이
항상 `admin`/`12345678`로 만들어져 있어야 한다("보안 지침과 달라도
무조건 이렇게 생성되어 있어야 해" - 무작위 초기 비밀번호 발급 같은
일반적인 보안 관행보다 고정값을 명시적으로 우선). 작게 스코프된
변경이라 별도 계획 라운드 없이 바로 구현 - 진행 전 트레이드오프만
짧게 언급(고정된 기본 관리자 자격증명은 설치 직후 바꾸기 전까지 그
설치에 먼저 접근하는 누구나 전체 권한을 가진다는 뜻 - 로컬/개인 설치
전제라는 설계자 판단을 그대로 따름).

`core/auth.ts`에 `seedDefaultAdminAccount()` 추가 - `User` 테이블이
비어 있을 때만(`userCount > 0`이면 즉시 반환, 설계자가 이미 직접
가입했거나 이 시드가 이미 실행된 뒤라면 절대 안 건드림) 기존
`register()`를 그대로 호출해 `admin`/`12345678` 계정을 만든다(비밀번호
해싱 등 기존 검증 로직 재사용 - 새 경로 안 만듦, 정확히 8자라
`MIN_PASSWORD_LENGTH` 검증도 그대로 통과). `api/server.ts`의 `main()`이
`seedDefaultTemplates()` 바로 다음에 호출.

검증: 실제 Docker Compose 스택(postgres+meilisearch+backend)을 빈 DB로
기동 → `admin`/`12345678`로 실제 로그인 성공 확인 → DB에 `admin` 계정이
정확히 하나만 있는지 확인(중복 시드 안 됨) → 일반 `POST /api/auth/
register`가 여전히 정상 동작하는지(회귀 없음) 확인. `npx tsc --noEmit`
클린 확인.

## 기본 DocType 세트 교체 - 완료 (2026-09-11)

설계자가 새 프로젝트 생성 시 심어지는 기본 문서 타입 세트를 지정 -
기존 3종(SP/DC/DN)을 아래 6종으로 완전히 교체(추가가 아니라 대체):

| 코드 | 이름 | 상태 흐름 |
|---|---|---|
| `SP` | 설계 명세 | draft → active → archived(종료) |
| `DC` | 결정 요구사항 및 요청 | open → answered → applied(종료) |
| `PL` | 실행 계획 | draft → active → done(종료) |
| `PD` | 실행 결과 보고 | final(단일 종료 상태) |
| `RM` | 지시 사항/지침 | active → archived(종료) |
| `DS` | 설계 결정 | open → decided(종료) |

`core/docTypes.ts`의 `DEFAULT_TYPES`(`seedDefaultDocTypes()`가 새
프로젝트 생성 직후 심는 배열) 교체 - 설계자는 코드+라벨만 지정했고
상태 흐름/지침 문구는 기존 3종의 관례(짧은 draft→active→종료 또는
단일 종료 상태)를 따라 새로 설계했다. `SP`의 기존 지침("설계 결정과
그 근거를...")은 새로 추가된 `DS`(설계 결정)가 그 역할을 더 정확히
맡게 돼 `DS`로 옮기고, `SP`는 "무엇을 만들고 있는지 명세한다"는
본래 의미에 맞는 문구로 교체. `PD`는 기존 `DN`(결과 보고)의 지침
문구를 그대로 계승(같은 역할, 코드/이름만 바뀜). `.claude/skills/
claude-native-workflow/SKILL.md`(+ seed-templates 사본)의 "추적 코드
명시" 규칙과 "문서 타입/상태 흐름" 절도 새 6종 표로 갱신 - 여기 있는
건 v2 시스템 자신을 개발할 때 참고하는 실제 라이브 문서라 갱신
필요(반면 `DESIGN-NOTES.md`의 과거 라운드 기록에 남아있는 "SP/DC/DN"
언급들은 그 시점의 역사적 사실이라 그대로 둠 - 소급 수정 안 함).

검증: 스크래치 스택에서 새 프로젝트 생성 → `GET .../doc-types`로 6종
전부 정확한 코드/라벨/지침으로 심어졌는지 확인 → `PL`/`DS`의 상태
목록이 설계한 흐름과 일치하는지 대조 → `RM` 타입으로 실제 문서 생성 →
초기 상태가 진입점(`active`)으로 정확히 잡히는지까지 실측(한글 응답
내용은 Windows Git Bash의 인라인 curl 파이프 출력이 아니라 파일로
저장한 뒤 Read 도구로 확인 - 이 세션에서 반복 확인된 터미널 표시
아티팩트를 실제 버그로 착각하지 않기 위해). `npx tsc --noEmit` 클린
확인.

## "기관"(Institution) → "팀"(Team) 전체 리네임 - 완료 (2026-09-11)

처음엔 "웹 UI 표시 텍스트만 교정"으로 좁게 추정했으나(바로 위 항목의
추정), 설계자가 명시적으로 범위를 넓혔다 - "사용자에게 보이는 라벨만
교정하는 것이 아니라 전체를 수정하는거야". DB 스키마(모델/컬럼명)부터
REST 라우트, CLI 명령어 이름, MCP 도구 이름, 프런트엔드 라우트/파일/
변수명까지 `institution`/"기관" 개념 전체를 `team`/"팀"으로 바꿨다 -
계층은 이제 Team → ProjectGroup → Project(`ProjectGroup`은 그대로,
"기관→팀"만 대상).

**이 라운드는 이 세션이 지켜온 "기존 CLI/MCP 명령 시그니처는 안
바꾼다" 원칙의 의도적 예외다** - 설계자가 명시적으로 전체 리네임을
요구했으므로 `institution-*` CLI 명령/`*_institution` MCP 도구
이름 자체가 `team-*`/`*_team`으로 바뀌었다(하위 호환 유지가 목적이
아닌 유일한 라운드).

**스키마는 마이그레이션 스크립트 없이 깨끗하게 리네임**했다 - 이
저장소는 아직 실제 영속 배포 없이 매 라운드 스크래치 Docker 스택만
써왔으므로(`docker compose down -v`로 항상 정리), `Institution`→
`Team`, `institutionId`→`teamId`, `InstallConfig.institutionsEnabled`→
`teamsEnabled`를 3드라이버 스키마 전부에 데이터 마이그레이션 없이
반영했다. 실제로 이 시스템을 설치해 데이터가 쌓인 배포가 있다면 이
변경으로 깨진다(일반 공개 전 단계라는 판단하에 수용).

**리네임 범위**: `backend/prisma/schema.{postgres,mysql,sqlite}.prisma`
(model/column/index), `core/institutions.ts`→`core/teams.ts`(파일명
포함, `Institution`→`Team`/`createInstitution`→`createTeam`/
`listInstitutions`→`listTeams`/`setInstitutionsEnabled`→
`setTeamsEnabled`), `core/installConfig.ts`, `core/projectGroups.ts`,
`core/docTypes.ts`(ScopeInput/체인 로직), `core/templates.ts`
(TemplateScopeInput/resolveTemplate 체인), `core/projects.ts`/
`core/tracking.ts`(주석 + 실제 쿼리 필드), `api/server.ts`(import,
`/api/institutions*`→`/api/teams*` 7개 라우트, `requireOwnedDocTypeByInstitution`→
`requireOwnedDocTypeByTeam`, 요청/응답 바디 필드), `cli/index.ts`
(`institution-create`→`team-create`, `institutions`→`teams`,
`institution-doctype-*` 5개→`team-doctype-*`, `--institution`→`--team`
플래그), `mcp/server.ts`(`institution_create/list`→`team_create/list`,
`doctype_*_institution` 5개→`doctype_*_team`, 한글 title/description),
프런트엔드(`InstitutionsView.vue`→`TeamsView.vue` 파일명+내용,
`router/index.ts`, `AppLayout.vue`, `ProjectGroupsView.vue`,
`DocTypeManager.vue`의 `scope` prop 타입), 문서(`SKILL.md` 양쪽 사본,
`README.md`).

**사전 준비(직전 라운드에서 이미 완료)**: 웹 UI 표시 텍스트("기관"→
"팀" 한글 라벨)는 이번 라운드 착수 전에 이미 교정돼 있었다(narrow-scope
시도 중 완료) - 이번 라운드는 그 위에 식별자 전체 리네임을 얹었다.

검증: `npm run db:generate`(3드라이버) 클린 → `npx tsc --noEmit`
(backend) 클린 → `vue-tsc -b && npm run build`(frontend) 클린(엔드투엔드
브라우저/CLI/MCP 재기동 검증은 다음 세션에서 이어서 진행 예정 - 컴파일
레벨 검증까지 이 라운드에서 완료).

## 설계자 프로필 + 프로젝트 숨김/팀장 + 문서 세부 권한/상태/메시지/QA 개편 - 완료 (2026-09-11)

설계자가 한 번에 11개 묶음(A~K)으로 요청한 대규모 라운드 - 스키마
(User.phone/emailVisible/phoneVisible, Team.admins, TeamAdmin,
Project.hidden/hiddenBy/folders/accessOverrides, DocStatus.guideline,
Document.folderId/questionReferences/accessOverrides, Question.askedBy/
refs, Message.deliveredAt, Folder, DocAccessOverride 신규/확장) →
core(permissions.ts/folders.ts/teamAdmins.ts/activity.ts 신규,
docTypes.ts/questions.ts/messages.ts/auth.ts/projects.ts/documents.ts
확장) → API → CLI/MCP → 프런트엔드(신규 컴포넌트 9개, 기존 뷰 다수
개편) 전 계층에 걸친 변경.

**핵심 내용**(SKILL.md/README.md 본문이 상세 - 여기서는 검증 중 발견한
버그와 설계 결정만 기록):

- A) `[userId]` 참조 + 프로필 화면 + 활동 이력, B) 프로젝트 숨김 +
  팀장, C) 문서/타입/프로젝트 3단계 세부 권한 + `notices` 프롤로그,
  D+I) 상태 콤보박스 + 표준 상태 코드 6종 고정(`draft`로 못 돌아가는
  절대 규칙), E+K) 메시지 대기/기록 분리 + 장애 복구용 `message
  recent`, F) 질의/답변 3단계 재정의(`open→pending→resolved`) + 참고
  문서 태깅, G) 코멘트 AI 격리(CLI/MCP 완전 제거, 웹은 유지), H) 읽기/
  편집 모드 분리 + 다이얼로그 미리보기, J) 문서 정리용 폴더(AI 완전
  비가시).

**구현 후 실측 검증 중 발견하고 그 자리에서 고친 버그 5건** (전부
스크래치 SQLite+실제 CLI/MCP/브라우저 왕복으로 재현 후 수정·재검증):

1. **`DocAccessOverride`의 scope FK가 Prisma 기본 `SetNull`로 남아있던
   문제** - `documentId`/`docTypeId`/`folderId`에 `onDelete`를 명시하지
   않아, 문서를 삭제하면 그 문서를 겨냥한 오버라이드 행이 삭제되는 게
   아니라 `documentId`만 `null`로 바뀌어 **"문서 하나에 준 delete=true
   오버라이드"가 조용히 "프로젝트 전체에 대한 delete=true 오버라이드"로
   승격**되는 심각한 권한 확대 버그였다(실측: 문서별 삭제 허용을 준
   viewer 계정이 그 문서를 지운 뒤, 전혀 다른 문서도 삭제할 수 있게
   됨). 세 FK 모두 `onDelete: Cascade`로 수정(3드라이버 스키마 전부) -
   대상이 없어진 오버라이드는 행 자체가 삭제되는 게 맞는 의미.
2. **`core/folders.ts`의 폴더 쓰기 권한 오버라이드를 실제로 설정할
   API가 없었음** - `resolveFolderWritePermission()`은 처음부터
   `DocAccessOverride.folderId`를 읽도록 설계됐지만, 그 값을 쓰는
   라우트(`PUT /api/folders/:folderId/access`)가 애초에 안 만들어져
   있어 "상위 폴더 쓰기 권한 없으면 하위 폴더 생성 불가" 요구사항을
   검증할 방법 자체가 없었다. 새 라우트를 추가(owner 전용, `core/
   folders.ts`에 `getFolderById()` 신규)해 실측까지 완료.
3. **`core/questions.ts`의 `listPendingQuestions`/`answerQuestion`/
   `acknowledgeQuestion`이 `refs: []`를 하드코딩** - `QuestionReference`
   조인 테이블에서 실제로 조회하는 곳은 `listQuestions()`(문서별 전체
   스레드) 하나뿐이라, `docs pending`/답변/ack 응답에는 태깅한 참고
   문서가 항상 빈 배열로 나왔다. 세 함수 모두 실제 join 조회로 수정.
4. **프런트 라우트 `/users/:id`와 `/projects/:id`가 파라미터 이름
   `id`를 공유** - `AppLayout.vue`가 `route.params.id`의 존재만으로
   "프로젝트 컨텍스트"를 판단해서, 프로필 화면(`/users/:id`)을 열 때마다
   그 userId를 프로젝트 id로 오인해 `DocumentExplorer`가 깨진 API
   호출("최소 viewer 권한 필요" 에러)을 반복했다 - 모든 프로필 화면에서
   재현됨. `/projects/:id` 라우트에 `meta: { projectContext: true }`를
   달고 `AppLayout.vue`가 그 메타를 같이 확인하도록 수정.
5. **`saveDocumentBody()`/`transitionDocumentStatus()`/`createDocument()`가
   `DocumentDetail` 반환값에 `createdBy`를 안 담음** - 문서를 처음 열
   때(GET, 검색 인덱스 경유라 `createdBy` 포함)는 작성자 링크가 정상
   이지만, 저장/상태전이 후 프런트가 그 응답으로 로컬 상태를 갱신하면
   작성자 링크가 `/users/undefined`로 깨졌다(새로고침하면 다시 정상 -
   PUT 응답만의 문제였음). `DocumentDetail`에 `createdBy` 필드를
   추가하고 세 함수 모두 채우도록 수정.

추가로 `AccessControlManager.vue`의 오버라이드 목록 라벨 로직이
`folderId`를 확인하지 않아 폴더 스코프 오버라이드를 "공통"(프로젝트
전체)으로 잘못 표시하던 문제도 발견해 수정(관리자가 실제보다 넓은
제한을 건 것으로 오인할 수 있는 UI 버그).

**검증**: SQLite 스크래치 DB + 실제 백엔드 프로세스로 A~K 전부 CLI
왕복 실측(계정 2개로 owner/editor 역할 분리, 팀장 등록, 숨김 프로젝트
가시성, 세부 권한 차단·허용, 폴더 CRUD+권한+AI 비가시성, 메시지
대기/기록/최근조회, 질의 3단계+ack), MCP stdio로 도구 목록(85개,
comment_*/folder_* 없음 확인) + notices 프롤로그 별도 블록 확인,
브라우저로 UserProfileView/DocumentEditorView(읽기·편집·XSS 새니타이즈·
상태콤보)/DocumentsView+FolderTree/MessagesView/AccessControlManager
실제 클릭 검증. `npx tsc --noEmit`(backend)/`npm run build`
(frontend, `vue-tsc -b` 포함) 클린.

## API 키 3종(팀/프로젝트/개인) 신원 위임 인증 - 완료 (2026-09-11)

REST API/CLI/MCP/웹 UI 전반의 인증 수단으로 API 키를 추가했다 - 팀
관리 키(팀장 전용, 팀 소속 모든 프로젝트)/프로젝트 개인 키(멤버 누구나,
그 프로젝트만)/개인 키(누구나, 로그인과 동등) 3종 전부 "만든 설계자의
신원을 그대로 대행"하되 접근 범위만 다르다.

**핵심 아키텍처 결정** - 스코프 제한을 라우트 각각에 끼워 넣는 대신,
`node:async_hooks`의 `AsyncLocalStorage`(`core/requestScope.ts`, 이
저장소 최초의 ALS 사용 사례)로 "지금 이 요청이 어떤 키로 인증됐는가"를
요청 전체에 전파하고, 이미 이 시스템의 모든 권한 판정이 최종적으로
거쳐가는 세 함수(`core/members.ts`의 `getMemberRole()`,
`core/teamAdmins.ts`의 `isTeamAdmin()`, `core/permissions.ts`의
`resolveEffectivePermission()`/`resolveFolderWritePermission()`) 안
에서만 게이트를 걸었다. `core/projects.ts`의 `listProjects()`에도
같은 필터를 추가해 스코프 밖 프로젝트는 목록에서도 숨겼다. 이 다섯
지점만 고쳐서 `requireProjectRole` 미들웨어를 포함해 문서/폴더/질문/
코멘트/메시지/git 라우트의 기존 인라인 권한 체크 17곳 이상이 코드
변경 없이 자동으로 스코프 제한을 받는다 - 라우트 수십 개에 개별
체크를 끼워 넣는 접근보다 누락 위험이 구조적으로 없다는 게 핵심
근거(설계자가 "치명도가 높다"고 명시한 요구에 부합). `resolveEffective
Permission`/`resolveFolderWritePermission`에는 추가로 방어적 이중
장치를 넣었다 - 이 시스템은 "프로젝트 멤버가 아닌 사용자에게도 개별
오버라이드를 걸 수 있다"는 기존 설계가 있어, `getMemberRole`이 스코프
때문에 null을 반환해도 오버라이드 조회 자체는 별도로 돌 수 있었다.
실측으로 이 우회 시나리오(스코프 밖 프로젝트에 오버라이드가 걸려
있는 사용자의 키로 접근 시도)를 직접 재현해 막혔는지 확인했다.

스코프가 없는(project/team) 라우트 - `PUT /api/auth/me`, git
자격증명 3종, 팀/그룹/프로젝트 생성, 키 관리 자체 - 는 새
`requireUnrestrictedScope` 미들웨어로 명시적으로 막았다(범위가 좁은
키가 유출돼도 그걸로 더 넓은 키를 새로 만들거나 신원 정보를 바꿀 수
없게).

**저장 방식**: 키 원문은 DB에 전혀 저장하지 않고 SHA-256 해시만
저장한다(`core/apiKeys.ts` - `GitCredential`의 AES-256-GCM 가역
암호화와 다른 성격, `auth.ts`의 refresh token 해시 저장과 같은
패턴). "생성 시 1회만 노출, 이후엔 본인도 마스킹"을 코드가 실수로
어길 수 없게 만드는 가장 확실한 방법으로 판단. 배제("삭제"가 아닌
soft revoke)는 3종 전부에 동일 적용(설계자 문구는 "개인 키"를
예시로 들었지만, 이 시스템이 자격증명/감사 데이터에 지금까지
일관되게 써온 원칙에 맞춰 확장 적용 - 상세 근거는 계획 문서의 "설계
결정" 절).

팀 키 발급 라우트(`POST /api/teams/:teamId/api-keys`)는 기존 팀장
관리 라우트(`/api/teams/:teamId/admins`)가 "authenticate만 요구"하는
선례를 의도적으로 안 따르고 `isTeamAdmin`을 명시적으로 확인한다 -
자격증명 발급은 라벨을 바꾸는 것보다 위험도가 크다고 판단.

**검증**: 실제 스크래치 SQLite로 팀/프로젝트A/B/C(팀 밖)를 만들고
CLI로 왕복 실측 - 프로젝트 키가 정확히 그 프로젝트만 접근(같은
사용자가 소유자인 다른 프로젝트도 차단, `GET /projects` 목록에서도
빠짐), 개인 키가 로그인과 동등하게 전체 접근, 팀 키가 팀 소속
프로젝트 전부에 접근하되 팀 밖 프로젝트는 차단, **팀 키의 팀 경계
격리를 "실제로 다른 팀의 진짜 팀장인 계정"으로 강하게 재현**(단순
비관리자 거부가 아니라 스코프 자체가 막는지 확인), 권한 상승 시도
(스코프 있는 키로 `key create`/`profile set`/`project-create`) 전부
403, soft revoke 후 그 키가 401 + DB 행은 남고 status만 바뀜(직접
대조), 관리 권한(owner가 남의 프로젝트 키 배제 가능/비owner는 불가,
팀장이 팀 키 배제 가능, 개인 키는 오직 본인만) 각각 양성·음성 케이스
전부, 오버라이드 우회 방어를 프로젝트B에 실제 오버라이드를 걸고
프로젝트A 전용 키로 접근 시도해 막히는지까지 실측. 웹 브라우저로
프로젝트 "키 관리" 탭(생성/1회 노출/복사/배제), 팀 "키 관리" 토글,
프로필 "API 키" 카드(자기 자신에게만 보이는지까지) 실제 클릭 확인.
기존 JWT 로그인 기반 흐름(문서/메시지 등) 회귀 없음 확인. `npx tsc
--noEmit`(backend)/`npm run build`(frontend) 클린.

## QA 패스 3회차: API 키 스코프 게이트 누락 지점 발견·수정 - 완료 (2026-09-11)

직전 라운드(API 키 3종)를 "코드 정리/QA 패스"로 재검토했다. 먼저 CLI/
MCP 대칭성을 전수 대조(`docs --help`/`docs <group> --help` 전체 명령
목록 vs MCP `tools/list` 85개) - 완전 일치, 의도적 예외 4가지(auth
register/login/logout, comment, folder, key 관리)만 빠짐을 확인해
회귀 없음을 재확인했다.

**발견한 진짜 버그**: `core/requestScope.ts`의 스코프 게이트를
"`getMemberRole`/`isTeamAdmin`/`resolveEffectivePermission` 같은
프로젝트 단위 권한 판정 함수 안에서만" 걸었는데, **팀/그룹 자체를
대상으로 하는 라우트**(`POST /api/teams/:teamId/admins`, `POST
/api/teams/:teamId/doc-types`(+상태/전이/지침/표준흐름 4종), `POST
/api/project-groups/:groupId/doc-types`(+ 4종), `PUT /api/templates`)는
애초에 `getMemberRole`을 거치지 않고 `authenticate`만 요구해온
기존 라우트들(설치 단위 admin role이 없다는 이미 문서화된 한계)이라
이 게이트가 전혀 안 걸려 있었다 - **프로젝트 하나로 좁힌 키로 아무
팀에나 팀장을 등록하거나, 아무 팀/그룹에나 문서 타입을 만들거나,
심지어 스코프 미지정 `PUT /api/templates` 호출로 설치 전역 기본
CLAUDE.md/SKILL.md까지 덮어쓸 수 있는 심각한 구멍**이었다("프로젝트
단위 개인 키는 오직 그 프로젝트 하나에만 접근 가능"이라는 원래 요구를
정면으로 어김). 프로젝트 소유자 계정으로 실제로 이 경로들을 호출해
재현한 뒤 발견했다.

**수정**: `core/teamAdmins.ts`에 `isTeamAllowedByActiveScope(teamId)`
(unrestricted면 항상 허용, team 스코프는 teamId 일치만, project
스코프는 항상 거부 - DB 조회 불필요한 순수 스코프 비교), `core/
projectGroups.ts`에 `isGroupAllowedByActiveScope(groupId)`(그 그룹의
teamId로 위 함수에 위임, 팀 없는 그룹은 unrestricted만) 신규 추가 -
기존 "누가"(role) 판정에는 전혀 손대지 않고 "어느 팀/그룹까지"(스코프)
차원만 별도로 얹었다(JWT/개인 키는 항상 unrestricted라 기존 동작
그대로 - 새 제약이 하나도 안 생김, 순수 API 키 스코프 확인 전용).
위 9개 라우트 전부에 이 확인을 인라인으로 추가. `PUT /api/templates`는
스코프 필드(teamId/projectGroupId/projectId) 중 실제로 채워진 것을
보고 해당 스코프 확인 함수로, 셋 다 비었으면(전역 기본값) unrestricted
만 허용하도록 분기했다.

**검증**: 프로젝트 전용 키로 팀장 등록/팀 문서타입 생성/전역 템플릿
수정 시도 → 전부 403(수정 전 재현 시엔 전부 성공했었음) → 팀 키로
바꿔서 **자기 팀**의 같은 동작은 정상 동작하는지(양성 케이스) → 그
팀 키로 **다른 팀**을 겨냥하면 여전히 403인지 → JWT 로그인으로 똑같은
동작들이 이번 수정 전후로 동일하게 되는지(회귀 없음, 새 권한 요구가
안 생겼는지) 전부 실측 대조.

## 가이디드 마이그레이션 워크플로우 점검 - 완료 (2026-09-11)

`docs migrate scan/apply`(Phase 6, 지금까지 합성 테스트로만 검증했던
기능)를 **`concept` 브랜치의 실제 문서로** 처음 점검했다 -
`git worktree add`로 `concept`을 스크래치 경로에 체크아웃해 진짜
`docs/` 트리(spec 4/decision 3/design 1/done 1/logs 4/plan 1/review 1
= 15개 후보, `.tracking.json` 카운터와 실제 파일 수 대조로 스캔 결과
정확성 확인)를 스캔 대상으로 썼다.

**발견·수정한 버그 3건**(전부 실제로 재현 후 수정, 재검증까지 완료):

1. **Meilisearch write-through 경합**(가장 심각, 마이그레이션 범위를
   넘어 시스템 전체에 영향) - `core/search.ts`의 `indexSyncUpsert()`/
   `indexSyncDelete()`가 meilisearch SDK(`^0.51.0`)의
   `EnqueuedTaskPromise`를 그냥 `await`만 했다. 이 값은 "색인 작업이
   큐에 들어갔다"는 HTTP 응답이 오는 즉시 resolve되고, Meilisearch가
   실제로 그 작업을 처리했다는 보장이 전혀 없다(SDK가 별도로 제공하는
   `.waitTask()`를 호출해야 진짜 완료를 기다림). `migrate apply`가
   문서를 연달아 만들고 곧바로 그 문서들 사이에 링크를 거는 루프에서
   이 경합이 실측으로 뚜렷하게 재현됐다 - 방금 막 만든 문서를 링크
   대상으로 걸면 `POST .../links`가 "not found"로 실패(검색 인덱스
   기반 조회인 `getDocument()`가 아직 색인 안 된 문서를 못 찾음),
   같은 요청을 몇 초 뒤 수동으로 재시도하면 성공했다. `indexSyncUpsert`/
   `indexSyncDelete` 둘 다 `.waitTask()`를 붙여 실제 완료까지 기다리게
   고쳤다 - "쓰기 시점에 바로 동기화"라는 Phase 0부터의 write-through
   설계 원칙이 실제로 그 이름값을 하게 된 근본 수정으로, 문서를 다루는
   모든 생성/저장/삭제 경로에 전부 적용된다(마이그레이션만이 아니라
   일반 사용에서도 "막 만든 문서를 바로 링크/검색"하는 모든 경우가
   이 수정의 수혜자). 검증: 수정 전엔 배치 내 링크 20여 건이 전부
   "not found"로 실패했는데, 수정 후 같은 매니페스트로 재실행하니 배치
   범위 밖(DN-00001 - 애초에 대상 DocType이 없어 생성 자체가 실패)을
   가리키는 링크 2건만 "이번 배치에 없어 건너뜀" 경고로 남고 나머지는
   전부 성공, `docs backlinks`로 실제 역참조까지 대조 확인. 일반 검색/
   목록 조회도 회귀 없이 정상 동작하는지 재확인.
2. **`migrate apply`가 매니페스트 JSON의 UTF-8 BOM을 못 읽음** -
   Windows PowerShell의 `>` 리다이렉트(README/SKILL.md가 안내하는
   정확히 그 명령, `docs migrate scan ... > manifest.json`)가 기본으로
   파일 앞에 BOM을 쓴다는 걸 실측으로 확인 - `JSON.parse`가
   `Unexpected token '﻿'`로 즉시 깨졌다(문서화된 golden path를
   그대로 따라도 재현되는 버그).
3. **`scanDirectory`가 BOM으로 시작하는 옛 문서 파일을 조용히
   건너뜀** - `splitFrontmatter`의 `content.startsWith("---")` 검사가
   BOM 때문에 항상 실패해, 그 파일은 **에러 없이** 스캔 후보 목록에서
   빠진다(에러가 나는 2번 버그보다 더 위험한 실패 모드 - 사용자가 파일
   하나가 통째로 누락된 사실조차 모르게 됨). `Out-File -Encoding
   utf8`로 만든 BOM 파일로 직접 재현(빈 배열 반환 확인) 후 수정.

`cli/migrate.ts`에 `stripBom()` 공용 헬퍼를 추가해 세 지점(스캔
대상 .md 읽기, apply의 매니페스트 JSON 읽기, apply가 각 항목의 본문을
다시 읽는 지점 - 이 세 번째 지점은 기존에 같은 파일을 두 번 읽던 중복도
같이 정리됨) 전부에 적용했다.

**의도된 동작으로 재확인한 것**(버그 아님, 기존 "알려진 제한"과 일치) -
옛 시스템의 상태 어휘(`active`/`applied`/`answered`/`done` 등)가 새
표준 6개 코드와 이름부터 다르므로, 실제 마이그레이션에서는 상태 전이
시도가 대부분 실패해 경고로 남고 문서가 초기 상태(draft)로 유지된다 -
이건 `migrate apply`가 대상 상태를 알아서 맞춰주지 않는다는 기존
설계(자동 변환 안 함, `docs transition`으로 설계자가 직접) 그대로다.
같은 이유로 옛 시스템 전용 타입(`RV`/`LG`/`DN`)은 새 프로젝트의 기본
6개 타입에 없어 `errors`로 보고되는 것도 확인(문서화된 대로 자동
생성 안 함).

**검증**: 스크래치 SQLite+Meilisearch로 실제 `concept` 문서 15개
전부 스캔 → 매니페스트를 파일로 저장(PowerShell `>` 리다이렉트로,
버그 재현 조건 그대로) → apply 2회(수정 전/후 비교) → 링크/백링크
무결성, 본문 내용(한글 포함) 그대로 보존되는지, 검색/목록이 즉시
정상 조회되는지 전부 대조. `npx tsc --noEmit` 클린.

## push 훅 IDOR 수정 + 기능별 QA 시나리오 문서 - 완료 (2026-09-11)

"push 훅 자동화 + 템플릿 배포 점검"을 시작하려고 `core/pushHookPrompts.ts`
를 읽다가 진짜 인가 버그를 발견했다 - `acknowledgeQueueEntry()`/
`completeQueueEntry()`가 큐 항목을 **id만으로** 조회해, 라우트의
`:projectId` 경로 파라미터(그 프로젝트의 `requireProjectRole("editor")`
검사 대상)와 실제 변경 대상(`id`가 가리키는 큐 항목)이 서로 다른
프로젝트에 속해도 걸러내지 못했다 - A 프로젝트의 editor가 B 프로젝트
큐 항목의 id를 알면(또는 순차 id를 추측하면) 그대로 ack/done을 걸 수
있는 IDOR. `deletePushHookPrompt()`가 이미 쓰던 "조회 후 projectId
일치 확인" 패턴을 `transitionQueueEntry()`에도 적용해 수정(코드
수정·타입체크 완료, 다만 실제 Gitea 웹훅 왕복으로는 아직 재검증 못함).

이 조사를 이어가려던 참에 설계자가 "사용 시나리오를 기능별로 만들고
QA/개발 계획을 작성하자"로 방향을 틀어, 새 `QA-SCENARIOS.md`(저장소
루트)를 만들었다 - README(기능 요약)/DESIGN-NOTES(라운드 로그)와
성격이 다른 세 번째 문서로, 16개 기능 영역마다 "사용 시나리오 →
QA 체크리스트(실측 `[x]`/미확인 `[ ]` 구분) → 승인 대기 중인 추가
개발 계획"을 정리했다. `CLAUDE.md`가 이제 이 문서도 함께 가리킨다.

## EMQX/Meilisearch 설치 안내 - 대시보드 없이 부트스트랩으로 통일 - 완료 (2026-09-11)

설계자가 "설치를 결정한 사람이 EMQX/Meilisearch 설정 방법을 모를 때"의
안내를 요청 - 처음엔 README에 단계별 안내(EMQX 대시보드 로그인 →
System → API Key → Create → 값 복사)를 자세히 써서 반영했는데, 설계자가
곧바로 "EMQX는 bootstrap 파일을 주면 REST API 키를 원하는 대로 만들 수
있다"고 알려줘서 - 대시보드 수동 발급 자체를 없앨 수 있는지 확인하고
실제로 없앴다.

**검증 과정**(전부 실제 `emqx/emqx:5.8` 컨테이너로 확인 - 이 프로젝트가
Gitea API를 다룰 때 써온 것과 같은 "문서만 보고 추측하지 않는다"
원칙): `EMQX_API_KEY__BOOTSTRAP_FILE`(`api_key.bootstrap_file`)에
`key:secret` 한 줄짜리 파일을 지정하면 기동 시점에 그 키가 실제로
만들어지고, 대시보드에서 만든 키와 동일하게 REST API가 인증됨을
`/api/v5/authentication`(GET·POST 둘 다) 200으로 확인. 빈 값(`:`)을
주면 EMQX가 그 줄만 무시하고 경고 로그를 남긴 채 정상 기동(크래시
없음 - 지금까지 "EMQX 값 비우면 기능만 꺼짐"이라던 기존 fail-soft
설명과 그대로 맞아떨어짐). 같은 키 이름으로 시크릿을 바꿔 강제
재생성(`--force-recreate`)하면 옛 시크릿은 즉시 무효화되고 새 시크릿만
동작(로테이션 가능) - 단, 평범한 `docker compose up -d --build`만으로는
Compose가 `configs.content` 변경을 감지해 자동 재생성하지 않는다는
것도 함께 확인(그래서 "재생성 필요" 안내를 명시적으로 남김). 마지막으로
프로젝트의 실제 `docker-compose.yml`(meilisearch에 임시로만 포트를
연) + 로컬로 띄운 backend로 전체 사슬을 통합 검증 - 백엔드가 기동
직후 `ensureEmqxAuthConfigured()`로 그 부트스트랩 키를 써서
`POST /api/v5/authentication`/`POST /api/v5/authorization/sources`를
실제로 호출해 훅을 등록하는 것까지 확인(임시 `.env`/오버라이드 파일은
검증 후 삭제, 커밋 대상 아님).

**반영**: `backend/docker/docker-compose.yml`의 `emqx` 서비스에
`EMQX_API_KEY__BOOTSTRAP_FILE` 환경변수 + 새 최상위 `configs:` 섹션
(`.env`의 `EMQX_API_KEY`/`EMQX_API_SECRET`를 Compose가 그대로 파일
내용으로 보간)을 추가. `.env.example`의 두 값을 빈 문자열에서
`change-me`(다른 발명 값들과 같은 패턴)로 바꾸고 주석을 "발급받는
값"에서 "직접 정하는 값"으로 교정. `README.md`의 Docker Compose
설치 절을 다시 써서 Meilisearch/EMQX 둘 다 "본인이 값을 정한다"로
통일하고, EMQX 대시보드는 "확인/재발급용으로 여전히 쓸 수 있지만 최초
설치엔 더 이상 필요 없음"으로 격을 낮췄다 - 재생성 필요 조건(`--force-
recreate`)도 명시. Gitea는 이런 부트스트랩 메커니즘이 없어 여전히
수동 마법사+PAT 발급이 필요하다(이번 범위 밖, 그대로 유지).

## 홈 대시보드 + 소스코드 연관 + 설계자별 개인 폴더 재설계 + 닉네임 - 완료 (2026-09-11)

설계자가 4개 항목을 한 번에 요청 - (1) 프로젝트 "홈"을 실제
대시보드로(최근 변경 문서/최근 코멘트/최근 발신 메시지 각 5건 +
더보기), (2) 문서 ↔ "연관된 소스코드" 파일 경로 링크, (3) "문서"
탭에 폴더 생성 툴바 + 순서 제어 + **폴더 기능을 프로젝트 공통에서
설계자 개인 소유로 전면 재설계**(명시적 지시 - 기존 설계를 크게
바꿔도 된다), (4) `User.nickname` + `#N` 자동 넘버링(중복 가능, 1주일
쿨다운, 미설정 시 공통 "설계자" 라벨도 같은 넘버링 대상) + 기존
`[userId]` 표시를 전부 `[닉네임 #N]`으로 교체.

**폴더 재설계가 가장 큰 브레이킹 체인지**: `Document.folderId`
단일 컬럼(문서 하나가 프로젝트 전체에서 폴더 하나에만 속함)을
`DocumentFolderEntry { documentId, userId, folderId }`
(`@@unique([documentId, userId])`) 조인 테이블로 교체 - 같은 문서를
여러 설계자가 각자 다른(또는 비어있는) 개인 폴더에 독립적으로 배치할
수 있게 됐다. `Folder.createdBy`를 새 컬럼 없이 그대로 "소유자"로
재해석(폴더 생성자=소유자가 이 설계에서 항상 같으므로 중복 컬럼을 안
만듦), `order Int` 필드를 추가해 형제 폴더 순서를 표현. 기존
`DocAccessOverride.folderId` 권한 축(프로젝트 owner가 다른 설계자의
폴더 쓰기를 제한/허용하던 것)은 완전히 폐기 - 폴더가 항상 자기
것뿐이라 "남의 폴더 쓰기 권한"이라는 개념 자체가 더는 성립하지
않는다. 대신 소유권(`createdBy === userId`) 확인 하나로 전부
단순화(`resolveFolderWritePermission` 함수 삭제). 폴더 생성/배치
권한도 editor→**viewer로 완화**(개인 정리 메타데이터라 문서 내용을
안 바꾸므로 읽기 권한만 있어도 됨 - 사용자 확인 후 결정).

**연관된 소스코드**는 코멘트/폴더와 달리 CLI/MCP에도 노출된다(사용자
확인 - AI의 수정 작업과 직접 관련된 신호라 비가시로 둘 이유가 없음) -
신규 `DocumentSourceLink { documentId, filePath, createdBy }`,
`docs link-source/unlink-source/source-links` + MCP
`document_link_source/unlink_source/source_links`. 파일이 실제로
존재하는지는 검증하지 않는 순수 연관 관계 - 문서 에디터에서 경로
클릭 시 소스 브라우저가 그 파일을 바로 열도록
`SourceBrowserView.vue`가 `?path=` 쿼리를 받게 확장.

**닉네임 넘버링**: `nicknameNumber`는 매번 다시 세지 않고, 닉네임이
바뀌는 시점(가입 시 암묵적 "설계자" 풀 편입 포함)에만 그 풀(같은
닉네임 문자열, 또는 미설정이면 리터럴 "설계자") 안의 현재 최댓값+1로
확정해 저장한다. 표시는 서버가 `displayLabel`(`"{nickname ?? 설계자}
#{nicknameNumber}"`)로 미리 포맷해 내려줘서 프런트가 각자 포맷을
다시 구현할 필요가 없게 했다. `UserRef.vue`가 `GET /users/:id`를
호출해 캐싱하는 신규 Pinia 스토어(`stores/nicknames.ts`)로 표시를
갈아끼워서, 기존 9개 호출 지점은 코드 변경 없이 자동으로 새 표시를
얻었다 - 컴포넌트를 못 쓰는 3곳(`ProjectSettingsView` 멤버 목록,
`AccessControlManager`의 `<option>`, `ChangeTrackingView`의 리비전
라벨)만 같은 스토어를 직접 참조하도록 개별 수정.

**검증**: 실사용 인스턴스(`backend/docker/`)를 재빌드해 실제 브라우저
+ fetch로 왕복 - 대시보드 3개 섹션(최근 문서/코멘트/메시지) 표시와
"더보기" 이동 확인, 문서에 소스코드 경로 연결→소스 브라우저로 이동
확인, 닉네임 설정→"[닉네임 #N]"으로 실제 표시 변경+새로고침 후에도
유지 확인, 7일 쿨다운 거부(400) 및 값 미변경 시 쿨다운 우회 저장(200)
확인. **폴더 개인 소유 핵심 시나리오**: 두 번째(viewer) 계정을 만들어
프로젝트에 추가 → admin이 만든 폴더가 그 계정의 `GET .../folders`
목록에 전혀 안 뜨는지(`[]`) → viewer role로도 본인 폴더를 직접
만들 수 있는지(200, 권한 완화 확인) → 그 viewer가 admin 소유
폴더의 이름을 바꾸려 시도하면 명확히 거부되는지(400, "본인이 만든
폴더만 관리할 수 있습니다") - 세 가지 다 실측으로 확인. 검증에 쓴
계정/폴더/멤버십/닉네임은 모두 원상 복구(SQL로 직접 정리 - 이 계정
삭제 라우트가 없다는 것도 이번에 확인된 기존 한계, 새로 안 고침).
`npm run db:generate`(3드라이버) → `npx tsc --noEmit`(backend) →
`vue-tsc -b && npm run build`(frontend) 클린 확인.

## 프로젝트별 칸반 보드 - 완료 (2026-09-11)

10개 세부 요구사항으로 온 요청 - 각 프로젝트의 "변경 추적" 탭 우측에
"칸반 보드" 탭을 추가해 "분류(컬럼) → 카드" 구조로 진행 흐름을
추적한다.

**컬럼은 프로젝트 공유, 순서/숨김만 설계자별**: `KanbanColumn
{ projectId, name, order }` + `KanbanColumnPref { columnId, userId,
order?, hidden? }`(`@@unique([columnId,userId])`, null=미지정 →
컬럼 자체의 기본값을 따름 - `TemplateFile`류와 같은 오버레이 패턴) -
바로 직전 라운드에서 끝낸 "폴더의 설계자 개인 소유화"와 정신은
같지만, 폴더와 달리 컬럼 자체(존재)는 전원이 공유하고 "내가 보는
순서/숨김 여부"만 개인화된다는 점이 다르다(요청 10번이 정확히 그렇게
콕 집어 말함).

**카드는 문서/질문과 같은 원칙으로 트래킹 코드를 받는다**
(`KB-XXXXXXXX`) - `origin: "ai" | "designer"`로 누가 만들었는지
구분한다. 서버가 인증 신원만으로는 웹 브라우저 세션과 CLI/MCP
세션을 구분할 수 없어서(둘 다 같은 JWT/API 키 인증 경로), 이 구분은
**요청 바디의 명시적 `origin` 필드**로 한다 - `core/messages.ts`의
`markDelivered`가 "CLI/MCP 호출부만 명시적으로 true를 보낸다"로 같은
문제를 풀었던 선례를 그대로 따름. 웹 UI 폼은 항상 `origin:"designer"`,
CLI `kanban-card-new`/MCP `kanban_card_new`는 항상 `origin:"ai"`를
하드코딩해서 보낸다.

**설계자가 만든 카드 = 메시지 자동 발송**: `createKanbanCard()`가
`origin==="designer"`일 때 기존 `sendMessage()`를 그대로 호출해
`[trackingCode] 제목` 메시지를 보낸다(요청 문구 "메시지 기능과
연동" 그대로 - 새 알림 채널을 안 만듦). "반드시 진행되어야 하는
작업"이라는 의미는 별도 컬럼 없이 `origin==="designer"` 자체가
겸한다.

**카드 코멘트는 설계자간 채널 - 코멘트(comment)와 같은 이유로
CLI/MCP에 없음**: 요청 문구 "설계자간에 의견 공유"가 기존 `Comment`
모델의 AI 격리 설계 근거와 똑같아서, 완전성 원칙의 다섯 번째 의도적
예외로 추가했다(`SKILL.md`에 명시). 단 기존 `Comment`엔 편집/삭제가
없어 재사용이 불가능해(요청이 명시적으로 요구) `KanbanCardComment`를
별도 모델로 새로 만들었다 - 기존 문서 코멘트는 이번에 손 안 댐.

**카드 숨김은 컬럼과 달리 전역(글로벌)**: 요청 10번이 "칸반 분류의
순서와 숨김 처리"라고 컬럼만 콕 집어 개인화를 요구했고 카드 숨김
(7번)엔 그런 단서가 없었다 - 카드는 공유 보드의 실제 작업 항목이라
한 사람이 숨기면 전원에게 같이 치워지는 쪽이 "보드"라는 개념에
맞다고 판단(설계 결정, `KanbanCard.hidden` 단순 boolean).

**드래그는 새 라이브러리 없이 네이티브 HTML5 Drag and Drop API**로
구현(`draggable`/`dragstart`/`dragover.prevent`/`drop`) - 이 저장소의
첫 드래그 기능이다(폴더는 ▲▼ 버튼 방식이었음, 이번엔 요청이 명시적으로
"드래그"를 요구). 카드/컬럼 순서 변경 둘 다 "전체 새 순서 배열을
보내면 서버가 0..n-1로 순차 재번호"하는 방식으로 통일해 fractional
index 같은 복잡한 스킴을 피했다.

**추적 코드 클릭 시 다이얼로그 분기**: 기존 `TrackingCodeText.vue`/
`MarkdownBody.vue`는 매치된 코드를 무조건 문서 다이얼로그로 보냈는데,
`KB-` 접두어면 새 `useKanbanCardDialogStore()`로 분기하도록 클릭
핸들러만 확장했다(정규식 자체는 안 건드림 - 이미 `[A-Z]{2}-[0-9A-F]{8}`
포맷이라 `KB-`도 그대로 매치됨).

검증: 실사용 인스턴스(`backend/docker/`) 재빌드 후 웹+CLI 왕복 -
새 프로젝트가 기본 4개 컬럼으로 시작하는지, 웹에서 만든 카드가 메시지
탭에 `[KB-XXXXXXXX] 제목` 형식으로 실제로 오는지(핵심 검증), CLI로
만든 카드는 메시지가 안 오는지(origin 구분 확인), 카드/컬럼 드래그
순서 변경이 새로고침 후에도 유지되는지, 두 번째 계정으로 컬럼 순서/
숨김이 서로 안 섞이는지(폴더 라운드와 같은 2계정 검증 방식), 카드
숨김은 전역으로 적용되는지, 카드 다이얼로그의 근거 문서 클릭 시 문서
다이얼로그가 그 위에 뜨는지, 카드 코멘트 수정/삭제가 본인 것만
되는지. `npm run db:generate`(3드라이버) → `npx tsc --noEmit`
(backend) → `vue-tsc -b && npm run build`(frontend) 클린 확인.

## 코멘트/질의응답 통폐합 + 페이지네이션 + 엔티티 선택기 - 완료 (2026-09-11)

설계자 요청 5개 - (1) 모든 코멘트에 편집/삭제, (2) 코멘트 대상을
문서/소스 코드/칸반 카드 + "설계자 개입이 예상되는 모든 곳"으로,
(3) AI 질의를 승인 요청(approval)/답변 요청(answer)으로 구분하고
같은 범위로 확장, (4) 문서/소스 코드/메시지/변경 추적에 페이지네이션,
(5) 칸반 카드 근거를 체크박스 리스트 문서 선택기로. Plan Mode에서
설계자가 5번을 피드백해 범위를 크게 넓혔다 - "이미 존재하는 무언가를
설계자가 입력해야 하는 자리는 어디든 같은 체크박스 선택기 다이얼로그를
쓰고, 수동 입력은 유효한 경우에만 같이 보여준다"는 **웹 앱 전체의
입력 UX 원칙**으로.

**핵심 설계 - `Comment`/`Question`을 targetType/targetKey로 다형화**:
지금까지 대상 종류가 하나 늘 때마다(직전 라운드의 `KanbanCardComment`
처럼) 테이블·API·CLI를 통째로 새로 만들어야 했던 반복을 끝냈다.
`targetType: "document" | "source" | "kanbanCard"` + `targetKey`
(document/kanbanCard는 그 트래킹 코드, source는 git 상대 경로) 하나의
모델로 세 대상을 전부 커버 - `KanbanCardComment`는 완전히 삭제되고
`Comment`(`targetType:"kanbanCard"`)로 흡수됐다. Prisma가 폴리모픽
FK를 못 표현해서 `Comment`/`Question`이 `Document`로의 직접 FK를
잃었고, 그래서 `deleteDocument()`가 `db.comment.deleteMany`/
`db.question.deleteMany`를 트랜잭션으로 명시 호출하도록 바뀌었다
(예전엔 스키마 cascade가 대신 해주던 일).

**질의는 `kind: "approval" | "answer"`로 확장** - `answer`는 기존
그대로 자유 텍스트 답변, `approval`은 `Answer.decision:"approved"|
"rejected"`(+ 선택적 메모)로 답한다. `resolveTargetByTrackingCode()`가
document→kanbanCard 순으로 조회해 대상 종류를 자동 판별하므로,
`docs question <trackingCode> <text>`의 기존 2-인자 시그니처가 그대로
유지된다 - source 파일만 트래킹 코드가 없어 `docs question-source
<projectId> <path> <text>` 신규 명령이 필요했다.

**엔티티 선택기 - 하나의 범용 다이얼로그로 6곳 통일**: Promise 기반
`stores/entityPicker.ts`(`pick({kind, projectId?, multi?,
allowManualEntry?, initialSelected?}): Promise<string[]|null>`) +
`EntityPickerDialog.vue`(체크박스 목록 + 검색 필터 + 선택 시
allowManualEntry면 자유 입력 칸). `kind: "document"|"user"|
"sourceFile"` 세 가지로 6개 자리(칸반 카드 근거, 질문 근거,
`AccessControlManager`의 개별 문서 스코프, 멤버/팀장 추가의 대상
사용자, 문서의 연관 소스 코드)를 전부 대체 - 텍스트로 직접 타이핑하던
자리가 전부 없어졌다. `user` kind는 프로젝트 컨텍스트가 없는 화면
(팀장 관리)에서도 써야 해서 `projectId`를 선택 필드로 뒀다.

**페이지네이션**: 기존 CLI/MCP 라우트(`/documents`, `/messages`,
`/git/log`)는 배열 그대로 안 건드리고, 웹 전용 자매 라우트
(`/documents/page`, `/messages/page`, `/git/log/page`)를
`/documents/recent` 선례와 같은 방식으로 추가 - `{items, page,
pageSize, total, totalPages}` 통일 응답(git log만 Gitea의 정확한
총 개수를 신뢰 못 해 `{items, hasMore}`로 다름, `limit+1` 조회
트릭으로 다음 페이지 존재만 판단). `Pagination.vue` 공용 컴포넌트
하나로 문서/메시지 목록에 적용, 소스 코드 디렉터리 목록은 Gitea
Contents API 특성상 클라이언트 사이드 슬라이스로 처리.

**실사용 인스턴스(`backend/docker/`, 이 세션 내내 재사용해온 postgres+
meilisearch+emqx+gitea 스택)로 실측 검증** - 스키마가 `Comment`/
`Question`에 NOT NULL 컬럼을 여러 개 추가해 기존 스크래치 데이터
1건씩과 충돌, `--force-reset`으로 스크래치 DB를 초기화(사용자 확인
후 진행 - 실사용 데이터 아님)하고 재검증했다. CLI(`docs question`/
`question-source`/`questions`/`questions-source`/`reply --decision`/
`question-ack`/`pending`)와 REST 양쪽으로 문서/칸반 카드/소스 코드
세 대상 전부, kind=answer/approval 둘 다 왕복 확인 - 특히 **문서
코멘트 편집**(이번에 처음 가능해진 기능)을 add→edit→resolve→delete
전체 왕복으로 실측. 웹 브라우저로 문서 선택기(체크박스 선택→확인→
질문에 근거 칩으로 반영)까지 실제 클릭 왕복 확인. MCP는 stdio로
`tools/list`를 직접 조회해 `question_add_source`/`question_list_source`
등 신규 도구가 등록되고 `comment_*`/`kanban_card_comment_*` 류가
여전히 전혀 없는지 확인.

**검증 중 실제 버그 발견·수정**: `deleteDocument()`가 그 문서의
질문을 지우려 하면 `Foreign key constraint violated: Answer_questionId_fkey`
로 실패했다 - `Answer.question` 관계에 `onDelete: Cascade`가 빠져
있어서(같은 파일의 `QuestionReference.question`엔 있었는데 이것만
누락) 답변이 달린 질문은 삭제가 막혔다. 3드라이버 스키마 전부에
`onDelete: Cascade` 추가 후 재검증 - 질문+답변이 달린 문서 삭제 →
DB 직접 조회로 `Comment`/`Question`/`Answer` 행이 전부 정리됐는지
(0건) 확인 완료.

`npm run db:generate`(3드라이버) → `npx tsc --noEmit`(backend) →
`vue-tsc -b && npm run build`(frontend) 클린 확인.

## 사이드바 검색(범위 선택 팝업 + 소스코드 색인 검색) - 완료 (2026-09-11)

좌측 사이드바(문서 탐색기)에 검색어 입력창이 전혀 없다는 지적을 받아
추가했다 - 키워드 입력 → 엔터/버튼으로 **범위 선택 팝업**이 뜨고(1.
프로젝트 내에서, 2. 프로젝트 그룹 내에 속한 프로젝트에서, 3. 팀 내에
속한 프로젝트 그룹/프로젝트에서), "소스코드 포함" 체크박스 + "검색
실행"으로 별도 결과 페이지에서 문서/소스 코드 결과를 보여준다.

**"소스코드 포함"이 핵심 결정 지점이었다** - Gitea REST API엔 코드
검색 엔드포인트가 없다(공식 이슈 #31375로 아직 요청 단계, 웹 UI의
`/explore/code`만 됨). 설계자가 "Meilisearch에 소스 파일 내용을 색인"
방식을 선택 - 새 `sourceFiles` 인덱스를 두고 문서와 같은 write-through
원칙을 소스 코드까지 확장했다. 동기화 지점 3곳: (1) 저장소 최초 연결
시 전체 백필(백그라운드, 화이트리스트 확장자+300KB 제한+락파일 제외),
(2) push 웹훅의 `commits[].added/modified/removed`로 증분 동기화(새
API 호출 없이 웹훅 페이로드에 이미 있는 필드 재사용 - 이 시스템에서
브라우징 가능한 git 콘텐츠는 항상 Gitea가 호스팅하는 저장소뿐이라
GitHub/GitLab 웹훅 파싱은 불필요), (3) 소스 에디터 저장 시 즉시 동기화.

**검색은 항상 실제 멤버십으로 필터링**한다 - `listProjects()`는 숨김
아닌 프로젝트를 비멤버에게도 보여주지만(목록 화면), 문서/소스 코드
내용 읽기는 항상 `requireProjectRole("viewer")`를 요구해왔으므로
검색 결과도 같은 기준(`getMemberRole()` non-null)으로 후보 프로젝트를
거른다 - `listAccessibleProjectIdsInScope()`. 이 기능은 웹 UI 전용
(CLI/MCP엔 이미 단일 프로젝트 `docs search`가 있고, 이번 다중 스코프+
소스코드 통합은 설계자의 브라우징 편의 기능).

**스니펫은 `<mark>` 대신 제어 문자(`\x01`/`\x02`) 구분자로 반환**한다 -
소스 코드 내용이 리터럴 `<script>` 같은 텍스트일 수 있어(문서와 달리
사람이 검수한 마크다운이 아님) `v-html`로 렌더링하면 XSS가 된다.
프런트엔드는 이 구분자로 문자열을 쪼개 텍스트 노드로만 렌더링하고
구분자 사이만 `<mark>`로 감싼다.

**검증 중 실제 버그 발견·수정**: Meilisearch 문서 id는 영숫자/하이픈/
언더스코어만 허용하는데 `"<projectId>:<path>"`(콜론+슬래시 포함)를
그대로 썼더니 매 색인 쓰기가 `invalid_document_id`로 계속 실패했다 -
게다가 `waitTask()`는 실패한 태스크에도 그냥 resolve하고 throw하지
않아서(SDK 설계 - "처리가 끝날 때까지 기다린다"이지 "성공했다"가
아님) 반환값을 확인 안 하면 쓰기가 조용히 실패해도 호출부는 성공한
줄 안다 - 실제로 한참 동안 색인이 텅 비어 있는데 에러 로그가 전혀
없어서 원인 파악에 시간이 걸렸다. `sourceFileId()`를 경로를 해시(sha1)
로 바꿔 안전한 id를 만들도록 고치고, 모든 `waitTask()` 호출 뒤에
`assertTaskSucceeded()`로 status를 확인하도록 `search.ts` 전체(기존
document 색인 함수 포함)에 적용해 같은 종류의 실패가 다시 조용히
묻히지 않게 했다. 실사용 인스턴스(`backend/docker/`)에서 실제로
Gitea 관리자 계정을 처음 부트스트랩(설치 마법사+PAT 발급)하고 저장소를
연결해 push 웹훅 add/delete 증분 동기화, 에디터 저장 즉시 동기화,
그룹/팀 스코프 검색, **비멤버 계정으로 그룹 스코프 검색 시 남의
프로젝트 결과가 전혀 안 보이는지**(핵심 보안 검증) 전부 실측 확인.

`npx tsc --noEmit`(backend) → `vue-tsc -b && npm run build`(frontend)
클린 확인(Prisma 스키마 변경 없음 - Meilisearch 인덱스만 추가).

## 문서 탭 분리(보기/질의응답) + 소스 코드 뷰어 개편(파일 타입/편집 분리) - 완료 (2026-09-11)

두 요청 - (1) 문서 화면의 질의/답변이 덩치가 커져 문서 페이지를
[보기]/[질의·답변] 두 하위 탭으로 나누고 질의/답변엔 페이지네이션
(최신순)+검색을 붙였다. 코멘트는 탭도 아니고 인라인도 아닌 별도
다이얼로그로 뺐다. (2) 소스 코드 뷰어는 모든 파일을 텍스트로 취급해
Monaco에 바로 물렸는데, 실제로는 이미지/영상 같은 텍스트가 아닌
파일이 있을 수 있다 - 텍스트는 "보기"(읽기 전용)/"편집" 모드를
분리하고, 이미지/영상은 편집 없이 브라우저에서 바로 렌더링만 한다.

**Q&A/코멘트 다이얼로그를 하나로 통일** - `QAPanel`/`CommentsPanel`을
각각 감싸는 컴포넌트 두 개 대신, 신규 `stores/targetPanelDialog.ts`
(`{panel: "qa"|"comments", projectId, targetType, targetKey}`)와
`components/TargetPanelDialog.vue` 하나로 통일(`panel` 값에 따라
QAPanel 또는 CommentsPanel을 그대로 끼워 넣음). 칸반 카드 다이얼로그는
이미 자기 자신이 다이얼로그라 스크롤 문제가 없어 QAPanel/CommentsPanel
인라인을 그대로 유지(이번 변경 대상 아님).

**`QAPanel.vue`를 페이지네이션+검색+최신순으로 확장** - 문서 탭뿐
아니라 다이얼로그로 쓰이는 소스 코드/칸반 카드에서도 같은 컴포넌트를
그대로 쓰므로 한 번의 확장으로 전부 혜택을 받는다. 기존 CLI/MCP가
쓰는 `GET /api/questions?trackingCode=`/`GET /api/projects/:id/
questions/source?path=`는 손대지 않고(정렬도 기존 `ordinal asc` 그대로),
자매 라우트 `GET /api/questions/page`/`GET /api/projects/:id/questions/
source/page`를 새로 추가(`/documents/page` 선례와 동일 패턴) -
`createdAt desc`, `q`는 `Question.text` OR `Answer.body`에 대한 Prisma
`contains`(SQLite 호환을 위해 `mode:"insensitive"` 안 씀).

**소스 코드 파일 타입 분류는 이미지/영상 확장자 화이트리스트 두
종류뿐 - 블랙리스트 없음**: 신규 `frontend/src/utils/fileKind.ts`가
`"text"|"image"|"video"`를 반환한다. 처음엔 "그 외 바이너리 확장자
블랙리스트"로 "미지원" 분류를 계획했으나, 설계자 피드백으로 방향을
바꿨다 - **블랙리스트를 만들 필요 없이, 텍스트로 열었을 때 내용이
깨져 보여도 "원본 다운로드" 링크가 항상 그 자리에서 탈출구를 제공**
하면 된다(알려지지 않은/애매한 확장자를 걸러내려고 바이너리 목록을
유지·관리할 필요가 없다는 판단). 이미지/영상·"원본 다운로드"는
처음엔 base64 JSON 응답으로 계획했으나, 역시 설계자 피드백으로
**백엔드 로컬 디스크 캐시(`backend/.cache/git-raw/<blob sha>`)에서
raw 바이트를 `res.sendFile()`로 직접 서빙**하는 방식으로 바꿨다 - sha가
이미 내용의 고유 식별자라 내용이 바뀌면 캐시가 자연히 무효화되고,
같은 내용이면 프로젝트가 달라도 캐시가 재사용된다. 신규 `GET
/api/projects/:id/git/file/raw?path=` 라우트(`getFileRaw()`+
`mimeTypeForPath()`, `core/gitea.ts`) - 여전히 `authenticate`를 거치므로
`<img src>`로 직접 못 불러, 프런트는 인증된 `fetch()`(`apiCallBlob()`,
신규)로 `Blob`을 받아 `URL.createObjectURL()`로 렌더링/다운로드한다.

**텍스트 파일의 "보기"/"편집" 토글**: `MonacoEditor.vue`의 `readOnly`
prop이 지금까지 생성 시점에만 적용되고 이후 변경을 반영 안 했던 것을
`watch`로 고쳤다. 보기 상태(readOnly)면 "편집" 버튼 하나, 편집 상태에서
원본과 내용이 같으면 "편집 취소" 하나(저장할 변경 자체가 없으므로),
내용이 다르면 "저장"+"편집 취소" 두 개로 분리. "질의/답변"·"코멘트"·
"원본 다운로드" 버튼은 파일 종류 상관없이 저장 버튼 왼쪽에 상시
노출(인라인 QAPanel/CommentsPanel을 다이얼로그로 빼면서, 지난 라운드가
인라인으로 붙이며 생겼던 뷰 영역 스크롤 문제도 같이 해소됨) -
`.editor-pane`을 헤더(고정)+콘텐츠(`flex:1; overflow:auto`)로 재구성.

실사용 인스턴스(`backend/docker/`)로 실측: 25개 질문을 시드해 페이지네이션
(20개/페이지, 2페이지)·최신순·검색("number 7"로 필터링해 "number 17"은
안 걸리는지)까지 확인, 답변 등록→"확인 대기" 상태 전이 확인. 코멘트
다이얼로그가 문서/소스 코드 양쪽에서 정상 동작(기존 코멘트 목록+수정/
삭제 버튼 노출) 확인. 텍스트 파일 열람 시 실제로 타이핑이 막히는지
("Cannot edit in read-only editor" 메시지 확인)→편집→저장→다시 읽기
전용 복귀까지 왕복 확인. 1x1 PNG를 Gitea Contents API로 직접 커밋해
이미지 미리보기(`naturalWidth/Height=1`, `complete=true`)와 원본
다운로드(바이트 단위로 PNG 매직 넘버 확인)까지 실측, 알 수 없는
확장자(`mystery.dat`)에 임의 바이너리(NUL/0xFF/0xC0 0xAF 등 포함)를
커밋해 텍스트로 깨져 보이되 앱이 죽지 않고 "원본 다운로드"로 정확히
원본과 바이트 단위로 동일한 내용을 받을 수 있는지 확인. `backend/
.cache/git-raw/`에 blob sha 파일명으로 캐시 파일이 실제로 생기는지
컨테이너 안에서 직접 확인. 칸반 카드 다이얼로그의 인라인 QAPanel/
CommentsPanel과 CLI `docs questions <trackingCode>`(ordinal asc 배열
응답)가 이번 변경으로 회귀 없는지 확인.

`npx tsc --noEmit`(backend) → `vue-tsc -b && npm run build`(frontend)
클린 확인(Prisma 스키마 변경 없음 - 신규 로컬 파일 캐시만 추가,
`.gitignore`에 `backend/.cache/` 등록).

## QA 패스: push 훅 웹훅 왕복 + git 동기화 제안 재실측 - 완료 (2026-09-11)

`QA-SCENARIOS.md`에 "다음 세션에서 최우선으로 재개할 항목"으로 명시적
표시가 남아있던 두 가지를 실사용 인스턴스(`backend/docker/`, 계속
재사용 중인 스택)로 실측했다 - 코드 변경 없이 검증만 진행.

**push 훅 자동화(12절)**: QA Project(이미 Gitea 저장소가 연결돼 있고
웹훅도 자동 등록돼 있던 상태)에 트리거 브랜치 없음(전체 매칭)
프롬프트와 `release/x`(불일치) 프롬프트를 하나씩 등록 → Gitea Contents
API로 실제 커밋 하나를 만들어(백엔드를 거치지 않고 Gitea가 직접
웹훅을 쏨) 전체 매칭 프롬프트에서만 `PushHookQueueEntry`가 생기고
불일치 프롬프트에서는 안 생기는지 확인 → `ack`→`done` 상태 전이까지
확인. **IDOR 수정 재검증** - 이 큐 항목 id를, 같은 사용자가 owner인
**다른** 프로젝트의 `:projectId` 경로로 ack 시도 → `pushHookPrompt.
projectId` 대조 덕분에 role 검사와 무관하게 `400`으로 거부되고 상태도
안 바뀌는지 확인(직전 라운드에서 코드만 고치고 실제 웹훅으로 재현은
못 했던 부분). **API 키 스코프**도 같이 확인 - 다른 프로젝트 전용
키로 이 프로젝트의 큐 조회/프롬프트 생성을 시도하면 403(스코프 게이트
자동 적용), 같은 키로 자기 프로젝트 조회는 정상 동작.

**git 동기화 제안(11절)**: 새 스크래치 프로젝트를 공개 GitHub 저장소
(`octocat/Hello-World`)에 옵션 3(외부 연동)으로 연결 → Gitea에
`-mirror`(읽기 전용 미러)/`-work`(실제 커밋 대상) 두 저장소가 실제
생겼는지 바이트 수까지 대조 → 소스 에디터로 work 저장소의 `README`를
수정 → `POST .../git/sync-status`(트리거, 비동기)→`GET`(폴링)으로
`changed:["README"]` 확인 → `GET .../git/sync-proposal`이 수정된 실제
내용을 그대로 반환하는지 확인. 이 두 라우트도 API 키 스코프로 정상
막히는지 같이 확인.

`QA-SCENARIOS.md`의 두 절 모두 해당 체크리스트 항목을 `[x]`로 갱신.
코드 변경이 전혀 없는 순수 QA 라운드라 `tsc`/빌드 재확인은 생략.

이어서 `QA-SCENARIOS.md`가 자체적으로 정리해둔 "종합 우선순위 제안"의
남은 두 항목도 가볍게 처리했다 - **저장소 연결 해제(unlink) 기능
여부**는 코드로 확인한 결과 실제로 없음을 확정(`server.ts`엔 `GET
.../git/repo`뿐 `DELETE`가 없고, `gitRepos.ts`의 `gitea.deleteRepo()`
호출 2곳은 전부 인증 실패 시 남은 빈 stub 저장소를 정리하는 에러
처리 경로일 뿐 사용자용 unlink가 아님 - 개발 계획 항목으로 확정,
구현은 별도 요청 대기). **문서 삭제 확인 다이얼로그 부재**는 실제로
고쳤다 - `DocumentEditorView.vue`의 "삭제" 버튼에 `window.confirm()`
가드를 추가(cascade 대상을 경고 문구에 명시), 취소 시 `DELETE`
요청 자체가 안 나가는지·수락 시 정상 삭제되는지 둘 다 실측(수락
경로는 `window.confirm`을 스텁해 재현). Soft delete(삭제 후 복구)는
이번 범위 밖 - 확인 다이얼로그로 실수 자체를 막는 것과 별개 문제라
필요해지면 별도 요청으로 다룬다.

`npx tsc --noEmit`(backend, 무영향 확인) → `vue-tsc -b`(frontend)
클린 확인 → 실사용 인스턴스에 재빌드 배포 후 확인/취소 양쪽 경로
실측.

## 변경 추적 리스트화 + Q&A 선택지 + 콤보박스 라벨 분리 + 사이드바/피커 부분 로딩 + 코멘트 상태 - 완료 (2026-09-11)

설계자가 실사용 중 발견한 6개 UX/기능 문제를 한 번에 요청했다.

1. **변경 추적 리스트화**: `ChangeTrackingView.vue`의 git 커밋 diff가
   커밋 전체의 raw unified diff를 파일 경계 구분 없이 하나의 `<pre>`
   블록에 그대로 붓고 있었다(문서 리비전 diff도 `diffLines()` 결과를
   똑같이 통짜로 렌더링). 신규 `frontend/src/utils/diffParse.ts`
   (`parseUnifiedDiff()` - `diff --git`/`@@` 경계로 파일·hunk 단위
   파싱, 파일별 +N/-M 카운트까지 계산)와 신규
   `frontend/src/components/DiffFileList.vue`(파일마다 접고 펼 수
   있는 카드 - 2개 이상이면 기본 접힘)로 교체. 문서 리비전 diff는
   새 diff 알고리즘을 또 만들지 않고 기존 `diffLines()` 결과를 한
   "파일"짜리 `FileDiff`로 재포장해 같은 컴포넌트를 재사용했다.
2. **Q&A 선택지**: `Question`/`Answer`엔 "AI가 제안하는 선택지" 개념이
   전혀 없었다(`text`/`body` 둘 다 자유 텍스트뿐). 신규
   `QuestionOption { questionId, label, detail?, order }` 테이블 +
   `addQuestion()`/CLI `--choices "A:::설명A;;B:::설명B"`/MCP
   `options: [{label, detail?}]` 파라미터로 AI가 구조화된 선택지를
   제시할 수 있게 됐다. `QAPanel.vue`에 신규 `inDialog` prop -
   이미 다이얼로그 안(`TargetPanelDialog`/`KanbanCardDialog`)이면
   선택지를 바로 인라인으로, 페이지에 직접 박혀있으면(문서 [질의/답변]
   탭) "제안 목록 (N)" 버튼 뒤 별도 다이얼로그로. 클릭하면 라벨이
   답변 수동 입력칸에 채워질 뿐 자동 제출은 안 됨(검토 후 기존
   답변/승인/거부 버튼으로 직접 제출).
3. **콤보박스 라벨/설명 분리**: 전수 조사 결과 실제로 `<option>`
   텍스트 하나에 라벨+긴 설명을 이어붙이는 곳은
   `DocumentEditorView.vue`의 상태 전이 select 한 군데뿐이었다(다른
   곳은 이미 `DocumentsView.vue`의 "select엔 라벨만, 지침은 별도
   텍스트" 패턴을 따르고 있었음) - 그 패턴을 그대로 가져와 통일.
4. **사이드바 무한 스크롤**: `DocumentExplorer.vue`가
   `GET .../documents`(전체 배열)를 한 번에 불러와 클라이언트에서
   타입별로 그룹핑하던 것을, 이미 있던 `GET .../documents/page`
   (`DocumentsView.vue`가 쓰던 것과 동일 라우트) 기반 무한 스크롤로
   재작성 - DocType 필터("전체" + 프로젝트 유효 타입) + 30개씩
   `IntersectionObserver`(이 저장소 최초 사용)로 이어붙임. "전체"
   선택 시 타입 구분 없이 최신순 플랫 목록(타입 코드는 작은 칩으로만
   표시). 생성 폼도 타입별 여러 개에서 사이드바 상단 고정 폼 하나로.
5. **소스 파일 선택 피커 트리뷰**: `EntityPickerDialog.vue`의
   `kind:"sourceFile"`가 `GET .../git/tree/all`(재귀 전체 트리)을
   한 번에 받아 평평한 체크박스 목록으로 보여주던 것을,
   `SourceBrowserView.vue`가 이미 쓰던 `GET .../git/tree?path=`
   지연 디렉터리 탐색으로 교체 - 한 디렉터리 분량만 받고, 그마저
   `Pagination.vue`로 30개씩 페이지네이션. 파일 클릭 시 기존
   `selected`/확인 흐름을 그대로 재사용(document/user kind는
   기존 평평한 목록 그대로).
6. **코멘트 상태**: `Comment.resolvedAt`(사실상 이진 해결/미해결)을
   `status: "open"|"closed"|"solved"|"etc"`로 확장하면서, 실측 중
   발견한 기존 불일치(`resolveComment()`가 작성자 본인이 아니라
   editor 이상이면 누구나 호출 가능했음 - `editComment`/
   `deleteComment`는 이미 작성자 본인만 허용)를 요청이 명시한 "본인만
   변경 가능" 기준으로 통일(`setCommentStatus()`가 `editComment`와
   동일한 작성자 확인 패턴 사용). `POST /api/comments/:id/resolve`
   (이진)를 `POST /api/comments/:id/status`(4단계)로 교체 - 의미가
   근본적으로 바뀌어 이름을 그대로 유지하는 게 오히려 혼란을 준다고
   판단(기존 시그니처 유지 원칙의 명시적 예외).

실사용 인스턴스로 전부 실측: 여러 파일이 바뀐 실제 멀티파일 커밋을
Gitea 배치 API로 만들어 diff 카드가 파일별로 쪼개져 보이는지(신규
파일은 "(신규)" 라벨, +N/-M 배지, 접기/펼치기) 확인, 문서 리비전
diff도 같은 카드 스타일로 나오는지 확인. 선택지 있는 질문을 문서
페이지(페이지 컨텍스트)와 소스 코드 화면(다이얼로그 컨텍스트) 양쪽에
등록해 "제안 목록" 버튼+다이얼로그 경로와 인라인 직접 노출 경로 둘
다 확인, 클릭 시 정확히 그 질문의 답변 입력칸만 채워지는지 대조.
상태 전이 select에 라벨만 보이고 선택 시 지침이 별도로 뜨는지 확인.
35개 문서를 만들어 사이드바 무한 스크롤이 실제로 다음 페이지를
이어붙이고 마지막 페이지에서 멈추는지, 타입 필터가 정확한 쿼리를
보내는지 네트워크 로그로 확인. 소스 파일 피커에서 디렉터리 진입·
상위 이동·파일 선택·확인까지 왕복해 실제 문서-소스 링크가 생기는지
확인. 코멘트 상태를 작성자 계정에서 변경 후 배지가 바뀌는지, 새
계정을 등록해 그 프로젝트 멤버로 추가한 뒤 그 계정으로 상태 변경을
시도하면 403급으로 거부되고 실제 상태가 안 바뀌는지 API로 대조
확인. 칸반 카드 다이얼로그의 인라인 QAPanel/CommentsPanel이 `inDialog`
prop 추가 후에도 회귀 없이 정상 동작하는지 확인.

`npm run db:generate`(3드라이버, `QuestionOption` 신규 + `Comment.
resolvedAt`→`status`) → `npx tsc --noEmit`(backend) →
`vue-tsc -b && npm run build`(frontend) 클린 확인.

## 코멘트/질의/답변 여러 줄 입력 + 다이얼로그 표시 순서 제어 - 완료 (2026-09-11)

설계자가 실사용 중 발견한 두 가지 문제.

1. **여러 줄 입력**: 코멘트 작성, 새 질문 등록, 답변/승인 메모 입력이
   전부 `<input type="text">`(한 줄)였다 - `<textarea>`로 교체
   (`CommentsPanel.vue`의 코멘트 작성, `QAPanel.vue`의 질문/답변/승인
   메모 셋 다). Enter 키는 이제 폼 제출이 아니라 줄바꿈으로 동작(브라우저
   기본 동작 그대로 - textarea는 Enter로 제출 안 됨, 별도 처리 불필요).
   `QAPanel.vue`의 `.ask-row`/`.approval-row`는 가로 한 줄 레이아웃에서
   "textarea 위 + 버튼들 아래 행"(`.ask-controls`/`.approval-actions`)
   구조로 재배치 - 여러 줄로 늘어나는 textarea와 버튼이 가로로 나란히
   있으면 어색해짐. 표시 쪽은 `TrackingCodeText.vue`(코멘트/질문/답변
   본문을 렌더링하는 공용 컴포넌트)의 루트 `<span>`에 `white-space:
   pre-wrap`을 추가해 줄바꿈이 실제로 화면에 반영되게 했다(이전엔
   textarea로 줄바꿈을 입력해도 HTML이 공백으로 뭉개 한 줄로 보였을
   것).
2. **다이얼로그 표시 순서**: 칸반 카드 다이얼로그(`KanbanCardDialog.vue`)
   에서 "근거 문서" 링크를 누르면 뜨는 문서 다이얼로그
   (`DocumentPreviewDialog.vue`)가 칸반 다이얼로그에 가려 안 보이는
   버그 - 둘 다 `.overlay`에 고정 `z-index: 1000`을 쓰고 있어서, 같은
   값이면 어느 게 위로 오는지가 DOM 마운트 순서로 결정되고(`AppLayout.
   vue`에 마운트된 순서) 논리적으로 "나중에 연" 다이얼로그가 오히려
   먼저 마운트된 쪽 밑에 깔릴 수 있었다. 문서가 `KB-` 코드로 칸반
   카드를 열 수도 있어(양방향 참조) 한쪽에 고정으로 더 높은 z-index를
   주는 식으로는 반대 방향에서 다시 같은 문제가 난다 - 신규
   `frontend/src/dialogZIndex.ts`(`nextDialogZIndex()` - 공유
   증가 카운터)를 만들어, 오버레이형 다이얼로그가 열릴 때마다(store의
   `open`이 false→true로 바뀔 때) 새 z-index를 받아 인라인 `style`로
   적용하게 했다 - `DocumentPreviewDialog`/`KanbanCardDialog`/
   `TargetPanelDialog`/`EntityPickerDialog`/`SearchScopeDialog`/
   `QAPanel`의 "제안 목록" 미니 다이얼로그까지 전부 적용해, 몇 단계로
   중첩되든 항상 마지막에 연 것이 최상단에 오도록 통일.

실사용 인스턴스로 실측: 코멘트/질문에 여러 줄 텍스트를 입력해 저장 후
줄바꿈이 그대로 보이는지 확인. 칸반 카드 다이얼로그 → 문서 참고 링크
클릭 → 문서 다이얼로그가 칸반 다이얼로그 위에 온전히 보이는지, 반대
방향(문서 본문에 `KB-` 코드를 넣어 문서 다이얼로그 → 다른 칸반 카드
클릭 → 그 칸반 다이얼로그가 위로)도 확인해 3단계 중첩(칸반→문서→
칸반)까지 항상 마지막에 연 것이 맨 위로 오는지 실제로 확인.

`vue-tsc -b`(frontend) 클린 확인(백엔드 변경 없음 - 순수 프런트엔드
수정).

## Gitea push 웹훅 시스템 웹훅 통합 + Gitea 사용자 계정 마스터링 - 완료 (2026-09-11)

설계자와의 아키텍처 논의(Gitea git 프로토콜을 백엔드에 내장할 필요가
있는지 질문 → Gitea "시스템 웹훅"이 이미 그 기능을 제공함을 확인 →
지금 프로젝트별로 웹훅을 등록하는 이유가 설계적 판단이 아니라 단순히
Gitea REST API의 기존 선례를 따른 것이었음을 인정 → "이 시스템이 자신이
관리하는 Gitea 인스턴스의 유일한 관리자이고, 계정 자체도 이 시스템이
master이니 시스템 전체 이벤트를 받아 내부에서 걸러 처리하는 게 낫다"는
방향 확정)에서 시작한 두 가지 변경.

1. **Gitea push 웹훅을 프로젝트별 등록 → 시스템 웹훅 1개로 통합**:
   `linkSelfHostedRepo()`가 저장소를 연결할 때마다 개별 웹훅+시크릿을
   만들던 것을 제거하고, 서버 부팅 시 인스턴스 전체를 커버하는 시스템
   웹훅 하나(`POST /api/webhooks/gitea/system`)를 한 번만 등록한다
   (`core/gitea.ts`의 `ensureGiteaSystemWebhookConfigured()`, 시크릿은
   `InstallConfig.giteaSystemWebhookSecretEncrypted`에 자동 발급·보관).
   **실제 Gitea 1.27.3 인스턴스로 검증해 확정한 함정** - `POST
   /admin/hooks`에 `is_system_webhook`을 안 넣거나 최상위 필드로 넣으면
   에러 없이 조용히 "기본 웹훅"(신규 생성 저장소에만 복사, 기존
   저장소엔 전혀 안 걸림)이 된다 - `config` 객체 안에 문자열
   `"true"`로 넣어야 실제로 인스턴스 전체(기존 저장소 포함)를 커버하는
   시스템 웹훅이 된다(go-gitea/gitea#23139에 기록된 것과 같은 API
   혼동을 이 인스턴스에서 직접 재현해 확인). payload의
   `repository.name`(slug)에서 DB 조회 없이 순수 문자열 파싱만으로
   projectId+종류(self_hosted/work/mirror)를 역산하는
   `resolveProjectFromSlug()`(`core/gitRepos.ts`)를 신설, 미러 저장소
   push는 무시, 관리 안 하는 slug도 조용히 무시. 기존 프로젝트별
   `/api/webhooks/gitea/:projectId`는 410으로 명시 거부(github/gitlab은
   그대로 유지 - 그 쪽은 시스템 웹훅 개념이 없는 플랫폼이라 범위 밖).
   **구현 중 발견한 라우팅 버그**: 새 라우트
   `/api/webhooks/gitea/system`을 기존 `/api/webhooks/:provider/
   :projectId` 뒤에 등록했더니 Express가 `provider="gitea",
   projectId="system"`으로 먼저 매칭해버려 항상 410이 났다 - 특정
   경로가 파라미터 경로보다 먼저 등록돼야 한다는 걸 실제 curl 테스트로
   재현해 발견, 등록 순서만 바꿔 해결.
2. **Gitea 사용자 계정 마스터링(신규)**: 설계자 피드백 - "이 시스템이
   생성한 계정은 Gitea에도 항상 유효해야 하고, Gitea 쪽 비밀번호는 이
   시스템이 토큰처럼 발급·보관해야 모든 저장소·모든 사용자가 커버된다"
   반영. `User`에 `giteaUsername`/`giteaPasswordEncrypted`/
   `giteaUserId`/`giteaProvisionedAt` 추가, 신규 `core/
   giteaAccounts.ts`의 `ensureGiteaAccountForUser()`가 가입 시점
   (`core/auth.ts`의 `register()`)에 그 설계자의 Gitea 계정을 대신
   만든다(비밀번호는 `crypto.randomBytes(24)`로 생성해 `encryptSecret()`
   으로 암호화 저장 - 사람이 로그인할 목적이 아니라 백엔드 내부 전용
   토큰). 이름 충돌은 숫자 접미사로 회피(`admin`이 Gitea 자신의
   기존 관리자 계정과 충돌해 `admin-2`로 자동 회피되는 걸 실사용
   인스턴스에서 실제로 확인). 신규
   `ensureAllUsersGiteaAccountsConfigured()`를 부팅 시퀀스에 추가해
   - `giteaUsername IS NULL`인 기존 계정(이 기능 이전 가입 계정, 또는
   가입 시점에 Gitea 연결 실패로 못 만들어진 계정)을 재기동마다
   보완한다(`ensureSearchIndexes()`류와 동일한 멱등 보완 패턴). Gitea
   미설정/연결 실패 시 조용히 스킵하고 가입 자체는 절대 막지 않는다
   (fail-soft - `ensureEmqxAuthConfigured()`와 동일 원칙).

**실사용 인스턴스(`backend/docker/`, 여러 라운드에 걸쳐 재사용 중인
스택)로 실측**: 재기동 로그+Gitea 어드민 API 대조로 시스템 웹훅
등록·**두 번 재기동해도 중복 안 되는 멱등성** 확인 → 기존
QA 프로젝트의 저장소별 웹훅을 수동 삭제 후 Gitea Contents API로 실제
커밋 → `PushHookQueueEntry`가 새 시스템 웹훅 경로로 여전히 쌓이는지
확인 → 새 프로젝트를 `docs git link`(CLI)로 새로 연결(응답에
`webhookRegistered` 필드가 사라졌음도 확인) → 그 저장소엔 저장소별
웹훅이 아예 안 생기는지 확인 → 실제 push로 시스템 웹훅 경로가 여전히
정상 처리하는지 확인 → `external_linked` 프로젝트의 미러 저장소 push는
`ignored`, 작업 저장소 push는 `processed`로 정확히 갈리는지 합성
payload로 확인 → 관리 안 하는 slug는 에러 없이 `ignored`인지 확인 →
옛 프로젝트별 `/api/webhooks/gitea/:projectId`는 410, `github`는 여전히
200으로 정상 처리되는지 회귀 확인 → 서명이 틀리면 401인지 확인.
Gitea 계정 마스터링은 신규 가입 → Gitea 어드민 API로 실제 계정 생성 및
DB의 `giteaUserId`와 일치 확인, 암호화된 비밀번호 컬럼이 평문이 아닌
정확한 AES-256-GCM 포맷 길이(iv+authTag+ciphertext)인지 바이트 길이로
확인 → 기존 계정의 `giteaUsername`을 DB에서 강제로 지운 뒤 재기동 →
보완 스윕이 실제로 다시 채우는지(이미 Gitea에 같은 이름이 있어 접미사가
붙는 충돌 회피까지 같이) 확인 → Gitea 컨테이너를 잠시 내린 상태로 새
계정 가입 → 가입은 정상 성공하고 에러만 로그로 남는지(fail-soft) 확인
→ Gitea를 다시 올리고 재기동 → 그 계정도 보완 스윕으로 채워지는지 확인.

`npm run db:generate`(3드라이버) → `npx tsc --noEmit`(backend) 클린
확인.

## Gitea 저장소 소유권을 조직 네임스페이스로 전환 + 커밋/푸시를 실제 설계자 신원으로 귀속 - 완료 (2026-09-11)

직전 라운드가 "Gitea 계정 마스터링"을 발급·보관까지만 하고 실제
사용(저장소 소유권, 커밋 귀속)은 범위 밖으로 미뤘던 부분을 설계자가
이어서 요청 - 저장소를 공유 admin 계정 대신 각 설계자 신원으로 커밋
/push하게 하고, 외부 git 클라이언트가 Gitea git 프로토콜로 직접
clone/push하는 경우까지 지원한다.

- **저장소는 전부 Gitea 조직(organization) 네임스페이스
  (`cnwk-projects`, `GITEA_ORG_NAME`으로 변경 가능) 아래 생성**한다
  (`core/gitea.ts`의 `orgLogin()`/`ensureGiteaOrgConfigured()`, 서버
  부팅 시 멱등 자동 생성) - "누구 개인 소유냐"라는 질문 자체를 없애고,
  그 대신 **저장소별 협업자(collaborator) 권한을 프로젝트
  `Member.role`과 그대로 동기화**한다(owner→admin/editor→write/
  viewer→read, `PUT/DELETE /repos/{org}/{repo}/collaborators/
  {username}`) - 멤버 추가/역할변경/제거(`core/members.ts`에 신규
  `removeMember()`/`updateMemberRole()` 추가 - 지금까지 추가만 되고
  제거/변경 라우트 자체가 없었다는 걸 이번에 확인해 같이 만듦),
  저장소가 막 연결된 시점(기존 멤버 일괄 반영), 설계자의 Gitea
  계정이 나중에 준비된 시점(보완 스윕) 세 곳에서 동기화 - 전부
  fail-soft.
- **설계자당 Gitea Personal Access Token(PAT) 하나를 발급·보관**해
  (`core/giteaAccounts.ts`, 계정 생성 직후 그 임시 비밀번호로 Basic
  Auth해 발급) 두 가지 용도를 겸한다 - (a) 이 시스템의 웹 UI/CLI를
  거쳐 파일을 저장할 때(`core/gitea.ts`의 `putFileContent()`가
  `actingToken` 인자를 받아, 있으면 그 설계자 PAT로 커밋해 신원이
  실제로 귀속되게 함 - 없으면 관리자 토큰으로 폴백), (b) 프로필
  화면("Gitea 개인 접근 토큰" 카드, `ApiKey`의 "생성 시 1회 노출"
  UX 재사용)에서 재발급·노출해 **외부 git 클라이언트가 그 값을
  비밀번호 자리에 넣어 직접 clone/push**하는 자격증명으로. CLI
  `docs git my-token`(재발급+1회 노출) - MCP엔 의도적으로 없음(신원/
  자격증명 관리라 `auth`/`key_*`와 같은 원칙).
- **실제 인스턴스로 검증하며 발견한 함정 두 가지**: ① Gitea PAT 발급
  (`POST /users/{username}/tokens`)은 관리자 토큰이 아니라 **그 계정
  자신의 Basic Auth**를 요구한다(응답의 평문 토큰 필드는 `token`이
  아니라 `sha1`). ② 이 세션이 처음부터 써온 `GITEA_API_TOKEN`(admin
  계정 소유)에 `organization` 스코프가 없어서 `ensureGiteaOrgConfigured()`
  가 403으로 막혔다 - Gitea 1.20+ 스코프 토큰 모델에서 `write:admin`이
  있어도 `organization` 카테고리는 별도로 있어야 함을 실측으로 확인.
  admin 계정의 Gitea 비밀번호를 재설정(설계자 승인 받음 - 이 계정은
  이 시스템 전용 로컬 서비스 계정이지 사람 개인 계정이 아님)해 필요한
  스코프를 전부 포함한 새 토큰을 발급하고 `.env`를 갱신해 해결.
- **브레이킹 체인지**: 이전 라운드까지 만들어진 프로젝트들의 저장소는
  여전히 `admin/project-...` 네임스페이스에 남아있고, 새로 연결되는
  저장소만 `cnwk-projects/project-...`를 쓴다(마이그레이션 스크립트는
  안 만듦 - 기존 관행). 옛 저장소를 쓰는 프로젝트의 협업자 동기화는
  대상 저장소가 없어 404로 fail-soft 스킵된다(로그만 남고 앱 동작은
  안 막힘 - 실측으로 확인).

**실제 인스턴스로 실측**: 새 프로젝트 연결 시 `repoUrl`이 실제로
`cnwk-projects/...`인지 확인 → 프로젝트 owner(생성자)가 자동으로
그 저장소의 Gitea `admin` 협업자로 등록되는지 확인 → 두 번째 설계자를
editor로 추가 → Gitea 협업자 권한이 `write`인지 확인 → 역할을
viewer로 변경 → `read`로 내려가는지 → 제거 → 협업자 목록에서
`none`으로 빠지는지(웹 UI의 역할 select/제거 버튼으로도 동일하게
재현 - 실제 클릭으로 확인) → 소스 에디터 저장 API로 파일을 저장 →
Gitea 커밋 API에서 author가 관리자 계정이 아니라 그 설계자 자신의
Gitea 계정으로 찍히는지 확인 → 프로필 화면에서 토큰을 재발급·복사 →
로컬 `git clone`(실제 외부 클라이언트)으로 그 자격증명을 써서
clone → 파일 수정 후 `git push` → 실제로 성공하고 Gitea 커밋 로그에
반영되는지, 그 push가 지난 라운드의 시스템 웹훅 경로를 타고
`PushHookQueueEntry`까지 정상적으로 쌓이는지(기존 기능과의 통합
확인) → 그 프로젝트 멤버가 아닌 설계자의 Gitea 계정은 협업자 권한이
`none`이라 Gitea 스스로 접근을 거부함을 확인 → 토큰 재발급(회전) →
이전 토큰은 401, 새 토큰은 정상 동작 확인 → `docs member-set-role`/
`docs member-remove`/`docs git my-token`(CLI) 왕복 → MCP
`tools/list`로 `member_set_role`/`member_remove`는 있고
`git_my_token`은 없는지 확인 → 조직 생성이 재기동해도 중복 안
되는지(멱등) 확인.

`npm run db:generate`(3드라이버) → `npx tsc --noEmit`(backend) →
`vue-tsc -b`(frontend) 클린 확인.

## 멤버 역할 변경 - 본인의 owner 권한 스스로 해제 금지 - 완료 (2026-09-11)

설계자 요청 - 프로젝트 멤버 관리에서 (1) owner가 자신 한 명뿐이어도,
(2) 다른 owner가 더 있어도, 자기 자신을 owner가 아닌 role로 스스로
바꿀 수는 없어야 한다. `PUT /api/projects/:projectId/members/:userId`
라우트는 이미 `requireProjectRole("owner")`라 이 핸들러에 도달하는
호출자는 항상 그 프로젝트의 현재 owner다 - `core/members.ts`의
`updateMemberRole()`에 4번째 인자 `actingUserId`를 추가해 "대상
userId가 호출자 자신이고 새 role이 owner가 아니면" 거부하는 것
하나로 두 요구사항을 동시에 충족한다(다른 owner가 그 사람을 내리는
건 `userId !== actingUserId`라 그대로 허용 - 정상적인 owner 간 관리는
안 막힘). `ProjectSettingsView.vue`의 역할 select도 본인+owner인
행에서는 비활성화(기존 "본인 제거 버튼 비활성화" 패턴과 동일한 UX로
통일, 툴팁으로 이유 안내).

실사용 인스턴스로 실측: 프로젝트를 만들면 자동으로 owner가 되는
설계자가 스스로를 editor/viewer로 내리려 하면 400 + 안내 메시지
확인 → 두 번째 설계자를 owner로 추가해도 첫 owner는 여전히 스스로를
못 내리는지 확인 → 그 두 번째 owner가 첫 owner를 editor로 내리는
건(자기 자신이 아니므로) 정상 성공하는지 확인 → 웹 UI에서 본인+owner
행의 select가 비활성화(회색)로 보이고 타 설계자 행은 그대로 조작
가능한지 실제 클릭으로 확인.

`npx tsc --noEmit`(backend) → `vue-tsc -b`(frontend) 클린 확인.

## 팀/프로젝트 그룹 CRUD + 계층별 멤버 가시성 보안 강화 + 팀/그룹 스코프 DocType 완전 제거 - 완료 (2026-09-11)

설계자가 세 갈래 요구를 한 번에 제시했다: (1) 보안 요구사항 -
프로젝트 멤버는 그 프로젝트 멤버끼리만, 프로젝트 그룹 멤버(산하
전체 프로젝트 멤버 합)는 그룹 "관리자"만, 팀 멤버(팀 산하 전체)는
팀 "관리자"만 볼 수 있어야 한다. (2) UI 요구사항 - 팀/프로젝트
그룹 CRUD 전체(지금까지 생성/목록뿐이었음). (3) 추가 노트 - 팀/
프로젝트 그룹 단위로 문서 타입을 획일화해 정하는 기능은 없어야
한다 - 확인 결과 지금까지 여러 라운드([기관/그룹 스코프 DocType
생성 지원], [그룹/기관 스코프 DocType 상태/전이 지원], [웹 UI에서
DocType 관리] 등)에 걸쳐 만든 팀/그룹 스코프 DocType 생성·상태·
전이·표준흐름 관리 + project→group→team 상속 체인 전체를 완전히
제거하라는 뜻이었다(설계자 확인 - "네, 기존 팀/그룹 DocType 기능
전체를 완전히 제거").

**실측으로 확인한 시작 상태**: 프로젝트 멤버 목록은 이미
`requireProjectRole("viewer")`로 막혀 있어 요구 1(프로젝트 단위)은
이미 충족돼 있었다(그대로 유지, 새로 만든 것 없음). 그룹/팀 단위로는
"그 산하 전체 멤버를 한 번에 보여주는" 조회 자체가 아예 없었고,
"프로젝트 그룹 관리자"라는 개념 자체가 없었다(`TeamAdmin`은 있지만
대응하는 `ProjectGroupAdmin`이 없음).

**설계 결정**:
- `core/projectGroupAdmins.ts` 신설 - `core/teamAdmins.ts`를 그대로
  본떴다. 다만 팀은 그룹의 상위 개념이므로 `isProjectGroupAdmin()`은
  그 그룹에 명시적으로 등록된 관리자이거나, **그 그룹이 속한 팀의
  TeamAdmin이어도** true(기존 `canSeeHiddenProject`의 "팀장은 자기
  팀 산하 숨김 프로젝트도 본다"와 같은 상속 원칙 - DB에 별도 행을
  만들지 않고 함수 안에서 판정).
- 부트스트랩 - `addMember(project.id, req.userId!, "owner")`가
  프로젝트 생성자를 자동 owner로 넣는 것과 같은 원칙을 적용해
  `createTeam`/`createProjectGroup`이 생성 직후 그 사람을 자동으로
  첫 관리자로 등록한다("관리자만 볼 수 있다"로 잠근 뒤에도 방금
  만든 팀/그룹을 곧바로 관리할 수 있어야 하므로).
- **기존 보안 허점 발견·수정**: `POST/DELETE /api/teams/:teamId/admins`
  가 지금까지 `authenticate`+API 키 스코프만 확인하고 "호출자가
  실제로 그 팀의 관리자인가"는 확인하지 않았다(로그인한 아무
  설계자나 자기 자신을 아무 팀의 팀장으로 등록할 수 있었음 - 코드
  주석에 "설치 단위 admin role이 아직 없다는 기존 한계"로만 적혀
  있었다). 이번 라운드가 "보안 요구사항"을 명시적으로 다루는 김에
  `isTeamAdmin()` 확인을 추가해 닫았고, 새로 만드는 그룹 관리자
  라우트는 처음부터 `isProjectGroupAdmin()` 확인을 포함해서 같은
  구멍을 복제하지 않았다.
- 그룹/팀 멤버 가시성은 새 테이블 없이 기존 `Member` 데이터를 다른
  스코프로 집계 조회만 추가(`listMembersForGroup`/
  `listMembersForTeam`) - 중복 제거 안 함(한 사람이 여러 프로젝트에
  걸쳐 있으면 그만큼 여러 행, "사실 그대로 보여준다"는 기존 원칙과
  동일).
- 삭제는 비어있을 때만(폴더 삭제 등에서 이미 쓰는 관례) - 팀은
  소속 프로젝트 그룹이 있으면, 그룹은 소속 프로젝트가 있으면 명확한
  에러로 거부(이관 기능은 범위 밖).

**`DocType` 스키마 축소**: `teamId`/`projectGroupId` 컬럼과 관계·
인덱스 전부 삭제, `projectId`를 nullable에서 필수로 변경 - 문서
타입은 이제 항상 정확히 하나의 프로젝트에만 속한다. `core/docTypes.ts`
의 `ScopeInput`/`assertExactlyOneScope`/`listDocTypesForProject`
(project 스코프 단일 조회로 수렴해 `listDocTypes`와 동일해졌으므로
삭제) 제거. API 라우트 10개(팀·그룹 스코프 doc-types 생성/목록/
상태/전이/guideline/standard-flow) + `requireOwnedDocTypeByTeam`/
`ByGroup` 헬퍼, CLI 12개, MCP 12개 전부 삭제 - 프로젝트 스코프
`doctype-*`(CLI/MCP/API)는 손대지 않고 그대로. `DocTypeManager.vue`
는 `scope`/`scopeId` prop이 `projectId` 하나로 단순화됐다.
**`TemplateFile`(CLAUDE.md/SKILL.md 템플릿의 팀/그룹/프로젝트
override)은 완전히 별개 기능이라 이번 제거 대상이 아니다** - 이름이
비슷해 혼동하기 쉬워 명시.

**프런트엔드**: `TeamsView.vue`/`ProjectGroupsView.vue` 둘 다 "문서
타입 관리" 토글+`DocTypeManager` 임베드 제거하고, 이름 수정(인라인)/
(팀만) `enabled` 토글/삭제 버튼(비어있지 않으면 서버 에러 인라인
표시) + "멤버 보기" 토글(관리자만 성공, 비관리자는 에러 메시지로
안내)을 추가했다. 신규 `GroupAdminManager.vue`는 `TeamAdminManager.vue`
를 그대로 본뜨되 `/project-groups/:id/admins`를 쓰고, 팀장 상속을
설명하는 안내 문구를 추가했다. `ProjectSettingsView.vue`의 문서
타입 섹션 안내 문구도 이제 없어진 그룹/팀 상속을 언급하던 옛 문구를
지우고 갱신했다.

**구현 중 실측으로 발견한 버그(같이 고침)**: `db:generate` →
`tsc --noEmit`/`vue-tsc -b` 클린 확인 후 docker 인스턴스로 실사용
검증하던 중, 방금 만든 빈 팀/그룹도 삭제가 항상 400(FK 제약 위반 -
`ProjectGroupAdmin_projectGroupId_fkey`/`TeamAdmin_teamId_fkey`)으로
실패하는 걸 발견했다. 원인은 `TeamAdmin.team`/`ProjectGroupAdmin.projectGroup`
관계에 `onDelete: Cascade`가 없었던 것 - 이번 라운드 전에는 팀/그룹
삭제 기능 자체가 없어 드러나지 않았던 문제가, 새로 만든 "생성자
자동 관리자 등록" 기능 때문에 모든 팀/그룹이 항상 관리자 행을 최소
하나 갖게 되면서 "비어 있으면 삭제 허용"을 실제로 막아버렸다. 이미
`ApiKey.team`/`ApiKey.project` 관계에 적용돼 있던 동일 패턴(부모
소멸 시 자식 권한/메타데이터 행도 같이 소멸)을 그대로 가져와
3드라이버 스키마 전부에 추가하고 재생성 → 재현 후 수정 확인.

**실사용 인스턴스로 실측 검증**(3개 계정 alice/bob/carol + 기존
admin, REST API 직접 호출 + 웹 UI 클릭 양쪽):
- 요구 1 회귀 없음: 비멤버가 `GET /projects/:id/members` → 403.
- 요구 2: bob이 alice의 팀 산하에 그룹 생성 → bob 자동 그룹 관리자
  등록 확인. carol이 그 그룹의 프로젝트를 만들어 멤버(owner)가 됨.
  carol(프로젝트 멤버, 그룹 관리자 아님) → 그룹 멤버 조회 403. bob
  (명시적 그룹 관리자) → 200(carol의 owner 행 포함 정상 조회). alice
  (그룹 관리자로 등록된 적 없음, 팀장 상속으로만) → 200(상속 확인).
- 요구 3: alice가 팀을 만들면 자동 팀장 등록 확인. `GET /teams/:id/members`
  가 산하 그룹까지 전부 펼쳐 보여줌(groupName/projectName 포함),
  비관리자(carol) → 403.
- 보안 허점 수정 확인: carol이 자기 자신을 팀장으로 등록 시도 →
  403(수정 전이었다면 200으로 성공했을 것). 그룹 관리자 자가 등록도
  동일하게 403.
- CRUD: 팀 이름 변경+`enabled` 비활성화 반영 확인, 그룹 이름 변경
  반영 확인. 비어있지 않은 팀/그룹 삭제 시도 → 400 + 안내 메시지,
  새로 만든 빈 팀/그룹 삭제 → 200(cascade 수정 후 확인). 웹 UI에서
  같은 흐름 실제 클릭으로 재현 - 팀/그룹 화면에 "문서 타입 관리"
  버튼이 안 보이는 것도 확인.
- DocType 제거 확인: 제거된 CLI 12개 전부 `docs --help`에서 사라짐
  (`doctype-*`만 프로젝트 스코프로 남음), MCP `doctype_*_team`/
  `doctype_*_group` 12개 전부 서버 소스에서 제거 확인. 프로젝트
  생성 시 기본 6종(SP/DC/PL/PD/RM/DS) 시딩 회귀 없음(carol이 만든
  프로젝트로 실측).

`npm run db:generate`(3드라이버) → `npx tsc --noEmit`(backend) →
`vue-tsc -b`(frontend) 클린 확인. README.md 최신 라운드 + "지금 상태"
DocType 항목, 본 문서 갱신.

## 최고 관리자(admin) 전권 + CUD 버튼 권한별 숨김 + 프로젝트 삭제 + git 저장소 관리자 전용화·외부 저장소 동기화(발행) - 완료 (2026-09-11)

설계자가 여섯 가지를 요청했다: (1) 권한 없는 사용자에게 CUD(Create/
Update/Delete) 기능이 보이면 안 된다, (2) `admin` 계정은 항상 최고
관리자라 모든 기능에 접근할 수 있어야 한다, (3) 프로젝트 삭제 버튼을
"설정" 화면에 "제한구역" 섹션으로 추가한다 - 1차 요청 검토(Plan Mode)
중 추가로 확인해 함께 승인받은: (4) git 저장소 기능은 프로젝트
관리자만 쓸 수 있어야 한다, (5) 외부 저장소 연동 시 "동기화"를 누르면
자격 증명을 요청하고 커밋/푸시 권한을 확인해야 한다, (6) 즉시 병합이
불가능하면 AI 대기열로 넘기고 완료 보고가 오면 버튼이 재활성화돼야
한다. Explore 에이전트 3개(백엔드 권한 판정 함수 전수조사, 프런트엔드
CUD 버튼 전수조사, 기존 git 동기화/push-hook-queue 메커니즘 전수조사)
로 설계했다.

**최고 관리자**: `core/auth.ts`에 `isSuperAdmin(userId)` 신설 - admin
계정의 id를 최초 호출 시 1회만 DB로 조회해 캐시하고(못 찾으면 매번
재조회, 찾으면 순수 문자열 비교) 이후 사실상 공짜. 딱 세 함수만
고쳐서 전체 권한 판정 트리가 연쇄적으로 우회되게 만들었다 -
`core/members.ts`의 `getMemberRole`(스코프 체크 후 `"owner"` 즉시
반환), `core/teamAdmins.ts`의 `isTeamAdmin`(스코프 체크 후 `true`),
`core/projectGroupAdmins.ts`의 `isProjectGroupAdmin`(함수 맨 위,
팀 없는 그룹도 커버해야 하므로 독립적으로 필요). `resolveEffectivePermission`
/`canSeeHiddenProject`/`requireProjectRole`/`updateMemberRole`의
self-guard 등은 `getMemberRole`을 거치므로 전부 자동 적용됐다.
`listMembers()`는 별도 쿼리라 영향 없음(admin이 실제 멤버가 아닌
프로젝트의 멤버 목록에 가짜로 나타나지 않음 - 의도대로 정확함).
**API 키 스코프 완전 우회**(설계자 확인 - 옵션 (a), 스코프 유지+역할만
우회하는 (b)안 대신): `middleware/auth.ts`의 API 키 인증 분기에서
`isSuperAdmin(result.userId)`가 true면 `runWithKeyScope`에 실제
스코프 대신 `{type:"unrestricted"}`를 넘긴다 - JWT 로그인 분기는
이미 항상 unrestricted라 무변경. **"본인 소유물만" 계열도 admin은
대행 가능**(설계자 확인): `core/comments.ts`(editComment/deleteComment/
setCommentStatus 3곳), `core/folders.ts`(assertOwnsFolder),
`core/gitCredentials.ts`(removeGitCredential) - 전부 소유권 비교에
`|| isSuperAdmin(...)` 한 줄씩. `DELETE /api/api-keys/:keyId`는
personal 키를 타인이 소유한 경우 대체 분기가 없어 명시적으로
`|| await isSuperAdmin(...)`을 추가.

**CUD 버튼 권한별 숨김**: 프런트가 스스로 "나는 admin이다"를 판정하지
않는다 - 서버가 계산한 권한 필드(이미 admin-aware한 core 함수를
거침)를 응답에 얹어 내려주고, 프런트는 그 필드로만 `v-if`한다.
`GET /teams`/`GET /project-groups`에 `isAdmin`(행별), `GET /projects`
에 `canToggleHidden`(행별, 숨김 토글 라우트와 정확히 같은 조건),
`GET /projects/:id`에 `myRole`, `GET /documents/:code`에 `perm`
(라우트가 이미 계산해 버리던 `resolveEffectivePermission` 결과를
그대로 실어보냄 - 기존엔 notice만 썼음), 댓글 목록에 `canManage`
(작성자 본인 또는 admin) 필드를 추가. **`ProjectShellView.vue`가
이 저장소 최초로 Vue `provide`/`inject`를 도입** - `myRole`을
`PROJECT_MY_ROLE_KEY`(신규 `utils/projectContext.ts`)로 하위 라우트
전체(문서/칸반/설정/메시지 등)에 내려줘서, 탭마다 같은 값을 따로
fetch하지 않게 했다. `AppLayout.vue` 사이드바의 `DocumentExplorer.vue`
와 다이얼로그 전용(`QAPanel.vue`)은 이 provide 트리 밖이라 각자
가벼운 `GET /projects/:id`를 한 번 더 호출(이 앱 규모에서 무시
가능한 중복). `TeamAdminManager.vue`/`GroupAdminManager.vue`/
`TeamKeysManager.vue`는 내부 버튼을 안 건드렸다 - 바깥 토글이 이미
`isAdmin`으로 잠겨서 비관리자는 패널 자체를 못 여니 이중 가드가
불필요. `CommentsPanel.vue`는 기존 `isMine(c)` 로컬 판정을 서버가
계산한 `c.canManage`로 교체.

**프로젝트 삭제("제한구역")**: 스키마 감사로 `Project`를 가리키는
직계 관계 14개(`Member`/`DocType`/`Document`/`Comment`/`Question`/
`PushHookPrompt`/`Message`/`TemplateFile`/`TrackingCode`/`Folder`/
`DocAccessOverride`/`KanbanColumn`/`KanbanCard`/`ProjectGitRepo`)에
`onDelete: Cascade`를 추가하고 `core/projects.ts`에 `deleteProject`,
`core/gitRepos.ts`에 `deleteProjectGitRepo`(provider별 slug 계산 -
self_hosted는 하나, external_linked는 미러+작업 저장소 둘 다 -
Gitea API로 실제 삭제, 실패해도 fail-soft로 로그만 남기고 진행)
신설. `DELETE /api/projects/:projectId`(owner 전용) + CLI `docs
project-delete`/MCP `project_delete`. 프런트는 `ProjectSettingsView.vue`
최하단에 "제한구역" 섹션(owner에게만 `v-if`), `window.confirm()`
확인(기존 `DocumentEditorView.vue`의 `remove()` 패턴과 동일한 관례)
후 삭제, 성공 시 `/projects` 목록으로 이동.

**실측 중 발견해 같이 고친 스키마 버그**: 위 14개 직계 관계에 cascade를
걸고 실제 삭제를 시도했더니 `DocStatus_docTypeId_fkey` 위반으로
실패했다 - `DocType`이 cascade로 지워질 때 그 자식인 `DocStatus`/
`DocStatusTransition`(`docType`/`fromStatus`/`toStatus` 3개 FK)에는
cascade가 없어서 막힌 것. 같은 "조부모-부모-자식 다이아몬드" 패턴을
전수조사해 `Document`의 `docType`/`status` FK, `KanbanCard`의
`column` FK, `Folder`의 자기참조 `parentFolder` FK에도 같은 문제가
있어 전부 고쳤다(3드라이버 전부, 총 8개 관계 추가) - 재현 후 실제
문서/코멘트/질의/칸반카드/git 저장소가 있는 프로젝트를 삭제해 성공
확인, Gitea REST API로 연결된 저장소가 실제로 사라진 것까지 직접
확인했다. **덤으로 발견한 leftover 버그**: `AccessControlManager.vue`
가 지난 라운드에 제거된 `/doc-types/own` 엔드포인트를 여전히
호출하고 있었다 - `/doc-types`로 수정.

**git 저장소 관리자 전용화 + 외부 저장소 동기화(발행)**: `POST/GET
.../git/sync-status`, `GET .../git/sync-proposal`을 `viewer` → `owner`
로 강화(연결 라우트는 원래도 owner 전용이었음). 실제 외부 저장소로의
push는 **Gitea 자체의 Push Mirror 기능**을 쓰기로 확정(설계자 확인 -
이 시스템이 지금까지 모든 git 동작을 Gitea REST API에 위임해온
철학과 일치, 실제 커밋 이력 보존, Gitea가 fast-forward 실패를 직접
감지). `core/gitea.ts`에 `configurePushMirror`/`triggerPushMirrorSync`/
`getPushMirrorStatus` 신설(기존 pull-mirror 함수들과 같은 스타일).
`core/gitRepos.ts`의 `publishToExternalRepo`는 **별도 사전 fast-forward
판정 없이 "시도 후 결과로 판단"** 한다(이 시스템의 기존 관례 -
예: 웹훅 자동 등록 실패 시 수동 안내로 폴백하는 패턴과 동일) - push
mirror 동기화를 트리거하고 `lastError` 유무로 성공/실패를 가른다.
실패하면 신규 모델 `GitSyncQueueEntry`(`PushHookQueueEntry`가
`projectId`를 직접 안 가져서 보안 재확인이 필요했던 전례를 반영해
이번엔 처음부터 직접 보유)에 큐 항목을 만들고, `core/messages.ts`의
`sendMessage(projectId, null, ...)`(시스템 발신 - `authorId`가
nullable로 이미 지원되던 필드, 이번이 첫 사용 사례)로 그 프로젝트에
안내 메시지를 보낸다. `POST .../git/publish`(owner), `GET
.../git/publish-queue`(owner, pending 항목 존재 여부), `POST
.../git/publish-queue/:id/done`(editor 이상, AI가 호출 - 기존
`transitionQueueEntry`처럼 요청 프로젝트와 큐 항목의 실제 프로젝트
일치 확인 포함) + CLI `docs git publish/publish-queue/publish-queue-done`
/MCP `git_publish`/`git_publish_queue`/`git_publish_queue_done`.
프런트(`GitRepoPanel.vue`)는 기존 동기화 상태 폴링(`syncPollStatus`)
과 같은 스타일로 별도 폴링 루프를 추가해 큐 항목이 사라질 때까지
"동기화" 버튼을 비활성화한다.

**실사용 인스턴스로 실측 검증**: admin 계정으로 로그인해 다른 사람이
만든 팀 이름수정/삭제, 남의 코멘트 수정, 비멤버 프로젝트의 숨김
토글이 전부 성공하는지 확인. admin이 만든 **프로젝트 스코프 API
키로 스코프 밖의 완전히 다른 프로젝트**에 접근해도 성공하는지 확인
(동일한 모양의 일반 설계자 키로는 여전히 403 - 대조 확인으로 우회가
admin 전용임을 검증). 웹 UI에서 비관리자 계정으로 팀 목록을 열면
버튼이 하나도 안 보이고, 실제 팀장 계정으로 열면 전부 보이는 대조
확인. 문서/코멘트/칸반카드/git 저장소가 있는 프로젝트를 owner
계정으로 삭제 → DB 데이터 전부 삭제 + Gitea 저장소가 실제로 사라진
것을 Gitea API로 직접 확인, owner 아닌 계정으론 403 확인.
`POST/GET .../git/sync-status`를 viewer 계정으로 호출하면 403(회귀
재현 후 수정 확인), owner 계정은 통과.

`npm run db:generate`(3드라이버) → `npx tsc --noEmit`(backend) →
`vue-tsc -b`(frontend) 클린 확인. README.md 최신 라운드 + "지금 상태"
여러 항목, QA-SCENARIOS.md, SKILL.md(양쪽 사본) 갱신.

## CLI/MCP 대칭성 자동 감사 스크립트 - 완료 (2026-09-11)

PLANS.md `#cli-mcp-audit-script`(우선순위 1순위 제안) 착수. 신규
`backend/scripts/audit-cli-mcp.ts`(이 저장소 첫 `scripts/` 디렉터리,
`tsx`로 직접 실행 - 기존 `dev`/`cli`/`mcp` 관례와 동일, 빌드 불필요) +
`package.json`에 `"audit:cli-mcp": "tsx scripts/audit-cli-mcp.ts"` 추가.

CLI(`src/cli/index.ts`)는 `program`이 export되지 않고 파일 끝에서
`program.parse()`가 무조건 실행돼 모듈 import로는 명령 목록을 못
구하므로, 소스를 정규식으로 정적 파싱해 리프 명령 106개를 추출한다
(플랫 `program.command(...)` + 그룹 `xxxCmd.command(...)` 두 패턴만
존재 - 동적 생성 없어 정규식만으로 충분). MCP(`src/mcp/server.ts`)는
반대로 실제 서버 프로세스를 `tsx`로 띄우고(`StdioClientTransport` +
`Client`, 20초 타임아웃 가드) 표준 `tools/list`를 호출해 도구 98개를
구한다 - 도구 등록 자체는 DB/네트워크 호출이 없는 순수 선언(직접 코드
확인)이라 백엔드/DB 없이도 정확하고, `git_diff`처럼 `tool()` 헬퍼를
안 거치는 예외도 자동으로 잡힌다.

첫 실행에서 CLI 전용 30개/MCP 전용 29개가 나왔으나 실제 버그가 아니라
대부분(29쌍) **명명 규칙 차이**였다 - CLI는 이미 특정 리소스 맥락
안에 있어 짧은 동사만 쓰지만(`new`/`get`/`list`), MCP는 도구 108개가
평평한 한 목록으로 노출돼 리소스 접두어를 붙인다(`document_new`/
`document_get`/`document_list`). 스크립트 내 `KNOWN_RENAMES` 맵으로
CLI 태그 ↔ MCP 태그 29쌍을 명시적으로 대응시켜 해결. 나머지 1개
(`git my-token` - Gitea PAT 재발급/1회 노출)는 진짜 CLI 전용 기능으로
확인(MCP에 `my-token`/`git_token` 패턴 자체가 없음, `key create`와
같은 급의 신원 관리 동작) - `KNOWN_CLI_ONLY` 허용목록에 8번째 항목으로
추가. `.claude/skills/claude-native-workflow/SKILL.md`와
`backend/prisma/seed-templates/SKILL.md`(양쪽 사본) "CLI/MCP에
의도적으로 없는 기능" 절에 `auth use-key`/`git my-token` 문구 보강해
스크립트 허용목록과 문서 근거를 동기화.

**실측 검증**: `npm run audit:cli-mcp` 클린 실행(CLI 106/MCP 98,
허용 예외 8개, 불일치 0) 확인. 역방향 둘 다 실측 - CLI에 임시 명령
하나 추가 후 스크립트가 정확히 그 이름을 `cliOnly`로 잡고
`exitCode=1`이 되는지 확인 → 원복 → MCP에 임시 도구 하나 추가해
`mcpOnly`로 잡히는지 확인 → 원복 → 재실행해 다시 클린 통과 확인.
`npx tsc --noEmit`(backend) 클린 확인 - 신규 스크립트는
`tsconfig.json`의 `rootDir: "src"` 범위 밖이라 별도 타입체크 대상이
아님(의도적 - 배포되는 `dist/`와 개발용 도구의 경계와 일치, 별도
tsconfig 불필요로 판단).

## 로그인 무차별 대입(rate limit) 방어 - 완료 (2026-09-11)

PLANS.md `#login-rate-limit` 착수(설계자가 이번 라운드 우선순위로
직접 선택). 최초 설치 시 자동 시드되는 `admin/12345678` 고정 계정이
있어 무차별 대입이 가상의 위험이 아니라는 점이 동기.

신규 `backend/src/core/loginRateLimit.ts` - 전용 DB 테이블 없이 메모리
`Map` 2개(식별자별·IP별)로만 추적한다(`core/gitRepos.ts`의
`syncStateByProject`와 같은 원칙 - 재시작 시 사라져도 되는 일시적
카운터라 DB 영속화 불필요, User 모델에 필드 추가해 3드라이버 스키마를
전부 고치는 것보다 가볍고 되돌리기 쉬움). 식별자별
`5회 실패/15분 창 → 15분 잠금`, IP별 `20회 실패/15분 창 → 15분 잠금`
(사무실/NAT처럼 여러 정상 사용자가 IP를 공유할 수 있어 더 느슨하게).
두 카운터를 분리한 이유 - 합치면 "한 IP가 여러 계정에 spray"하는
공격을 못 잡음. 10분마다 만료 항목을 쓸어내는 `setInterval` 스윕(
`.unref()`로 프로세스 종료를 안 막음)으로 무한정 쌓이는 것 방지.

체크 위치는 미들웨어가 아니라 `core/auth.ts`의 `login()` 함수 안(이
함수가 이 코드베이스 전체에서 유일한 진입점이라 다른 경로로 우회할 수
없음, 실패 기록도 기존 `AuthError`를 던지는 바로 그 지점에 인라인으로
추가하는 게 응답을 사후에 들여다봐야 하는 미들웨어보다 단순). 새 에러
클래스 `LoginRateLimitError`(`retryAfterSeconds` 필드, `AuthError`와
같은 스타일)를 `server.ts`의 전역 에러 핸들러에서 `AuthError` 분기
바로 다음에 추가 - 429 + `Retry-After` 헤더 + 기존과 같은
`{error: "..."}` JSON. 로그인 성공 시엔 그 식별자의 카운터만 지운다
(IP 쪽은 그대로 둬서, 같은 IP의 다른 계정이 spray당하고 있을 가능성에
대비). 범위는 `POST /api/auth/login`만 - `register`/`refresh`는 건드리지
않음(참고: `register`도 무제한 스팸이 가능한 상태라 별도 백로그 후보로
남김, 이번 라운드엔 안 섞음). 범용 감사 로그 테이블은 만들지 않고
(`core/activity.ts`의 "정규화 원칙과 일치해 별도 감사 로그 테이블
신설 안 함" 관례를 그대로 따름), 잠금 발생 시 `console.warn` 한 줄만
남긴다.

**실측 검증**: 이미 떠 있는 docker 스택의 `backend` 컨테이너를
재빌드·재기동해 실제 HTTP 호출로 확인. 틀린 비밀번호로 `admin` 계정에
5회 연속 실패(전부 400) → 6번째 호출에서 429 + `Retry-After: 900` +
안내 메시지 확인. 잠긴 상태에서 **올바른** 비밀번호로도 429(우회 안
됨) 확인. `register`/`refresh`는 영향 없음(200/400, 429 없음) 확인.
리셋/만료 검증은 상수를 테스트용으로 임시로 줄여서(임계값 3회/60초
창/10초 잠금) 재빌드 후 확인: 실패 2회 → 성공(200) → 실패 3회(전부
400, 리셋 증명 - 합쳐서 5회가 아니라 새로 3회 필요) → 다음 시도
429 확인, 10초 대기 후 재시도 시 다시 200으로 풀리는 것 확인.
IP별 잠금도 별도로 확인 - 존재하지 않는 서로 다른 아이디 20개로
실패시킨 뒤 21번째(역시 새 아이디)가 429인 것 확인(식별자가 달라도
IP 카운터로 잠김). 검증 후 상수를 원래 값(15분/15분/15분)으로 복원해
재빌드, 이미지 해시가 최초 빌드와 동일함을 확인해 복원이 정확함을
재확인. `npx tsc --noEmit`(backend) 클린 확인.

## API 키 선택적 만료(TTL) - 완료 (2026-09-11)

PLANS.md `#api-key-ttl` 착수(설계자가 인증 보안 3종 중
`#login-rate-limit` 다음 우선순위로 직접 선택). 지금까지 API 키는
배제(revoke)만 가능하고 자동 만료가 없어, 장기 방치된 키가 영원히
유효했다.

`ApiKey` 모델(3드라이버 스키마 전부)에 `expiresAt DateTime?` 추가
- `RefreshToken.expiresAt`과 같은 스타일이되, TTL이 선택이라
nullable로 둔 점만 다르다. DB엔 여전히 `status: active | revoked` 2값만
저장하고, "만료됨"은 새 상태를 저장하지 않고 `core/apiKeys.ts`의
`toDetail()`에서 `status === "active" && expiresAt <= now`일 때
`"expired"`로 **읽는 시점에 파생**한다(스윕/크론 불필요 - 시계만
보면 됨, 배제 상태가 항상 우선). `verifyApiKeySecret()`(인증
리졸버)에 만료 검사 한 줄 추가 - `lastUsedAt` 갱신보다 먼저 검사해
만료된 키 사용 시도가 마지막 사용 시각을 갱신하지 않게 함. 최고
관리자(admin)의 스코프 우회는 이 검사 *이후* 미들웨어에서 적용되므로
admin이 만료된 키를 써도 여전히 거부됨(의도).

생성 라우트 3개(`server.ts`의 personal/project/team `POST .../api-keys`)
에 `expiresAt` 파싱을 공용 헬퍼 `parseExpiresAt()`으로 추가 - 미지정/
빈 문자열은 무기한(기존 동작 그대로), 과거 시각/파싱 불가는 400. 팀
라우트는 기존에 `ApiKeyError`를 403(권한 오류)으로 매핑하고 있어서,
입력 검증 실패가 그 매핑에 섞이지 않도록 `createApiKey` 호출 전에
별도로 끊어 항상 400이 되게 함. CLI `key create`에 `--expires-in
<일수>`(양의 정수) 옵션 추가, `core/auth.ts`의 리프레시 토큰 발급과
같은 ms 산술로 ISO 시각을 계산해 보냄. MCP는 원래도 키 관리 도구가
없어 변경 없음.

웹 UI 세 벌(`PersonalKeysManager.vue`/`ProjectKeysManager.vue`/
`TeamKeysManager.vue`, 서로 거의 동일한 구조라 세 곳 다 병행 수정)
- 생성 폼에 만료 선택 `<select>`(만료 없음/7일/30일/90일/1년, 이
저장소 웹 UI 최초의 만료 관련 입력 - 날짜 피커 대신 CLI와 같은
"일수" 의미론으로 통일해 시간대 모호성을 피함) 추가. 상태 배지를
`active`/`revoked` 2항 삼항에서 `statusLabel()` 함수(활성/배제됨/
만료됨)로 바꾸고, `li` dim 조건도 `status === 'revoked'`에서 `status
!== 'active'`로 넓혀 만료된 키도 같이 흐리게 표시. 목록 행에 `expiresAt`
이 있으면 생성일 옆에 만료 일시를 같이 표시.

**실측 검증**: docker 스택의 `backend`를 재빌드·재기동
(`docker-entrypoint.sh`의 `prisma db push`로 신규 컬럼 반영 확인) 후
실제 HTTP 호출로 왕복. 과거 시각/잘못된 형식의 `expiresAt`은 둘 다
400, 미지정은 200 + `expiresAt: null` 확인. 약 8초 뒤 만료하는 개인
키를 생성해 만료 전엔 그 키로 `GET /api/auth/me` 200 + 목록에서
`status: active` 확인 → 만료 후엔 같은 호출이 401("배제·만료" 메시지)
+ 목록에서 `status: expired`로 바뀌는 것 확인 → 이미 만료된 키를
배제해도 정상적으로 `revoked`로 전환되는 것까지 확인. CLI `key create
--expires-in 1`의 응답 `expiresAt`이 생성 시각의 정확히 24시간 뒤인지,
`--expires-in 0`/`abc`는 둘 다 에러로 거부되는지 확인. 브라우저로
admin 로그인 후 내 정보 화면에서 "7일 후 만료" 선택해 키 생성 →
목록에 만료 일시가 표시되고, 앞서 배제한 키는 회색 "배제됨" 배지로
흐리게 표시되는 것을 스크린샷으로 확인. `npx tsc --noEmit`(backend),
`vue-tsc -b`(frontend) 클린 확인.

## admin 대행 비밀번호 재설정 - 완료 (2026-09-12)

PLANS.md `#password-reset` 착수(색인 표 4번). 조사 결과 이 스택엔
이메일 발송 인프라가 전혀 없고(SMTP 라이브러리/서비스/환경변수
없음), admin 대행/사용자 관리 화면도 없어 설계자에게 방식을 확인 -
"admin이 사용자 목록에서 계정을 골라 임시 비밀번호를 발급"하는
방식으로 결정(SMTP self-service 대신 - "admin이 곧 설치자"라는 기존
전제와 일치, 새 인프라 불필요).

스키마 변경 없이 기존 `User.passwordHash`만 갱신한다. `core/auth.ts`
- `register()`가 인라인으로 하던 argon2 해시를 `hashPassword()`
헬퍼로 뽑아 재사용, `resetPasswordAsAdmin(targetUserId)` 신규(32자
hex 임시 비밀번호 생성 → 해시 → 갱신, 평문은 반환값에만 담고
저장 안 함 - API 키 secret과 동일한 1회 노출 원칙), `listAllUsersForAdmin()`
신규(기존 `listUsers()`는 엔티티 선택기용으로 `{id,username,
displayLabel}`만 반환해 다른 화면이 그 모양에 의존하므로 건드리지
않고 이메일/가입일까지 포함한 별도 함수로 분리). `MeProfile`/`getMe()`
/`updateMe()`에 `isSuperAdmin: boolean` 신규 - 지금까지 admin 전용
UI는 전부 프로젝트/팀 스코프의 서버 계산 필드로만 처리했는데, 이번엔
전역 nav 링크 노출 여부를 결정할 전역 신호가 처음 필요해져 기존
`isSuperAdmin()` 함수를 한 번 더 호출해 채움(실제 보안 경계는 항상
서버의 `requireSuperAdmin`, 이 필드는 UI 노출 여부만 결정).

`middleware/auth.ts`에 `requireSuperAdmin` 신규(`requireUnrestrictedScope`
와 같은 스타일) - 지금까지 `isSuperAdmin()`은 다른 조건과 OR로
묶어 라우트에서 인라인 호출해왔지만(API 키 배제 라우트가 유일한
예), 이번엔 admin 전용(OR 없음) 라우트가 2개 생겨 재사용 가능한
미들웨어로 분리. 이 저장소 첫 `/api/admin/*` 네임스페이스로
`GET /api/admin/users`/`POST /api/admin/users/:userId/reset-password`
신설(둘 다 `authenticate, requireUnrestrictedScope, requireSuperAdmin`).
CLI `user` 그룹에 `list`(admin 전용, raw JSON)/`reset-password
<userId>`(`key create`/`git my-token`과 동일한 1회 노출 경고) 추가.
MCP는 그대로 없음 - `key create/list/revoke`와 같은 급의 신원 관리
동작이라 완전성 원칙의 의도적 예외에 새로 편입(SKILL.md 양쪽 사본
갱신, `audit-cli-mcp.ts`의 `KNOWN_CLI_ONLY`에 `user_list`/
`user_reset_password` 추가).

웹 UI - `stores/auth.ts`의 `Me`에 `isSuperAdmin` 추가,
`AppLayout.vue`의 비-프로젝트 nav에 `v-if="auth.me?.isSuperAdmin"`인
"사용자 관리" 링크(`/admin/users`) 추가. 신규
`AdminUsersView.vue` - 사용자 목록(아이디/닉네임/이메일/가입일) +
"비밀번호 재설정" 버튼, 클릭 시 `PersonalKeysManager.vue`의 1회
노출 박스(reveal-box, 복사 버튼)와 동일한 패턴으로 새 임시 비밀번호
표시. `auth.me?.isSuperAdmin`이 false면(직접 URL 접근 등) 안내
문구만 표시(실제 차단은 서버 403).

**실측 검증**: 테스트 계정 등록 후 admin/일반 계정 둘 다 로그인해
`GET /api/admin/users`/`POST .../reset-password`를 일반 계정으로
호출 시 403, admin으론 200 확인. 실제로 테스트 계정 비밀번호를
재설정해 기존 비밀번호는 더 이상 로그인 안 되고 새 임시 비밀번호로는
즉시 로그인되는 것 확인. `GET /api/auth/me`가 admin엔
`isSuperAdmin: true`, 일반 계정엔 `false` 반환 확인. CLI `docs user
list`/`user reset-password <id>` 왕복 확인(CLI로 발급한 임시
비밀번호로 실제 웹 UI 로그인까지 성공 확인). 브라우저로 admin
로그인 시 "사용자 관리" 링크와 목록·재설정·1회 노출 박스 전부 확인,
같은 브라우저에서 일반 계정으로 로그인하면 그 링크가 없고 `/admin/
users` 직접 접근 시 안내 문구만 뜨는 것까지 확인. `npm run
audit:cli-mcp` 클린 재확인(CLI 108개, 허용 예외 10개). `npx tsc
--noEmit`(backend), `vue-tsc -b`(frontend) 클린.

## 프로젝트 그룹 재소속 - 완료 (2026-09-12)

PLANS.md `#team-group-reparent` 착수(색인 표 5번). 지금까지 그룹은
생성 시점에만 `teamId`를 정할 수 있고 이후엔 이름만 고칠 수 있어,
잘못된 팀 아래 만든 그룹을 바로잡으려면 비우고 지운 뒤 다시 만드는
수작업뿐이었다.

조사 결과 `ProjectGroup.teamId`는 이미 nullable이고 `onDelete`도
기본 SetNull이라 스키마상 막혀있던 게 전혀 아니었다 - 순수하게
`updateProjectGroup()`/라우트/CLI/UI 어디에도 `teamId` 수정 경로가
없었을 뿐(마이그레이션 불필요). `Project.projectGroupId`가 그룹을
직접 참조하므로(팀을 직접 참조하지 않음) 그룹 하나만 옮기면 산하
프로젝트 전부가 자동으로 새 팀 소속이 된다.

권한 설계가 이번 라운드의 핵심 - `isProjectGroupAdmin()`이 그
그룹이 "지금" 속한 팀의 관리자 여부를 매번 계산해서 판정하기
때문에(저장된 값이 아니라 상속), 그룹을 옮기는 순간 "누가 이
그룹을 관리하는가"가 조용히 바뀐다. 목적지 팀의 동의 없이 아무나
그룹을 던져 넣을 수 있게 두면 안 돼서, **다른 비어있지 않은 팀으로
옮길 때만** 기존 `isProjectGroupAdmin`(현재 권한) 외에
`isTeamAdmin(destinationTeamId)`(목적지 동의)를 추가로 요구한다 -
팀 없음으로 떼어내는 경로는 목적지가 없으니 기존 권한만으로 충분.
admin은 둘 다 기존처럼 우회. 이 코드베이스에 "다른 부모로 옮기기"
류 동작의 전례가 전혀 없어(프로젝트→그룹 이관 함수조차 없음, 이번
범위 밖) 새로 정한 규칙.

`core/projectGroups.ts`의 `updateProjectGroup(groupId, {name?,
teamId?})` - 둘 다 선택으로 바꾸고 준 필드만 갱신, `teamId` 지정 시
`createProjectGroup()`과 동일한 팀 존재/`teamsEnabled` 검증 반복(두
함수가 독립적으로 실패해야 한다는 판단, 공용 헬퍼로 억지로 묶지
않음). `getProjectGroupById()` 신규 - 라우트가 목적지 검사 여부를
판단하려면 현재 `teamId`를 알아야 해서. `PUT
/api/project-groups/:groupId`는 기존 두 체크(스코프/그룹 관리자)에
목적지 팀 검사를 조건부로 추가, 빈 문자열도 `null`(팀 없음)로
정규화(그룹 생성 라우트와 같은 관례). CLI `group-update`의 `--name`
을 필수에서 선택으로, `--team <id>` 추가. MCP `group_update`도
`teamId` 선택 인자 추가(그룹 CRUD는 이미 MCP에 노출돼 있어 키
관리류의 의도적 예외 대상이 아님). 웹 UI `ProjectGroupsView.vue` -
그룹 관리자에게만 읽기 전용 팀 이름 자리를 `<select
class="move-select" @change="moveTeam(...)">`로 교체(문서 탭의
폴더 이동 select와 같은 패턴), 실패 시 행별 인라인 에러.

**실측 검증**: 팀 A/B와 각각의 팀장 계정, 팀 A 아래 그룹 하나를
실제로 만들어 왕복. 팀 A 관리자 단독으로 팀 B 이동 시도 → 403 확인.
두 팀 다 관리하는 계정으로 같은 이동 → 200, `GET
/api/project-groups?teamId=B`에 실제로 나타나는지 확인. 팀 없음으로
떼어낸 직후, 팀 상속으로만 관리자였던 그 계정이 이름 수정마저
403으로 거부되는 것까지 확인(관리자 상속이 즉시 바뀐다는 설계
근거를 실제 재현으로 검증) - 원래 그룹 생성자(명시적
`ProjectGroupAdmin` 행 보유)는 계속 수정 가능한 것과 대조 확인.
name/teamId 둘 다 없는 요청은 400. CLI `group-update --team
<id>`/`--team=`(빈 값 detach) 왕복, MCP `group_update`(teamId 포함)
실제 MCP 클라이언트로 왕복 확인. 브라우저로 두 팀 관리 계정 로그인 →
드롭다운으로 그룹 이동 성공(네트워크 탭에서 `PUT .../project-groups/
:id → 200` 확인) → 권한 없는 팀으로 다시 시도 → 인라인 에러 문구
스크린샷 확인. `npm run audit:cli-mcp` 클린 재확인. `npx tsc
--noEmit`(backend), `vue-tsc -b`(frontend) 클린.

## 팀/그룹/프로젝트 기본 비공개 가시성 - 완료 (2026-09-12)

설계자의 신규 요청 착수(PLANS.md 색인에 없던 직접 요청 - 진행 중이던
`#folder-access-ui`(폴더 공유+ACL 재설계)는 보류하고 이걸 먼저 처리).
지금까지 팀/프로젝트 그룹/프로젝트는 로그인만 하면 멤버십과 무관하게
전체가 보였다(`listTeams`/`listProjectGroups`/`listProjects` 전부
필터 없음, `viewerId`는 `isAdmin` 계산에만 사용 - 조사로 확인).
요구사항: 권한 없는/소속 안 된 팀·그룹·프로젝트는 아예 안 보여야
하고, "공개" 프로젝트만 예외적으로 보이되 그 프로젝트 그룹에 "읽기
권한"도 있어야 함. AskUserQuestion 3문항으로 확정: 그룹 "읽기 권한"은
새 모델 없이 기존 `Member` 멤버십으로 판단(그 그룹 산하 프로젝트 중
하나라도 멤버면 그 그룹에 읽기 권한 있음), 테스트 환경이라 기존
데이터 마이그레이션 불필요(새로 만드는 것부터 기본값 "비공개"),
팀/그룹도 프로젝트처럼 각자 독립된 "공개" 설정 보유.

3드라이버 스키마 전부에 `Team`/`ProjectGroup`/`Project.isPublic
Boolean @default(false)` 추가. 새 헬퍼
`hasProjectMembershipInTeam()`(`core/teams.ts`)/
`hasProjectMembershipInGroup()`(`core/projectGroups.ts`) - 새 모델 없이
`Member` 테이블 조회 하나로 "읽기 권한" 판단. 가시성 판정 함수 3개
신설 - `canSeeTeam()`(`core/teams.ts`), `canSeeGroup()`
(`core/projectGroups.ts`), 그리고 기존 `canSeeHiddenProject()`를
`canSeeProject()`로 완전히 대체(`core/projects.ts`) - 멤버/팀장/그룹
관리자는 `hidden` 여부 무관 항상 통과, 그 외엔 `hidden`이면 무조건
차단(공개보다 우선), 아니면 `isPublic && 그 그룹 멤버십`일 때만 통과.
이 김에 **기존 비일관성도 보정** - `canSeeHiddenProject`가 그룹
관리자를 안 넣고 팀장만 넣었던 것을 `isProjectGroupAdmin` 우회도
추가해 통일(숨김/공개 토글 권한도 owner/팀장/그룹 관리자로 통일 -
`canManageProjectVisibility()` 신설, `server.ts`).

`listTeams`/`listProjectGroups`/`listProjects` 루프에 각 판정 함수를
필터로 삽입(구조는 그대로, 조건만 추가). `GET /api/projects/:projectId`
(단건 조회)도 `canSeeHiddenProject` 대신 `canSeeProject`를 써서 목록
가시성과 일치시킴(예전엔 목록엔 보여도 클릭하면 403인 비대칭이 있었음
- 이번에 해소). `core/activity.ts`의 활동 타임라인도 같은 이유로
`canSeeProject`로 교체(그 프로젝트를 못 보는 사람에게 활동이 새는 걸
막음). 생성 함수 3개에 `isPublic?: boolean`(기본 false) 매개변수 추가,
수정 경로엔 `updateTeam`/`updateProjectGroup`에 `isPublic?` 필드,
`core/projects.ts`에 `setProjectPublic()` 신규(기존 `setProjectHidden`
과 별개 축으로 독립 토글). CLI `team-create/-update --public`,
`group-create/-update --public`, `project-create --public`, 신규
`project-public <id> --public <bool>`. MCP `team_create/_update`,
`group_create/_update`, `project_create`에 `isPublic` 선택 인자 추가,
신규 `project_public` 도구. 웹 UI 세 화면
(`TeamsView`/`ProjectGroupsView`/`ProjectsView.vue`) - 생성 폼에 "공개"
체크박스, 목록 행에 공개/비공개 배지 + (관리자만) 토글 버튼.

**범위를 명확히 그음**: 이번 라운드는 목록/존재 가시성 + 프로젝트
개요 열람까지만 다룬다. 문서/코멘트/칸반 등 콘텐츠 라우트는 그대로
`requireProjectRole("viewer")`(실제 Member)를 요구 - "공개" 프로젝트가
그 그룹의 다른 멤버에게 자동으로 문서까지 읽게 해주진 않는다(설계자가
"볼 수도 없어야 한다"로 문제를 정의해 가시성 문제로 해석, 콘텐츠 권한
모델 확장은 별개 판단이 필요해 이번엔 안 건드림).

**실측 검증**: 신규 계정으로 비공개 팀/그룹/프로젝트를 만들어, 소속
없는 제3자 계정에게 셋 다 목록에 안 보이는지, owner 계정엔 보이는지
확인. 팀/그룹을 `isPublic=true`로 바꾸자 제3자에게도 나타나는지 확인.
프로젝트를 `isPublic=true`로 바꾼 뒤 (a) 같은 그룹의 다른 프로젝트
멤버 계정 → 보임, (b) 그 그룹에 멤버십이 전혀 없는 계정 → 여전히
안 보임(공개+그룹 읽기 권한 둘 다 필요 확인) - 둘 다 실측. 그 공개
프로젝트를 다시 `hidden=true`로 바꾸자 (a) 계정도 더는 못 보는 것
확인(hidden이 공개보다 우선 적용 확인). `GET /api/projects/:projectId`
단건 조회가 목록 가시성과 일치(숨긴 뒤 403, 팀장 계정은 여전히 200)
확인. 그룹 관리자 계정(그 프로젝트의 실제 멤버가 아님)이 그룹 산하
프로젝트를 보는지(새로 추가한 관리자 우회) 확인. CLI `--public` 옵션
전 명령 왕복, MCP `team_create/group_create/project_create/
project_public` 실제 MCP 클라이언트로 왕복 확인. 브라우저로 세 화면
전부 생성 폼 체크박스·배지·토글 버튼 동작을 스크린샷으로 확인(토글
클릭 시 `PUT .../teams/:id → 200`처럼 실제 네트워크 요청도 확인).
`npm run audit:cli-mcp` 클린 재확인. `npx tsc --noEmit`(backend),
`vue-tsc -b`(frontend) 클린.

## 문서 우선순위(`#document-priority`) - 완료 (2026-09-12)

PLANS.md 29번(설계자 직접 요청). 문서에 단순 정수 우선순위를 매기되,
`review`/`pending`(표준 DocStatus 코드 - Q&A의 별개 `pending` 개념과
이름만 같음) 상태일 때만 설정/갱신 가능해야 함.

이 시스템은 "조회는 DB가 아니라 Meilisearch를 거친다"는 확고한
원칙이 있어(`core/search.ts` 상단 주석), 필드 하나 추가가 스키마
하나로 안 끝났다 - `Document.priority Int?`(3드라이버) 외에도
`SearchableDocument`에 `priority` 추가, `ensureSearchIndexes()`의
filterable/sortable 속성에 `"priority"` 등록(나중에 "review 대기열을
우선순위순 정렬" 같은 기능이 인덱스 재구성 없이 가능해지도록 미리
등록 - 비용 거의 없음), `createDocument`/`saveDocumentBody`/
`transitionDocumentStatus` 세 곳 전부 `toSearchable()` 호출과
`DocumentDetail` 반환에 `priority`를 실어주도록 갱신. 신규
`setDocumentPriority()`(`core/documents.ts`) - 현재 상태 코드가
`review`/`pending`이 아니면 명확한 한국어 에러로 거부, 범위를
벗어나도 기존 값은 자동으로 안 지움(요청 문구에 자동 초기화 언급
없음). 라우트 `PUT /api/documents/:trackingCode/priority`(기존
`transition`/`save`와 동일한 `resolveEffectivePermission(...).write`
권한), CLI `priority-set <trackingCode> <n>`, MCP
`document_priority_set` - CLI가 짧고(`priority-set`) MCP가 리소스
접두어(`document_priority_set`)를 쓰는 기존 명명 규칙 차이라
`audit-cli-mcp.ts`의 `KNOWN_RENAMES`에 한 쌍 추가.

웹 UI(`DocumentEditorView.vue`) - 상태 배지 옆에 값이 있으면
"우선순위 N" 배지, `doc.perm.write && statusCode가 review/pending`
일 때만 숫자 입력+저장 버튼(기존 전이 컨트롤과 같은 자리).

**실측 중 드러낸 기존 버그(같이 수정)**: `transition()`/`save()`/
새로 만든 `savePriority()` 셋 다 뮤테이션 라우트 응답을
`doc.value`에 통째로 덮어썼는데, 그 응답엔 `perm` 필드가 없다(GET
단건 조회 라우트만 `perm`을 얹어줌, `transition`/`save`/`priority`
라우트는 `withNotices()`만 거침 - `notices`만 추가하고 `perm`은
안 건드림). 그래서 전이/저장/우선순위 설정 직후 `doc.perm`이
`undefined`가 되고, 곧바로 `v-if="doc.perm.write"`가 있는 툴바가
`Cannot read properties of undefined (reading 'write')`로 런타임
예외를 내며 화면이 통째로 사라지는 걸 브라우저 실측 중 직접
재현했다(`priority-set` 기능을 새로 추가하면서 같은 패턴을 그대로
베꼈다가 발견 - 원래 `transition`/`save`에도 잠재해 있던 결함).
세 함수 전부 `doc.value = { ...doc.value, ...응답 }`으로 병합하도록
고쳐 `perm`을 보존시켰다.

**실측 검증**: `draft` 상태에서 설정 시도 → 400 확인 → `review`로
전이 → 설정 → 200 + `GET`(Meilisearch 경유)에 값이 실제로 보이는지
확인(인덱스 등록을 빠뜨렸으면 여기서 드러남) → 다른 값으로 갱신 →
`approved`로 전이 후 재시도 → 400, 기존 값은 그대로 남는지 확인 →
쓰기 권한 없는 계정 → 403. CLI `priority-set`/MCP
`document_priority_set` 실제 클라이언트로 왕복. 브라우저로 저장
버튼 클릭 → 배지 갱신 확인 → 페이지가 안 깨지고 나머지 버튼들이
그대로 남아있는지(perm 보존 확인) → 승인됨으로 전이 → 입력/저장
버튼은 사라지고 배지는 그대로 남는지(자동 초기화 안 함) 확인.
`npm run audit:cli-mcp` 클린 재확인. `npx tsc --noEmit`(backend),
`vue-tsc -b`(frontend) 클린.

## `#folder-access-ui` 재검토 - 의도된 설계로 확정, 코드 변경 없음 (2026-09-12)

PLANS.md 6번. 착수 조사로 이 항목의 원래 전제("웹 UI 탭만 빠졌다")가
낡았다는 게 드러나 - `PUT /api/folders/:id/access`와
`DocAccessOverride.folderId` 축은 이미 삭제됐고(폴더가 "설계자 개인
소유, 완전 비공개"로 재설계됨) - 설계자에게 "폴더 공유+ACL을 새로
설계"할지 확인받았다. 권한 판정 알고리즘(자기 자신부터 루트까지
소유권/명시적 grant를 순서대로 확인 - 하위 폴더 자동 상속 포함)까지
전부 설계해 Plan Mode 승인을 받으려던 시점에, 설계자가 반려하며
명확히 정정: **"폴더 기능 자체가 개인화된 기능으로서 존재하는거야"**
- 지금의 완전 비공개 동작은 공백이 아니라 의도된 설계라는 뜻.

결론: 공유 기능을 만들지 않는다. 이 백로그 항목은 "재검토 후 의도된
설계로 확정"으로 종료 - 코드 변경 없음. QA-SCENARIOS.md에 남아있던
낡은 내용(이미 삭제된 `AccessControlManager.vue` 폴더 스코프 오버라이드
관련 사용 시나리오·체크리스트 - 옛 시스템 기준이라 지금 코드와
안 맞음)만 실제 상태에 맞게 정리했다. 같은 조사를 나중에 반복하지
않도록 이 절에 결론을 남겨둔다.

## 설계자별 접근 제한 프로젝트 횡단 조회(`#access-overview-cross-project`) - 완료 (2026-09-12)

PLANS.md 7번. 기존 `listAccessOverrides(projectId)`는 프로젝트
단위로만 조회돼, "이 설계자가 전체 설치에서 어떤 제한을 받고 있는지"
보려면 프로젝트마다 따로 불러야 했다 - `userId` 하나로 전체 설치를
가로지르는 조회가 없었고, 자기 자신의 오버라이드를 스스로 조회하는
기능 자체도 없었다(그린필드).

**스키마**(3드라이버): `DocAccessOverride`에 `@@index([userId])`
추가(기존 `[projectId, userId]` 복합 인덱스는 유지 - 선두 컬럼이
`projectId`라 `userId` 단독 조회엔 못 쓰임).

**`core/permissions.ts`** 신규 `listAccessOverridesForUser(userId)` -
`docAccessOverride.findMany({where:{userId}, include:{project,docType,
document}})`를 프로젝트명/문서타입명/문서제목+추적코드까지 곁들인
평면 행으로 매핑. 자기 자신 조회든 admin이 남을 조회하든 항상 이
함수 하나 - 프로젝트 가시성(`canSeeProject`)과 무관하게 전부
반환한다(나를 제한하는 이유를 나에게 숨길 이유가 없고, admin은
`getMemberRole()`의 superAdmin 우회로 어차피 모든 프로젝트를 owner로
본다).

**라우트**: `GET /api/auth/me/access-overview`(인증만, role 체크
불필요 - 자기 자신 조회), `GET /api/admin/users/:userId/access-
overview`(`requireUnrestrictedScope` + `requireSuperAdmin`, 기존
`/api/admin/users/*` 네임스페이스 확장).

**CLI**: 최상위 `access-overview`(본인), `user` 그룹에
`access-overview <userId>`(관리자 전용).

**MCP**: `access_overview`(본인, 인자 없음)는 그대로 노출. 관리자용
`user_access_overview`는 **의도적으로 MCP에 노출하지 않았다** -
CLI 태그(`user_access-overview`)와 이름은 그대로 맞아떨어지지만
(`audit-cli-mcp.ts`의 `KNOWN_RENAMES` 불필요), 같은 `user` 관리자
그룹의 나머지 두 항목(`user_list`, `user_reset_password`)이 이미
"신원 관리 동작이라 CLI 전용"으로 `KNOWN_CLI_ONLY`에 있던 전례를
따라 셋을 한데 묶었다 - 임의의 다른 설계자를 지목해 그의 접근 제한
사유를 조회하는 것도 AI 세션이 스스로 할 일은 아니라고 판단.
`KNOWN_CLI_ONLY`에 `user_access_overview` 추가 후 `npm run
audit:cli-mcp` 클린 재확인, 두 SKILL.md 사본(`.claude/skills/
claude-native-workflow/SKILL.md`, `backend/prisma/seed-templates/
SKILL.md`)의 "CLI/MCP에 의도적으로 없는 기능" 절도 같이 갱신.

**웹 UI**: 신규 공용 컴포넌트 `AccessOverviewPanel.vue`(prop
`endpoint`) - 프로젝트명/스코프(공통·문서타입·문서)/읽기·쓰기·삭제
플래그를 목록으로 렌더링. `UserProfileView.vue`에 `isSelf`일 때만
("내 접근 제한" 섹션, endpoint `/auth/me/access-overview`),
`AdminUsersView.vue`에 사용자 행마다 "접근 제한 보기" 토글(기존
`TeamsView.vue`의 `expandedMembersId` 패턴, endpoint
`/admin/users/:id/access-overview`).

**실측 검증**: docker 스택 재빌드·재기동 후 실계정 2개(일반 설계자
A - 서로 다른 프로젝트 2곳에 각각 프로젝트 공통/문서타입 스코프
오버라이드, admin)로 HTTP 왕복 - A의 `GET /auth/me/access-overview`가
두 프로젝트를 한 번에 반환(평소 그 프로젝트를 볼 수 있는지와 무관),
비admin 계정의 `GET /admin/users/:A/access-overview` → 403, admin →
200(A와 동일 데이터). CLI `access-overview`(본인)/`user
access-overview <userId>`(관리자) 실제 서버로 왕복 확인. MCP
`access_overview` 실제 클라이언트로 왕복(빈 배열 - admin 자신에게
걸린 오버라이드 없음), `tools/list`에 `user_access_overview`가 없는지
확인. 브라우저 - A 계정 프로필 화면의 "내 접근 제한" 섹션과 admin
계정 사용자 관리 화면의 행 확장이 같은 내용을 보여주는지 스크린샷
확인, `read_network_requests`로 두 access-overview 호출 모두 200
확인. `npm run audit:cli-mcp`, `npx tsc --noEmit`(backend), `vue-tsc
-b`(frontend) 전부 클린.

## DocType 이름 수정/삭제(`#doctype-edit-delete`) - 완료 (2026-09-12)

PLANS.md 8번. 생성 후 지침(guideline)만 고칠 수 있던 DocType에
code/label 수정과 삭제를 추가했다.

**설계자 확인(반려 후 정정)**: 처음 계획은 모든 DocType의 이름을
자유롭게 수정 가능하게 했는데, 설계자가 반려하며 정정: **"기본
생성되는 것들은 삭제만 가능하다. 문서 분류를 삭제하려면 속한
문서들을 다 지워야 한다."** - 프로젝트 생성 시 자동으로 심어지는
기본 6종(`seedDefaultDocTypes`)은 이름을 못 바꾸고 삭제만 가능,
관리자가 나중에 직접 만든 타입만 이름도 자유롭게 고칠 수 있다는
뜻. 이 구분을 위해 `DocType`에 `isDefault Boolean @default(false)`
컬럼을 새로 추가(3드라이버) - `createDocType()`에 다섯 번째 매개변수
`isDefault = false`를 넣고 `seedDefaultDocTypes()`의 호출부만
`true`를 넘기도록 했다.

`core/docTypes.ts` 신규 `updateDocType(docTypeId, {code?, label?})` -
`isDefault`면 즉시 거부(`기본으로 생성된 문서 분류는 이름을 바꿀 수
없습니다 - 삭제만 가능합니다`), 아니면 `createDocType`과 같은 코드
형식 검증(`/^[A-Za-z]{2}$/`) 후 갱신. 신규 `deleteDocType(docTypeId)`
는 기본/커스텀 구분 없이 `db.document.count({where:{docTypeId}})`
확인 → 0보다 크면 거부(`deleteTeam()`의 "비어있지 않으면 명확한
에러로 거부" 패턴과 동일) - `Document.docType`이 `onDelete: Cascade`
라 이 가드가 없으면 타입을 지울 때 그 타입 문서가 통째로 같이
삭제될 뻔했다. DocStatus/DocStatusTransition/DocAccessOverride는
스키마의 Cascade가 알아서 정리.

라우트 `PUT`/`DELETE /api/projects/:projectId/doc-types/:docTypeId`
(기존 `requireOwnedDocType` 재사용), CLI `doctype-update`/
`doctype-delete`, MCP `doctype_update`/`doctype_delete`(이름이 CLI
태그와 그대로 맞아떨어져 `KNOWN_RENAMES` 불필요). `doctype_list`
응답에도 `isDefault`가 실려 AI가 미리 구분 가능.

웹 UI(`DocTypeManager.vue`) - 기본 타입은 "기본 타입" 배지 + "삭제"
버튼만, 커스텀 타입은 "이름 수정"(인라인 code/label 편집, 기존
guideline 편집 상태와 별개)도 노출. 삭제는 `TeamsView.vue`처럼 확인
다이얼로그 없이 바로 호출하고 실패 시 그 자리에 에러(문서 개수
때문에 거부되면 그 메시지)를 보여준다.

**트래킹 코드는 이름 변경과 무관하게 발급 시점에 영구 고정된다** -
`generateTrackingCode(typeCode)`가 문서 생성 시점의 DocType.code를
그대로 새겨 넣으므로(`core/tracking.ts`), 나중에 타입을 "ZZ"→"ZQ"로
개명해도 그 타입으로 이미 만든 문서의 추적 코드는 계속 "ZZ-..."로
남는다 - 버그가 아니라 "발급 시점 스냅샷" 설계의 당연한 결과.

**실측 검증**: docker 재빌드·재기동(스키마 push로 `isDefault` 컬럼
반영 확인) 후 admin 계정 하나로 HTTP 왕복 - 기본 타입(SP) 이름 수정
시도 → 400 거부 확인 → 커스텀 타입 생성(`isDefault:false` 확인) →
표준 상태 흐름 적용 → 그 타입으로 문서 생성(추적 코드 `ZZ-...`) →
삭제 시도 → "문서가 아직 1개 있습니다" 거부 확인 → 이름을 ZZ→ZQ로
수정(성공) → 문서의 추적 코드가 여전히 `ZZ-...`인지 재확인(고정
확인) → 문서 삭제 → 타입 삭제 재시도 → 200 확인 → 기본 타입(DS,
문서 0개)도 삭제 성공 확인. CLI `doctype-update`/`doctype-delete`,
MCP `doctype_update`/`doctype_delete`(기본 타입 거부 케이스 포함,
MCP는 `isError:true`로 정확히 전파됨) 실제 서버/클라이언트로 왕복.
브라우저 - 기본 타입 행엔 "이름 수정" 버튼이 아예 없고 "기본 타입"
배지만 있는지, 커스텀 타입은 인라인 편집으로 이름이 바뀌는지,
문서가 있는 커스텀 타입을 삭제 시도하면 그 자리에 에러가 뜨고
목록에서 안 빠지는지, 빈 타입은 삭제 시 즉시 목록에서 빠지는지
스크린샷으로 확인. `npm run audit:cli-mcp`, `npx tsc --noEmit`
(backend), `vue-tsc -b`(frontend) 전부 클린.

## DocStatusTransition 삭제(`#doctype-transition-delete`) - 완료 (2026-09-12)

PLANS.md 9번(`## 2. 문서 타입/상태 체계` 마지막 항목). 잘못 그은 상태
전이를 지울 방법이 없어 DB를 직접 만져야 했다 - 바로 앞
`#doctype-edit-delete` 라운드와 같은 모양의 CRUD 보강.

`DocStatusTransition`은 다른 테이블이 그 id를 참조하는 FK가 전혀
없다(`Document`는 현재 `statusId`만 기록, 어떤 전이를 거쳐 왔는지는
안 남김) - `#doctype-edit-delete`의 "문서 있으면 삭제 거부" 같은
가드가 이 항목엔 대응되지 않는다. `core/docTypes.ts` 신규
`deleteDocStatusTransition(docTypeId, transitionId)` - `findFirst`로
그 전이가 실제로 해당 docType 소속인지만 확인(다른 타입의 id를 잘못
겨냥하는 것 방지) 후 바로 삭제.

라우트 `DELETE /api/projects/:projectId/doc-types/:docTypeId/
transitions/:transitionId`(기존 `requireOwnedDocType` 재사용), CLI
`doctype-transition-delete`, MCP `doctype_transition_delete`(이름이
CLI 태그와 그대로 맞아떨어져 `KNOWN_RENAMES` 불필요). 웹 UI
(`DocTypeManager.vue`)는 전이 목록 각 행에 owner 전용 "삭제" 버튼을
추가했다(성공 시 `loadDetail()`로 즉시 새로고침, 실패 시
`transitionDeleteError`에 표시).

**실측 검증**: docker 재빌드·재기동 후 admin 계정으로 HTTP 왕복 -
기존 SP 타입의 전이 하나(25개 중 1개) 삭제 → 200 확인 → 목록이
24개로 줄고 그 id가 실제로 빠졌는지 확인 → 다른 docType(DC) 소속인
것처럼 같은 transitionId를 잘못 겨냥 → 거부(이미 지워졌다는 에러와
동일한 경로로 자연스럽게 막힘 - 별도 404 분기를 안 만들어도
`findFirst` 소속 확인 하나로 충분했음) → 이미 지운 전이를 다시
삭제 시도해도 같은 방식으로 거부됨을 확인. CLI
`doctype-transition-add`/`doctype-transition-delete`, MCP
`doctype_transition_add`/`doctype_transition_delete`(MCP는
`isError:true`로 에러가 정확히 전파됨) 실제 서버/클라이언트로 왕복.
브라우저 - `DocTypeManager.vue` 전이 목록에서 삭제 버튼 클릭 →
`read_network_requests`로 `DELETE .../transitions/:id` 200 확인 →
그 행이 화면에서 즉시 사라지고 나머지 행은 그대로인지 스크린샷 확인.
`npm run audit:cli-mcp`, `npx tsc --noEmit`(backend), `vue-tsc
-b`(frontend) 전부 클린.

## 문서 일괄 상태 전이/폴더 이동(`#document-bulk-actions`) - 완료 (2026-09-12)

PLANS.md 10번(`## 3. 문서 CRUD` 유일 항목). 문서 여러 개를 한 번에
상태 전이하거나 폴더로 옮길 방법이 없어 하나씩 해야 했다 -
마이그레이션 직후처럼 문서가 몰려 있을 때 특히 아쉬운 부분.

단건 상태 전이(`transitionDocumentStatus`)와 단건 폴더 이동
(`moveDocumentToFolder`)이 이미 있어 **새 core 함수 없이 그대로
반복 호출**했다 - 이 저장소는 권한 판정을 core가 아니라 라우트
계층에서 하는 일관된 패턴이라, 새 "bulk" core 래퍼를 만들면 오히려
그 패턴을 깨게 된다. 선택한 문서 집합은 서로 다른 프로젝트/타입/
`DocAccessOverride`를 가질 수 있어 **전부-성공/전부-실패가 아니라
항목별 결과(`{trackingCode, ok, error?}`)를 반환**한다 - 하나가
막혀도(권한 없음, 그 타입에 정의 안 된 전이 등) 나머지는 계속
진행된다.

`POST /api/documents/bulk-transition`, `PUT /api/documents/bulk-folder`
둘 다 `Promise.all`로 병렬 처리. **라우트 등록 순서 버그를 실측 중
바로 발견** - `PUT /api/documents/bulk-folder`를 기존 단건 폴더
라우트 뒤(파일 끝쪽)에 추가했더니, Express가 더 먼저 등록된 `PUT
/api/documents/:trackingCode`(문서 본문 저장)의 `:trackingCode`
와일드카드가 "bulk-folder"를 그대로 삼켜버려 항상 404가 났다 -
Express는 라우트를 등록 순서대로 매칭하므로, `bulk-folder`처럼
고정 경로인 새 라우트는 그걸 삼킬 수 있는 와일드카드 라우트보다
**먼저** 등록해야 한다는 걸 다시 확인(POST 쪽은 같은 패턴의 충돌이
없어 문제없었음 - `POST /api/documents/:trackingCode` 자체가 없음).

**일괄 상태 전이는 CLI(`transition-bulk <toStatusCode>
<trackingCodes...>`)/MCP(`document_transition_bulk`)에도 노출** -
단건 전이가 이미 완전성 원칙을 따르고, 마이그레이션 정리처럼 AI가
직접 쓸 시나리오가 이 백로그의 핵심 사유이기도 했다.
`audit-cli-mcp.ts`의 `KNOWN_RENAMES`에 기존 `transition:
"document_transition"` 옆에 `transition_bulk:
"document_transition_bulk"`를 추가. **일괄 폴더 이동은 CLI/MCP에
없음** - 폴더는 AI가 그 개념 자체를 모르도록 의도적으로 설계된
기능이라(단건도 CLI/MCP 없음) 웹 전용 라우트로만 추가했다(CLI/MCP
둘 다 없는 라우트는 감사 스크립트가 아예 보지 않아 설정 변경도
불필요).

웹 UI(`DocumentsView.vue`) - 문서 목록에 체크박스 + "전체 선택" +
선택 시에만 뜨는 일괄 작업 바(상태 드롭다운+적용, 폴더 드롭다운+적용)
를 추가했다. 응답의 항목별 결과로 "N개 성공, M개 실패" 요약과 실패
항목만 `{trackingCode}: {error}`로 표시 - 성공한 항목은 선택 해제,
실패한 항목은 선택 유지(재시도하거나 다른 작업으로 바꿀 수 있게).

**실측 검증**: docker 재빌드·재기동 후 admin 계정으로 HTTP 왕복 -
서로 다른 타입 문서 3개를 만들어 `review`로 일괄 전이(전부 성공)
→ 그중 2개를 다시 `draft`로(정의 안 된 전이) 시도 → 그 2개만
실패, 나머지 무관 확인 → viewer 역할 계정으로 같은 문서들 일괄
전이 시도 → 둘 다 "쓰기 권한이 없습니다"로 실패 확인 → 필수 필드
누락 시 400 확인. 폴더 하나를 만들어 문서 3개를 일괄로 넣고
`GET /folders/:id/documents`로 확인 → `folderId: null`로 일괄
빼기 → 빈 목록 확인(이 과정에서 위의 라우트 순서 버그를 처음
발견해 수정한 뒤 재검증). CLI `transition-bulk`, MCP
`document_transition_bulk` 실제 서버/클라이언트로 왕복.
`npm run audit:cli-mcp` 클린. 브라우저 - 문서 목록에서 전체 선택
→ 일괄 상태 전이 적용 → "3개 성공, 0개 실패" 요약과 배지 갱신
확인 → 다시 전체 선택 → 일괄 폴더 이동 적용 → 같은 요약 확인 →
폴더 트리에서 그 폴더를 열어 문서 3개가 전부 들어갔는지(각각
"폴더에서 빼기" 버튼과 함께) 스크린샷 확인. `npx tsc
--noEmit`(backend), `vue-tsc -b`(frontend) 전부 클린.

## 폴더 재귀 삭제/상위로 끌어올리기(`#folder-delete-recursive`) - 완료 (2026-09-12)

PLANS.md 11번(`## 4. 문서 정리 폴더` 유일 항목). `deleteFolder()`가
하위 폴더나 문서 배치가 하나라도 있으면 무조건 거부했다 - 재귀
삭제나 "상위로 끌어올리기" 옵션이 없어, 설계 당시에도 의도적으로
범위 밖으로 뺐던 부분(재검토 후보로 남겨둔 항목).

**재귀 삭제는 거의 공짜였다** - `Folder.parentFolder`와
`DocumentFolderEntry.folder` 관계가 둘 다 이미 `onDelete: Cascade`로
선언돼 있어서, 가드를 건너뛰고 그냥 `db.folder.delete()`를 부르면
DB가 하위 폴더와 그 안의 문서 배치를 전부 재귀적으로 정리해준다 -
문서(Document) 자신은 전혀 안 지워지고 "이 폴더에 있다"는 배치
메타데이터만 사라진다. 새 재귀 순회 코드는 한 줄도 안 짰다.

"상위로 끌어올리기"(`mode: "promote"`)는 실제 새 로직이 필요했다 -
직속 하위 폴더의 `parentFolderId`를 대상의 부모로, 직속
`DocumentFolderEntry`의 `folderId`도 같은 곳으로 옮기고(대상이
최상위였다면 문서 배치는 `folderId`가 NOT NULL이라 옮길 곳이 없어
삭제됨 - `moveDocumentToFolder(folderId: null)`과 동일한 "폴더 없음"
결과), 빈 폴더가 된 대상을 삭제하는 트랜잭션 하나로 구현했다.
`DocumentFolderEntry`가 `@@unique([documentId, userId])`뿐이고
`folderId`는 그 유니크에 안 들어가므로(한 설계자는 문서 하나당
배치를 딱 하나만 가짐) `folderId`만 그냥 갱신해도 유니크 충돌이 날
수 없다는 것도 확인. 목적지에 이름이 겹치는 폴더가 있으면 기존
`assertNoSiblingWithName()`을 그대로 재사용해 거부(새 검증 로직
불필요). 폴더는 항상 단일 소유자 트리라(하위 폴더/배치를 만들려면
항상 상위 폴더 소유권이 필요) 재귀 삭제가 다른 설계자의 데이터를
건드릴 가능성은 구조적으로 없다.

라우트 `DELETE /api/folders/:folderId`에 `?mode=recursive|promote`
쿼리 파라미터를 추가(둘 다 선택적 - 안 주면 기존 "비어있을 때만
삭제" 동작 그대로). 웹 UI(`FolderTree.vue`) - 삭제가 "비어있지
않음" 에러로 실패하면 일반 에러 텍스트 대신 그 폴더 행에 "재귀
삭제"/"상위로 끌어올리기"/"취소" 3버튼을 보여준다. 에러 구분은
`GitRepoPanel.vue:78`의 `git_auth_required` 정확 일치 분기와 같은
패턴 - 백엔드가 던지는 고정 문자열(`FOLDER_NOT_EMPTY_MESSAGE`,
`core/folders.ts`에 상수로 선언)을 프론트에도 똑같이 복사해 정확히
일치할 때만 선택 UI로 분기한다(다른 에러는 그냥 에러 메시지). "재귀
삭제"는 `ProjectSettingsView.vue`의 프로젝트 삭제와 같은
`window.confirm()`으로 확인을 받고("문서 자체는 안 지워진다"는
점도 문구에 명시), "상위로 끌어올리기"는 데이터를 안 지우고
재배치만 하므로 확인 없이 바로 실행한다. 폴더는 CLI/MCP가 모르는
웹 전용 기능이라(단건 삭제도 이미 그렇듯) 이번에도 CLI/MCP 변경
없음.

**참고**: `FolderTree.vue`는 최상위 폴더의 직계 자식까지만 액션
버튼(▲▼+삭제)이 있고 그 아래(손자 이하)는 트리에 렌더링조차 안
된다 - 이번 라운드와 별개인 기존 한계라 그대로 뒀다(재귀 삭제 자체는
API/DB 레벨에서 몇 단계든 정확히 동작 확인됨 - 트리 UI가 깊은
폴더를 못 보여줄 뿐).

**실측 검증**: docker 재빌드·재기동 후 admin 계정으로 HTTP 왕복 -
다단계 트리(A→B→문서 배치)를 만들어 mode 없이 A 삭제 시도 → 고정
에러 메시지 확인 → `mode=recursive`로 재시도 → 200, A/B 둘 다
사라지고 문서 배치도 사라졌지만 문서 자신은 `GET /documents/...`로
여전히 조회됨 확인. 별도 트리(C→D, C에 직접 문서 배치)를 만들어
`mode=promote`로 C 삭제 → D가 새 최상위가 되고 C의 직접 배치는
"폴더 없음" 상태가 됨 확인. 이름이 겹치는 경우(F 밑에 X, F의 자식
E 밑에도 X)로 E를 promote 시도 → "같은 위치에 이미 "X" 폴더가
있습니다"로 거부 확인. 잘못된 mode 값 → 400 확인. 브라우저 -
비어있지 않은 폴더 삭제 클릭 → 3버튼 선택 UI 노출 확인 →
`window.confirm()`이 이 자동화 환경에서 자동 거부되는 걸 이용해
"재귀 삭제" 클릭이 확인 없이는 아무 요청도 안 보낸다는 걸
`read_network_requests`로 역으로 확인(의도한 게이팅이 실제로
막고 있다는 증거) → 같은 폴더에서 "상위로 끌어올리기" 클릭 → 확인
없이 바로 `?mode=promote` 요청이 나가고(200) 화면에서 하위 폴더가
즉시 최상위로 올라온 것을 스크린샷으로 확인. `npx tsc
--noEmit`(backend), `vue-tsc -b`(frontend), `npm run audit:cli-mcp`
(변경 없음 재확인) 전부 클린.

## 질문 일괄 ack(`#question-bulk-ack`) - 완료 (2026-09-12)

PLANS.md 12번(`## 5. 질의/응답 (Q&A)`). pending(설계자 답변 완료,
AI 확인 대기) 질의가 여러 건 쌓이면 하나씩 `question ack`해야 했다 -
마이그레이션 직후처럼 한꺼번에 밀렸을 때 불편.

이번 세션에 먼저 끝낸 `#document-bulk-actions`와 정확히 같은 모양
이라 그대로 반복했다 - `acknowledgeQuestion(trackingCode)` 새 core
함수 없이 반복 호출, 선택한 질의들이 서로 다른 프로젝트/권한을 가질
수 있어 항목별 결과(`{trackingCode, ok, error?}`)를 반환한다(하나가
막혀도 나머지는 계속 진행). 라우트 `POST /api/questions/bulk-ack`,
CLI `question-ack-bulk`, MCP `question_ack_bulk`(CLI 태그와 그대로
맞아떨어져 `KNOWN_RENAMES` 불필요).

**웹 UI는 추가하지 않았다** - 이 백로그 항목 자체가 "마이그레이션
직후처럼" CLI가 몰아서 처리하는 시나리오를 사유로 들었고, 실제로
`/ack`를 호출하는 화면은 `QAPanel.vue`(문서 하나의 Q&A 스레드)뿐이라
여러 질의를 가로질러 선택하는 기존 화면 자체가 없다(홈 대시보드는
`pending` 목록을 아예 안 보여줌 - `status === "open"`만 노출). 없는
화면을 새로 만드는 건 과잉 구현이라 CLI/MCP만 추가했다.

**실측 검증**: docker 재빌드·재기동 후 admin 계정으로 HTTP 왕복 -
문서 하나에 질문 2개 등록·답변(둘 다 pending) → `POST
.../bulk-ack`로 한 번에 ack → 둘 다 `ok:true`, `GET .../pending`에서
둘 다 빠짐 확인 → 이미 ack된 질의 + 존재하지 않는 질의를 섞어 재시도
→ 둘 다 각자 다른 이유로 `ok:false` 확인 → 필수 필드 누락 400 확인.
CLI `question-ack-bulk`, MCP `question_ack_bulk`(이미 resolved인
질의로 실패 케이스까지) 실제 서버/클라이언트로 왕복. `npm run
audit:cli-mcp`, `npx tsc --noEmit`(backend) 클린(프론트 변경 없음).

## 질문 철회(`#question-withdraw`) - 완료 (2026-09-12)

PLANS.md 13번(`## 5. 질의/응답 (Q&A)` 마지막 항목). 클로드가 등록한
질문이 더 이상 유효하지 않게 됐을 때(예: 관련 결정이 다른 경로로
이미 내려짐) 상태를 "철회"로 표시할 방법이 없어, 그냥 방치되어 open
목록에 계속 남아있었다.

`Question.status`가 Postgres enum이 아니라 그냥 `String
@default("open")`이라 "withdrawn"을 추가하는 데 스키마 변경이
전혀 없었다 - 순수 애플리케이션 레벨 값 추가. 기존
`answerQuestion()`(status !== "open"이면 거부)·
`acknowledgeQuestion()`(status !== "pending"이면 거부)·
`listPendingQuestions()`(status가 open|pending인 것만 조회) 셋 다
"withdrawn"을 자동으로 배제해서 추가 가드 코드도 필요 없었다.

신규 `withdrawQuestion(questionTrackingCode, requesterId)` -
`core/comments.ts`의 `editComment`/`deleteComment`가 이미 쓰던
"본인 소유물만(+ superAdmin 우회)" 패턴(`existing.authorId !==
requesterId && !(await isSuperAdmin(requesterId))`)을 `askedBy`
기준으로 그대로 재사용했다. **철회는 아직 아무도 답변하지 않은
(open) 질문만 가능**하다고 범위를 좁혔다 - 설계자가 이미 답변을
남긴(pending) 질문을 되돌리는 건 그 노력을 무의미하게 만드는 다른
성격의 동작이라("더 이상 유효하지 않은 질문 정리"라는 이 항목의
취지와 다름), 그런 경우는 그냥 `ack`로 마무리하도록 남겨뒀다.

라우트 `POST /api/questions/:trackingCode/withdraw`(소유권 확인은
core 안에서 - 코멘트 라우트와 동일하게 `authenticate`만),
CLI `question-withdraw`, MCP `question_withdraw`(CLI 태그와 그대로
맞아떨어져 `KNOWN_RENAMES` 불필요). 웹 UI(`QAPanel.vue`) - `useAuthStore`
를 새로 import해 `q.status === 'open' && (q.askedBy === auth.me?.id
|| auth.me?.isSuperAdmin)`일 때만 "철회" 버튼을 노출, `STATUS_LABEL`
에 `withdrawn: "철회됨"` 추가.

**부수 발견**: 같은 조사 중에 `#comment-edit-delete`(PLANS.md 14번)
가 **이미 완전히 구현·배포돼 있다는 걸 확인했다** -
`core/comments.ts`의 `editComment`/`deleteComment`가 `PUT`/`DELETE
/api/comments/:id`로 이미 노출돼 있고 FEATURES.md에도 이미 반영돼
있다(예전 "코멘트/질의응답 통폐합" 라운드에서 끝난 작업 - PLANS.md
행만 ✅로 안 바뀌고 남아있었다). 코드 변경 없이 PLANS.md 14번 행만
같이 ✅로 정리했다.

**실측 검증**: docker 재빌드·재기동 후 admin + 신규 계정 B로 HTTP
왕복 - admin이 낸 open 질문을 B가 철회 시도 → 소유권 거부 확인 →
admin 본인이 철회 → 200, `status: "withdrawn"` 확인 → 그 질문에
답변 시도 → 거부(이미 open 아님) 확인 → `GET /pending`에서 안 보임
확인 → 이미 답변된(pending) 질문을 철회 시도 → 거부 확인 → B가 낸
open 질문을 admin(superAdmin)이 철회 → 우회 성공 확인(200). CLI
`question-withdraw`, MCP `question_withdraw`(이미 철회된 질문
재시도로 `isError:true` 케이스까지) 실제 서버/클라이언트로 왕복.
브라우저 - `QAPanel.vue`에서 본인이 낸 open 질문에만 "철회" 버튼이
보이고 이미 철회/답변된 질문엔 안 보이는지, 클릭 후 배지가
"철회됨"으로 바로 바뀌는지 스크린샷 확인. `npm run audit:cli-mcp`,
`npx tsc --noEmit`(backend), `vue-tsc -b`(frontend) 전부 클린.

## 메시지 수정/삭제(`#message-edit-delete`) - 완료 (2026-09-12)

PLANS.md 15번(`## 7. 메시징` 첫 항목). 잘못 보낸 메시지(오타, 잘못된
지시 등)를 고치거나 철회할 방법이 없었다. 백로그 설명은 "코멘트와
같은 공백"이라고 적혀 있었지만, 실제로는 정반대 성격 - 코멘트는
AI가 보면 안 되는 채널이라 CLI/MCP에서 의도적으로 배제돼 있지만,
메시지는 `message list/send/wait/recent`가 이미 CLI/MCP에 완전히
대칭으로 노출된 AI ↔ 설계자 공용 채널이다. 그래서 이번 edit/delete도
CLI/MCP까지 노출해야 완전성 원칙에 맞다고 판단했다(코멘트 edit/
delete는 웹 전용으로 남겨둔 것과 다른 지점).

`core/messages.ts` 신규 `editMessage`/`deleteMessage` - 소유권 확인은
`core/comments.ts`의 `editComment`/`deleteComment`와 같은 패턴
(`authorId !== requesterId && !isSuperAdmin`이면 거부) - `authorId`
가 null인 시스템 브로드캐스트는 이 비교가 항상 실패해 일반 사용자는
못 건드리고 superAdmin만 정리 가능. 코멘트와 달리 상태 제약(예:
아직 안 읽은 것만)은 두지 않았다 - 코멘트도 상태와 무관하게 언제든
수정/삭제 가능한 선례를 따름.

**실시간 발행 토픽을 잘못 고르면 실제 버그가 날 뻔했다** -
`waitForMessage()`는 `project/{id}/messages` 토픽에 오는 어떤
payload든 무조건 "새 메시지 도착"으로 파싱한다. edit/delete
이벤트를 그 토픽에 올리면 대기 중인 `message wait` 호출자가 이를
새 메시지로 오인하게 된다 - 그래서 코멘트/질의와 동일하게
`project/{id}/changes` 토픽에 `ChangeEvent`로 발행하도록
설계했다(`entity` 유니온에 `"message"`를 추가 - 백엔드
`core/realtime.ts`와 프론트 `frontend/src/realtime.ts`가 각자
별도로 선언돼 있어 양쪽 다 갱신). 실측 중 이 설계가 실제로
맞는지도 직접 검증했다(아래 참고) - `message wait`를 걸어둔 채로
다른 메시지를 편집해도 그 wait 호출이 가짜 메시지로 깨어나지
않고 정상적으로 타임아웃되는 것을 확인.

라우트 `PUT`/`DELETE /api/messages/:id`(소유권 확인은 core 안에서 -
comments 라우트와 동일 패턴), CLI `message edit`/`message delete`
(`messageCmd` 그룹에 추가), MCP `message_edit`/`message_delete`
(CLI 태그와 그대로 대칭). 웹 UI(`MessagesView.vue`) - 본인이 보낸
메시지(또는 superAdmin)에만 수정/삭제 버튼 노출, 수정은 인라인
텍스트 입력으로 전환. `connectProjectRealtime`에 `onChange` 핸들러를
추가해(기존 `onMessage`와 별개) 다른 세션의 수정/삭제도 실시간
반영되게 했다.

**실측 검증**: docker 재빌드·재기동 후 admin + 계정 B로 HTTP 왕복 -
B가 admin의 메시지 수정/삭제 시도 → 거부 확인 → admin 본인 수정 →
반영 확인 → superAdmin(admin)이 B의 메시지 수정/삭제 → 우회 성공
확인 → 삭제 후 `message recent`에서 사라짐 확인 → **회귀 검증**:
`message wait`를 백그라운드 작업으로 걸어둔 채 무관한 메시지를
편집 → wait 호출이 `timedOut:true, message:null`로 정상 타임아웃
되고 편집을 가짜 새 메시지로 받지 않음을 확인. CLI `message
edit`/`message delete`, MCP `message_edit`/`message_delete`(이미
삭제된 메시지 재시도로 `isError:true` 케이스까지) 실제 서버/
클라이언트로 왕복. 브라우저 - 본인 메시지에만 수정/삭제 버튼이
보이고, 수정 시 인라인 입력으로 전환돼 즉시 반영되며, 삭제 시
목록에서 바로 빠지는 것을 스크린샷으로 확인. `npm run
audit:cli-mcp`, `npx tsc --noEmit`(backend), `vue-tsc -b`(frontend)
전부 클린.

## `message wait` 폴링 전환(`#message-wait-timeout-cap`) - 완료 (2026-09-12)

PLANS.md 16번(`## 7. 메시징` 마지막 항목, 섹션 완전 종료). `message
wait`의 최대 타임아웃 상한이 코드/문서 어디에도 없어, 설계자가 긴
값을 걸면 서버가 그만큼 HTTP 연결과 MQTT 구독을 계속 붙들고 있었다.

**1차 계획(단순히 큰 상한값 - 예: 300초 - 으로 서버 쪽 타임아웃을
클램프)은 설계자가 반려했다**: "message wait은 MQTT를 통하여
메시지를 대기해야해. HTTP 폴링은 짧은 일정 주기마다 일어나야해."
- 즉 HTTP 요청 하나가 길게 블로킹하는 구조 자체가 문제이지, 그
상한을 조금 낮추는 걸로는 해결이 안 된다는 지적. 서버는 한 번의
HTTP 호출당 짧게만 MQTT로 대기하고, 사용자가 원하는 "전체 대기
시간"은 **호출하는 쪽이 그 짧은 대기를 반복 호출(폴링)해서
구현**해야 한다는 방향으로 정정했다.

**서버 쪽**(`core/messages.ts`): 새 상수 `MESSAGE_WAIT_POLL_MAX_SEC
= 10`. `waitForMessage()`가 받는 `timeoutSec`를 이 값 이하로 항상
클램프 - 이 라우트를 누가 직접 호출하든(CLI/MCP를 거치지 않고
직접 HTTP를 때리든) 항상 적용되는 방어선.

**클라이언트 쪽 폴링 루프는 CLI/MCP가 공유해야 해서**
`cli/apiclient.ts`(둘 다 이미 REST 클라이언트로 의존하는 계층 -
"CLI/MCP는 core를 직접 안 부르고 REST만 호출하는 순수 클라이언트"
원칙)에 `waitForMessagePolling(projectId, totalTimeoutSec)`를
추가했다 - 요청한 전체 시간을 `MESSAGE_WAIT_TOTAL_MAX_SEC`(1시간,
폴링 루프 자체가 무한정 돌지 않게 하는 바깥쪽 안전장치)로 클램프한
뒤, 데드라인까지 `MESSAGE_WAIT_POLL_INTERVAL_SEC`(서버 값과 같은
10초 - core를 직접 import 못 해 별도 선언, 주석으로 상호 참조)
단위로 `GET .../messages/wait`를 반복 호출한다. 메시지를 받으면
그 폴 안에서 바로 반환하므로 실시간성은 그대로 유지된다. CLI
`message wait`/MCP `message_wait` 둘 다 기존 단일 `apiCall`을 이
헬퍼 호출로 교체 - 명령/도구 이름과 파라미터는 안 바뀌어 사용자
입장에선 완전히 투명한 교체.

**웹 UI는 무관** - `MessagesView.vue`는 애초에 이 HTTP 엔드포인트가
아니라 브라우저가 EMQX에 직접 붙는 `connectProjectRealtime()`
경로를 쓰므로 이번 변경과 별개.

**실측 검증**: docker 재빌드·재기동 후 - `timeout=1` 직접 호출 →
약 1초 후 정상 타임아웃(회귀 없음) → `timeout=999`(상한 초과) 직접
호출 → 실제로는 약 10초 만에 응답(999초가 아니라 클램프가 실제로
먹힘) 확인. CLI `message wait --timeout 25`를 백그라운드로 걸어두고
그 도중 메시지를 하나 보내 봄 - 처음엔 타이밍 실수(느린 로그 확인
명령 때문에 메시지 발송이 25초를 넘겨버림)로 `timedOut:true`가
나와 당황했으나, 타임스탬프를 찍어 재실측한 결과 실제로는 두 번째
폴(약 10~11초 지점)에서 메시지를 정확히 잡아내는 것을 확인(폴링이
실제로 ~10초 단위로 일어나고 있다는 직접 증거). MCP `message_wait`
도 같은 클라이언트에서 0.5초 뒤 `message_send`를 걸어 첫 폴 안에서
바로 잡히는 것을 확인(elapsed 0.5초). `npx tsc --noEmit`(backend),
`npm run audit:cli-mcp`(도구/명령 이름 자체는 안 바뀌어 그대로 통과)
전부 클린. 프론트 변경 없음.

## Meilisearch 장애 대응: 쓰기 큐 + 워커 + 에러 메시지 개선(`#meilisearch-spof`) - 완료 (2026-09-12)

PLANS.md 17번(`## 8. 검색/인덱싱` 완전 종료). 처음엔 "에러 메시지
품질만 확인"하는 좁은 범위로 계획했으나, **설계자가 반려하며 범위를
확장**했다: "Meilisearch가 다운되거나 REST API 호출을 받지 못하는
경우에 인덱스들이 변동되면 그게 반영되지 않을 수 있다. 별도의 queue
성격의 테이블을 두고, 장애시 그걸 갱신해뒀다가 장애상황이 해소되면
worker가 그 queue를 일괄 처리하고 queue를 비우게 만들어야 한다." -
에러 메시지 개선만으로는 부족하고 쓰기가 유실되지 않게 큐잉 + 자동
재처리 워커까지 만들라는 지시. 이 항목은 스키마 변경(새 테이블)을
동반하지만, 설계자가 이 구체적 스키마 변경을 직접 요청한 것이라
"자동 진행 중엔 스키마 변경 항목은 남겨둔다"는 일반 방침의 예외로
취급했다.

**조사로 발견한 두 개별 버그**(docker에서 `docker compose kill
meilisearch`로 실제 재현):
1. Meilisearch가 죽으면 `400 {"error":"Request to
   http://meilisearch:7700/... has failed"}`처럼 내부 Docker
   호스트명이 그대로 노출되고, 상태 코드도 500대(서버 의존 서비스
   장애)가 맞는데 400(클라이언트 잘못)이었다.
2. `getDocumentFromIndex()`가 `catch { return null; }`로 **모든**
   에러(연결 실패 포함)를 "못 찾음"으로 뭉개서, Meilisearch가 죽어
   있을 때 문서 단건 조회가 404("문서가 없음")로 오인되는 실제
   버그였다 - 이 백로그 항목이 우려하는 "에러 메시지가 원인을
   알려주는지" 그 실제 사례.

**수정**: `core/search.ts`가 `MeiliSearchApiError`(Meilisearch가
응답은 했지만 에러 상태 - 진짜 404 등)와 `MeiliSearchRequestError`
(네트워크 레벨 실패 - "요청 자체를 못 보냈다")를 `instanceof`로
구분한다. `getDocumentFromIndex()`는 진짜 404만 null, 나머지는 그대로
던진다. `server.ts`의 전역 에러 핸들러가 `MeiliSearchRequestError`를
잡아 503 + "검색 엔진(Meilisearch)에 연결할 수 없습니다..." 로
응답(내부 URL은 서버 로그에만).

**큐 + 워커**: 새 모델 `SearchSyncQueueEntry`(3개 `.prisma` 스키마
파일 모두 동일하게 추가 - 이 저장소가 Postgres/MySQL/SQLite 세 DB
백엔드를 각각 별도 스키마 파일로 관리하는 구조라 하나만 고치면
나머지 두 백엔드가 깨짐). `kind`(`upsertDocument` |
`deleteDocument` | `resyncProjectSourceFiles`) + `trackingCode`/
`projectId`(둘 다 nullable 대신 빈 문자열 기본값 - NULL을 포함한
복합 유니크 제약은 DB마다 취급이 달라 세 백엔드에서 동일하게
동작하려면 항상 값을 채워야 함) + `@@unique([kind, trackingCode,
projectId])`(같은 대상에 대한 중복 적재를 원자적 upsert 하나로
방지) + `@@index([createdAt])`. FK 관계 없음 - `Comment`의
`targetType`/`targetKey`처럼 존재가 보장되지 않는 느슨한 참조(문서가
이미 삭제된 뒤에도 그 트래킹 코드를 가리키는 항목이 남을 수 있음).

새 모듈 `core/searchSyncQueue.ts`: `enqueueSearchSync`(유니크
제약 기반 `upsert` - findFirst 후 create 방식은 동시 요청이 둘 다
존재 확인을 통과해 중복 행을 만들 수 있어 피함), `getSearchSyncQueueStatus`,
`drainSearchSyncQueue`(오래된 순 최대 100개를 순서대로 처리, 연결
실패를 만나면 나머지도 다 실패할 게 뻔하므로 그 배치를 즉시
중단하고 다음 워커 틱을 기다림 - 매 항목마다 타임아웃을 반복해서
기다리는 낭비 방지). `documents.ts`/`sourceIndex.ts` → 이 모듈의
`enqueueSearchSync`만 정적 import하고, 이 모듈이 그 둘을 다시
정적으로 import하면 순환이 생기므로 `drainSearchSyncQueue()` 안에서
`documents.js`/`search.js`/`sourceIndex.js`를 전부 동적 `import()`로
지연 로드해 순환을 원천적으로 끊었다.

`core/documents.ts`의 `syncAndPublish()`(모든 문서 쓰기의 단일
합류점)와 `deleteDocument()`의 직접 `indexSyncDelete` 호출을
try/catch로 감싸 `MeiliSearchRequestError`만 큐에 적재하고 삼킨다(그
외 에러는 그대로 던짐) - DB 커밋은 이미 끝난 뒤라 여기서 다시
던지면 이미 성공한 문서 생성/수정까지 실패로 보이던 게 이번에 고친
핵심 버그. `core/sourceIndex.ts`의 `backfillProjectSourceIndex`를
얇은 래퍼로 남기고 실제 로직을 에러를 삼키지 않는
`backfillProjectSourceIndexRaw`로 분리(드레인 워커가 성공/실패를
구분해야 하므로), `syncSourceFileOnSave`/`syncSourceFilesForPush`도
같은 패턴으로 `resyncProjectSourceFiles` 큐 항목을 남긴다(소스
파일은 파일 단위가 아니라 프로젝트 단위로 뭉뚱그려 재백필 - 파일별
큐잉은 과설계로 판단).

30초 주기 백그라운드 워커(`server.ts`의 `main()`, `setInterval`) +
`draining` 플래그로 이전 드레인이 안 끝났으면 이번 틱은 건너뜀(큐가
커서 30초 안에 못 끝나면 두 드레인이 겹쳐 같은 배치를 동시에
처리하는 걸 방지). admin 전용 `GET /api/admin/search-queue`(상태) +
`POST /api/admin/search-queue/drain`(수동 즉시 드레인) - 장애
해소를 확인한 관리자가 30초를 안 기다리고 바로 비울 수 있게. CLI
`search-queue status`/`drain`, MCP `search_queue_status`/
`search_queue_drain` - 신원 관리가 아니라 운영/진단 성격이라
`user_list` 류의 CLI 전용 선례를 안 따르고 CLI+MCP 둘 다 노출.

**실측 중 발견한 중요한 설계 경계** - 문서 PUT/DELETE/전이 등
"기존 문서"를 다루는 모든 라우트(`server.ts`의 `/api/documents/
:trackingCode` 계열 전부)는 실제 작업 전에 권한 확인용으로
`getDocument()`(검색 엔진 경유)를 먼저 호출한다. 이 사전 조회
자체가 Meilisearch 장애 중엔 503으로 막히므로, 그 라우트의 실제
쓰기 단계(내가 큐로 보호한 지점)까지 도달하지 못한다 - 즉 **새
문서 생성은 장애 중에도 항상 되지만, 기존 문서의 수정/삭제/전이는
장애 중엔 아예 시도되지 않고 즉시 503으로 막힌다**(내부 자동
재동기화 경로인 `resyncDocumentIndex`는 DB를 직접 읽어 이 사전
조회를 안 거치므로 영향 없음 - `questions.ts`의 자동 상태 전이가
계속 큐로 보호됨). 이건 데이터가 조용히 유실되는 게 아니라 명확한
503으로 안전하게 막히는 것이라 이번 백로그가 우려한 "장애 시 반영이
안 됨"의 핵심 위험(침묵 속 유실)은 아니지만, 큐의 보호 범위가
새 문서 생성보다 좁다는 실질적 비대칭이다. 이 사전 확인을 DB
직접 조회로 바꾸면(각 라우트가 이미 실제 작업 단계에서 core 함수가
별도로 DB를 다시 읽고 있어 중복 조회이기도 함) 보호 범위를 넓힐 수
있지만, 15개 이상의 라우트를 건드리는 더 큰 변경이라 이번 승인된
설계 범위 밖으로 판단 - PLANS.md에 `#document-write-gate-bypass-search`
로 별도 등록해 남겨둠.

**실측 검증**(docker 스택, `docker compose kill meilisearch`/
`start meilisearch`): (1) `docker compose stop`(graceful)로 먼저
시도했다가 - SIGTERM 후 프로세스가 몇 초간 살아있는 동안 이미 열려
있던 pooled keep-alive 커넥션은 여전히 성공하는 레이스가 있어(반면
DNS 등록은 먼저 사라져 신규 커넥션은 즉시 실패) 쓰기 경로 테스트가
비결정적이었다 - `kill`(SIGKILL, 그레이스 기간 없음)로 바꿔 확정적으로
재현. 장애 중: 목록/단건 조회 503(내부 호스트명 없음), 신규 문서
생성 200(큐에 `upsertDocument` 1건 적재), 기존 문서 수정/삭제
503(위 경계), 진짜 존재하지 않는 트래킹 코드는 여전히 정상 404(회귀
없음). 복구 후: 30초 워커가 자동으로 큐를 비우고 실제로 검색에
반영됨(큐만 지워진 게 아님을 재조회로 확인), 장애 중 막혔던
수정/삭제도 이제 정상 동작. 컨테이너 내부에서 `enqueueSearchSync`를
동일 인자로 3번 연속 호출 → 큐에 정확히 1건만 남는 것을 직접
확인(유니크 제약 기반 upsert 중복 방지 검증). `npx tsc --noEmit`,
`npm run audit:cli-mcp`, `npm run db:generate`(3개 백엔드 전부)
클린.

## git 외부 연동 해제(`#git-unlink`) - 완료 (2026-09-12)

PLANS.md 18번(`## 9. git 저장소 연동`). 저장소를 한 번 연결하면
프로젝트를 통째로 지우지 않는 한 연결 방식을 바꿀 방법이 없었다.

**1차 계획(모든 provider에서 Gitea 저장소까지 통째로 삭제하는
"완전 해제")은 반려됐다.** 설계자의 정정 지시: (1) 외부와의 연결만
해제 가능해야 한다(자체 호스팅은 해제 자체가 불가능), (2) Gitea와의
연결은 프로젝트를 삭제하지 않는 한 끊을 수 없어야 한다. 두 요구를
합치면 "해제"는 "저장소를 없애는 것"이 아니라 **"외부를 권위
저장소로 취급하던 관계만 끊고, 이미 있던 Gitea 작업 저장소를
그대로 self_hosted로 승격시키는 것**"이 된다 - 미러(외부 저장소의
읽기 전용 사본)만 이제 의미가 없어져 지우고, 작업 저장소(실제
커밋해온 곳)는 히스토리·현재 상태 그대로 보존한다.

**구현**: `core/gitea.ts`에 `renameRepo(oldSlug, newSlug)` 신설(Gitea
`PATCH /repos/{owner}/{repo}`로 이름 변경). `core/gitRepos.ts`의
새 함수 `unlinkExternalRepo(projectId)` - `external_linked`(또는
레거시 `github`/`gitlab`)가 아니면 즉시 거부, 미러 저장소 삭제(fail
-soft), **작업 저장소 이름을 `{slug}-work` → `{slug}`(접미사 없는
표준 self_hosted slug)로 실제로 바꾼 뒤** `ProjectGitRepo` 행을
`provider:"self_hosted"` + 새 clone URL로 갱신. `DELETE
/api/projects/:projectId/git/repo`(owner 전용) + CLI `git unlink`
+ MCP `git_unlink` 추가. 프론트(`GitRepoPanel.vue`)는
`external_linked`일 때만 "외부 연동 해제" 버튼을 보여주고(자체
호스팅엔 처음부터 안 보임), `window.confirm()`으로 한 번 확인한 뒤
서버가 돌려준 전환 후 상태로 화면을 즉시 갱신한다 - 별도 분기 없이
기존 `v-if="gitRepo.provider === 'external_linked'"` 조건들이
자연히 동기화/발행 패널을 감춘다.

**실측으로 발견한 버그**: 처음엔 Gitea 쪽 이름을 안 바꾸고 DB의
`provider`만 `self_hosted`로 바꿨는데, `requireGiteaWorkingSlug()`
(기존 함수)의 self_hosted 분기가 접미사 없는 `slugForProject()`를
기대하는 반면 실제 Gitea 저장소는 여전히 `-work` 접미사였다 - 그
결과 전환 직후 모든 git 조회/커밋이 존재하지 않는 slug를 찾아 404가
났다(실제로 마커 파일을 커밋해두고 해제 후 조회해 재현·확인). Gitea
저장소 자체의 이름을 바꾸는 `renameRepo()`로 해결 - DB 필드만
바꾸는 것으로는 안 되고 Gitea 쪽도 실제로 맞춰야 한다는 교훈.

**실측 검증**: docker 스택에서 실제 공개 저장소(`octocat/
Hello-World`)로 외부 연동 → 작업 저장소에 마커 파일 커밋 → 해제 →
`provider:"self_hosted"` 확인 → 마커 파일이 그대로 남아있는지 확인
(핵심 증거) → 해제 후에도 새 커밋이 정상 동작하는지 확인(slug
전환이 완전한지) → 재해제 시도 시 명확히 거부되는지 확인. 자체
호스팅 프로젝트에 해제를 시도하면 즉시 거부되고 아무것도 안
바뀌는지 확인. 연결 안 된 프로젝트도 명확한 에러 확인. CLI(`docs
git unlink`)/MCP(`git_unlink`) 왕복 확인. 브라우저로 실제 버튼
클릭까지 확인(confirm 취소 시 DELETE 요청 자체가 안 나가는지 네트워크
로그로 확인, confirm 승인 시 DELETE 성공 + 화면이 재조회 없이
self_hosted 화면으로 즉시 바뀌는지, 자체 호스팅 프로젝트엔 버튼
자체가 안 보이는지). `npx tsc --noEmit`(backend)/`vue-tsc -b`
(frontend)/`npm run audit:cli-mcp` 전부 클린.

## PR 초안 자동 생성(`#git-publish-pr-draft`) - 의도된 설계로 재확인, 완료 (2026-09-12)

PLANS.md 19번(`## 9. git 저장소 연동`, 이 섹션의 마지막 항목이라
헤더도 함께 제거). "동기화(발행)"가 즉시 반영/AI 대기열 둘 중 하나로만
갈라지고 "PR 초안 자동 생성" 같은 중간 단계가 없다는 게 공백인지
재확인했다 - PLANS.md에 이미 "의도된 설계 - 자동 PR은 범위 밖으로
명시적으로 남겨둠"이라고 적혀 있던 대로, 코드나 설계를 다시 살펴봐도
바뀔 이유를 못 찾았다(항상 검토를 거친 뒤 반영한다는 이 기능의
설계 원칙과 자동 PR 생성이 상충 - README.md의 SEKB 배경에서도
"인간의 검토/지침을 보장"이 핵심 전제). 코드 변경 없음 - 문서만 정리.

## `message wait`를 백엔드 폴링에서 CLI/MCP 직접 MQTT 구독으로 전환(`#message-wait-mqtt-direct`) - 완료 (2026-09-12)

PLANS.md 새 행 추가(대화 중 설계자가 직접 지시 - QA/코드 검토로
발견된 백로그가 아님). 직전 라운드(`#message-wait-timeout-cap`)의
결과물 - 백엔드가 서비스 계정으로 EMQX를 직접 구독하고 CLI/MCP는
그 HTTP 엔드포인트를 최대 10초 단위로 반복 호출(폴링)하는 구조 -
를 설계자가 반려했다: "message wait에서 EMQX를 백엔드가 구독하라는
것이 아니라, EMQX의 전체 통제권을 이 시스템이 쥐고 있으니 끝점을
docker-compose로 노출하고, 계정별로 1:1 매칭되는 EMQX 계정을
생성/관리할 수 있으므로, message wait을 호출할 때 '생성된 MQTT
계정'을 조회해(없으면 만들어서) CLI나 MCP에 전달하고, 얘가 직접
MQTT를 구독하여 대기하라는 것이다. 이렇게 하면 백엔드가 오랫동안
블로킹될 필요가 없다."

**이미 있던 인프라**: `core/emqxAuth.ts`의 `checkConnect`가 이미
"username=userId, password=JWT 액세스 토큰"으로 접속하는 경로를
지원하고 있었다(웹 UI가 EMQX-WS에 직접 붙어 실시간 갱신을 받는 데
이미 씀). JWT를 그대로 재사용하지 않고 **전용 계정을 새로 만든
이유**: JWT는 수명이 15분으로 짧아 오래 여는 구독에 안 맞고, REST
전체 권한이 아니라 MQTT 접속에만 쓰이는 좁은 권한의 자격증명이
유출 시 위험 범위도 더 작다.

**구현**: `User` 모델에 `mqttPasswordEncrypted Bytes?` 신설(3개
`.prisma` 스키마 파일 전부) - `core/giteaAccounts.ts`가 이미 쓰는
"User 행에 암호화해 직접 두고 첫 필요 시점에 지연 생성"과 같은
패턴(항상 1:1 관계라 별도 테이블 불필요). `core/emqxAuth.ts`에
`getOrCreateMqttCredential(userId)` 신설, `checkConnect`를 비동기로
바꾸고(DB 조회 필요해짐 - 유일한 호출부인 `/api/emqx/authn`
라우트에 `await` 추가) 서비스 계정/JWT 분기 뒤에 이 전용 계정
분기를 추가(JWT 분기는 웹 UI가 쓰므로 그대로 유지). `GET
/api/auth/me/mqtt-credentials`(본인 것만 조회) 신설 - 서버에
`PUBLIC_EMQX_MQTT_URL`이 없으면 전부 null을 돌려준다.

**docker-compose.yml**: EMQX의 원본 MQTT(TCP, 1883) 포트를
`PUBLIC_EMQX_WS_URL`/8083(웹 UI용 WS)과 같은 방식으로 호스트에
추가 노출(`EMQX_MQTT_HOST_PORT`, 기본 1883) - CLI/MCP는 브라우저가
아니라 호스트에서 실행되는 Node 프로세스라 WS가 아니라 원본 TCP로
붙는다. `.env.example`에 `PUBLIC_EMQX_MQTT_URL` 항목 추가.

**`cli/apiclient.ts`**: 기존 `waitForMessagePolling`(HTTP 반복
폴)은 그대로 남기고, 새 `waitForMessageDirect()`를 앞에 추가 -
자격증명을 REST로 받아온 뒤 `mqtt` 패키지(이미 backend 의존성이라
새 설치 불필요)로 직접 연결·구독한다. `PUBLIC_EMQX_MQTT_URL`
미설정이거나 실제 연결/구독이 실패하면(방화벽 등) 기존
`waitForMessagePolling`으로 그대로 폴백(fail-soft -
`PUBLIC_EMQX_WS_URL` 미설정 시 웹 UI 실시간 갱신만 조용히 꺼지는
것과 같은 원칙). MQTT로 직접 받은 메시지는 서버가 `deliveredAt`을
못 찍어주므로, 받자마자 `GET .../messages?status=pending&
markDelivered=true`를 한 번 더 호출해 "AI가 읽어감 = 기록 처리"
시맨틱을 그대로 유지한다. CLI `message wait`/MCP `message_wait`
둘 다 이 함수로 교체 - 명령/도구 이름·파라미터는 안 바뀜(사용자
입장에서 완전히 투명한 교체, 두 번째 라운드째 같은 패턴).
`cli/apiclient.ts`/`mcp/server.ts` 상단 주석에 "CLI/MCP는 REST만
호출하는 순수 클라이언트" 원칙의 의도적 예외임을 명시.

**실측 검증**: docker 재빌드(`emqx`/`backend` 모두
`--force-recreate` - 포트 매핑 변경 반영), `Test-NetConnection`으로
1883 포트 실제 노출 확인. `GET /api/auth/me/mqtt-credentials` 왕복
멱등성 확인(재호출해도 같은 비밀번호). CLI `message wait`을
백그라운드로 걸고 메시지 전송 → MQTT 직접 구독 경로로 즉시(수 초
이내) 잡히고 `deliveredAt`이 정상적으로 찍히는 것 확인(첫 시도는
tsx 콜드스타트가 테스트 스크립트의 대기 시간보다 길어 구독 전에
메시지가 발행돼 놓친 테스트 하네스 타이밍 문제였음 - 지연을 늘려
재실측하고 원인 확정, 이전 라운드에서도 겪은 것과 같은 종류의
실수). MCP `message_wait`도 별도 스크립트로 동일하게 확인(약 2ms
만에 수신). **폴백 확인**: `PUBLIC_EMQX_MQTT_URL`을 잠시 비우고
재기동 → `mqtt-credentials`가 전부 null 반환 → `message wait`이
여전히 동작하되 기존 10초 단위 HTTP 폴링으로 자연스럽게 폴백하는
것 확인 → 원복. **웹 UI 회귀 확인**: 브라우저로 실제 메시지 화면
접속 후 CLI로 메시지 전송 → 새로고침 없이 화면에 바로 나타나는지
확인(JWT 기반 EMQX-WS 경로를 안 건드렸는지의 최종 증거) - 처음엔
콘솔에 WS 연결 실패가 반복 찍혀 당황했으나, 이 세션에서 훨씬 이전에
열어두고 안 닫은 좀비 브라우저 탭 4개(오래돼 만료된 JWT로 계속
재연결을 시도하던 것)가 원인이었고, 그 탭들을 정리하고 나니 현재
탭은 정상 작동함을 확인(EMQX 로그의 `authentication_failure`가
전혀 다른 stale 사용자 id로 찍히고 있었던 것으로 확정). `npx tsc
--noEmit`, `npm run audit:cli-mcp`(명령/도구 이름 안 바뀌어 그대로
통과) 클린.

## push 훅 프롬프트 수정(update) 라우트 추가(`#hook-prompt-update`) - 완료 (2026-09-12)

PLANS.md 20번(`## 10. push 훅 자동화`). `PushHookPrompt`가 생성/
조회/삭제만 있고 수정이 없어, 브랜치 조건이나 프롬프트 문구를
조금 고치려 해도 지우고 다시 만들어야 했다(그러면 `id`가 바뀜).

`core/pushHookPrompts.ts`에 `updatePushHookPrompt(id, projectId,
input)` 신설 - `deletePushHookPrompt`가 이미 쓰는 "조회 후
projectId 일치 확인" 패턴(다른 프로젝트 소유 리소스를 `:projectId`만
맞춰 건드리는 사고 방지 - 큐 항목 쪽에서 이미 한 번 겪은 문제) 재사용.
넘긴 필드만 부분 갱신하고, `triggerBranch`에 빈 문자열을 주면 브랜치
제한 해제(null - 모든 브랜치 매칭)로 취급한다(`create`가 이미
"안 넘기면 모든 브랜치"인 것과 대칭). `PUT /api/projects/:projectId/
push-hook-prompts/:id`(owner 전용, 기존 라우트들과 동일 가드) + CLI
`hook update`(`--prompt <file>`/`--branch <branch>` 둘 다 선택) +
MCP `hook_update` 추가. 프론트엔드/스키마 변경 없음(이 기능 자체가
웹 UI에 없는 CLI/MCP 전용 워크플로).

**실측 중 발견한 CLI 사용성 함정**: `--branch ""`(공백으로 띄어
쓴 빈 문자열)를 그대로 넘기면 commander가 "옵션 값 누락"으로
해석해 파싱 에러를 낸다 - `--branch=""`(등호로 붙여 쓴 형태)라야
빈 문자열이 실제로 전달된다. 코드 버그는 아니었지만(서버 쪽 로직은
정확히 의도대로 동작 - `--branch=""`로 재확인해 브랜치 제한이 정말
해제되는 것 확인) CLI 옵션 설명에 이 함정을 명시해뒀다.

**실측 검증**: docker 재빌드·재기동 후 HTTP+CLI 왕복 - `hook
create`(브랜치 지정) → `hook update --prompt`(내용만 교체, 브랜치는
그대로) → `hook list`로 확인 → `hook update --branch=""`(브랜치
제한 해제) → `triggerBranch: null` 확인. 다른 프로젝트 id로 `PUT`
시도 시 소유 불일치로 거부, 빈 `promptTemplate` 거부 확인. MCP
`hook_update`도 별도 스크립트로 왕복 확인. `npx tsc --noEmit`,
`npm run audit:cli-mcp` 클린.

## push 훅 브랜치 glob 패턴 매칭(`#hook-branch-pattern`) - 완료 (2026-09-12)

PLANS.md 21번(`## 10. push 훅 자동화`). `PushHookPrompt.triggerBranch`
가 정확 일치 또는 전체(`null`) 둘 뿐이라 `release/1.0`,
`release/2.0`처럼 브랜치 그룹을 한 규칙으로 못 묶었다.

**범위를 glob으로만 좁힘** - 백로그 문구는 "glob/regex"였지만, 실제
필요 사례(`release/*`)는 전형적 glob이고, 두 문법을 동시에 지원하면
"이 문자열을 어느 쪽으로 해석할지" 구분 규칙이 따로 필요해 오히려
헷갈린다. `*`가 있으면 glob, 없으면 기존처럼 리터럴 정확 일치로
자동 판별 - 기존 프롬프트(전부 `*` 없음)는 동작이 전혀 안 바뀐다.

`core/pushHooks.ts`에 `matchesBranchPattern(pattern, branch)` 신설 -
`*`를 세그먼트 안에서만(`/`를 안 넘는) 와일드카드로 변환해 정규식
매칭. 라이브러리 없이 직접 변환(`*` 하나만 지원하면 되므로
minimatch류 새 의존성이 오히려 과함). `recordPushEvent()`의 DB
쿼리를 "프로젝트의 전체 프롬프트 조회"로 바꾸고(glob은 SQL로 표현
불가) 애플리케이션 코드에서 필터 - 반환값(큐에 쌓인 개수)도 필터링
후 배열 기준으로 정정(수정 전엔 필터 전 전체 개수를 그대로 돌려주는
실수가 있었는데, 커밋 전에 코드 리뷰하며 직접 잡음). 스키마/라우트
변경 없음(`triggerBranch`는 이미 자유 문자열 컬럼) - CLI/MCP는
`--branch`/`triggerBranch` 설명 문구만 glob 지원 언급 추가.

**실측 검증**: 실제 Gitea 저장소로 프로젝트 연결 → `release/*`
프롬프트 + 리터럴 `main` 프롬프트 등록 → Gitea Contents API로
백엔드를 거치지 않고 직접 커밋(진짜 push 웹훅 유발): `release/1.0`
브랜치 커밋 → `release/*` 매칭돼 큐 항목 생성 확인. `release/2.0/
hotfix`(세그먼트 2개, `release/2.0` 브랜치는 따로 만들지 않음 -
git은 어차피 `release/1.0`과 `release/1.0/hotfix`를 동시에 허용
안 함, 리프/디렉터리 충돌) 브랜치 커밋 → **매칭 안 되고 큐 항목
없음** 확인(세그먼트 경계 설계의 핵심 증거). `main` 브랜치 커밋 →
리터럴 `main` 프롬프트만 매칭돼 큐 항목 생성(회귀 없음) - 세 커밋
후 큐를 한 번에 조회해 정확히 예상한 항목만 쌓였는지 확인. `npx tsc
--noEmit`, `npm run audit:cli-mcp`(새 파라미터 없음 - 그대로 통과)
클린.

## push 훅 대기열 만료/자동 정리(`#hook-queue-ttl`) - 완료 (2026-09-12)

PLANS.md 22번(`## 10. push 훅 자동화`, 이 섹션의 마지막 항목이라
헤더도 함께 제거). `PushHookQueueEntry`는 그 프로젝트를 다시 여는
세션이 ack/done 처리해주는 걸 전제로 하는데, 아무도 다시 안 열면
영원히 `pending`으로 쌓였다 - 정리 명령/TTL이 없었다.

**삭제 대신 상태 전이(소프트 정리)** - 문서를 archived로 보관하고
프로젝트/팀을 hidden으로 감추는 이 저장소의 기존 원칙과 같은 방향.
`status` 컬럼이 이미 자유 문자열(`String @default("pending")`)이라
**스키마 변경 없이**(3개 `.prisma` 파일의 주석만 `pending |
acknowledged | done | expired`로 갱신) 새 값 `expired`를 그대로
쓸 수 있었다.

`core/pushHookPrompts.ts`에 `expireStalePushHookQueueEntries()` 신설
- `pending` 상태로 30일(`PUSH_HOOK_QUEUE_TTL_DAYS`) 넘게 방치된
항목만 `expired`로 전이. **`acknowledged`는 대상에서 제외** - 이미
사람/세션이 관여한 흔적이라 임의로 만료 취급하면 진행 중인 작업을
지워버리는 셈이 된다. `server.ts`에 `core/searchSyncQueue.ts`의
주기 워커(`#meilisearch-spof`)와 같은 패턴으로 `setInterval`(24시간
주기 - TTL 자체가 30일 단위라 짧은 주기 불필요) 등록. 기존 `hook
queue --status <s>`가 이미 임의 문자열을 그대로 필터로 받는 구조라
`--status expired`가 코드 변경 없이 바로 동작 - 새 라우트/CLI/MCP
커맨드 불필요, `--status` 옵션 설명 문구만 갱신.

**실측 검증**: 30일을 실제로 기다릴 수 없어 DB에서
`triggeredAt`을 직접 31일 전으로 되돌려 재현 - `acknowledged` 처리한
항목 1개 + `pending`인 항목 1개를 각각 backdate하고, 다른
`pending` 항목 1개는 최근 그대로 둔 채 `expireStalePushHookQueueEntries()`
를 컨테이너 안에서 직접 호출: 반환값 `1`(정확히 pending+오래된
것 하나만), 이후 조회로 `acknowledged`는 그대로 `acknowledged`,
최근 `pending`은 그대로 `pending`, backdate된 `pending`만
`expired`로 바뀐 것 확인 - `hook queue --status expired` 필터로도
정확히 그 항목만 걸러지는지 확인. `npx tsc --noEmit`, `npm run
audit:cli-mcp` 클린.

## 가이디드 마이그레이션 상태 매핑 프리셋(`#migrate-status-mapping-preset`) - 완료 (2026-09-12)

PLANS.md 25번(`## 12. 가이디드 마이그레이션`, `#migrate-idempotent`는
스키마/데이터 정합성 변경이라 자동 진행에서 스킵 대상 - 이 항목만
처리). `cli/migrate.ts`의 `scanDirectory()`가 옛 frontmatter의
`status` 값을 그대로 매니페스트에 담아, `concept` 스타일 문서가
"active"/"wip" 같은 옛 어휘를 쓰면 매번 수작업으로 고쳐야 했다.

`STATUS_MAPPING_PRESET`(대소문자 무시 조회 - active/final/done→
approved, wip/in-progress→draft, obsolete→deprecated, retired/
archive→archived 등, 표준 6종 코드 자기 자신도 포함해 이미 표준인
값은 그대로 통과) 신설. `MigrateCandidate`에 `originalStatusCode?:
string`을 추가해 **실제로 매핑이 일어난 항목에만** 원본을 남긴다
(안 바뀐 항목엔 필드 자체가 없어 매니페스트가 불필요하게 안 커짐).
`scanDirectory(sourceDir, { applyStatusPreset? })` - 기본 `true`,
`false`면 프리셋을 완전히 건너뛰고 지금까지 동작 그대로(옵트아웃).
CLI `migrate scan --no-status-preset`, MCP `migrate_scan`의
`applyStatusPreset` 파라미터로 노출. `applyManifest()`는 매니페스트의
`statusCode`를 그대로 쓰는 구조라 수정 불필요 - 프리셋이 미리 채운
값이든 사용자가 직접 고친 값이든 구분 없이 반영된다. 새 라우트/
스키마 변경 없음(순수 로컬 CLI/MCP 오케스트레이션).

**실측 검증**: `active`/`wip`/`totally-custom-word`(프리셋에 없는
값) 세 종류의 frontmatter를 가진 테스트 파일로 `docs migrate scan` -
기본 동작에서 앞 둘은 각각 `approved`/`draft` + `originalStatusCode`
채워짐, 프리셋에 없는 값은 원본 그대로에 `originalStatusCode` 필드
자체가 없음을 확인. `--no-status-preset`으로는 셋 다 원본 그대로
(완전 옵트아웃) 확인. 실제로 `docs migrate apply`까지 반영해 두
문서가 정확히 매핑된 표준 상태(`approved`/`draft`)로 생성됐는지
확인(프리셋에 없는 값은 기존 동작과 동일하게 "정의 안 된 전이"
경고와 함께 초기 상태로 남음 - 회귀 없음). MCP `migrate_scan`도
`applyStatusPreset:false`로 별도 확인. `npx tsc --noEmit`, `npm run
audit:cli-mcp` 클린.

## 대량 문서 목록 미페이지네이션 지점 제거(`#large-list-pagination`) - 완료 (2026-09-12)

PLANS.md 27번(`## 13. 웹 UI 전반`). 다음 백로그 항목이었던
`#responsive-dark-mode`는 설계자에게 직접 확인 후(프론트엔드 43개
Vue 컴포넌트 전부가 공유 테마 체계 없이 `<style scoped>`에 색상을
하드코딩한 상태라 다른 라운드들보다 훨씬 큰 재설계가 필요 - 설계자가
"실제 필요 여부는 설계자 판단"이라고 이미 명시해둔 항목이기도 함)
지금은 보류하기로 하고 건너뜀 - 이 항목으로 진행.

코드 확인 결과, 핵심 문서 목록 화면(`DocumentsView.vue`, 사이드바
`DocumentExplorer.vue`)은 이전 라운드에서 이미 `/documents/page`
페이지네이션을 쓰고 있었다. 실제로 안 쓰이던 곳 둘: (1)
`EntityPickerDialog.vue`의 `document` kind(Q&A 근거/칸반 카드
근거/접근 권한 대상 문서 등 여러 화면이 공유하는 범용 선택기)가
`GET /projects/:id/documents`(페이지 없는 전체 배열, Meilisearch가
갖고 있는 본문 포함 전체 필드)를 매번 통째로 받아 클라이언트에서
문자열 필터만 하고 있었다. (2) `ChangeTrackingView.vue`의 "문서
버전 이력" 절의 네이티브 `<select>`도 같은 전체 배열로 옵션을
채웠다. 폴더는 트리 구조라(오프셋 페이지네이션이 자연스럽지 않고,
프로젝트당 개수도 문서보다 훨씬 작게 유지되는 게 보통이라) 이번
범위에서 뺐다.

**새 백엔드 라우트/스키마 없이 기존 엔드포인트만 재사용** -
`EntityPickerDialog.vue`는 검색어가 없으면 `DocumentsView.vue`가
이미 쓰는 `/documents/page?page=1&pageSize=50`, 검색어가 있으면
사이드바 검색과 같은 `/search?q=...`(Meilisearch 전문검색, 300ms
디바운스)를 부른다. 서버가 이미 걸러준 결과라 `document` kind에
한해 기존 클라이언트 측 라벨 문자열 필터를 건너뛰게 했다 - 안
그러면 Meilisearch가 본문 내용으로 매치시켜준 문서가 라벨(추적코드
+제목)엔 그 검색어가 없어 클라이언트 필터가 다시 지워버리는
불일치가 생긴다(실측으로 확인한 실제 위험 - 아래 검증 참고).
`ChangeTrackingView.vue`는 네이티브 `<select>`+전체 배열 fetch를
완전히 걷어내고, 이 저장소 전역에서 "문서 참조 고르기"에 이미
쓰이는 `useEntityPickerStore()`(`QAPanel.vue`의 "근거 추가"와 같은
패턴)를 재사용 - 선택된 문서의 표시 라벨은 이미 리비전 조회가
받아오는 `GET /documents/:trackingCode` 응답의 `title`을 그대로
쓰고(새 호출 불필요), "선택 해제" 버튼으로 기존 빈 옵션과 같은
기능을 유지했다.

**실측 검증**: 문서 5개(그중 1개는 제목엔 없고 본문에만 있는
고유 키워드 포함)를 가진 프로젝트로 브라우저 실측. Q&A "근거 추가"
다이얼로그를 열자 네트워크 탭에 `/documents/page?...pageSize=50`
(전체 배열 아님)만 찍히는 것 확인 → 그 본문 전용 키워드로 검색하니
`/search?q=...` 호출로 전환되고, 그 문서가 결과에 정확히 남아있는
것을 스크린샷으로 확인(클라이언트 재필터로 사라졌다면 여기서
빠졌을 것). 변경 추적 화면에서 "문서 선택..." 버튼 → 같은
다이얼로그로 문서를 고르니 버튼이 "문서 바꾸기..."로 바뀌고
추적코드+제목 라벨과 "선택 해제" 버튼이 나타남 → 리비전 비교가
정상 동작 → "선택 해제" 클릭 시 원래 상태로 복귀 확인.
`npx vue-tsc -b`(frontend) 클린.

## 문서 쓰기 라우트의 사전 권한 확인을 DB 직접 조회로 전환(`#document-write-gate-bypass-search`) - 완료 (2026-09-12)

PLANS.md 30번. `#meilisearch-spof` 실측 중 발견해뒀던 비대칭을
마저 닫는 라운드 - 그때는 새 문서 생성만 장애 중에도 되고 기존
문서 수정/삭제/전이는 사전 권한 확인 자체가 검색 엔진을 거쳐 503
으로 막혔다.

`core/documents.ts`에 `getDocumentAccessInfo(trackingCode)` 신설 -
DB에서 `{id, projectId, docTypeId, statusId}`만 직접 읽는다(검색
엔진 안 거침). `server.ts`의 `/api/documents/:trackingCode` 계열
라우트 **15곳**(PUT/DELETE/전이/우선순위/링크/역참조/리비전/연관
소스코드/접근권한/폴더배치, bulk 2곳 포함)에서 권한 확인용
`getDocument()` 호출을 전부 이 함수로 교체 - 반환 필드 이름이 같아
뒤따르는 `resolveEffectivePermission(...)` 호출부는 한 글자도 안
바뀌었다(순수 함수 이름 교체). 유일하게 안 바꾼 곳은 단건 조회
라우트(`GET /api/documents/:trackingCode`) - 응답 본문 자체가
문서 내용이라 "모든 조회는 검색 엔진을 거친다"는 원칙이 실제로
적용돼야 하는 진짜 조회 자리이기 때문. 새 스키마/라우트 없음 -
기존 함수 호출 지점만 15곳 교체.

**실측 검증**: `docker compose kill meilisearch`로 장애 재현 후,
장애 전 만들어둔 문서를 상대로 PUT(본문 수정)/전이/우선순위 변경을
연속 시도 - **전부 200 성공**(수정 전엔 여기서 503이었음, 이번
라운드의 핵심 변화). 검색 동기화 큐에 그 변경들이 정확히 적재(같은
트래킹코드라 `upsertDocument` 1건으로 중복 제거된 것도 확인 -
`#meilisearch-spof`의 유니크 upsert 로직 재확인). 같은 상태에서
DELETE도 200 성공, 큐에 `deleteDocument`로 전이돼 쌓임. 같은
문서의 **내용 조회**(`GET /api/documents/:trackingCode`)는 여전히
503(의도된 경계, 회귀 아님). `docker compose start meilisearch` 후
드레인 워커가 자동으로 큐를 비우고, 실제로 문서가 삭제된 상태로
검색에 반영(404)됨을 확인 - 두 라운드(`#meilisearch-spof`와 이번
라운드)가 실제로 맞물려 동작하는 최종 증거. `npx tsc --noEmit`,
`npm run audit:cli-mcp`(라우트/CLI/MCP 표면 자체는 안 바뀌어 그대로
통과) 클린.

## DocStatus 전이를 설계자 CRUD가 아니라 AI 판단으로(`#doctype-transition-ai-governed`) - 완료 (2026-09-12)

설계자 직접 지시(백로그 항목 아님): "문서 타입에서 전이가 가능하고
불가능하고를 결정하는 것은, 설계자가 아니라 실질적인 작업자인 AI여야
한다 - 상태 머신을 입력하거나 규제하려는 시도를 하지 않아야 한다. 다만
draft는 한번 벗어나면 다시 draft가 될 수 없다." 지금까지는
`DocStatusTransition`이라는 별도 테이블로 설계자가
`doctype-transition-add`/`-delete`를 통해 어느 상태에서 어느 상태로
갈 수 있는지 CRUD로 직접 정의했다. `seedStandardStatusFlow`가 기본으로
완전 연결 그래프(draft 도착만 제외)를 심어주긴 했지만, 설계자가 그
뒤에 개별 전이를 지워 그래프를 마음대로 좁힐 수 있는 구조 자체가
지시의 원칙에 반했다 - 실제로 손봐야 할 지점은 "기본 그래프가 너무
좁다"가 아니라 "설계자가 그래프를 좁힐 수 있는 CRUD가 존재한다"는
것이었다.

**핵심 통찰**: `transitionDocumentStatus()`(`core/documents.ts`)와
`GET /next-statuses` 라우트는 이미 `allowedNextStatuses()`의 반환값을
그대로 소비할 뿐이라("허용 목록에서 찾아지면 허용, 아니면 거부"),
`allowedNextStatuses()`의 내부 구현만 바꾸면 두 소비처는 코드 한 줄도
안 건드리고 새 규칙을 그대로 물려받았다.

**스키마**(3드라이버 전부): `DocStatusTransition` 모델과 그 두 관계
(`DocType.transitions`, `DocStatus.transitionsFrom`/`transitionsTo`)를
삭제. 이 프로젝트는 마이그레이션 파일 대신 컨테이너 기동 시
`prisma db push`로 스키마를 맞추는 방식이라(`docker-entrypoint.sh`)
별도 마이그레이션 생성 없이 스키마 파일만 고치면 된다.

**`core/docTypes.ts`**: `DocStatusTransition` 인터페이스와
`addDocStatusTransition`/`deleteDocStatusTransition`/
`addDocStatusTransitionByCode`/`listDocStatusTransitions` 전부 삭제.
`allowedNextStatuses(docTypeId, fromStatusId)`를 DB의 전이 테이블을
안 보고 `listDocStatuses()` 결과에서 자기 자신과 `code === "draft"`만
걸러내도록 재작성 - 이제 이 DocType에 정의된 모든 상태(자기 자신 제외)
가 항상 다음 상태로 허용된다. `initialStatusFor()`는 원래 "전이
그래프에서 누구의 도착지도 아닌 상태"로 진입점을 찾았는데, 테이블이
없어지면서 이 로직 자체가 깨지므로 `findDocStatusByCode(docTypeId,
"draft")`를 우선 찾고 없으면 `listDocStatuses()[0]`으로 폴백하도록
재설계(숨은 의존성 - 단순히 `allowedNextStatuses`만 고치면 이 함수는
조용히 잘못된 값을 낼 뻔했다). `seedStandardStatusFlow()`는 상태 6개를
심는 앞부분만 남기고 전이 심기 루프를 제거해 단순화.

**`server.ts`/`cli/index.ts`/`mcp/server.ts`**: 전이 CRUD 라우트
3개(`POST/DELETE .../transitions`, `GET /doc-types/:id/transitions`),
CLI 명령 3개(`doctype-transition-add`/`doctype-transitions`/
`doctype-transition-delete`), MCP 도구 3개(`doctype_transition_add`/
`doctype_transitions`/`doctype_transition_delete`)를 쌍으로 동시
제거 - CLI/MCP 완전성 원칙은 제거에도 그대로 적용되므로
`audit-cli-mcp.ts`의 예외 목록엔 손댈 게 없었다(그대로 클린).
`doctype-apply-standard-flow`/`doctype_apply_standard_flow` 설명
문구에서 "+ 전이"/"draft를 제외한 모든 전이" 부분 제거.

**`DocTypeManager.vue`**: 전이 목록/추가 폼/삭제 버튼과 관련 상태
(`transitions` ref, `addTransition`/`removeTransition`, 전이 표시
전용이던 `statusCode()` 헬퍼) 전부 제거. `loadDetail()`은 상태만
조회하도록 축소.

**SKILL.md 2벌**(`.claude/skills/claude-native-workflow/`와
`backend/prisma/seed-templates/`, 수동 동기화) - "절대 규칙" 문단의
근거를 "전이 정의 자체가 거부되므로"에서 "허용되는 다음 상태 목록
자체에 draft가 항상 빠지므로"로 재작성, 표준 흐름/전이 CRUD 관련
문장·명령 표 행 제거.

**실측 검증**: 로컬 `npx tsc --noEmit`/`vue-tsc -b`/
`npm run audit:cli-mcp`(CLI 121개·MCP 110개, 대칭성 이상 없음) 클린
확인 후 `npm run db:generate`로 3드라이버 클라이언트 재생성,
`docker compose build backend` → `up -d --force-recreate backend`(실제
Postgres 컨테이너 로그에 `DocStatusTransition` 테이블 드롭이 찍힘 -
`db push --accept-data-loss`가 의도대로 동작). HTTP 왕복으로 새
문서(`draft`)를 만들어 `DocStatusTransition` 레코드가 한 번도 존재한
적 없는 조합(`pending`→`approved`)으로 전이 → 200 성공, `approved`에서
`draft`로 전이 시도 → 400 거부(유일하게 남은 하드 규칙), 제거된 라우트
2곳은 404 확인. 로컬 재빌드한 CLI에서 `doctype-transition-add` →
"unknown command" 확인, `doctype-apply-standard-flow --help` 설명
문구 갱신 확인. 브라우저로 `DocTypeManager.vue`를 열어 타입 확장 시
"전이" 섹션이 더 이상 안 보이고 상태 목록/상태 추가/"표준 상태 흐름
한 번에 적용" 버튼은 그대로 동작(재적용 시 200, 콘솔에 전이 관련
요청 자체가 없음)하는 것을 확인.

## DocType 생성 시 표준 상태 6개 자동 시딩(`#doctype-status-auto-seed`) - 완료 (2026-09-12)

바로 앞 라운드(`#doctype-transition-ai-governed`)의 연장선에 있는
설계자 직접 지시: "개별로 상태 코드를 관리할 필요가 없어졌어.
기본적으로 입력된 것만 고정적으로 유지하고, AI가 등록하고 입력하게
풀어놔." 그 라운드가 "어느 상태에서 어느 상태로 갈 수 있는가"를 설계자
CRUD에서 뺐다면, 이번엔 "이 DocType이 애초에 어떤 상태들을 갖는가"
자체를 개별 관리 대상에서 뺐다.

기존엔 새 프로젝트의 기본 6종 DocType만 `seedDefaultDocTypes()`가
`createDocType()` 호출 뒤 별도로 `seedStandardStatusFlow()`를 불러
표준 6개 상태를 심어줬고, 설계자가 직접 만드는 커스텀 DocType은 생성
직후 상태가 0개라 "상태 추가"(코드 하나씩, `doctype-status-add`) 또는
"표준 상태 흐름 한 번에 적용"(`doctype-apply-standard-flow`)을 별도로
불러야 문서를 만들 수 있었다 - 표준 6개 코드/라벨/지침 자체는 그대로
고정(`STANDARD_DOC_STATUSES`)해두고, 그걸 "이 타입에 붙이는" 절차만
없앴다.

**`core/docTypes.ts`**: 기존 `addDocStatus`(개별 상태 1개 추가)와
`seedStandardStatusFlow`(표준 6개 idempotent 심기 - 이름을
`seedStandardStatuses`로 정리, 지난 라운드에서 이미 전이 심기 부분은
빠진 뒤라 로직 자체는 그대로)를 둘 다 비-export 내부 헬퍼로 전환하고,
`createDocType()`이 DocType row를 만든 직후 `seedStandardStatuses`를
자동으로 호출하도록 변경 - 함수 시그니처는 그대로라 호출자(라우트/
`seedDefaultDocTypes`) 쪽은 건드릴 게 없었다(`seedDefaultDocTypes`는
오히려 별도 시딩 호출 줄을 지워 더 단순해짐).

**server.ts/cli/index.ts/mcp/server.ts**: 개별 상태 추가 라우트
(`POST .../statuses`)와 표준 흐름 라우트(`POST .../standard-flow`),
CLI 2개(`doctype-status-add`/`doctype-apply-standard-flow`), MCP
2개(`doctype_status_add`/`doctype_apply_standard_flow`)를 쌍으로 동시
제거 - `GET .../statuses`(목록 조회)는 그대로 유지(이제 항상 6개가
꽉 찬 채로 반환됨). CLI/MCP 완전성 원칙은 제거에도 적용되므로
`audit-cli-mcp.ts` 예외 목록은 손댈 게 없었다(121/110 → 119/108,
대칭성 그대로).

**`DocTypeManager.vue`**: "상태 추가" 폼과 "표준 상태 흐름 한 번에
적용" 버튼, 관련 상태/에러 ref와 핸들러 전부 제거. 상태 목록(코드/
라벨/종료 배지/지침)은 순수 읽기 전용으로 유지 - 이제 항상 6개가 다
채워져 보인다. 이 폼에서만 쓰이던 `.standard-flow-btn`/`.add-row` CSS
블록도 같이 정리.

**SKILL.md 2벌**: "표준 상태 6개를 한 번에 심으려면.../상태를 하나씩
붙이려면..." 문단을 "DocType을 만들면 자동으로 같이 만들어진다"로
재작성, 명령 표에서 두 행 제거.

**소급 적용 안 함**: 이 변경 이전에 만들어진, 아직 상태가 0개거나
일부만 있는 커스텀 DocType은 이번 변경으로 저절로 고쳐지지 않는다 -
그걸 고치던 유일한 수단(개별 추가/표준 흐름 적용)이 함께 없어졌기
때문. 지난 라운드에서 `DocStatusTransition` 데이터 5923건이 스키마
드롭으로 사라진 걸 그대로 받아들인 것과 같은 판단 - 아직 활발히
개발 중인 내부 시스템이라 소급 마이그레이션 없이 진행.

**실측 검증**: `npx tsc --noEmit`/`vue-tsc -b`/`npm run
audit:cli-mcp`(119/108, 대칭성 이상 없음) 클린. `docker compose build
backend` → `up -d --force-recreate backend` 후, 새 커스텀 DocType을
생성한 직후(상태 추가/표준흐름 호출 전혀 없이) `GET
/doc-types/:id/statuses`가 이미 6개 전부 반환하는 것을 확인 → 그
자리에서 바로 문서 생성이 성공하는 것을 확인(과거엔 상태 0개라
실패했을 지점) → 제거된 라우트 2개가 404인지 확인. 로컬 재빌드한
CLI에서 `doctype-status-add`/`doctype-apply-standard-flow`가 "unknown
command"인지 확인. 브라우저로 `DocTypeManager.vue`에서 새 타입을 만들어
펼쳐보고 "상태 추가"/"표준 상태 흐름 한 번에 적용"이 안 보이면서
상태 목록엔 이미 6개가 다 떠 있는 것을 확인.

## 템플릿(CLAUDE.md/SKILL.md) 변경 이력(`#template-history`) - 완료 (2026-09-12)

PLANS.md 23번(백로그 항목). `setTemplateOverride()`(`core/templates.ts`)
는 이미 override가 있는 스코프에 다시 쓰면 그냥 `update({ data: {
content } })`로 이전 내용을 덮어써 버렸다 - Document는 저장할 때마다
`DocumentRevision`을 남기는 반면 템플릿엔 그 개념이 아예 없어서,
실수로 잘못된 CLAUDE.md/SKILL.md를 덮어쓰면 되돌릴 방법이 없었다.

새 개념을 고안하지 않고 `saveDocumentBody()`가 이미 쓰는 "덮어쓰기
직전에 이전 값을 리비전 테이블에 스냅샷"과 완전히 같은 패턴을 그대로
가져왔다. 새 `TemplateRevision` 모델(3 provider 스키마 동일 -
`templateFileId`/`content`/`editedBy`/`editedAt`, `TemplateFile`
onDelete Cascade)을 추가하고, `setTemplateOverride`에 `editedBy`
매개변수를 추가해 `existing`이 있을 때(= 실제 덮어쓰기)만 업데이트
직전에 `db.templateRevision.create(...)`로 스냅샷 - 스코프에
override가 최초로 생기는 `create` 분기는 스냅샷할 이전 값이 없으므로
그대로 둔다. 새 `listTemplateRevisions(filename, scope)`는
`resolveTemplate()`처럼 상속 체인을 타지 않고 정확히 그 스코프의
`TemplateFile` 행 하나를 찾아 그 리비전만 반환한다(체인을 타면 "어느
스코프의 과거 내용인지"가 모호해지기 때문).

`setTemplateOverride`의 유일한 외부 호출자는 `server.ts`의 `PUT
/api/templates` 라우트뿐이라 시그니처 변경(`editedBy` 추가)의 영향이
`req.userId!`를 넘기는 한 줄로 끝났고, `seedDefaultTemplates()`는
애초에 이 함수를 거치지 않고 `db.templateFile.create()`를 직접 써서
변경이 필요 없었다. 새 `GET /api/templates/revisions` 라우트는 기존
`/api/templates`와 같은 이유(filename에 슬래시 포함 가능)로 쿼리스트링
기반, 권한 수준도 읽기 전용이라 `GET /api/templates`와 동일(스코프별
쓰기 제한 없음). CLI `template revisions <filename>`/MCP
`template_revisions`를 쌍으로 신설(CLI/MCP 완전성 원칙, 대칭성 유지).

**복원 방식**: Document 쪽에도 "리비전 N으로 되돌리기" 전용 API가
없다(리비전은 스냅샷 목록 조회만, 복원은 그 내용을 다시 저장하는
방식) - 템플릿도 같은 관례를 따른다. 별도의 "복원" 엔드포인트나 웹
UI는 만들지 않았다(템플릿 관리 자체가 애초에 웹 UI 없이 CLI/MCP/API
로만 이뤄짐 - 조사 완료).

SKILL.md 2벌의 명령 표에 `template_revisions` 행을 추가하면서, 조사
중 발견한 기존 문서화 공백(`template get`/`set`과 그 MCP 짝이 애초에
표에 한 번도 없었음)도 같은 표를 손대는 김에 같이 채웠다.

**실측 검증**: `npx tsc --noEmit` 클린(`db.templateRevision.findMany`
결과의 `.map` 콜백에 명시적 타입 주석이 필요했다 - `getDb()`가 `any`를
반환하는 이 코드베이스의 기존 관례를 그대로 따름). `npm run
audit:cli-mcp`(119/108 → 120/109, 대칭성 이상 없음). `docker compose
build backend` → `up -d --force-recreate backend`(스키마에 테이블만
추가돼 데이터 손실 경고 없이 in sync). HTTP 왕복: 새 파일명에 최초
override(content A) → 리비전 없음 확인 → 다시 override(content B로
덮어씀) → 리비전 1건(content A, editedBy=실제 로그인 사용자) 확인 →
현재 값은 B인지 확인 → 그 리비전의 content(A)를 다시 `PUT`해 복원
워크플로가 실제로 동작하는지, 그 복원 자체도 새 리비전(B)을 남기는지
확인. 로컬 재빌드한 CLI로 `docs template revisions`도 동일하게
재확인.

## 가이디드 마이그레이션 재실행 안전장치(`#migrate-idempotent`) - 완료 (2026-09-12)

PLANS.md 24번(백로그 항목, `#template-history`와 함께 설계자가 이미
승인한 두 항목 중 나머지 하나). `docs migrate apply <projectId>
<manifestFile>`(`cli/migrate.ts`의 `applyManifest()`)를 같은
매니페스트로 두 번 돌리면 `skip` 아닌 모든 항목이 매번 `POST
/documents`를 새로 호출해 문서가 중복 생성됐다 - 실행이 성공했는지
확인 없이 재시도하면 안 되는 상태였고, FEATURES.md엔 "실패한 항목만
남겨 재시도"라는 수작업 우회가 적혀 있었다.

핵심 발견: `applyManifest`는 지금까지 `manifestPath`를 읽기만 하고
절대 다시 쓰지 않았다 - "이미 반영됨" 표시가 남으려면 apply가 처리
후 자기 입력 파일에 결과를 다시 써야 한다. 또한 링크 해석
(`oldIdToTrackingCode`)이 그 실행 안에서 새로 만든 항목만으로 매번
새로 구성되므로, 이미 반영된 항목을 건너뛰더라도 그 trackingCode를
이 맵에 채워 넣지 않으면 아직 반영 안 된 다른 항목이 그걸 링크로
가리킬 때 "이번 배치에 없음" 경고가 잘못 떴다 - 그래서 마크는 단순
boolean이 아니라 결과 trackingCode 자체를 저장해야 했다.

`MigrateCandidate`에 `appliedTrackingCode?: string` 필드 추가 - 값이
있으면 이미 반영됨, 그 값이 결과 trackingCode. `skip`(설계자가 애초에
반영 안 하기로 정한 것)과는 의미가 완전히 달라 같은 필드를 재사용하지
않았다. `applyManifest`의 1차 루프에서 `appliedTrackingCode`가 있는
항목은 재생성하지 않고 `oldIdToTrackingCode`에만 채워 넣은 뒤
`alreadyApplied`(새 `ApplyResult` 필드)로 보고 - `linksByTrackingCode`
에는 안 넣어 그 항목 자신의 링크는 재생성하지 않는다(`DocumentLink`에
unique 제약이 없어 그대로 두면 재실행마다 링크가 늘어나는 걸 확인해서
막음). 새로 생성에 성공한 항목은 `item.appliedTrackingCode = doc.
trackingCode`로 매니페스트 배열 자체(메모리 상)를 갱신하고, 모든 처리가
끝난 뒤 `fs.writeFileSync(manifestPath, JSON.stringify(manifest, null,
2), "utf-8")`로 파일에 다시 쓴다 - 실패한 항목(`errors`)은 표시가 안
남으므로 다음 실행에서 자동으로 재시도 대상이 된다(수작업이 자동화됨).
Node의 `fs.writeFileSync`는 BOM을 안 남기므로 이 파일의 오랜 BOM 문제
(`stripBom`)를 재발시키지 않는다. CLI(`cli/index.ts`)/MCP
(`mcp/server.ts`)는 `applyManifest`의 반환 타입에 필드 하나가 늘었을
뿐 그대로 결과를 출력/반환하므로 변경이 필요 없었다.

**실측 검증**: `npx tsc --noEmit`/`npm run audit:cli-mcp`(120/109,
CLI/MCP 표면 자체는 안 바뀌어 그대로) 클린. 실제 frontmatter 마크다운
2개(서로 링크)+기존에 남아있던 테스트 파일 3개로 `scan`→`apply` 1차
실행(5건 `created`, 매니페스트 파일이 각 항목에 `appliedTrackingCode`
로 갱신된 것을 직접 열어 확인) → **같은 매니페스트로 2차 실행**(`created`
빈 배열, 5건 전부 `alreadyApplied`, 프로젝트 문서 목록이 여전히 5개인
것으로 중복 없음 확인) → 한 항목(`old-a`, `old-b`를 링크로 가리킴)의
`appliedTrackingCode`만 수작업으로 지운 뒤 3차 실행 - 그 항목만
새 trackingCode로 재생성되고 나머지 4건은 그대로 `alreadyApplied`
(부분 재시도 확인), 재생성된 항목이 **이미 반영된** `old-b`를 향한
링크를 경고 없이 정확한 trackingCode로 연결하는지 `backlinks`로 대조
확인(핵심 통찰이었던 "이미 반영된 항목도 링크 대상으로는 여전히
해석돼야 한다"의 실제 증거) → 존재하지 않는 DocType(`ZZZ`)으로 항목
하나를 추가해 4차 실행(그 항목만 `errors`, `appliedTrackingCode` 안
남음) → 5차 실행(그 항목이 `errors`로 다시 나타나 자동 재시도되는지
확인, 나머지는 여전히 `alreadyApplied`).

## 반응형/다크 모드 1단계(`#responsive-dark-mode`) - 완료 (2026-09-12)

PLANS.md 26번, 마지막 남은 백로그. 문서 자체가 "개인 설치형 도구라
우선순위는 낮을 수 있지만, 실제 필요 여부는 설계자 판단"이라 명시해
자동 착수 대신 먼저 계획만 정리해 승인을 받았다(설계자: "우선 계획만
세워봐" → 계획 검토 후 "계속 진행"). Explore 에이전트 2개로 프론트엔드
전체를 조사한 결과 반응형/다크모드 인프라가 전무했다 - `@media` 쿼리
0건, CSS 커스텀 프로퍼티 0건, 46개 `.vue` 파일에 하드코딩 hex 724건
(`#fff` 154회, `#d8dae0` 102회 등 상위 몇 개가 대부분을 차지). 46개
파일을 한 라운드에 전부 바꾸고 검증하는 건 무리라 판단해 **여러
단계로 나눴다** - 이번엔 기반(테마 토큰/토글) + 셸 + 대표 화면
몇 개까지만.

**테마 인프라**: `App.vue`의 전역 스타일에 `:root`(라이트 기본값)와
`:root[data-theme="dark"]`(다크 재정의) 토큰 선언. 새
`stores/theme.ts`(Pinia, 이 저장소의 기존 스토어 관례를 그대로 따름
- composables 디렉터리는 없고 전부 Pinia 스토어) - `mode`
("light"/"dark"/"system", localStorage에 저장)와 `resolved`(항상
"light"/"dark" 중 하나로 미리 해석된 값 - `document.documentElement
.dataset.theme`에 반영)를 분리해서 관리한다: `resolved`를 별도
reactive state로 두지 않고 getter로 계산했다면 Vue가 캐싱한
computed가 OS의 `prefers-color-scheme` 변경(matchMedia 이벤트)엔
반응하지 못했을 것 - 그래서 `applyResolved()` 액션이 명시적으로
`resolved`를 다시 쓰고 `matchMedia` change 리스너에서도 그 액션을
재호출하는 구조로 잡았다. "system"은 저장되는 설정값일 뿐 DOM에
적히는 `data-theme`엔 항상 구체적인 "light"/"dark"만 실리므로,
CSS 쪽엔 `@media (prefers-color-scheme: dark)`가 필요 없다(JS가
이미 해석해서 넘겨줌).

**Monaco는 CSS를 안 따라간다**: 캔버스 위젯이라 `monaco.editor.
setTheme()`을 명시적으로 호출해야 한다 - `MonacoEditor.vue`가
`theme.resolved`를 직접 구독해(prop으로 안 받고, 이 앱은 한 번에
에디터 인스턴스가 하나뿐이라 전역 호출로 충분) 마운트 시/변경 시
`vs`/`vs-dark`를 전환하도록 추가.

**셸(`AppLayout.vue`) 반응형**: `@media (max-width: 768px)`에서
사이드바를 off-canvas(`transform: translateX(-100%)`)로 바꾸고,
새 햄버거 토글 버튼 + 반투명 배경 오버레이(클릭 시 닫힘) 추가.
라우트가 바뀌면(`watch(() => route.fullPath, ...)`) 자동으로
닫히게 해 모바일에서 링크 클릭 후 매번 손으로 안 닫아도 되게 했다.
사이드바 하단엔 라이트→다크→시스템 3단 순환 토글 버튼도 신설.

**조사 중 발견**: 계획 단계에서 "6개 모달 다이얼로그가 고정 px
너비라 반응형 처리가 필요할 것"이라 가정했으나, 실제로 열어보니
`EntityPickerDialog`/`DocumentPreviewDialog`/`KanbanCardDialog`/
`QAPanel`/`SearchScopeDialog`/`TargetPanelDialog` 전부 이미
`width: min(Npx, 90vw)` 패턴을 쓰고 있었다 - 추가 작업 불필요(계획
문서의 가정이 조사 없이 세운 추측이었다는 걸 구현 단계에서 바로잡은
사례).

**대표 화면 6개**(+덤으로 `ProjectShellView` 탭 바) 색상 토큰화:
`ProjectHomeView`/`DocumentsView`/`DocumentEditorView`(가장 배지/
색상이 많은 화면이라 팔레트 검증에 적합)/`DocumentExplorer`/
`SidebarSearchBox`/`Pagination`. 사이드바 전용 컴포넌트
(`DocumentExplorer`/`SidebarSearchBox`)는 사이드바 자체가 라이트/
다크 구분 없이 원래도 항상 어두웠으므로, 다크 모드에서 값이 안
바뀌는 `--color-sidebar-*` 토큰으로만 옮겼다(치환 자체는 기계적).
`DocumentEditorView`는 배지 색(우선순위/공지 배너)이 의미를
담고 있어 대비를 화면으로 직접 확인하며 옮겼다.

**나머지 ~40개 파일은 의도적으로 이번 범위 밖** - PLANS.md 34번
행(`#responsive-dark-mode-phase2`)으로 이어감. 칸반 보드는 순수
HTML5 드래그라 터치 기기에서 애초에 동작하지 않는데, 이건 CSS/
다크모드로 해결할 문제가 아니라 DnD 구현 자체를 다시 손대야 하는
별도 과제라 이 백로그와 분리해뒀다.

**실측 검증**: `npx vue-tsc -b` 클린. `docker compose build backend`
→ `up -d --force-recreate backend`. 브라우저로 라이트→다크 전환 후
`ProjectHomeView`/`DocumentsView`/`DocumentEditorView`가 실제로
다크 팔레트로 바뀌는지 확인, "편집" 클릭 시 Monaco가 `vs-dark`로
렌더링되는지 확인(스크린샷으로 대조). `resize_window`(mobile,
375px)로 좁혀 셸 사이드바가 접히고 탭 바가 스크롤되는지 확인 -
햄버거 버튼 클릭이 이 세션의 자동화 도구에서 반복적으로 타임아웃돼
(앱 버그 아님 - `btn.dispatchEvent(new MouseEvent("click"))`으로
직접 확인해보니 Vue 핸들러 자체는 정상 동작, `sidebar` 클래스가
`"sidebar open"`으로 정확히 바뀌었고 스크린샷에도 오프캔버스
사이드바가 정확히 슬라이드인 되는 게 보였다 - 자동화 도구의 클릭
디스패치 쪽 문제로 결론) 순수 DOM 이벤트 디스패치로 우회 확인했다.
아직 안 건드린 화면(예: 프로젝트 목록, 칸반 보드)은 다크 모드에서도
라이트로 남아있는 것을 회귀가 아니라 "2단계 대기"로 확인.

## 반응형/다크 모드 2단계(`#responsive-dark-mode-phase2`) - 완료 (2026-09-12)

1단계에서 셸+대표 화면 6개만 전환하고 의도적으로 미뤄둔 나머지
~40개 뷰/컴포넌트를 이어서 전부 전환했다(설계자: "커밋 푸시후
계속하자" - 1단계 완료 보고 직후 바로 이어가는 것으로 확인). 새
개념 없이 1단계에서 만든 `App.vue` 토큰(`--color-*`)을 각 파일의
하드코딩 hex에 기계적으로 대응시키는 작업 - 기존 색상과 가장 가까운
의미의 토큰을 재사용하는 걸 우선하고(예: `#f0f1f5`류 hover 배경은
전부 `--color-surface-hover`), 기존 토큰 중 마땅한 게 없는 색만
새로 추가했다: `--color-danger-border-strong`(팀/그룹 삭제 버튼
테두리), `--color-mark-bg`(검색 결과 하이라이트), `--color-terminal-bg`/
`--color-terminal-text`(API 키/비밀번호 재발급 시크릿 표시 박스 -
사이드바처럼 라이트/다크 구분 없이 항상 어두운 "터미널" 톤 유지),
`--color-tcode-hover-bg`(추적코드 칩 hover), `--color-diff-add-bg`/
`--color-diff-del-bg`(diff 카드), `--color-danger-zone-bg`(프로젝트
삭제 "제한구역"), `--color-danger-bg`/`--color-purple-bg`/
`--color-purple-text`(Q&A kind/decision 배지), `--color-info-bg`/
`--color-info-border`/`--color-primary-muted`(문서 일괄 작업 바 -
1단계에서 이미 추가).

작업량이 많아 4개 배치로 나눠 진행하며 매 배치 `vue-tsc -b` 통과를
확인하고 커밋했다(인증 화면+공용 컴포넌트+다이얼로그 → API 키/관리자
매니저 → 설정/QA/코멘트 → 칸반/소스브라우저/git/변경추적/DocType
관리). 마지막에 저장소 전체를 `#[0-9a-fA-F]{3,6}` 정규식으로
grep해 남은 하드코딩 hex가 전부 의도된 것(항상 색이 있는 배경 위의
`color: #fff` 흰 글자, `App.vue` 자신의 토큰 선언)뿐인지 확인 -
46개 `.vue` 파일 전체가 이제 테마 토큰을 쓴다.

**실측 검증**: 매 배치 `npx vue-tsc -b` 클린 확인 후 커밋. 전체 완료
후 `docker compose build backend` → `up -d --force-recreate backend`
→ 브라우저로 로그인 후 dark 모드로 전환, 1단계에서 안 건드렸던
화면들(칸반 보드, 프로젝트 목록, 소스 브라우저)을 스크린샷으로
대조 - 칸반 컬럼/카드/배지, 문서 목록 카드, 폴더 트리 전부 다크
팔레트로 정확히 바뀌는 것 확인. 콘솔에는 이 프로젝트에 git 저장소가
연결 안 돼 있어 나는 기존 404 하나만 있고 새로 발생한 에러 없음.

**PLANS.md 정리**: 26번(`#responsive-dark-mode` 1단계)과 34번
(`#responsive-dark-mode-phase2`) 둘 다 ✅ 처리. §13 본문 절은
이 두 항목이 전부 끝나 남는 내용이 없어 헤더째 삭제(기존 관례와
동일). 칸반 보드의 터치 드래그 지원(모바일에서 카드를 실제로
옮기는 것)은 색상/반응형 문제가 아니라 DnD 구현 자체를 새로 붙여야
하는 별개 과제라 처음부터 이 두 항목 범위 밖이었음 - 35번 행
(`#kanban-touch-dnd`)으로 새로 추적.

## 칸반 보드 터치 드래그 지원(`#kanban-touch-dnd`) - 완료 (2026-09-12)

**배경**: `KanbanBoardView.vue`의 분류(컬럼) 재정렬과 카드 이동/
재정렬이 순수 HTML5 드래그(`draggable`/`dragstart`/`dragover`/
`drop`)로만 구현돼 있어 터치 기기에서는 드래그 자체가 발동하지
않았다. 이 저장소엔 지금까지 서드파티 UI 라이브러리가 전혀 없었지만
(전부 손으로 짠 컴포넌트), 터치/마우스/자동 스크롤을 전부 직접
구현하는 부담을 고려해 설계자가 **검증된 라이브러리 도입**을
선택했다(`vuedraggable@^4.1.0`, SortableJS의 Vue 3 래퍼).

**데이터 구조 변경**: 기존엔 `columns`/`cards` 평면 배열에서
`visibleColumns`(computed)/`cardsFor(columnId)`(순수 함수)로 매번
필터링해 읽기 전용 뷰를 만들었다. `vuedraggable`은 `v-model`로 직접
mutate 가능한 배열이 필요하므로, `load()` 성공 시 `rebuildLocalOrder()`
가 `orderedColumns`/`cardsByColumn`(컬럼별 로컬 배열)을 다시 만든다.
`hiddenColumns`/`hiddenCardsFor()`는 드래그 대상이 아니라 그대로
원본을 읽는다.

**드래그 완료 처리**: 기존 `onColumnDragStart`/`onColumnDrop`/
`onCardDragStart`/`onCardDrop`(HTML5 dragstart/drop 핸들러)을 전부
제거하고, `vuedraggable`의 `@change` 이벤트 핸들러 `onColumnsChanged`/
`onCardsChanged`로 대체 - **기존 백엔드 API(`PUT .../columns/order`,
`PUT /kanban/cards/:code/move`)는 그대로 재사용**(새 라우트 없음).
두 핸들러 모두 성공/실패 관계없이 `finally`에서 무조건 `load()`를
호출해 서버 상태로 재동기화한다 - SortableJS는 드롭 즉시 배열을
물리적으로 mutate하므로(옛 HTML5 방식은 실패 시 아무것도 안 움직인
상태라 되돌릴 게 없었음), API 실패 시 낙관적 이동을 되돌리는 유일한
방법이 재조회이기 때문이다.

**`force-fallback: true`를 켠 이유**: 처음엔 네이티브 HTML5 드래그로
동작을 확인하려 했으나, 이 드래그는 진짜 OS 레벨 포인터 이벤트가
필요해 브라우저 자동화 도구(Claude Browser pane)의 합성 마우스
이벤트로는 전혀 트리거되지 않았다(이 세션에서 전에 겪은 "모바일
햄버거 버튼 클릭이 안 먹힘" 문제와 같은 종류의 자동화 도구 한계).
SortableJS의 `forceFallback` 모드는 네이티브 드래그 대신 라이브러리
자체 포인터 이벤트 기반 드래그를 쓰므로, 자동화로도 검증 가능해졌고
- 부수적으로 - 브라우저마다 다른 네이티브 드래그 고스트 렌더링
차이 없이 `ghost-class`(`.drag-ghost`) 스타일이 항상 일관되게
적용되는 이점도 있다(테스트 편의만을 위한 타협이 아니라 그 자체로
정당한 선택). 검증 중 SortableJS 소스(`node_modules/sortablejs/
Sortable.js`)를 직접 확인해, fallback 드래그 종료(`_onDrop`)가
`pointerup`이 아니라 `mouseup`/`touchend`에 바인딩된다는 것도 확인
- 합성 이벤트로 왕복 검증할 때 이 차이 때문에 처음엔 드래그가 끝나지
않고 멈춰 있었다.

**추가로 발견/처리한 이슈 2건**(설계자가 실시간 검증 중 지적):
1. 드래그 중 카드/컬럼 텍스트가 함께 선택되는 현상 - `.board`에
   `user-select: none`을 걸어 하위(컬럼/카드) 전체에 상속시켜 해결
   (새 카드 입력폼의 `input`/`textarea`는 `user-select: text`로
   개별 복원).
2. 보드의 빈 배경을 드래그해 좌우로 스크롤하는 기능(마우스 전용 -
   터치는 브라우저 기본 스크롤이 이미 처리) - `.board`를 스크롤
   컨테이너(래퍼)로, `<draggable>`은 그 안의 순수 flex row
   (`.board-columns`)로 분리하고, 래퍼에 자체 `pointerdown`/
   `pointermove`/`pointerup` 핸들러를 달아 `e.target === 래퍼
   자신`일 때만(컬럼/카드에서 시작된 이벤트는 무시) `scrollLeft`를
   직접 갱신한다.

**카드 다이얼로그에 분류 변경 드롭다운 추가**(설계자 요청): 좁은
화면에서 드래그 없이도 카드를 다른 분류로 옮길 수 있도록
`KanbanCardDialog.vue`에 `<select>`를 추가. 이 다이얼로그는
`AppLayout.vue`에서 `<main class="content"><slot/></main>`의
형제로 전역 마운트돼 있어 `ProjectShellView`가 `provide`하는
`PROJECT_MY_ROLE_KEY`를 inject로 받을 수 없다 - 카드 로드 후
`GET /projects/:id`(myRole)와 `GET /projects/:id/kanban/columns`를
별도로 호출해 자체적으로 권한/분류 목록을 구한다. 변경은 기존
`PUT /kanban/cards/:code/move` 재사용(새 API 없음).

**칸반 보드가 뷰포트 남은 높이를 채우도록 셸 레이아웃 조정**
(설계자 요청): 이전엔 `.layout`이 `min-height: 100vh`라 콘텐츠가
길면 브라우저 전체가 세로 스크롤됐고, 칸반 보드의 가로 스크롤바는
컬럼 내용 바로 아래(화면 중간 어딘가)에 표시됐다. `AppLayout.vue`의
`.layout`을 `height: 100vh`로, `.content`를 `display:flex;
flex-direction:column; overflow-y:auto`로 바꿔 셸 자체가 뷰포트
높이를 고정으로 채우고 `.content`가 자기 영역 안에서 스크롤하도록
했다. `ProjectShellView.vue`는 `<router-view/>`를 `.tab-content`
(`flex:1; min-height:0`)로 감싸 탭 콘텐츠 영역이 남은 높이를
받도록 했고, `KanbanBoardView.vue`는 전체를 `.kanban-view`
(`flex:1; min-height:0`) 하나로 감싸 `.board`가 `flex:1`로 남은
높이를 채우게 했다(`.column`은 `max-height:100%` + 내부
`.card-list`가 `flex:1; overflow-y:auto`로 카드가 많은 컬럼은
컬럼 자체가 아니라 카드 목록만 세로 스크롤). 다른 탭(문서/메시지
등)은 `.tab-content`에 `overflow`를 강제하지 않아(그 화면 자체가
flex:1을 안 쓰면 그냥 자연스럽게 넘쳐 `.content`가 스크롤) 회귀
없이 동일하게 동작한다 - Kanban만 명시적으로 "남은 높이를 다 쓰고
그 안에서 스스로 스크롤"하도록 옵트인한 구조.

**실측 검증**: `npx vue-tsc -b` 클린 → `docker compose build backend`
→ `up -d --force-recreate backend` → 브라우저(Claude_Browser MCP)로
기존 QA 프로젝트(`migrate-idempotent-verify`)에 테스트 카드 2개
생성 후: (1) 같은 컬럼 안에서 카드 순서 변경 → 새로고침 후에도 순서
유지 확인, (2) 카드를 다른 컬럼으로 드래그 이동 → `columnId`가 실제
바뀌어 저장됨을 API로 확인, (3) 컬럼 자체를 드래그해 순서 변경 →
새로고침 후에도 유지, (4) 카드 클릭 시 다이얼로그가 정상적으로
열리는지(드래그 라이브러리가 일반 클릭을 가로채지 않는지), (5) 카드의
"숨기기" 버튼이 `filter="button"`으로 드래그 시작 대상에서 제외돼
평범한 클릭으로 여전히 동작하는지, (6) 새 분류 드롭다운으로 카드를
이동하면 다이얼로그를 닫았을 때 보드에 즉시 반영되는지, (7) 드래그
중 `window.getSelection().toString()`이 빈 문자열인지(텍스트 선택 안
됨), (8) 보드 빈 배경을 드래그하면 `scrollLeft`가 실제로 바뀌는지,
(9) 존재하지 않는 분류로 이동을 직접 호출해 400 오류를 확인(실패
시 `finally`의 `load()`가 재동기화하는 경로), (10) 모바일 폭
(375px)에서 햄버거 메뉴/사이드바/탭 바 가로 스크롤/카드 탭-오픈이
모두 정상 동작하고 칸반 보드 영역이 뷰포트 남은 높이를 채우는지,
(11) 다크 모드에서 드래그 중 고스트(`.drag-ghost`) placeholder가
표시되는지 - 전부 스크린샷/API 응답으로 확인.

**PLANS.md 정리**: 35번(`#kanban-touch-dnd`) ✅ 처리 - 본문에는 이
항목 하나만 있던 절이 없었으므로(색인 표에만 존재) 별도 절 삭제는
불필요.

## 메시지 3단계 분류(대기/처리중/기록) + 대기 상태 수정 금지(`#message-processing-status`) - 완료 (2026-09-12)

**배경**: 설계자 직접 지시(백로그 아님) - 메시지 분류에 "대기"/"기록"
외에 "처리중"을 추가하고, 대기열(대기 상태)에 올라온 메시지는 수정을
막고 삭제만 되게 해달라는 요청. "처리중"이 정확히 무엇을 의미하는지
(단순 조회로 전이되는지, 명시적 액션이 필요한지)는 설계자에게 직접
확인 - **"AI가 명시적으로 ack해야 처리중으로, 그 후 다시 명시적으로
완료해야 기록으로"** 를 선택(질문(Question)의 ack 패턴과 유사, 기존
`deliveredAt`이 "그냥 읽으면 자동으로 넘어가는" 방식이었던 것과는
분리).

**설계**: `Message`에 `ackedAt`/`completedAt` 두 필드 추가(3개 provider
스키마 전부). 상태 판정은 이 두 필드만으로: `ackedAt` 없음=대기,
`ackedAt` 있고 `completedAt` 없음=처리중, `completedAt` 있음=기록.
기존 `deliveredAt`("AI가 CLI/MCP로 실제 읽어감")은 그대로 두되 이
분류와는 완전히 별개 축으로 남긴다 - `message_wait`/`message_list`로
그냥 읽기만 해서는 상태가 안 바뀌고, 오직 새 `ackMessage`/
`completeMessage`(코어) → `PUT /api/messages/:id/ack`·`.../complete`
→ CLI `message ack|complete <id>`/MCP `message_ack`/`message_complete`
경로로만 넘어간다. 이 두 액션은 `editMessage`/`deleteMessage`와
다르게 **소유권이 아니라 프로젝트 멤버십만 확인**한다("누가 보냈나"가
아니라 "누가 처리했나"를 기록하는 축이라 다른 설계자가 보낸 메시지도
ack/complete 가능해야 함). `completeMessage`는 ack 없이 바로 불러도
`ackedAt`을 같이 채워 자동 승격시키고, 둘 다 이미 그 상태거나 그
이후 상태면 에러 없이 그대로 반환(idempotent). `editMessage`에
`existing.ackedAt`이 없으면 거부하는 가드 한 줄 추가 - "삭제만 가능"
요구사항은 `deleteMessage`가 원래도 상태와 무관하게 항상 허용하므로
별도 처리 불필요.

**웹 UI**(`MessagesView.vue`): 탭이 대기/처리중/기록 3개로. 대기 탭엔
"처리 시작" 버튼만(수정 버튼 자체를 안 보여줌 - `m.ackedAt`이 없으면
`startEdit`도 방어적으로 조기 반환), 처리중 탭엔 "완료"+수정+삭제,
기록 탭엔 수정+삭제만.

**CLI/MCP**: `message ack`/`message complete`(및 `message_ack`/
`message_complete`)를 쌍으로 추가 - `npm run audit:cli-mcp`로 대칭성
확인. 두 SKILL.md(이 저장소용/배포용)의 메시지 명령 표에도 반영.

**실측 검증**: `npx tsc --noEmit`/`vue-tsc -b` 클린, `audit:cli-mcp`
클린, `docker compose build` → `up --force-recreate` 후 postgres 스키마
푸시(`ackedAt`/`completedAt` 컬럼 생성) 확인. 브라우저로 메시지 전송 →
대기 탭에 "처리 시작"만 있고 수정 버튼 없음 확인 → 처리 시작 클릭 →
처리중 탭으로 이동, 수정 폼이 정상적으로 열리는지 확인(취소) → 완료
클릭 → 기록 탭으로 이동 확인. 별도로 REST 직접 호출로 새 메시지를
만들어 곧바로 `PUT .../ack` 없이 `PUT .../edit` 시도 → 400 +
"대기 중인 메시지는 수정할 수 없습니다 - 삭제만 가능합니다" 확인
(테스트 메시지는 이후 삭제로 정리).

**PLANS.md**: 새 행(`#message-processing-status`) 추가 + 즉시 ✅
(직접 지시라 `#doctype-status-auto-seed` 전례와 동일).

## 문서 탭 폴더+문서 통합 트리 뷰(`#document-folder-tree`) - 완료 (2026-09-12)

**배경**: 승인된 계획대로 시작했으나(문서 탭 좌우 분할 → 통합 트리,
드래그 폴더 이동, 문서 클릭 시 읽기 페이지 이동, 문서 페이지 "폴더"
버튼+순수 폴더 트리 다이얼로그), 구현 후 실제 화면을 보며 설계자가
연속으로 방향을 조정했다 - 최종 구현은 최초 승인안과 아래 지점에서
달라졌다.

**최초 계획대로 구현된 부분**:
- `backend/src/core/folders.ts`에 `moveFolder(folderId, userId,
  parentFolderId, siblingOrder)` + `isDescendantOf()`(순환 방지, 옮기려는
  새 부모가 자기 하위 트리에 있으면 거부) 신설. `PUT /api/folders/:id`
  가 `name`뿐 아니라 `parentFolderId`+`siblingOrder`도 받도록 확장(칸반
  컬럼 순서 변경과 동일 패턴 - 이동 후 그 부모 밑 형제 전체의 순서
  배열을 받아 그대로 `order`에 반영, 이 사용자 소유가 아닌 id는 조용히
  걸러냄). 인접 형제 맞바꾸기용 구 `reorderFolder()`/`POST
  /api/folders/:id/reorder`는 완전히 대체돼 삭제.
- `frontend/src/utils/folderTree.ts`(평평한 목록→중첩 트리 조립,
  깊이 제한 없음 - 구 `FolderTree.vue`가 템플릿에서 2단계까지만 그려
  손자 폴더가 안 보이던 버그를 근본적으로 없앰), `FolderNode.vue`
  (재귀 컴포넌트 - 이름변경/하위생성/삭제(재귀·끌어올리기 선택)/
  드래그), `FolderPickerDialog.vue`+`stores/folderPicker.ts`(순수
  읽기전용 폴더 트리 선택 다이얼로그, entityPicker.ts와 같은 Promise
  패턴) 전부 계획대로 신설. `DocumentEditorView.vue`의 "코멘트" 버튼
  왼쪽에 "폴더" 버튼 추가.
- 드래그는 `#kanban-touch-dnd`와 동일하게 `vuedraggable`
  `force-fallback` 모드 재사용(자동화 도구로 검증 가능 + 고스트 스타일
  일관성이라는 같은 이유).

**실측 중 발견해 즉석에서 고친 문제**: 순수 폼 상태에서 손자 폴더까지
만들어 실제로 재귀 렌더링이 전체 깊이로 동작하는지 확인하던 중, 동일
드래그 시퀀스를 간격 없이 연속으로 여러 번 자동화 테스트했더니 관련
없는 두 문서/폴더가 전혀 의도치 않은 곳으로 옮겨진 것처럼 보이는
현상을 발견 - 정밀하게 격리해 재현한 결과 **버그가 아니라 이 QA
프로젝트에 동명 문서·폴더가 여러 개 있어(이전 라운드들의 테스트
데이터) 화면상 헷갈린 것**으로 확인(trackingCode로 대조해 실제로는
의도한 문서 하나만 정확히 옮겨졌음을 확인). 코드 변경 없음 - 조사
과정 자체를 남겨 다음에 비슷한 혼란이 생기면 "먼저 trackingCode로
대조"부터 하도록 기록.

**설계자 실시간 피드백으로 최초 계획에서 바뀐 부분**:
1. **"전체 문서"(검색/문서유형 필터/일괄 상태 전이/일괄 폴더 이동/
   페이지네이션 목록) 섹션을 트리 위에서 완전히 뺐다** - 원래 계획은
   "트리 위에 고정 노드로 유지"였으나, 실제로 만들어놓고 보니 불필요
   하다고 판단해 제거 요청. `DocumentsView.vue`의 `selectedCodes`/
   `bulkTargetStatus`/`applyBulkTransition`/`applyBulkFolderMove`/
   체크박스/목록/페이지네이션 전부 삭제 - 이제 문서 탭은 생성 폼 +
   트리 뿐. 일괄 상태 전이/일괄 폴더 이동 REST 엔드포인트(`PUT
   /api/documents/bulk-transition`·`bulk-folder`) 자체는 남아있다(CLI는
   여전히 bulk-transition을 씀, bulk-folder는 이제 웹 UI 트리거가
   없어졌지만 엔드포인트는 유지 - 직접 호출 대비, 죽은 코드로 보진
   않음).
2. **"전체 문서" 대신 "최상위 폴더"(이후 "(미분류 문서)"로 재명명)라는
   가상 노드를 폴더 트리 안에 통합** - 어느 폴더에도 없는 문서만
   보여준다(전체가 아님). 새 백엔드 함수
   `listUnfiledDocuments(projectId, userId)`(`Document.folderEntries`에
   그 사용자 몫 항목이 하나도 없는 문서 - `folderEntries: { none:
   { userId } }`) + `GET /projects/:id/documents/unfiled` 신설. 처음엔
   이 가상 노드를 실제 폴더 목록과 시각적으로 분리된 별도 섹션("전체
   문서"처럼)으로 뒀다가, "폴더 트리랑 통합해야" 라는 피드백을 받아
   `DocumentTree.vue`에서 그냥 진짜 폴더들과 같은 `<ul>` 스타일의
   첫 항목으로 배치(구분선/별도 제목 없이 하나의 목록처럼 보이게).
3. **문서 유형(문서 코드) 필터 콤보 박스 부활, "+ 새 폴더" 버튼
   왼쪽에 배치** - 옛 "전체 문서" 목록에 있던 필터를 없앴다가, 이후
   "이전처럼 필요하다"는 요청으로 트리 툴바에 다시 넣음. `docType`별로
   트리 전체(미분류 문서 포함)에서 문서 행을 걸러 보여준다. **필터는
   `v-model` 배열 자체를 거르지 않고 각 행에 `v-show`만 적용** -
   vuedraggable의 v-model 배열을 거르면 화면 인덱스와 실제 배열
   인덱스가 어긋나 드래그 계산이 깨지기 때문(배열은 그대로 두고
   시각적으로만 숨김).
4. **문서도 드래그로 폴더를 바꿀 수 있게** - 최초 계획은 "드래그는
   폴더만, 문서는 다이얼로그로만"이었으나, 실제로 써보고 "문서도
   드래그하자"는 요청으로 뒤집힘. 모든 폴더(가상 미분류 노드 포함)의
   문서 목록을 `group="tree-documents"`로 공유하는 `<draggable>`로
   전환 - 같은 목록 안 재정렬(`moved`)은 `DocumentFolderEntry`에
   순서 개념이 없어 그냥 무시, 다른 목록으로 이동(`added`)만 반응해
   `PUT /documents/:code/folder`를 부른다. 폴더 드래그와 달리 **문서
   드래그는 성공해도 실패해도 전부 반응형 로컬 배열에 낙관적으로
   반영된 상태를 그대로 신뢰하지 않고, 실패 시에만** 지금까지 한 번
   이상 펼쳐서 불러온 모든 폴더(+미분류 노드)의 문서 목록을 다시
   불러와 되돌린다(`onDocMoveFailed` - 어느 폴더가 실패했는지 정확히
   추적하기보다 "이미 로드된 것 전부 재조회"가 더 간단하고 안전).
5. **문서가 없어도 하위 폴더가 있으면 "문서 없음" 문구를 안 보여줌**
   (`node.children.length === 0`도 조건에 추가) - 하위 폴더만 있고
   문서는 없는 흔한 케이스에서 불필요한 문구가 거슬린다는 피드백.
6. **트리 드래그 중 텍스트가 같이 선택되는 문제 수정** -
   `#kanban-touch-dnd`에서 이미 겪은 것과 같은 원인(포인터 기반
   폴백 드래그는 브라우저의 기본 텍스트 선택 동작을 자동으로 막아주지
   않음). `DocumentTree.vue`의 `.doc-tree`에 `user-select: none`을
   걸어 하위(FolderNode.vue 포함) 전체에 상속시키고, 폴더 생성/이름
   변경용 `<input>`에는 `user-select: text`로 개별 복원.

**드래그 완료 처리 철학이 칸반과 다른 이유**(문서화 목적으로 남김):
폴더/문서 트리는 **설계자 개인 소유**라 동시 편집 충돌 가능성이
낮다 - 그래서 칸반(`#kanban-touch-dnd`, 공유 보드라 매번 서버 상태로
재동기화)과 달리, **폴더 이동은 성공 시 재조회를 아예 안 하고(이미
로컬에 반영된 걸 신뢰), 문서 이동은 성공 시엔 마찬가지로 안 하되
실패 시에만 이미 로드된 목록들을 다시 불러온다** - 매번 재조회하면
펼쳐 둔 폴더/이미 불러온 문서 캐시가 자꾸 날아가 사용성이 나빠지기
때문.

**PLANS.md**: 새 행(`#document-folder-tree`) 추가 + 즉시 ✅(직접
지시).

## 전체 기능 회귀 QA 순회 + 닉네임 CLI/MCP 누락 발견·수정 - 완료 (2026-09-12)

**배경**: 설계자 지시 - FEATURES.md의 전체 기능 목록(21개 절)을
하나씩 훑으며 회귀 QA를 한 번 더 돌아달라는 요청. 백로그 항목이
아니라 시스템 전체 건강도 점검.

**방법**: 새 스크래치 프로젝트 하나(`QA-Regression-*`)를 여러 절에
걸쳐 재사용 - CLI(`docs`)로 최대한 실제 HTTP 왕복(Docker 스택 -
Postgres/Meilisearch/EMQX/Gitea 전부 살아있는 상태)을 태우고, CLI에
없는 동작(코멘트 - 완전성 원칙의 의도적 예외)만 REST 직접 호출,
UI 전용 동작(권한별 버튼 숨김, 다크모드 토글)만 브라우저로 확인.
push 훅(§14)은 실제로 로컬 Gitea 저장소를 clone해 `release/1.0`과
`main` 두 브랜치에 각각 push해서 - 매칭되는 브랜치만 대기열에
실제로 쌓이고 안 매칭되는 브랜치는 안 쌓이는지 - 실제 웹훅 왕복으로
확인(이 항목은 QA-SCENARIOS.md에 "문서 형식의 실측 왕복은 안 함"으로
남아있던 항목이라 겸사겸사 정식으로 채움).

**결과**: 21개 절 전부 재확인 완료, 회귀 없음. 확인한 것: §1(가입/
로그인/닉네임 자동 번호매김·7일 쿨다운/admin 대행 재설정/Gitea 계정
자동 생성), §2(API 키 생성(TTL)/목록/배제), §3(팀·그룹 CRUD/그룹
재소속/프로젝트 hidden 토글), §4(access-overview/오버라이드 - owner
자신 대상은 코드로 재확인), §5(기본 6종 DocType/커스텀 타입 생성 시
표준 상태 자동 시딩), §6(문서 생성/상태 전이/draft 재진입 차단/
우선순위/리비전), §7(폴더 트리 - 지난 라운드에서 이미 충분히 실측,
이번엔 viewer 권한만 재확인), §8(질의 open→pending→resolved,
notices), §9(코멘트 생성/조회/삭제), §10(칸반 기본 컬럼/카드 생성),
§11(메시지 전송/deliveredAt과 ackedAt·completedAt이 독립 축인 것),
§12(Meilisearch 검색), §13(Gitea 저장소 연결/커밋/로그/show/tree),
§14(push 훅 실제 웹훅 왕복), §15(Gitea 계정 3명 각각 자동 생성,
이름 충돌 시 접미사), §16(템플릿 override + 리비전), §17(마이그레이션
scan/apply/재실행 멱등성), §18(프로젝트 삭제 + 연결된 Gitea 저장소
cascade 삭제), §19(권한별 버튼 숨김 - 문서 생성폼/칸반 분류·카드
생성 버튼이 viewer에게 실제로 안 보임, 라이트/다크/시스템 테마 전환),
§20(`audit:cli-mcp` - 아래 수정 전후 둘 다 green), §21(Docker 스택
전체 가동 확인).

**발견·수정한 문제 1건**: `PUT /api/auth/me`(닉네임 변경 포함)는
이미 오래전부터 지원했고 웹 UI(`UserProfileView.vue`)도 닉네임
입력 필드가 있는데, **CLI `profile set`과 MCP `profile_set` 둘 다
`--nickname`/`nickname` 파라미터 자체가 없어서 AI가 자기 닉네임을
설정할 방법이 없었다** - email/phone은 되는데 닉네임만 빠진
비대칭(완전성 원칙 위반, `audit:cli-mcp`는 CLI/MCP 서로만 비교하므로
이런 "둘 다 똑같이 빠진" 케이스는 못 잡아낸다 - 이번처럼 실제
기능 목록을 훑는 수동 QA에서만 드러남). CLI에 `--nickname <n>`,
MCP에 `nickname: z.string().optional()` 추가(백엔드 라우트 자체는
변경 없음 - 원래도 받던 필드). 두 SKILL.md의 `profile set` 사용법
문단에도 반영. 실측: CLI로 닉네임 설정 → `displayLabel`에 반영
확인, 같은 닉네임으로 다른 계정 설정 → `#2` 자동 번호 확인, 7일
쿨다운 중 다른 값 시도 → 거부, 같은 값 재저장 → 허용 - 전부 실측.

**정리**: 테스트에 쓴 스크래치 프로젝트/팀/그룹/로컬 임시 파일 전부
삭제(연결된 Gitea 저장소도 cascade로 같이 삭제됨을 확인). 회귀 테스트용으로
등록한 `qauser1`/`qauser2` 두 계정은 삭제 기능 자체가 없어(설계상
사용자 삭제는 지원 안 함) 남아있음 - 실습 계정으로 낮은 위험.

**QA-SCENARIOS.md**: 12절(push 훅 자동화)의 미실측 항목("실제 Gitea
웹훅 왕복 테스트... 우선 재개 후보")을 실측 완료로 갱신.

## 문서 읽기 페이지 - 다른 문서로 이동해도 내용이 안 바뀌는 버그 수정 - 완료 (2026-09-12)

**배경**: 설계자 리포트 - "좌측 패널에서 다른 문서를 눌러도 페이지가
이동되지 않는다." 브라우저로 재현: 사이드바에서 문서 A를 연 뒤 문서
B를 클릭하면, URL은 정확히 `/documents/B`로 바뀌고 사이드바 강조
표시도 B로 옮겨가는데 **화면 본문은 A의 내용이 그대로 남아있음**.

**원인**: `/projects/:id/documents/:trackingCode`는 하나의 라우트
레코드라, 그 안에서 `trackingCode`만 바뀌는 이동은 Vue Router가
컴포넌트 인스턴스를 재사용한다(언마운트·재마운트 없음) - 그런데
`DocumentEditorView.vue`는 `onMounted(load)`만 있고 `trackingCode`
prop을 `watch`하는 코드가 전혀 없어서, 두 번째 문서로 이동해도
`load()`가 다시 안 불린 채 첫 번째 문서의 데이터만 화면에 남는다.
같은 패턴을 쓰는 다른 화면(`UserProfileView.vue`)은 이미
`watch(() => props.id, load)`가 있어 문제 없음 - `DocumentEditorView.vue`
하나만 빠져있던 버그.

**수정**: `watch(() => props.trackingCode, ...)` 추가 - `load()`를
다시 부르는 것과 함께, 이전 문서에 걸려있던 임시 UI 상태(편집 모드,
상태 전이 선택값/에러, 우선순위 에러, 소스 연결 에러/입력값, 삭제
에러, 저장 메시지, 메시지로 지시 폼 - 열림 여부/초안/에러/전송완료
표시, 질의응답 탭 활성화 여부)가 새 문서로 새어 들어가지 않도록 같이
초기화한다(안 그러면 예를 들어 문서 A를 편집 모드로 열어둔 채 문서
B로 넘어가면 B도 편집 모드로 뜨는 등 2차 문제가 남는다).

**연관 조사**: 같은 "같은 라우트, 파라미터만 바뀌는 이동"에 취약한
다른 화면이 있는지 확인 - `SourceBrowserView.vue`는 파일 클릭이
`router.push` 없이 순수 로컬 상태(`openFile()`)로만 처리돼 이 버그
계열과 무관(단, 이미 소스 브라우저를 열어둔 상태에서 *다른* 문서의
"연관된 소스 코드" 링크를 통해 `?path=` 쿼리만 바뀌는 `router.push`가
들어오는 아주 좁은 경우는 이론상 같은 함정이 남아있음 - 흔한
경로가 아니라 이번 수정 범위에는 안 넣음).

**실측 검증**: `npx vue-tsc -b` 클린 → `docker compose build` →
`up -d --force-recreate` → 브라우저로 사이드바에서 문서 A → B → C로
연속 이동하며 각 문서의 실제 본문/상태/우선순위가 정확히 바뀌는지
확인, 문서 A를 편집 모드로 연 뒤(저장 안 함) 문서 B로 이동 → B는
정상적으로 "보기" 모드로 뜨는지, 다시 A로 돌아왔을 때 편집하려던
내용이 저장 안 된 채 원래 값 그대로인지 확인, "문서" 탭의 새 트리
뷰에서 문서를 연 뒤 사이드바의 다른 문서를 클릭하는 교차 이동도
정상 동작하는지 확인.

## CLI/MCP 접속 유지 - refresh_token 미사용 발견·수정(`#cli-token-refresh`) - 완료 (2026-09-12)

**배경**: 문서 읽기 페이지 이동 버그를 고친 뒤 이어서 진행한 QA
라운드 중, CLI로 팀/그룹 스코프 템플릿 상속을 실측하려다 admin
세션의 `docs teams` 호출이 "유효하지 않거나 만료된 토큰입니다"로
실패했다 - access 토큰 수명(15분)이 그 사이 지난 것. 이상하게 여겨
`backend/src/cli/apiclient.ts`를 읽어보니, 로그인 시 `refresh_token`을
`credentials.json`에 저장은 해두면서도 **그 값을 실제로 쓰는 코드가
어디에도 없었다** - `apiCall`은 401이 오면 그냥 에러를 던질 뿐, 다시
시도하거나 갱신하는 로직이 전무했다. `docs auth logout`이 서버에
`refresh_token`을 보내 폐기하는 호출 한 곳만 그 필드를 참조했고, 그
외엔 저장만 되고 죽은 값이었다. 반면 웹 프론트(`frontend/src/api/
client.ts`)는 이미 401 → `/api/auth/refresh` → 재시도 흐름이 구현돼
있었다(QA-SCENARIOS.md의 "JWT 자동 갱신" 항목이 지금까지 코드 확인
위주였던 건 바로 이 프론트 쪽 구현을 가리킨 것 - CLI/MCP 쪽은 애초에
같은 확인 대상이 아니었다).

MCP 서버(`backend/src/mcp/server.ts`)는 이 파일의 `apiCall`/
`apiCallText`를 그대로 재사용하므로, CLI와 MCP 둘 다 같은 결함을
안고 있었다 - 15분 넘게 이어지는 세션(마이그레이션 대량 작업, 장시간
대기하는 `message wait` 반복 호출, 이 시스템을 쓰는 AI 에이전트의
평범한 장시간 작업)은 중간에 이유 없이 인증 실패로 끊기고, 사용자가
`docs auth login`을 수동으로 다시 해야 했다.

**수정**: `apiclient.ts`의 `apiFetch()`에 프론트와 동일한 패턴 추가 -
요청이 401로 실패하고 `access_token`+`refresh_token`이 모두 있으며
(`api_key` 로그인이 아닐 때만 - API 키는 TTL 기반의 별개 만료 개념이라
대상에서 제외) `POST /api/auth/refresh`로 갱신에 성공하면, 갱신된
토큰 쌍을 `credentials.json`에 다시 저장하고 원래 요청을 새 토큰으로
한 번 재시도한다. `apiCall`/`apiCallText`는 `apiFetch`를 감싸기만 하므로
변경 없이 그대로 혜택을 받고, 이 파일 하나만 고쳐 CLI/MCP 둘 다 동시에
해결됐다.

**실측 검증**: `npx tsc --noEmit` 클린 → `npm run build`로 CLI 재빌드
→ 테스트 계정으로 로그인 후 저장된 `access_token`을 일부러 훼손(끝
10자를 임의 문자열로 교체 - 실제 만료를 15분 기다리는 대신 즉시
재현)한 채 `docs auth whoami` 실행 → 성공적으로 응답을 받고
`credentials.json`의 `access_token`/`refresh_token`이 둘 다 새 값으로
자동 회전된 것을 확인. 반대로 `access_token`/`refresh_token` 둘 다
훼손한 뒤엔 무한 재시도 없이 깔끔하게 "유효하지 않거나 만료된
토큰입니다" 에러 한 번으로 끝나는지도 확인(폭주 방지). `npm run
audit:cli-mcp` 클린 - CLI/MCP 표면 자체는 안 바뀌었으므로 회귀 없음
확인 차원.

**이어서 진행한 QA(코드 변경 없음)**:
- 팀 스코프 CLAUDE.md override가 그 산하 프로젝트에 실제로 상속되는지
  (`#template-history`/`#doctype-status-auto-seed` 라운드 이후 재검증
  안 됐던 항목, QA-SCENARIOS.md) - 테스트용 팀/그룹/프로젝트를 만들어
  팀 스코프에 override를 걸고 프로젝트 스코프로 조회해 그대로
  상속되는 것을 확인, 이어서 그룹 스코프에 override를 걸어 팀
  스코프보다 우선 적용되는 것도 확인(상속 우선순위: 프로젝트 >
  그룹 > 팀 > 전역, 코드 그대로 재확인) - 문제 없음, 테스트 데이터는
  검증 후 삭제.
- 참고 문서(`--refs`)가 삭제된 뒤에도 그 문서를 참고한 질의/답변이
  안전하게 남아있는지(QA-SCENARIOS.md) - 문서 A를 문서 B의 질의에
  참고 문서로 태그하고 답변까지 단 뒤 문서 A를 삭제 → 질의/답변 본문은
  그대로 남고 `refs` 배열에서만 A의 트래킹 코드가 빠지는 것을 실측
  확인(스키마상 예상된 cascade 방향과 일치) - 문제 없음, 테스트
  데이터는 검증 후 삭제.
- 로그인한 본인이 스스로 비밀번호를 바꾸는 기능이 여전히 없는지
  재확인(QA-SCENARIOS.md) - 백엔드/프론트 전체 grep, 관련 코드
  0건(admin 대행 재설정 경로만 존재) - 여전히 범위 밖.
- 대량 문서 프로젝트에서 목록/검색 응답 속도(QA-SCENARIOS.md, 아래
  별도 라운드로 분리해 기록).

## CLI/MCP 문서 전체 목록이 51건째부터 조용히 빠지던 문제 발견·수정(`#document-list-silent-cap`) - 완료 (2026-09-12)

**배경**: 위 QA 라운드에서 "대량 문서가 있는 프로젝트에서 목록/검색
응답 속도"(QA-SCENARIOS.md, 지금까지 10건 이하 스크래치 데이터로만
검증됐던 항목)를 실측하려고 문서 200건짜리 테스트 프로젝트를 직접
만들어 `GET /projects/:id/documents`(CLI `docs list`/MCP
`document_list`가 쓰는, 페이지네이션 없는 "전체 목록" 라우트)를
호출했더니 응답은 빨랐지만(28ms) **200건 중 50건만 돌아왔다** - 총
개수 필드도 없고 에러도 안 나서, 호출한 쪽은 그 프로젝트에 문서가
50개뿐인 줄 알 수밖에 없었다.

**원인**: `core/documents.ts`의 `listDocuments()` → `listDocumentsFromIndex()`
→ `core/search.ts`의 `searchDocuments()`/`rawSearch()`로 이어지는
호출 체인에서, `rawSearch()`가 `limit: opts.limit ?? 50`으로 기본값을
깔아둔다(Meilisearch 검색 결과 페이지 크기 기본값 - 원래는 실제
검색/미리보기용 함수를 위한 안전한 기본값이었다). `listDocuments()`는
이 `limit`을 전달하지 않고 그대로 호출했으므로, 검색이 아니라
"필터만 적용된 전체 목록"이어야 할 이 함수도 조용히 50건으로
잘렸다. 지난 `#large-list-pagination` 라운드에서 "CLI/MCP가 쓰는
`listDocuments()`는 그대로 둔다"고 명시적으로 결정한 게 바로 이
함수인데, 그 결정 당시엔 이 함수가 이미 암묵적으로 50건 상한에
걸려있다는 걸 아무도 몰랐다(그때 쓰인 테스트 데이터가 전부 10건
이하였기 때문 - 이번에야 처음으로 50건을 넘는 실측 데이터로
검증했다).

**수정**: `listDocuments()`가 `listDocumentsFromIndex({ projectId,
docTypeId, limit: 1000 })`처럼 명시적으로 큰 limit을 넘기도록
변경(1000 = Meilisearch 기본 `maxTotalHits`와 같은 값 - 별도 인덱스
설정 변경 없이 안전하게 쓸 수 있는 상한). 이 함수의 유일한
호출부(`GET /api/projects/:projectId/documents`)만 영향을 받고,
`searchProjectDocuments`(전문검색, 결과가 많을수록 관련도 낮은
결과라 50건 제한이 오히려 합리적)나 `listRecentDocuments`(홈
대시보드, 이미 자기 limit을 명시)는 그대로 - 이 라운드는 "전체
목록" 시맨틱을 가진 지점 하나만 고쳤다. 1000건을 넘는 프로젝트는
여전히 잘릴 수 있지만, 실사용 규모를 훨씬 웃도는 값이라 이번
범위에선 잔여 한계로만 기록한다(진짜 offset 기반 전체 스캔까지
필요해지면 그때 별도 라운드).

**실측 검증**: 문서 200건(그중 1건은 검색용 고유 키워드 포함)짜리
테스트 프로젝트를 실제로 만들어 수정 전엔 `GET /documents`가 50건만
반환하는 것으로 버그를 먼저 재현 → `npx tsc --noEmit`(backend)
클린 → `docker compose build backend` → `up -d --force-recreate` →
같은 테스트를 다시 돌려 200건 전부 반환되는 것 확인,
`/documents/page`/`/search`는 원래도 문제없었던 것 재확인(총
소요/응답 시간 전부 기록). 테스트 프로젝트는 검증 후 삭제.

## 메시지 ack/complete + 질의 ack/answer/withdraw 동시성(경합) QA - 질의 쪽 상태 충돌 버그 발견·수정(`#question-ack-race-fix`) - 완료 (2026-09-12)

**배경**: 설계자 직접 지시 - "CLI/MCP/SKILL에서 메시지를 확인할 때
ack 하는 플로우가 서버를 충돌내는지, 응답을 잘 하는지 QA하라"는
요청에 이어 "'설계자'의 답변을 가져가는 기능(질의 ack)도 마찬가지로
상태 충돌 응답을 잘 처리하는지 QA하라"는 요청이 이어졌다. 실제
Docker 백엔드에 동시 요청(Promise.all)을 쏘는 스크립트로 두 영역을
각각 검증했다.

**메시지 ack/complete(`ackMessage`/`completeMessage`)**: 같은
메시지에 ack 10개 동시 호출, complete 10개 동시 호출, ack+complete
혼합 10개 동시 호출, `markDelivered=true` 목록 조회와 ack를 동시
반복, 존재하지 않는 id로 ack/complete - **전부 문제없이 200 또는
깔끔한 도메인 에러로 응답, 서버 크래시 없음**(컨테이너 계속
`Up`, 로그에 스택 트레이스 없음). 이 두 함수는 "이미 처리됐으면
그대로 반환"(idempotent) 설계라 동시 호출이 와도 값을 덮어쓸
뿐이라 안전했다.

**질의 ack/answer/withdraw - 실제 버그 발견**: 같은 방식으로 질의
쪽(`answerQuestion`/`acknowledgeQuestion`/`withdrawQuestion`)을
테스트하니 두 가지 문제가 실제로 재현됐다:
1. **데이터 손상**: 같은 open 질의에 `withdraw`와 `answer`를 동시에
   보내면 **둘 다 200으로 성공 응답**했다 - 그런데 최종 상태를
   확인해보니 `withdrawn`이 아니라 `pending`이었다. 두 함수 모두
   `findUnique`로 상태를 읽고 그 값이 `"open"`이면 통과시킨 뒤
   별도의 `update`로 다시 쓰는 구조라, 두 요청이 모두 읽기 시점엔
   `"open"`을 보고 통과한 다음 서로 다른 값으로 마지막에 쓴
   쪽이 이겼다(answer가 나중에 커밋되면 방금 성공했다고 응답한
   withdraw의 결과가 조용히 사라짐). 호출자 둘 다 "성공"으로 알고
   있는데 실제 DB는 그중 하나만 반영한 상태 - 전형적인
   TOCTOU(check-then-act) 경합.
2. **내부 에러 노출**: 같은 open 질의에 `answer`를 두 번 동시에
   보내면 첫 번째는 성공하고 두 번째는 원래 "이미 답변됐거나
   처리된 질문입니다"라는 안내 메시지가 나와야 하는데, 실제로는
   `Answer.questionId` 유니크 제약을 그대로 건드려 Prisma 원본
   예외 메시지("Invalid `prisma.answer.create()` invocation: ...
   Unique constraint failed...")가 그대로 노출됐다(500은 아니고
   전역 에러 핸들러가 400으로는 막았지만, 내부 구현이 드러나는
   문제). 원인은 코드 순서 - `answer.create()`를 먼저 하고
   `question.status`를 나중에 "pending"으로 옮기고 있어서, 맨 위의
   "`status !== "open"`이면 막는다"는 가드가 동시 호출 사이의
   좁은 창(findUnique 이후 ~ update 이전)을 막지 못했다.

**수정**: 세 함수(`answerQuestion`/`acknowledgeQuestion`/
`withdrawQuestion`) 전부 "먼저 findUnique로 읽고 나중에 update"
패턴을, `db.question.updateMany({ where: { id, status: <기대값> },
data: { status: <다음값> } })` 한 번으로 대체 - 이 한 번의 쿼리
자체가 원자적 조건부 잠금 역할을 한다(WHERE 절에 기대하는 이전
상태를 넣어 DB가 그 조건을 만족하는 행에만 갱신을 적용하고,
`count`로 실제 몇 건이 바뀌었는지 돌려준다). `count === 0`이면
"이미 다른 요청이 먼저 상태를 옮겼다"는 뜻이므로 기존과 같은
문구의 도메인 에러를 던진다 - 두 동시 요청 중 정확히 하나만
`count === 1`을 받아 성공하고, 나머지는 이 시점에서 깔끔하게
막히므로 `answerQuestion`의 경우 `answer.create()`(유니크 제약을
건드리는 지점) 자체를 조건부 갱신이 실패하면 아예 실행하지 않도록
순서도 바꿨다(상태 전이 성공 → 그다음에 Answer 행 생성). 갱신
후 필요한 "새 상태가 반영된 Question 객체"는 별도 재조회 없이
이미 들고 있던 값에 바뀐 필드만 덮어써 구성한다(불필요한 DB
왕복 추가 안 함).

**실측 검증**: 수정 전 버그 재현(위 두 시나리오 그대로 실패 확인)
→ `npx tsc --noEmit` 클린 → `docker compose build backend` →
`up -d --force-recreate` → 같은 동시성 테스트를 다시 돌려 (1)
withdraw+answer 동시 시도 시 하나만 성공하고 최종 상태가 정확히
`withdrawn`으로 남는지, (2) answer 두 번 동시 시도 시 두 번째가
Prisma 원본 메시지 대신 기존 도메인 에러 문구를 받는지, (3) 기존에
이미 잘 동작하던 시나리오(질의 ack 10회 동시 호출, bulk-ack에 같은
코드 중복 포함)가 회귀 없이 그대로 동작하는지 확인. `npm run
audit:cli-mcp` 클린(CLI/MCP 표면 자체는 안 바뀜). 컨테이너는 테스트
내내 재시작 없이 `Up` 상태 유지, 로그에 처리되지 않은 예외
스택트레이스 없음.

## CLI/MCP 목록 명령 전체에 --page/--count(page/pageSize) 페이지네이션 옵션 추가(`#list-pagination-options`) - 완료 (2026-09-13)

**배경**: `#document-list-silent-cap` 라운드에서 `docs list`(문서
전체 목록)의 51건째부터 조용히 잘리던 버그를 `limit: 1000`으로만
막아뒀는데, 설계자가 곧바로 "`docs list`는 페이지와 카운트를 옵션으로
줄 수 있어야 한다"고 지시했고, 이어서 "CLI나 MCP, SKILL용으로 준비된
모든 '리스트'를 반환하는 명령들 전부" 페이지/카운트 옵션을 지원해야
한다고 범위를 명시적으로 넓혔다. 규모가 커서(약 29개 명령) Plan
Mode로 설계를 먼저 정리하고 승인받은 뒤 진행했다.

**조사**: CLI 122개 리프 명령 중 배열을 반환하는 "목록" 명령을 전부
추렸다. `documents`/`questions`(문서·칸반 카드/소스 대상)/`messages`/
`git log` 4개 영역은 이미 웹 UI용으로 `/xxx/page` 페이지네이션
백엔드가 구현돼 있어(`listDocumentsPaged`/`listQuestionsPaged`/
`listMessagesPaged`/`listCommitsPaged`) CLI/MCP만 새로 연결하면
됐다(Tier A, 5개 명령: `list`/`questions`/`questions-source`/
`message list`/`git log`). 나머지 약 24개는 백엔드 자체에
페이지네이션이 없어 새로 만들어야 했다(Tier B).

**공용 헬퍼**: 새 `backend/src/core/pagination.ts` - 기존 3개
Paged 함수에 이미 반복돼 있던 "`Promise.all([findMany({skip,take}),
count()])` → `{items,page,pageSize,total,totalPages}`" 패턴을
`paginate()` 함수 하나로 뽑아 Tier B의 새 Paged 함수 약 20개가
매번 복붙하지 않게 했다. 두 번째 헬퍼 `paginateInMemory()`는 DB
skip/take를 그대로 못 쓰는 경우(아래) 전용.

**DB 레벨 페이지네이션이 안 통하는 경우들 - in-memory로 처리**:
조사 중 `listTeams`/`listProjectGroups`/`listProjects`(가시성 필터가
행을 걸러냄 - skip/take를 먼저 걸면 페이지 경계가 실제 보이는 개수와
어긋남), `listMembersForTeam`/`listMembersForGroup`(group→project→
member로 펼친 결과라 단일 테이블 조회가 아님), `listKanbanColumnsForUser`
(개인 설정을 병합한 뒤 그 병합된 순서로 재정렬하므로 DB 조회 순서와
최종 순서가 다를 수 있음), `git tree`(Gitea Contents API 자체가
page/limit 파라미터를 아예 안 받는 단발성 엔드포인트 - `git log`가
쓰는 `listCommitsPaged`처럼 상류에 페이지를 위임하는 방식을 못 씀)
6곳은 원래 함수가 만든 전체 배열을 그대로 받은 뒤 `paginateInMemory()`
로 자른다 - 데이터 규모가 이 설치형 시스템 특성상 크지 않아(개인/팀
단위) 전체를 한 번 받는 비용은 감내 가능하다고 판단. 반대로
`listPendingQuestions`/`listKanbanCards`처럼 "필터는 있지만 행을
떨어뜨리지 않고 매 행에 부가 정보만 얹는" 경우는 DB skip/take를
먼저 걸고 **잘린 페이지 분량만** 후처리(문서/카드 제목 조회 등)하도록
했다 - 전체를 다 가져와 후처리하는 낭비를 피함.

**기존 라우트는 그대로 두고 `/page` 접미사로만 확장** - Tier A
4곳이 이미 쓰던 관례를 그대로 따라, Tier B 24곳도 전부 새 `/xxx/page`
GET 라우트를 추가하는 방식으로 갔다(기존 라우트의 응답 모양은 전혀
안 바꿈 - `--page`/`--count`를 안 주면 기존 스크립트/자동화가 100%
그대로 동작). 예외 둘: `search`(문서 전문검색)는 이미 Meilisearch가
offset/limit을 지원해 새 라우트 없이 같은 `/search` 경로에
`page`/`pageSize` 쿼리만 추가로 받게 했고, `git tree`도 위 in-memory
사유로 새 라우트(`/git/tree/page`)는 추가했지만 실제 페이지 계산은
서버 쪽 슬라이스로 처리했다.

**CLI(`backend/src/cli/index.ts`)/MCP(`backend/src/mcp/server.ts`)**:
목록 명령 29개 전부에 동일한 옵션 쌍(`--page`/`--count`, MCP는
`page`/`pageSize`)을 추가 - 둘 다 안 주면 기존 라우트, 하나라도 주면
`/page` 라우트로 분기하는 동일한 패턴을 반복했다. `key list`(3
변형)/`user list`는 원래부터 CLI 전용(MCP엔 없음 - 신원/관리자
동작이라는 기존 설계 원칙, `#cli-mcp-audit-script`가 이미 "의도적
예외"로 분류해둔 대상)이라 MCP 쪽은 건드리지 않았다. `npm run
audit:cli-mcp`가 CLI 옵션 추가와 MCP 파라미터 추가가 항상 쌍으로
맞는지 자동 확인해줘서, 29개를 한 번에 고치는 이번 라운드에서 특히
유용했다(하나라도 빠뜨리면 스크립트가 잡아냄).

**`#document-list-silent-cap`과의 연결**: 그 라운드가 남겨둔 "1000건
넘는 프로젝트는 잔여 한계"가 이번 라운드로 실질적으로 해소됐다 -
`--page`/`--count`를 쓰면 1000건을 훨씬 넘는 프로젝트도 정확한 범위로
조회할 수 있다(옵션 없이 호출했을 때의 1000건 상한 자체는 그대로
남아있음 - 안전망 성격).

**실측 검증**: `npx tsc --noEmit` 클린 → `npm run audit:cli-mcp`
클린(29개 CLI 옵션 + 27개 MCP 파라미터 - key/user 제외 - 전부 쌍으로
확인) → `docker compose build backend` → `up -d --force-recreate` →
실제 HTTP 왕복 스크립트로 대표 표본 검증: 문서 55건짜리 프로젝트에서
`--page`/`--count` 생략 시 기존과 동일한 배열(55건), 지정 시
`{items,page,pageSize,total,totalPages}`(2페이지=20건/total=55),
마지막 페이지(15건)와 범위 밖 페이지(빈 배열, 에러 아님) 확인 - 칸반
카드 25건/push 훅 큐(빈 목록)도 같은 패턴으로 확인. 문서 전문검색은
`page`/`pageSize` 유무에 따라 배열↔페이지 객체로 정확히 갈리는지
확인. **로컬 재빌드한 CLI 바이너리**로 `docs list --page 2 --count
20`을 직접 실행해 옵션 파싱부터 실제 응답까지 왕복 확인(HTTP 직접
호출이 아니라 진짜 CLI 프로세스로). git 저장소를 실제로 연결한
프로젝트에서 `git tree`(in-memory 페이지네이션, 13개 파일 중 5개씩
페이지)와 `git log`(`{items,hasMore}` 모양, Gitea 자체 페이지네이션)
도 각각 별도로 왕복 검증. 컨테이너는 전체 테스트 내내 재시작 없이
`Up` 상태 유지.

## 폴더 이동 동시성(경합) QA - 순환 생성 버그 발견·수정(`#folder-move-cycle-race`) - 완료 (2026-09-13)

**배경**: `#question-ack-race-fix` 라운드와 같은 방식으로 다른
상태 전이 함수들도 동시성 경합에 안전한지 계속 점검하던 중, 처음엔
`transitionDocumentStatus`(문서 상태 전이)와 `transitionQueueEntry`
(push 훅 큐 항목 전이)에도 같은 문제가 있을 것으로 보고 동일한
조건부 `updateMany` 패턴으로 고쳤다가, 실측 검증 과정에서 **이 둘은
실제로는 버그가 아니라는 걸 재확인하고 되돌렸다** - 두 경우 모두
"어떤 상태에서 어떤 상태로도(예외 몇 개만 빼고) 자유롭게 전이 가능한"
그래프라, 두 요청이 동시에 들어와도 나중에 실행된 쪽은 그 시점의
실제(이미 바뀐) 상태를 보고 "정당하게 다시 전이"한 것일 뿐 - 순차적
last-write-wins와 구분이 안 되고, 어느 쪽 호출자도 거짓 성공 응답을
받지 않는다(직접 재현 시도했지만 손상 재현 안 됨 - `git log` 확인
가능한 되돌림 커밋). 이건 `#question-ack-race-fix`의 핵심이
"open이라는 좁은 단일 게이트에서 서로 배타적인 목적지(withdrawn vs
pending)로 갈라지는" 구조였기 때문에 성립했던 것이지, 모든
"findUnique 읽고 나중에 update" 모양이 다 위험한 건 아니라는 걸
이번에 구분해서 배웠다.

이 교훈을 갖고 계속 훑다가 `core/folders.ts`의 `moveFolder()`에서
**진짜 다른 종류의 버그**를 찾았다 - 상태값 하나를 두고 겨루는 게
아니라, **여러 행에 걸친 구조적 불변식(트리에 순환이 없어야 한다)이
깨지는 경우**다. `isDescendantOf()`(옮기려는 새 부모가 옮기려는
폴더의 하위 트리에 있는지 확인하는 순환 방지 검사)는 트리를 읽기만
하고, 실제 이동은 별도 `$transaction`으로 나중에 쓴다 - 그 사이
같은 설계자가 폴더 A를 B 밑으로, B를 A 밑으로 옮기는 요청을 거의
동시에 보내면(빠른 연속 드래그, 여러 탭) 두 요청 모두 상대가 아직
안 쓴 "깨끗한" 트리를 보고 순환 검사를 통과해버려, **실제로 DB에
순환(A→B→A)이 만들어질 수 있다** - 재현 스크립트로 실측 확인.
재귀적으로 트리를 순회하는 프론트(`FolderNode.vue`)나 다른 트리
도구가 이 순환을 만나면 무한 루프/스택 오버플로 위험이 있다.

**수정 방식 - 왜 트랜잭션 격리 수준 대신 프로세스 내 뮤텍스인가**:
이 불변식은 여러 행(전체 조상 체인)에 걸쳐 있어서 질의/문서처럼
단일 행의 조건부 `updateMany` 한 번으로는 원자적으로 못 지킨다.
정석대로면 SERIALIZABLE 트랜잭션이나 행 잠금이 필요하지만, 이
저장소는 SQLite/Postgres/MySQL 세 프로바이더를 동시에 지원해야
하고(스키마 파일이 3벌) SQLite는 `$transaction`의 격리 수준
지정을 지원하지 않는 등 이식성 문제가 크다. 대신 README가 명시하는
이 시스템의 실제 배포 형태("단일 설치형" - 백엔드가 항상 프로세스
하나로 뜸)를 그대로 활용해, **같은 설계자의 `moveFolder` 호출을
프로세스 안에서 순서대로만 처리되게 줄 세우는** 프라미스 체인
뮤텍스(`withUserFolderLock`, `Map<userId, Promise>`)를 도입했다 -
폴더는 개인 소유라 잠금 범위를 설계자 단위로 잡아도 다른 설계자의
이동엔 전혀 영향이 없고, 분산 락 인프라 없이 세 DB 프로바이더
전부에 동일하게 통하는 가장 단순한 해법이다. `moveFolder`는 이제
얇은 래퍼가 되고, 기존 로직 전체(순환 검사 + 트랜잭션)는
`moveFolderLocked`로 옮겨 잠금 안에서 실행된다.

**실측 검증**: (1) A↔B 동시 이동 시도 - 수정 전엔 실제로 순환이
만들어지는 것 확인(둘 다 200 성공, `A.parentFolderId=B`이면서
`B.parentFolderId=A`) → 수정 후 재실행하니 먼저 실행된 쪽만 성공하고
나중 쪽은 "하위 폴더 아래로는 옮길 수 없습니다" 도메인 에러로 정상
거부, 순환 없음 확인. (2) 회귀 확인 - 서로 무관한 폴더 5개를 같은
설계자가 동시에 옮기는 정상 시나리오가 데드락이나 과도한 지연 없이
(154ms) 전부 성공하는지 확인 - 뮤텍스가 무관한 요청까지 불필요하게
막지 않음을 확인. `npx tsc --noEmit` 클린, `npm run audit:cli-mcp`
클린(폴더는 애초에 CLI/MCP 표면이 없음 - 회귀 확인 차원),
`docker compose build/up --force-recreate` 후 실제 HTTP 왕복으로
전부 재확인.

## 로컬/사설 서버 배포 시 GitHub 연동 조사 + 수동 웹훅 안내 누락 발견·수정(`#external-webhook-manual-instructions`) - 완료 (2026-09-13)

**배경**: 설계자 지시 - "로컬 서버에 설치된 경우에, GitHub와 연동할
방법을 좀 더 살펴보자." 남은 QA 항목("동기화(발행) - 실제 GitHub/
GitLab 테스트 저장소로 왕복")이 외부 자격증명 문제로 막혀 있던
참에, 그보다 앞서 "애초에 로컬/사설 서버에 설치했을 때 GitHub
연동이 어디까지 되는가"부터 구조적으로 조사했다.

**조사 결과**: 이 시스템이 GitHub/GitLab과 주고받는 통신은 성격이
완전히 다른 두 갈래다.
1. **아웃바운드**(로컬 서버 여부와 무관하게 항상 됨) - `git
   link-external`(저장소 연결), `git publish`(Gitea Push Mirror로
   실제 push), `git sync-status`/`git sync-proposal`(변경 확인) -
   전부 이 백엔드(정확히는 내부 Gitea)가 PAT로 먼저 걸어 나가는
   호출이다. 포트포워딩도 공인 IP도 필요 없다.
2. **인바운드** - 딱 두 갈래뿐이고 성격이 다르다: (a) 자체 호스팅
   Gitea의 "시스템 웹훅"(push 훅 자동화 트리거)은 Gitea↔백엔드가
   같은 docker-compose 네트워크 안에 있어(`PUBLIC_BACKEND_URL` 기본값이
   그 내부 호스트 이름) 로컬 서버에서도 항상 잘 된다. (b) `git
   link-external`이 **GitHub/GitLab 저장소 자체에** 웹훅을 자동
   등록해주는 것(`core/externalGit.ts`)만 진짜 공인 HTTPS 주소가
   필요하다 - 이게 있어야 이 시스템을 안 거치고 GitHub에 직접
   push해도 push 훅 자동화가 즉시 반응한다.

이 (b)는 원래부터 fail-soft로 설계돼 있었다(`gitRepos.ts`의
`linkExternalAsPrimary`) - 자동 등록이 실패해도 연동 자체는 안
끊기고, 응답에 `manualWebhookInstructions: {url, secret}`을 실어
보내 설계자가 GitHub 저장소 설정에서 직접 등록할 수 있게 한다.

**발견한 버그**: 그런데 프론트(`GitRepoPanel.vue`)의 `GitRepo`
타입에 이 필드가 아예 선언돼 있지 않아서, 백엔드가 실제로 이 값을
보내도 화면에서 조용히 버려지고 있었다 - 설계자는 자동 등록이
실패했다는 사실도, URL/secret 값도 전혀 볼 수 없었다(연동 자체는
성공했다고만 뜸). 로컬 서버 배포가 기본적으로 걸리는 바로 그
경로라 실사용 영향이 크다.

**수정**: `GitRepoPanel.vue`에 `WebhookInstructions` 타입 추가,
`startLink()`가 `manualWebhookInstructions`를 받아 `webhookInstructions`
ref에 저장, 연동 성공 직후 Payload URL/Secret/Content-Type/이벤트(push)를
보여주는 경고색 안내 박스 + "확인함(닫기)" 버튼 추가(기존 `.auth-prompt`/
`.publish-queued`와 같은 `--color-warning-*` 토큰 재사용이라 다크
모드도 별도 손질 없이 통함).

**README.md 보강**: "로컬/사설 서버에 설치한 경우 GitHub/GitLab
연동은 어디까지 되는가" 절 신설 - 위 조사 결과(아웃바운드는 전부
됨, 자체 호스팅 웹훅도 내부망이라 항상 됨, 외부 저장소 자동 웹훅
등록만 공인 주소 필요)와 공인 HTTPS 주소를 마련하는 실전 옵션
(포트포워딩+DDNS+리버스 프록시, 또는 Cloudflare Tunnel/ngrok/
Tailscale Funnel 같은 역터널 - 이 저장소가 특정 터널을 내장하진
않음)을 정리했다. **FEATURES.md** §13에도 이 fail-soft 동작과
수동 안내가 이제 웹 UI에 실제로 뜬다는 것을 한 단락 추가.

**실측 검증**: `npx vue-tsc -b`(frontend) 클린 → 프론트 dev
서버(Vite, `/api`는 실제 Docker 백엔드로 프록시)를 띄워 실제
공개 저장소(`octocat/Hello-World`)를 **자격증명 없이**(항상 자동
등록 실패 경로를 타는 조건) 연동 → 안내 박스에 실제 Payload
URL(`http://backend:8760/api/webhooks/github/<projectId>`)과
Secret이 정확히 뜨는 것을 스크린샷으로 확인 → "확인함" 클릭 시
깔끔히 닫히는 것 확인 → 콘솔에 이 변경으로 인한 새 에러 없음(기존
404 1건은 "git 저장소 연결 여부 확인"용으로 원래도 있던 것 -
무관). 테스트 프로젝트는 검증 후 삭제.

## 웹훅 수동 설정 카드를 영구 삭제 없이 "접기/펼치기 + 실제 수신 전까지 계속 노출"로 재설계(`#webhook-instructions-persistent-card`) - 완료 (2026-09-13)

**배경**: 설계자 지시 - "'웹훅 설정 안내'는 웹훅이 call을 수신하기
전까지 접을 수 있는 형태의 카드로 계속 노출시켜놔." 바로 앞 라운드
(`#external-webhook-manual-instructions`)에서 만든 "확인함"
버튼(누르면 영구히 사라짐, 상태는 컴포넌트 로컬 ref일 뿐이라
새로고침해도 어차피 초기화됨)을 이 요구에 맞게 다시 설계했다 -
"카드가 필요한 동안은 몇 번을 새로고침하거나 다시 들어와도 그대로
있어야 하고, 실제로 웹훅이 호출되면(=더 이상 필요 없어지면)
자동으로 사라져야 한다"는 조건은 로컬 상태만으로는 표현할 수 없어서
(그 판단 기준 자체가 서버만 아는 사실 - 웹훅이 실제로 도착했는지)
백엔드에 진짜 상태를 영속화해야 했다.

**스키마 변경**(3 프로바이더 전부): `ProjectGitRepo`에
`webhookAutoRegistered Boolean @default(false)`(예전엔
`linkExternalAsPrimary()`의 반환값에만 잠깐 담겼다 사라지던 값 -
이제 저장), `webhookUrl String?`(등록에 실제로 넘겼던 콜백 URL
그대로 - provider를 별도로 저장/추론할 필요 없이 나중에 그대로
재사용), `webhookFirstReceivedAt DateTime?`(그 웹훅이 실제로 처음
호출된 시각, null이면 아직 한 번도 안 옴) 3개 추가.

**백엔드**: `getWebhookSetupInstructions(projectId)` 신설 - "자동
등록 안 됐고 + 아직 한 번도 안 받았을 때만" URL+secret을 복호화해
돌려주고, 그 외엔 `null`(카드 자체가 필요 없다는 뜻). API 키처럼
1회만 노출하는 값이 아니라 - 카드가 떠 있는 동안은 owner가 몇 번이고
다시 조회할 수 있어야 하므로(이번 요구의 핵심) 매번 복호화해서
반환한다. `markExternalWebhookReceived(projectId)`는 외부 웹훅 수신
라우트(`POST /api/webhooks/:provider/:projectId`, gitea 아닌
provider만 - Gitea 시스템 웹훅과는 별개 경로임을 재확인하고 거기엔
안 건드림)가 서명 검증을 통과한 직후 호출 - `webhookFirstReceivedAt`
이 이미 있으면 다시 안 건드리는 조건부 `updateMany`(idempotent, 매
push마다 쓸데없이 갱신 안 함). 새 라우트 `GET .../git/
webhook-instructions`(owner 전용 - `GET .../git/repo`는 viewer도
보므로 secret이 섞인 이 조회는 별도 라우트로 분리, git 저장소 관리
기능 전반의 "owner 전용" 원칙 그대로 적용).

**프론트(`GitRepoPanel.vue`)**: "확인함(닫기)" 버튼을 없애고, 카드
헤더를 클릭하면 접히고 펼쳐지는 형태로 바꿨다(`webhookCardExpanded`
- 로컬 UI 상태, 접힘 여부만 로컬이고 "보여줄지 말지" 자체는 항상
서버 진실을 따름). `load()`가 `GET .../git/repo`로 받은
`webhookAutoRegistered`/`webhookFirstReceivedAt`을 보고 카드가 필요할
때만 `GET .../git/webhook-instructions`를 추가로 불러온다 - 페이지를
새로 열 때마다(다른 탭에서 다시 들어와도) 이 조회를 다시 하므로
카드가 계속 살아있다.

**실측 검증**: `npx tsc --noEmit`(backend)/`npx vue-tsc -b`(frontend)
클린 → 스키마 변경분 `db push`가 컨테이너 기동 로그에서 실제로
반영되는지 확인 → 브라우저로 실제 공개 저장소(`octocat/Hello-World`)
를 자격증명 없이 연동(항상 카드가 뜨는 조건) → 카드 헤더 클릭으로
접기/펼치기 확인 → **페이지를 완전히 새로고침해도 같은 URL/secret
그대로 카드가 남아있는지 확인(이번 라운드의 핵심 동작 - 예전 1회성
"확인함" 버튼으로는 불가능했던 것)** → GitHub의 실제 서명 규칙
(`X-Hub-Signature-256`, HMAC-SHA256(secret, rawBody))을 그대로
재현하는 스크립트로 화면에 뜬 URL/secret을 그대로 써서 진짜 웹훅
호출을 흉내냄(`200 {"ok":true}` 확인) → 그 다음 새로고침부터는 카드가
완전히 사라지는 것을 확인(`webhookFirstReceivedAt`이 찍혀
`getWebhookSetupInstructions`가 `null`을 돌려주기 시작함). 콘솔에
이 변경으로 인한 새 에러 없음. `npm run audit:cli-mcp` 클린(git
저장소 기능은 원래도 CLI/MCP 표면 밖 - 회귀 확인 차원). 테스트
프로젝트는 검증 후 삭제.

## 사용자 관리 화면 - 검색/페이지네이션/소속 조회+강제 방출(`#user-membership-management`) - 완료 (2026-09-13)

**배경**: 설계자 지시 - 3갈래 확장 요청(사용자 관리 강화 / GitHub
OAuth 연동 / 저장소 관리 탭)을 한 번에 설계해달라고 해서 Plan Mode로
전체를 조사·설계한 뒤 Phase A(이 라운드)→B→C 순서로 나눠 진행하기로
했다(나머지 두 Phase는 PLANS.md `#github-oauth-repo-link`/
`#repo-management-tab`에 상세 설계를 남겨둠). 조사 결과 이 시스템의
멤버십은 2단계뿐임을 확인했다 - `Member`(프로젝트 단위, role)와
`TeamAdmin`/`ProjectGroupAdmin`(관리자 전용 관계, 일반 "팀원"/"그룹원"
개념 자체가 없음). 팀 관리자는 자기 팀 산하 모든 그룹에 대해서도
`isProjectGroupAdmin()`의 상속 판정으로 자동으로 그룹 관리자 권한을
갖는다(DB에 별도 행 없음) - "소속 조회" 다이얼로그의 `coveredByTeamAdmin`
필드가 이 상속을 반영한다.

**강제 방출 가드**: `removeMember`/`removeTeamAdmin`/
`removeProjectGroupAdmin`(각각 `members.ts`/`teamAdmins.ts`/
`projectGroupAdmins.ts`) 전부에 "마지막 owner/관리자는 방출 불가"
가드를 추가했다 - `updateMemberRole`의 "본인이 스스로 owner 권한을
해제할 수 없다"는 가드와는 별개 축(이쪽은 "누가 지우든 마지막
owner/관리자가 없어지는 상태 자체"를 막는다). `ProjectGroupAdmin`만
예외 조건이 하나 더 있다 - 그 그룹의 유일한 명시적 관리자여도, 그
그룹이 속한 팀에 팀 관리자가 한 명이라도 있으면 상속으로 계속
관리되므로 방출을 허용한다.

**백엔드**: 신규 `core/userMemberships.ts`의 `listUserMemberships(userId)`
가 프로젝트/팀/그룹 3종을 한 번에 모아 각 행의 `isSoleOwner`/
`isSoleAdmin`/`coveredByTeamAdmin`을 계산한다(`access-overview`의
문서별 세부 권한 제한과는 완전히 다른 개념이라 별도 파일로 분리 -
설계자 확인: 기존 "접근 제한 보기" 버튼은 그대로 두고 "소속 조회"를
별개 버튼으로 추가). 새 라우트 4개(전부 `requireSuperAdmin`, 기존
`/admin/users/*`와 같은 보호 수준): `GET .../memberships`,
`DELETE .../memberships/{projects,teams,groups}/:id`(각각 위 가드가
걸리면 그 에러 메시지 그대로 전파). `listAllUsersForAdminPaged`
(`core/auth.ts`)에 `search?: string` 추가 - username/nickname/email에
`contains` 부분일치(SQLite Prisma 커넥터가 `mode:"insensitive"`를
지원 안 해서 3 프로바이더 전부 안전하게 도는 대소문자 구분 `contains`
로 통일).

**프론트**: `AdminUsersView.vue`가 옛 `/admin/users`(전체 배열) 대신
`/admin/users/page`(검색+페이지네이션)를 쓰도록 전환, 사용자명을
`router-link`로 바꿔 기존 `UserProfileView.vue`(`/users/:id`)로
이동(새 화면 불필요 - 이미 프로필+활동+개인 접근 제한 뷰가 있었음).
신규 `MembershipsDialog.vue` + `membershipsDialog` Pinia 스토어(값을
반환할 필요 없는 단방향 다이얼로그라 `folderPicker.ts`가 아니라
`documentDialog.ts`/`DocumentPreviewDialog.vue`와 같은 패턴) -
`AppLayout.vue`에 전역 마운트. 각 소속 행에 "강제 방출" 버튼,
`isSoleOwner`/`isSoleAdmin`(그룹은 `coveredByTeamAdmin`도 고려)이면
비활성 + 이유 툴팁, 클릭 시 `window.confirm` 후 DELETE.

**실측 검증**: `npx tsc --noEmit`(backend)/`npx vue-tsc -b`(frontend)
클린 → Docker 백엔드 재빌드+재기동 → 실제 브라우저로: 검색창에
"reparent" 입력 시 디바운스 후 해당 3명만 필터링되는 것 확인 →
페이지네이션이 1/2페이지를 오가는 것 확인 → 여러 팀/그룹에 걸친
테스트 사용자(`reparent_dual`)의 "소속 조회" 다이얼로그가 실제 소속
2개 팀 관리자 관계를 정확히 보여주는 것 확인(`document.querySelector('.dialog').innerText`
로 다이얼로그 DOM 직접 대조 - 이 세션의 프리뷰 브라우저가 비정상적으로
작은 뷰포트로 렌더링되는 이슈가 있어 스크린샷 대신 접근성 트리/DOM
텍스트로 검증) → 유일한 프로젝트 owner(`pri_owner`)는 방출 버튼이
비활성 + "이 프로젝트의 유일한 owner라 방출할 수 없습니다" 툴팁
확인 → `reparent_teamA`의 팀 관리자 관계(공동 관리자 있음, 비활성
아님)를 실제로 강제 방출 → `GET .../memberships`로 서버 상태까지
재조회해 실제로 제거됐음을 확인(`{"teams":[]}`) → **팀 관리자
상속 예외 케이스**: 그 결과 `reparent_teamA`가 소속된 그룹
"ReparentTestGroupRenamed"는 그룹 자체 관리자가 이 사용자 1명뿐(
`isSoleAdmin:true`)이었지만 그 그룹의 부모 팀에 다른 관리자
(`reparent_teamB`)가 남아있어 `coveredByTeamAdmin:true` → 방출 버튼이
비활성화되지 않고 실제로 강제 방출이 에러 없이 성공하는 것까지
확인(예외 조건이 프론트 비활성화 로직과 백엔드 가드 양쪽에서 일관되게
동작). 사용자명 클릭 시 `/users/:id`로 실제 이동하는 것 확인.
`npm run audit:cli-mcp` 클린(이 기능도 기존 사용자 관리 범위와
동일하게 웹 전용 - CLI/MCP엔 안 넣음).

## GitHub OAuth 연동 + 자동 강등 + self_hosted↔external 승격(`#github-oauth-repo-link`) - 완료 (2026-09-13)

**배경**: 3단계 확장 설계의 Phase B. "깃허브 연동하기"를 URL 직접
입력 방식에서 "GitHub 로그인 → 저장소 목록에서 선택"으로 바꾸고,
`self_hosted`↔`external_linked`를 양방향으로 전환할 수 있게 하고,
자격증명이 나중에 무효화되면(토큰 폐기 등) 자동으로 안전한 상태
(`self_hosted`)로 강등되게 한다.

**OAuth 설계의 핵심 - redirect_uri를 요청마다 동적으로 계산**:
`PUBLIC_BACKEND_URL`(사설 배포에선 docker 내부 호스트명이라 브라우저가
못 닿을 수 있음, 웹훅 자동등록 라운드에서 이미 겪은 문제)을 쓰지
않는다 - OAuth 콜백은 서버-서버 웹훅과 달리 **브라우저가 직접
리다이렉트되는 흐름**이라 애초에 "공개 주소가 있어야 한다"는 제약
자체가 없다. `req.protocol`+`req.get("host")`로 그 요청을 시작한
브라우저가 실제로 접근한 주소를 그대로 되돌려주면 항상 정확히
맞는다(새 env 불필요) - 로컬 서버 설치에서도 아무 문제 없이 동작하는
게 이전 웹훅 조사와 대비되는 지점.

**신원 유지 - state 토큰(인메모리 Map, 1회용)**: GitHub 리다이렉트는
top-level navigation이라 Authorization 헤더를 실을 수 없다. JWT를
URL 쿼리에 실어 팝업에 넘기는 방법도 검토했지만 github.com으로의
Referer 유출 위험이 있어 기각 - 대신 `POST /api/git/oauth/github/start`
가 무작위 `state`를 `Map<state, {userId, expiresAt}>`(TTL 10분)에
저장해두고, 인증 미들웨어가 없는 `GET .../callback`이 그 `state`로
신원을 되찾은 뒤 즉시 삭제한다(재생 공격 방지). `folders.ts`의
`withUserFolderLock`과 같은 전제(단일 설치형, 수평 확장 없음)로
프로세스 내 상태만으로 충분하다고 판단(새 파일 `core/githubOAuth.ts`).
콜백은 작은 HTML을 응답해 `window.opener.postMessage(...);
window.close();`로 팝업을 연 메인 창에 결과를 전달한다(GitHub의
top-level navigation이 메인 페이지의 폼 상태를 날리지 않도록 팝업
필수).

**저장소 목록**: `GET /api/credentials/:id/github/repos?page=`가
GitHub `/user/repos`를 그대로 프록시(소유자 본인만 - 새
`getCredentialTokenIfOwner()`, `gitCredentials.ts`의 payload 비공개
원칙을 깨지 않는 소수 예외로 명시). GitHub도 총 개수를 안 줘서
`{items,hasMore}` 모양(git log류와 동일 패턴). 검색은 백엔드에 새로
안 만들고 프론트가 누적 페이지에 클라이언트 쪽 부분일치 필터만
건다(GitHub API 자체가 이 범위 검색을 못 줘서 과설계 방지). 새
컴포넌트 `GithubRepoPickerDialog.vue`(로컬 다이얼로그, Phase A의
전역 Pinia 다이얼로그와 달리 GitRepoPanel이 직접 열고 닫는 단순
props/emit 방식 - 다른 화면에서 열 필요가 없어 store가 필요 없음) -
선택하면 `linkUrl`/`promoteUrl`을 채우기만 하고 실제 연동/전환은
기존 `startLink()`/`promote()`를 그대로 호출(새 로직 없음).

**`promoteToExternal()`(`core/gitRepos.ts`, `unlinkExternalRepo`와
대칭)**: self_hosted의 work 저장소는 새로 안 만들고 그대로
재사용(이름만 `{slug}-work`로 변경) - 지금까지의 커밋 히스토리
보존이 핵심 가치. 미러만 새로 만들고, DB를 `external_linked`로
갱신한 직후 **기존 `publishToExternalRepo`를 즉시 한 번 호출**해
work 저장소의 현재 상태를 방금 연결한 외부 저장소에 반영한다(빈
저장소가 아니면 기존 push mirror + AI 대기열 로직이 그대로 충돌을
처리 - 새 로직 없음). `POST /api/projects/:projectId/git/
promote-to-external`(owner 전용).

**자격증명 오류 시 자동 강등**: `externalGit.ts`에 `detectProvider()`
(repoUrl의 host가 github.com인지로 판별 - DB엔 provider가
"external_linked"로만 저장되고 github/gitlab 구분이 연동 시점
파라미터로만 존재해 남지 않기 때문)와 `validateCredential()`(GitHub/
GitLab의 `GET /user`가 401/403이면 무효 - git의 "충돌" 에러 문자열을
파싱하는 것보다 신뢰도 높은 판별법) 추가. `gitRepos.ts`의
`validateExternalCredential()`이 이 둘을 엮는다.
`publishToExternalRepo()`는 이제 실제 push를 시도하기 전에 먼저
이 검증을 하고, 실패하면 `unlinkExternalRepo()`(work 저장소 보존)로
자동 강등 + `sendMessage()`로 프로젝트에 안내 + 호출자에게도 "그냥
실패"가 아니라 "자격증명 무효화로 자동 전환됐다"로 구분되는 에러를
던진다. `requestGitSyncStatus()`(pull 미러 상태 확인 경로)는 같은
사전 검증만 추가하고 자동 강등까지는 하지 않는다(설계자 지시 범위 -
pull 미러는 Gitea가 내부적으로 자체 자격증명을 들고 있어 이 앱이
실시간 health를 못 보는 잔여 한계가 있다는 게 문서화된 전제).

**새 env** `GITHUB_OAUTH_CLIENT_ID`/`GITHUB_OAUTH_CLIENT_SECRET`
(`.env.example`/`docker-compose.yml`에 등록 방법과 함께 추가) - 미설정
시 `GET /api/git/oauth/github/configured`가 `false`를 반환해 "GitHub로
로그인" 버튼 자체가 웹 UI에서 안 보인다(기존 `PUBLIC_BACKEND_URL`
미설정 시 fail-soft 원칙과 동일 - URL 직접 입력으로 연동하는 기존
방식은 계속 동작).

**실측 검증**: `npx tsc --noEmit`(backend)/`npx vue-tsc -b`(frontend)
클린 → `npm run audit:cli-mcp` 클린(이 기능도 기존 git 저장소 범위와
동일하게 웹 전용) → Docker 백엔드 재빌드+재기동(env 미설정 상태) →
`GET /api/git/oauth/github/configured`가 실제로 `{configured:false}`를
반환하고 웹 UI에서 "GitHub로 로그인" 버튼이 안 보이는 것 확인(fail-soft) →
테스트 프로젝트에서 self_hosted 저장소 생성 후 "외부 저장소로 전환"
섹션이 실제로 뜨는 것 확인, 입력이 비어있으면 버튼이 비활성인 것 확인 →
`promote-to-external` 라우트의 입력 검증(provider 오류/repoUrl 누락/
gitCredentialId 누락/존재하지 않는 credentialId) 4가지 전부 400 +
명확한 에러 메시지로 실측 → **핵심 통합 테스트**: 실제로 무효한
GitHub PAT(`ghp_fake_...`)를 저장한 뒤 공개 저장소(`octocat/Hello-World`)
로 `promote-to-external` 호출 → 미러 생성+work 저장소 승격까지는
성공하고 곧바로 이어지는 `publishToExternalRepo`의 사전 검증이 실제
GitHub API(`GET /user` → 401 Bad credentials)로 무효를 확인해
**그 자리에서 자동으로 `self_hosted`로 되돌리고**(`GET .../git/repo`로
재조회해 `provider:"self_hosted"`, `gitCredentialId:null` 확인),
프로젝트 메시지함에 안내 메시지가 실제로 남는 것까지 확인 - 자격증명
오류 자동 강등 기능 전체가 진짜 GitHub API를 상대로 end-to-end 동작함을
확인했다. 저장소 목록 조회 라우트(`GET /api/credentials/:id/github/
repos`)도 같은 무효 토큰으로 호출해 실제 GitHub의 401 응답이 그대로
명확한 400 에러로 전달되는 것 확인, 소유자가 아닌/존재하지 않는
credentialId 요청이 거부되는 것도 확인. OAuth `start`/`callback`
라우트는 미설정 상태에서 각각 명확한 400 에러/`ok:false` postMessage로
안전하게 종료되는 것까지 확인. **실제 GitHub OAuth App(클라이언트
ID/시크릿)을 이용한 팝업 로그인 왕복 자체는 이번 세션에 그런 앱이
없어 검증하지 못했다** - 설계자가 실제 OAuth App을 등록하면 그
흐름(로그인 팝업 → 승인 → 저장소 선택 다이얼로그 → 연동)만 별도로
한 번 더 확인이 필요하다. 테스트 프로젝트/자격증명은 검증 후 삭제.

## 저장소 관리 탭 - PR 생성/머지 + 브랜치 목록/열람(`#repo-management-tab`) - 완료 (2026-09-13)

**배경**: 3단계 확장 설계의 Phase C(마지막). 프로젝트별 새 탭에서
PR 생성/머지(머지는 owner만)와 브랜치 목록을 다룬다.

**"워크트리 리스트" 재해석**: 요청 원문의 "워크트리 리스트"는 이
아키텍처(프로젝트당 공유 Gitea work 저장소 하나, 로컬 다중 clone
개념 자체가 없음)에서 문자 그대로는 존재할 수 없는 개념이라, 계획
단계에서 "브랜치 목록 + 브랜치별 소스 열람"으로 재해석해 진행하기로
하고 실제로 그렇게 구현했다 - `git/tree`/`git/file`/`git/file/raw`가
이미 받고 있었지만 프론트 어디서도 한 번도 보낸 적 없던 `ref` 쿼리
파라미터를, `SourceBrowserView.vue`가 실제로 채워 보내도록 확장하는
방식으로 켰다(완전히 새 브라우저 컴포넌트를 만들지 않음 - 기존 코드
재사용 극대화).

**`SourceBrowserView.vue`를 ref-aware로 확장(새 컴포넌트 대신)**:
`route.query.ref`를 `branchRef`로 읽어 `git/tree`/`git/file`/
`git/file/raw` 호출에 `ref` 쿼리를 실어 보낸다. 다만 **편집/저장은
`branchRef`가 있으면 막는다** - `PUT git/file`이 대상 브랜치를 받는
파라미터가 없어(Gitea Contents API의 `branch` 필드를 아직 안 씀)
항상 기본 브랜치에 커밋되므로, 다른 브랜치를 보면서 편집하면 "보고
있는 브랜치"와 "실제로 커밋되는 브랜치"가 달라지는 혼란이 생길 수
있어 이번 범위에서는 읽기 전용 열람만 지원(쓰기 지원은 범위 밖으로
남김). 같은 라우트 경로에서 `ref` 쿼리만 바뀌며 재진입하면 Vue
Router가 컴포넌트를 재사용해 `onMounted`가 다시 안 도는
문제(`#document-nav-stale-content`에서 이미 겪은 것과 같은 패턴)가
있어 `watch(() => route.query.ref, ...)`로 별도 처리.

**`core/gitea.ts`에 브랜치/PR API 추가**: `listBranches`/
`listPullRequests`/`getPullRequest`/`createPullRequest`/
`mergePullRequest` - Gitea REST API가 GitHub과 거의 동일한 PR
엔드포인트 모양을 제공한다는 사전 조사가 실제로 맞았다. 새
`giteaFetchAs()` 헬퍼(`putFileContent()`와 같은 "actingToken 있으면
그걸로, 없으면 관리자 토큰 폴백" 패턴)로 PR 생성/머지가 설계자 본인의
Gitea PAT로 이뤄져 Gitea 쪽 커밋/PR 작성자가 실제로 그 설계자
명의로 남는다. 머지는 Gitea API의 `Do:"merge"` 필드(대문자 시작,
swagger `MergePullRequestOption` 기준)만 지원(squash/rebase는 범위
밖).

**새 라우트**(전부 `requireGiteaWorkingSlug` 경유): `GET .../git/
branches`(viewer), `GET .../git/pulls`(viewer, `state` 쿼리로
open/closed/all), `GET .../git/pulls/:index`(viewer), `POST .../git/
pulls`(editor 이상 - `getGiteaAccessToken(req.userId!)`를 actingToken
으로), `POST .../git/pulls/:index/merge`(**owner 전용** -
`requireProjectRole("owner")`가 요청된 핵심 제약을 강제, PR 생성은
editor도 가능하지만 머지는 owner만).

**프론트**: `ProjectShellView.vue`에 "저장소 관리" 탭 + 새
`RepoManagementView.vue` - 브랜치 섹션(이름+마지막 커밋 시각+"탐색"
버튼 → `/projects/:id/source?ref=<브랜치>`로 이동), PR 섹션(목록에
제목/작성자/head→base/상태/설명, "PR 만들기" 폼, "머지" 버튼은
`roleSatisfies(myRole, "owner")`일 때만 노출 - 서버 403과 이중 방어).

**실측 검증**: `npx tsc --noEmit`(backend)/`npx vue-tsc -b`(frontend)
클린 → `npm run audit:cli-mcp` 클린(이 기능도 기존 git 저장소 범위와
동일하게 웹 전용) → Docker 백엔드 재빌드+재기동 → 테스트 프로젝트에
self_hosted 저장소 연결 후 **Gitea REST API를 직접 호출해 실제
브랜치(`feature/qa-test`)와 그 위의 추가 커밋을 만들어**(이 앱엔 아직
브랜치 생성 UI가 없어 설계자가 실제로 git push하는 상황을 재현) 검증:
(1) `GET .../git/branches`가 실제 두 브랜치(commit sha/시각 포함)를
정확히 돌려주는지, (2) 저장소 관리 탭의 브랜치 목록에서 "탐색"을
누르면 `/source?ref=feature/qa-test`로 이동하고 **기본 브랜치엔 없는
파일(`feature-note.md`)까지 실제로 보이는지, 기본 브랜치 뷰로
돌아가면 그 파일이 다시 안 보이는지**(브랜치별 실제 내용 차이를
왕복 확인) 실측. **PR 생성/머지 핵심 통합 테스트**: PR을 만들어
`authorUsername`이 실제로 그 설계자의 Gitea 계정(`admin-2`)으로
찍히는지 확인 → owner로 머지 클릭 → PR이 "머지됨"으로 바뀌고 **main
브랜치에 실제로 feature 브랜치의 파일이 병합된 것을 `git/tree`
재조회로 확인**(진짜 머지 커밋이 만들어짐) → 별도 실제 계정(editor
역할로 초대한 `qa_repo_editor`)으로 새 PR 생성(그 계정 명의로
`authorUsername`이 정확히 찍히는 것까지 확인) → 같은 계정으로 머지
시도 시 서버가 **실제로 403 "이 작업은 최소 owner 권한이 필요합니다"**
로 거부하는지, 그 계정의 웹 UI에서도 "머지" 버튼 자체가 안 보이는지
(admin 계정으로 본 같은 PR 목록엔 버튼이 보임과 대비) 확인 - owner
전용 제약이 서버/프론트 양쪽에서 실제로 일관되게 강제됨을 확인.
테스트 프로젝트는 검증 후 삭제.

## 코드 관계도(Code Relation Graph) - Claude 자기 기록형 코드 관계 그래프(`#code-relation-graph`) - 완료 (2026-09-13)

**배경**: 설계자 지시 - "클로드가 작업하고, 사람이 승인하거나 지침을
준다"는 원칙에서, 클로드가 코드를 탐색하며 스스로 파악한 "무엇이
어디서 왜 참조되는지"를 클로드 자신이 기록해두고 다음 세션이 재탐색
없이 빠르게 찾아 쓰게 만들라는 요청. 새 프로젝트 탭 "관계도"에서
문서의 추적코드나 소스 코드 위치로 조회할 수 있어야 하고, CRUD+bulk
5종, CLI/MCP/SKILL.md 전체 반영, 프로젝트 내 설계자별 완전 독립이
요구사항이었다.

**설계 과정에서 설계자가 두 번 정정**: (1) "상위 관계"를 최초 설계안
(Folder류 단일 부모 트리)에서 **"다중 부모(multi-parent) 또는
범용 그래프 엔진"**으로 전환 - 노드 하나가 여러 부모/여러 자식을
동시에 가질 수 있어야 한다는 지시. (2) 프론트엔드를 텍스트 목록/
포커스 UI 대신 **실제 그래프 시각화 라이브러리**로 구현하라는 지시.
(3) 검증 도중 "연관 문서 추적 코드"가 단수가 아니라 **관계 항목당
여러 개**여야 한다는 추가 지시. 세 정정 전부 구현 완료 후 곧바로
반영해 최종 설계에 녹였다.

**데이터 모델(3개 Prisma 스키마 전부)**: `CodeRelation`(노드 -
target/referrer/purpose/filePath/line/column/data(JSON 텍스트,
Json 타입 미사용 - 스키마 전체 관례)) + `CodeRelationTag`(태그,
`DocumentFolderEntry`류 조인 테이블) + `CodeRelationEdge`(**단일
parentId 트리가 아니라 다대다 조인** - fromId(자식)→toId(부모),
`@@unique([fromId,toId])`, **순환도 허용**하고 순회 시에만 방문
집합으로 무한 루프 방지) + `CodeRelationRef`(연관 문서 - 처음엔
`trackingCode String?` 단일 컬럼으로 잘못 설계했다가, 설계자가 "여러
개"라고 정정한 뒤 `QuestionReference`와 완전히 동일한 조인 테이블
패턴 + `Document.trackingCode`로의 실제 FK로 재설계 - 존재하지 않는
문서를 참조하려 하면 `questions.ts`의 `addQuestion()`과 동일하게
사전 조회로 명확한 "연관 문서를 찾을 수 없습니다" 에러를 던진다,
그 문서가 삭제되면 참조 행만 cascade로 정리되고 관계 자체는 안
지워짐).

**백엔드**: 신규 `core/codeRelations.ts` - `folders.ts`의 소유권
확인 패턴(`projectId`+`userId` 스코프, 소유자 아니면 "찾을 수
없거나 소유자가 아님") 재사용하되, 트리 순환 방지 로직은 재사용
안 함(그래프는 순환 허용이 설계 목표). `listDescendants`/
`listAncestors`는 MySQL/SQLite/Postgres의 재귀 CTE 문법 차이를
피하려고(이 코드베이스는 raw SQL을 안 씀) 애플리케이션 레벨 반복
BFS로 구현 - 레벨마다 배치 쿼리 1~2회, 방문 집합으로 순환 안전.
엣지 생성 시 두 노드가 서로 다른 (projectId,userId) 소유면 거부해
설계자 경계를 넘는 연결 자체를 막는다. REST 라우트 전부
`requireProjectRole("viewer")` - 개인 데이터라 프로젝트 멤버면
역할 무관하게 본인 관계만 관리 가능(core에서 다시 좁혀짐). Bulk는
`bulk-folder`/`bulk-transition`과 동일하게 트랜잭션 전체 성공/실패가
아니라 항목별 부분 성공 결과 배열.

**CLI/MCP**: `relation` 새 커맨드 그룹 12개(add/update/remove/get/
list/parents/children/ancestors/descendants/add-bulk/update-bulk/
remove-bulk) - `scripts/audit-cli-mcp.ts` 완전 대칭 확인(새 예외
없음). 구조화된 객체 배열(bulk-add/update)은 CLI에서 `--file
<path.json>`로 로컬 JSON 파일을 읽어 보내는 새 패턴 도입(기존
bulk는 전부 단순 문자열 배열이었어서 variadic 인자로 못 받음).
연관 문서는 `--refs <codes>`(쉼표 구분) - 질의/칸반 카드의 기존
`--refs` 관례를 그대로 재사용(처음엔 `--tracking-code` 단수로
잘못 이름 붙였다가 다중 지원으로 바뀌면서 기존 관례에 맞춰
개명). SKILL.md(및 `seed-templates/SKILL.md` 동기화)에 새 절
추가 - 핵심은 "언제 기록할지"(여러 파일을 가로지르는, 다시 파악
하려면 비용이 드는 발견일 때만 - 사소한 조회까지 전부 남기는
감사 로그가 아님)와 "탐색 전에 먼저 검색하는 습관".

**프론트엔드**: 그래프/트리 시각화 라이브러리가 이 프론트엔드에
전혀 없어서(d3/mermaid/cytoscape 등 0건) `vis-network`+`vis-data`를
새로 도입(설계자 지시) - 다중 부모 DAG를 위한 계층 레이아웃이
내장돼 있고, 순환 구간은 물리 시뮬레이션으로 자연스럽게 배치되며,
`vis-data`의 `DataSet`으로 노드/엣지를 점진적으로 추가/삭제할 수
있어 "depth별로 펼치기"에 잘 맞았다. 새 `components/
RelationGraphCanvas.vue`(vis-network 명령형 API를 감싼 얇은 래퍼 -
`props.nodes`/`props.edges`를 `relationCache`에서 diff-sync)+
`views/RelationsView.vue`(검색바 + 그래프 캔버스 + 사이드 상세
패널 레이아웃). DB 엣지 방향(fromId(자식)→toId(부모))과 화면 화살표
방향(부모→자식, "위에서 아래로 파생"이 더 직관적)을 의도적으로
반대로 렌더링 - DB 스키마는 안 건드림. **실측 중 발견한 버그**:
펼치기로 새 노드가 추가되면 계층 레이아웃 특성상 화면 밖에 배치될
수 있어(특히 순환 구간) 눈에 안 보이는 문제를 발견·수정 - 노드/엣지
갱신마다 `network.fit()`으로 재프레이밍(물리 안정화 완료
이벤트에서도 한 번 더). 문서 미리보기 다이얼로그에 "관계도에서
보기" 링크, 소스 브라우저 파일 헤더에 "관계도" 버튼 추가 -
전자는 `?trackingCode=`(정확 일치, `CodeRelationRef` 기반이라
가능해짐), 후자는 `?file=`(정확 일치) 쿼리로 필터를 프리필한다.

**실측 검증**: `npm run db:generate`(3 provider 전부) → `npx
tsc --noEmit`(backend)/`vue-tsc -b`(frontend, npx 캐시가 깨져
`./node_modules/.bin/vue-tsc`로 우회) 클린 → `npm run audit:cli-mcp`
클린 → Docker 재빌드+재기동, 스키마 실제 push 확인 → 로컬 빌드한
CLI로 실제 계정 A가 관계 생성 → 웹 UI(A로 로그인)에서 그래프에
바로 보이는지 확인 → **다중 부모 핵심 검증**: 관계 하나(R1)에
서로 다른 두 관계(P1/P2)를 동시에 `--parents`로 걸어
`relation parents`가 2개를 반환하는지, 웹 UI 그래프에서 R1이
P1/P2 양쪽에서 오는 엣지를 동시에 받는 게 실제로 그려지는지 확인 →
**순환 허용 핵심 검증**: P1→R1→P1로 순환 엣지를 만들어(에러 없이
성공) `relation descendants --depth 10`이 무한 루프 없이 방문
집합으로 안전하게 끝나고 중복 없이 나오는지, 웹 UI에서 그 순환을
실제로 펼쳐도 브라우저가 멈추지 않고 vis-network가 정상적으로
그려내는지(위 fit() 버그 수정 후 모든 노드가 실제로 보이는지)
확인 → bulk-add(CLI `--file` JSON, 유효 2건+검증 실패 1건)로
항목별 부분 성공 결과 확인 → 설계자 간 완전 격리(B 계정이 A의
관계를 `list`/`get` 둘 다로 절대 못 봄, 존재 자체 비노출) +
설계자 경계를 넘는 엣지 생성 거부 확인 → **연관 문서(다중) 핵심
검증**: 실제 문서 2건을 만들어 `--refs`로 관계 하나에 동시에
연결 → `--ref`(단수, 정확 일치) 필터로 조회 확인 → 존재하지 않는
추적코드로 `--refs` 시도 시 명확한 에러로 거부 확인 → `update
--refs`로 전체 교체 확인 → **연관 문서 삭제 시 cascade 확인**:
연관된 문서 하나를 삭제하면 그 참조만 없어지고 관계 자체는
survive하는 것을 재조회로 확인 → 웹 UI에서 "연관 문서" 필드가
추적코드 자동 링크로 클릭 가능한지, 문서 미리보기 다이얼로그의
"관계도에서 보기" 클릭 시 `?trackingCode=`로 정확히 필터링되어
돌아오는지(왕복) 확인. 테스트 프로젝트/문서/그룹/팀은 검증 후
전부 삭제.

## PR 워크플로우 확장 + 코드 관계도 브랜치 스코프 + 문서-브랜치 연관(`#pr-workflow-branch-scope`) - 완료 (2026-09-13)

**배경**: 설계자 지시("대형 수정") - 저장소 관리 탭의 PR 기능(목록+
인라인 머지 버튼)을 본격적인 워크플로우로 확장: 전용 상세 페이지
(메시지/커밋/대화/진행내역 전체 표시), Reject/Close/Reopen, 자동
머지 실패 시 수동 완료 안내, 목록 5개+더보기 분리, 최신순 정렬.
동시에 코드 관계도가 CLI/MCP의 실제 작업 브랜치를 인식하게 하고,
브랜치가 삭제되면 그 브랜치의 관계도를 일괄 정리하며, 문서에도 연관
브랜치를 명시할 수 있어야 한다는 요청. "작업중인 Branch를 어떻게
식별할지" 하나만 AskUserQuestion으로 확인했다 - 답은 **"로컬 git
저장소에서 자동 감지"**(CLI가 실행된 현재 디렉터리의 실제 clone에서
`git rev-parse --abbrev-ref HEAD`를 매 호출마다 라이브로 물어봄,
별도 상태 파일/전환 명령 없음).

**조사(실제 Gitea 1.27.3 인스턴스 swagger 직접 확인)**: Gitea REST
API가 요구사항을 전부 이미 지원한다 - PR 댓글은
`/issues/{index}/comments`(PR도 issue 취급), 진행 내역은
`/issues/{index}/timeline`(type으로 구분된 이벤트 피드), 상태전이는
`PATCH /pulls/{index}`의 `state`, **수동 병합 완료는**
`POST /pulls/{index}/merge`의 `do:"manually-merged"`
(+`merge_commit_id`). Gitea PR 자체엔 "거부(rejected)" 개념이 없어
`GitSyncQueueEntry`와 같은 원칙(외부가 안 주는 상태만 얇게 얹음)으로
`PullRequestMeta`(projectId+prIndex 복합키, disposition/
lastMergeError)를 신설.

**데이터 모델**: `PullRequestMeta`(신규) + `CodeRelation.branchName
String?`(nullable 추가 컬럼, 기존 데이터 안 깨짐) + `DocumentBranchLink`
(신규, `DocumentSourceLink`를 filePath→branchName으로 그대로 미러링).
**의도적 비대칭**: `CodeRelation.branchName`은 브랜치 삭제 시 웹훅으로
즉시 일괄 삭제되지만(관계도는 "지금 탐색 상태"), `DocumentBranchLink`는
브랜치가 삭제돼도 영구 보존한다(문서 쪽은 "이 문서가 어느 브랜치를
거쳤는지"라는 역사적 기록) - 설계자에게 명시적으로 플래그하고 그대로
승인됨.

**백엔드**: `core/gitea.ts`에 PR 댓글/타임라인/커밋 조회, `state`
전이(Close/Reopen), `mergePullRequestManually` 추가. 신규
`core/pullRequests.ts`(gitea.ts/gitRepos.ts와 별도 모듈 - PR
오케스트레이션은 자체 완결된 도메인) - `mergePull`(실패 시
`lastMergeError` 기록 + `[PR#n] `태그 메시지, 칸반 카드의 대괄호
태그 관례 재사용)/`mergePullManually`/`rejectPull`/`closePull`
(disposition이 아직 없으면 자동으로 rejected로 간주)/`reopenPull`
(disposition을 null로 리셋해 다음 머지가 자연스럽게 덮어쓰게 함).
`core/pushHooks.ts`에 `delete` 이벤트 파싱(`verifyAndParseDeleteWebhook`,
서명 검증은 `verifyGiteaSignature`로 공유) +
`handleGiteaSystemDelete` → `codeRelations.deleteRelationsForBranch`
(설계자별 소유 스코프의 유일한 의도적 예외 - 브랜치가 사라지면 모든
설계자에게 동시에 무의미해지므로). 시스템 웹훅이 `push`뿐 아니라
`delete`도 구독하도록 `createSystemWebhook` 변경 + **기존 배포에도
반영되도록** `ensureGiteaSystemWebhookConfigured`가 이미 등록된
웹훅의 events에 `delete`가 없으면 PATCH로 보강(재배포 시 수동 조치
불필요). 신규 `core/documentBranchLinks.ts`(`documentSourceLinks.ts`
완전 미러). CLI/MCP 공유 `cli/apiclient.ts`에
`detectCurrentGitBranch()`(`execFileSync("git",["rev-parse",
"--abbrev-ref","HEAD"])`, 실패 시 전부 null로 fail-soft) - `relation
add/update/list`에 `--branch`/`--all-branches` 배선.

**실측으로 발견·수정한 배포 문제 2건**(둘 다 사전에 알 수 없었고
실제 Gitea 인스턴스로 왕복 검증하다 발견):
1. **Gitea 스코프 토큰 체계** - PR을 issue로 취급하는 Gitea가 댓글/
   타임라인 조회에 `read:issue`/`write:issue` 스코프를 별도로
   요구한다(repository 스코프만으론 403). 기존 관리자 API 토큰
   (`GITEA_API_TOKEN`)과 설계자별 PAT 발급 함수
   (`createUserAccessToken`, 기존엔 `write:repository`만 요청)
   둘 다 `write:issue`가 없어서 막혔던 것을 실제로 재현해 확인 -
   `createUserAccessToken`의 요청 스코프에 `write:issue` 추가,
   README.md의 Gitea PAT 발급 안내에도 issue 스코프 필요성 명시.
   기존에 이미 발급된 토큰은 `docs git my-token`으로 재발급해야
   반영됨(자동 소급 불가 - 안내로 충분하다고 판단).
2. **`allow_manual_merge` 저장소 기본값이 false** - Gitea가 새
   저장소를 만들 때 이 설정을 기본으로 꺼둬서(swagger의
   `CreateRepoOption`엔 이 필드 자체가 없어 생성 시점엔 못 켬),
   수동 머지 완료 기록이 "manually-merged is not allowed" 405로
   항상 실패하던 것을 실제로 재현해 발견 - `gitea.ts`의 `createRepo`/
   `migrateRepo`(work 저장소만, mirror는 PR이 없어 불필요)가 생성
   직후 `PATCH .../repos/{owner}/{repo}` `{allow_manual_merge:true}`
   를 자동으로 걸도록 수정.

**프론트엔드**: `repo/pulls`(목록, `Pagination.vue` 재사용, 최신순+
state 필터) / `repo/pulls/:index`(상세) 신규 라우트 - `documents`/
`documents/:trackingCode` 형제 라우트 분리 패턴 그대로. 신규
`components/PullRequestTimeline.vue`(이 코드베이스에 타임라인/활동
피드 컴포넌트가 전혀 없어 새로 제작 - type별 아이콘 색상의 세로
카드 피드). `RepoManagementView.vue`는 최신 5개+"더보기"로 축소,
인라인 머지 버튼/로직은 제거해 상세 페이지로 이전(PR 생성 폼은
브랜치 목록과 결합돼 있어 그대로 유지). `DocumentEditorView.vue`에
"연관 브랜치" 섹션 추가(기존 "연관된 소스 코드" 섹션과 병렬 구조).

**실측 검증**: 백엔드/프론트 `tsc`/`vue-tsc` 클린 →
`audit:cli-mcp`(신규 `pr_*`/`document_link_branch` 등 대칭 확인,
`link_branch`/`unlink_branch`/`branch_links` 를 `KNOWN_RENAMES`에
등록) → Docker 이미지 재빌드+재기동(`db push`로 postgres 스키마
반영 확인) → 실제 로컬 clone(`git clone`)으로 브랜치 3개 생성해
PR 4개 실전 왕복: **PR#1** 생성→자동 머지 성공(`disposition:
"merged"`, `[PR#1] 머지되었습니다.` 메시지 확인) → **PR#2** 거부
(`disposition:"rejected"`) → 재오픈(`disposition`이 null로
리셋되는지 확인) → 새 커밋 push → 재머지 성공(**요구사항 5 핵심
시나리오 - 거부 후에도 결국 Accept 도달 확인**) → **PR#3** 머지/
거부 선택 없이 바로 Close(`disposition`이 자동으로 "rejected"로,
메시지 문구도 정확히 확인 - **요구사항 6 확인**) → **PR#4** 실제
머지 충돌을 만들어(같은 파일을 서로 다른 브랜치에서 다르게 수정)
자동 머지 실패시켜 `lastMergeError`가 기록되고 새로고침 후에도
남아있는지 확인 → 실제로 로컬에서 충돌 해결 후 push → 그 커밋
SHA로 `merge-manually` 호출 → Gitea가 실제로 `merged:true`로
표시하는지 확인(**요구사항 4 핵심 시나리오**, 위 `allow_manual_merge`
버그를 이 과정에서 발견·수정). 웹 UI에서도 목록(최신순, 배지 정확)/
상세(메시지·커밋·대화·진행내역 4섹션, 액션 버튼 상태별 노출)를
직접 클릭해 확인, 댓글 작성 후 진행내역에 실시간 반영되는지도 확인.
**브랜치 자동 감지**: 실제 로컬 clone에서 `git checkout`으로 브랜치를
오가며 플래그 없이 `relation list`가 자동으로 바뀌는지, `--all-branches`
가 전체를 보여주는지 확인. **브랜치 삭제 cascade**: 문서에
`link-branch`로 브랜치를 연결해두고 실제로 Gitea API로 그 브랜치를
삭제 → 시스템 웹훅의 `delete` 이벤트가 실제로 처리돼(로그로 확인)
그 브랜치의 코드 관계는 삭제되고, **문서의 브랜치 링크는 그대로
남아있는지**(핵심 비대칭) 웹 UI로 직접 확인. 테스트 프로젝트/그룹/
문서/로컬 clone은 검증 후 정리.

## Gitea 프로젝트별 네임스페이스 + nginx 보안 강화 + 관계도 초기화/추적코드 선택기 + 도입·마이그레이션 가이드 - 완료 (2026-09-13)

**배경**: 설계자 지시(대형 수정, 5개 파트) - (1) self_hosted Gitea
저장소가 "환경변수로 제공된 Gitea 외부 접속 주소" 변경에 대응하도록,
그리고 Gitea 네임스페이스(조직)를 프로젝트별로 적극 활용하도록 개편.
(2) 보안 강화 - Gitea에 생성되는 모든 저장소가 특별한 명시 없이는
Gitea 자체 Web UI로 조회 불가능해야 함(nginx가 `.git` 요청만 Gitea로
돌리는 구조 제안). (3) 관계도 탭에 "관계도 초기화"(브랜치별/전체,
확인 다이얼로그) 버튼과, 관계 추가 다이얼로그의 추적코드 입력을
텍스트 대신 선택기로. (4) README.md/CLAUDE.md에 "이 시스템 도입"
가이드(설치 시나리오 6종 + 마이그레이션 시나리오 3종 + 백업/
MIGRATION.md 규율) 작성, 그리고 앞으로 중대한 스키마 변경 시
마이그레이션+검증 스크립트를 반드시 만드는 규칙을 CLAUDE.md에
명문화. (5) CLAUDE.md/DESIGN-NOTES.md/FEATURES.md/PLANS.md/
QA-SCENARIOS.md 정비.

**설계자가 확인한 핵심 결정 2가지**(AskUserQuestion): 기존 프로젝트들의
Gitea 저장소도 새 네임스페이스로 **실제 이전**한다(마이그레이션
스크립트, "새 프로젝트만 적용" 아님) - "전부 이전(권장)" 선택.
Gitea 호스트 포트 노출을 **완전히 제거**하고 최초 관리자 계정/PAT
발급도 웹 설치 마법사 대신 `docker exec ... gitea admin user
create`/`generate-access-token` CLI로 전환한다 - "포트 노출 제거 +
CLI로 부트스트랩(권장)" 선택.

**Gitea 프로젝트별 네임스페이스(`#gitea-per-project-namespace`)**:
예전엔 설치 전체가 하나의 고정 org(`cnwk-projects`)를 공유했다
(`core/gitea.ts`의 `orgLogin()`/`DEFAULT_ORG_LOGIN`) - 이제 프로젝트
하나당 org 하나(`GITEA_ORG_PREFIX`+projectId, 기본 `proj-`)로
개편했다. org 안 저장소 이름도 `project-<id>[-work/-mirror]` slug
대신 짧은 고정 이름(`repo`/`work`/`mirror`)으로 단순화 - 이미 org
자체가 프로젝트를 유일하게 식별하므로 저장소 이름에 projectId를 또
담을 필요가 없다. `gitea.ts`의 약 30개 export 함수 전부 `slug:
string` 대신 `GiteaRepoRef { org, repo }` 객체를 받도록 시그니처
변경(별도 org 인자 추가가 아니라 인자 하나의 타입만 바꾸는 방식 -
호출부마다 인자 순서 실수 여지를 없앰). `gitRepos.ts`의
`slugForProject`/`mirrorSlugForProject`/`workSlugForProject`/
`resolveProjectFromSlug`는 `orgForProject`/`selfHostedRef`/
`mirrorRef`/`workRef`/`resolveProjectFromOrgAndRepo`로 교체,
`requireGiteaWorkingSlug` → `requireGiteaWorkingRef`. org 생성은
더 이상 서버 부팅 시 1회가 아니라 프로젝트가 처음 Gitea 저장소를
연결하는 시점(`ensureProjectOrgConfigured`, `linkSelfHostedRepo`/
`linkExternalAsPrimary` 진입부)에 지연 생성된다. 시스템 웹훅
핸들러(`pushHooks.ts`)는 `repository.name`(slug) 대신
`repository.owner.login`(org)+`repository.name`(저장소 이름)으로
프로젝트를 판별하도록 변경 - 실제 push로 `repository.owner.login`
필드 존재를 실측 확인.

**동적 `PUBLIC_GITEA_URL` 재계산**: self_hosted 저장소의 `repoUrl`을
생성 시점에 Gitea가 반환한 `clone_url`로 얼려두지 않고, 새 env
`PUBLIC_GITEA_URL`이 설정돼 있으면 `gitRepos.ts`의 `toInfo()`가 조회
시점마다 `${PUBLIC_GITEA_URL}/${org}/repo.git`로 다시 계산해 반환한다
(fail-soft - 미설정 시 DB 저장값 폴백, `external_linked`의 GitHub/
GitLab 쪽 URL은 절대 안 건드림) - 도메인 이전 후에도 저장소를 다시
만들지 않고 즉시 반영되도록.

**마이그레이션/검증 스크립트**(`backend/scripts/migrate-gitea-namespaces.ts`
+`verify-gitea-namespaces.ts`, `npm run migrate:gitea-namespaces`/
`verify:gitea-namespaces`로 수동 실행) - 레거시 슬러그 계산은 이
스크립트 안에만 고정 재현(gitRepos.ts에서 완전히 제거됨). 각 저장소를
먼저 새 위치에 이미 존재하는지 GET으로 확인(멱등 - 재실행 시 스킵)
한 뒤, Gitea의 저장소 이전(transfer) API를 시도하고 실패하면 `git
clone --mirror`+`push --mirror` 폴백으로 히스토리를 그대로 복사(이
폴백을 위해 `backend/Dockerfile`에 `git` 패키지 추가, `scripts/`
디렉터리도 이미지에 포함). 항목별 `{projectId, provider, status,
detail}` 결과표 출력, 실패 시 종료 코드 1. **실제 프로덕션급 데이터로
검증**: 기존 세션에서 쌓인 실제 프로젝트 11건(self_hosted 9건,
external_linked 1건-mirror+work 2저장소, 이미 새 스킴으로 만든 프로젝트
1건, Gitea에서 저장소가 이미 삭제된 고아 DB행 1건)에 실행 - transfer
API가 즉시 완료되는 것을 실측 확인(별도 accept 단계 불필요, 폴백
경로는 실제로 안 쓰임)해 9건 전부 성공, 신규 프로젝트 1건은
"이미 이전됨"으로 정확히 스킵, 고아 행 1건만 명확한 실패 사유와 함께
보고됨(스크립트 버그 아님 - 사전에 이미 Gitea에서만 지워진 데이터
불일치). `verify-gitea-namespaces`로 전부 재확인, 이전된 프로젝트의
기존 PR 이력(디스포지션 포함)이 그대로 조회되는 것도 확인.

**보안 강화 - nginx 리버스 프록시(`#gitea-nginx-lockdown`)**:
`backend/docker/nginx/default.conf`(신규) - `^/[^/]+/[^/]+\.git(/.*)?$`
경로만 Gitea로, 나머지 전부 backend로 프록시. `docker-compose.yml`에
`nginx` 서비스 추가(유일한 기본 host 노출, `:80`), `gitea`/`backend`
서비스의 `ports:`는 완전히 제거하고 "임시 디버깅용" 주석과 함께
주석 처리된 오버라이드만 남김. `server.ts`에 `app.set("trust proxy",
1)` 추가(nginx의 `X-Forwarded-*` 헤더를 신뢰해야 GitHub OAuth
리다이렉트 URI 계산 등이 프록시 뒤에서도 정확함). 최초 관리자 계정/
PAT 발급은 README.md에서 웹 설치 마법사 절차를 `docker exec ...
gitea admin user create`+`generate-access-token` CLI 절차로 완전히
교체 - Gitea 포트가 아예 안 열리므로 웹 UI 자체에 최초 설치 단계에서도
안 들어가도 된다. **실측 검증**: 스택 재기동 후 `docker compose ps`로
gitea/backend 포트 미노출+nginx(80)만 노출 확인 → `curl localhost:3001`/
`:8760` 연결 자체 거부 확인 → nginx(80)를 거친 실제 `git clone`/
`push`(대용량 push 대비 `client_max_body_size 0` 포함) 성공 확인 →
같은 origin의 비-`.git` 저장소 경로가 Gitea 웹 UI가 아니라 이 앱
자신의 프론트엔드 HTML을 반환하는 것 확인 → `docs auth login` 등
API 전체가 nginx 경유로 정상 동작 확인.

**관계도 초기화 + 추적코드 선택기(`#relations-reset-and-picker`)**:
`core/codeRelations.ts`에 `resetRelations(projectId, userId, {branchName?,
allBranches?})` 신규(다른 모든 함수와 동일하게 항상 (projectId,
userId)로 스코프 - 브랜치 삭제 웹훅용 `deleteRelationsForBranch`와
달리 설계자 본인이 요청하는 동작이라 자기 소유만 지움).
`DELETE /api/projects/:projectId/relations/reset`(`branchName`이
없으면 브랜치 없음 버킷, `allBranches=true`면 전체) - 기존 `bulk`
라우트들과 같은 이유로 `/relations/:id`보다 먼저 등록. CLI `docs
relation reset`/MCP `relation_reset` 대칭 추가(`audit-cli-mcp` 자연
통과, 새 예외 불필요). 프론트(`RelationsView.vue`) - 툴바에 "관계도
초기화" 버튼 → 확인 다이얼로그(브랜치 select: 모든 브랜치/브랜치
없음/실제 distinct 브랜치명들, `GET .../relations?allBranches=true`
전체 조회에서 파생 - 화면에 이미 로드된 `relationCache`는 일부만
담고 있어 신뢰 못 할 소스이므로 다이얼로그를 열 때마다 별도로 전체
조회). 추적코드 입력은 텍스트 `<input>`에서 "추적코드 선택" 버튼(기존
`entityPicker.pick({kind:"document", multi:true})` - `QAPanel.vue`의
`pickRefs()`와 동일 패턴) + 칩 목록(개별 제거)으로 교체, `formTrackingCodes`
는 그대로 콤마 조인 문자열로 유지해 `submitForm()`/`openEditForm()`
무수정. `CodeRelationDetail` 인터페이스에 빠져있던 `branchName` 필드도
추가(백엔드는 이미 반환 중이었음). **실측 검증**: 웹 UI에서 초기화
다이얼로그 열기(브랜치 옵션 실제로 뜨는지) → "브랜치 없음" 선택 삭제 →
CLI로 재조회해 실제로 지워졌는지 확인. "새 관계 추가" 폼에서 추적코드
선택 버튼 클릭 → 문서 선택 다이얼로그에서 검색+체크+확인 → 칩으로
반영 → 저장 → 상세 패널에 연관 문서로 정확히 표시되는 것까지 확인.

**도입/마이그레이션 가이드(`#adoption-migration-guide`)**: README.md에
"도입 시나리오별 안내" 신설 - 로컬/원격 × 신규/기존 설치 + 폴더 전용
설치 + 로컬→원격 이전까지 6가지, 각각 구체적 명령(공통 절차:
`git link` → `git remote add`+`push`(백엔드가 clone/push를 대행하지
않으므로) → `template deploy`(Gitea REST 커밋이라 로컬엔 `git pull`
필요 - `server.ts`의 실제 `putFileContent()` 호출 확인 후 서술) →
`git pull`). 루트 `CLAUDE.md`에 새 절 "다른 프로젝트에 이 시스템을
도입하는 방법" - 설치 시나리오 판단(README 참고) + 마이그레이션
시나리오 3종(CLAUDE.md/AGENTS.md 있음 / 콘텐츠는 있지만 그 파일들
없음 / 완전히 빈 프로젝트) 판단 + 공통 절차(git 저장소면 백업 브랜치,
아니면 격리 폴더 백업 → `MIGRATION.md` 생성해 진행 추적 → 콘텐츠
이전(`docs migrate scan/apply`는 concept 스타일 frontmatter 문서
한정 - `cli/migrate.ts` 재확인 후 서술) → 완료 후 `MIGRATION.md` 삭제).
"작업 방식" 절에 새 표준 규칙 추가 - 설계자 계정/프로젝트/문서 등
기존 설치 데이터에 영향을 주는 스키마 변경은 `db push`만으로 끝내지
않고 이번 라운드의 마이그레이션+검증 스크립트 패턴을 앞으로도 표준
적용한다.

## Gitea 네임스페이스/보안 강화 QA 후속 라운드 - 완료

**배경**: 위 Gitea 프로젝트별 네임스페이스(`#gitea-per-project-namespace`)
+ nginx 보안 강화(`#gitea-nginx-lockdown`) 구현 라운드를 실제 Docker
스택에 대해 회귀 QA로 재검증한 라운드. 설계자가 "푸시 커밋하고 QA
진행해 - 자고 올테니 승인이 필요한건 모아놔"라고 지시해, 코드를 고치는
라운드가 아니라 이미 구현된 것을 실측으로 다시 확인하고 승인이
필요한 항목만 모아두는 라운드로 진행했다.

**검증 내역**: org-per-project 생성 + 웹훅 `repository.owner.login`
매칭(실제 push로 재확인), `PUBLIC_GITEA_URL` 미설정 시 DB 저장값
폴백, `migrate-gitea-namespaces`/`verify-gitea-namespaces`를 레거시
공유-org 테스트 프로젝트 11개에 대해 실행(멱등성 - 재실행 시 전부
스킵됨도 확인), `git link-external`(mirror+work 생성)/`git
unlink`(rename+히스토리 보존+mirror 정리)/멤버 추가·제거 시 Gitea
협업자 동기화/프로젝트 삭제 시 org 삭제(`GET /orgs/{org}` 404로 확인)
전부 실측, `gitea admin user create`/`generate-access-token`의 정확한
플래그를 `--help`로 재확인(README와 일치), nginx를 통한 5MB 크기 push
성공, Web UI 비-`.git` 경로가 여전히 완전히 비노출인지 확인.

**발견한 문제**: 코드 버그는 0건. 다만 QA용 로컬 `.env`에
`PUBLIC_GITEA_URL=http://localhost:3001`(nginx 도입 전, Gitea 포트를
직접 노출했던 시절의 값)이 그대로 남아있어, 화면에 표시되는 clone
주소가 이제는 닫혀있는 포트를 계속 가리키는 것을 발견했다 - 기존
설치를 이번 nginx 보안 강화로 업그레이드하는 모든 사용자가 겪을 수
있는 실제 함정이라 판단해, README.md의 업그레이드 절차에 이 상황을
명시하는 경고 문단을 추가했다(`PUBLIC_GITEA_URL`을 포트 없는
`PUBLIC_BACKEND_URL`류 주소로 갱신 + `docker compose up -d
--force-recreate backend` 재기동 필요).

**승인 대기로 남긴 항목**: QA-SCENARIOS.md에 기존에 있던 GitHub/GitLab
실제 발행(publish) 왕복 테스트(`[ ]` 항목)는 실제 외부 저장소
자격증명이 필요해 이번 라운드에서 수행하지 않고 설계자에게 그대로
남겨뒀다 - 임의의 공개 저장소(예: `octocat/Hello-World`)에 대해
push/publish를 실측하는 것은 범위 밖의 부작용을 일으킬 수 있어 시도하지
않았다(읽기/clone은 Gitea 자체 mirror 기능으로만 확인).

**결론**: 이번 라운드는 코드 변경 없이 문서(README.md 경고 문단,
QA-SCENARIOS.md 해당 두 항목의 "후속 QA 라운드 추가 검증" 절)만
갱신했다. 위 두 기능(`#gitea-per-project-namespace`,
`#gitea-nginx-lockdown`)의 모든 "확인 필요" 항목이 이번 라운드로 전부
실측 확인됐다.

## 도입/마이그레이션 가이드 실측 리허설 + `auto_init` 버그 수정 - 완료

**배경**: 설계자가 `test` 브랜치에서 README.md/CLAUDE.md의 "다른
프로젝트에 이 시스템을 도입하는 방법"(`#adoption-migration-guide`)
절차를 실제로 끝까지 실행해 검증해보라고 지시했다. 그동안 이 가이드는
코드 검토와 부분적 실측(예: `migrate scan/apply`의 BOM/멱등성 버그
수정 라운드)만 거쳤지, 백업 브랜치 → `MIGRATION.md` → `git link` →
push → 콘텐츠 이전 → `template deploy` → `git pull`까지 전체 절차를
처음부터 끝까지 이어서 실행해본 적은 없었다.

**리허설 방법**: `concept` 브랜치의 실제 문서 5건(DC-00001/00002,
DS-00001, PL-00001, SP-00001 - 상호 링크 포함, 상태 어휘도 `applied`/
`active`/`done` 등 실제 값)을 가져와 로컬 git 저장소를 구성하고,
CLAUDE.md가 존재하는 시나리오 1로 취급 - 가이드가 명시한 순서(백업
브랜치 → `MIGRATION.md` → 프로젝트 생성/`git link` → `git remote add`
+`push` → `migrate scan`→검토→`migrate apply` → `template deploy`+
`git pull` → 정리)를 그대로 실행했다.

**발견한 문제**: `template deploy` 후 `git pull`이 "Already up to
date"만 보이고 CLAUDE.md/SKILL.md를 전혀 받지 못했다. 원인 추적 결과
`gitea.createRepo()`가 `auto_init: true`로 호출되고 있었다 - 이
함수의 유일한 호출부인 `linkSelfHostedRepo()`(가져올 외부 저장소가
없는 "빈 저장소" 케이스)의 기존 주석은 이미 "없으면 빈 저장소"라고
명시하고 있었는데, 실제 구현은 Gitea가 스스로 기본 브랜치(README
자동 커밋 포함)를 만들게 하고 있어 주석과 동작이 어긋나 있었다.
그 결과 설계자가 로컬에서 다른 이름의 브랜치로 push하면(이번
리허설에서는 `master`) Gitea가 미리 만든 기본 브랜치(`main`)와
완전히 무관한 별개 브랜치가 되고, `template deploy`는 항상 저장소의
`default_branch`에 커밋하므로 그 커밋이 설계자의 브랜치에는 영원히
나타나지 않는다 - 원격 브랜치 이름이 로컬과 우연히 같았다면 오히려
공통 조상이 없는 히스토리라 `git push`가 non-fast-forward로 거부됐을
것이다.

**수정**: `backend/src/core/gitea.ts`의 `createRepo()`를
`auto_init: false`로 바꿔 호출부의 원래 의도(빈 저장소)와 실제 동작을
일치시켰다. `createRepo()`의 호출부는 이 한 곳뿐이라(`grep`으로
확인) 다른 흐름(옵션 2/3의 `migrateRepo` 경로는 항상 외부 저장소의
실제 브랜치를 그대로 복제하므로 이 문제와 무관)에 영향이 없다.
프런트엔드(`ChangeTrackingView.vue`)에는 이미 "커밋이 없습니다"
빈 상태 문구가 있어, 빈 저장소 상태 자체는 이미 예견되고 있던
설계였다는 것도 재확인했다.

**재검증**: 백엔드 재빌드(`docker compose up -d --build backend`) 후
새 테스트 프로젝트로 동일 절차 재실행 - `git link` 직후
`GET .../repo`가 `empty:true`를 반환, 로컬 `master` 브랜치를 push하자
그 저장소의 `default_branch`가 정확히 `master`로 바뀜, `template
deploy` 후 `git pull`이 `Fast-forward`로 CLAUDE.md+SKILL.md를 정확히
받아옴을 확인. 원래 리허설이었던 5건 문서 이전 배치도 `migrate
apply`가 0 errors로 전부 생성했고, 배치 안에서 해석되는 링크(예:
DC-00001→DS-00001/SP-00001/PL-00001)는 정확히 연결되고 배치 밖
대상(SP-00002/00003/00004, DN-00001)은 경고로 건너뛰었으며, 상태
프리셋(`active`→`approved`, `done`→`approved`)과 미매핑 값(`applied`)의
안전한 실패(초기 `draft` 유지+경고)도 전부 의도대로 동작함을 재확인
- `migrate apply` 재실행 시 5건 전부 `alreadyApplied`로 멱등성도
재확인.

**결론**: 가이드 문서(README.md/CLAUDE.md) 자체는 절차 서술이
정확했고 고칠 필요가 없었다 - 문제는 코드(`gitea.ts`)가 그 문서와
자기 자신의 주석이 말하는 의도를 실제로 지키지 못하고 있던 것이었다.
이 라운드는 `test` 브랜치에서 리허설한 뒤 설계자 확인을 받아 `main`에
병합했다(fast-forward) - 리허설에 쓴 로컬 스크래치 fixture와 Gitea
테스트 프로젝트 2건은 정리·삭제, `test` 브랜치 자체도 삭제.

## 실제 신규 설치(C:\CNW) 구성 중 발견한 신규 설치 버그 2건 - 완료

**배경**: 설계자가 실제로 이 컴퓨터에 이 시스템의 "진짜 설치"를 하나
만들자고 지시했다 - 지금까지 이 저장소의 모든 QA/리허설은 이미
한참 전에 만들어진 dev 스택(웹 설치 마법사 시절부터 누적된 Gitea
volume, 오래된 Postgres volume 등)을 계속 재사용해왔는데, 정작
"처음부터 완전히 새로 설치"하는 경로 자체는 이번이 처음이었다.
개발용 docker 스택은 중지하고, GitHub origin에서 새로 clone한
`C:\CNW`를 앞으로 실제 운영 설치로 쓰기로 했다.

**발견 1 - `backend/docker-entrypoint.sh`가 CRLF로 체크아웃돼 컨테이너
기동 자체가 실패**: 이 저장소에 `.gitattributes`가 없어서
`core.autocrlf=true`인 이 머신에서 `git clone`하면(dev 체크아웃은 예전에
다른 설정으로 받아둔 상태라 LF였을 뿐, 새 clone은 기본값을 그대로
따른다) 셸 스크립트가 CRLF로 체크아웃되고, 리눅스 컨테이너 안에서
셔뱅 줄의 `\r` 때문에 "exec ./docker-entrypoint.sh: no such file or
directory"로 backend가 계속 재시작만 반복했다. `.gitattributes`에
`*.sh text eol=lf`를 추가해 클론하는 머신의 git 설정과 무관하게 항상
LF로 체크아웃되게 고쳤다.

**발견 2 - 완전히 새 Gitea volume은 CLI 부트스트랩 자체가 막혀 있었음**:
`#gitea-nginx-lockdown` 라운드에서 "웹 설치 마법사 폐지 + CLI로 관리자
계정/PAT 발급"으로 바꿨는데, 그 CLI(`gitea admin user create`/
`generate-access-token`)가 **한 번도 웹 설치를 거치지 않은 진짜 새
volume**에서는 Gitea가 `INSTALL_LOCK=false` 상태로 부팅되기 때문에
"Unable to load config file for a installed Gitea instance"로 거부되는
것을 발견했다 - 이 저장소의 dev 스택 Gitea는 그 기능이 생기기 훨씬
전에 웹 마법사로 이미 설치를 마친 volume이었으므로, 그동안 이 문제를
한 번도 실측할 기회가 없었다. `docker-compose.yml`의 `gitea` 서비스에
`GITEA__security__INSTALL_LOCK: "true"`를 추가해 완전히 새 volume도
부팅 시점부터 곧바로 CLI만으로 부트스트랩 가능하게 고쳤다(빈 volume을
지우고 재생성해 재확인).

**발견 3(코드 아님, 배포 topology) - Docker Compose 프로젝트 이름
충돌로 두 설치가 같은 DB volume을 공유**: `docker compose`는 기본적으로
"현재 디렉터리 이름"만으로 프로젝트를 식별한다 - 이 저장소는 항상
`backend/docker`라는 같은 폴더명을 쓰므로, dev 체크아웃과 새 설치가
경로는 다른데도 똑같이 `docker_postgres-data` 등의 이름으로 볼륨을
만들어버려 완전히 별개인 두 설치가 같은 DB를 그대로 공유하는 상황이
실제로 벌어졌다(새 설치의 Postgres가 dev 설치의 옛 비밀번호로 인증
실패하는 형태로 발견). 코드 문제가 아니라 운영 안내 문제라 README.md
"실행 방법" 절과 `.env.example`에 `COMPOSE_PROJECT_NAME`으로 분리하라는
경고를 추가했다.

**검증**: 위 두 코드 수정(.gitattributes, INSTALL_LOCK) 후
`C:\CNW`에서 처음부터 다시 - 완전히 새 volume으로 스택 기동 → backend
정상 부팅 → 앱 자체 관리자(`admin`/`12345678`) 로그인 → Gitea 관리자
계정 생성+PAT 발급 → `.env` 반영 → CLI `auth login`/`project-create`/
`git link`로 실제 org(`proj-<projectId>`)와 저장소가 생성되는지까지
전부 왕복 확인. 스모크 테스트로 만든 프로젝트는 확인 후 삭제.

**결론**: 이 라운드는 기존 QA가 전부 "이미 설치돼 있던 스택"을
전제로 진행돼 놓쳤던, 진짜 최초 설치 경로 자체의 버그 2건(코드)+운영
안내 공백 1건을 찾아 고쳤다. `C:\CNW`는 이제부터 이 시스템의 실제
운영 설치로 쓰인다 - 이 저장소(`C:\GitHub\claude-native-workflow`)는
계속 개발/QA 전용으로 남는다.

## frontend를 별도 compose 서비스로 분리(`#frontend-own-service`) - 완료

**배경**: 설계자가 "frontend도 docker-compose.yml에 묶어서 같이
올려줘야 한다"고 지시 - 예전엔 frontend가 `backend/Dockerfile`의
multi-stage 빌드 안에 함께 빌드돼 backend가 그 결과물(`dist/`)을 같은
오리진에서 정적 서빙했다("단일 설치형" 원칙의 일환). 설계자 요구는
frontend를 `docker-compose.yml`에 자기 자신의 서비스로 명시적으로
묶고, backend API와 frontend를 nginx가 한 번에 라우팅하도록
재구성하는 것 - 추가로 `docker-compose.yml` 자체도 `backend/docker`
에서 저장소 루트로 옮기라는 지시도 함께 받았다.

**변경**:
- `docker-compose.yml`/`.env.example`/`nginx/default.conf`를
  `backend/docker/`에서 저장소 루트로 이동(`git mv`로 이력 보존).
  `backend/Dockerfile`의 build `context`를 `../..`(구 위치 기준
  저장소 루트)에서 `.`(신 위치 자체가 이미 저장소 루트)로 조정.
- `frontend/Dockerfile`(신규) - 2단계 빌드(node로 `npm run build` →
  `nginx:alpine`이 `dist/`를 정적 서빙). `frontend/nginx.conf`(신규) -
  Vue Router가 `createWebHistory`(SPA)라 `try_files $uri $uri/
  /index.html`로 폴백 필요.
- `docker-compose.yml`에 `frontend` 서비스 추가, `nginx`의
  `depends_on`에 포함.
- 루트 `nginx/default.conf` - 기존엔 `.git` 경로만 gitea로, 나머지
  전부(`/api` 포함) backend로 보냈는데, 이제 `/api/`는 backend로,
  나머지는 frontend로 분리(backend의 모든 HTTP 라우트가 예외 없이
  `/api` 아래에 있음을 `server.ts` 재확인 후 안전하게 분리).
- `backend/src/api/server.ts`의 "프런트엔드 정적 서빙" 블록(및
  이제 안 쓰는 `fs`/`path`/`fileURLToPath` import) 전체 삭제 - frontend
  가 자기 nginx로 분리된 뒤로는 도달 불가능한 죽은 코드였다.
- `backend/Dockerfile`에서 frontend 빌드 스테이지와
  `COPY --from=frontend-build` 제거.
- README.md "실행 방법"(`cd backend/docker` 삭제, 루트에서 바로
  실행) + "호스트에 직접 설치" 절(backend가 더 이상 frontend를
  서빙하지 않으므로, 별도 정적 서버+리버스 프록시가 필요하다는 안내로
  교체) + `COMPOSE_PROJECT_NAME` 경고 문단(디렉터리 이름이 이제
  "backend/docker" 고정이 아니라 저장소 클론 폴더 이름 자체이므로
  설명을 그에 맞게 갱신) 갱신. FEATURES.md §21(git 저장소/도입) 관련
  서술도 새 아키텍처로 갱신.
- `frontend/.dockerignore`(신규) - `frontend/Dockerfile`의
  `COPY . ./`가 호스트의 `frontend/node_modules`(이 저장소 자신의
  로컬 개발 환경에 이미 설치돼 있었음)까지 그대로 빌드 컨텍스트에
  실어 보내, `npm ci`로 이미 리눅스용으로 설치해둔 컨테이너 안
  `node_modules`를 다시 덮어써버리는 걸 직접 빌드해보며 발견 - 빌드
  컨텍스트 전송 시간도 그만큼 늘어났었다. `node_modules`/`dist` 제외로
  수정.

**검증**: `tsc --noEmit`/`npm run audit:cli-mcp` 클린 확인 후,
`docker compose build backend frontend`로 두 이미지 빌드 성공 확인 →
스택 기동(postgres/meilisearch/gitea/backend/frontend/nginx, 포트는
기존 dev 스택/`C:\CNW`와 안 겹치게 별도 값 사용) → 브라우저로 실제
로그인 왕복(`/` → frontend 로그인 화면 렌더 → 로그인 제출 →
`/api/auth/login`이 nginx를 거쳐 backend로 정확히 라우팅 → 로그인 성공
후 프로젝트 목록 화면 정상 렌더) → SPA 딥링크 폴백(`/some/deep/route`
→ 200, index.html로 폴백) 확인. 검증에 쓴 컨테이너/볼륨은 전부 정리.

**결론**: frontend가 이제 backend와 완전히 독립적으로 빌드·재기동되는
별도 compose 서비스가 됐다 - backend 이미지는 API 전용이 되고, 정적
서빙/SPA 폴백은 frontend 자신의 nginx 책임이다. `docker-compose.yml`이
저장소 루트로 옮겨지면서 Docker Compose의 기본 프로젝트 이름도 더는
`backend/docker`(모든 클론에서 항상 동일)가 아니라 각 클론의 최상위
폴더 이름을 따르게 됐다 - 폴더 이름을 다르게 clone하는 한 이전보다
프로젝트 이름 충돌 위험도 자연히 줄었지만, `COMPOSE_PROJECT_NAME`
안내는 그래도 남겨뒀다(같은 이름으로 두 번 clone하는 경우까지
막으려면).

## 본인 비밀번호 변경(`#self-service-password-change`) - 완료

**배경**: `C:\CNW`를 실제로 쓰던 설계자가 admin 계정 비밀번호를 바꿔보려다
"내 정보" 화면에 그 기능 자체가 없다는 걸 발견 - `#password-reset`
라운드(admin 대행 재설정) 이후 QA에서 "self-service change-password는
범위 밖"이라고 확인만 하고 넘어갔던 바로 그 항목이 실제로 필요한
것으로 확정됐다. admin 대행 재설정(이메일 인증 인프라가 없어서 잊어버린
경우의 대안)과는 다른, 이미 로그인돼 있고 현재 비밀번호도 아는
통상적인 경우의 경로다.

**구현**: `core/auth.ts`에 `changeOwnPassword(userId, currentPassword,
newPassword)` 신규 - `argon2.verify`로 현재 비밀번호 확인 → `register()`
와 동일한 최소 8자 검증 → `hashPassword()`로 갱신(admin 대행 재설정의
`resetPasswordAsAdmin`과 헬퍼 공유, 스키마 변경 없음). `POST
/api/auth/me/password`(`authenticate`+`requireUnrestrictedScope` -
프로필 PUT과 동일한 스코프 게이트, 좁은 범위 API 키로는 못 바꾸게).
CLI `auth change-password --current --new` - `auth register/login/
logout`과 같은 이유(비밀번호가 대화 컨텍스트에 남으면 안 됨)로 MCP엔
의도적으로 없음(`audit-cli-mcp.ts`의 `KNOWN_CLI_ONLY`에 `auth_change_password`
추가). 웹 UI `UserProfileView.vue`의 "연락처" 카드 바로 아래에 "비밀번호"
카드 신설 - 현재/새/새 비밀번호 확인 3개 입력, 확인 불일치는 서버
호출 전에 클라이언트에서 먼저 막음, 성공 시 "비밀번호를 변경했습니다"
메시지와 함께 폼을 접는다.

**검증**: `tsc --noEmit`/`vue-tsc -b`/`audit:cli-mcp` 클린 확인 후
docker 스택을 재빌드해 HTTP로 직접 세 경우(틀린 현재 비밀번호 400,
너무 짧은 새 비밀번호 400, 정상 변경 200) 확인 + 변경 후 옛
비밀번호 로그인 거부/새 비밀번호 로그인 성공 확인. 브라우저로 실제
로그인 → "내 정보" → "비밀번호 변경" 폼에서 불일치 확인 메시지 →
재입력 후 저장 → 성공 메시지까지 왕복 확인.

## nginx Host 헤더 버그(GitHub OAuth 실패) + 데이터 바인드 마운트 전환 - 완료

**배경 1 - GitHub 로그인 실패**: `C:\CNW`를 실사용하며 설계자가 GitHub
OAuth 로그인 버튼을 눌렀더니 포트 번호가 없는 주소로 리다이렉트되며
실패한다고 보고. `server.ts`의 `githubOAuthRedirectUri()`가
`req.protocol`+`req.get("host")`로 콜백 URL을 동적 계산하는데,
`nginx/default.conf`가 `proxy_set_header Host $host;`를 쓰고 있었다 -
nginx의 `$host`는 원본 Host 헤더에서 **포트를 제거한** 값이라(`$http_host`
와 달리), 기본 포트(80/443)가 아닌 주소(`C:\CNW`는 `:8763`)로 접속하면
backend가 포트 없는 콜백 URL을 만들어 GitHub에 등록된 값과 어긋난다.
`$host` → `$http_host`로 교체해 수정 - `/api/git/oauth/github/start`를
`:8090` 스택으로 직접 호출해 `redirect_uri`에 포트가 정확히 포함되는지
확인.

**배경 2 - Docker Desktop 엔진 리셋으로 볼륨 전멸**: 이 수정을 검증하려고
스크래치 스택을 내리던 중 `overlay2` 파일시스템 I/O 에러로 Docker
엔진 자체가 응답 불능 상태가 됐고, 복구 과정에서 설계자가 실수로
Docker Desktop의 "Reset to factory defaults"를 눌러 이 컴퓨터의 모든
컨테이너/이미지/**네임드 볼륨**이 통째로 사라졌다(`C:\CNW`뿐 아니라
이 컴퓨터의 다른 무관한 프로젝트들도 전부 영향받음). `C:\CNW`의 git
체크아웃과 `.env`(둘 다 평범한 디스크 파일)는 안 지워져서 소스/시크릿은
살아남았지만, Postgres/Gitea/Meilisearch/EMQX 데이터는 전부 새로
초기화해야 했다(Gitea는 `GITEA_API_TOKEN`도 재발급 필요 - 옛 토큰은
새 DB에 없으므로 무효).

**변경**: 네임드 볼륨(Docker가 내부 저장소, 즉 WSL2 VHDX 등에 관리하는
공간이라 엔진 리셋에 같이 날아감)을 전부 `./data/<service>` 바인드
마운트로 교체(`#bind-mount-data-dir`) - 호스트 디스크의 평범한 폴더라
Docker 엔진을 통째로 초기화해도 그대로 남는다. `docker-compose.yml`의
postgres/meilisearch/emqx/gitea 네 서비스 전부 적용, 맨 아래 이제 안
쓰는 top-level `volumes:` 선언 삭제. `./data/`는 `.gitignore`에 추가
(런타임 데이터를 저장소에 커밋하지 않음).

**검증**: 바인드 마운트로 스택을 새로 띄워 postgres가 실제로
healthy해지는지(bind mount에서 흔한 PGDATA 권한 문제 없이) 확인,
로그인 API 호출 성공 확인, `./data/postgres`/`./data/gitea` 아래에
실제 파일(`PG_VERSION`, `ssh` 등)이 생기는지 디스크에서 직접 확인.

**결론**: `C:\CNW`도 이 커밋을 받아 재기동하면 이제 Docker 엔진을
리셋해도 데이터가 살아남는다 - 단, 이번에 이미 볼륨이 다 날아간
뒤라 Gitea 관리자 계정/PAT는 어차피 다시 발급해야 한다(README.md
"Gitea 설정" 절 그대로).

## 다음 단계

3단계 확장 설계(Phase A 사용자 관리, Phase B GitHub OAuth, Phase C
저장소 관리 탭) + 코드 관계도(`#code-relation-graph`) + PR 워크플로우
확장/브랜치 스코프 코드 관계도/문서-브랜치 연관(`#pr-workflow-branch-scope`)
+ Gitea 프로젝트별 네임스페이스/nginx 보안 강화/관계도 초기화·추적코드
선택기/도입·마이그레이션 가이드/실제 신규 설치 버그 수정/frontend
서비스 분리/본인 비밀번호 변경/nginx Host 헤더 버그/데이터 바인드
마운트 전환까지 전부 완료됐다. PLANS.md 색인 표에 남은 ⬜ 항목이
없다 - 유일하게 열려있는 항목은 GitHub/GitLab 실제 발행 왕복
테스트(외부 자격증명 필요, 설계자 승인/제공 대기)뿐이며, 다음 라운드는
새 QA 패스나 설계자의 새 요청을 기다린다.
