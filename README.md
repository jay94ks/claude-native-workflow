# claude-native-workflow

Claude가 스스로 읽고 쓰는 **자가 발전형 지식 베이스(SEKB, Self-Evolving
Knowledge Base)** 겸 문서/워크플로우 관리 시스템 - 단일 설치형, DB
기반 문서 저장, 검색 엔진을 거치는 조회, 커스터마이즈 가능한 문서
타입 체계, 실시간 메시징/변경 전파를 갖춘다.

## 왜 만들었나

설계자는 이 프로젝트를 만들게 된 배경을 이렇게 설명한다:

> 이걸 고안하게 된 배경은, 클로드가 계속 보고서를 쌓는다는 지점에서,
> "검색 엔진"을 도입하고, 그 보고서를 스스로 분류하여 쌓도록 하면
> 어떨까에서 출발했다.
>
> 효율성은 클로드가 스스로 결정하고, 문서를 조회하며, 변동을
> 추적한다. 그리고 멀티 에이전트를 도입하더라도 공통된 SEKB를
> 사용하고 에이전트 간 통신 채널을 제공하므로(예정), 인간의
> 검토/지침을 보장하면서도 생산성을 향상시킬 수 있다.

정리하면 세 가지 축이다:

- **클로드가 스스로 분류하며 쌓는다** - 문서는 파일이 아니라 DB
  레코드고, 타입(DocType)·상태(DocStatus)·상태 전이는 관리자가
  자유롭게 정의한 체계 안에서 클로드가 스스로 고른다.
- **조회는 검색 엔진을 거친다** - 이 시스템이 다루는 문서/질의/
  코멘트/소스 코드 조회는 DB를 직접 타지 않고 전부 Meilisearch를
  거친다(`backend/src/core/search.ts`) - "클로드가 호출하는 모든 조회
  경로는 검색 엔진을 거친다"는 게 이 저장소의 가장 근본적인 설계
  원칙이다.
- **여러 에이전트가 같은 지식 베이스를 공유한다** - 지금도 프로젝트
  단위 인스턴스 메시징(`message list/send/wait`)으로 세션 간 소통이
  가능하고, 앞으로는 에이전트 간 통신 채널을 더 넓혀 여러 클로드
  세션이 하나의 SEKB를 두고 협업하면서도 사람의 검토와 지침이 항상
  개입할 수 있게 하는 방향으로 발전시킬 계획이다.

## 무엇을 하는가

핵심만 요약하면:

- 프로젝트/문서 타입/상태 전이를 관리자가 자유롭게 정의하고, 클로드는
  CLI(`docs`)나 MCP 서버(`docs-mcp`)로 문서를 조회·작성·전이한다 -
  두 인터페이스는 명령/도구가 1:1 대칭이다.
- 질의/응답(Question/Answer), 코멘트, 칸반 보드로 설계자와 클로드가
  같은 워크플로우 위에서 협업한다.
- git 저장소 연결(자체 호스팅/외부 이주/외부 연동), 변경 추적, 실시간
  메시징까지 하나의 설치 안에 통합돼 있다.
- 웹 UI에서 사람이 직접 프로젝트/멤버/권한/문서 타입을 관리하고,
  같은 데이터를 클로드가 CLI/MCP로 다룬다.

전체 기능 카탈로그(영역별로 지금 무엇을 하는지)는
[FEATURES.md](FEATURES.md)에 정리돼 있다 - 이 README는 소개까지만
다루고, 기능 목록의 정본은 그쪽이다.

## 저장소 구조

- **`main` 브랜치가 v2 구현**(이 README가 설명하는 것 - 단일 설치형,
  DB 기반)이다.
- 이전 3단계(Tier1/2/3) 구현은 [`concept`](../../tree/concept)
  브랜치에 그대로 보존돼 있다 - 서로 다른 시스템이니 섞어서 참고하지
  않는다. v2는 그 경험을 바탕으로 완전히 새로 설계됐다.

## 더 알아보기 (문서 지도)

이 저장소 자신의 설계 논의는 아래 마크다운 문서들로 관리한다(시스템이
자기 자신을 담을 만큼 성숙하면 가이디드 마이그레이션으로 시스템
안으로 옮길 예정):

| 문서 | 역할 |
|---|---|
| [CLAUDE.md](CLAUDE.md) | 이 저장소에서 작업할 때(Claude Code 세션이) 따르는 작업 방식·문서 갱신 규칙 |
| [FEATURES.md](FEATURES.md) | 이 시스템이 지금 무엇을 하는지, 영역별 기능 카탈로그(정본) |
| [DESIGN-NOTES.md](DESIGN-NOTES.md) | Phase/라운드별로 무엇을 어떻게·왜 바꿨는지 - 완료 이력 로그 |
| [QA-SCENARIOS.md](QA-SCENARIOS.md) | 기능별 사용 시나리오와 실측 검증 체크리스트 |
| [PLANS.md](PLANS.md) | 처리 대기 중인 백로그(맨 위 색인 표가 우선순위) |

## 실행 방법

### Docker Compose (권장)

```bash
cd backend/docker
cp .env.example .env
docker compose up -d --build
```

`.env`를 채우지 않아도(전부 예시 값 그대로 둬도) 일단 기동은 된다 -
아래 항목별로 "채우지 않으면 무슨 기능이 꺼지는지"를 명시했으니, 필요한
만큼만 채우고 나머지는 나중에 채워도 된다(값을 채운 뒤엔
`docker compose up -d --build`를 다시 실행하면 반영됨).

백엔드는 `:8760`(포트 충돌 시 `.env`에 `BACKEND_HOST_PORT` 지정). 최초
기동 시(계정이 하나도 없으면) 이 시스템 자신의 관리자 계정이
`admin`/`12345678`로 항상 자동 생성된다(로그인 직후 바로 비밀번호를
바꾸는 걸 권장).

#### Meilisearch(검색 엔진) - 어디서 값을 "받아올" 필요가 없다

`MEILISEARCH_API_KEY`는 Meilisearch 사이트에 가입하거나 로그인해서
발급받는 값이 아니다 - **본인이 직접 정하는 비밀번호 같은 것**이다.
`.env`를 열어 `MEILISEARCH_API_KEY=` 뒤에 아무 무작위 문자열이나
채워 넣으면 끝(예: `openssl rand -hex 32`로 생성하거나, 터미널이
어려우면 그냥 길고 남이 못 맞출 문자열을 손으로 입력해도 된다). 이
값을 Meilisearch 컨테이너가 그대로 자기 "마스터 키"로 쓴다 - 별도
대시보드나 설정 화면 자체가 없다. 문서 검색/목록 조회가 전부 이
서비스를 거치므로(핵심 기능), 이 값만은 반드시 채워야 한다.

#### EMQX(실시간 메시징) - Meilisearch와 마찬가지로 대시보드가 필요 없다

`EMQX_API_KEY`/`EMQX_API_SECRET`도 Meilisearch 키와 똑같이 **본인이
직접 정하는 값**이다 - EMQX 대시보드에 로그인해서 발급받는 게 아니다.
`.env`에 이 두 값(및 `EMQX_SERVICE_USERNAME`/`EMQX_SERVICE_PASSWORD`,
`message wait`가 내부적으로 쓰는 전용 계정 - 이것도 마찬가지로
직접 정하는 값)을 채우고 `docker compose up -d --build`로 띄우면 그걸로
끝이다. EMQX 자체는 REST API 키를 이미지가 기본으로 안 만들어주지만,
이 프로젝트의 `docker-compose.yml`이 EMQX의 "부트스트랩 파일" 기능
(`api_key.bootstrap_file`, 실제 `emqx/emqx:5.8` 컨테이너로 동작 검증
완료)으로 `.env`의 두 값을 기동 시점에 그대로 API 키로 등록해준다 -
대시보드 로그인·발급 절차 자체가 필요 없다.

값을 비워두면(기본값) 시스템 자체는 정상 기동하되 실시간 알림(변경
추적 뷰·메시징 패널이 새로고침 없이 갱신되는 것, `message wait` 롱폴)
만 조용히 꺼진 채로 동작한다 - 나중에 값을 채우고 다시 띄우면 켜진다.

**주의**: 컨테이너가 이미 떠 있는 상태에서 `.env`의 이 값들을 바꿨다면
`docker compose up -d --build`만으로는 반영이 안 될 수 있다(부트스트랩
파일 내용이 바뀐 것만으로는 EMQX 컨테이너를 자동으로 재생성하지
않음 - 실측 확인) - `docker compose up -d --force-recreate emqx`처럼
명시적으로 재생성해야 새 값이 적용된다. 최초 설치(컨테이너가 아직
없는 상태)는 이 문제와 무관하게 항상 바로 적용된다.

(참고: EMQX 대시보드는 `http://localhost:18083`, 기본 계정
`admin`/`public`으로 여전히 접속 가능하다 - 부트스트랩으로 만든 키를
직접 눈으로 확인하고 싶거나, 나중에 키를 하나 더 추가하고 싶을 때
같은 용도로 쓸 수 있지만, 최초 설치 시엔 이제 들어갈 필요가 없다.)

#### Gitea(선택 - git 저장소를 이 시스템 안에서 직접 관리하려는 경우만)

git 저장소 연결/이력 조회 기능을 쓰지 않을 거라면 이 절은 건너뛰어도
된다(`GITEA_*` 값을 비워두면 그 기능만 에러를 반환할 뿐 나머지는
정상). 쓰려면 EMQX와 같은 패턴으로 1회성 수동 단계가 필요하다:

1. `http://localhost:3001`(Gitea 웹 UI)에 접속해 설치 마법사를
   완료한다(대부분 기본값 그대로 "설치" 눌러도 된다).
2. 마법사 마지막에 관리자 계정을 만든다(아이디/비밀번호는 본인이
   직접 정함 - 이후 Gitea 저장소는 전부 이 계정 아래 만들어진다).
3. 로그인 후 오른쪽 위 프로필 아이콘 → **Settings** → **Applications**
   로 이동해 **Generate New Token**으로 Personal Access Token을
   발급한다(권한은 최소 `repository`와 `user` 스코프를 읽기/쓰기로
   - `repository`만 주면 저장소 생성 시점에 403으로 막힌다).
4. `.env`의 `GITEA_ADMIN_USERNAME`(2번에서 만든 계정 아이디)과
   `GITEA_API_TOKEN`(3번에서 발급한 값)을 채운다.
5. `docker compose up -d --build`를 다시 실행한다.

#### 그 외(선택) - 외부에서 접속할 계획이 없다면 안 건드려도 된다

`PUBLIC_BACKEND_URL`을 채우면 `git link` 시 웹훅과 EMQX 인증/인가
훅이 자동 등록된다(로컬 전용 개발 환경이면 비워둬도 나머지 기능엔
지장 없음 - 웹훅/훅 등록만 건너뜀). 웹 UI의 실시간 변경 추적/메시징
패널 갱신을 쓰려면 `PUBLIC_EMQX_WS_URL`도 채운다(예:
`ws://localhost:8083/mqtt` - 8083 포트가 이미 다른 걸로 쓰이고 있으면
`EMQX_WS_HOST_PORT`로 호스트 노출 포트를 바꾸고 URL도 맞춰준다). 비워두면
`GET /api/realtime-config`가 `null`을 반환해 웹 UI가 실시간 갱신만 조용히
꺼진 상태로 동작한다.

#### 로컬/사설 서버에 설치한 경우 GitHub/GitLab 연동은 어디까지 되는가

**저장소 연결/동기화 자체는 로컬 서버 여부와 무관하게 전부 된다** -
`git link-external`로 외부(GitHub/GitLab) 저장소를 연결하고, 그 뒤
`git sync-status`/`git sync-proposal`로 변경 확인, `git publish`로
실제 반영(push)까지 전부 이 백엔드(정확히는 내부 Gitea)가 GitHub/GitLab
API·git 프로토콜로 **먼저 걸어 나가는** 호출이다 - 공유기 포트포워딩도,
공인 IP도 필요 없다. 자체 호스팅(Gitea) push 훅 자동화도 Gitea와
백엔드가 같은 docker-compose 네트워크 안에 있어서(`PUBLIC_BACKEND_URL`
기본값이 그 내부 호스트 이름) 로컬 서버에서도 그대로 동작한다.

**단 하나, 공인 HTTPS 주소가 있어야만 되는 게 있다** - `git
link-external`이 **GitHub/GitLab 저장소 자체에** 웹훅을 자동으로
등록해주는 것(이게 있어야 이 시스템을 거치지 않고 GitHub에 직접
push해도 push 훅 자동화가 즉시 반응한다). `PUBLIC_BACKEND_URL`이
GitHub/GitLab이 실제로 도달 가능한 공개 주소가 아니면 이 자동 등록만
실패하고, **연동 자체나 다른 기능은 전혀 안 끊긴다** - 실패하면 웹
UI(프로젝트 "설정" 탭)에 Payload URL/Secret이 담긴 수동 설정 안내가
바로 뜨니, 그 값 그대로 GitHub 저장소의 Settings → Webhooks에서
`push` 이벤트로 직접 등록하면 된다(Content type은 `application/json`).
수동 등록도 귀찮으면 그냥 건너뛰어도 무방하다 - "GitHub 직접 push
즉시 감지"만 빠질 뿐, `git sync-status`로 직접 확인하는 방식은
그대로 잘 된다.

이 자동 등록까지 살리고 싶다면 `PUBLIC_BACKEND_URL`을 실제로 밖에서
닿는 HTTPS 주소로 바꿔야 한다 - 공유기 포트포워딩+DDNS+리버스
프록시(TLS 처리)로 직접 열거나, Cloudflare Tunnel/ngrok/Tailscale
Funnel 같은 역터널 서비스를 쓰면 포트포워딩·공인 IP 없이도 가능하다
(이 저장소는 특정 터널 서비스를 내장하지 않는다 - 필요하면 직접
붙인다).

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

# 가이디드 마이그레이션(concept 스타일 파일 기반 프로젝트 옮기기)
docs migrate scan ../concept/docs > manifest.json   # 로컬 스캔, API 호출 없음
# manifest.json을 열어 docTypeCode/statusCode/skip을 검토·수정한 뒤:
docs migrate apply <projectId> manifest.json
```

### MCP

`docs auth login`으로 한 번 로그인해두면(`~/.claude-native-workflow/
credentials.json` 공유), `docs-mcp`를 stdio MCP 서버로 등록해 CLI와
동일한 도구를 그대로 쓸 수 있다(CLI에만 있고 MCP엔 의도적으로 없는
소수의 명령이 있다 - 신원/비밀 관리 동작이 그렇다, 정확한 목록과
이유는 `.claude/skills/claude-native-workflow/SKILL.md`의 "CLI/MCP에
의도적으로 없는 기능" 절 참고). `auth register/login/logout`은
비밀번호가 대화 컨텍스트에 남지 않도록 의도적으로 MCP 도구로 노출하지
않는다(CLI 전용) - `auth_whoami`만 로그인 상태 확인용 예외.

## 핵심 설계 원칙

- **CLI/MCP 명령어 완전성**: 클로드가 문서/워크플로우 상태를 읽거나
  쓰는 모든 동작은 CLI/MCP 명령으로 존재해야 한다(의도적 예외는 신원/
  비밀 관리, 설계자 전용 채널처럼 명확한 이유가 있을 때만). 편집 중인
  문서의 로컬 스크래치 사본은 정상 작업 방식이다(단, git 커밋 대상은
  아님).
- **조회는 검색 엔진을 거친다**: 클로드가 호출하는 모든 조회 경로는
  DB를 직접 타지 않고 Meilisearch를 거친다 - 새 필드를 추가할 땐
  스키마뿐 아니라 색인 매핑·필터/정렬 속성 등록까지 같이 해야 실제로
  드러난다.
- **추적 코드 명시**: 클로드가 제안하거나 설계 내용을 작성할 때는
  관련 추적 코드(`XX-XXXXXXXX`)를 정확히 명시한다.
