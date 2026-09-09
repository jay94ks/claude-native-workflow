---
name: docs-cli
description: claude-native-workflow 평범(Tier 2) 프로젝트에서 docs/ 설계 문서를 조회·생성·편집·답변 처리하고 git과 동기화할 때, MCP 도구를 우선 쓰고 없으면 docs CLI로 폴백하는 방법을 안내한다.
when_to_use: 이 프로젝트가 claude-native-workflow 평범(Tier 2)로 배포되어 있음을 CLAUDE.md나 설계자의 말로 알게 됐을 때, 또는 docs/ 문서 작업 프롬프트를 받았을 때 이 Skill을 따른다.
---

# docs CLI/MCP로 Tier 2 문서 워크플로우 다루기

이 프로젝트는 claude-native-workflow **평범(Tier 2)**로 배포되어 있다.
`docs/` 문서 포맷·타입 분류·추적 번호·PL→DN 전환 같은 규칙은
`docs/PROTOCOL.md`([초간단 등급과 동일](https://github.com/jay94ks/claude-native-workflow/blob/main/tier1/docs/PROTOCOL.md))와
완전히 같다. **다른 점은 그 규칙을 실행하는 방법뿐이다** — Tier 2에서는
로컬 Node 백엔드 하나가 `docs/` 조작 로직을 갖고 있고, MCP 서버·CLI·
대시보드가 전부 그 백엔드를 호출한다. 그래서 `docs/*.md` 파일을 직접
열어서 고치는 대신, 아래 우선순위로 다룬다.

## 우선순위: MCP 우선, CLI 폴백

**이 프로젝트에 `claude-native-workflow-docs`라는 이름의 MCP 서버가
등록되어 있으면 그 도구들(`docs_*`/`git_*`)을 우선 쓴다.** 등록되어
있지 않으면(또는 MCP 도구 호출이 안 되는 환경이면) Bash로 `docs` CLI를
호출하는 경로로 폴백한다. 두 경로 다 같은 로컬 백엔드(`core/`)를
그대로 타므로 결과는 항상 동일하다 — 어느 쪽을 쓰든 아래 절차는 같다.

CLI를 쓸 때, 프로젝트 루트(= `docs/`의 부모 디렉터리)가 현재 작업
디렉터리가 아니면 모든 명령에 `--root <프로젝트 루트>`를 붙인다.

## 대화 시작 시 확인할 것

`docs/PROTOCOL.md` 7절과 동일 — 미답변 질문이 있으면 먼저 알려준다.

- MCP: `docs_pending`
- CLI: `docs pending`

## 문서 조회

- MCP: `docs_tree`(전체 트리) · `docs_get`(`path`, 선택적 `anchor`) ·
  `docs_list`(`kind`: design/logs/all) · `docs_search`(`query`)
- CLI: `docs tree` · `docs get <path>` · `docs design` · `docs logs`
  (`docs list --type <타입>`은 임의 타입 조합 조회) · `docs all` ·
  `docs search <query>`(전문 검색)

기존 문서를 고치기 전엔 반드시 먼저 현재 내용을 읽는다 — 아래 "문서
본문 편집"이 본문 전체를 덮어쓰기 때문에, 현재 상태를 모르고 쓰면 기존
내용이 날아간다.

## 새 문서 생성

- MCP: `docs_new`(`type`, `title`, 선택적 `links`)
- CLI: `docs new <TYPE> --title "<제목>" [--links SP-00001,DC-00002]`

`TYPE`은 `docs/PROTOCOL.md` 1절의 SP/PL/DS/RM/TP/DC/RV/FX 중 하나(`DN`/`LG`/`RP`는
직접 생성하지 않음 — 각각 5절 전환 절차, 6절 처리 기록, 6절 답변 기록으로만
생김). 추적 번호 발급과 색인 등재는 백엔드가 처리하므로 **번호를 직접
지어내지 않는다** — 응답으로 온 `id`/`path`를 그대로 쓴다. 성공 직후 자동으로
git commit(+설정에 따라 push)까지 된다(아래 "git 동기화" 참고).

## 문서 본문 편집

- MCP: `docs_save`(`path`, `body`)
- CLI: `docs save <path> <로컬 파일 경로>`(파일 내용을 그대로 본문으로 씀)

**본문(body)만 넘긴다 — 프론트매터(맨 위 `---...---` 블록)는 절대 포함하지
않는다.** `docs_get`/`docs get`이 돌려주는 `body` 필드가 정확히 이 명령이
기대하는 형식이다(프론트매터가 이미 분리되어 있음). 프론트매터를 그대로
포함해서 넘기면 저장된 파일 안에 프론트매터 블록이 두 번 겹쳐 들어가
문서가 깨진다 — 프론트매터(`id`/`type`/`status`/`updated`/`links` 등)는
백엔드가 별도로 관리하며 이 명령이 건드리지 않는다.

**다른 쓰기 명령과 달리 이 명령은 git 자동 커밋을 하지 않는다.** 반영이
끝나면 이어서 `git commit`/`git sync`를 직접 호출한다(아래 참고). `DC`/
`RV`/`FX` 문서에 답변 대기 질문을 추가하는 것도 이 명령으로 한다(질문
추가 자체는 백엔드가 자동화해주지 않음 — `docs/PROTOCOL.md` 4절 형식을
직접 지켜서 써야 함).

## 답변 처리

- MCP: `docs_reply`(`path`, `question_id`, `answer`)
- CLI: `docs reply <path> <questionId> <답변 내용...>`

`docs/PROTOCOL.md` 6절의 RP 발급·`## 답변 기록` 섹션 추가·`docs/reply/` 큐
제거·`LG` 로그 기록을 백엔드가 전부 자동으로 처리한다 — 이 흐름을
"문서 본문 편집"으로 손수 흉내 내지 않는다. 성공 직후 자동 git commit(+push).

## PL → DN 전환

- MCP: `docs_transition_done`(`plan_id`, `report`)
- CLI: `docs transition-done <planId> --report "<완료 결과 보고>"`

`docs/PROTOCOL.md` 5절 절차(`DN` 신설 + 원본 `PL` 스텁화 + 색인 갱신)를
백엔드가 처리한다. 성공 직후 자동 git commit(+push).

## git 동기화

- MCP: `git_sync`(선택적 `message`) — pull → commit → push를 한 번에.
  이력 조회는 `git_log`(`action`: log/show/diff/blame).
- CLI: `docs git pull` / `docs git commit [-m "..."]` / `docs git push` /
  `docs git sync [-m "..."]` / `docs git log [--path] [--limit]` /
  `docs git diff <sha>` / `docs git blame <path>` / `docs git show <sha>`

`docs new`/`docs reply`/`transition-done`은 성공할 때마다 이미 자동으로
`docs/`를 커밋한다(설정에 따라 push까지) — 수동 `git commit`은 "문서 본문
편집"(자동 커밋 없음) 뒤나 그 밖에 커밋 안 된 변경이 남아있을 때 쓴다.
**세션을 시작할 때는 `git pull`(또는 `git_sync`)을 먼저 실행**해서 다른
설계자나 다른 기기의 변경을 반영한 뒤 작업을 시작한다. `pull`이 충돌을
만나면 자동 병합하지 않고 그대로 보고만 한다 — 그 상태로 설계자에게
알린다.

## 코멘트 (비공식 토론)

- MCP: `docs_comment`(`action`: list/add/resolve, `path`, 선택적 `text`/
  `comment_id`)
- CLI: `docs comment list <path>` / `docs comment add <path> <text...>` /
  `docs comment resolve <path> <commentId>`

`docs/PROTOCOL.md`의 공식 답변 대기(`DC`/`RV`/`FX`의 `RP`)와는 별개인,
문서 단위의 가벼운 토론 스레드다.

## 변경 추적 큐

- MCP: `docs_changes`(`action`: list/ack, 선택적 `id`)
- CLI: `docs changes` / `docs changes ack <id>`

내가 없는 사이(다른 설계자의 git push, 직접 파일 편집 등) `docs/`가
바뀌었으면 여기 쌓인다. 대화 시작 시나 "문서 변경사항 확인해줘" 같은
프롬프트를 받으면 먼저 조회하고, 확인한 항목은 `ack`로 큐에서 지운다.

## 명령 전체 목록

| MCP 도구 | CLI | 설명 |
|---|---|---|
| `docs_tree` | `docs tree` | 문서 트리 |
| `docs_get` | `docs get <path>` | 문서 1건 조회 |
| `docs_pending` | `docs pending` | 답변 대기 목록 |
| `docs_list` | `docs design` / `docs logs` / `docs all` / `docs list --type <T>` | 타입별 목록 |
| `docs_search` | `docs search <query>` | 전문 검색 |
| `docs_new` | `docs new <type> --title <t> [--links <ids>]` | 새 문서 생성 |
| `docs_save` | `docs save <path> <file>` | 문서 본문 갱신(자동 커밋 없음) |
| `docs_reply` | `docs reply <path> <qid> <답변...>` | 답변 대기 질문에 답변 |
| `docs_transition_done` | `docs transition-done <planId> --report <r>` | PL → DN 전환 |
| `git_sync` | `docs git sync [-m <msg>]` | pull → commit → push |
| (git_sync로 대체) | `docs git pull` / `commit` / `push` | 개별 git 동작 |
| `git_log` | `docs git log` / `diff <sha>` / `blame <path>` / `show <sha>` | git 이력/diff/blame(읽기 전용) |
| `docs_comment` | `docs comment list/add/resolve <path> ...` | 문서 코멘트 |
| `docs_changes` | `docs changes` / `docs changes ack <id>` | 변경 추적 큐 |
| (없음, CLI 전용) | `docs db enable --driver <d> --connection <json>` / `docs db disable [--drop]` | 선택적 서비스 DB 전환 |
| (없음, CLI 전용) | `docs validate` | `docs/` 구조 검증 |

`db`/`validate`는 데이터 이관·구조 점검 성격상 API/MCP에 노출되지 않고
CLI 전용이다 — 설계자가 직접 터미널에서 실행하도록 안내한다.
