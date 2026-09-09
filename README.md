# claude-native-workflow

Claude와 함께 문서 기반으로 설계/기획을 진행하기 위한 워크플로우 —
동시성 규모에 따라 **초간단(Tier 1) / 평범(Tier 2) / 고급(Tier 3)** 3개
독립 배포 등급을 제공한다. 왜 이렇게 나눴는지, 등급 간 관계는
[docs/design/DS-00001.md](docs/design/DS-00001.md)가 원본이다. 이 저장소
자신도 그 설계를 [docs/](docs/)에서 같은 워크플로우로 추적한다(아래
"이 저장소 자신의 문서 워크플로우" 참고).

세 등급 모두가 공통으로 지키는 것은 `docs/` 마크다운+프론트매터 포맷
([docs/PROTOCOL.md](docs/PROTOCOL.md)) 하나뿐이다 — 등급을 나중에 바꾸거나
등급이 다른 설계자끼리 같은 저장소를 git으로 공유해도 문서 자체는 항상
같은 규칙을 따른다.

| | 초간단 (Tier 1) | 평범 (Tier 2) | 고급 (Tier 3) |
|---|---|---|---|
| 대상 | 완전 단일 설계자, 로컬 전용 | 한 사람, 여러 기기, 소규모 협업 | 클라우드, 다중 설계자 |
| 설치 | 프롬프트 복붙 | Docker Compose | Docker Compose(+ 설계자 계정) |
| Claude 접근 | 로컬 파일 직접 편집 | MCP 우선, CLI 폴백 | REST API(`docs3` CLI) |
| 상세 | 이 문서 아래 "초간단" 절 | [tier2/](tier2/), [SP-00001](docs/spec/SP-00001.md) | [tier3/](tier3/), [SP-00002](docs/spec/SP-00002.md) |

## 초간단 (Tier 1) — 지금 바로 쓸 수 있는 것

1. 새 프로젝트를 열고 Claude Code 세션을 시작한다.
2. 이 저장소의 [bootstrap-prompt.md](bootstrap-prompt.md) 전체 내용을 복사해
   그대로 붙여넣는다.
3. Claude가 프로젝트에 `CLAUDE.md`, `docs/` 전체 구조, `tools/docs` 대시보드를
   생성한다.
4. 이후 설계/기획 논의는 그 프로젝트 안에서 Claude와의 대화로 진행하면 되고,
   `python tools/docs/server.py`로 대시보드를 띄워 문서 현황과 답변 대기
   항목을 확인/처리할 수 있다.

참조 원본은 [tier1/](tier1/) — 로컬에서 직접 대시보드를 띄워 확인하려면
`python tier1/tools/docs/server.py --port 8757`.

## 평범 (Tier 2) — 로컬 상시 기동, MCP/CLI/대시보드

Node.js 백엔드 하나가 `docs/` 조작 로직을 한 번만 구현하고, MCP 서버·CLI·
Quasar 대시보드가 전부 그 백엔드(로컬 API)를 호출한다. 문서 생성/답변마다
git commit까지 기본으로 수행한다(SP-00001 5절).

```bash
cd tier2/docker
docker compose up -d --build
```

`http://localhost:9200`에 대시보드가 뜬다(백엔드는 `:8766`). Claude가
Bash로 직접 부르는 경로는 CLI(`docs` — [tier2/backend](tier2/backend)의
`bin`)이고, MCP 서버가 붙어있는 환경이면 그쪽을 우선한다. 상세는
[SP-00001](docs/spec/SP-00001.md), 구현 노트는
[docs/plan/PL-00001.md](docs/plan/PL-00001.md) 2단계 참고.

## 고급 (Tier 3) — 클라우드, 다중 설계자

Tier 2 백엔드를 확장해 인증·프로젝트 단위 테넌시·웹훅을 얹은 것. `docs/`
원본은 계속 git이 정본이고, 여러 설계자의 Claude 세션이 REST API로
동시에 접근한다(API 경로) — 다른 설계자가 저장소를 직접 clone해서
편집·push하는 git 경로와 병행 지원(웹훅으로 동기화).

```bash
cd tier3/docker
cp .env.example .env   # MYSQL_ROOT_PASSWORD/JWT_SECRET/GITHUB_WEBHOOK_SECRET 채우기
docker compose up -d --build
```

`http://localhost:9300`에 대시보드, 백엔드는 `:8767`. Claude 쪽 접근은
`docs3` CLI([tier3/backend](tier3/backend))로 REST API를 호출하는 것으로
고정된다(로컬 파일을 직접 건드리지 않음) — 이 CLI 사용법을 Claude에게
안내하는 Skill이
[tier3/skill/.claude/skills/docs3-cli/SKILL.md](tier3/skill/.claude/skills/docs3-cli/SKILL.md)에
있다(설치는 [tier3/skill/README.md](tier3/skill/README.md)). 상세는
[SP-00002](docs/spec/SP-00002.md), 구현 노트는
[docs/plan/PL-00001.md](docs/plan/PL-00001.md) 3단계 참고.

## 이 저장소의 구성

- `bootstrap-prompt.md` — 초간단 등급의 실제 배포용 산출물. 파일 내용을
  직접 담고 있지 않고, 각 파일을 GitHub의 `raw.githubusercontent.com`
  URL로 가리킨다 — 새 프로젝트에서 Claude가 이 URL들을 fetch해서 받은
  내용 그대로 저장한다.
- `tier1/` — 위 프롬프트가 가리키는 파일들의 **참조 원본**(pristine, 빈
  상태)이자 로컬 개발/테스트용 실행 가능한 사본.
- `tier2/` — 평범 등급의 Node 백엔드(`backend/`, MCP·CLI·REST API 공유
  구현) + Quasar 대시보드(`dashboard/`) + Docker 패키징(`docker/`).
- `tier3/` — 고급 등급. `backend/`는 `tier2/backend`를 로컬 패키지
  의존성으로 확장(인증·테넌시·웹훅), `dashboard/`도 `tier2/dashboard`의
  컴포넌트를 그대로 재사용해 프로젝트 선택/멤버 관리만 추가. `docker/`는
  DB(mysql)까지 포함한 배포 패키징, `skill/`은 `docs3` CLI Skill 참조
  원본.
- `docs/` — **이 저장소 자신**의 설계/기획 문서(아래 참고). `tier1/docs/`와
  헷갈리지 말 것 — `tier1/docs/`는 새 프로젝트에 심어질 빈 템플릿이고, 이
  `docs/`는 claude-native-workflow 자체의 실제 작업 기록이다.
- `CLAUDE.md` — 이 저장소 자신에 적용되는 운영 규칙.
- `DESIGN-NOTES.md` — 이 워크플로우 자체를 만들어 온 세션별 작업 기록
  (프로토콜 v1 초안부터 지금까지의 진행 로그).
- `scripts/build_prompt.py` — `tier1/` 아래 참조 원본 파일 목록으로
  `bootstrap-prompt.md`의 URL 표를 재조립하는 개발용 스크립트. `tier1/`에
  파일이 추가/삭제됐을 때만 다시 실행하면 된다(기존 파일의 내용 수정은
  URL이 `main` 브랜치를 가리키므로 재실행 없이도 반영됨 — 단, 그 커밋이
  `origin/main`에 push되어 있어야 한다).

## 참조 원본(`tier1/`)을 수정했을 때

```bash
python scripts/build_prompt.py
```

`bootstrap-prompt.md`의 URL 표가 `tier1/CLAUDE.md`/`tier1/docs/`/
`tier1/tools/docs/`의 현재 파일 목록과 다시 맞춰진다(파일 추가/삭제 시에만
실질적으로 바뀜). 수동으로 `bootstrap-prompt.md`를 직접 편집하지 않는다
(다음 재생성 때 덮어써진다). 이 URL들은 `origin/main`의 `raw.githubusercontent.com`
사본을 가리키므로, `tier1/` 내용을 고친 뒤에는 **반드시 commit+push까지
끝내야** 부트스트랩 프롬프트가 최신 내용을 받아온다. **`tier1/`은 항상 빈
템플릿 상태를 유지해야 한다** — 이 저장소 자신의 `docs/`(DS-00001 등 실제
문서)가 실수로 `tier1/`에 섞여 들어가면 새 프로젝트에 엉뚱한 내용이
복붙되므로 주의.

## 이 저장소 자신의 문서 워크플로우

claude-native-workflow는 자기 자신을 만드는 데도 자신이 만드는 워크플로우를
그대로 쓴다(초간단 등급 방식 — 로컬 `docs/` + `tools/docs` 대시보드).
지금까지의 설계 산출물:

- [docs/design/DS-00001.md](docs/design/DS-00001.md) — 전체 아키텍처(3개
  배포 등급, 공통 원칙).
- [docs/spec/](docs/spec/) — `SP-00001`(평범), `SP-00002`(고급),
  `SP-00003`(공통 REST API 계약).
- [docs/plan/PL-00001.md](docs/plan/PL-00001.md) — 실행 계획(0~4단계),
  완료됨 — 결과 보고는 [docs/done/DN-00001.md](docs/done/DN-00001.md).
- [docs/decision/](docs/decision/) — 착수 전 결정 사항. `DC-00001`(평범
  라이브러리)·`DC-00002`(고급 배포/DB 우선순위) 모두 답변 처리 및 스펙 반영
  완료(`applied`).

이 문서들을 조회하려면 `python tier1/tools/docs/server.py --port 8756 --root .`
로 대시보드를 띄운다(`.claude/launch.json`의 `docs-dashboard` 설정이 이미
이렇게 되어 있다).

## 문서 워크플로우 요약

전체 규칙은 [docs/PROTOCOL.md](docs/PROTOCOL.md)(이 저장소용) 또는
[tier1/docs/PROTOCOL.md](tier1/docs/PROTOCOL.md)(새 프로젝트에 심어지는 원본,
내용은 동일) 참고 — 이 포맷 계약은 세 등급이 전부 공유하므로 등급별로
달라지지 않는다(등급마다 달라지는 건 이 포맷을 "누가 어떤 인터페이스로
조작하는가"뿐 — 위 등급별 절 참고). 요점만 보면:

- 모든 설계 문서는 `[TYPE]-[00001].md` 추적 번호를 가지며 타입별 폴더에 저장된다
  (`SP` 설계 명세, `PL` 실행 계획, `DN` 결과 보고, `DS` 설계, `RM` 기억 지시,
  `TP` 임시 문서, `DC` 결정 요청, `RV` 검토 요청, `FX` 수정 검토, `LG` 처리 기록,
  `RP` 답변 항목).
- `DC`/`RV`/`FX` 문서의 "답변 대기" 항목은 대시보드에서 답변을 입력하면
  자동으로 원문서 안의 "## 답변 기록" 섹션에 `RP-XXXXX` 항목이 append되고
  (별도 파일을 만들지 않는다 — 질문이 몇 개든 파일이 늘어나지 않게 하기
  위한 설계) → 큐에서 제거 → 대상 문서당 1개인 `LG` 파일에 처리 기록이
  남는다.
- `PL`이 완료되면 `DN`으로 전환되고 원본 `PL`은 스텁만 남는다.
- 문서 수가 늘어나도 대시보드가 매 요청마다 전체 파일을 다시 읽지 않도록,
  파일 mtime 기준 인메모리 캐시를 쓴다(대시보드 재시작하면 캐시만 비워짐,
  데이터 손실 없음).
