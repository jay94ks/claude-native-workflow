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

## 다음 단계

PLANS.md에 정리된 백로그(25개 항목, 태그로 QA-SCENARIOS.md와 연결)
중 다음 우선순위를 설계자와 함께 정한다.
