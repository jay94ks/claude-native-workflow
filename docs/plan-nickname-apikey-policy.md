---
id: PLANNICKN
parent_id: XJQCTF6Y
type: plan
kind: PL
state: done
branch: null
commit_id: null
title: 닉네임 정책 + 개인/프로젝트별 API 키 세분화 (v2 정책 계승)
author: agent
related:
  - SP-PSTRUCT01
  - PL-PLANACCT1
---

# PL-PLANNICKN - 닉네임 / API 키 정책

`docs/design-notes.md`("닉네임 정책 / 사용자별 API 키 관리 - v2
정책 계승" 절, 1121-1134행)에서 "v2 정책만 계승, 구현은 v3 구조에
맞게 새로"라고 정했지만 실제로 한 번도 다뤄지지 않았다.
`backend/prisma/schema.prisma:114-116`의 `ApiKey` 모델 위 주석에
"스캐폴딩 단계에서는 계정 단위 키만 둔다 ... 실제 기능 구현
라운드에서 다시 다룬다 (TODO)"라고 Phase 0 때부터 그대로 남아있다.

## 범위

1. **닉네임 정책**(v2 정책 계승 - 착수 전 `v2` 브랜치에서 실제 규칙
   확인 필요): `Account.username`과 별개로 표시용 닉네임을 둘지,
   아니면 `username` 자체에 v2의 형식 규칙(길이/문자셋/중복 처리
   등)을 적용할지부터 v2 코드를 읽고 결정한다.
2. **API 키 세분화** - 지금은 `ApiKey`가 `accountId`에만 묶여
   "그 계정의 키 하나"처럼 쓰이고 있다(로그인마다 새 키 발급인지,
   재사용인지도 다시 확인 필요 - `backend/src/core/auth.ts` 확인).
   v2의 "개인 키/프로젝트 키" 구분을 계승하려면:
   - `ApiKey`에 `projectId: String?`(null이면 "개인 키", 있으면 그
     프로젝트 전용) 추가.
   - 키 발급/조회/회수(revoke) 액션 - 지금은 로그인 시 자동 발급만
     있고 별도 발급/회수 액션이 아예 없다.
   - CLI/MCP가 여러 키를 다룰 수 있게(`.cnw/config.json`이 지금은
     "그 프로젝트에 로그인된 키 하나"만 가정하고 있는지 확인).

## v2 조사 결과 (`git show v2:backend/src/core/auth.ts`, `apiKeys.ts`, `requestScope.ts`)

- **닉네임**: `nickname: String?`(중복 허용) + `nicknameNumber: Int`
  (같은 nickname 문자열, 또는 미설정 시 공통 풀 "설계자" 안에서의
  순번 - 표시 라벨 `"{nickname ?? '설계자'} #{번호}"`를 구성) +
  `nicknameChangedAt`(7일 변경 쿨다운). 번호는 매 조회마다 다시
  세지 않고 "그 라벨로 바뀌는 시점"에만 `nextNicknameNumber()`
  (그 풀에서 `max(nicknameNumber)+1`)로 계산해 확정 저장한다. 같은
  값으로 "변경"해도 실제로 안 바뀌었으면 쿨다운을 소모하지 않는다.
- **API 키**: `scope`("personal"|"project"|v2는 "team"도 있었으나
  v3엔 팀이 없어 대상 아님) + `projectId`(project 스코프만) +
  `label`/`keyPrefix`(원문 재노출 없이 목록에서 구분용)/`lastUsedAt`/
  `expiresAt`/`revokedAt`(하드 삭제 아닌 soft-revoke - 감사 기록
  보존). **스코프 강제 메커니즘이 핵심**: v2는 `core/requestScope.ts`
  (`AsyncLocalStorage`)로 "지금 이 요청이 어떤 키로 인증됐는가"를
  요청 전체에 전파해, 멤버십 조회(`core/members.ts`) 최상단에서
  `scope.type === "project" && scope.projectId !== projectId`면
  실제 멤버십과 무관하게 즉시 거부한다 - 액션 핸들러마다 개별
  체크를 끼워 넣는 대신 단 하나의 choke point에서 강제한다.

## 범위(v2 정책 그대로 계승, v3 구조에 맞게 이식)

1. **닉네임 정책** - 위 v2 규칙 그대로.
2. **API 키 세분화** - `personal`(로그인과 동등, 무제한) /
   `project`(그 프로젝트 안에서만) 두 스코프만 계승("팀 키" 제외).
   `backend/src/core/requestScope.ts`(신규, v2 계승) +
   `membership.ts`의 `requireMembership()` 최상단에서 강제.

## 진행 상태

- [x] `v2` 브랜치 조사 완료(위 "v2 조사 결과" 절) - 닉네임/API 키
      둘 다 충분히 구체적인 기존 정책이 있어 설계자 추가 확인 없이
      그대로 이식 가능하다고 판단.
- [x] `PLANACCT1` 완료 후 착수 - `Account`(닉네임 3필드)/`ApiKey`
      (scope/projectId/label/keyPrefix/lastUsedAt/expiresAt/
      revokedAt) 스키마 변경을 한 마이그레이션으로 정리.
- [x] 백엔드 - `core/requestScope.ts`(신규, v2 계승), `core/auth.ts`
      (`nextNicknameNumber`/`formatDisplayLabel`, `login()`이 만드는
      키는 항상 personal, `resolveApiKey()`가 scope/revoked/expired
      판정), `core/accounts.ts`(`accountMe`/`accountUpdateNickname`
      추가, `accountList`에 displayLabel 포함), `core/apiKeys.ts`
      (신규 - `apiKeyCreate`/`List`/`ListForProject`/`Revoke`),
      `authMiddleware.ts`(`req.keyScope` 설정), `api/server.ts`/
      `api/rest.ts`(핸들러 실행을 `runWithKeyScope()`로 감쌈),
      `membership.ts`(scope 불일치 시 최우선 거부), `accounts.ts`의
      `requireSuperAdmin`/`projects.ts`의 `projectCreate`도 restricted
      스코프 키를 거부(계정 관리·새 프로젝트 생성은 애초에 특정
      프로젝트로 좁힐 수 없는 시스템 전체 동작이므로).
- [x] REST(`GET/PUT /account/me,nickname`, `GET/POST /api-keys`,
      `DELETE /api-keys/:id`, `GET /projects/:o/:p/api-keys`) +
      CLI(`docs account me/updateNickname`, `docs apiKey *`) +
      MCP(`account.me`/`apiKey.list*`는 query, 나머지는 mutation)
      노출.
- [x] 프론트엔드 - `MainLayout.vue` 상단바에 표시 라벨(닉네임 #번호)
      노출 + 아바타 메뉴에 "닉네임 변경"/"API 키 관리" 추가,
      `components/NicknameDialog.vue`(신규), `pages/ApiKeysPage.vue`
      (신규, `/keys` - 내 personal/project 키 목록+발급+배제),
      `settings/GeneralPage.vue`에 "API 키(이 프로젝트로 발급된 것)"
      카드(Admin 전용, 다른 collaborator의 project 키까지 배제 가능).
- [x] 실기동 검증(로컬 dev 스택, curl + CLI + 웹 UI 모두) - 닉네임:
      새 계정 가입마다 "설계자" 풀 번호가 실제로 증가하는 것, 같은
      문자열로 여러 계정이 바꾸면 그 풀에서 번호가 늘어나는 것
      ("Jay #1"/"Jay #2"), 7일 쿨다운 거부, 같은 값 재제출은 쿨다운을
      안 먹는 것까지 확인. API 키: project 스코프 키 발급(그 프로젝트
      collaborator만 가능, 아니면 거부) → 그 프로젝트 안에서는 정상
      동작 → **실제로 다른 프로젝트에 대해서는 거부되는 것**(그
      계정이 그 다른 프로젝트의 진짜 멤버여도 키의 스코프가 이기는
      것까지 확인) → `account.list`/`project.create`처럼 시스템
      전체 동작은 project 키로 아예 거부되는 것 → 프로젝트 Admin이
      남의 project 키를 배제하면 그 키가 즉시 401로 막히는 것까지
      전 구간 확인. 프론트엔드도 닉네임 변경/personal·project 키
      발급/배제 버튼을 직접 클릭해 재확인.
- [x] `docs/project-structure.md` 갱신.

## 실기동 중 발견한 버그 - 프론트 라우트 "/api-keys"가 Vite 프록시와 충돌

`pages/ApiKeysPage.vue`를 처음 `/api-keys`에 연결했더니 브라우저가
"Cannot GET /api-keys"(Express 기본 404)를 그대로 보여주며 화면
자체가 안 떴다 - `frontend/quasar.config.*`의 dev 프록시 설정
(`"/api": { target: "http://127.0.0.1:8388" } `)이 문자열 접두사로만
매치해서 "/api-keys"도 "/api"로 시작한다는 이유로 백엔드로 그대로
포워딩해버렸다(백엔드엔 최상위 `GET /api-keys` 라우트가 없으니
Express 자체 404). 프론트 라우트를 `/keys`로 바꿔서 피했다 - 실제
REST 엔드포인트(`/api/api-keys`)는 `/api/`로 시작해 프록시 대상이
맞으므로 그대로 뒀다.

## 판단해두는 것

- `docs/index.md` 순서상 `PLANACCT1` 다음으로 처리했다(CLAUDE.md
  "작업 방식" 1단계) - 실제로 `Account`/`ApiKey` 스키마가 겹쳐서
  한 마이그레이션으로 정리하길 잘했다.
- 기존(마이그레이션 이전) 계정들의 `nicknameNumber`는 스키마 기본값
  1로 백필됐다 - 전부 "설계자 #1"로 겹쳐 보이는 화면상 사소한
  흠이지만, 실제 계정 수가 적은 로컬 데모 데이터에 한한 문제이고
  새로 만들어지는 계정/닉네임 변경은 전부 정확한 번호를 받으므로
  다음 라운드로 넘기지 않는다(마이그레이션 스크립트로 굳이 되짚어
  재계산할 실익이 낮다고 판단).
- project 키의 소유자가 자기 키를 스스로 배제하는 것과, 그 프로젝트
  Admin이 남의 project 키를 배제하는 것 둘 다 허용한다(v2의 "owner가
  프로젝트 키 전체를 관리" 계승).
- **후속 처리(2026-09-21, 같은 날 후속) - superAdmin 강제 배제 추가**:
  본인도 아니고 그 프로젝트 Admin도 아닌 경우를 위해(예: 키 소유
  계정이 이미 잠겨서 본인이 못 지우거나, project 키인데 그 프로젝트에
  Admin이 하나도 안 남은 상황) superAdmin이 아무 키나 강제로 배제할
  수 있는 경로를 `apiKeyRevoke`에 추가했다 - `accounts.ts`의
  `requireSuperAdmin`과 같은 원칙으로 project 스코프로 제한된 키
  로는 이 경로 자체를 쓸 수 없다(`getActiveKeyScope().type ===
  "unrestricted"`도 같이 확인). 실기동으로 계정 생성→personal 키
  발급→superAdmin이 (소유자도 프로젝트 Admin도 아닌 채로) 강제
  배제→그 키가 즉시 401로 막히는 것까지 확인했다.
