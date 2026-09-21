---
id: PLANQA001
parent_id: XJQCTF6Y
type: plan
kind: PL
state: done
branch: null
commit_id: null
title: Q&A/opinion 카드 UI 재설계 - 뱃지 재배치, Markdown 렌더링, more 메뉴 통합, 완료 처리 액션
author: agent
related:
  - SP-PSTRUCT01
  - PL-PLANURL01
---

# PL-PLANQA001 - Q&A/opinion 카드 UI 재설계

설계자 요청(2026-09-21 후속, 세 번째 라운드) - `docs/plan-pr-code-url-scheme.md`
다음 순서로 진행. `DocumentDiscussion.vue`(문서 임베드 패널)와
`DocumentThreadPage.vue`(계층 드릴다운 페이지) 둘 다 대상 - 카드
마크업이 사실상 같은 패턴이라 두 곳 다 고쳐야 한다.

## 목표 레이아웃 (카드 하나 기준)

- 좌측 상단: `[question]`/`[opinion]` 타입 뱃지, 그 오른쪽에 **제목**
  (지금까지 title 필드가 있는데도 화면에 전혀 안 보였다 - 실제 버그).
- 우측 상단(왼쪽부터): 상태 뱃지(added/read/done/discard) → 작성자
  식별 뱃지(아바타+이름) → more(⋮) 아이콘.
- more 아이콘 클릭 시 메뉴(`q-menu`)에 이 항목에서 실제로 할 수 있는
  동작을 전부 모은다:
  - 자식 항목이 있으면 "자식 항목 보기"(스레드 페이지로 이동) -
    있을 때만 표시.
  - "확인함"(question added→read, 지금 있는 조건 그대로).
  - "답변 작성"(인라인 컴포저를 여는 트리거로 - 지금 있는 조건 그대로).
  - "폐기" - 지금은 opinion만 보여준다. **버그로 보이는 공백**:
    architect가 만든 question(재질의)도 documentRules.ts상
    (added/read 상태 + requester===author) 폐기 가능한데 UI에
    노출된 적이 없다 - 이 라운드에서 노출한다.
  - "완료 처리"(answer added/read→done, 질의자만) - **지금까지
    UI에 전혀 없던 액션**. 이게 없으면 question→answer 스레드가
    영원히 done에 도달할 방법이 웹 UI엔 없었다(문서 상으로도
    확인 안 됨 - 이번에 새로 추가하는 것).
- 본문은 지금까지 `white-space: pre-wrap`으로 원문 그대로 찍었다 -
  Markdown으로 렌더링(`marked`, 프로젝트에 이미 의존성 있음 -
  `MarkdownSourceView.vue`가 쓰는 것과 동일 라이브러리 재사용).
- **완료(`done`) 상태에 도달한 question/answer는 수정 불가** - 지금
  구조에선 question/answer 자체에 "본문 수정" 액션이 없어서(재질의/
  답변 작성/의견 남기기는 전부 "새 문서 만들기"고, 기존 항목의
  본문을 고치는 기능 자체가 원래 없다) 이 요구사항은 사실상 이미
  만족돼 있다 - 그래도 more 메뉴에 상태 조건을 정확히 걸어서 done인
  항목엔 "확인함"/"답변 작성"/"폐기"/"완료 처리" 전부 안 뜨게(이미
  종결 상태라 documentRules.ts가 어차피 거절하지만, 버튼 자체를
  안 보이게 하는 게 맞다) 확인한다.

## 진행 상태

- [x] `documentRules.ts` 전이표 재확인(이미 확인 완료 - 이 문서에
      기록): question(added→read: 답변자만, added/read→discard:
      작성자만, done: cascade 전용), answer(added→read/read→done:
      질의자만), opinion(added→read/read→done: agent만, discard:
      architect만).
- [x] `DocumentDiscussion.vue`, `DocumentThreadPage.vue` 카드 템플릿
      재배치(좌측 타입뱃지+제목, 우측 상태뱃지+작성자뱃지+more).
- [x] more 메뉴(`q-menu` + `q-list`)로 자식보기/확인함/답변작성/
      폐기/완료처리 통합, 상태별 조건 정확히 이식.
- [x] "완료 처리"(answer done) 액션 새로 추가 - `docs.transition`
      재사용(새 백엔드 작업 없음, 기존 액션 그대로). **구현 중 추가로
      발견한 버그**: "완료 처리"(read→done)만 넣고 그 앞 단계인
      "확인함"(added→read)을 answer에도 노출해야 한다는 걸 놓치고
      있었다 - documentRules.ts상 이 read 전이도 마찬가지로 "질의자
      (=answer 작성자의 반대 채널)"만 할 수 있어서, answer.author
      ==='agent'인 경우 architect(WEB UI)가 직접 눌러줘야만 상태가
      read로 넘어가고, 그래야 "완료 처리"가 나타난다 - 이 액션 없이는
      "완료 처리" 자체가 영원히 도달 불가능한 죽은 기능이었다. 두
      컴포넌트 모두 answer 카드(및 스레드 페이지의 item/child가
      kind==='AN'인 경우)에 "확인함" 메뉴 항목을 추가해서 고쳤다.
- [x] question 폐기(architect 작성 건) 노출 - `canDiscard`가
      question(author==='architect')/opinion 둘 다 받도록 일반화.
- [x] 본문 Markdown 렌더링(`marked.parse` + `DOMPurify.sanitize`,
      `frontend/src/utils/renderMarkdown.ts`) - `v-html`로 안전하게
      렌더링.
- [x] 실기동 검증(2026-09-21, 로컬 dev 스택 + CLI로 agent 채널
      시뮬레이션): `DocumentDiscussion.vue`에서 architect 작성
      question(QU-V5SRP63P)에 "폐기" 메뉴만 뜨는 것 확인 →
      done/discard 상태 항목엔 more 아이콘 자체가 안 뜨는 것 확인 →
      CLI로 그 질문에 agent 답변(AN-C744MXDG, 마크다운 `**bold**`+
      리스트 본문) 등록 → "확인함" 클릭(added→read) → "완료 처리"
      클릭(read→done) → 질문도 함께 done으로 cascade되고 두 카드
      모두 more 아이콘이 사라지는 것 확인. `DocumentThreadPage.vue`
      에서도 동일 시나리오(QU-FRX6TCEW/AN-38VKAM7J)를 별도로 재현해
      자식 카드의 확인함→완료처리 메뉴가 동일하게 동작하는 것 확인.
      Markdown 렌더링은 `<strong>`/리스트(`<ul><li>`)로 실제 렌더링
      되는 것을 DOM에서 직접 확인(에디터에 typed `**text**`는
      turndown이 일반 텍스트로 보고 그대로 escape하므로 - 툴바 Bold
      버튼으로 만든 실제 강조 마크나 CLI로 등록한 원문 마크다운에서만
      의도대로 렌더링됨 - 이건 이 라운드의 회귀가 아니라
      MarkdownSourceView 전체의 기존 동작).
- [x] `docs/project-structure.md` 갱신.

## 판단해두는 것

- "완료 처리" 대상은 **answer**다(질문 자체의 done은 항상 그 답변의
  done에서 cascade로만 온다 - documentRules.ts 주석 그대로) - UI에는
  "완료 처리" 버튼을 answer 카드에만 놓고, 질문 카드는 그 답변이
  done이 되는 순간 자동으로 done으로 바뀌는 걸 그대로 보여준다.
- `DocumentThreadPage.vue`의 자식 카드는 "확인함"/"완료 처리"/"폐기"
  까지 인라인으로 노출하되(더 들어가지 않고 한 단계에서 바로 액션),
  "답변 작성"은 자식 카드에서 인라인으로 열 전용 컴포저 공간이 없어서
  제외했다 - 답변하려면 "자식 항목 보기"로 그 항목 자신의 스레드
  페이지에 들어가야 한다(이 페이지 자체가 그 진입점).
- 재질의하기/의견 남기기는 문서가 이미 done이어도 계속 노출한다(새
  자식을 만드는 동작이지 기존 항목을 수정하는 게 아니라서 "완료
  상태는 수정 불가" 요구사항과 무관 - GitHub이 closed 이슈에도 댓글은
  계속 달 수 있게 하는 것과 같은 판단).
