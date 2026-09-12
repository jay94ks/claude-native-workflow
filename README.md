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
- **코드 관계도(Code Relation Graph)** - 클로드가 코드를 탐색하며
  스스로 파악한 "무엇이 어디서 왜 참조되는지"를 직접 기록해두는
  자기 기록형 그래프(다중 부모/순환 허용, 브랜치별 자동 스코프) -
  다음 세션이 같은 탐색을 반복하지 않고 바로 찾아 쓴다. 프로젝트
  탭 "관계도"에서 `vis-network` 그래프로 시각화되고, 문서/소스 코드
  화면에서 정확히 필터링해 넘어올 수 있다.
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

이 저장소는 자기 자신의 설계 논의를 이제 이 시스템 자신의 문서로
관리한다(가이디드 마이그레이션 완료 - 이 저장소의 git 원격이
`claude-native-workflow`라는 이름의 프로젝트로 이 시스템의 한 설치에
연동돼 있다):

| 문서 | 역할 |
|---|---|
| [CLAUDE.md](CLAUDE.md) | 이 저장소에서 작업할 때(Claude Code 세션이) 따르는 작업 방식·문서 갱신 규칙 - git 전용 |
| [FEATURES.md](FEATURES.md) | 이 시스템이 지금 무엇을 하는지, 영역별 기능 카탈로그 - `FT` 문서의 공개본 사본(정본은 DB) |
| [DESIGN-NOTES.md](DESIGN-NOTES.md) | 라운드별로 무엇을 어떻게·왜 바꿨는지 - `DN` 문서의 공개본 사본(정본은 DB) |
| QA 시나리오/체크리스트 | `QA` 타입 문서로 완전히 이주(git 사본 없음) |
| 백로그 색인 | `BL` 타입 문서로 완전히 이주(git 사본 없음) |

## 실행 방법

### Docker Compose (권장)

```bash
cp .env.example .env
docker compose up -d --build
```

(저장소 루트에서 그대로 실행 - `docker-compose.yml`이 backend/frontend
둘 다 이미지를 빌드해 하나의 스택으로 띄운다.)

`.env`를 채우지 않아도(전부 예시 값 그대로 둬도) 일단 기동은 된다 -
아래 항목별로 "채우지 않으면 무슨 기능이 꺼지는지"를 명시했으니, 필요한
만큼만 채우고 나머지는 나중에 채워도 된다(값을 채운 뒤엔
`docker compose up -d --build`를 다시 실행하면 반영됨).

**⚠ 이 컴퓨터에 이미 이 시스템의 다른 클론/설치가 있다면** - Docker
Compose는 기본적으로 프로젝트 이름을 **`docker-compose.yml`이 있는
디렉터리 이름**만으로 정하고, 볼륨/네트워크 이름도 그 프로젝트 이름
기준이다. 이 저장소를 두 곳에 clone했는데 그 최상위 폴더 이름이
우연히 같다면(예: 둘 다 기본 이름 `claude-native-workflow`를 그대로
씀), 그냥 `docker compose up`을 실행하면 경로가 다른데도
`claude-native-workflow_postgres-data` 등 같은 이름의 볼륨을 그대로
재사용해버려서(실제 DB 서버 통째로 공유) 완전히 별개인 두 설치가
데이터를 뒤섞어 쓰게 된다(실제로 새 설치를 만들며 재현·발견 - 새
설치의 Postgres 컨테이너가 기존 설치의 옛 비밀번호로 인증에 실패하는
형태로 드러났다). `.env`에 `COMPOSE_PROJECT_NAME=<겹치지 않는 이름>`
(예: `cnw`)을 추가해 완전히 분리한다 - 볼륨/네트워크/컨테이너 이름이
전부 그 접두어로 바뀌어 다른 설치와 절대 안 겹친다.

웹 UI/API는 nginx를 거쳐 `:80`으로 열린다(포트 충돌 시 `.env`에
`PUBLIC_HOST_PORT` 지정) - backend 자신의 `:8760`은 보안 강화
(#gitea-nginx-lockdown)로 기본 노출되지 않는다(로컬 개발 중 nginx
없이 backend에 직접 붙고 싶으면 `docker-compose.yml`의 backend
서비스에 주석 처리된 `ports:` 줄을 해제). 최초 기동 시(계정이 하나도
없으면) 이 시스템 자신의 관리자 계정이 `admin`/`12345678`로 항상
자동 생성된다(로그인 직후 바로 비밀번호를 바꾸는 걸 권장).

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
정상). **보안 강화(#gitea-nginx-lockdown)로 Gitea는 호스트 포트를
아예 열지 않는다** - `docker-compose.yml`의 `nginx` 서비스가 유일한
기본 노출 지점이고, `.git`로 끝나는 git smart-HTTP 요청만 Gitea로
돌려주고 나머지(Gitea 자신의 웹 UI 포함)는 전부 이 앱으로 간다 -
즉 Gitea의 저장소 브라우징/관리 화면은 원천적으로 바깥에서 열리지
않는다. 그래서 예전의 "웹 설치 마법사" 단계도 없다 - 관리자 계정/PAT
발급 전부 컨테이너 안에서 CLI로 한다:

1. `docker compose up -d --build`로 스택을 띄운다(Gitea 포함).
2. 컨테이너 이름을 확인한다(`docker compose ps` - 보통
   `docker-gitea-1`, 컴포즈 프로젝트 디렉터리명에 따라 접두어가
   다를 수 있음).
3. 관리자 계정을 만든다:
   ```bash
   docker compose exec -u git gitea gitea admin user create \
     --admin --username <아이디> --password <비밀번호> \
     --email <이메일> --must-change-password=false
   ```
4. Personal Access Token을 발급한다(**issue 스코프 필수** - Gitea가
   Pull Request를 issue로 취급해 그 댓글/타임라인 조회 API를 별도
   issue 스코프로 게이팅하므로, repository 스코프만으론 403이 난다):
   ```bash
   docker compose exec -u git gitea gitea admin user generate-access-token \
     --username <아이디> --token-name backend \
     --scopes "write:admin,write:organization,write:repository,write:user,write:issue"
   ```
   출력되는 토큰 값은 이때 한 번만 보인다.
5. `.env`의 `GITEA_ADMIN_USERNAME`(3번 아이디)과
   `GITEA_API_TOKEN`(4번 토큰)을 채운다.
6. `docker compose up -d --build`를 다시 실행한다.

저장소는 프로젝트마다 별도 Gitea 조직(org)에 만들어진다
(`GITEA_ORG_PREFIX` + projectId, 기본 접두어 `proj-`) - 예전엔 설치
전체가 하나의 공유 조직을 썼지만, 이제 프로젝트별로 네임스페이스가
분리된다(#gitea-per-project-namespace). 기존 설치를 업그레이드하는
경우 아래 "기존 설치 업그레이드" 절을 먼저 확인한다.

**⚠ 정말 필요할 때만** - Gitea 웹 UI를 직접 열어야 하는 드문 경우(예:
직접 눈으로 뭔가 확인하고 싶을 때)엔 `docker-compose.yml`의 `gitea`
서비스에 주석 처리돼 있는 `ports:` 줄을 잠깐 해제했다가, 확인이
끝나면 반드시 다시 주석 처리한다(주석이 풀려 있는 동안은 협업자
권한이 있는 누구나 그 포트로 저장소 파일트리/커밋을 직접 볼 수 있다).

#### 기존 설치를 업그레이드하는 경우 - Gitea 네임스페이스 마이그레이션

이미 이 시스템을 운영 중이던 설치를 최신 코드로 올리면, 기존
프로젝트들의 Gitea 저장소가 예전의 공유 조직(`cnwk-projects`) 아래
있다 - 아래 스크립트를 1회 실행해 프로젝트별 조직으로 실제 이전한다
(멱등 - 이미 이전된 프로젝트는 자동으로 건너뜀, 여러 번 실행해도
안전):

```bash
docker compose exec backend npm run migrate:gitea-namespaces
docker compose exec backend npm run verify:gitea-namespaces
```

`migrate:gitea-namespaces`는 각 저장소를 Gitea의 저장소 이전(transfer)
API로 옮기고, 실패하면 `git clone --mirror`+`git push --mirror`로
히스토리를 그대로 복사하는 폴백을 쓴다. 항목별 성공/실패 결과표를
출력하고 실패가 있으면 종료 코드 1을 반환한다 - 실패 항목은 원인(로그의
`detail` 열)을 보고 개별적으로 조치한 뒤 다시 실행하면 된다(이미
성공한 항목은 재실행해도 건드리지 않음). `verify:gitea-namespaces`는
이전 후 모든 저장소가 새 위치에서 실제로 살아있는지(조회+커밋 이력
확인)만 검증한다.

**⚠ 예전에 Gitea 포트를 직접 노출하고 `PUBLIC_GITEA_URL`을 그 포트
주소(예: `http://your-host:3001`)로 채워뒀었다면, 이 업그레이드
이후엔 그 포트가 더 이상 호스트에 열려있지 않으므로 반드시
`PUBLIC_GITEA_URL`을 nginx가 실제로 듣는 주소(보통
`PUBLIC_BACKEND_URL`과 같은 값, 포트 없이)로 갱신한다** - 안 그러면
designer에게 보이는 clone 주소가 더는 접속 불가능한 옛 포트를 계속
가리키게 된다(실제로 이 실수를 재현해 발견함 - 값을 고친 뒤
`docker compose up -d --force-recreate backend`로 재기동해야 반영됨).

#### 그 외(선택) - 외부에서 접속할 계획이 없다면 안 건드려도 된다

`PUBLIC_BACKEND_URL`을 채우면 `git link` 시 웹훅과 EMQX 인증/인가
훅이 자동 등록된다(로컬 전용 개발 환경이면 비워둬도 나머지 기능엔
지장 없음 - 웹훅/훅 등록만 건너뜀). `PUBLIC_GITEA_URL`을 채우면
self_hosted 저장소의 clone 주소(designer가 보는 `repoUrl`)가 이 값
기준으로 항상 다시 계산된다(#gitea-per-project-namespace) - Gitea
자신이 저장소 생성 시점에 반환한 주소를 그대로 얼려두지 않으므로,
나중에 도메인을 바꾸거나(로컬→원격 이전 등) 이 값만 갱신하면 즉시
반영된다. 보통 `PUBLIC_BACKEND_URL`과 같은 공개 주소를 그대로 쓰면
된다(nginx가 `.git` 요청만 Gitea로 돌려주므로 같은 origin으로 충분).
비워두면 저장소 생성 시점에 Gitea가 반환한 clone_url을 그대로 쓴다.
웹 UI의 실시간 변경 추적/메시징 패널 갱신을 쓰려면 `PUBLIC_EMQX_WS_URL`도
채운다(예: `ws://localhost:8083/mqtt` - 8083 포트가 이미 다른 걸로
쓰이고 있으면 `EMQX_WS_HOST_PORT`로 호스트 노출 포트를 바꾸고
URL도 맞춰준다). 비워두면 `GET /api/realtime-config`가 `null`을
반환해 웹 UI가 실시간 갱신만 조용히 꺼진 상태로 동작한다.

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
이미지로 로컬 실행 가능). backend는 이제 `/api` 아래의 API만 서빙한다
(#frontend-own-service - 예전엔 `frontend/dist`가 있으면 backend가
그걸 같은 오리진에서 정적 서빙했으나, frontend가 자기 nginx를 가진
별도 서비스로 분리되면서 그 코드 자체가 없어졌다). CLI/MCP만 쓸
거면 이대로 충분하고, 웹 UI까지 쓰려면 `frontend/dist`를 따로 빌드해
별도 정적 서버로 띄우고(예: `cd frontend && npm install && npm run
build && npx serve -s dist`), 그 앞에 `/api`만 backend로 돌려주는
리버스 프록시를 하나 둬야 한다(Docker Compose 경로의
`nginx/default.conf`가 하는 역할과 동일 - 그 파일을 그대로 참고해도
된다).

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

## 도입 시나리오별 안내

이 시스템을 "설치하는 것"과 어떤 작업 폴더를 그 설치에 "연동하는 것"은
서로 다른 축이다 - 설치(위 "실행 방법")는 한 번만 하고, 이후 여러
폴더/프로젝트를 그 설치 하나에 계속 연동해 쓸 수 있다. 아래 6가지
시나리오는 그 두 축의 조합이다. 어느 시나리오에 해당하는지는 먼저
"이 PC(또는 원격 서버)에 이미 이 시스템이 설치돼 있는가"와 "그 설치가
이 폴더 하나만을 위한 전용 설치인가, 여러 프로젝트를 담을 공용
설치인가"로 판단한다.

각 시나리오 공통으로, "현재 작업 폴더"를 연동하는 마지막 단계는 항상
같다:
```bash
docs auth login --api <서버 주소> --username <아이디> --password <비밀번호>   # 최초 1회, 서버당
docs project-create <프로젝트 이름> --group <groupId>   # 없으면 team-create/group-create부터
docs git link <projectId>   # Gitea에 빈 저장소 생성, clone URL 반환
git remote add origin <반환된 clone URL>   # 이미 git 저장소면: git remote set-url 또는 새 원격 추가
git push -u origin <현재 브랜치>   # 기존 코드를 그 저장소로 최초 push(백엔드는 clone/push를 대행하지 않음)
docs template deploy <projectId>   # CLAUDE.md/SKILL.md를 Gitea 저장소에 직접 커밋
git pull   # 방금 커밋된 CLAUDE.md/SKILL.md를 로컬로 받기
```
(`docs template deploy`는 로컬 파일을 직접 안 건드리고 Gitea REST API로
그 저장소에 바로 커밋한다 - 그래서 마지막에 `git pull`이 필요하다.)

1. **로컬 설치(신규) + 현재 작업 폴더 연동** - 위 "Docker Compose"
   절대로 이 PC에 처음 설치한 뒤, 위 공통 단계를 그대로 따른다. 이후
   이 PC의 다른 폴더/프로젝트도 같은 설치에 계속 연동할 수 있다(PC
   전체를 커버하는 공용 설치).
2. **로컬 설치(기존) + 현재 작업 폴더 연동** - 이 PC에 이미 떠 있는
   설치가 있으면 설치 단계는 건너뛰고 공통 단계만 따른다(`docs auth
   login`이 이미 로그인돼 있으면 그것도 생략).
3. **로컬, 폴더 전용 설치** - "이 폴더 하나만을 위한" 전용 설치를
   원하면, `docker/` 스택 자체(또는 호스트 직접 설치의 데이터
   디렉터리)를 그 작업 폴더 하위의 전용 디렉터리(예: `.cnwk-server/`,
   `.gitignore`에 추가)에 두고 정확히 프로젝트 1개만 만든다 - 절차는
   시나리오 1과 동일하고, 다른 폴더/프로젝트와 공유하지 않는 개인
   전용 인스턴스가 된다는 점만 다르다.
4. **원격 설치(신규) + 현재 작업 폴더 연동** - 원격 서버에서 "Docker
   Compose" 절을 그대로 따르되, `.env`의 `PUBLIC_BACKEND_URL`/
   `PUBLIC_GITEA_URL`을 그 서버의 실제 공개 주소로 채운다(예:
   `https://cnwk.example.com`). 로컬 머신에서는 공통 단계의 `--api`에
   그 공개 주소를 쓴다.
5. **원격 설치(기존) + 현재 작업 폴더 연동** - 서버 설치 단계는
   건너뛰고, 로컬 머신에서 `docs auth login --api https://<서버 주소>
   ...`부터 공통 단계를 따른다.
6. **로컬 설치 → 원격 설치로 이전** - 순수 인프라 이전(애플리케이션
   코드/스키마 변경 없음, `prisma db push`가 그대로 멱등하게 동작):
   - `postgres-data`/`gitea-data`/`meili-data`/`emqx-data` 네 개
     Docker 볼륨을 새 호스트로 옮긴다(가장 간단한 방법: `docker
     run --rm -v <volume>:/from -v /host/backup:/to alpine tar czf
     /to/<volume>.tgz -C /from .`로 각각 백업 후 새 호스트에서 풀기 -
     Postgres만 별도로 `pg_dump`/`pg_restore`를 써도 무방).
   - 새 호스트의 `.env`에서 `PUBLIC_BACKEND_URL`/`PUBLIC_GITEA_URL`을
     그 서버의 실제 공개 주소로 갱신한다 - self_hosted 저장소의 clone
     주소가 이 값 기준으로 즉시 재계산되므로(#gitea-per-project-namespace),
     저장소를 다시 만들거나 옮길 필요가 없다.
   - 기존에 이 설치를 쓰던 모든 로컬 머신에서 `docs auth login --api
     <새 주소> ...`를 다시 실행하거나(가장 간단), `~/.claude-native-
     workflow/credentials.json`의 `api_base` 필드를 직접 새 주소로
     고친다.

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
