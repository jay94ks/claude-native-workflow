---
id: PLANGHOA
parent_id: XJQCTF6Y
type: plan
kind: PL
state: done
branch: v3
commit_id: null
title: GitHub OAuth 연결 - push-mirror 설정 화면에 추가
author: agent
related:
  - SP-XJQCTF6Y
  - SP-PSTRUCT01
  - PL-PLANGITEA
---

# PL-PLANGHOA - GitHub OAuth 연결(push-mirror) 계획

## 라운드 1 (2026-09-22) - 계획 수립

설계자 요청: "v2에서 구현했던 GitHub 로그인을 push-mirror 설정하는
화면에 추가해줘." v2 브랜치를 조사(git show, 체크아웃 없이)한 결과:

### v2 조사 결과 요약

- v2의 "GitHub 로그인"은 **claude-native-workflow 자체 로그인의
  대체 수단이 아니라**, 이미 로그인된 architect가 자기 GitHub 계정을
  연결해 저장소를 고르는 기능이었다(`core/githubOAuth.ts`의 자체
  주석: `"깃허브 로그인 + 저장소 선택" 흐름`) - v3의 "push-mirror"
  개념과 정확히 대응.
- OAuth 플로우: `POST .../oauth/github/start`(state를 메모리 Map에
  10분 TTL로 저장, `authorizeUrl` 반환) → 프론트가 팝업 창으로 염 →
  `GET .../oauth/github/callback`(인증 미들웨어 없음 - 브라우저
  리다이렉트라 Authorization 헤더를 못 실음, state로 사용자 식별) →
  code를 토큰으로 교환 → `window.opener.postMessage(...)` 후 자동
  닫힘 → 부모 창이 그 메시지를 받아 저장소 선택 다이얼로그를 띄움.
  redirect_uri는 고정 env var가 아니라 매 요청의 `req.protocol`+
  `req.get("host")`로 동적 계산(어떤 주소로 접속했든 항상 맞음).
  scope는 `"repo"` 하나.
  토큰은 **User(architect) 단위**로 저장(프로젝트 단위 아님) - 재사용
  가능한 자격증명 개념.
- v2는 저장소를 자동 생성하지 않고 **이미 있는 저장소 중 골라서**
  그 clone URL을 링크 대상으로 썼다(Gitea 자동 연결과 다른 점).
  이후 mirror/work 저장소 이원화, 웹훅 등록 등 v2 특유의 무거운
  구조로 이어지는데, 이건 v3의 단순한 `pushMirrorUrl` 한 필드
  모델과 안 맞아 가져오지 않는다.
- 필요한 환경변수: `GITHUB_OAUTH_CLIENT_ID`/`GITHUB_OAUTH_CLIENT_SECRET`
  (GitHub OAuth App 등록, 콜백 URL은 `<서버 주소>/api/git/oauth/
  github/callback`) - 하드코딩된 시크릿 없음, 그대로 참고해도 안전.

### v3로 가져올 때의 판단

**v2의 무거운 mirror/work 이원화+웹훅 자동 등록은 가져오지 않는다** -
v3의 push-mirror는 이미 "`Project.pushMirrorUrl` 하나, `repo.push`를
누르면 그 URL로 내부 저장소를 그대로 push"라는 단순한 모델이고
(`repoConnectGitea`가 이미 그 패턴), 이번 기능도 그 패턴에 맞춘다:
GitHub OAuth로 **로그인 + 저장소 선택**까지만 하고, 고른 저장소의
clone URL을 `Gitea에 자동 연결`과 똑같이 `pushMirrorUrl`에 넣는다.

**GitHub 토큰 저장 위치**: Gitea는 서버 전체가 공유하는 서비스
계정 토큰(`GITEA_API_TOKEN` env var)이라 프로젝트마다 다시 물을
필요가 없었지만, GitHub OAuth 토큰은 **그걸 연결한 architect
개인 소유**라 계정 단위로 저장해야 한다(v2와 같은 판단) - 신규
모델 `GithubCredential`(accountId당 하나, 재사용 가능). 어느
프로젝트의 push가 어느 architect의 토큰을 쓸지는 그 프로젝트가
GitHub로 연결될 때 `Project.pushMirrorGithubAccountId`에 기록해둔다
(Gitea 연결 프로젝트는 이 필드가 null - 서버 공유 토큰을 그냥 쓰므로).

**토큰 저장 방식(보안 트레이드오프, 명시적으로 기록)**: 이 저장소엔
아직 대칭키 암호화 유틸(`core/crypto.ts`는 API 키 해시용 단방향
해시뿐)이 없고, push 시점에 토큰을 다시 평문으로 꺼내 써야 하므로
해시는 쓸 수 없다. 기존 `Webhook.secret`도 평문 저장(API로 재노출만
안 함)이 이 저장소의 기존 관례라, 이번에도 평문 저장 + **API 응답에
토큰 필드를 절대 포함하지 않음**(webhook secret과 동일 원칙)으로
간다. GitHub OAuth 토큰이 웹훅 시크릿보다 민감도가 높다는 건 인지하고
있음(그 architect의 실제 GitHub 저장소 접근권) - 나중에 서버 전체
암호화 계층이 생기면 재검토 대상으로 여기 남겨둔다.

**OAuth state 저장**: v2와 동일하게 메모리 Map(10분 TTL) - 이
백엔드는 이미 단일 프로세스 가정이 여러 곳에 있다(EMQX 구독자 등).

### 백엔드 구현

- `core/githubOAuth.ts`(신규): `githubOAuthConfigured()`, 액션
  `github.status`(그 architect가 연결돼 있는지+GitHub 로그인명),
  `github.oauthStart`(state 발급, `authorizeUrl` 반환),
  `github.listRepos`(저장된 토큰으로 `GET /user/repos` 호출).
  콜백은 액션 시스템 밖의 **원시 Express 라우트**
  `GET /api/git/oauth/github/callback`(인증 미들웨어 없음 - state로
  본인 확인) - `server.ts`에 직접 등록, code→token 교환 후
  `GithubCredential` upsert, `postMessage` HTML 응답.
- `core/repo.ts`에 `repoConnectGithub` 추가(`repoConnectGitea`와
  같은 모양 - ADMIN 권한, `{projectId, cloneUrl}` 받아
  `pushMirrorUrl`+`pushMirrorGithubAccountId` 갱신).
- `core/gitRepo.ts`의 `pushCredentialFor()`를 비동기로 바꾸고
  projectId를 받아, 대상 origin이 github.com이면
  `Project.pushMirrorGithubAccountId`로 `GithubCredential`을 찾아
  그 토큰을 credential로 쓴다(Gitea 분기는 그대로 유지).
- 스키마: `GithubCredential{id, accountId(unique), accessToken,
  githubLogin?, createdAt}`, `Project.pushMirrorGithubAccountId
  String?`(FK, `onDelete: SetNull`).
- `actions.ts`/`rest.ts` 양쪽에 `github.status`/`github.oauthStart`/
  `github.listRepos`/`repo.connectGithub` 등록.

### 프론트엔드

- `GeneralPage.vue`의 push-mirror 영역(`pushMirrorUrl` 입력 +
  "Gitea에 자동 연결" 버튼 옆)에 "GitHub로 로그인" 버튼 추가 -
  `github.status`로 이미 연결돼 있으면 바로 저장소 선택 UI(간단한
  목록 다이얼로그, 페이지네이션)를 보여주고, 아니면 팝업으로 OAuth
  진행 후(postMessage 수신) 같은 선택 UI로 이어간다. 저장소를 고르면
  `repo.connectGithub`를 불러 `pushMirrorUrl`을 갱신(Gitea 버튼과
  동일한 패턴 - 결과 URL을 그대로 필드에 반영).
- `GITHUB_OAUTH_CLIENT_ID` 미설정이면 버튼 자체를 숨긴다(Gitea가
  `GITEA_URL`/`GITEA_API_TOKEN` 미설정 시 그러는 것과 동일).

### 검증 계획 및 한계

이 개발 환경엔 실제 GitHub OAuth App(`GITHUB_OAUTH_CLIENT_ID`/
`SECRET`)이 없어서 authorize→callback 왕복 자체는 라이브로 검증할
수 없다 - 대신: (1) 미설정 상태에서 버튼이 안 보이는 것, (2)
`tsc`/`vue-tsc --noEmit`, (3) `GithubCredential`에 테스트용 더미
토큰을 직접 심어 "연결된 상태"를 흉내내고 `github.listRepos`를
불러 GitHub API가 401을 정확히 돌려주고 그게 사용자에게 에러로
보이는지(진짜 실패 케이스 확인), (4) `repo.connectGithub`를 직접
호출해 `pushMirrorUrl`/`pushMirrorGithubAccountId`가 정확히
갱신되는지, (5) `docs/design-notes.md`/`project-structure.md` 갱신.
git commit/push는 설계자가 명시적으로 요청했을 때만.

## 라운드 2 (2026-09-22) - 실행 및 검증 완료

계획대로 구현 완료. 자세한 내용은 design-notes.md의 "GitHub OAuth
연결 - push-mirror 설정 화면에 추가" 절 참고 - 요약만 남긴다:

- 스키마(`GithubCredential`+`Project.pushMirrorGithubAccountId`)/
  `core/githubOAuth.ts`(액션 3개+원시 콜백 라우트)/`core/repo.ts`의
  `repoConnectGithub`/`core/gitRepo.ts`의 `pushCredentialFor()` 비동기화
  +GitHub 분기/프론트 `GeneralPage.vue` 버튼+다이얼로그 - 전부 계획대로.
- 계획에 없던 추가 판단: `repoConnectGitea`가 이제
  `pushMirrorGithubAccountId`도 같이 null로 초기화한다(Gitea로
  재연결하면 이전 GitHub 연결 정보가 남아있으면 안 됨 - 실기동으로
  재확인).
- 검증 한계(계획에 이미 명시): 실제 GitHub OAuth App이 없어 authorize→
  callback 왕복은 라이브로 못 검증 - 대신 더미 client_id/secret+더미
  `GithubCredential`로 URL 구성/에러 처리/DB 갱신/Gitea 재연결 시
  정리까지 전부 확인, 테스트 흔적은 전부 원복.

state: done.
