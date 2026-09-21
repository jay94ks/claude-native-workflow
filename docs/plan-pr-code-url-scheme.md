---
id: PLANURL01
parent_id: XJQCTF6Y
type: plan
kind: PL
state: done
branch: null
commit_id: null
title: PR/Code URL 체계 개편 - PR ID 라우팅, Code 브랜치/커밋 경로, 커밋 시점 원본 보기
author: agent
related:
  - SP-PSTRUCT01
---

# PL-PLANURL01 - PR/Code URL 체계 개편

설계자 요청(2026-09-21 후속, 세 번째 라운드) - Documents/Plans/Issues는
이미 완료(`docs/project-structure.md` 참고). 이 문서는 그 요청의
나머지 절반: PR과 Code 탭의 URL 체계.

## 목표 URL 스킴

1. PR: `/.../pull-requests/{PR's ID}` - 새로고침/북마크에서 그 PR을
   계속 보고 있는 상태 유지.
2. Code(기본 브랜치): `/.../code?path=경로`.
3. Code(특정 브랜치): `/.../code/{Branch}?path=경로`.
4. Code(특정 커밋 시점, 읽기 전용): `/.../code/{Branch}/{Commit-Id}?path=경로`.
5. PR/커밋 diff 화면에서 과거 커밋의 파일을 보다가, 그 파일의 실제
   원본을 코드 트리에서(위 4번 스킴으로) 열 수 있어야 한다.

## 진행 상태 (라운드 안에서 갱신)

- [x] `routes.ts` - `code/:branch?/:commitId?`, `pull-requests/:id`,
      `commit/:branch/:commitId`(branch 세그먼트 추가) 라우트 추가.
- [x] 백엔드 `gitRepo.ts`에 `listTreeAtRef` 추가(기존 `readFileAtRef`와
      짝) - branch/커밋 id 둘 다 받는 `resolveTreeForRef` 재사용.
      `listTree`/`readFile`(branch 전용, 실제 커밋 가능한 "지금" 상태)
      은 그대로 두고 별개로 유지 - 과거 시점에 실수로 쓰기가 섞여
      들어갈 여지를 API 레벨에서부터 없앤다.
- [x] `repoBrowse.ts`의 `repoTree`/`repoFile`이 optional `commitId`를
      받아 있으면 `listTreeAtRef`/`readFileAtRef`로, 없으면 기존
      `listTree`/`readFile`로 분기.
- [x] REST(`/repo/tree`, `/repo/file`)와 `frontend/src/api/client.ts`의
      `listTree`/`readRepoFile`에 `commitId` query 파라미터 통과.
- [x] `CodeTab.vue` - route params(`branch`/`commitId`)를 실제로 반영:
      브랜치 선택 시 `router.push`(기본 브랜치면 `/code`, 아니면
      `/code/{branch}`), 파일 선택 시 `?path=` 반영, `commitId`가
      있으면 과거 시점 모드(편집 UI 완전히 숨김 + "지금 브랜치로
      돌아가기" 배너). **실기동 중 진짜 버그 하나 발견 - `Project.defaultBranch`
      필드값("main", 스키마 기본값)이 실제 저장소 브랜치 목록에 없을 수
      있다**(demo-project 실측: DB엔 "main"인데 실제 브랜치는
      master/feature-branch/another-feature뿐) - 이 값을 검증 없이
      기본 브랜치로 썼다가 `/repo/tree`가 422로 실패했다.
      `effectiveDefaultBranch()`로 `branchNames`에 실제로 있는지
      확인 후에만 신뢰하도록 고쳤다.
- [x] `DiffViewer.vue` - `branch` prop을 추가로 받으면(CommitDiffPage
      에서만 넘김) "코드 트리에서 보기" 링크가
      `/code/{branch}/{head}?path=`(과거 시점)로, 없으면(PR 비교)
      `/code/{head}?path=`(head가 브랜치명, 지금 시점)로.
- [x] `CommitDiffPage.vue` - route에서 `branch` prop을 받아
      `DiffViewer`에 전달.
- [x] `BranchCommitsPage.vue`/`CodeTab.vue`의 파일별 "Recent Commits"
      탭 - 커밋 목록 링크를 `/commit/{branch}/{commitId}`로.
- [x] `PullRequestsTab.vue` - `id` route prop을 받아 마운트 시 자동
      선택, PR 선택 시 `router.push`로 `/pull-requests/{id}` 반영.
- [x] 실기동 검증(전부 브라우저로 직접 확인): PR 목록 → PR 선택 →
      새로고침 → 그 PR 유지됨. Code 탭 기본 브랜치(`/code`)/특정
      브랜치(`/code/master`) 진입 및 파일 선택 시 `?path=` 반영,
      새로고침해도 그 파일 유지됨. 커밋 목록 → 커밋 diff(`/commit/
      master/{id}`) → 파일 선택 → "코드 트리에서 보기" →
      `/code/master/{commitId}?path=CLAUDE.md`로 이동, 배너 표시,
      "View"만 있고 "편집" 버튼 없음(읽기 전용), **내용이 실제로
      지금 tip과 다르게 보이는 것까지 확인**(그 커밋 시점엔 아직
      없던 줄이 안 보임) - 항목 2("PR/커밋에서 과거 원본을 실제로
      열 수 있어야 한다")가 그림으로만이 아니라 실제로 만족됨.
      "지금 브랜치로 돌아가기" → 편집 버튼 다시 보이는 것 확인.
      PR diff → "코드 트리에서 보기" → `/code/another-feature?path=
      README.md`(브랜치 세그먼트만, commitId 없음 - 지금 시점) 확인.
- [x] `docs/project-structure.md` 갱신 완료.

## 판단해두는 것

- Code 탭의 "path"는 지금 열려 있는 **파일**을 가리킨다(디렉터리
  브라우징 중인 하위 폴더 자체는 URL에 반영하지 않는다) - 설계자가
  명시한 것도 "path=경로"를 파일 원본 보기 맥락에서만 언급했다.
- historical(커밋 시점) 모드에서 브랜치를 바꾸면 그 브랜치의 "지금"
  시점으로 돌아간다(과거 시점 + 다른 브랜치 조합은 만들지 않는다).
