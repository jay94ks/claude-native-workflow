---
id: PLANACCT1
parent_id: XJQCTF6Y
type: plan
kind: PL
state: done
branch: null
commit_id: null
title: 계정 관리 - 임시 비밀번호 강제 변경 + 계정 비활성화/삭제 절차
author: agent
related:
  - SP-PSTRUCT01
---

# PL-PLANACCT1 - 계정 관리 기능

`docs/design-notes.md`("회원가입/초대 절차 (제안 - 확인 필요)" 절,
1101-1103행)에 "미정"으로 남겨둔 두 항목 - Phase 0 스캐폴딩 이후
한 번도 다뤄지지 않았고, 지금 코드베이스에 전혀 구현돼 있지 않다
(`grep`으로 `deactivate`/`account.delete`류 로직 부재 확인).

## v2 조사 결과 (`git show v2:backend/src/core/auth.ts`)

- **"시스템 전체 Admin"(superAdmin)은 별도 role 필드가 아니라
  부트스트랩 계정(username 하드코딩, `DEFAULT_ADMIN_USERNAME`)을
  그대로 최고 관리자로 취급하는 방식**이었다(`isSuperAdmin()`이
  `userId === cachedAdminUserId`만 확인) - "admin이 곧 설치자"라는
  전제. v3도 부트스트랩 `admin` 계정이 이미 있으므로 **이 패턴을
  그대로 계승**하면 된다 - 별도 role 컬럼/설계자 확인 없이 착수
  가능(오히려 v2보다 단순하게, `Account.username === 'admin'`이
  아니라 최초 시드된 계정의 `id`를 캐싱하는 방식으로).
- **"임시 비밀번호"는 v2에도 있었다 - 단, admin이 대신 재설정하는
  용도**(`resetPasswordAsAdmin`, "이메일 발송 인프라가 없어
  self-service 비밀번호 찾기 대신 택한 방식") - 무작위 32자
  hex를 생성해 그 자리에서만 평문으로 반환하고 어디에도 저장하지
  않는다(API 키 secret과 동일한 "1회 노출" 원칙). 별도로
  `changeOwnPassword`(현재 비밀번호 확인 후 직접 변경)도 있다.
  **v2에는 "다음 로그인 시 반드시 바꾸도록 강제하는" 메커니즘 자체가
  없었다** - admin이 알려준 임시 비밀번호를 계속 써도 시스템이
  막지 않는다. 즉 원 요청의 "강제 변경"은 v2에 없던 v3의 신규
  결정 사항이다(아래 질문 참고).
- **계정 비활성화/삭제(계정 자체를 지우거나 잠그는 기능)는 v2에도
  전혀 없었다** - `userRoutes.ts`의 admin 전용 DELETE 엔드포인트는
  전부 "멤버십"(프로젝트/팀/그룹에서 빼기)만 다루고, `User` 레코드
  자체를 지우거나 잠그는 경로는 없다. 이 부분은 계승할 v2 정책이
  없으므로 순수 신규 설계다.

## 범위

1. **임시 비밀번호 재설정(admin 대행)** - v2의 `resetPasswordAsAdmin`
   패턴을 그대로 계승: superAdmin이 대상 계정의 비밀번호를 무작위
   문자열로 재설정하고, 그 값을 응답에 1회만 평문으로 실어준다.
2. **다음 로그인 강제 변경 여부** - v2에 없던 신규 기능이라 착수 전
   설계자 확인 필요(아래 질문).
3. **계정 비활성화** - `Account.disabledAt: DateTime?` 추가, 로그인
   시 이 값이 있으면 거부. superAdmin 전용.
4. **계정 삭제** - 콘텐츠(작성한 Document/RememberItem 등) 보존
   정책이 v2에 선례가 없으므로 착수 전 설계자 확인 필요(아래 질문).

## 설계자 확인 결과

- **비밀번호 정책**: v2와 동일 수준으로 - admin이 임시 비밀번호를
  재설정해주고, 강제 변경(mustChangePassword) 메커니즘은 신규
  도입하지 않는다.
- **삭제 시 콘텐츠 처리**: 콘텐츠 보존 - 계정을 지워도 그 계정이
  생성한 프로젝트/문서는 사라지지 않는다.

## 진행 상태

- [x] `v2` 브랜치 조사 완료(위 "v2 조사 결과" 절에 기록) - superAdmin/
      임시 비밀번호는 계승, 비활성화/삭제는 신규 설계임을 확인.
- [x] 설계자 확인: "강제 변경 없음"(v2 동일) + "삭제 시 콘텐츠 보존"
      두 가지 모두 확정(위 "설계자 확인 결과" 절).
- [x] Prisma 스키마 변경 - `Account.disabledAt: DateTime?` 추가.
      `mustChangePassword`는 확인 결과에 따라 만들지 않았다.
      `ProjectMembership`/`ProjectInvite`/`ApiKey`/`RememberItem`/
      `Template`의 `account`/`owner` 관계에 `onDelete: Cascade`를
      명시(계정 자신의 소유물이라 계정 삭제 시 같이 사라져도 되는
      것들) - `Project.creator`는 일부러 그대로 뒀다(기본 Restrict,
      아래 "실기동 중 발견한 버그" 참고).
- [x] 백엔드 액션(`backend/src/core/accounts.ts` 신규) -
      `account.list`/`changePassword`/`resetPassword`/`disable`/
      `enable`/`delete`, superAdmin 검증은 v2의 `isSuperAdmin`
      패턴 그대로(`backend/src/core/auth.ts`에 추가, 부트스트랩
      `username === "admin"` 계정의 id를 캐싱). `login()`에
      `disabledAt` 체크 추가 + `accountDisable`이 기존 `ApiKey`를
      전부 삭제해 즉시 로그아웃시킨다.
- [x] REST 엔드포인트(`GET/PUT /accounts`, `/account/password`,
      `/accounts/:id/{reset-password,disable,enable}`,
      `DELETE /accounts/:id`) + CLI(`docs account *`)/MCP
      (`account.list`는 query, 나머지는 mutation) 노출.
- [x] 프론트엔드 - `MainLayout.vue` 상단바 아바타에 메뉴(비밀번호
      변경/계정 관리) 추가, `components/ChangePasswordDialog.vue`
      (신규, 자기 비밀번호 셀프 변경), `pages/AccountsPage.vue`
      (신규, `/accounts` - superAdmin 전용 목록+재설정/비활성화/
      활성화/삭제, superAdmin 자기 자신 행은 위험 버튼을 숨김).
- [x] 실기동 검증(로컬 dev 스택, CLI를 superAdmin 채널로 사용) -
      계정 생성→재설정→로그인(임시 비번 통함)→비활성화→로그인
      거부+기존 apiKey 무효화 확인→활성화→로그인 복구→삭제(성공)
      까지 CLI/REST curl로 전 구간 확인. superAdmin 자기 자신에
      대한 disable/delete 거부도 확인. 웹 UI에서도 동일 플로우
      (재설정/비활성화/활성화)를 직접 클릭해 재확인 + 셀프 비밀번호
      변경(틀린 현재 비밀번호 거부 포함) 확인.
- [x] `docs/project-structure.md` 갱신.

## 실기동 중 발견한 버그 - "콘텐츠 보존"이 실행 불가능한 약속이었다

계정 삭제 가드를 "생성한 프로젝트가 있으면 거부, `project.transfer`로
넘기라"고 안내하도록 짰는데, 실기동 검증 중 `project.transfer`가
**Admin 역할만 옮길 뿐 `Project.creatorAccountId`(웹 URL
`/{생성자}/{project id}`의 그 필드)는 절대 안 바꾼다**는 걸
재확인했다(`projects.ts` 주석에도 이미 명시돼 있었음) - 즉 내가 쓴
에러 메시지가 안내하는 방법이 애초에 존재하지 않았다. **콘텐츠
보존 정책 자체가 실행 불가능한 약속이 되는 진짜 문제**라 판단해,
`project.transferOwnership`(신규 액션, `projects.ts`)을 새로
추가해 `creatorAccountId` 자체를 옮기게 했다 - 그 프로젝트의
Admin이거나 superAdmin이면 호출 가능(대상 계정이 이미 로그인 못하는
상황 대비), 대상은 이미 collaborator여야 하고, 대상 계정 범위에
같은 slug가 있으면 거부. **여기서 2차 버그를 하나 더 발견**: 소유권만
옮기고 `ProjectMembership`의 ADMIN 역할은 그대로 두면, 그 계정을
지우는 순간 그 멤버십 행이 cascade로 같이 사라져 그 프로젝트에
Admin이 한 명도 안 남는 사고가 났다(실기동으로 직접 재현해서 발견-
admin이 WRITE 역할로만 남고 원래 창작자의 ADMIN 멤버십이 삭제됨) -
`accounts.ts`의 `accountDelete`에 "이 계정이 ADMIN으로 남아있는
프로젝트가 있으면 `project.transfer`로 그 역할부터 넘기라"는 두
번째 가드를 추가해 막았다. REST(`/transfer-ownership`)/CLI/MCP에도
반영, `settings/GeneralPage.vue`의 Danger Zone에 "양도"(Admin 역할)
와 별개로 "소유자(생성자) 변경" 카드를 추가했다.

## 판단해두는 것

- superAdmin 판정은 v2와 동일하게 "부트스트랩 계정만 최고 관리자"
  방식을 그대로 쓴다 - 별도 role 필드나 승격 기능은 만들지 않는다
  (v2도 그렇게 살아남았고, 이 프로젝트 규모에서 과설계로 판단).
- `account.delete`는 (1) 생성한 프로젝트가 남아있으면, (2) ADMIN
  역할이 남아있는 프로젝트가 있으면 각각 거부한다 - 둘 다 해소해야
  삭제 가능(순서: `project.transferOwnership`으로 소유권 먼저,
  `project.transfer`로 Admin 역할 나중, 또는 반대 순서도 무관).
