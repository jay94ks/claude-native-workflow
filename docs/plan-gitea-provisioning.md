---
id: PLANGITEA
parent_id: XJQCTF6Y
type: plan
kind: PL
state: done
branch: null
commit_id: null
title: Gitea 서버 실제 프로비저닝 (조직/저장소 자동 생성, push-mirror 연동)
author: agent
related:
  - SP-PSTRUCT01
---

# PL-PLANGITEA - Gitea 실제 프로비저닝

`docs/design-notes.md`("Phase 5 완료 기록"/"Phase 6 완료 기록" 절,
1404-1456행)에서 명시적으로 다음 라운드 과제로 남긴 항목 - 지금은
`./data/repos/<projectId>`에 es-git으로 로컬 저장소만 유지하고,
`docker-compose.dev.yml`/`docker-compose.yml`에 `gitea` 서비스
자체는 이미 떠 있지만(`cnw-gitea-1`) 이 시스템이 실제로 그 Gitea에
조직/저장소를 만들거나 연동하는 코드는 전혀 없다.

## 범위

1. **프로젝트 생성 시 Gitea 조직/저장소 자동 생성** - `project.create`
   액션에서 Gitea admin API(토큰 인증)를 호출해 그 프로젝트에 대응하는
   조직(또는 사용자)+저장소를 만든다. 실패 시 프로젝트 생성 자체를
   롤백할지, 로컬 저장소만으로 계속 진행하고 경고만 남길지 판단 필요
   (다른 기능들이 "인프라 연결 실패는 경고만, 핵심 흐름은 막지 않는다"
   는 원칙을 이미 따르고 있음 - 웹훅 발송 실패, Meilisearch/EMQX
   미연결 시 처리와 동일한 판단 기준 적용 검토).
2. **`Project.pushMirrorUrl`을 이 자동 생성된 Gitea 저장소로 자동
   채우기** - 지금은 이 필드를 프로젝트 설정에서 수동으로 입력해야만
   `repo.push`가 실제로 어딘가에 밀어준다.
3. **push-mirror URL 변경 시나리오 보강**(design-notes.md
   1435-1440행에서 같이 언급된 관련 항목) - es-git에 remote URL
   갱신 API가 없어 지금은 한 번 만든 "mirror" remote를 못 바꾼다 -
   remote를 지우고 다시 만드는 방식으로 `pushToMirror`를 보강.
4. Gitea admin API 인증 토큰을 어디서/어떻게 관리할지(환경 변수
   추가, `.env.example` 갱신) 설계.

## v2 조사 결과 (`git show v2:backend/src/core/gitea.ts`, `giteaAccounts.ts`)

- **v2는 "설계자별 Gitea 사용자 계정 자동 프로비저닝"과 "프로젝트당
  Gitea org 자동 생성"을 둘 다 한다 - 하지만 이건 v3와 근본적으로
  다른 아키텍처를 전제로 한다.** v2는 Gitea 자체가 **주(primary)
  git 저장소**다(설계자가 Gitea에 직접 clone/push하고, 백엔드도
  Gitea REST API로 파일을 커밋한다) - 그래서 "누구 이름으로 커밋할
  것인가"를 위해 설계자마다 그림자 Gitea 계정+PAT이 필요했다
  (`ensureGiteaAccountForUser`, fail-soft - 가입을 막지 않음).
  **v3는 이미 `backend/src/core/gitRepo.ts`의 es-git 로컬 저장소가
  주 저장소이고, Gitea(또는 어떤 외부 git 서버든)는 옵션
  push-mirror 대상일 뿐**(`Project.pushMirrorUrl`, `repo.push`가
  존재할 때만 그리로 미러링) - 커밋 저작자 문제 자체가 없다(로컬
  커밋은 이미 `commitFile()`이 `{name: ctx.channel, ...}`로 만듦).
  **결론: v2의 "설계자별 Gitea 계정" 부분은 v3에 대상이 아니다**
  (계승할 게 없음) - 계승 대상은 오직 "프로젝트당 org 하나, 그 org
  아래 저장소 하나"(`orgForProject(projectId)`가 DB 컬럼 없이
  projectId의 순수 함수) + 저장소 생성 API 호출 패턴뿐이다.
- **v2의 org/저장소 생성은 `project.create` 시점 자동이 아니라
  "그 프로젝트가 처음 Gitea에 연결되는 시점"에 별도로 호출된다**
  (`ensureProjectOrgConfigured()`, 실패를 fail-soft로 삼키지 않고
  그대로 던진다 - "설계자가 명시적으로 요청한 연결이니 실패하면
  분명히 알려야 한다"는 판단으로 읽힘). v3도 이미 `pushMirrorUrl`을
  "옵션, Admin이 직접 입력"으로 설계해뒀으므로(설정 화면에 이미
  입력창이 있음) - **이 정책을 그대로 계승**: `project.create`가
  아니라 별도 명시적 액션(`repo.connectGitea`, Admin 전용)에서만
  Gitea org+저장소를 만들고 `pushMirrorUrl`을 자동으로 채운다.
  이렇게 하면 "생성 실패 시 프로젝트 생성 자체를 롤백할지" 고민
  자체가 사라진다(원래 범위 1번 항목의 딜레마 해소).
- `createRepo()` 호출 형태: `POST /api/v1/orgs/{org}/repos`
  `{name, private: true, auto_init: false}` - `auto_init: false`가
  중요하다(true면 Gitea가 README로 기본 브랜치를 미리 커밋해버려서
  로컬 es-git 저장소의 첫 push와 브랜치가 갈라진다 - v2가 실제
  재현 확인한 버그, 그대로 계승).
- **v3에 필요한 환경 변수는 이미 스캐폴딩돼 있다**
  (`docker-compose.yml`의 `backend` 서비스: `GITEA_URL`,
  `GITEA_API_TOKEN`) - v2의 3종(`GITEA_API_URL`/`GITEA_API_TOKEN`/
  `GITEA_ADMIN_USERNAME`) 중 `ADMIN_USERNAME`은 "공유 관리자
  네임스페이스에 커밋 저작자로 쓰기" 용도였는데 위에서 확인했듯
  v3엔 그 용도 자체가 없어 불필요 - 딱 2개만 있으면 된다.
- **로컬 dev 환경엔 Gitea 컨테이너가 없다** - `docker-compose.dev.yml`
  (postgres/meilisearch/emqx만)엔 gitea가 없고, `docker ps`에 보이는
  `cnw-gitea-1`은 **이 저장소와 무관한 `C:\CNW\docker-compose.yml`
  (사용자의 별도 운영 설치)의 컨테이너다 - 절대 건드리지 않는다**
  (기존 메모리 규칙). 실기동 검증을 하려면 이 저장소 전용의 새
  Gitea 컨테이너를 다른 포트로 따로 띄워야 한다.

## 범위(v2 정책 확인 후 재정의)

1. **`repo.connectGitea`(신규 액션, Admin 전용)** - 그 프로젝트의
   org를 프로젝트 내부 id로 멱등 생성(GET 후 없으면 POST) → 그
   org 안에 저장소 생성(`private:true, auto_init:false`) → 반환된
   clone URL에 `GITEA_API_TOKEN`을 자격증명으로 실어
   `Project.pushMirrorUrl`에 자동 저장. `project.create`는 전혀
   안 건드린다(v2도 그렇게 안 했음 - 위 조사 결과).
2. **push-mirror URL 변경 시나리오 보강** - es-git에 remote URL
   갱신 API가 없어 한 번 만든 "mirror" remote를 못 바꾼다 - remote를
   지우고 다시 만드는 방식으로 `pushToMirror` 보강(이 액션이 성공
   호출될 때마다 pushMirrorUrl이 새로 채워질 수 있으므로 필요).
3. Gitea 미설정(`GITEA_URL`/`GITEA_API_TOKEN` 없음) 시 이 액션
   자체가 명확한 에러로 거부한다(fail-soft 아님 - 설계자가 명시적
   으로 요청한 연결).

## 진행 상태

- [x] `v2` 브랜치 조사 완료(위 "v2 조사 결과" 절) - 아키텍처
      전제가 달라 "설계자별 계정" 부분은 대상 아님을 확인, "프로젝트당
      org" + "명시적 연결 시점" 두 가지만 계승 대상으로 재정의.
- [x] Gitea admin API 클라이언트 작성(`backend/src/core/gitea.ts`
      신규) - `ensureOrgConfigured`(멱등)/`ensureRepoConfigured`(멱등,
      `auto_init:false`)/`orgForProject`(순수 함수).
- [x] `repo.connectGitea` 액션(`backend/src/core/repo.ts`, Admin
      전용) + `Project.pushMirrorUrl` 자동 채우기 - REST(`POST
      /projects/:owner/:projectId/repo/connect-gitea`)/CLI(`docs repo
      connectGitea`)/MCP(mutation) 노출.
- [x] `gitRepo.ts`의 `pushToMirror` remote 재생성 보강 - es-git에
      remote 삭제/URL 변경 API가 아예 없어(`index.d.ts` 확인)
      `.git/config`의 `[remote "mirror"]` 섹션 `url=` 줄만 직접
      치환하는 `upsertMirrorRemoteUrl()`로 해결(child_process로 git
      CLI를 셸아웃하는 선례가 없어 그 관례를 안 깨는 선택).
- [x] 이 저장소 전용 Gitea 컨테이너 기동 - `docker-compose.dev.yml`에
      `gitea`(이미지 `gitea/gitea:1.22`, sqlite3, 호스트 포트 13000,
      컨테이너명 `cnw-v3-dev-gitea`) 추가, `gitea admin user
      create`/`generate-access-token`으로 관리자 계정+API 토큰 발급.
      **`docker ps`에 보이는 `cnw-gitea-1`은 `C:\CNW\docker-compose.yml`
      (사용자의 별도 운영 설치)의 컨테이너임을 확인하고 절대 안
      건드렸다** - 완전히 새 컨테이너/포트로만 작업했다.
- [x] 실기동 검증 - `repo.connectGitea` 호출 → Gitea REST API로 org/
      저장소가 실제로 생긴 것 확인 → `repo.push` → **실제 커밋이 그
      저장소 브랜치에 반영된 것**(Gitea API로 커밋 해시 직접 조회)
      까지 확인. push-mirror URL 변경 시나리오도 별도 repo를 만들어
      `pushMirrorUrl`을 그쪽으로 바꾼 뒤 재검증 - `.git/config`가
      실제로 갱신되고 새 대상으로 push되는 것 확인. `repo.connectGitea`
      재호출(멱등)도 확인. CLI/REST/웹 UI(Settings의 "Gitea에 자동
      연결" 버튼) 전 경로에서 확인 후 테스트 org/repo/pushMirrorUrl
      전부 정리.
- [x] `docs/project-structure.md` 갱신.

## 실기동 중 발견한 버그 두 가지

1. **es-git(libgit2)은 URL에 심은 자격증명(`http://token@host/...`)
   으로 인증하지 못한다** - 순수 git CLI로는 그 형태가 정상 동작하는
   걸 먼저 확인했는데(`git push`로 직접 재현), es-git의 `remote.push()`
   에 똑같은 URL을 주면 매번 401로 실패했다. `PushOptions.credential`
   (`{type:'Plain', username, password}`)로 명시적으로 넘겨야 인증된다
   - `gitRepo.ts`의 `pushCredentialFor()`가 이 방식으로 고쳤고, DB에
   저장하는 `pushMirrorUrl`엔 애초에 자격증명을 절대 안 심는 설계와도
   맞아떨어졌다(오히려 이 발견 덕분에 "URL에 토큰을 심으면 `project.get`
   응답으로 노출된다"는 원래 우려까지 자연스럽게 해소됐다).
2. **`GITEA_URL`이 Gitea의 실제 `ROOT_URL`과 문자열까지 정확히
   일치해야 한다** - 처음 `GITEA_URL=http://127.0.0.1:13000`으로
   설정했는데 Gitea의 `ROOT_URL`은 `http://localhost:13000/`라
   `clone_url`이 항상 `localhost` 표기로 온다 - `pushCredentialFor()`
   가 저장된 URL의 origin과 `GITEA_URL`의 origin을 문자열로 비교해서
   "localhost"≠"127.0.0.1"로 판정, 토큰을 안 실어서 조용히 401이
   났다(에러 메시지만으로는 원인을 알 수 없어 실제로 `.git/config`와
   두 URL을 나란히 찍어보고 발견). `GITEA_URL`을 `http://localhost:13000`
   로 맞추고, `gitea.ts`의 `config()`에 이 요구사항을 명시적으로
   주석으로 남겼다.

## 판단해두는 것

- `docs/index.md` 순서상 `PLANACCT1`/`PLANNICKN` 다음(가장 마지막)
  으로 처리한다 - 인프라 연동 범위가 가장 넓고, 실패 시 다른 두
  계획보다 되돌리기 까다로운 변경(외부 서버에 실제로 조직/저장소가
  생성됨)이라 신중하게 마지막에 다뤘다.
- v2의 "설계자별 그림자 Gitea 계정" 기능은 명시적으로 이식하지
  않는다 - v3엔 그 기능이 풀려는 문제(누구 이름으로 Gitea에 직접
  커밋할지) 자체가 없다(위 조사 결과).
- 프로젝트 파기(`project.destroy`) 시 그 프로젝트의 Gitea org를
  같이 정리하는 건 이번 범위에 넣지 않았다 - 실기동 중 Gitea가
  "저장소가 남아있는 org는 삭제 거부"한다는 것도 확인했으니, 필요해
  지면 다음 라운드에서 (v2의 `deleteOrg()`처럼) fail-soft 정리
  단계로 추가할 수 있다.
- `project.get`이 `pushMirrorUrl`을 READ 권한만 있으면(공개
  프로젝트면 비멤버에게도) 그대로 노출하는 건 **이번에 새로 만든
  문제가 아니라 기존부터 있던 동작**이다(설계자가 직접 외부 URL에
  자기 자격증명을 심어 입력하는 기존 흐름 자체가 이미 그랬음) - 이번
  라운드는 그 노출 범위를 "시스템 전체 공유 Gitea 토큰"으로 넓히지
  않도록(자동 생성 URL엔 자격증명 자체를 안 심는 설계) 막는 데까지만
  다뤘고, "pushMirrorUrl을 Admin에게만 보이게 하자"는 더 넓은 개선은
  별도 판단이 필요한 사항으로 남긴다.
