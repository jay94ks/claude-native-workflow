# claude-native-workflow v2

Claude와 함께 쓰는 문서/워크플로우 관리 시스템 - 단일 설치형, DB 기반
문서 관리, 커스터마이즈 가능한 타입 체계, 실시간 메시징/변경 전파.

이전(3단계 등급 구분) 구현은 [`concept`](../../tree/concept) 브랜치에
그대로 보존되어 있다. 이 브랜치(`main`)는 그 경험을 바탕으로 완전히
새로 설계한 v2 구현이다 - 설계 배경과 전체 아키텍처는 계획 문서
(대화 세션에서 작성, 저장소에는 아직 커밋 안 됨 - 진행 상황은
[DESIGN-NOTES.md](DESIGN-NOTES.md) 참고)를 참고.

## 지금 상태: Phase 1 완료

- Prisma 스키마(PostgreSQL/MySQL/SQLite 3드라이버, 완전 정규화 - JSON
  컬럼 없음)
- 인증(회원가입/로그인/JWT+리프레시 토큰)
- git 자격증명 저장(AES-256-GCM 암호화)
- 기관/프로젝트 그룹/프로젝트 계층(기관 단위는 선택적)
- 커스터마이즈 가능한 문서 타입 체계(DocType/DocStatus/DocStatusTransition)
- 문서 CRUD + 버전 이력 + 문서 간 링크(역참조 가능)
- 질의/답변(Question/Answer) 추적 - 트래킹 코드(`QU-XXXXXXXX`) 부여
- 코멘트, 보고서 생성
- Meilisearch 기반 검색/캐시(모든 조회가 DB가 아니라 검색 엔진을 거침)
- EMQX 기반 실시간 이벤트 발행(구독 측은 Phase 4)
- CLI(`docs`) + MCP 서버(`docs-mcp`) - 둘 다 REST API만 호출하는 순수
  클라이언트, 도구/명령이 1:1 대칭
- CLAUDE.md/SKILL.md 템플릿 관리(기관/그룹/프로젝트 override, 프로젝트
  git 저장소에 실제 커밋하는 `template deploy`는 Phase 2에서)

diff 계열(git 이력)과 인스턴스 메시징 송수신/대기는 자리만 등록되어
있고 Phase 2/4에서 실제로 구현된다(호출하면 명확한 501을 반환).

## 실행 방법

### Docker Compose (권장)

```bash
cd backend/docker
cp .env.example .env   # JWT_SECRET/CREDENTIAL_ENCRYPTION_KEY/POSTGRES_PASSWORD/MEILISEARCH_API_KEY 채우기
docker compose up -d --build
```

백엔드는 `:8760`(포트 충돌 시 `.env`에 `BACKEND_HOST_PORT` 지정).
EMQX 대시보드(`:18083`, 기본 admin/public)에서 API Key를 발급받아
`.env`의 `EMQX_API_KEY`/`EMQX_API_SECRET`에 채우면 실시간 발행까지
전부 동작한다(안 채워도 나머지 기능은 정상 동작 - 발행만 조용히
스킵됨).

### 호스트에 직접 설치

```bash
cd backend
npm install
npm run build
DB_DRIVER=sqlite DATABASE_URL=file:./data.db \
JWT_SECRET=<32자 이상> CREDENTIAL_ENCRYPTION_KEY=<64자 hex> \
MEILISEARCH_HOST=<...> MEILISEARCH_API_KEY=<...> \
EMQX_API_URL=<...> EMQX_API_KEY=<...> EMQX_API_SECRET=<...> \
npx prisma db push --schema prisma/schema.sqlite.prisma --skip-generate
node dist/api/server.js
```

Meilisearch/EMQX는 별도로 떠 있어야 한다(각자 공식 바이너리/Docker
이미지로 로컬 실행 가능).

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
동일한 39개 도구를 그대로 쓸 수 있다. `auth register/login/logout`은
비밀번호가 대화 컨텍스트에 남지 않도록 의도적으로 MCP 도구로 노출하지
않는다(CLI 전용) - `auth_whoami`만 로그인 상태 확인용 예외.

## 설계 원칙

- **CLI/MCP 명령어 완전성**: 클로드가 문서/워크플로우 상태를 읽거나
  쓰는 모든 동작은 CLI/MCP 명령으로 존재해야 한다. 단, 편집 중인
  문서의 로컬 스크래치 사본은 정상 작업 방식이다(단, git 커밋 대상은
  아님).
- **추적 코드 명시**: 클로드가 제안하거나 설계 내용을 작성할 때는
  관련 추적 코드(`XX-XXXXXXXX`)를 정확히 명시한다.
