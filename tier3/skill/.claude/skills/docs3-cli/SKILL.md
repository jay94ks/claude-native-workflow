---
name: docs3-cli
description: claude-native-workflow 고급(Tier 3) 프로젝트에서 docs/ 설계 문서를 조회·생성·편집·답변 처리하고 git과 동기화할 때, 로컬 파일을 직접 건드리지 않고 docs3 REST CLI로 하는 방법을 안내한다.
when_to_use: 이 프로젝트가 claude-native-workflow 고급(Tier 3)로 배포되어 있음을 CLAUDE.md나 설계자의 말로 알게 됐을 때, 또는 docs/ 문서 작업 프롬프트를 받았는데 로컬에 docs/ 디렉터리 대신 Tier 3 서버 주소(API_BASE)와 프로젝트 ID만 주어졌을 때 이 Skill을 따른다.
---

# docs3 CLI로 Tier 3 문서 워크플로우 다루기

이 프로젝트는 claude-native-workflow **고급(Tier 3)**로 배포되어 있다.
`docs/` 문서 포맷·타입 분류·추적 번호·PL→DN 전환 같은 규칙은
`docs/PROTOCOL.md`([초간단/평범 등급과 동일](https://github.com/jay94ks/claude-native-workflow/blob/main/tier1/docs/PROTOCOL.md))와
완전히 같다. **다른 점은 그 규칙을 실행하는 방법뿐이다** — Tier 3에서는
`docs/` 원본이 클라우드 서버가 관리하는 git 저장소에 있고, 여러 설계자가
동시에 접근하며, 커밋 이력에 실제 요청자 신원이 남아야 한다. 그래서 로컬
파일을 직접 만들거나 고치는 대신 **항상 `docs3` CLI를 통해서만** 문서를
다룬다 — 서버가 번호 발급·프론트매터 검증·git 커밋(요청자 이름으로)까지
전부 대신 해주므로, 그 경로를 우회하면 안 된다.

## 로그인

```bash
docs3 login --api <서버 주소> --username <아이디 또는 이메일> --password <비밀번호>
```

`--password`를 생략하면 `DOCS3_PASSWORD` 환경변수를 쓴다(대화에 비밀번호를
직접 노출하지 않으려면 이쪽을 권장). 토큰은 설계자 홈 디렉터리의
`~/.claude-native-workflow/credentials.json`(권한 600)에 저장되고, 이후
모든 `docs3` 명령이 이 파일을 자동으로 읽는다 — **이 파일이나 토큰을
프로젝트 git 저장소 안으로 복사하거나 커밋하지 않는다**(SP-00002 2절).
`docs3 whoami`로 로그인 상태를 확인하고, 세션을 끝낼 때는 `docs3 logout`으로
서버 쪽 refresh token까지 폐기한다.

## 프로젝트 ID 확인

`<projectId>`가 필요한 모든 명령 앞에 먼저 실행:

```bash
docs3 projects
```

내가 속한 프로젝트 목록(id/이름/역할)이 나온다. 설계자가 어떤 프로젝트를
말하는지 애매하면 이 목록을 보여주고 확인받는다. 새 프로젝트를 만들 땐
`docs3 project-create --name <이름> --repo <git 저장소 URL>`(생성자가 자동으로
owner가 된다).

## 대화 시작 시 확인할 것

`docs/PROTOCOL.md` 7절과 동일 — 미답변 질문이 있으면 먼저 알려준다:

```bash
docs3 pending <projectId>
```

## 문서 조회

```bash
docs3 tree <projectId>              # 전체 트리
docs3 doc <projectId> <path>        # 문서 1건(프론트매터 + 본문)
```

기존 문서를 고치기 전엔 반드시 `docs3 doc`으로 현재 내용을 먼저 읽는다 —
아래 `save`가 본문 전체를 덮어쓰기 때문에, 현재 상태를 모르고 쓰면 기존
내용이 날아간다.

## 새 문서 생성

```bash
docs3 new <projectId> <TYPE> --title "<제목>" [--links SP-00001,DC-00002]
```

`TYPE`은 `docs/PROTOCOL.md` 1절의 SP/PL/DS/RM/TP/DC/RV/FX 중 하나(`DN`/`LG`/`RP`는
직접 생성하지 않음 — 각각 5절 전환 절차, 6절 처리 기록, 6절 답변 기록으로만
생김). 추적 번호 발급과 색인 등재는 서버가 처리하므로 **번호를 직접
지어내지 않는다** — 응답으로 온 `id`/`path`를 그대로 쓴다.

## 문서 본문 편집

```bash
docs3 save <projectId> <path> <로컬 파일 경로>
```

로컬 파일의 내용을 그대로 문서 **본문**에 덮어쓴다 — **프론트매터(맨 위
`---...---` 블록)는 이 파일에 넣지 않는다.** `docs3 doc`이 돌려주는
`body` 필드가 정확히 이 명령이 기대하는 형식이다(프론트매터가 이미
분리되어 있음). 프론트매터를 그대로 포함해서 넘기면 저장된 파일 안에
프론트매터 블록이 두 번 겹쳐 들어가 문서가 깨진다 — 프론트매터(`id`/
`type`/`status`/`updated`/`links` 등)는 서버가 별도로 관리하며 이 명령이
건드리지 않는다. 절차: `docs3 doc`으로 현재 `body`를 받아 → 로컬 파일에
**본문만** 저장 → 필요한 부분만 고쳐 씀(`docs/PROTOCOL.md` 4절 형식으로
"## 답변 대기" 항목 추가 등) → `docs3 save`로 반영. `DC`/`RV`/`FX` 문서에
답변 대기 질문을 추가하는 것도 이 명령으로 한다(질문 추가 자체는 서버가
자동화해주지 않음 — 4절 형식을 직접 지켜서 써야 함).

## 답변 처리

```bash
docs3 reply <projectId> <path> <questionId> <답변 내용...>
```

`docs/PROTOCOL.md` 6절의 RP 발급·`## 답변 기록` 섹션 추가·`docs/reply/` 큐
제거·`LG` 로그 기록을 서버가 전부 자동으로 처리한다 — 이 흐름을 `save`로
손수 흉내 내지 않는다.

## PL → DN 전환

```bash
docs3 transition-done <projectId> <planId> --report "<완료 결과 보고>"
```

`docs/PROTOCOL.md` 5절 절차(`DN` 신설 + 원본 `PL` 스텁화 + 색인 갱신)를
서버가 처리한다.

## git 동기화

```bash
docs3 git commit <projectId> [-m "<메시지>"]
docs3 git push <projectId>
docs3 git pull <projectId>
```

위의 `new`/`save`/`reply`/`transition-done`은 **호출할 때마다 이미 자동으로
커밋**된다(요청자 본인 이름으로 — 감사 이력이 실제 신원을 남기는 게
SP-00002의 핵심 요구사항이므로 대신 커밋해주지 않는다). `git commit`은
그 밖에 커밋 안 된 변경이 남아있을 때만 의미가 있다. **세션을 시작할 때는
`git pull`을 먼저 실행**해서 다른 설계자가 git 경로(clone→직접 편집→push)로
만든 변경을 반영한 뒤 작업을 시작한다 — Tier 3는 REST API 경로와 git 직접
경로 둘 다 동시에 지원하므로, 다른 설계자가 지금 이 순간 저장소를 직접
건드리고 있을 수 있다.

## 멤버 관리(owner만)

```bash
docs3 members <projectId>
docs3 invite <projectId> --email <이메일> --role viewer|editor|owner
```

## 명령 전체 목록

| 명령 | 설명 |
|---|---|
| `docs3 login --api <url> --username <u> [--password <p>]` | 로그인, 토큰 저장 |
| `docs3 logout` | 로그아웃(서버 토큰 폐기 + 로컬 삭제) |
| `docs3 whoami` | 로그인 상태 확인 |
| `docs3 projects` | 내 프로젝트 목록 |
| `docs3 project-create --name <n> --repo <url>` | 새 프로젝트 등록 |
| `docs3 members <projectId>` | 멤버 목록 |
| `docs3 invite <projectId> --email <e> --role <r>` | 멤버 초대(owner만) |
| `docs3 tree <projectId>` | 문서 트리 |
| `docs3 doc <projectId> <path>` | 문서 1건 조회 |
| `docs3 pending <projectId>` | 답변 대기 목록 |
| `docs3 new <projectId> <type> --title <t> [--links <ids>]` | 새 문서 생성 |
| `docs3 save <projectId> <path> <file>` | 문서 본문 전체 갱신 |
| `docs3 reply <projectId> <path> <qid> <답변...>` | 답변 대기 질문에 답변 |
| `docs3 transition-done <projectId> <planId> --report <r>` | PL → DN 전환 |
| `docs3 git commit <projectId> [-m <msg>]` | 수동 커밋 |
| `docs3 git push <projectId>` / `git pull <projectId>` | push / pull |

모든 명령은 실패 시 0이 아닌 종료 코드와 `{"error": "..."}` 형태(또는
stderr 메시지)로 실패한다 — 401/세션 만료 시 안내 메시지가 뜨면 `docs3
login`을 다시 안내한다.
