---
id: QAFULL01
parent_id: XJQCTF6Y
type: plan
kind: PL
state: done
branch: null
commit_id: null
title: 전체 시스템 QA 계획 - 액션 카탈로그 64개 + 프론트엔드 전 화면 실기동 점검
author: agent
related:
  - SP-PSTRUCT01
  - PL-PLANURL01
  - PL-PLANQA001
  - PL-PLANACCT1
  - PL-PLANNICKN
  - PL-PLANGITEA
---

# PL-QAFULL01 - 전체 시스템 QA 계획

지금까지 여러 라운드에 걸쳐 기능별로(그 기능을 막 구현한 직후에만)
검증해왔다 - 기능 간 상호작용(예: 계정 삭제가 프로젝트 소유권/멤버십에
미치는 영향, API 키 스코프가 Q&A 액션까지 실제로 막는지)이나 오래된
회귀는 별도로 훑은 적이 없다. 이 문서는 **지금 시점의 전체 시스템**을
액션 카탈로그(`backend/src/api/actions.ts`, 64개 액션)와 프론트엔드
라우트(`frontend/src/router/routes.ts`) 기준으로 빠짐없이 나열하고,
섹션별로 순서대로 실기동 점검한다 - CLAUDE.md "작업 방식" 4단계
("실제로 기동해서 왕복 확인한 뒤에만 완료로 본다")를 시스템 전체
스코프로 한 번 적용하는 것.

## 원칙

- **로컬 dev 스택 대상**(`docker-compose.dev.yml` - postgres 15432/
  meilisearch 17700/emqx 11883+18084/gitea 13000) - `C:\CNW`(사용자의
  별도 운영 설치)는 이 계획 전체에서 절대 건드리지 않는다.
- 테스트로 만든 계정/프로젝트/문서/API 키/Gitea org는 각 섹션이
  끝날 때마다 즉시 정리한다(demo-project 등 기존 데모 데이터는
  건드리지 않거나, 건드렸으면 원상 복구) - 이 문서 자체가 새 데이터를
  영구히 남기는 목적이 아니다.
- 발견되는 버그는 그 자리에서 고치고 재검증한 뒤 다음 섹션으로
  넘어간다(CLAUDE.md 작업 방식 그대로) - 이 문서의 체크박스는 "고쳐서
  통과"까지 포함한 완료를 뜻한다.
- 각 섹션은 CLI(`agent` 채널)와 WEB UI(REST, `architect` 채널)
  양쪽 경로를 최소 한 번씩은 거치게 한다(actions.ts의 dispatch()와
  rest.ts의 web() 둘 다 실제로 맞물리는지 - 한쪽만 확인하고 다른
  쪽은 "당연히 될 것"이라고 넘기지 않는다).
- 이미 이전 라운드에서 실기동 검증되고 이 세션 안에서 코드가 안
  바뀐 부분은 "재확인만"(빠르게 스팟체크) 수준으로 가볍게 지나가고,
  이번에 새로 만들었거나 고친 부분은 전체 시나리오를 다시 처음부터
  끝까지 돈다.

## 섹션 1 - 인증/계정/닉네임/API 키 [x] (재확인 완료, 2026-09-21)

이번 세션에서 만든 직후 이미 curl/CLI/웹 UI로 전 구간 검증됐고
(`docs/plan-account-management.md`/`plan-nickname-apikey-policy.md`
참고), 오늘 다시 대표 시나리오로 스팟체크 - 전부 통과:

- [x] 셀프 가입 → 로그인 → `account.me`(닉네임 기본 라벨 "설계자 #N")
      - `qa_sec1` 계정으로 재확인.
- [x] 셀프 비밀번호 변경(틀린 현재 비번 거부 → 맞는 값으로 성공).
- [x] admin 대행 임시 재설정 → 그 값으로 즉시 로그인 성공.
- [x] 비활성화 → 로그인 401(“this account has been disabled”) →
      활성화 → 로그인 200 복구.
- [x] superAdmin 자기 자신 disable/delete 둘 다 거부 메시지로 확인.
- [x] 계정 삭제 가드(생성 프로젝트/ADMIN 역할 잔존 시 거부 →
      transferOwnership/transfer로 해소 후 성공)는 지난 라운드에
      이미 전 구간 실기동 - 이번엔 재현 생략(코드 변경 없음).
- [x] 닉네임 풀 번호 순차 증가/7일 쿨다운/같은 값 재제출 무해는
      지난 라운드에 "Jay #1"/"Jay #2"로 이미 실기동 확인 완료 -
      코드 변경 없어 이번엔 생략.
- [x] API 키 personal/project 스코프 발급, project 키의 타 프로젝트
      접근 거부(실제 멤버여도), `account.list`/`project.create`
      거부, 배제 3경로(본인/프로젝트 Admin/superAdmin 강제)는
      지난 라운드 + 방금 전 라운드(force-revoke 추가 시)에 이미
      전부 실기동 확인 완료.
- [x] 프론트 `/keys`/`/accounts`/아바타 메뉴는 지난 라운드에 화면
      스크린샷까지 포함해 확인 완료.

## 섹션 2 - 프로젝트 관리 [x] (재확인 완료, 2026-09-21)

- [x] 생성 → 생성자가 유일한 Admin(지난 라운드 확인) - 오늘은
      slug 중복 거부만 재확인(아래).
- [x] 같은 계정 범위 slug 중복 거부(`demo-project` 재생성 시도 →
      정확한 에러 메시지로 거부) - 다른 계정은 같은 slug 허용은
      지난 라운드에 이미 확인(테스트 계정으로 같은 slug 프로젝트
      2개 동시 존재시켜본 적 있음).
- [x] PRIVATE/PUBLIC 가시성 + `pushMirrorUrl` Admin 전용 노출은
      바로 지난 라운드에 Admin/WRITE/완전비멤버 세 시점 전부
      curl로 재확인 완료(코드 변경 없어 오늘은 생략).
- [x] `project.invite`가 ADMIN role 지정을 거부하는 것 재확인
      ("Admin은 project.transfer로만" 메시지).
- [x] `project.transfer`(역할만) vs `project.transferOwnership`
      (creator/URL만)는 Gitea 프로비저닝 라운드에서 실제로 헷갈려
      버그를 낸 뒤 둘 다 전 구간 실기동 확인 완료(문서 기록됨).
- [x] **"Admin은 프로젝트당 1명" DB 제약을 오늘 직접 SQL로 위반
      시도해 재확인** - `INSERT INTO "ProjectMembership" (...) VALUES
      (..., 'ADMIN', ...)`가 두 번째 Admin 삽입에서 실제로
      `duplicate key value violates unique constraint
      "ProjectMembership_admin_per_project"`로 거부됨.
- [x] `project.destroy`의 cascade + Gitea org 정리는 바로 지난
      라운드에 실기동 확인 완료.
- [x] 프론트 `/projects`/Settings 탭 4카드는 지난 라운드들에서
      스크린샷 포함 확인 완료.

## 섹션 3 - 문서 체계 (Documents/Plans/Issues 공통, doc/plan/issue) [x] (2026-09-21 실기동)

- [x] 잘못된 kind("XX") 거부 확인.
- [x] etag 동시성 - 틀린 etag로 update 거부, 올바른 etag로 성공
      (처음엔 페이로드 필드명을 잘못 짚어 거짓 실패를 봤다가 -
      REST/CLI 필드명이 `etag`이지 `expectedEtag`가 아님을 확인하고
      재검증해서 실제로는 정상 동작임을 확인 - 아래 항목도 전부
      같은 이유로 한 번씩 재확인했다).
- [x] doc 상태 전이: draft→review(agent 가능)→active(agent 채널
      거부, architect 채널 성공) 실기동 확인. discard도 architect
      전용인 것을 agent 채널 3건 거부로 재확인.
- [x] `related`/`dependsOn` 태그 추가 후 `docs.get`에 실제로 반영,
      `sort:'dependency'`가 미해소 dependsOn이 있는 문서를 그
      대상보다 뒤에 배치하는 것 확인.
- [x] `docs.grep`은 특정 문서 하나의 본문 안에서 찾는 것(project
      전역 아님 - 처음에 이 API 계약을 잘못 짚어 오해했었다),
      `docs.search`의 `grep` 모드가 프로젝트 전역 POSIX 정규식
      검색인 것으로 확인. `docs.status` 집계가 방금 만든 문서를
      즉시 반영(캐시 무효화 정상).
- [x] `docs.list` 응답에 `content` 키가 아예 없는 것(요약 전용)
      확인.
- [x] chapter를 doc에 지정 시 거부("question/opinion에만") 확인.
- [x] **프론트 Documents/Plans/Issues 세 탭 UI - 설계자의 "남은 검증을
      모두 진행해" 요청(2026-09-21 후속)으로 "코드 변경 없어 생략"
      대신 실제로 다시 열어서 재확인.** Documents(10건)/Plans(1건)/
      Issues(1건) 탭 전부 목록/상세 패널이 정상 렌더링되고, 이번
      라운드에서 만든 `emqx-doc-event-test` 문서를 실제로 열어
      "폐기" 버튼으로 discard 전이까지 시켜 정리(콘솔 에러 없음).

## 섹션 4 - Q&A 계층 (question/answer/opinion) [x] (2026-09-21 재확인)

- [x] 체인 제약(answer parent는 반드시 question - doc으로 시도해
      거부 확인), 질문 하나당 답변 하나(두 번째 답변 시도 거부).
- [x] 액터 규칙: agent 작성 question을 architect가 read/답변, 그
      답변(architect 작성)을 agent가 read→done, 질문 cascade
      done까지 전 구간 실기동.
- [x] "완료 처리" 전체 흐름/카드 UI/Markdown 렌더링/`RecentQaFeed.vue`
      는 PL-PLANQA001 라운드에서 웹 UI 스크린샷까지 포함해 이미
      상세 검증 완료(같은 날 코드 변경 없음) - 오늘은 백엔드 액터
      규칙만 재확인.

## 섹션 5 - Trackers/Tests [x] (2026-09-21 실기동)

- [x] tracker: agent 채널로 added→resumed→ended 정상 진행, architect
      (WEB) 채널 시도는 "클로드(agent)만 할 수 있습니다"로 거부 확인.
- [x] test: architect의 discard 시도 거부, agent의 discard 성공
      확인.
- [x] **프론트 Trackers 탭 UI도 실제로 재확인**(TRACKERS/TESTS/
      RECENT Q&A 세 서브탭 전부 목록/상세 정상 렌더링, 콘솔 에러
      없음) - 위와 같은 이유로 "생략" 대신 실기동.

## 섹션 6 - Remember / Message [x] (2026-09-21 실기동)

- [x] remember add(잘못된 category 거부 확인) → list → update →
      delete 전 구간.
- [x] message.send의 `from` 검증(from-web/etc/emerg만 허용,
      emerg/from-web은 architect 채널 전용 - agent 시도 거부 확인) →
      agent→architect(from:etc)로 발송.
- [x] **notices piggyback + 자동 read 전이를 실제로 목격** - 방금
      보낸 메시지를 architect가 `GET /messages`로 조회하자마자
      (별도 transition 호출 없이) `state`가 이미 `"read"`로 바뀌어
      있는 것 확인 - "전달 시 자동 read 전이" 설계가 실제로 매
      조회마다 작동함을 재확인.
- [x] `message.list`가 발신자 자신이 아니라 그 메시지의 `to`
      기준으로 필터링되는 것(agent 채널로 조회 시 agent가 보낸 게
      아니라 agent 앞으로 온 것만 보임) 확인.
- [x] **emerg EMQX 실제 브로드캐스트 - 설계자 지적(2026-09-21 후속)으로
      "가벼운 스팟체크로 대체"를 철회하고 실제 왕복까지 끝까지 확인함.**
      EMQX는 이 시스템 전용 컨테이너(`cnw-v3-dev-emqx`, 포트 11883,
      `docker-compose.dev.yml`)로 이미 완전히 이 시스템 통제 하에
      있었지만, 처음 시도에서 외부 구독자가 실제 백엔드가 보낸 `emerg`
      메시지를 0건 수신하는 진짜 문제를 만나 원인을 끝까지 추적했다.
      `emqx.ts`(연결/즉시 publish 패턴), `.env` 값(`EMQX_MQTT_URL`
      등 - dotenv 없이도 Prisma import 부작용으로 채워짐 확인),
      `api/actions.ts`/`api/rest.ts`의 owner/slug→내부 PK 치환
      (`demo-project`는 실제로 PK와 slug가 동일함을 DB 직접 조회로
      확인 - 원인 아님) 순으로 하나씩 배제해가며 `emqx.ts`에 임시
      디버그 로그(연결/발행/콜백 각 단계)를 넣고 백엔드를 완전히
      새 프로세스로 재기동한 뒤 재현했더니 **실제로는 정상 동작**함을
      확인 - `POST /api/projects/admin/demo-project/messages`
      (`from:"emerg"`)를 5회 반복 전송, 매번 별도 외부 구독자
      프로세스(`cnw/demo-project/#`)가 전부 수신 확인(`connected=true`,
      publish 콜백 성공, 토픽/페이로드 일치). 이전의 "0건 수신"은
      오래 떠 있던 백엔드 프로세스의 어떤 일시적 상태(정확한 원인은
      특정하지 못함 - 재현되지 않아 더 추적 불가) 때문이었던 것으로
      보인다. 디버그 로그는 확인 후 원상복구(`emqx.ts`는 순수 기능
      변경 없음).
- [x] **문서 이벤트(`cnw/<projectId>/docs`) 브로드캐스트도 같은 방식
      으로 실제 왕복 확인** - `docs.add`(REST)로 실제 문서 생성 →
      외부 구독자가 `cnw/demo-project/docs`에서 실제 upsert 이벤트
      (문서 전체 필드 포함)를 수신하는 것 확인 - `broadcastSubscriber.ts`
      가 이 경로로 검색 인덱싱/캐시 무효화/웹훅을 트리거한다는 설계가
      추론이 아니라 실측으로 확인됨(웹훅 배달은 섹션 9에서 이미
      HMAC까지 검증됨 - 같은 구독 하나를 공유하므로 이번 확인으로
      emerg/docs/webhook 세 갈래 전부 실제 브로드캐스트 경로가
      살아있음이 교차 확인됨).
- [x] **TTL 기반 메시지 만료도 실제로 확인 완료(설계자의 "남은 검증을
      모두 진행해" 요청, 2026-09-21 후속).** `messages.ts`의
      `collectAndDeliver()`는 백그라운드 타이머가 아니라 notices
      piggyback 시점에 지연 평가하는 방식(`m.ttl >= 0 && now -
      m.createdAt.getTime() > m.ttl * 1000`이면 `canceled`로 전이하고
      전달하지 않음)임을 코드로 먼저 확인한 뒤, 실제 만료 시나리오를
      끝까지 재현: agent 앞으로 `ttl:2`(2초 후 만료)와 `ttl:60`
      메시지를 각각 전송 → 4초 대기 → agent 채널로 아무 액션(`docs.status`)
      하나를 호출해 notices piggyback을 트리거 → 응답의 `notices`에
      `ttl:60` 메시지 본문만 포함되고 `ttl:2` 메시지는 빠진 것을 확인.
      DB 상태로도 교차 확인 - `GET .../messages`(agent 채널)로 조회한
      결과 만료된 메시지는 정확히 `state:"canceled"`, 전달된 메시지는
      `state:"read"`로 각각 정확한 최종 상태였다. 테스트 메시지는
      정리(전달된 쪽은 `done`으로 전이, 만료된 쪽은 이미 `canceled`라는
      종단 상태라 그대로 둠).

## 섹션 7 - Code(내부 저장소)/Git [x] (2026-09-21 실기동, 버그 1건 발견·수정)

- [x] **실제로 새 버그를 발견했다** - diff 뷰어는 "512KB 초과 →
      안내 문구"로 고쳤지만(Gitea 라운드), **Code 탭의 파일 뷰어
      자체는 그 신호를 전혀 안 쓰고 있었다** - 600KB 테스트 파일을
      실제 커밋해서 열어보니 `isBinary`만 걸러 나머지는 전부
      `MarkdownSourceView`로 넘어가 빈 파일처럼 보였다.
      `CodeTab.vue`에 diff 뷰어와 동일한 신호(`!isBinary && size > 0
      && content === ''`)로 안내 문구 분기를 추가해서 고쳤다 - 같은
      600KB 파일로 재현 검증(`파일이 너무 커서(512KB 초과, 614400
      bytes) 표시할 수 없습니다.` 정상 노출) 후 테스트 커밋 되돌림.
- [x] `repo.writeFile`/README 작성 유도/yiitap 코드펜스 왕복은
      이전 라운드(Code/PR 라운드)에서 이미 상세 검증 완료, 코드
      변경 없어 이번엔 생략.
- [x] 브랜치별 URL 지속성/`effectiveDefaultBranch()` 폴백은
      PL-PLANURL01에서 이미 상세 검증 완료.
- [x] **머지 커밋 첫 부모 정확도를 실제 앱 데이터로 재확인** -
      demo-project에 이미 있던 실제 병합 PR의 머지 커밋
      (`6f016405...`)의 진짜 부모를 `git log --format=%P`로 직접
      확인(`adb15655...`, `b23fa48e...` 순) → 앱의
      `repo.commitDiff` 응답의 `baseCommitId`가 정확히 그 첫 부모
      (`adb15655...`)와 일치하는 것 확인 - 격리된 임시 저장소
      유닛 테스트뿐 아니라 실제 운영 데이터 경로로도 재확인.
- [x] `repo.commits`/`commitInfo`/`fileCommits`는 위 확인 과정에서
      자연히 같이 왕복됨(별도 이슈 없음).
- [x] **push-mirror 수동 URL 왕복도 다시 실기동 확인**(2026-09-21
      후속) - `repo.connectGitea`가 아니라 Gitea org/repo를
      Gitea API로 직접 미리 만들어두고(`qa-manual-mirror-org/
      manual-repo`) `project.update`의 `pushMirrorUrl`을 그 주소로
      수동 지정 → `repo.push` 호출 → Gitea 쪽 커밋 목록을 조회해
      방금 만든 커밋(`26656b2c...`, message `init`)이 정확히 그
      수동 지정 저장소에 도착한 것까지 SHA 단위로 확인. 테스트
      프로젝트/org/repo는 검증 직후 모두 삭제.

## 섹션 8 - Pull Requests [x] (2026-09-21 실기동)

- [x] `pr.create`(feature-branch→master) → `pr.list`에 반영 →
      `pr.update`(설명 수정, `updatedAt` 갱신 확인) → `pr.close`
      (병합은 데모 브랜치 상태를 더 어지럽히지 않으려 스킵 -
      병합 로직 자체는 이전 라운드에 상세 검증 완료 기록 있음).
- [x] `DiffViewer.vue`의 "너무 큼" 안내는 섹션 7에서 실제 커밋
      diff 페이지로 이미 재확인(PR 상세와 커밋 diff 페이지가 같은
      컴포넌트를 공유하므로 구조적으로 동일 검증) - 파일 트리/
      분할 diff/이미지·바이너리 처리/"코드 트리에서 보기" 링크는
      코드 변경 없어 생략(이전 라운드 확인 완료).

## 섹션 9 - Templates / Webhooks [x] (2026-09-21 실기동)

- [x] template deploy 커밋 author가 실제 계정 표시 라벨인 것은
      방금 전 라운드에 `git log`로 이미 재확인(코드 변경 없어
      재검증 생략) - CLAUDE.md+SKILL.md 두 커밋 순차 생성도 그때
      같이 확인됨(에러 없이 둘 다 성공).
- [x] webhook.add(secret 1회 노출) → list(secret 재노출 안 됨,
      필드 자체가 없음) 확인.
- [x] **실제 로컬 HTTP 리스너로 HMAC 서명 배달을 끝까지 확인** -
      문서 생성 → EMQX 브로드캐스트 → 구독자가 실제로
      `X-Cnw-Signature: sha256=...` 헤더와 함께 POST 발송 →
      리스너가 받은 원문 body로 직접 HMAC-SHA256을 재계산해
      **서명이 정확히 일치하는 것까지 바이트 단위로 검증**. 웹훅
      삭제 후 테스트 문서 정리.

## 섹션 10 - Gitea 프로비저닝 [x] (2026-09-21 스팟체크)

이번 라운드에서 만든 직후 이미 org 생성/push/토큰 미저장/URL 변경/
`project.destroy` 정리 전 구간을 curl로 상세 검증했다(`docs/
plan-gitea-provisioning.md` 참고). 오늘은 그 이후 다른 여러 라운드
(pushMirrorUrl 노출 제한 등)를 거친 뒤에도 여전히 정상인지만 재확인:

- [x] `repo.connectGitea` 재호출 - org+저장소 멱등 생성, 응답의
      `pushMirrorUrl`에 자격증명 없는 것 재확인.
- [x] `repo.push` - 실제 push 성공(토큰 자동 주입 정상 동작).
- [x] `GITEA_URL`(`http://localhost:13000`)이 여전히 Gitea의
      `ROOT_URL`과 일치해 인증이 조용히 실패하는 회귀가 없음을
      확인(위 push 성공 자체가 증거).
- [x] **`project.destroy`의 Gitea org 정리도 오늘 새 테스트 프로젝트로
      다시 처음부터 실기동**(2026-09-21 후속) - `qa-gitea-cleanup-test`
      프로젝트 생성 → `repo.connectGitea` → Gitea API로 org(`proj-
      cmubbhgtl...`)/repo가 실제 생성된 것을 200으로 확인 → `project.destroy`
      호출 → 같은 org를 다시 조회해 404로 바뀐 것까지 확인 - "지난
      라운드에 확인됨" 문구에 기대지 않고 이번에 새 데이터로 재현.

## 섹션 11 - CLI/MCP 커버리지 [x] (2026-09-21 실기동, 버그 2건 발견·수정)

- [x] **CLI 커버리지 갭 발견·수정** - `actions.ts`(64개) vs
      `cli/src/index.ts`의 `registerActionCommands`를 스크립트로
      전수 대조한 결과 `repo.commitDiff`/`repo.diffFile`/
      `repo.fileCommits`/`repo.commitInfo` 4개가 CLI에 아예 없었다
      (PR/커밋 diff 뷰어 라운드에서 REST에만 노출하고 CLI 추가를
      빠뜨린 것으로 보임) - `repo` 서브커맨드 그룹에 추가하고
      `repo commitInfo`로 실제 왕복까지 확인.
- [x] **MCP 커버리지 갭도 동일 4개** - `queryActions`에 추가(전부
      읽기 전용 조회이므로). 이 대조 과정에서 나머지 60개 액션의
      query/mutation 분류도 전수 재확인 - 오분류 없음.
- [x] `docs add --stage` → `docs stage list` → `docs push`(bulk
      전송) → `docs get`(캐시 채움) → `docs cat`(네트워크 없이
      캐시에서 재조회) 전 구간 실기동, 테스트 문서 정리.
- [x] **MCP 실제 핸드셰이크 확인 중 진짜 버그를 발견했다** - 이
      세션 자체가 `.mcp.json`으로 이 저장소의 `cnw` MCP 서버에
      dogfooding 연결돼 있어야 하는데 "CONNECTION_CLOSED"로 끊겨
      있었다. 원인 추적: `mcp/.cnw/config.json`(레포에 커밋돼 있는
      파일 - 새로 클론한 사람도 바로 dogfooding되게 하려는 의도)이
      "project id는 생성자별로 유일" 마이그레이션 **이전** 스키마로
      쓰여 있어 `owner` 필드가 없었다 - `shared/config.ts`의
      `readProjectConfig()`가 이걸 즉시 던지고, MCP 서버는 시작
      시점에 이 함수를 호출하므로 매번 부팅 직후 크래시하고 있었다.
      **더 심각한 2차 버그**: 이 상황을 고치려고 `docs auth login`을
      다시 실행해도 **로그인 명령 자체가 기존 설정을 무조건 먼저
      읽어서 같은 이유로 죽어** - 에러 메시지가 시키는 복구 방법
      자체가 실행 불가능한 자기모순이었다. `cli/src/index.ts`의
      로그인 핸들러가 기존 설정 읽기를 try/catch로 감싸 실패하면
      그냥 없는 것으로 취급하도록 고치고(옵션을 명시하면 그 값
      자체가 필요 없어짐), `mcp/.cnw/config.json`을 실제로 재로그인
      해서 `owner` 필드를 채운 뒤(레포에 커밋된 파일이라 이 수정도
      커밋 대상), MCP 서버가 크래시 없이 뜨는 것까지 확인(stdin
      EOF에 정상적으로 종료하는 것으로 확인 - 실제 하네스 재연결
      여부는 세션/도구 목록 갱신이 필요해 별도 확인 필요).

## 섹션 12 - 프론트엔드 전역/회귀 스팟체크 [x] (2026-09-21)

- [x] 로그인 실패 메시지가 사람이 읽을 메시지로 뜨는 것은 그
      기능을 고친 라운드에서 이미 실기동 확인 완료(재확인 생략).
- [x] 모바일 폭(375x812)에서 Documents 탭 - 햄버거 메뉴로 사이드바
      토글 정상 동작, 문서 목록 카드 레이아웃 안 깨짐, 좁은 화면
      에서도 내가 이번 QA에서 만든 테스트 문서들이 전부 정확히
      "discard" 상태로 정리돼 있는 것까지 자연스럽게 재확인됨.
- [x] 상단바 표시 라벨("Jay #1")이 브레드크럼과 안 겹치는 것 확인.
- [x] **`read_console_messages`가 이 브라우저 탭의 전체 세션
      기간(몇 시간, 여러 라운드) 누적 로그를 돌려준다는 것을
      확인했다** - 페이지를 새로고침해도 동일한 과거 에러 목록이
      그대로 나와서(이미 몇 라운드 전에 고친 `answerEditorRef` 버그
      메시지까지 포함) 이 도구가 "지금 이 페이지 상태"가 아니라
      "이 탭이 열린 이후 전체 누적"을 보여준다는 걸 실증했다 - 이번
      QA 전 구간 동안 내가 직접 관찰한 실시간 응답(각 절의 curl/CLI
      호출 결과)에서는 예상 밖 실패가 없었으므로 "새 회귀 없음"으로
      판단하되, 이 도구의 누적 특성 자체를 여기 기록해 다음 세션이
      같은 착각(오래된 로그를 새 버그로 오인)을 안 하게 한다.

## 진행 상태 요약

- [x] 섹션 1 - 인증/계정/닉네임/API 키
- [x] 섹션 2 - 프로젝트 관리
- [x] 섹션 3 - 문서 체계
- [x] 섹션 4 - Q&A 계층
- [x] 섹션 5 - Trackers/Tests
- [x] 섹션 6 - Remember/Message
- [x] 섹션 7 - Code/Git (버그 발견·수정: Code 탭 512KB 초과 파일 처리)
- [x] 섹션 8 - Pull Requests
- [x] 섹션 9 - Templates/Webhooks
- [x] 섹션 10 - Gitea 프로비저닝
- [x] 섹션 11 - CLI/MCP 커버리지 (버그 발견·수정: CLI/MCP 4개 액션
      누락, `docs auth login`의 자기모순적 크래시, dogfooding
      MCP 설정 파일 스키마 노후화)
- [x] 섹션 12 - 프론트엔드 전역/회귀 스팟체크

## 발견·수정한 버그 총정리 (이 QA 라운드에서 새로 찾은 것만)

1. **Code 탭 파일 뷰어가 512KB 초과 파일을 빈 파일처럼 잘못 표시**
   (`CodeTab.vue`) - diff 뷰어는 이미 고쳤는데 Code 탭 자체엔 같은
   신호(`size`/`content`) 처리가 빠져 있었다.
2. **CLI/MCP에 `repo.commitDiff`/`diffFile`/`fileCommits`/
   `commitInfo` 4개 액션이 아예 없었음** - REST 전용으로 노출되고
   CLI/MCP 추가를 빠뜨렸던 것.
3. **`docs auth login`이 기존 설정 파일이 손상/노후화돼 있으면
   그 이유로 스스로도 크래시** - 에러 메시지가 안내하는 복구
   방법(로그인 재실행)이 실행 불가능한 자기모순이었다.
4. **이 저장소 자신의 dogfooding MCP 연결(`mcp/.cnw/config.json`,
   git에 커밋된 파일)이 스키마 노후화로 끊겨 있었음** - 3번 버그
   때문에 자체 복구도 안 됐던 것 - 둘 다 고치고 재로그인해서 복구.

네 건 모두 그 자리에서 코드/설정을 고치고 재현 시나리오로 재검증
했다(CLAUDE.md "작업 방식" - 발견만 하고 다음 라운드로 미루지
않음). 나머지 11개 섹션 전부는 기존 동작이 그대로 정상임을
재확인했을 뿐 새 버그는 없었다.

## 판단해두는 것

- 섹션 순서는 의존성 순(계정→프로젝트→문서→Q&A→...)이자 위험도
  순(이번 세션에 새로 만들어 아직 "전체 통합" 관점으로는 한 번도
  안 본 기능들 - 계정 관리/닉네임/API 키/Gitea - 을 앞/뒤에 배치해
  다른 기능과의 상호작용을 자연스럽게 같이 확인하게 했다).
- 이미 개별 라운드에서 충분히 검증된 항목(예: yiitap 에디터
  버그들, PR/커밋 diff 뷰어 기본 동작)은 이 계획에서 처음부터
  다시 상세히 재현하지 않고 "여전히 정상"인지 스팟체크만 한다 -
  중복 검증에 시간을 쓰지 않기 위함(CLAUDE.md 규칙 6).
- 섹션 7의 "Code 탭 파일 뷰어가 512KB 초과 파일을 어떻게 보여주는지"
  는 diff 뷰어와 별개 경로라 이번에 새로 발견될 수 있는 지점으로
  표시해뒀다 - diffFile에서 고친 것과 같은 신호(size)를 Code 탭
  자체도 쓰고 있는지 확인이 안 끝난 상태.
