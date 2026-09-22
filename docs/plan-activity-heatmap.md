---
id: PLANACT01
parent_id: XJQCTF6Y
type: plan
kind: PL
state: done
branch: v3
commit_id: null
title: 문서 코드별 활동 히트맵/로그 - 종합 현황에 표시
author: agent
related:
  - SP-XJQCTF6Y
  - SP-PSTRUCT01
---

# PL-PLANACT01 - 문서 코드별 활동 히트맵/로그 계획

## 라운드 1 (2026-09-22) - 계획 수립

설계자 요청: "REST API들에서 각 추적 코드별로 어떤 동작을 언제 얼마나
했는지 수집해서 히트맵이나, 활동 로그 같은걸 종합 현황에서 보여줄 수
있도록 하자." - 바로 전 라운드에서 `DocTypeWorkspace`의 "종합 현황"
(문서 미선택 시 상태별/분류별 개수 집계)을 막 붙였는데, 여기에 시간
축(언제/얼마나) 정보를 더하는 자연스러운 후속이다.

### 조사 결과 (Explore 에이전트 + 직접 코드 확인)

- **감사/활동 로그 자체가 아직 없다** - `schema.prisma` 12개 모델
  전부 확인, audit/activity/history 계열 테이블 없음.
- 액션은 두 진입점을 통과한다: CLI/MCP는 `api/actions.ts`의
  `dispatch()`, WEB UI는 `api/rest.ts`의 `web()` - 둘 다 결국 같은
  `core/documents.ts`의 `docsAdd`/`docsGet`/`docsUpdate`/`docsDelete`/
  `docsTransition`/`docsTag`/`docsGrep` 함수를 그대로 호출한다(REST와
  CLI/MCP가 완전히 같은 핸들러를 재사용하는 게 이 코드베이스의 기존
  원칙 - rest.ts 상단 주석 참고). **그래서 "모든 액션을 가로채는 범용
  디스패치 훅"을 새로 만들 필요가 없다** - 이미 있는
  `syncAfterWrite()`/`publishDocEvent()` 패턴(문서가 쓰기될 때마다
  EMQX로 브로드캐스트하는 것)과 완전히 같은 자리에, 완전히 같은 방식
  으로 `recordActivity()` 호출 한 줄씩만 추가하면 각 핸들러가 이미
  알고 있는 정확한 추적 코드(들)를 그대로 쓸 수 있다. `docs.transition`
  은 한 번에 여러 코드를 묶어 처리할 수 있어(`state: {code: [to,
  from]}` 여러 개), 실제로 적용된 코드마다 각각 기록한다.
- **`docs.list`/`docs.search`/`docs.status`는 기록 대상에서 제외** -
  단일 코드를 대상으로 하지 않는 조회라 "추적 코드별" 집계와 안 맞는다
  (설계자 요청이 정확히 "추적 코드별"이라고 명시함).
- `docs.get`(단순 조회)도 기록 대상에 포함하기로 판단 - "어떤 동작을
  언제 얼마나 했는지"가 문자 그대로 조회까지 포괄하고, 조회 빈도 자체가
  "이 문서에 얼마나 관심이 쏠렸는지"를 보여주는 유의미한 신호라고 봄.
  **트레이드오프 기록**: 프론트엔드가 문서를 클릭할 때마다 `docs.get`이
  불려서(전이/저장 후 재조회 포함) 다른 액션보다 기록량이 훨씬 많을
  것 - 지금 규모(스캐폴딩 단계)에서는 문제 없지만, 실사용 규모에서
  로그 테이블이 급격히 커지면 보존 기간(retention) 정책이 필요할 수
  있음 - 이번 라운드 스코프 밖으로 미루고 여기 기록만 남긴다.

### 스키마

`ActivityLog` 모델 신규 추가(순수 추가 - 기존 테이블/컬럼 전혀
안 건드림, 기존 설치 데이터의 의미가 바뀌는 게 아니므로
`migrate-*.ts`/`verify-*.ts` 스크립트 불필요 - `prisma db push`로 충분,
프로젝트 표준 "마이그레이션 스크립트가 필요한 경우"에 해당 안 함):

```prisma
model ActivityLog {
  id        String   @id @default(cuid())
  projectId String
  code      String
  action    String
  channel   String
  actorId   String
  createdAt DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId, code, createdAt])
}
```

`code`는 `Document.id`(8자)가 아니라 실제 추적 코드 문자열
(`${kind}-${id}`) 그대로 저장 - Document 레코드가 나중에 지워져도
"그 코드에 그 시점에 그 동작이 있었다"는 이력 자체는 남아야 하므로
FK가 아니라 평문 문자열로 둔다(PullRequest.author가 channel을 평문
문자열로 저장하는 것과 같은 판단).

### 백엔드 구현

- `core/activityLog.ts`(신규): `recordActivity(projectId, code,
  action, ctx)` - fire-and-forget(실패해도 원래 액션 응답에 영향 없이
  경고 로그만), `documents.ts`의 `guardMembership`/`fail`을 export로
  바꿔 재사용.
- `documents.ts`의 `docsAdd`/`docsGet`/`docsUpdate`/`docsDelete`/
  `docsTransition`(적용된 코드마다)/`docsTag`/`docsGrep` 각각에
  `syncAfterWrite()`/`removeAfterDelete()` 바로 옆에 `recordActivity()`
  한 줄씩 추가.
- 새 액션 `activity.summary`(`core/activityLog.ts`) - 입력
  `{owner, projectId, type, kind?, state?, days?}`(`docs.list`와 같은
  필터 모양 - 지금 화면에 걸려 있는 필터를 그대로 반영하기 위해).
  내부적으로 그 필터에 맞는 문서들의 추적 코드 목록을 먼저 구하고,
  `ActivityLog`를 그 코드 목록 + 기간(`days`, 기본 30/최대 90)으로
  걸러 (1) 날짜별 집계 히트맵(빈 날짜는 0으로 채움), (2) 최근 30건
  활동 로그를 반환. `actions.ts` 레지스트리 + `rest.ts`
  (`GET /projects/:owner/:projectId/activity`) 양쪽에 등록(기존
  액션들과 동일하게 CLI/MCP·WEB UI 둘 다 커버).

### 프론트엔드 구현

- `api/client.ts`에 `getActivitySummary()` 추가.
- `DocTypeWorkspace.vue`의 "종합 현황"(미선택 상태) 패널에 이어서
  히트맵(최근 30일, GitHub 컨트리뷰션 그래프 스타일 - 요일×주 격자,
  진하기로 카운트 표현)과 최근 활동 로그(코드/동작/채널/시각 목록)를
  추가. 이미 있는 상태별/분류별 집계와 마찬가지로 **지금 필터
  (`selectedKind`/`selectedState`)를 그대로 반영**해서 요청한다.
  Trackers/Tests(읽기 전용)도 같은 컴포넌트라 자연히 같이 뜬다(지난
  라운드의 상태별/분류별 집계와 같은 판단).

### 검증 계획

1. `npx prisma db push`(스키마 반영) - 로컬 개발 DB에 적용.
2. `vue-tsc --noEmit`.
3. 브라우저로: 문서 하나를 열람(`docs.get`)→상태 전이→다시 목록으로
   돌아와 종합 현황에서 히트맵/로그에 방금 한 동작이 실제로 반영되는지
   확인. 필터를 바꿔가며 히트맵/로그가 그 필터에 맞는 코드만 반영하는지
   확인.
4. `docs/design-notes.md`/`docs/project-structure.md` 갱신, 이 계획
  문서 `state: done`으로.
5. git commit/push는 설계자가 명시적으로 요청했을 때만.

## 라운드 2 (2026-09-22) - 실행 및 검증 완료

계획대로 구현 완료. 자세한 내용은 `docs/design-notes.md`의 "문서
코드별 활동 히트맵/로그" 절 참고 - 요약만 남긴다:

- 스키마(`ActivityLog`)/`core/activityLog.ts`(`recordActivity`/
  `activitySummary`)/`documents.ts` 7개 핸들러에 기록 호출 추가/
  `actions.ts`+`rest.ts` 양쪽 등록/프론트엔드 히트맵+활동 로그 UI -
  전부 계획대로 구현.
- 계획에 없던 추가 판단: `guardMembership`/`fail`을 `core/
  actionHelpers.ts`로 뽑아 `documents.ts`↔`activityLog.ts` 런타임
  순환 참조를 피함.
- **실기동 중 발견한 버그**: 히트맵 날짜 경계 계산에 로컬 타임존과
  UTC 직렬화가 섞여 있어 KST 환경에서 "오늘"이 라벨에서 빠지는 버그
  - `Date.UTC(...)`로 통일해 수정, 브라우저로 재확인 완료.
- 백엔드 dev 서버는 스키마 변경 후 두 번 재시작 필요(Prisma Client
  재생성 후 1회, 타임존 버그 수정 후 1회) - `tsc`/`vue-tsc --noEmit`
  둘 다 통과, 브라우저로 문서 열람→전이→종합 현황 반영까지 실제
  확인.

state: done.
