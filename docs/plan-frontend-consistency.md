---
id: PLANFEUI
parent_id: XJQCTF6Y
type: plan
kind: PL
state: done
branch: v3
commit_id: null
title: 프론트엔드 UI 일관성 정리 - 탑바/탭 기준선 밖 화면들의 헤더/다이얼로그/폼/여백/색 통일
author: agent
related:
  - SP-XJQCTF6Y
  - SP-PSTRUCT01
  - PL-QAFULL01
---

# PL-PLANFEUI - 프론트엔드 UI 일관성 정리 계획

## 라운드 1 (2026-09-21) - 계획 수립

설계자 피드백: "탑바 및 탭은 UI가 잘 갖춰져 있어. 스타일도 잘 맞고.
그러나 그 외에는 그때그때 땜빵식으로 해둔 느낌이 많이나." v3
프론트엔드는 여러 라운드에 걸쳐 기능을 하나씩 붙여왔고
(`MainLayout.vue`/`ProjectShell.vue`는 GitHub 스타일을 참고해 처음부터
공들여 설계된 기준선인 반면, 그 이후 화면들은 그때그때 필요에 따라
만들어져 서로 스타일이 어긋났다), 그 결과 화면마다 여백/카드/버튼/폼/
다이얼로그/헤더 패턴이 조금씩 다르다.

읽기 전용 감사(Explore 에이전트)로 실제 코드에서 구체적인 불일치를
전수 조사했고, 이어서 Plan 에이전트가 `app.scss`/`MainLayout.vue`/
`ProjectShell.vue`와 대표 파일들을 직접 읽어 파일 단위 구현안을
검증했다. 최종 실행 계획은 아래 "실행 계획" 절.

**원칙**: `MainLayout.vue`/`ProjectShell.vue`의 실제 모양은 바꾸지
않는다(탭 인디케이터/강조색을 CSS 변수로 옮기는 것만 예외 - 시각적
차이 없음). 새 공용 컴포넌트/토큰은 전부 기존 `--gh-*`/`.gh-*` 어휘를
확장할 뿐 새 시각 언어(스피너/스켈레톤/새 색 계열 등)를 도입하지
않는다. 이번 라운드는 **기존 기능의 통일성 정리**이지 재설계가
아니다.

## 범위에서 제외한 것 (별도 계획으로 미룸)

- `PullRequestsTab.vue`의 목록+상세 분할 패널 구조를
  `DocTypeWorkspace.vue`의 공용 기반과 통합하는 것.
- `DocumentDiscussion.vue`/`DocumentThreadPage.vue`에 여러 번 중복된
  "질의/의견/답변 카드" 렌더링을 `DiscussionItemCard.vue`로 추출하는
  것 - 이 Q&A 계층 코드는 `design-notes.md`(라운드: "Q&A 계층 구조 -
  RecentQaFeed.vue에서 실제로는 회귀돼 있었다")에 기록된 실제 회귀
  이력이 있는 민감한 영역이라, 스크린샷 기반 전/후 검증을 포함한 별도
  계획으로 다룬다.

둘 다 구조 리팩터라 위험도가 높고, 이번 "일관성 정리" 라운드의 낮은
리스크 기조와 맞지 않아 의도적으로 제외했다.

## 실행 계획 (위험도 낮은 것부터)

### 0. `app.scss` 토큰 추가
`--gh-header-accent`(#79c0ff), `--gh-attention`(#fd8c73),
`--gh-page-width-narrow`(720px)/`-wide`(900px),
`--gh-dialog-width-sm/md/lg`(360/420/480px) 추가 + 전역
`.markdown-body` 스타일(현재 두 파일에 scoped 중복).

### 1. 하드코딩 hex 3곳 → 토큰
`ProjectShell.vue:87`, `MainLayout.vue:28`, `MarkdownSourceView.vue:217`
- 전부 시각적 변화 없음. `ProjectAboutSidebar.vue`의 `TYPE_COLOR`
7-hex 맵은 정당한 개별 팔레트라 범위 밖.

### 2. 다이얼로그 폭/버튼 라벨 통일
sm/md/lg 토큰으로 교체(기존 값에서 최소 이동), "닫기"(`ChangePasswordDialog`/
`MessagesDialog`/`NicknameDialog`)를 "취소"로 통일.

### 3. `ConfirmDestroyDialog.vue` (신규)
`AccountsPage.vue`(계정 삭제)/`settings/GeneralPage.vue`(프로젝트
파기)의 "이름 직접 입력 확인" 삭제 다이얼로그 중복 제거.

### 4. 임시 폼 4곳에 `<q-form @submit.prevent>` 적용
`DocCreatePage.vue`/`PrCreatePage.vue`/`ApiKeysPage.vue`(새 키 발급)/
`GeneralPage.vue`(양도/소유권 이전) - Enter 제출 가능하게, 시각 변화
없음.

### 5. 초기 로딩 표시 추가
`DocTypeWorkspace.vue`/`PullRequestsTab.vue`/`CodeTab.vue` - 기존
"불러오는 중..." 캡션 관례 재사용.

### 6. `EmptyState.vue` (신규)
13곳의 빈 목록 안내 문구 통일(`as="item"|"div"`).

### 7. `PageHeader.vue` (신규, 적용 13곳)
`page`/`section`/`detail`/`settings` 4개 variant로 5가지 헤더 패턴
정리. `CodeTab.vue`/`TrackersTestsTab.vue`에 없던 헤더 신설.
`CommitDiffPage.vue`는 구조상 제외(사이드바 라벨 역할) - 대신
뒤로가기 버튼을 `router.back()`에서 `:to=` 고정 경로로 수정(다른
detail 페이지와 동작 통일).

### 8. 중복 제거
`buildFileTree()`(`PullRequestsTab.vue`/`CommitDiffPage.vue`) →
`utils/fileTree.ts`. `.markdown-body` scoped 중복 제거(0단계에서
전역화). `DocTypeWorkspace.vue`의 죽은 `.doc-source` 블록 삭제.

## 진행 상태

- [x] 0. app.scss 토큰
- [x] 1. hex → 토큰 3곳
- [x] 2. 다이얼로그 폭/라벨 통일 (ProjectListPage의 "초대 수락" 다이얼로그도
      "닫기"였던 것을 추가로 발견해 같이 통일)
- [x] 3. ConfirmDestroyDialog (AccountsPage/GeneralPage 적용, 브라우저로
      실제 삭제 다이얼로그 렌더링 확인)
- [x] 4. q-form 래핑 4곳 (DocCreatePage/PrCreatePage/ApiKeysPage/
      GeneralPage 양도·소유권이전)
- [x] 5. 로딩 표시 3곳 (DocTypeWorkspace/PullRequestsTab/CodeTab)
- [x] 6. EmptyState (13곳 적용)
- [x] 7. PageHeader (13곳 적용 + CommitDiffPage 뒤로가기 버그 수정) -
      타입체크 통과, Documents 탭 브라우저 확인 완료
- [x] 8. 중복 제거 3건 (buildFileTree → utils/fileTree.ts, markdown-body
      전역화, DocTypeWorkspace.vue의 죽은 .doc-source 삭제) - 타입체크 통과

## 최종 검증 (2026-09-22)

`vue-tsc --noEmit` 전체 통과(작업 중 여러 차례 재확인). 브라우저로
Projects/Accounts/API 키/Documents/Trackers & Tests(신규 헤더 포함)/
PR 목록/Code 탭(신규 헤더 포함)/Settings(General/Collaborators/
Template)/Q&A 스레드/BranchCommits/CommitDiff까지 전부 열어 헤더·
다이얼로그·빈 상태·로딩 표시가 실제로 렌더링되는 것을 스크린샷/DOM
조회로 확인했다. `CommitDiffPage`의 뒤로가기 버튼이 실제로
`/${owner}/${projectId}/commits?branch=${branch}`로 이동하는 것도
클릭으로 재확인. grep으로 `#79c0ff`/`#fd8c73`(app.scss의 토큰
정의 자체 제외)/`label="닫기"`/중복 `buildFileTree`/중복
`.markdown-body :deep` 잔존이 전부 0건임을 확인.

**이번 라운드 판단해두는 것** (설계에 없던 지점):
- **브라우저 자동화 키 입력과 네이티브 폼 암묵 제출(implicit
  submission)의 차이**: `<q-form>`으로 새로 감싼 4곳에서 Enter 키
  제출을 이 세션의 브라우저 자동화 도구로 검증하려 했으나 동작하지
  않았다. 원인을 추적하며 이 앱을 전혀 건드리지 않은 기존
  `LoginPage.vue`(동일한 `q-form`+`q-input`+제출 버튼 패턴)에서도
  Enter가 폼을 제출시키지 않는 것을 확인했다 - 즉 이번 변경이 만든
  회귀가 아니라, 이 자동화 도구가 보내는 키 이벤트가 Chrome의
  암묵적 제출 휴리스틱을 트리거하지 못하는 환경적 한계로 판단한다
  (실제 사용자의 진짜 브라우저에서는 표준 HTML 동작이라 정상
  작동할 것으로 본다). 구조적으로 올바른 `<q-form>` 패턴(로그인
  페이지 등 기존 코드와 동일)임은 코드 검토로 확인했다.
