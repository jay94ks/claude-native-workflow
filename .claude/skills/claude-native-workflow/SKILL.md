---
name: claude-native-workflow
description: claude-native-workflow로 관리되는 프로젝트에서 문서/설계 기록을 읽고 쓸 때 사용한다. docs CLI와 MCP 도구로 프로젝트 문서, 질의/답변, 코멘트, 보고서를 다루는 방법을 안내한다.
---

# claude-native-workflow

이 프로젝트의 문서/설계 기록은 파일이 아니라 claude-native-workflow
시스템의 DB에 저장된다. 모든 읽기/쓰기는 `docs` CLI 명령 또는 이 스킬과
함께 등록된 MCP 도구로만 한다 - DB/파일을 직접 건드리는 우회 경로는
없다.

## 반드시 지켜야 하는 두 가지 규칙

1. **추적 코드 명시**: 문서, 질의(Question), 답변을 언급하거나 제안할
   때는 항상 정확한 추적 코드(`XX-XXXXXXXX` - 영문 2글자 + hex 8글자)를
   함께 적는다. 기본 문서 종류: `SP`(설계 명세), `DC`(결정 요구사항 및
   요청), `PL`(실행 계획), `PD`(실행 결과 보고), `RM`(지시 사항/지침),
   `DS`(설계 결정), 질의는 `QU`. 예: "QU-B2C3D4E5에 대한 답변으로
   SP-A1B2C3D4를 갱신했다."
2. **로컬 스크래치 사본은 git 커밋 금지**: 문서를 편집할 때 로컬 임시
   파일로 복사해 Edit/Write 도구로 다듬은 뒤 `docs save`로 다시 올리는
   건 정상 작업 방식이다. 단 이 임시 파일을 프로젝트의 git 저장소에
   커밋하지 않는다(문서 정본은 시스템 DB).

## 문서 타입 / 상태 흐름

새 프로젝트는 기본으로 여섯 타입을 갖고 시작한다 - 코드에 고정된
목록이 아니라 관리자가 자유롭게 추가/수정할 수 있다:

| 코드 | 이름 | 상태 흐름 |
|---|---|---|
| `SP` | 설계 명세 | draft → active → archived(종료) |
| `DC` | 결정 요구사항 및 요청 | open → answered → applied(종료) |
| `PL` | 실행 계획 | draft → active → done(종료) |
| `PD` | 실행 결과 보고 | final(단일 종료 상태) |
| `RM` | 지시 사항/지침 | active → archived(종료) |
| `DS` | 설계 결정 | open → decided(종료) | `doctype-create <projectId> <code> <label>`은
프로젝트 스코프, `group-doctype-create <groupId> <code> <label>`/
`team-doctype-create <teamId> <code> <label>`은 그
그룹/팀 소속 모든 프로젝트가 상속받는 공용 타입을 만든다(`docs
new <projectId> <code> ...`나 `docs doctypes <projectId>`에서 프로젝트
자신의 타입과 구분 없이 그대로 쓰인다 - project → group → team
순으로 찾음, 더 구체적인 스코프가 우선). 문서 상태를 바꿀 땐 `docs
transition <trackingCode> <toStatusCode>`를 쓰되, 그 문서 타입에
정의된 전이만 허용된다.

**새로 만든 타입은 상태가 0개라 그대로는 문서를 만들 수 없다** -
`*-doctype-create` 직후 최소 하나는 상태 추가 명령으로 상태를 붙여야
한다: 프로젝트 스코프는 `docs doctype-status-add <projectId>
<docTypeId> <code> <label> [--terminal]`(`doctype_status_add`), 그룹
스코프는 `docs group-doctype-status-add <groupId> <docTypeId> <code>
<label> [--terminal]`(`doctype_status_add_group`), 팀 스코프는 `docs
team-doctype-status-add <teamId> <docTypeId> <code>
<label> [--terminal]`(`doctype_status_add_team`). 상태 사이
이동을 허용하려면 같은 스코프 짝의 `*-doctype-transition-add
<...스코프id> <docTypeId> <fromCode> <toCode> [--label <l>]`로 전이를
정의한다(정의 안 한 전이는 `docs transition`이 거부한다 - 스코프와
무관하게 항상 같은 명령). 지금까지 만든 전이를 확인하려면 `docs
doctype-transitions <아무값> <docTypeId>`(`doctype_transitions`,
첫 인자는 안 쓰임 - docTypeId만으로 스코프 상관없이 조회됨).

타입 생성 시(`*-doctype-create ... --guideline "<설명>"`) 또는 나중에
(`docs doctype-guideline-set <projectId> <docTypeId> <설명...>`, 그룹/
팀 스코프는 `group-doctype-guideline-set`/`team-doctype-
guideline-set`) 그 타입이 "무엇을 하기 위한 것인지" 자연어 설명을
붙일 수 있다 - `docs doctypes <projectId>` 응답의 `guideline` 필드로
조회되며, 웹 UI 문서 생성 화면에서 힌트로도 보인다.

## 세션을 시작하거나 이 프로젝트를 다시 열 때

`docs hook queue <projectId> --status pending`으로 대기 중인 push 훅이
있는지 먼저 확인한다. 설계자가 git push 훅 프롬프트를 등록해뒀다면
(`docs hook create`), push가 있을 때마다 이 대기열에 항목이 쌓인다 -
서버가 알아서 세션을 실행해주지 않으므로, 다음에 그 프로젝트를 여는
세션이 직접 확인하고 처리해야 한다. 처리를 시작할 땐 `docs hook ack
<projectId> <id>`, 끝나면 `docs hook done <projectId> <id>`로 상태를
갱신한다.

## 질의/답변(Question/Answer) 루프

설계자에게 확인이 필요한 사항은 문서 본문에 체크리스트로 묻어두지 않고
`docs question <trackingCode> <질문 내용>`으로 정식 질의를 만든다 -
`QU-XXXXXXXX` 추적 코드가 발급된다. 답변 대기 목록은 `docs pending
<projectId>`, 답변 처리는 `docs reply <questionTrackingCode> <답변>`,
문서 하나의 전체 질의/답변 스레드(열림+답변완료 전부)는 `docs questions
<trackingCode>`로 조회한다. 문서의 모든 질의가 답변되면, 그 문서
타입에 유일하게 허용된 다음 상태가 있을 경우 문서 상태가 자동으로
전이된다(모호하면 자동 전이하지 않고 `docs transition`으로 직접
지정). 웹 UI에서도 문서 에디터 화면(`/projects/:id/documents/
:trackingCode`)에 질의/답변 + 코멘트 패널이 있어 CLI 없이도 이 루프를
그대로 쓸 수 있다(질의/답변/코멘트 쓰기는 전부 editor 이상 권한 필요 -
viewer는 조회만).

## 명령 요약 (CLI `docs` / MCP 도구 이름 병기)

| 목적 | CLI | MCP 도구 |
|---|---|---|
| 문서 생성 | `docs new <projectId> <typeCode> --title <t> --body <file>` | `document_new` |
| 문서 조회 | `docs get <trackingCode>` | `document_get` |
| 문서 목록 | `docs list <projectId>` | `document_list` |
| 검색 | `docs search <projectId> <query>` | `document_search` |
| 본문 갱신 | `docs save <trackingCode> <file>` | `document_save` |
| 상태 전이 | `docs transition <trackingCode> <toStatusCode>` | `document_transition` |
| 문서 링크 | `docs link <from> <to>` | `document_link` |
| 역참조 조회 | `docs backlinks <trackingCode>` | `document_backlinks` |
| 버전 이력 조회 | `docs revisions <trackingCode>` | `document_revisions` |
| 보고서 생성 | `docs report-new <projectId> --title <t> --body <file>` | `report_new` |
| 질의 등록 | `docs question <trackingCode> <text>` | `question_add` |
| 문서의 전체 질의/답변 | `docs questions <trackingCode>` | `question_list` |
| 답변 대기 목록 | `docs pending <projectId>` | `pending_list` |
| 답변 | `docs reply <questionTrackingCode> <answer>` | `question_reply` |
| 코멘트 | `docs comment list/add/resolve` | `comment_list/add/resolve` |
| 저장소 연결(생성/이주) | `docs git link <projectId> [--import-from <url>] [--credential <id>]` | `git_link` |
| 저장소 연결(외부 연동) | `docs git link-external <projectId> --provider <github\|gitlab> --url <url> [--credential <id>]` | `git_link_external` |
| 연결 정보 조회 | `docs git repo <projectId>` | `git_repo` |
| 동기화 상태 확인 | `docs git sync-status <projectId>` | `git_sync_status` |
| 동기화 제안 내보내기 | `docs git sync-proposal <projectId> [--out <dir>]` | `git_sync_proposal` |
| git 로그 | `docs git log <projectId>` | `git_log` |
| git diff | `docs git diff <projectId> <sha>` | `git_diff` |
| git show | `docs git show <projectId> <sha>` | `git_show` |
| 디렉터리 목록 | `docs git tree <projectId> [--path <p>] [--ref <r>]` | `git_tree` |
| 파일 내용 조회 | `docs git cat <projectId> <path> [--ref <r>]` | `git_cat` |
| 파일 저장(커밋) | `docs git put <projectId> <path> <localFile> [--message <m>]` | `git_put` |
| 템플릿 배포 | `docs template deploy <projectId>` | `template_deploy` |
| 훅 프롬프트 생성 | `docs hook create <projectId> --prompt <file> [--branch <b>]` | `hook_create` |
| 훅 프롬프트 목록/삭제 | `docs hook list/delete <projectId> [<id>]` | `hook_list`/`hook_delete` |
| 훅 대기열 조회 | `docs hook queue <projectId> [--status <s>]` | `hook_queue_list` |
| 훅 처리 시작/완료 | `docs hook ack/done <projectId> <id>` | `hook_ack`/`hook_done` |
| 인스턴스 메시지 목록 | `docs message list <projectId>` | `message_list` |
| 인스턴스 메시지 전송 | `docs message send <projectId> <body...>` | `message_send` |
| 새 메시지 대기 | `docs message wait <projectId> [--timeout <초>]` | `message_wait` |
| 마이그레이션 후보 스캔 | `docs migrate scan <sourceDir>` | `migrate_scan` |
| 마이그레이션 반영 | `docs migrate apply <projectId> <manifestFile>` | `migrate_apply` |

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

## 인스턴스 메시지로 다른 세션/설계자와 소통하기

`message send`는 같은 프로젝트를 다루는 다른 클로드 세션이나 설계자에게
메시지를 남긴다. `message list`는 지금까지의 메시지 기록을 조회한다.
**설계자가 "답변을 추적하면서 처리해줘"처럼 지시했을 때는, 답을 기다리는
동안 `message wait <projectId> [--timeout <초>]`를 호출한다** - 새
메시지가 오거나 타임아웃될 때까지 그 툴 호출 하나가 반환하지 않고
블로킹한다(내부적으로 EMQX 구독을 걸어두고 있다가 반환 - 폴링이
아니다). 반환되면 그 메시지를 보고 워크플로우대로 처리를 이어간다 -
클로드는 상시 이벤트 루프를 못 돌리니, "이벤트가 올 때까지 막혀 있다가
돌아오는 한 번의 툴 호출"로 실시간성과 턴 기반 실행 모델을 이어붙이는
패턴이다.

## 인증

MCP 도구는 CLI가 `docs auth login`으로 저장한 것과 같은 자격증명
파일(`~/.claude-native-workflow/credentials.json`)을 공유한다 - 설계자가
미리 한 번 로그인해두면 MCP 세션에서 별도 로그인 없이 바로 쓸 수 있다.
비밀번호가 대화 컨텍스트에 남지 않도록 `auth register/login`은 MCP
도구로 노출되지 않는다(CLI로만 수행) - `auth_whoami`만 진단용으로
예외적으로 제공된다.
