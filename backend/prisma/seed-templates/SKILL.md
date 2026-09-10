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
   함께 적는다. 문서 종류: `SP`(설계 명세), `DC`(결정 요청),
   `DN`(결과 보고), 질의는 `QU`. 예: "QU-B2C3D4E5에 대한 답변으로
   SP-A1B2C3D4를 갱신했다."
2. **로컬 스크래치 사본은 git 커밋 금지**: 문서를 편집할 때 로컬 임시
   파일로 복사해 Edit/Write 도구로 다듬은 뒤 `docs save`로 다시 올리는
   건 정상 작업 방식이다. 단 이 임시 파일을 프로젝트의 git 저장소에
   커밋하지 않는다(문서 정본은 시스템 DB).

## 문서 타입 / 상태 흐름

새 프로젝트는 기본으로 `SP`(설계 명세: draft→active→archived),
`DC`(결정 요청: open→answered→applied), `DN`(결과 보고: 단일 종료
상태) 세 타입을 갖고 시작한다. 관리자가 `doctype-create`로 프로젝트/
그룹/기관 단위 타입을 자유롭게 추가할 수 있다 - 코드에 고정된 목록이
아니다. 문서 상태를 바꿀 땐 `docs transition <trackingCode>
<toStatusCode>`를 쓰되, 그 문서 타입에 정의된 전이만 허용된다.

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
<projectId>`, 답변 처리는 `docs reply <questionTrackingCode> <답변>`.
문서의 모든 질의가 답변되면, 그 문서 타입에 유일하게 허용된 다음 상태가
있을 경우 문서 상태가 자동으로 전이된다(모호하면 자동 전이하지 않고
`docs transition`으로 직접 지정).

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
| 답변 대기 목록 | `docs pending <projectId>` | `pending_list` |
| 답변 | `docs reply <questionTrackingCode> <answer>` | `question_reply` |
| 코멘트 | `docs comment list/add/resolve` | `comment_list/add/resolve` |
| 저장소 연결(자체 호스팅) | `docs git link <projectId>` | `git_link` |
| 저장소 연결(외부) | `docs git link-external <projectId> --provider <github\|gitlab> --url <url>` | `git_link_external` |
| 연결 정보 조회 | `docs git repo <projectId>` | `git_repo` |
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

`git log/diff/show`는 자체 호스팅(Gitea) 저장소가 연결된 프로젝트에서만
동작한다 - 먼저 `git link`로 연결해야 하고, 외부 GitHub/GitLab로 연결한
프로젝트에서는 "자체 호스팅만 지원"이라는 명확한 400이 온다.
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
