---
name: claude-native-workflow
description: claude-native-workflow로 관리되는 프로젝트에서 문서/설계 기록을 읽고 쓸 때 사용한다. docs CLI와 MCP 도구로 프로젝트 문서, 질의/답변, 메시지, 접근 권한을 다루는 방법을 안내한다.
---

# claude-native-workflow

이 프로젝트의 문서/설계 기록은 파일이 아니라 claude-native-workflow
시스템의 DB에 저장된다. 모든 읽기/쓰기는 `docs` CLI 명령 또는 이 스킬과
함께 등록된 MCP 도구로만 한다 - DB/파일을 직접 건드리는 우회 경로는
없다.

## 반드시 지켜야 하는 규칙

1. **추적 코드 명시**: 문서, 질의(Question), 답변을 언급하거나 제안할
   때는 항상 정확한 추적 코드(`XX-XXXXXXXX` - 영문 2글자 + hex 8글자)를
   함께 적는다. 기본 문서 종류: `SP`(설계 명세), `DC`(결정 요구사항 및
   요청), `PL`(실행 계획), `PD`(실행 결과 보고), `RM`(지시 사항/지침),
   `DS`(설계 결정), 질의는 `QU`.
2. **사용자 참조는 `[userId]` 형식**: 설계자/작성자를 가리킬 때(질의
   작성자, 답변자 등)는 날것의 id를 그대로 쓰지 않고 `[userId]`
   형식으로 적는다 - 웹 UI도 이 형식을 프로필 링크로 렌더링한다.
3. **로컬 스크래치 사본은 git 커밋 금지**: 문서를 편집할 때 로컬 임시
   파일로 복사해 Edit/Write 도구로 다듬은 뒤 `docs save`로 다시 올리는
   건 정상 작업 방식이다. 단 이 임시 파일을 프로젝트의 git 저장소에
   커밋하지 않는다(문서 정본은 시스템 DB).
4. **응답의 `notices`를 반드시 확인**: 명령 응답에 `notices` 배열(CLI는
   JSON 앞에 `⚠ ...` 줄로, MCP는 별도 text 블록으로 표시됨)이 붙으면
   그 내용을 읽고 지시대로 행동한다(권한 제한 안내 또는 미확인 질의
   안내) - 우회하거나 무시하지 않는다.

## 세션을 시작하거나 이 프로젝트를 다시 열 때 (체크리스트)

1. `docs hook queue <projectId> --status pending`으로 대기 중인 push
   훅이 있는지 확인한다.
2. `docs pending <projectId>`로 `pending`(설계자가 답변했지만 아직
   확인 안 한 질의) 상태가 있는지 확인하고, 있으면 `docs question ack
   <trackingCode>`로 처리한다.
3. **이전 작업이 시스템 다운 등으로 비정상 종료됐을 수 있으니**, `docs
   message recent <projectId>`로 최근 메시지 기록을 먼저 확인해 놓친
   지시나 맥락이 없는지 살핀다(이 명령은 상태를 바꾸지 않으므로 반복
   호출해도 안전 - 장애 복구/재접속 시 확인용).

## 문서 타입 / 표준 상태 코드

문서 **분류(DocType)**는 관리자가 자유롭게 정의한다(코드/라벨/지침).
새 프로젝트는 기본으로 여섯 타입을 갖고 시작한다: `SP`(설계 명세),
`DC`(결정 요구사항 및 요청), `PL`(실행 계획), `PD`(실행 결과 보고),
`RM`(지시 사항/지침), `DS`(설계 결정).

**문서의 "현재 상태"(DocStatus)는 분류와 달리 자유 정의가 아니라
아래 6개 표준 코드로 고정돼 있다** - 어떤 문서 타입이든 상태는 항상
이 어휘만 쓴다:

| 코드 | 라벨 | 의미 |
|---|---|---|
| `draft` | 초안 | 아직 확정되지 않은 작성 중 상태(진입점) |
| `review` | 검토 중 | 다른 설계자나 AI의 확인을 기다리는 단계 |
| `pending` | 보류 | 추가 결정이나 외부 조건을 기다리며 잠시 멈춘 단계 |
| `approved` | 승인됨 | 확정되어 적용 중인 최종 버전 |
| `deprecated` | 더 이상 인용되지 않음 | 폐기가 아니라 "더 이상 참고 대상이 아님" - 되돌릴 수 있음 |
| `archived` | 보관됨 | 폐기가 아니라 보관 - 유일한 종료(isTerminal) 상태 |

**절대 규칙: `draft`가 아닌 상태에서 `draft`로는 어떤 경우에도 되돌아갈
수 없다** - 이 전이는 정의 자체가 거부되므로, 문서 편집기의 상태
콤보박스에도 애초에 옵션으로 뜨지 않는다.

새 타입에 이 표준 흐름을 한 번에 심으려면(6개 상태 + draft를 제외한
모든 조합의 전이) `docs doctype-apply-standard-flow <projectId>
<docTypeId>`(그룹/팀 스코프는 `group-`/`team-` 접두사)를 쓴다. 상태를
하나씩 붙이려면 `docs doctype-status-add <projectId> <docTypeId>
<code>`(6개 표준 코드 중 하나만 허용 - 라벨/지침은 입력받지 않고
고정값이 자동 적용된다), 전이는 `docs doctype-transition-add
<projectId> <docTypeId> <fromCode> <toCode>`. 문서 상태를 바꿀 땐
`docs transition <trackingCode> <toStatusCode>`, 지금 문서에서 갈 수
있는 다음 상태 목록(라벨+지침 포함)은 `docs document next-statuses
<trackingCode>`로 확인한다.

## 설계자 프로필 / 활동 이력

`docs auth whoami`로 본인 프로필(id/username/email/phone 등)을,
`docs user get <userId>`로 다른 설계자의 공개 프로필(비공개 필드는
가려짐)을 조회한다. `docs profile set [--email <e>] [--phone <p>]
[--email-visible <bool>] [--phone-visible <bool>]`로 본인 연락처와
공개 범위를 설정한다. `docs user activity <userId> [--limit <n>]`로
그 설계자의 최근 작업 이력(문서 작성/질의/답변/메시지 등)을 본다 -
숨김 프로젝트의 활동은 조회자가 그 프로젝트 멤버이거나 팀장일 때만
포함된다.

## 프로젝트 숨김 / 팀장

프로젝트는 `docs project-hide <projectId> --hidden <true|false>`로
숨길 수 있다(프로젝트 owner 또는 그 프로젝트가 속한 팀의 팀장만
가능) - 숨겨진 프로젝트는 기존 멤버와 팀장에게는 계속 보이고, 그 외
에게는 `docs projects` 목록에서 빠진다. 팀장 등록/해제/조회는 `docs
team-admin-add/team-admin-remove/team-admins <teamId> [<userId>]`.

## 세부 접근 권한 (프로젝트 owner 전용)

프로젝트 owner는 협업 중인 설계자의 읽기/쓰기/삭제 권한을 공통 →
문서 타입별 → 개별 문서 순(더 구체적인 쪽이 우선)으로 제한하거나
넓게 예외를 줄 수 있다: `docs access-set <projectId> <userId>
[--doctype <id> | --document <trackingCode>] [--read <bool>] [--write
<bool>] [--delete <bool>]`(스코프 옵션을 둘 다 생략하면 프로젝트 공통
레벨). 현재 설정을 보려면 `docs access-list <projectId>`. 권한이
제한된 문서/타입을 다루면 응답의 `notices`에 그 사실이 안내되니
반드시 확인한다. 문서 삭제는 `docs delete <trackingCode>`(delete
권한 필요, 리비전/링크/질의/답변까지 함께 정리됨).

## 질의/답변(Question/Answer) 루프 — AI가 묻고 설계자가 답한다

**질의는 클로드(AI)가 등록하는 것이고, 설계자는 답변만 한다.** 대상은
문서/칸반 카드/소스 코드 파일 셋 중 하나다(다른 종류의 코멘트/질의
대상이 늘어도 명령 시그니처는 안 바뀐다 - 서버가 targetType/targetKey로
다형화해 처리). 판단에 참고한 문서가 있으면 `--refs`로 구조적으로
태깅한다.

- 문서/칸반 카드 대상: `docs question <trackingCode> <질문 내용>
  [--kind <approval|answer>] [--refs <code1,code2,...>]` - 대상 자신의
  추적 코드(`XX-XXXXXXXX`/`KB-XXXXXXXX`)만으로 서버가 대상 종류를
  자동 판별한다.
- 소스 코드 파일 대상(추적 코드가 없는 대상): `docs question-source
  <projectId> <path> <질문 내용> [--kind <approval|answer>]
  [--refs <codes>]`.
- 둘 다 `QU-XXXXXXXX` 추적 코드가 발급된다.

**`kind`은 두 종류다**(기본값 `answer`) - **`answer`**(자유 텍스트
답변이 필요한 "답변 요청")와 **`approval`**(승인/거부만 필요한 "승인
요청" - 텍스트가 아니라 `--decision`으로 답한다).

상태는 3단계다: **`open`**(질의 등록, 설계자 답변 대기) → **설계자가
답변하면 `pending`**(종결이 아니라 "AI 확인 대기" - 이 상태에서 문서
전체가 끝난 게 아님) → **`resolved`**(AI가 확인 완료 표시, 종결).

- `docs pending <projectId>` - `open`+`pending` 둘 다(미해결 전체,
  모든 대상 종류가 섞여서)를 보여준다. 각 행의 `status`/`targetType`로
  구분한다.
- `docs reply <questionTrackingCode> [답변] [--decision
  <approved|rejected>] [--note <text>]` - 설계자 답변, 상태를
  `pending`으로 바꾼다. `kind=answer`면 답변 텍스트를, `kind=approval`
  이면 `--decision`(+ 선택적 `--note` 메모)을 쓴다.
- **`docs question ack <trackingCode>`** - `pending`을 `resolved`로
  전이(AI가 "확인했다"고 표시). **세션 시작 시 체크리스트의 2번 항목이
  바로 이것 - `pending` 상태를 방치하지 않는다.**
- `docs questions <trackingCode>` - 문서/칸반 카드 하나의 전체
  질의/답변 스레드(모든 상태) 조회.
- `docs questions-source <projectId> <path>` - 소스 코드 파일 하나의
  전체 질의/답변 스레드 조회.

대상이 문서이고 그 문서의 모든 질의가 `open`을 벗어나면, 그 문서
타입에 유일하게 허용된 다음 상태가 있을 경우 문서 상태가 자동으로
전이된다(모호하면 자동 전이하지 않고 `docs transition`으로 직접
지정 - 칸반 카드/소스 코드 대상은 이 자동 전이 개념 자체가 없다).

## 메시지 — 대기/기록 분리 + 문서별 지시 + 장애 복구

메시지는 "AI가 CLI/MCP로 읽어갔는가"를 기준으로 **대기**(아직 안
읽음, `deliveredAt`이 비어 있음)와 **기록**(이미 읽음)으로 나뉜다.
`docs message list <projectId> [--status pending|delivered|all]`을
호출하면(CLI/MCP는 항상 그 순간 `markDelivered=true`로 호출 -
호출 자체가 "읽었다"는 뜻) 조회된 대기 메시지가 자동으로 기록으로
전환된다. `docs message wait <projectId> [--timeout <초>]`도 새
메시지를 받으면 즉시 기록으로 처리한다 - 새 메시지가 오거나 타임아웃
될 때까지 블로킹하는 명령으로, "이벤트가 올 때까지 막혀 있다가 돌아
오는 한 번의 툴 호출"로 실시간성과 턴 기반 실행 모델을 이어붙이는
패턴이다.

**`docs message recent <projectId> [--limit <n>]`**(기본 20)은 상태를
전혀 바꾸지 않는 순수 조회다 - 시스템/세션이 다운됐다가 복구됐을 때
"마지막으로 무슨 일이 있었는지"를 확인하는 용도로, 반복 호출해도
안전하다. 세션 시작 체크리스트 3번이 이 명령을 쓴다.

`docs message send <projectId> <body...>`로 메시지를 보낸다. 문서
편집 중 그 문서에 대한 "지시"를 남기고 싶으면(웹 UI의 "메시지로
지시" 버튼과 동일 동작) 메시지 본문 앞에 `[trackingCode]`를 붙여
보낸다 - 별도 API는 없고 관례일 뿐이지만, 웹 UI가 이 패턴의 추적
코드를 자동으로 클릭 가능한 링크로 렌더링한다.

## CLI/MCP에 의도적으로 없는 기능 (완전성 원칙의 예외)

아래 네 가지는 "누락"이 아니라 설계상 CLI/MCP 표면에 전혀 없다:

- **`auth register/login/logout`** - 비밀번호를 대화 컨텍스트에 남기지
  않기 위해 CLI 전용(`auth_whoami`만 MCP에 진단용으로 예외 노출).
- **코멘트(comment)** - 설계자들끼리만 공유하는 채널로, AI의 참고
  지표가 될 수 없다는 설계자 지시에 따라 CLI/MCP 어디에도 없다(웹
  UI에는 있음, 문서/소스 코드 파일/칸반 카드 세 대상 전부 동일). "왜
  코멘트 명령이 없지?"는 버그가 아니라 의도.
- **폴더(folder)** - 문서 정리용으로 DB에만 존재하는, 사람이 보기
  편하자고 만든 순수 공간적 분류 보조 수단이다(실제 git 파일 트리와
  무관). AI는 추적 코드/문서 타입으로 문서를 다루므로 이 개념 자체가
  필요 없다 - CLI/MCP 명령도, `document_list`/`document_get` 같은
  기존 응답의 필드도 폴더 정보를 전혀 담지 않는다. 웹 UI(문서 탭의
  폴더 트리)에서만 관리한다.
- **API 키 관리(`key create/list/revoke`)** - `auth register/login`과
  같은 급의 신원 관리 동작이라 CLI 전용이고 MCP엔 아예 없다(아래
  "인증" 절 참고) - AI 세션이 스스로 더 넓은/새로운 키를 만들거나
  남의 키를 배제할 수 있으면 안 된다는 설계 취지.
- **칸반 카드 코멘트** - 칸반 보드 자체(분류/카드 생성·조회·이동)는
  아래 표의 `kanban-*` 명령으로 AI에게 완전히 열려 있지만, 카드에
  달리는 코멘트만은 위 코멘트(comment)와 같은 채널(`targetType:
  "kanbanCard"`)이라 CLI/MCP에 없다 - 웹 UI에서만 작성/수정/삭제한다.

## 칸반 보드

프로젝트별 진행 흐름을 "분류(컬럼) → 카드" 구조로 추적한다. 컬럼은
설계자가 웹 UI에서 만들고(기본 pending/doing/qa/done), AI는 그 컬럼을
보고 작업 현황에 맞춰 카드를 만들거나(`kanban-card-new`) 다른 컬럼으로
옮긴다(`kanban-card-move`) - 카드는 그 판단의 근거가 된 문서를
`--refs`로 같이 태깅할 수 있다(질의의 `--refs`와 같은 패턴).

**설계자가 웹 UI에서 만든 카드는 그 즉시 이 프로젝트에 메시지로
알림이 온다**(`[KB-XXXXXXXX] 제목` 형식 - `docs message list`로 확인
가능) - 이 카드는 "반드시 진행되어야 하는 작업"으로 간주해야 한다.
세션을 시작하거나 새 메시지를 확인했을 때 이런 카드가 보이면,
`kanban-card-get <trackingCode>`로 내용을 확인하고 실행 계획을 세워
처리한 뒤 그 진행 상황에 맞게 `kanban-card-move`로 컬럼을 옮긴다.

## 명령 요약 (CLI `docs` / MCP 도구 이름 병기)

| 목적 | CLI | MCP 도구 |
|---|---|---|
| 문서 생성 | `docs new <projectId> <typeCode> --title <t> --body <file>` | `document_new` |
| 문서 조회 | `docs get <trackingCode>` | `document_get` |
| 문서 목록 | `docs list <projectId>` | `document_list` |
| 검색 | `docs search <projectId> <query>` | `document_search` |
| 본문 갱신 | `docs save <trackingCode> <file>` | `document_save` |
| 상태 전이 | `docs transition <trackingCode> <toStatusCode>` | `document_transition` |
| 다음 가능 상태 조회 | `docs next-statuses <trackingCode>` | `document_next_statuses` |
| 문서 삭제 | `docs delete <trackingCode>` | `document_delete` |
| 문서 링크 | `docs link <from> <to>` | `document_link` |
| 역참조 조회 | `docs backlinks <trackingCode>` | `document_backlinks` |
| 버전 이력 조회 | `docs revisions <trackingCode>` | `document_revisions` |
| 연관 소스코드 연결 | `docs link-source <trackingCode> <path>` | `document_link_source` |
| 연관 소스코드 해제 | `docs unlink-source <trackingCode> <linkId>` | `document_unlink_source` |
| 연관 소스코드 목록 | `docs source-links <trackingCode>` | `document_source_links` |
| 보고서 생성 | `docs report-new <projectId> --title <t> --body <file>` | `report_new` |
| 질의 등록(문서/칸반 카드, +참고 문서) | `docs question <trackingCode> <text> [--kind <approval\|answer>] [--refs <codes>]` | `question_add` |
| 질의 등록(소스 코드 파일) | `docs question-source <projectId> <path> <text> [--kind ...] [--refs ...]` | `question_add_source` |
| 대상의 전체 질의/답변(문서/칸반 카드) | `docs questions <trackingCode>` | `question_list` |
| 대상의 전체 질의/답변(소스 코드 파일) | `docs questions-source <projectId> <path>` | `question_list_source` |
| 답변 대기 목록(open+pending, 전체 대상) | `docs pending <projectId>` | `pending_list` |
| 답변 | `docs reply <questionTrackingCode> [answer] [--decision <approved\|rejected>] [--note <text>]` | `question_reply` |
| 질의 확인 완료 처리 | `docs question ack <trackingCode>` | `question_ack` |
| 본인 프로필 조회/whoami | `docs auth whoami` | `auth_whoami` |
| 본인 프로필 수정 | `docs profile set [옵션...]` | `profile_set` |
| 타 설계자 프로필 조회 | `docs user get <userId>` | `user_get` |
| 설계자 활동 이력 | `docs user activity <userId> [--limit <n>]` | `user_activity` |
| 프로젝트 숨김/해제 | `docs project-hide <projectId> --hidden <bool>` | `project_hide` |
| 팀장 등록/해제/목록 | `docs team-admin-add/team-admin-remove/team-admins` | `team_admin_add/remove/list` |
| 세부 권한 설정/조회 | `docs access-set ...` / `docs access-list <projectId>` | `access_set` / `access_list` |
| 표준 상태 흐름 일괄 적용 | `docs doctype-apply-standard-flow <projectId> <docTypeId>`(+`group-`/`team-`) | `doctype_apply_standard_flow`(+`_group`/`_team`) |
| 상태 코드 추가(표준 6개 중) | `docs doctype-status-add <projectId> <docTypeId> <code>`(+`group-`/`team-`) | `doctype_status_add`(+`_group`/`_team`) |
| 상태 전이 정의 | `docs doctype-transition-add <projectId> <docTypeId> <fromCode> <toCode>`(+`group-`/`team-`) | `doctype_transition_add`(+`_group`/`_team`) |
| 저장소 연결(생성/이주) | `docs git link <projectId> [--import-from <url>] [--credential <id>]` | `git_link` |
| 저장소 연결(외부 연동) | `docs git link-external <projectId> --provider <github\|gitlab> --url <url> [--credential <id>]` | `git_link_external` |
| 연결 정보 조회 | `docs git repo <projectId>` | `git_repo` |
| 동기화 상태 확인 | `docs git sync-status <projectId>` | `git_sync_status` |
| 동기화 제안 내보내기 | `docs git sync-proposal <projectId> [--out <dir>]` | `git_sync_proposal` |
| git 로그/diff/show | `docs git log/diff/show <projectId> [<sha>]` | `git_log`/`git_diff`/`git_show` |
| 디렉터리 목록 | `docs git tree <projectId> [--path <p>] [--ref <r>]` | `git_tree` |
| 파일 내용 조회 | `docs git cat <projectId> <path> [--ref <r>]` | `git_cat` |
| 파일 저장(커밋) | `docs git put <projectId> <path> <localFile> [--message <m>]` | `git_put` |
| 템플릿 배포 | `docs template deploy <projectId>` | `template_deploy` |
| 훅 프롬프트 생성/목록/삭제 | `docs hook create/list/delete` | `hook_create/list/delete` |
| 훅 대기열 조회/처리 | `docs hook queue/ack/done` | `hook_queue_list`/`hook_ack`/`hook_done` |
| 메시지 목록(읽으면 기록 전환) | `docs message list <projectId> [--status <s>]` | `message_list` |
| 메시지 전송 | `docs message send <projectId> <body...>` | `message_send` |
| 새 메시지 대기(블로킹) | `docs message wait <projectId> [--timeout <초>]` | `message_wait` |
| 최근 메시지(비파괴, 장애 복구용) | `docs message recent <projectId> [--limit <n>]` | `message_recent` |
| 마이그레이션 후보 스캔 | `docs migrate scan <sourceDir>` | `migrate_scan` |
| 마이그레이션 반영 | `docs migrate apply <projectId> <manifestFile>` | `migrate_apply` |
| 칸반 분류 목록 | `docs kanban-columns <projectId>` | `kanban_columns` |
| 칸반 카드 생성(+근거 문서) | `docs kanban-card-new <projectId> <columnId> <title> [--body <t>] [--refs <codes>]` | `kanban_card_new` |
| 칸반 카드 목록 | `docs kanban-cards <projectId> [--column <columnId>]` | `kanban_cards` |
| 칸반 카드 상세 | `docs kanban-card-get <trackingCode>` | `kanban_card_get` |
| 칸반 카드 이동 | `docs kanban-card-move <trackingCode> <toColumnId> [--index <n>]` | `kanban_card_move` |

## 가이디드 마이그레이션(옛 파일 기반 프로젝트 옮기기)

`docs migrate scan <sourceDir>`는 YAML frontmatter(`id`/`type`/`title`/
`status`/`links` 키)가 있는 옛 concept 스타일 마크다운 문서를 로컬
`sourceDir`에서 찾아 후보 목록을 JSON으로 출력한다(순수 로컬 동작 -
API 호출 없음). **이 출력을 바로 apply에 넘기지 않는다** - 먼저
`> manifest.json`으로 리다이렉트해 로컬 스크래치 파일로 저장한 뒤,
각 항목의 `docTypeCode`/`statusCode`가 대상 프로젝트에 실제로 존재하는
코드인지 확인하고(`docs doctypes <projectId>`로 대조), 안 맞으면
고치거나 `skip: true`로 제외한다 - 이게 "설계자가 확인할 기회"의
핵심이다. 다 정리한 뒤 `docs migrate apply <projectId> manifest.json`으로
반영한다. 결과의 `created`/`errors`/`warnings`를 그대로 설계자에게
보고한다(상태 전이 실패·이번 배치 밖 문서를 가리키는 링크는 에러가
아니라 경고로 옴 - 문서 자체는 만들어짐). **재실행은 멱등하지 않다** -
같은 매니페스트를 두 번 `apply`하면 문서가 중복 생성되므로, 성공/실패
여부를 확인하지 않고 재시도하지 않는다.

## git 저장소 연결(3가지 방식) + 동기화 제안

프로젝트에 git 저장소를 연결하는 방법은 세 가지다 - 전부 웹 UI(프로젝트
"설정" 탭)와 CLI/MCP 양쪽에서 가능:

1. **새 저장소 생성**: `docs git link <projectId>` - Gitea에 빈 저장소를
   만들고 연결한다.
2. **외부 저장소 완전 이주**: `docs git link <projectId> --import-from
   <url> [--credential <id>]` - 기존 저장소의 히스토리를 통째로 가져와
   Gitea 저장소로 독립적으로 시작한다(1회성 - 이후 원본과 관계 없음).
3. **외부 저장소 연동**: `docs git link-external <projectId> --provider
   <github|gitlab> --url <url> [--credential <id>]` - 외부 저장소가
   계속 권위(authoritative)를 갖는다. 관리 편의를 위해 Gitea에 미러
   (읽기 전용 pull 사본)와 작업 저장소(이 시스템이 실제로 커밋하는 곳)
   두 개를 만든다 - `git log/diff/show`/소스 에디터는 전부 작업
   저장소 기준으로 동작한다.

외부 저장소가 비공개라 인증이 필요하면 API가 명확한 에러로 알린다 -
`docs credential add --type token --value <토큰> [--host <패턴>]`로
자격증명을 먼저 등록해두고 `--credential <id>`로 넘기면 된다(웹 UI는
이 과정을 자동화 - 인증 실패 시 그 자리에서 자격증명을 입력받아 저장한
뒤 자동 재시도한다).

**동기화 제안**(옵션 3으로 연동한 프로젝트 전용) - 이 시스템의 편집은
작업 저장소에 쌓일 뿐 외부(권위) 저장소에 자동으로 반영되지 않는다.
`docs git sync-status <projectId>`로 미러 대비 작업 저장소가 뭐가
달라졌는지 확인한다(Gitea의 미러 동기화가 비동기라 요청 후 완료될 때
까지 명령이 자동으로 기다렸다가 결과를 보여준다). 달라진 파일을 실제로
가져오려면 `docs git sync-proposal <projectId> --out <dir>`로 로컬
디렉터리에 받아, 거기서 직접 커밋·PR을 진행한다(자동 PR 생성은 지원
안 함 - 항상 설계자 검토를 거치도록 의도한 설계).

`git log/diff/show`는 자체 호스팅 저장소(옵션 1/2) 또는 외부 연동
(옵션 3)이 연결된 프로젝트에서 동작한다 - 아직 연결 안 된 프로젝트는
먼저 위 세 방법 중 하나로 연결해야 한다.
**`git blame`은 지원하지 않는다** - Gitea REST API 자체에 blame
엔드포인트가 없어서(알려진 플랫폼 제한, 임의 추측이 아니라 실제 Gitea
인스턴스에 대고 확인함) 호출하면 그 사실을 알리는 명확한 에러가 온다 -
파일의 변경 이력은 `git log`/`git diff`/`git show`로 대신 확인한다.

## 인증

MCP 도구는 CLI가 `docs auth login`으로 저장한 것과 같은 자격증명
파일(`~/.claude-native-workflow/credentials.json`)을 공유한다 - 설계자가
미리 한 번 로그인해두면 MCP 세션에서 별도 로그인 없이 바로 쓸 수 있다.
비밀번호가 대화 컨텍스트에 남지 않도록 `auth register/login`은 MCP
도구로 노출되지 않는다(CLI로만 수행) - `auth_whoami`만 진단용으로
예외적으로 제공된다.

### API 키(신원 위임 인증, 3종)

아이디/비밀번호 로그인 대신, 설계자가 미리 발급해둔 **API 키**
(`cnwk_...`)로 CLI/MCP를 인증할 수도 있다 - `docs auth use-key --api
<url> --key <cnwk_...>`로 한 번 저장해두면 그 뒤로는 로그인/갱신 없이
계속 쓸 수 있다(키 자체가 최종 자격증명이라 만료가 없음 - 배제되기
전까지 유효). 키는 항상 **그 키를 만든 설계자의 신원을 그대로
대행**하지만, 종류에 따라 접근 가능한 범위가 다르다:

| 종류 | 만들 수 있는 사람 | 접근 범위 |
|---|---|---|
| 팀 관리 키 | 그 팀의 팀장 | 그 팀 소속 모든 프로젝트 |
| 프로젝트 개인 키 | 그 프로젝트 멤버(역할 무관) | 그 프로젝트 하나만 |
| 개인 키 | 누구나 | 로그인과 동등 - 접근 가능한 모든 프로젝트 |

**범위가 있는 키(팀/프로젝트)로는 신원 자체를 다루는 동작(본인 프로필
수정, git 자격증명, 팀/그룹/프로젝트 생성, 키 관리 자체)을 할 수
없다** - 좁은 범위의 키가 유출돼도 그걸로 더 넓은 권한의 새 키를
만들거나 다른 키를 배제하는 권한 상승을 막기 위한 설계다. 이 동작들이
막혔다면 `docs auth login`으로 다시 로그인하거나 "개인 키"를 쓴다.

키 관리(`docs key create/list/revoke`)는 CLI 전용이고 MCP엔 없다(위
"CLI/MCP에 의도적으로 없는 기능" 절 참고) - AI 세션이 알아서 키를
만들거나 지우는 일은 없어야 한다. 키를 새로 만들 필요가 있으면
설계자에게 요청한다. `docs key create`의 응답에 담긴 실제 키 값은
**그 순간 한 번만** 나오고 DB에 원문이 저장되지 않아 이후엔 그
누구도(만든 사람 본인 포함) 다시 조회할 수 없다 - 화면/터미널
출력을 그대로 로그에 남기거나 대화에 복사하지 않는다. `docs key
revoke <id>`는 "삭제"가 아니라 "배제"(soft revoke) - 그 키는 즉시
못 쓰게 되지만 기록(누가 언제 어떤 범위로 발급했었는지)은 감사용으로
남는다.
