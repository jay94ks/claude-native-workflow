---
id: PLANDK01
parent_id: XJQCTF6Y
type: plan
kind: PL
state: done
branch: v3
commit_id: null
title: 문서 분류(kind) 추가/수정 + 분류별 지침 관리
author: agent
related:
  - SP-XJQCTF6Y
  - SP-PSTRUCT01
---

# PL-PLANDK01 - 문서 분류 관리 계획

## 라운드 1 (2026-09-22) - 계획 수립

설계자 요청: "문서 분류도 추가/수정이 가능해야 하고, 문서 분류별
지침 관리도 가능해야해." 두 가지를 물어 확인함:
- **범위**: 프로젝트별(각 프로젝트가 자기만의 분류 체계를 가짐) - 계정
  전체 공용(Template처럼)이 아님.
- **지침 공개 범위**: 클로드(CLI/MCP)도 봐야 함 - 웹 UI 전용 참고
  문서가 아니라, 실제로 문서를 작성하는 에이전트가 "이 분류엔 뭘
  적어야 하는지" 알 수 있어야 함.

### 스코프 판단: "doc" 타입만

`documentRules.ts`의 `KINDS_BY_TYPE`을 보면 doc(SP/RP/RM/QA/BT)만
진짜 "자유 분류"고, 나머지(plan=PL/issue=IS/tracker=TR/test=TC/
question=QU/answer=AN/opinion=OP)는 타입당 kind가 정확히 하나뿐이라
분류가 아니라 그냥 타입 코드 그 자체다(추적 코드 `${kind}-${id}`
스킴을 만족시키기 위한 상수). 설계자가 "문서 분류"라고 부른 건
doc의 5개 kind를 가리키는 게 확실하다 - 이번 기능은 doc 타입에만
적용하고 다른 타입의 kind는 그대로 하드코딩(구조적 상수)으로 둔다.

### 데이터 모델

`DocumentKind` 신규 모델(projectId당, code당 하나) - **오버레이
방식**: 기존 5개 기본 분류(SP/RP/RM/QA/BT)는 하드코딩된 기본 라벨을
그대로 유지하되, 이 테이블에 그 code로 행이 있으면 라벨/지침을
덮어쓴다("수정"). 이 테이블에만 있고 기본 5개에 없는 code는 완전히
새로 추가된 분류("추가")다. 이렇게 하면 프로젝트 생성 시 5개 행을
미리 심을 필요가 없다(오래된 프로젝트도 자동으로 기본값을 갖는다).

```prisma
model DocumentKind {
  id        String   @id @default(cuid())
  projectId String
  code      String   // [A-Z]{2,3}, trackingCode.ts 정규식과 맞춤
  label     String
  guideline String   @default("")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, code])
}
```

### 백엔드

- `core/docKinds.ts`(신규): `DEFAULT_DOC_KIND_LABELS`(기존
  `DocumentsTab.vue`에 있던 5개 한글 라벨을 여기로 이관 - 이제
  백엔드가 정본, 프론트는 API로 받아온다).
  - `docKindList(payload, ctx)`: 기본 5개 + DB 오버라이드를 합쳐
    `{code, label, guideline, builtin}[]` 반환(기본 5개 먼저 고정
    순서, 그다음 커스텀 code들을 생성 순).
  - `docKindSet(payload: {projectId, code, label, guideline}, ctx)`:
    WRITE 권한. `code`가 `/^[A-Z]{2,3}$/`인지 검증. upsert.
  - `docKindDelete(payload: {projectId, code}, ctx)`: WRITE 권한.
    기본 5개 code면 오버라이드 행만 지움(항상 성공 - "초기화" 의미).
    커스텀 code면 그 kind를 쓰는 문서가 있는지 먼저 확인해서 있으면
    거부("이 분류를 쓰는 문서가 있어 삭제할 수 없습니다").
  - `isValidDocKind(projectId, kind)`: 기본 5개거나 DB에 그 code
    행이 있으면 true.
- `documents.ts`의 `docsAdd`: `type === "doc"`일 때 kind 검증을
  `isValidKindForType` 대신 `isValidDocKind`(비동기, DB 조회)로
  교체. 다른 타입은 그대로.
- `actions.ts`/`rest.ts` 양쪽에 `docKind.list`/`docKind.set`/
  `docKind.delete` 등록(`GET/PUT/DELETE
  /projects/:owner/:projectId/doc-kinds[/:code]`) - CLI/MCP와 WEB UI
  둘 다에서 지침을 보고 관리할 수 있어야 하므로.

### 프론트엔드

- `api/client.ts`: `listDocKinds`/`setDocKind`/`deleteDocKind`.
- 새 설정 페이지 `pages/project/settings/DocKindsPage.vue`(목록 + 추가
  다이얼로그 + 수정 다이얼로그 + 삭제/초기화 버튼, `WebhooksPage`
  스타일의 리스트+다이얼로그 패턴을 따름) - `SettingsShell.vue` 메뉴에
  "문서 분류" 항목 추가, `routes.ts`에 `settings/doc-kinds` 경로 추가.
- `DocumentsTab.vue`: 하드코딩된 `kindLabels`/`:kinds` 배열을
  `onMounted`에 `listDocKinds`로 채우는 반응형 상태로 교체.
- `routes.ts`의 `documents/new` 라우트가 넘기던 정적
  `kinds: ["SP","RP","RM","QA","BT"]`도 `DocCreatePage.vue`가
  `type === "doc"`일 때 자체적으로 `listDocKinds`를 불러 덮어쓰도록
  (다른 타입은 그대로 정적 유지) - 이 김에 kind 선택 드롭다운에
  코드만 보이던 것도 "SP · 설계 명세"처럼 라벨을 같이 보여주도록 개선
  (기존에도 실은 라벨이 전혀 안 보이던 작은 기존 갭).

### CLI/MCP 노출(설계자 확인 사항)

`docKind.list`가 CLI/MCP에서도 그대로 호출 가능(actions.ts 레지스트리
공용) - 새 CLI/MCP 동작이므로 CLAUDE.md 규칙대로 이 라운드 안에
CLAUDE.md/SKILL.md도 갱신해서, 에이전트가 `docs.add`로 doc을 만들기
전에 `docKind.list`로 이 프로젝트의 분류 체계(및 지침)를 확인하도록
안내를 추가한다.

### 검증

1. `prisma migrate dev --name add_document_kind`(이번엔 처음부터
   `migrate dev`로 - 저번 라운드에서 `db push`만 썼다가 겪은 drift
   정리 교훈 반영).
2. `tsc --noEmit`(backend)/`vue-tsc --noEmit`(frontend).
3. 브라우저로: 설정 > 문서 분류에서 기본 5개가 보이는지, 새 분류
   추가(예: "DG"/"디자인 가이드"/지침 텍스트) → Documents "새 문서"
   페이지의 kind 드롭다운에 바로 반영되는지 → 그 kind로 실제 문서
   생성 → 기본 분류(예: SP) 라벨/지침 수정 → 커스텀 분류 삭제 시
   그 kind를 쓰는 문서가 있으면 거부되는지, 없으면 삭제되는지.
4. `docs/design-notes.md`/`docs/project-structure.md` 갱신,
   `CLAUDE.md`/`SKILL.md` 갱신, 이 계획 문서 `state: done`.
5. git commit/push는 설계자가 명시적으로 요청했을 때만.

## 라운드 2 (2026-09-22) - 실행 및 검증 완료

계획대로 구현 완료(스키마/백엔드 액션/프론트 설정 페이지+동적 kind
로딩). 자세한 내용은 design-notes.md 참고 - 계획과 달라진 점만 요약:

- **CLAUDE.md/SKILL.md 갱신 항목은 실행하지 않음** - 실제로 확인해보니
  이 저장소엔 CLI/MCP에 배포되는 정적 SKILL.md가 없다(`Template`
  모델이 architect별 런타임 데이터라 소스 관리되는 기본 스킬 문서
  자체가 없음). 대신 이 계획 문서와 design-notes.md/
  project-structure.md로 "다음 세션이 이 명령을 어떻게 써야 하는지"를
  남긴다.
- `prisma migrate dev`(지난 활동 로그 라운드에서 `db push`만 썼다가
  겪은 drift 정리 교훈을 바로 적용 - 이번엔 처음부터 깨끗하게 마이그레이션).
- 계획에 없던 실기동 버그 발견/수정: `DocumentsTab.vue`가 kind를
  비동기로 받아오게 되면서, `DocTypeWorkspace`가 마운트 시점에 한
  번만 검증하는 `?kind=` 쿼리가 그 경합 때문에 무효 처리될 뻔한 것을
  `kindsLoaded` 가드로 막음(design-notes.md 참고).

state: done.
