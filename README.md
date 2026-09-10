# claude-native-workflow v2

Claude와 함께 쓰는 문서/워크플로우 관리 시스템 - 단일 설치형, DB 기반
문서 관리, 커스터마이즈 가능한 타입 체계, 실시간 메시징/변경 전파.

이전(3단계 등급 구분) 구현은 [`concept`](../../tree/concept) 브랜치에
그대로 보존되어 있다. 이 브랜치(`main`)는 그 경험을 바탕으로 완전히
새로 설계한 v2 구현이다 - 설계 배경과 전체 아키텍처는 계획 문서
(대화 세션에서 작성, 저장소에는 아직 커밋 안 됨 - 진행 상황은
[DESIGN-NOTES.md](DESIGN-NOTES.md) 참고)를 참고.

## 지금 상태: Phase 5 (2/3) 완료

- Prisma 스키마(PostgreSQL/MySQL/SQLite 3드라이버, 완전 정규화 - JSON
  컬럼 없음)
- 인증(회원가입/로그인/JWT+리프레시 토큰)
- git 자격증명 저장(AES-256-GCM 암호화)
- 기관/프로젝트 그룹/프로젝트 계층(기관 단위는 선택적)
- 커스터마이즈 가능한 문서 타입 체계(DocType/DocStatus/DocStatusTransition)
- 문서 CRUD + 버전 이력 + 문서 간 링크(역참조 가능)
- 질의/답변(Question/Answer) 추적 - 트래킹 코드(`QU-XXXXXXXX`) 부여
- **추적 코드 중앙 레지스트리**(`TrackingCode`) - 코드 발급을 원자적
  insert로 예약(엔티티별 `@unique`만으로는 못 막는 타입 간 충돌 방지),
  유일성은 프로젝트 단위(기관·프로젝트 경계를 넘지 않음 - 서로 다른
  프로젝트는 같은 코드 문자열을 독립적으로 가질 수 있음)
- 코멘트, 보고서 생성
- Meilisearch 기반 검색/캐시(모든 조회가 DB가 아니라 검색 엔진을 거침)
- **인스턴스 메시징**(`message list/send/wait`) - 프로젝트 단위 세션 간
  소통. `message wait`는 백엔드가 내부적으로 EMQX를 구독해 새 메시지가
  오거나 타임아웃될 때까지 응답을 들고 있는 롱폴(폴링 아님 - CLI/MCP는
  여전히 REST만 호출).
- **JWT 기반 EMQX 클라이언트 인증 + Member 기준 topic ACL** - 설치
  전역 JWT를 그대로 MQTT 인증에 재사용(HTTP 훅으로 `verifyAccessToken`
  재사용), `project/{id}/(changes|messages)` topic은 그 프로젝트
  멤버만 구독/발행 가능(미래 웹 인터페이스가 MQTT-over-WebSocket으로
  직접 붙을 때 쓸 인프라 - 지금은 raw MQTT 클라이언트로 직접 검증함).
- CLI(`docs`) + MCP 서버(`docs-mcp`) - 둘 다 REST API만 호출하는 순수
  클라이언트, 도구/명령이 1:1 대칭
- CLAUDE.md/SKILL.md 템플릿 관리(기관/그룹/프로젝트 override) +
  `template deploy`(해석된 템플릿을 프로젝트의 자체 호스팅 저장소
  루트에 실제 커밋)
- Gitea 자체 호스팅 git 통합(저장소 자동 생성, 웹훅 자동 등록,
  `git log/diff/show` 실제 구현) + 외부 GitHub/GitLab 저장소 연결(자격
  증명이 있으면 웹훅도 자동 등록, 없으면 수동 설정 안내)
- **git push 훅 프롬프트 자동화**(대기열 방식) - `hook create/list/
  delete`로 프로젝트별 트리거 규칙을 정의하면, 매칭되는 push마다
  `hook queue`에 항목이 쌓인다. 서버가 클로드 세션을 직접 스폰하지
  않으므로, 그 프로젝트를 다음에 여는 세션이 대기열을 확인·처리
  (`hook ack`/`hook done`)한다.
- **웹 인터페이스**(`frontend/`, Vue 3 + Vite) - 로그인/회원가입,
  기관/프로젝트 그룹/프로젝트 목록+생성, 프로젝트 상세(git 저장소
  상태·문서 타입·멤버). backend가 빌드 결과물을 같은 오리진에서
  정적 서빙(별도 컨테이너/포트 없음).
- **Monaco 에디터**(`frontend/`) - 문서 브라우저(타입/상태 필터) +
  Monaco 마크다운 에디터(문서 본문 편집·저장·상태 전이), 소스 코드
  브라우저(디렉터리 트리) + Monaco 코드 에디터(파일 열람·편집·커밋).
  자체 호스팅 저장소가 연결 안 된 프로젝트는 소스 코드 화면 대신 안내
  문구만 표시. 실시간 갱신/변경 추적 뷰는 다음 설치에서.

**알려진 제한**: `git blame`은 Gitea REST API 자체에 blame 엔드포인트가
없어(1.27 기준, swagger로 직접 확인) 명확한 "지원하지 않음" 에러를
반환한다 - `git log/diff/show`로 변경 이력을 대신 확인한다. 외부
GitHub/GitLab 저장소는 `git log/diff/blame/show`를 지원하지 않는다
(자체 호스팅만) - 명확한 400을 반환. Gitea는 사설 네트워크 호스트로의
웹훅 발송을 기본적으로 막으므로(SSRF 방지), Docker Compose 배포에서
웹훅이 실제로 오려면 `docker-compose.yml`의 `GITEA__security__
ALLOWED_HOST_LIST` 설정이 꼭 필요하다(이미 반영돼 있음 - 직접 겪고
고친 문제).

## 실행 방법

### Docker Compose (권장)

```bash
cd backend/docker
cp .env.example .env   # JWT_SECRET/CREDENTIAL_ENCRYPTION_KEY/POSTGRES_PASSWORD/MEILISEARCH_API_KEY 채우기
docker compose up -d --build
```

백엔드는 `:8760`(포트 충돌 시 `.env`에 `BACKEND_HOST_PORT` 지정).
EMQX 대시보드(`:18083`, 기본 admin/public)에서 API Key를 발급받아
`.env`의 `EMQX_API_KEY`/`EMQX_API_SECRET`에 채우면 실시간 발행/
인증·인가 훅 자동 등록까지 전부 동작한다(안 채워도 나머지 기능은
정상 동작 - 발행/구독만 조용히 스킵됨). `EMQX_SERVICE_USERNAME`/
`PASSWORD`(무작위 값)도 함께 채워야 `message wait`가 동작한다. Gitea
(`:3001`)도 같은 패턴 - 최초 기동 후 설치 마법사 완료 → 관리자 계정
생성 → Personal Access Token 발급 →
`GITEA_ADMIN_USERNAME`/`GITEA_API_TOKEN`에 채워야 git 저장소 연결
기능이 동작한다(`.env.example` 참고). `PUBLIC_BACKEND_URL`을 채우면
`git link` 시 웹훅과 EMQX 인증/인가 훅이 자동 등록된다(로컬 전용 개발
환경이면 비워둬도 나머지 기능엔 지장 없음 - 웹훅/훅 등록만 건너뜀).

### 호스트에 직접 설치

```bash
cd frontend && npm install && npm run build && cd ..   # backend가 이 dist/를 정적 서빙
cd backend
npm install
npm run build
DB_DRIVER=sqlite DATABASE_URL=file:./data.db \
JWT_SECRET=<32자 이상> CREDENTIAL_ENCRYPTION_KEY=<64자 hex> \
MEILISEARCH_HOST=<...> MEILISEARCH_API_KEY=<...> \
EMQX_API_URL=<...> EMQX_API_KEY=<...> EMQX_API_SECRET=<...> \
EMQX_MQTT_URL=<...> EMQX_SERVICE_USERNAME=<...> EMQX_SERVICE_PASSWORD=<...> \
npx prisma db push --schema prisma/schema.sqlite.prisma --skip-generate
node dist/api/server.js
```

Meilisearch/EMQX는 별도로 떠 있어야 한다(각자 공식 바이너리/Docker
이미지로 로컬 실행 가능). `frontend/dist`가 없으면 backend는 정상
기동하되 웹 UI 없이 API만 서빙한다(CLI/MCP는 지장 없음).

### 프런트엔드 개발

```bash
cd frontend
npm install
npm run dev   # :5173, /api를 backend(:8760)로 프록시
```

backend를 먼저(다른 터미널에서) 띄워둔 상태로 위 명령을 실행하면
핫 리로드로 화면을 바로 확인할 수 있다.

### CLI

```bash
cd backend
npm link   # 전역에 docs/docs-mcp 명령 설치
docs auth login --api http://localhost:8760 --username <u> --password <p>
docs project-create <이름>
docs new <projectId> SP --title "..." --body <로컬 파일>
```

### MCP

`docs auth login`으로 한 번 로그인해두면(`~/.claude-native-workflow/
credentials.json` 공유), `docs-mcp`를 stdio MCP 서버로 등록해 CLI와
동일한 49개 도구를 그대로 쓸 수 있다. `auth register/login/logout`은
비밀번호가 대화 컨텍스트에 남지 않도록 의도적으로 MCP 도구로 노출하지
않는다(CLI 전용) - `auth_whoami`만 로그인 상태 확인용 예외.

## 설계 원칙

- **CLI/MCP 명령어 완전성**: 클로드가 문서/워크플로우 상태를 읽거나
  쓰는 모든 동작은 CLI/MCP 명령으로 존재해야 한다. 단, 편집 중인
  문서의 로컬 스크래치 사본은 정상 작업 방식이다(단, git 커밋 대상은
  아님).
- **추적 코드 명시**: 클로드가 제안하거나 설계 내용을 작성할 때는
  관련 추적 코드(`XX-XXXXXXXX`)를 정확히 명시한다.
