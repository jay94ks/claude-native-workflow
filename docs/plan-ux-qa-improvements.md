---
id: PLANUXQA1
parent_id: XJQCTF6Y
type: plan
kind: PL
state: done
branch: null
commit_id: null
title: 사용자 편의성 관점 UI QA + 개선 계획
author: agent
related:
  - SP-PSTRUCT01
  - PL-QAFULL01
  - PL-PLANFEUI
  - PL-PLANDK01
  - PL-PLANGHOA
---

# PL-PLANUXQA1 - 사용자 편의성 관점 UI QA + 개선 계획

## 배경

[PL-QAFULL01](plan-full-qa.md)은 "기능이 맞게 동작하는가"(정확성) 관점의
전수 QA였다. 이 문서는 설계자 요청(2026-09-22, "사용자 편의 관점에서
UI에 대해 QA를 진행하고 개선 계획서 작성해")에 따라 **동작은 맞지만
불편하거나 일관성이 떨어지는 지점**을 찾는 별도 관점의 QA다 - 정확성
버그가 아니라 사용성 문제이므로 발견 즉시 고치지 않고(CLAUDE.md 작업
방식 1번 - 여러 항목이 나올 걸 예상해 먼저 계획 문서로 남긴 뒤 순서대로
처리), 이 문서에 항목별로 기록하고 우선순위대로 하나씩 진행한다.

**조사 방법**: 실제 브라우저로 로그인 → Demo Project의 Code/Pull
requests/Issues/Documents/Plans/Trackers/Settings 전 탭을 순회하며
`read_page`/`get_page_text`/스크린샷으로 실제 렌더링을 확인했다(정확성은
이미 PL-QAFULL01에서 검증됐으므로 여기서는 재검증하지 않고, 편의성
관점의 마찰만 기록).

## 발견 항목

### F1. [버그, 수정 완료 2026-09-22] 활동 로그에 내부 액션 이름이 그대로 노출됨

[DocTypeWorkspace.vue:169](../frontend/src/components/DocTypeWorkspace.vue#L169)
의 최근 활동 목록이 `{{ entry.code }} · {{ entry.action }}`로 `action`
필드를 가공 없이 그대로 찍는다 - 그 결과 Documents/Issues/Plans/
Trackers 탭 전부에서 "SP-6ZPJABKL · docs.get", "IS-684GD22F · docs.get"
처럼 내부 API 액션 이름이 사용자에게 그대로 보인다. 게다가 `docs.get`
(단순 조회)까지 "활동"으로 잡혀서, 실제 변경(`docs.add`/
`docs.transition`)과 단순 열람이 로그에서 구분 없이 섞인다.

- **재현**: Documents/Issues 탭에서 아무 문서나 한 번 열어보면 그
  즉시 "최근 활동"에 `docs.get` 항목이 추가되는 것으로 바로 확인 가능.
- **개선 제안**: (1) `action`을 사람이 읽을 라벨로 매핑하는 작은 사전
  (`docs.add`→"문서 생성", `docs.transition`→"상태 변경",
  `docs.get`→ 아예 활동 로그 자체에서 제외 등)을 두거나, (2) 애초에
  백엔드가 조회성 액션은 활동 로그에 적재하지 않게(현재 어디서
  activity가 기록되는지는 백엔드 쪽 확인 필요 - 이 라운드는 프론트만
  조사했으므로 구현 라운드에서 백엔드 로깅 지점부터 다시 확인).
- **수정 완료(2026-09-22)**: 먼저 백엔드
  [activityLog.ts](../backend/src/core/activityLog.ts)의
  `recordActivity()` 호출부([documents.ts](../backend/src/core/documents.ts)
  의 docsAdd/Get/Update/Delete/Transition/Tag/Grep 7곳)를 확인한 결과,
  `docs.get`을 활동 로그에서 아예 빼는 건 채택하지 않기로 했다 -
  같은 파일의 "같은 대상에 연속되는 같은 action은 마지막만 유지"
  De-dup 로직(활동 히트맵/로그 라운드에서 이미 이 - 반복 조회로
  로그가 부풀지 않게 - 문제를 인지하고 넣어둔 설계)이 애초에 `docs.get`
  이 자주 찍힐 것을 전제로 만들어진 것이라, 빼버리면 그 설계 의도와
  충돌하고 히트맵도 "조회"까지 포함한 활동량을 보여주는 게 맞다고
  판단했다. 대신 옵션 (1) 라벨 매핑만 프론트에 적용 -
  [DocTypeWorkspace.vue](../frontend/src/components/DocTypeWorkspace.vue)
  에 `ACTION_LABELS`(`docs.add`→생성/`docs.get`→조회/`docs.update`→수정/
  `docs.delete`→삭제/`docs.transition`→상태 전환/`docs.tag`→태그 변경/
  `docs.grep`→본문 검색) 사전과 `actionLabel()`을 추가해 최근 활동
  목록 렌더링에 사용(매핑에 없는 값은 원문 그대로 표시해 향후 액션이
  늘어도 화면이 깨지지 않게). **검증**: `vue-tsc --noEmit` 통과.
  브라우저로 Documents 탭 재조회 → "최근 활동"에 "SP-IL0VRRO0 · 조회",
  "DG-SK8ATHLO · 생성", "SP-IL0VRRO0 · 상태 전환"처럼 한글 라벨로
  정상 표시되는 것 확인(내부 액션 이름이 더 이상 노출되지 않음).

### F2. [버그, 수정 완료 2026-09-22] `/keys` 페이지가 인증 실패를 조용히 삼킴

[ApiKeysPage.vue:87-91](../frontend/src/pages/ApiKeysPage.vue#L87-L91)의
`load()`는 `if (result.ok) keys.value = ...`만 하고 실패 시 아무 처리도
없다 - 이번 세션의 API 키 정리 사고(design-notes.md 해당 라운드 참고)
때 실제로 이 경로를 직접 목격했다: 세션의 API 키가 잘못 revoke되어
`GET /api/api-keys`가 401을 반환했는데, 화면은 에러 없이 "발급된 키가
없습니다"라는 **거짓 빈 상태**를 그대로 보여줬다. 같은 파일의 `create()`
(108행)는 `createError` ref로 에러를 이미 제대로 표시하고 있어, `load()`
만 이 패턴을 놓친 것으로 보인다.

- **개선 제안**: `create()`의 `createError` 패턴을 그대로 `load()`에도
  적용 - `loadError` ref 추가, 실패 시 메시지 표시, 템플릿에 에러 배너
  추가.
- 이 항목은 이미 원인/수정 방법이 명확하므로 구현 우선순위 1순위로
  제안한다(사용자가 "키가 하나도 없다"는 거짓 정보를 근거로 잘못된
  판단을 내릴 수 있는 실제 위험이 있음 - 정확히 이번 사고에서 재현됨).
- **수정 완료(2026-09-22)**: [ApiKeysPage.vue](../frontend/src/pages/ApiKeysPage.vue)에
  `loadError` ref 추가 - `load()`가 실패하면 `result.reason`(백엔드
  에러 메시지)을 담고, 템플릿은 `loading`→`loadError`→목록/빈 상태
  순으로 분기해 에러 시에는 "발급된 키가 없습니다"라는 거짓 빈
  상태 대신 실제 에러 메시지를 보여준다. **검증**: `vue-tsc --noEmit`
  통과. `curl -H "Authorization: Bearer bogus-invalid-key-xyz"
  http://127.0.0.1:8388/api/api-keys` → `{"error":"invalid apiKey"}`
  확인(살아있는 세션 키를 다시 revoke하는 위험을 피하려 실제 세션을
  건드리지 않고 백엔드 에러 응답 모양만 직접 확인) - `client.ts`가
  이 문자열을 `reason:["invalid apiKey"]`로 감싸므로 화면엔
  "invalid apiKey"가 뜨는 것까지 코드로 추적 확인. 정상 경로는
  브라우저에서 `/keys` 재로드 → 기존 85건 목록이 회귀 없이 그대로
  표시되는 것으로 확인.

### F3. [조사 완료, 수정 완료 2026-09-23] Demo Project에 인코딩이 깨진 문서 존재

Documents 탭에 제목이 `��° ????`처럼 깨진 문서가 실제로 존재한다
(코드 `SP-IL0VRRO0`, 상태 active, 본문도 "related/dependsOn ??"로
깨져 있음). 이번 QA 라운드에서는 원인까지 추적하지 않았다 - CLI/curl로
잘못된 콘솔 코드페이지(Windows cp949 등)에서 생성됐을 가능성과, 실제
UTF-8 처리 버그일 가능성 둘 다 열려 있다.

- **개선 제안**: 다음 라운드에서 (1) 이 문서가 언제/어떤 경로(REST
  웹/CLI/MCP)로 생성됐는지 DB 감사 로그나 activity 기록으로 역추적,
  (2) 재현되면 그 경로의 인코딩 처리를 고치고, (3) 재현 안 되면(과거
  테스트 잔재로 판단되면) 데이터만 정리.
- 이 문서 자체는 Demo Project의 실 데이터가 아니라 이전 QA/디버깅
  과정의 잔재로 보이므로, 급하지 않으면 다음 정기 데이터 정리 때 같이
  삭제해도 무방.
- **조사/수정 완료(2026-09-23)**: `POST /api/actions`의 `docs.get`으로
  이 문서의 원문 JSON을 직접 받아 코드포인트 단위로 분석한 결과,
  title/content 안에 실제 **U+FFFD(replacement character)**가 문자
  그대로 저장돼 있는 것을 확인했다(예: title codepoints
  `0xfffd,0x3b9,0xfffd,0xb0,0x20,0xfffd,0xfffd,0xfffd,0xfffd`) - 이건
  터미널/브라우저의 표시 문제가 아니라 **DB에 저장된 시점에 이미
  원본 바이트가 영구히 유실된 것**이다. Express의 기본 JSON
  body-parser는 `Buffer.toString('utf8')`로 요청 본문을 디코딩하는데,
  이 함수는 유효하지 않은 UTF-8 바이트 시퀀스를 만나면 예외를 던지는
  대신 **조용히 U+FFFD로 치환**한다 - 즉 UTF-8이 아닌 바이트(Windows
  cp949 등 다른 코드페이지로 인코딩된 한글)를 보낸 클라이언트의
  요청이 에러 없이 통과해서 그대로 저장된 것으로 결론지었다. 이
  구체적 요청이 언제/어떤 도구에서 왔는지까지는(쉘 히스토리가 남아
  있지 않아) 특정하지 못했지만, 앱의 **실제 사용자 경로(웹 UI의
  fetch, CLI/MCP의 Node HTTP 클라이언트)는 전부 JS 문자열을 항상
  올바르게 UTF-8로 인코딩**하므로 이 경로로는 재현 불가능하고, 이
  세션 자체의 수동 curl QA 테스트처럼 외부에서 원문 바이트를 직접
  구성해 보내는 경우에만 발생할 수 있다는 것도 확인했다(계획의 옵션
  (3), "재현 안 됨 → 데이터 정리"에 해당).
  - **그래도 코드 수정까지 한 이유**: 단순 데이터 정리로 끝내지
    않은 건, 이 조용한 치환 자체가 **실제 사용자에게도 열려 있는
    진짜 위험**이기 때문이다 - 예를 들어 non-UTF-8 로케일 환경에서
    돌아가는 임의의 REST 클라이언트(우리가 만들지 않은 서드파티
    스크립트 등)가 실수로 잘못 인코딩한 요청을 보내면, 지금까지는
    서버가 에러 없이 받아 **영구 복구 불가능한 손상 데이터**를
    그대로 저장했다. [documents.ts](../backend/src/core/documents.ts)
    에 `containsReplacementChar()`를 추가해 `docsAdd`/`docsUpdate`가
    title/content에 U+FFFD가 있으면 저장 직전에 거부하도록 고쳤다 -
    "조용한 영구 손상"을 "그 자리에서 재시도 가능한 에러"로 바꾼
    것.
  - **검증**: `tsc --noEmit` 통과. 백엔드 dev 서버 재기동 후 (1)
    U+FFFD가 포함된 `docs.add` 요청 → `{"ok":false,"reason":["title/
    content에 잘못된 인코딩(대체 문자 U+FFFD)이 포함되어 있습니다 -
    요청 본문을 UTF-8로 인코딩해서 다시 보내세요."]}`로 정상 거부되는
    것 확인, (2) 정상적인 UTF-8 한글 `docs.add`(`SP-PTZ026CE`)는
    회귀 없이 그대로 성공하는 것 확인(검증 후 discard로 정리) -
    새 검증 로직이 정상적인 한글 입력까지 잘못 막지 않는 것까지
    확인.
  - **기존 데이터 정리**: 실제로 발견된 `SP-IL0VRRO0`은 이미 저장된
    U+FFFD를 코드로 복구할 방법이 없어(원본 바이트가 영영 유실됨)
    `docs.transition`으로 discard 처리해 목록에서 걷어냈다(F7에서도
    지적한 데모 데이터 정리와 같은 방향).

### F4. [결정 완료 2026-09-23] GitHub 클론 스타일 영문 라벨 vs 앱 전반 한글 UI

[ProjectAboutSidebar.vue](../frontend/src/components/ProjectAboutSidebar.vue)
의 "About"/"Public"/"Private"/"N collaborators"/"Template"/
"Contributors"는 `--gh-*` 테마 변수로 미루어 의도적으로 GitHub UI를
본뜬 것으로 보인다. 반면 같은 화면의 "생성"/"문서 타입 구성", 그리고
앱 대부분의 버튼·안내 문구는 한글이다 - 상단 탭바(Code/Pull requests/
Issues/Documents/Plans/Trackers/Settings)도 전부 영문이라 전체적으로
"GitHub 스타일 크롬은 영문, 콘텐츠/액션 문구는 한글"이라는 일관된
패턴이긴 하지만, 한국어 사용자가 주 대상인 제품에서 이게 최선인지는
설계자 판단이 필요한 지점이라 임의로 바꾸지 않고 여기 기록만 해둔다.

- **선택지**: (a) 지금 패턴 유지(=GitHub에 익숙한 사용자에게는 오히려
  더 친숙할 수 있음), (b) 크롬 라벨도 전부 한글화, (c) 언어 토글 제공.
  이번 라운드에서는 결정하지 않는다 - 설계자 확인 후 이 문서의 상태를
  갱신한다.
- **결정(2026-09-23)**: 설계자가 (a) "지금 패턴 유지"를 선택했다 -
  GitHub UI에 익숙한 사용자에게는 오히려 친숙할 수 있다는 점을
  근거로 들었다. **코드 변경 없음** - `ProjectAboutSidebar.vue`와
  상단 탭바의 영문 크롬 라벨(About/Private/Template/Contributors/
  Code/Pull requests/Issues 등)은 그대로 유지한다. 다음 세션이 이
  항목을 다시 조사하지 않도록 결정만 여기 기록해둔다.

### F5. [낮은 우선순위, 수정 완료 2026-09-23] Pull Requests 탭에 미선택 시 개요 패널이 없음

Documents/Issues/Plans/Trackers 네 탭은 `DocTypeWorkspace.vue`를
공유해서 아무것도 선택 안 한 기본 상태에 "OO 종합 현황"(상태별/
분류별 집계 + 활동 히트맵 + 최근 활동)을 보여주는데, PullRequestsTab
(`PullRequestsTab.vue:84`)은 PR 미선택 시 그냥 "왼쪽에서 PR을
선택하세요."라는 안내문 한 줄뿐이다. [sunny-exploring-raven 계획]에서
이미 "PR ↔ DocTypeWorkspace 컴포넌트 통합은 리스크 대비 이득이 작아
하지 않는다"고 결정했으므로, 컴포넌트를 합치자는 게 아니라 PR 탭에도
독립적으로 가벼운 요약(상태별 개수 등)을 추가하는 정도만 고려할 만하다
- 급하지 않은 nice-to-have로 분류.

- **수정 완료(2026-09-23)**: 컴포넌트 통합 없이
  [PullRequestsTab.vue](../frontend/src/pages/project/PullRequestsTab.vue)
  에 `DocTypeWorkspace`의 "상태별" 블록과 같은 시각 패턴(subtitle +
  caption 안내 + 상태별 배지/개수)만 그대로 옮겨 PR 미선택 상태에
  적용했다. PR은 kind 개념이 없어 상태별 집계만 넣었고, 정렬은
  `["open","merged","closed"]` 고정 순서 우선 - 그 외 값은 등장 순으로
  DocTypeWorkspace의 `stateBreakdown`과 동일한 방식이다. **검증**:
  `vue-tsc --noEmit` 통과. 브라우저로 확인 - 미선택 상태에 "Pull
  requests 종합 현황"과 "merged 2 / closed 6"(실제 목록의 8건과
  일치)이 표시되고, PR을 클릭해 상세로 들어가는 기존 동작은 회귀
  없이 그대로 동작.

### F6. [참고 - 기존 결정, 재작업 불필요] PR 목록 + 변경 파일 트리가 좁은 사이드바 하나를 공유

`PullRequestsTab.vue:12`의 PR 목록(선택 시 500px로 고정+스크롤)과 그
아래 변경 파일 트리가 같은 좁은 왼쪽 컬럼에 쌓인다 - 코드 주석에
"설계자 요청(2026-09-21)"로 이미 의도적으로 결정된 레이아웃이다. PR
수나 변경 파일 수가 아주 많아지면 이중 스크롤이 불편해질 수 있지만,
지금 데모 데이터(PR 8개, 파일 2개) 규모에서는 문제로 느껴지지 않았다
- 지금 당장 재작업하지 않고, 실제로 불편하다는 신호가 오면 그때
재검토.

### F7. [선택적, 데이터 위생, 결론 완료 2026-09-23] Documents 탭에 QA/웹훅 테스트 잔여 문서가 다수 섞여 있음

Demo Project의 Documents 목록 11건 중 다수가 `webhook trigger test`,
`QA staged doc`, `unfinished dep`, `브라우저 검증용 새 문서` 등 과거
QA/디버깅용으로 만든 문서다 - 기능 버그는 아니지만, 실제 데모/데모
스크린샷 용도로 이 프로젝트를 보여줄 때 잡음이 된다. UI 기능 제안으로는
"discard 상태 문서 접기/숨기기" 같은 필터가 있으면 좋겠지만, 이미
`필터`(칸반 형태 상태/분류/키워드 필터, PL-... 참고)가 있으므로 그걸
활용하는 것으로 충분할 수도 있음 - 우선순위 가장 낮음, 실제로는 그냥
데이터 정리로 해결 가능.

- **결론(2026-09-23)**: 코드 작업 불필요로 마무리한다 - 이미 있는
  상태/분류/키워드 `필터`로 discard 문서를 걸러낼 수 있어 별도 UI
  기능을 새로 만들 필요가 없다. 데이터 자체 정리(테스트 문서 삭제)는
  이 QA 라운드의 범위가 아니라 필요할 때 별도로 진행한다 - 참고로
  F3 조사 과정에서 발견한 인코딩 손상 문서(`SP-IL0VRRO0`)는 이미
  discard 처리해뒀다.

## 실행 계획 (우선순위 순)

- [x] 1순위 - F2 (`ApiKeysPage.vue` 인증 실패 시 무음 실패) 수정 완료
      (2026-09-22) - `loadError` ref로 에러 표시, 실기동 검증 완료.
- [x] 2순위 - F1 (활동 로그 액션 이름 노출) 수정 완료(2026-09-22) -
      `docs.get` 제외는 하지 않고(De-dup 설계 의도와 충돌) 프론트
      `ACTION_LABELS` 라벨 매핑으로 해결, 실기동 검증 완료.
- [x] 3순위 - F3 (인코딩 깨진 문서) 조사/수정 완료(2026-09-23) - 원인은
      Express body-parser가 비-UTF-8 바이트를 U+FFFD로 조용히 치환하는
      것으로 특정, `containsReplacementChar()` 검증을 `docsAdd`/
      `docsUpdate`에 추가해 향후 재발 시 조용한 손상 대신 즉시 거부되게
      했다. 기존 손상 문서(`SP-IL0VRRO0`)는 복구 불가라 discard 처리.
- [x] F4 (영문/한글 라벨 정책) 결정 완료(2026-09-23) - 설계자가 "지금
      패턴 유지"를 선택, 코드 변경 없음.
- [x] F5 (PR 탭 개요 패널) 수정 완료(2026-09-23) - 컴포넌트 통합 없이
      상태별 개수 요약만 추가, 실기동 검증 완료.
- [x] F6 - 재작업 불필요로 이미 결정됨(2026-09-21), 기록만.
- [x] F7 - 결론 완료(2026-09-23) - 기존 필터로 충분, 코드 작업 불필요.

## 판단해두는 것

- 이 라운드는 **발견 + 계획 문서화까지만** 진행했다(설계자 요청이
  "QA 진행 + 개선 계획서 작성"이었지 즉시 구현이 아니었음) - CLAUDE.md
  작업 방식 1번(계획을 문서로 남긴 뒤 순서대로 처리)을 그대로 따른다.
  구현은 이 문서의 체크박스를 우선순위 순으로 하나씩 처리하며 진행하고,
  각 항목 구현 후 이 문서의 해당 체크박스와 `state`를 갱신한다.
- F2/F1/F3는 코드 변경이 필요하므로 실제 구현 후 이 문서를 다시 열어
  실기동 검증(CLAUDE.md 작업 방식 4번)을 거친 뒤에만 체크한다.
- F4는 코드 문제가 아니라 제품 방향 결정이라, 설계자 확인 없이 임의로
  바꾸지 않는다.
- **2026-09-23 시점 상태**: F1~F7 전부 처리 완료 - F1/F2/F3/F5는
  코드 수정 + 실기동 검증, F4는 설계자 결정("지금 패턴 유지") 반영,
  F6은 이미 재작업 불필요로 결정된 것을 재확인, F7은 기존 필터
  기능으로 충분하다는 결론으로 마무리. 이 문서의 `state`를 `done`
  으로 갱신한다.
