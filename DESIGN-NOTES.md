> **이 문서는 두 부분으로 구성된다.** 아래 "v1 프로토콜 초안"은 이
> 워크플로우를 처음 논의하던 시점의 스냅샷이고(그때는 아직 `docs/`
> 자체가 없어서 여기 적었다) — 지금은 [docs/design/DS-00001.md](docs/design/DS-00001.md)
> 와 `docs/spec/*`, `docs/PROTOCOL.md`가 갱신된 정본이니 그쪽을 본다. 맨
> 아래 "세션 로그" 절이 이 문서의 살아있는 부분 — 세션마다 있었던
> 논의의 흐름(무엇이 계기였고, 왜 방향을 틀었고, 어디로 귀결됐는지)을
> 날짜별로 남긴다. 개별 결정의 최종 결과는 `docs/decision/DC-*`(RP 기록
> 포함)에 이미 있으니, 여기는 그 결과에 이르기까지의 "왜"를 보존하는
> 용도다([SP-00004](docs/spec/SP-00004.md)의 `trace_events`가 구현되면
> 이 역할을 자동화된 형태로 대체할 예정 — 그전까지는 세션 종료 시 수동으로
> 적는다).

# 문서 기반 설계 워크플로우 프로토콜 (v1 초안 — 아카이브)

새 프로젝트 시작 시 이 프로토콜을 그대로 복사해서 사용한다. `docs/` 폴더와
`tools/docs` 대시보드로 구성되며, 설계자와 Claude의 모든 설계/기획 대화는
이 문서 공간을 매개로 진행한다.

---

## 1. 문서 타입 분류표

`docs/index.md`에 아래 표를 그대로 싣는다. 모든 타입은 **폴더 + `index.md`**
형식으로 통일한다(색인 파일 위치를 예외 없이 일관되게 유지하기 위함).

| 타입 | 대상 | 색인 파일 | 비고 |
|---|---|---|---|
| `IX` | 최상위 색인/레지스트리 | `docs/index.md` | 이 표 + 하위 색인 링크 모음 |
| `SP` | `docs/spec/` | `docs/spec/index.md` | 설계 명세 |
| `PL` | `docs/plan/` | `docs/plan/index.md` | 실행 계획 |
| `DN` | `docs/done/` | `docs/done/index.md` | 결과 보고 |
| `DS` | `docs/design/` | `docs/design/index.md` | 설계 |
| `RM` | `docs/remind/` | `docs/remind/index.md` | 기억하라고 지시받은 것들 |
| `TP` | `docs/temp/` | `docs/temp/index.md` | 임시로 문서화한 것들 |
| `DC` | `docs/decision/` | `docs/decision/index.md` | 결정 요청 — 여러 선택지 중 하나를 사용자가 확정 |
| `RV` | `docs/review/` | `docs/review/index.md` | 검토 요청 — 잠정 결정에 대한 사용자 승인 |
| `FX` | `docs/fix/` | `docs/fix/index.md` | 수정 검토 — 버그/불일치/제한사항 처리 방침 |
| `LG` | `docs/logs/` | `docs/logs/index.md` | 답변 처리 기록 |
| `RP` | `docs/reply/` | `docs/reply/index.md` (미답변 큐) | 답변 항목. 파일은 `docs/reply/RP-XXXXX.md` |

파일명은 항상 `[추적번호].md` (예: `docs/spec/SP-00012.md`).

---

## 2. 추적 번호 발급

- 형식: `[TYPE]-[00001]` (영문 대문자 2글자 + 하이픈 + 5자리 숫자, 0패딩).
- 타입 내에서 순차 증가, 결번은 재사용하지 않는다(문서 삭제/폐기해도 번호는 소모됨).
- 다음 번호는 사람이 아니라 도구(Claude / 대시보드)가 공유하는 상태 파일에서 관리한다:
  `docs/.tracking.json`
  ```json
  { "SP": 12, "PL": 4, "DC": 7, "RP": 20, ... }
  ```
  새 문서를 만들 때 해당 타입 값을 읽고 +1 해서 사용한 뒤 즉시 갱신한다. 이 파일은
  색인에 나타나지 않는 내부 상태이며, 사람이 직접 편집하지 않는다.
- 로컬 단일 작업자 도구이므로 동시성 문제는 다루지 않는다(Claude와 대시보드가
  동시에 번호를 발급하는 상황은 실질적으로 발생하지 않는다고 가정).

---

## 3. 문서 프론트매터 스키마

모든 문서(`RP` 포함)는 YAML 프론트매터로 시작한다. 대시보드가 이 값을 파싱해서
tree/tab/카드를 구성한다.

```yaml
---
id: SP-00012
type: SP
title: 인증 흐름 재설계
status: draft          # 타입별 상태값은 4절 참고
created: 2026-09-09
updated: 2026-09-09
links: [DS-00003, PL-00002]   # 관련 문서 (양방향은 아니어도 됨, 편도 참조 허용)
reply_pending: false   # DC/RV/FX 전용. true면 미답변 항목 존재
---
```

`RP-XXXXX.md`는 추가로 다음 필드를 갖는다.

```yaml
target: DC-00005        # 답변 대상 문서
question: "인증 토큰 저장 방식은 A/B 중 무엇으로?"
answer: |
  B안(세션 쿠키)으로 확정.
answered_at: 2026-09-09
```

---

## 4. 상태(status) 워크플로우

| 타입 그룹 | 상태값 | 의미 |
|---|---|---|
| `SP`/`DS`/`RM`/`TP` | `draft` → `active` → `superseded`/`archived` | 일반 문서 생애주기 |
| `PL` | `planned` → `in_progress` → `done` | `done`이 되는 순간 6절의 PL→DN 전환 발생 |
| `DN` | (전환 결과, 별도 상태 없음) | 완료된 계획 + 보고서 |
| `DC`/`RV`/`FX` | `open` → `answered` → `applied` (`FX`는 `rejected`/`wontfix` 가능) | `open`이면 미답변, `answered`는 RP 연결됨, `applied`는 문서/코드에 반영 완료 |
| `RP` | `pending` → `answered` | `pending`이면 `docs/reply/index.md`에 나열 |
| `LG` | (상태 없음, 기록물) | |

---

## 5. 문서 생애주기 규칙

1. `docs/` 내 모든 문서는 자신의 타입에 맞는 색인 파일에 등재되어야 한다.
2. 문서가 많아진 카테고리(기준: 색인 항목 30개 초과)는 해당 폴더 내에 하위 폴더를
   만들고, 하위 폴더 자체의 `index.md`를 만든 뒤 상위 `index.md`에서 그 하위
   색인으로 링크한다. 예: `docs/spec/auth/index.md`.
3. **`PL` → `DN` 전환**: 계획이 완료되면
   - `docs/done/DN-XXXXX.md`를 새로 만들어 계획 원문 + 결과 보고를 함께 기재한다.
   - 원본 `docs/plan/PL-XXXXX.md`는 **삭제하지 않고 스텁으로 축소**한다:
     ```markdown
     ---
     id: PL-00002
     type: PL
     status: done
     ---
     # (완료됨) → [DN-00001](../done/DN-00001.md) 참조
     ```
   - `docs/plan/index.md`에서는 제거하되, 스텁 파일 자체는 남겨 기존 링크가
     끊기지 않도록 한다.
4. 문서/설계/명세를 가리킬 때는 항상 해당 섹션으로 바로 이동하는 링크를 쓴다.
   앵커는 GitHub 스타일 헤딩 슬러그(소문자화, 공백→`-`, 특수문자 제거)를 따른다.
   예: `[DC-00005의 B안](../decision/DC-00005.md#b안-세션-쿠키)`

---

## 6. 답변(RP) 처리 흐름

1. `DC`/`RV`/`FX` 문서 안에 "답변 대기" 항목이 생기면 해당 문서의
   `reply_pending: true`로 표시하고, `docs/reply/index.md`에 미답변 큐로 등재한다.
2. 설계자가 답변을 입력하면:
   - 새 `docs/reply/RP-XXXXX.md`를 발급해 질문/답변 전문을 기록한다(3절 스키마).
   - 답변 대상 문서(`DC`/`RV`/`FX`)는 **전문을 복제하지 않고**, 상태를
     `answered`로 바꾸고 "→ RP-XXXXX 참조" 링크만 남긴다(중복 저장 방지).
   - `docs/reply/index.md`에서 해당 항목을 제거한다(그 문서는 미답변 항목만 유지).
   - `docs/logs/LG-XXXXX.md`에 처리 기록(무엇을 바꿨는지, 어떤 문서를 갱신했는지)을
     남기고, 갱신된 문서들에 `LG-XXXXX` 링크를 추가한다.
   - 대상 문서가 후속 조치(문서 갱신, 계획 반영 등)를 요구하면 그 반영이 끝난 뒤
     상태를 `applied`로 올린다.

---

## 7. 프로젝트 루트 `CLAUDE.md` 템플릿 (Claude 운영 규칙)

새 프로젝트의 `CLAUDE.md`에 아래 내용을 포함시킨다.

```markdown
## 설계 문서 워크플로우

이 프로젝트의 설계/기획 논의는 `docs/` 문서 공간을 통해서만 진행한다.
전체 규칙은 `docs/PROTOCOL.md`(본 프로토콜)를 따른다.

- 설계자의 프롬프트를 받으면:
  1. 관련 기존 문서를 `docs/index.md` 및 해당 타입 색인에서 먼저 확인한다.
  2. 필요한 문서(SP/PL/DS/...)를 갱신하거나 새로 만들고, 결정/검토/수정이
     필요한 지점은 DC/RV/FX로 분리해 등재한다.
  3. 실행 계획(PL)을 세운 뒤에는 바로 실행하지 말고, 계획 내용을 요약해
     검토를 요청하고 승인을 받은 뒤에만 진행한다.
  4. 계획이 실행 완료되면 5절의 PL→DN 전환 절차를 따른다.
- `docs/reply/`에 미답변 RP 큐가 있으면, 다음 대화 시작 시 알려준다.
- 문서/설계를 언급할 때는 항상 해당 섹션 딥링크를 함께 제시한다.
```

---

## 8. `tools/docs` 대시보드 요구사항 (구현은 별도 단계)

- **성격**: 프로젝트 산출물이 아닌 설계자 전용 로컬 도구. `tools/docs`에 위치.
- **기술**: Python 표준 라이브러리만 사용(zero-dependency). `http.server` +
  정적 HTML/CSS/바닐라 JS(외부 CDN 없이 인라인)로 구현.
- **데이터 접근**: `docs/**/*.md`를 프론트매터 기준으로 파싱, `docs/.tracking.json`은
  읽기 전용으로 참고(번호 발급은 대시보드에서도 가능해야 하면 3절 규칙을 그대로 따름).
- **탭 구성**:
  - `문서`: 전체 문서, 타입 무관 통합 뷰.
  - `설계`: `DC`/`RV`/`FX`만. 각 문서 상세에서 `RV`/`FX`/`DC`/`LG` 코드 클릭 시
    이 탭으로 이동해 해당 문서를 바로 연다.
  - `기록`: `LG` 문서 + 그와 연결된(링크된) 문서들.
- **좌측 aside**: `docs/` 실제 폴더 구조를 반영한 계층형 트리뷰.
- **답변 카드**: `reply_pending: true`인 문서마다 미답변 항목 카드 표시 → 클릭 시
  다이얼로그에서 답변 작성 → 제출 시 6절 흐름 그대로 수행(`RP` 발급,
  대상 문서 상태 갱신, `reply/index.md`에서 제거, `LG` 기록 생성).
- **답변 완료 안내**: 답변 대기 항목이 있던 문서의 뷰 하단에, 문서 본문과는
  별개로 "답변 입력 후 처리 요령" 섹션을 대시보드가 자동 삽입해 보여준다
  (실제 문서 파일에는 쓰지 않고 UI에서만 표시).
- 문서의 **생성/편집 자체는 대시보드가 하지 않는다** — Claude와의 대화로만
  이뤄지고, 대시보드는 조회 + 답변 입력 전용으로 범위를 한정한다.

---

## 9. 남겨둔 미결 사항 (구현 단계에서 정할 것)

- `docs/.tracking.json` 파일을 대시보드가 직접 쓸지, 조회만 하고 번호 발급은
  Claude 세션에만 맡길지.
- `FX`의 `rejected`/`wontfix` 세부 상태를 UI에서 별도 색상으로 구분할지.
- 색인 폴더 분리 임계치(30개)를 설정 가능하게 할지, 고정값으로 둘지.

---

## 세션 로그

### 2026-09-09 — 3개 등급 아키텍처 확정, RP 파일 증식 문제 발견·수정, 읽기 게이트 설계

이 저장소를 만든 뒤 처음 이어진 긴 세션. 굵직한 흐름만 순서대로:

1. **3개 배포 등급 설계** — 처음엔 "core 엔진 + 4개 표면(CLI/MCP/플러그인/
   Docker)"으로 잡았다가, 설계자가 "등급을 유료 단계처럼 나누지 말고
   동시 사용 규모(단일 사용자/팀)로 나누자"고 방향을 틀어서
   초간단(Python)/평범(Node)/고급(Node 확장+클라우드) 3등급으로 재정리.
   → [docs/design/DS-00001.md](docs/design/DS-00001.md).
2. **평범/고급 스택 결정(`DC-00001`, `DC-00002`)** — 폴더 구조, Express,
   simple-git, Prisma, 호스팅(벤더 중립), 시크릿(dotenv), 웹훅(GitHub만),
   DB 우선순위(Postgres→SQLite), 조직 테넌시(보류)까지 전부 실제로
   대시보드 API를 통해 답변 처리하며 검증. → `docs/decision/DC-00001.md`,
   `DC-00002.md`(각 문서의 "답변 기록" 절 참고).
3. **RP 파일이 질문 수만큼 늘어나는 문제 발견** — 답변마다 `RP-XXXXX.md`
   파일을 새로 만들던 초기 설계가 실제로 DC 하나에 질문 4~5개만 있어도
   파일이 우수수 늘었다. 대상 문서 안 "## 답변 기록" 섹션에 앵커로
   직접 기록하는 방식으로 `tier1/tools/docs/server.py`를 다시 짜고, 이미
   만들어둔 RP 파일들을 실제로 병합·삭제해서 검증. → `docs/PROTOCOL.md`
   6절, [SP-00001](docs/spec/SP-00001.md) 2.1절.
4. **대시보드 조회 성능 우려** — 문서가 많아지면 매 요청마다 전체
   `docs/`를 다시 읽는 게 느려질 거라는 지적. mtime 기준 인메모리 캐시로
   해결(처음엔 sqlite 파일 캐시로 짰다가, 서버가 상주 프로세스라는 점을
   감안해 더 단순한 dict 캐시로 다시 고침).
5. **`tier1/` vs 이 저장소 자신의 `docs/`가 섞이는 실제 버그 발견** —
   `scripts/build_prompt.py`가 이 저장소 자신의(점점 채워지는) `docs/`를
   그대로 읽어서 `bootstrap-prompt.md`에 박아 넣고 있었다. `tier1/`을
   완전히 분리된 빈 템플릿으로 떼어내서 수정.
6. **"C++로 sqlite 같은 text-mergeable DB를 만들면 어떨까"** — 이 세션에서
   가장 길게 논의한 주제. 처음엔 git 병합 가능성 때문이라고 했다가,
   재질문 결과 진짜 동기는 성능이라고 함 → "캐시는 git에 커밋 안 하니
   병합 가능성 자체가 필요 없다, 그냥 SQLite를 쓰면 C 속도가 공짜"라고
   반박 → prebuilt 바이너리로 컴파일러 문제는 해결된다는 재반박 → "그래도
   SQLite보다 빠른 엔진을 직접 만드는 게 더 큰 일이다고" 재차 설명하던
   중, **설계자가 진짜 배경을 밝힘**: 실시간으로 "무엇이 왜 바뀌었고,
   Claude가 뭘 추천했고 왜인지"를 추적하기 어렵고, 이게 다중 설계자
   간 실시간 소통의 병목이 된다는 것. → 이건 조회 속도 문제가 아니라
   "git 커밋 사이클이 실시간 협업엔 근본적으로 안 맞다"는 문제였다.
   결론: 커스텀 DB 엔진 대신 [SP-00004](docs/spec/SP-00004.md)
   (`trace_events` + 선택적 실시간 푸시)를 신설해서 Tier 2/3 서비스
   계층에 이 흔적을 담기로 함. 웹소켓 요청이었지만 요구사항이 단방향
   브로드캐스트라 SSE를 1차로 제안(동의 안 하면 바로 WebSocket 전환
   가능하게 API 모양은 동일하게 설계).
7. **"확정적으로 구조화된 문서 관리 체계가 필요하다"** — C++을 생각했던
   진짜 이유 중 하나가 "여러 언어 구현이 검증 로직에서 미묘하게 어긋날
   수 있다(드리프트)"는 불안이었다고 밝힘. → 언어를 하나로 합치는 대신
   "무엇이 유효한 문서인가"를 `schemas/*.schema.json`으로 데이터화하고,
   각 등급 구현이 같은 픽스처에 대해 같은 판정을 내리는지 정합성
   테스트로 대조하는 쪽으로 해결. → [SP-00003](docs/spec/SP-00003.md) 7절.
8. **"구현을 특정 언어에 종속시키지 말고, Claude가 그 환경에서 즉석에
   구현하게 하는 게 AI-native"** — 정본을 소스코드가 아니라 명세+정합성
   테스트로 보는 원칙을 `DS-00001`에 새로 추가. 단, 이미 검증된 `tier1/`
   구현은 이유 없이 재생성하지 않는다는 단서를 달았다.
9. **읽기 게이트 통합** — "Claude가 주로 쓰는 비교/부분 읽기/탐색 동작을
   전부 하나의 관문으로 만들고, 그 관문이 추적 DB 반영과 알림 발행까지
   담당하게 하자"는 제안을 의사코드로 명세화. 그 과정에서 기존 설계의
   실제 구멍을 하나 발견 — `authoring_mode: direct-edit`로 손으로 편집한
   변경은 git_pull/webhook/api 이벤트가 없어서 변경 감지가 전혀 안 되고
   있었는데, 읽기 게이트로 통합하면서 자동으로 해결됨. →
   [SP-00003](docs/spec/SP-00003.md) 6절.

**아직 실행 전**: `PL-00001`(평범/고급 실제 구현)은 여전히 승인 대기
상태. 오늘 세션은 전부 설계/스펙/DC 처리였다.

### 2026-09-09 (계속) — Tier 1 구현 착수, 실제 검증, 설계자 피드백 반영

같은 날 이어서 "여기까지 반영해서 구현을 시작해보자"는 요청으로
`PL-00001` 1단계(초간단 정리)를 실제로 구현하고 대시보드로 전부 검증했다.
계획에 없다가 진행 중 설계자 피드백으로 추가된 것들이 특히 중요:

1. **읽기 게이트 의사코드의 실제 버그 발견** — `SP-00003` 6.2절 초안이
   `text = fs.read(path)`를 매번 먼저 실행해서, 캐시를 만든 의미가
   없어졌다("파일이 너무 많아지면 병목"이라는 지적을 C++ 엔진으로 풀려다가
   정작 그 대화에서 나온 해법(stat 우선, 파일은 진짜 바뀐 것만 읽기)을
   의사코드에 반영 안 하는 실수). mtime+size 2단계 검사로 고치고,
   diff 요약은 우리가 직접 텍스트를 들고 비교하는 대신 git에 위임하도록
   정리.
2. **Windows subprocess 인코딩 버그** — `git log`는 됐는데 `git diff`가
   500 에러. `subprocess.run(text=True)`가 Windows 로케일(cp949)로
   디코드하다 UTF-8 한글 바이트에서 깨진 것 — `encoding="utf-8"`로 고침.
   실제로 서버를 띄우고 curl/브라우저로 매 엔드포인트를 확인하지 않았으면
   놓쳤을 버그.
3. **답변 다이얼로그가 너무 빈약하다는 지적** → 처음엔 "현재 문서 본문을
   다이얼로그에 다시 보여주자"로 잘못 해석했다가, "질문지 원문이 아니라
   이 문서가 `links`로 연결한 SP/DS/PL 등 관련 문서를 보여달라는 것"이라는
   정정을 받고 다시 구현 — 질문에 답하는 데 필요한 배경(관련 스펙/결정)을
   다이얼로그 안에서 펼쳐볼 수 있게 됨.
4. **"권장/대안 옵션도 질문지에 적어서 대시보드에서 원클릭 결정"** —
   `docs/PROTOCOL.md` 4절에 `- 권장:`/`- 대안:` 표기 규칙을 추가하고,
   서버/프론트 양쪽에서 파싱해서 답변 다이얼로그에 원클릭으로 답변란을
   채우는 버튼으로 구현. AskUserQuestion에서 추천 옵션을 먼저 제시하던
   패턴을 문서 프로토콜 자체에 들여온 셈.
5. **"대시보드에서도 문서를 편집할 수 있으면 좋겠다"** — 이건 처음
   프로토콜을 설계할 때부터 명시적으로 반대로 정해뒀던 것(`대시보드는
   조회+답변 전용, 문서 생성/편집은 Claude와의 대화로만`)을 뒤집는
   요청이었다. 전면 반전 대신 범위를 좁혀 받아들임: 본문(body)만 대시보드
   에서 직접 편집 가능(굵게/취소선/제목 툴바 포함), **프론트매터는 여전히
   건드리지 않음** — `id`/`type`/`status`/`links` 같은 구조적 필드는
   그대로 답변 처리 흐름이나 Claude와의 대화로만 바뀐다. 저장 시 `docs
   validate`와 같은 검증을 통과해야 실제로 쓰여지게 해서, "편집은 되지만
   구조는 안 깨진다"는 절충을 지켰다.

이 세션 전체에서 반복된 패턴: 새 기능을 만들 때마다 실제로 서버를 띄우고
curl과 브라우저로 끝까지 확인했고, 그 과정에서 설계 단계의 의사코드만으로는
못 잡았을 실제 버그(위 1, 2번)를 두 번 잡았다.

### 2026-09-09 (계속 2) — `bootstrap-prompt.md`를 URL 참조 방식으로 전환

Tier 1 구현이 커지면서(`server.py`/`app.js` 등) `bootstrap-prompt.md`가
79KB까지 불어난 상태에서, 설계자가 "소스코드를 명시하는것 보다, 소스코드
URL을 명시하면 더 낫지 않나?"라고 제안. 처음엔 "복붙 한 번으로 quick-start,
네트워크 의존 없이"가 이 프로젝트의 전제라고 반박했지만, 설계자가 "나는
'네트워크 없이'라는 전제 조건을 부여한적이 없어"라고 정정 — 실제로 그런
요구사항은 없었고, 초반에 언급된 "zero-dependency"는 Tier 1 **런타임**이
Python stdlib만 쓴다는 뜻이었지 부트스트랩 프롬프트 자체가 오프라인이어야
한다는 뜻이 아니었다. 잘못된 전제를 스스로 만들어 반박한 셈이라 정정을
받아들이고 방향 전환:

- `scripts/build_prompt.py`가 `tier1/` 파일 내용을 그대로 텍스트로 박아
  넣는 대신, 각 파일을 `https://raw.githubusercontent.com/jay94ks/
  claude-native-workflow/main/tier1/<path>` URL로 가리키는 표를 생성하도록
  재작성. `bootstrap-prompt.md`는 79204자 → 3343자로 줄었고, 새 프로젝트에서
  Claude가 각 URL을 fetch해서 그대로 저장하는 방식으로 바뀜.
- 브랜치(`main`) 고정 vs 커밋 SHA 고정을 저울질: SHA 고정은 재현성은
  보장하지만 "생성 시점에는 아직 존재하지 않는 커밋"을 가리키는 닭-달걀
  문제가 있고, 이 저장소는 이미 "커밋하기 전에 실제로 띄워서 검증한다"는
  규율을 지키고 있어 `main`이 항상 검증된 상태라고 볼 수 있으므로 `main`
  브랜치 고정으로 결정.
- 부작용: 파일 **내용**을 고친 뒤에는 `build_prompt.py` 재실행이 필요
  없어짐(같은 URL이 push된 최신 내용을 가리키므로) — 대신 commit+push를
  건너뛰면 부트스트랩 프롬프트가 옛날 내용을 가리키게 되므로 그 규율이
  더 중요해짐. 파일 **목록**(추가/삭제)이 바뀔 때만 재실행이 필요.
  `CLAUDE.md`/`README.md`에 이 두 갈래를 명시적으로 구분해 적어둠.
- URL이 실제로 200을 반환하는지 `curl`로 검증(직전 커밋으로 이미
  `origin/main`에 push된 상태였어서 바로 확인 가능했음).

이어서 설계자가 "하위 index들은 protocol에 따라 자동 생성되면 되는거라,
저걸 굳이 전부 다운받으라고 안내하기 보단, 일반화하여 공통된 설명을
부착하는게 맞을것 같네"라고 추가 지적. 실제로 `docs/spec/index.md`,
`docs/plan/index.md` 등 9개 하위 색인은 제목/설명/상위 링크/빈 표만 다른
100% 판박이 구조였고, `docs/PROTOCOL.md` 1절 자체가 "`docs/index.md`의
표가 원본"이라고 명시하고 있어 그 표만으로 전부 파생 가능했다. 9개 URL을
`FILES`에서 빼고, `GENERIC_INDEX_TEMPLATE` 하나를 부트스트랩 지시문
안에 박아 "`docs/index.md`의 타입 분류표를 보고 `IX`/`LG`/`RP`를 뺀
나머지 타입마다 이 템플릿으로 생성해"로 대체. `docs/logs/index.md`와
`docs/reply/index.md`는 대시보드가 `TABLE:START`/`END` 마커 사이만
자동 갱신하는 특수 형식이라 예외적으로 그대로 URL 참조 유지. 결과:
19개 URL → 10개 URL, 3343자 → 2687자.

### 2026-09-09 (계속 3) — PL-00001 2단계(Tier 2) 착수: `core`/`api` 포팅

"PL-00001 2단계 Tier 2 시작하자"는 요청으로 `tier2/backend`를 새로
스캐폴딩(`package.json`/`tsconfig.json`, Node LTS + TypeScript, [DC-00001]
(docs/decision/DC-00001.md)에서 확정한 Express/simple-git/Prisma 스택)하고,
PL-00001 2단계 1~2번(`core/`, `api/`)을 실제로 구현·검증했다. 범위가 커서
(core→api→cli→mcp→git 자동화→이력/코멘트→변경 큐→DB→대시보드→Docker, 총
10개 순차 항목) 이번엔 1~2번까지만 하고 실제로 서버를 띄워 검증한 뒤 세션을
마무리하기로 판단(각 항목이 다음 항목의 전제라는 계획 자체의 순서를 그대로
따름).

- `docs/PROTOCOL.md`의 frontmatter 파서/덤퍼, `.tracking.json` 번호 발급,
  읽기 게이트(SP-00003 6.2절 mtime+size 캐시), `scan_pending`(옵션 파싱
  포함), `docs validate`, `answer_pending`(RP 폴딩 + LG find-or-create),
  `save_doc_body`를 Tier 1(Python)에서 1:1로 TypeScript에 포팅.
  `parse_frontmatter`는 범용 YAML 라이브러리(`js-yaml` 등)를 쓰지 않고
  Tier 1과 정확히 같은 부분집합만 손으로 다시 구현 — 두 엔진이 "무엇을
  유효한 프론트매터로 보는가"에서 갈라지면 안 된다는 SP-00003 7절의
  드리프트 우려 때문.
- 순환 참조 문제 발견: `validate.ts`가 파일 순회 함수를 `docstore.ts`에서
  가져오려 했는데, `docstore.ts`의 쓰기 경로(`saveDocBody`)가 저장 전
  `validateDoc`을 불러야 해서 서로 물렸다. 파일 읽기만 하는 부분을
  `fsdocs.ts`로 분리해서 해결(`fsdocs.ts` ← `validate.ts` ← `docstore.ts`
  단방향).
- Tier 1에는 없던 두 가지를 이번에 새로 설계해야 했다:
  - **`POST /api/docs`(문서 생성)** — Tier 1은 대시보드가 생성을 하지 않고
    Claude가 파일을 직접 쓰지만, SP-00003 2절 라우트 표와 SP-00001 4절의
    `docs new` CLI가 이미 이 라우트를 전제하고 있어 Tier 2부터는 API로도
    문서를 생성하게 구현. 대상 타입의 `docs/<폴더>/index.md` 표에서
    "아직 문서 없음" 자리를 실제 행으로 치환(또는 이어붙임).
  - **`PL→DN` 전환** — `docs/PROTOCOL.md` 5절 예시 스텁(`{id, type,
    status}` 3필드만)을 그대로 구현하면 7절 필수 필드 규칙(`created`/
    `updated` 필수)을 스스로 어겨서, 쓰기 경로가 저장 전 검증을 통과해야
    한다는 원칙(SP-00003 7.3절)과 모순됐다. `created`/`updated`/`links`
    (새 `DN`을 가리킴)를 유지하는 형태로 최소 변형해서 검증을 통과시킴 —
    문서 예시는 나중에 이 실제 구현에 맞춰 업데이트가 필요.
- 실제 검증: 스캐치 폴더에 `tier1/docs`(빈 템플릿)를 복사해 그 위에서 서버를
  띄우고, `SP`/`DC`/`RM`/`PL` 문서 생성 → `DC`에 옵션이 달린 질문 추가(`doc/
  save`) → 답변 처리(RP 앵커/LG 파일/`reply`·`logs` 색인 갱신 확인) → 앵커
  기반 부분 읽기 → `PL→DN` 전환(스텁/DN 파일/`plan/index.md`에서 행 제거
  확인) → `docs validate` 재실행(빈 배열 확인)까지 전부 실제 HTTP 요청으로
  검증. 진짜 리포의 `docs/`는 건드리지 않았고, 검증 후 스캐치 폴더는 삭제.
- 실제로 서버를 띄운 덕에 잡은 문제 하나: `curl`에 한글 JSON을 직접 넘기면
  Windows 콘솔 코드페이지 때문에 깨진 바이트가 그대로 저장됐다(Tier 1 때
  겪은 것과 증상은 비슷하지만 원인은 다름 — 이번엔 서버 코드가 아니라 curl
  호출 자체가 인코딩을 깨뜨린 것). Node `fetch`로 우회해서 재확인하니
  정상 — 서버 쪽 코드는 처음부터 문제 없었음.

`tier2/backend/.gitignore`로 `node_modules/`/`dist/` 제외. 남은 3~10번
(CLI, MCP, git 자동화, git 이력/코멘트, 변경 큐, 선택적 DB, Quasar 대시보드,
Docker)은 다음 세션에서 이어간다.

### 2026-09-09 (계속 4) — PL-00001 2단계 3~4번: CLI + MCP

"계속 진행해줘"로 이어서 3번(`cli/`)과 4번(`mcp/`)을 구현·검증했다. 둘 다
SP-00001 1절의 원칙("MCP 서버, CLI, 로컬 API가 전부 같은 core/ 함수를
직접 호출한다")을 그대로 따라 `api/server.ts`처럼 core를 직접 불러 쓰고,
서로를 거치지 않는다.

- **CLI**(`commander`): `docs tree`/`pending`/`design`/`all`/`get`/`new`/
  `reply`/`transition-done`/`validate`, 전역 `--root`. `--root`를 서브커맨드
  앞/뒤 어디에 둬도 되는지 실제로 둘 다 테스트해서 확인(commander의 전역
  옵션 상속 동작 확인 차 궁금해서 검증). 스캐치 `docs/` 사본에서 `new` →
  질문 추가 → `pending` → `reply` → `new PL` → `transition-done` →
  `validate` 시나리오를 CLI로 그대로 재현, 한글 타이틀도 CLI 인자로 바로
  넘겨서 깨지지 않는 것까지 확인(2번에서 발견한 curl 콘솔 인코딩 문제는
  curl 자체의 문제였고, `argv`로 넘기는 이 경로엔 해당 없음을 재확인).
- **MCP**(`@modelcontextprotocol/sdk` + `zod`): `docs_tree`/`docs_get`
  (`anchor` 지원)/`docs_pending`/`docs_list`(`design`/`logs`/`all`)/
  `docs_new`/`docs_reply`/`docs_transition_done` 7개 도구 등록.
  `git_sync`/`git_log`/`docs_comment`는 SP-00001 3절 표에 있지만 그 core
  모듈이 아직 없어(5~6번) 이번엔 등록하지 않음 — 없는 기능을 있는 것처럼
  노출하지 않는다는 원칙.
- MCP는 자동화 클라이언트가 없어 검증이 애매했는데, SDK 자체의
  `Client`+`StdioClientTransport`로 실제 서버 프로세스를 자식 프로세스로
  띄우고 7개 도구를 전부 호출하는 임시 스크립트를 짜서(테스트 후 삭제)
  2번 API 때와 동일한 전체 시나리오(생성→답변→전환→검증)를 재현 —
  JSON-RPC 경유라 한글 인자도 문제없이 왕복하는 것까지 확인.

CLI/MCP 둘 다 `tsc --noEmit` 통과 + 스캐치 폴더에서 실제 실행까지 확인한
뒤 스캐치 폴더/임시 스크립트 삭제. 남은 5~10번(git 자동화, git 이력/코멘트,
변경 큐, 선택적 DB, Quasar 대시보드, Docker)은 이어서 진행한다.

### 2026-09-09 (계속 5) — PL-00001 2단계 5번: git 자동화

"계속 진행" 요청으로 5번(git 자동화, SP-00001 5절)을 구현·검증했다.
`core/config.ts`(`docs/.config.json` 로더 + 기본값)와 `core/git.ts`
(`simple-git`)를 새로 만들고, `createDoc`/`answerPending`/`transitionDone`
성공 직후 자동으로 `docs/`만 commit(+`push_mode: immediate`면 push까지)
하도록 연결했다. git 호출이 전부 비동기라 이 세 core 함수의 시그니처가
`Promise`로 바뀌었고, 그걸 부르는 `api`/`cli`/`mcp` 세 진입점도 전부
`await`로 맞춰야 했다 — Express 4가 동기 throw는 알아서 에러 미들웨어로
보내주지만 비동기 핸들러의 reject는 그렇지 않아서, `asyncRoute` 래퍼로
감싸 `.catch(next)`로 명시적으로 연결했다(안 하면 실패한 요청이 응답 없이
멈춘다).

- CLI `docs git pull/commit/push/sync`, API `POST /api/git/pull|commit|
  push|sync`, MCP `git_sync` 도구까지 세 진입점 모두 추가.
- `api/server.ts`·`mcp/server.ts` 기동 시 자동 `git pull`(SP-00001 5절
  "세션/백엔드 기동 시"). 충돌이면 자동 병합을 시도하지 않고 로그/도구
  결과로만 보고하고, 서버는 계속 뜬다 - "중단"을 "서버가 죽는다"가 아니라
  "그 pull 시도만 멈추고 자동 병합은 안 한다"로 해석.
- **실제 다중 설계자 git 흐름을 처음부터 끝까지 재현해서 검증** — 로컬
  bare 저장소(`origin.git`) + 두 클론("설계자 A", "설계자 B")을 만들어:
  1. A에서 `docs new`(CLI) → 자동 commit+push → bare 저장소에 실제로
     커밋이 도착하는지 `git log`로 확인.
  2. B가 다른 클론에서 커밋+push한 뒤, A에서 `docs git pull` → B의 변경이
     정상 반영되는지 확인.
  3. 같은 파일의 같은 줄을 A/B 양쪽에서 각각 고쳐 **진짜 merge conflict**를
     만들고, A에서 `docs git pull` → 자동 병합을 시도하지 않고 그대로
     실패를 보고하는지, `git status`로 conflict marker(`UU`)가 실제
     워킹트리에 남아 있는지까지 확인한 뒤 `git merge --abort`로 정리.
  4. `docs/.config.json`에 `push_mode: manual`을 넣고 `docs new` → commit은
     되지만 push는 안 됨을 확인 → 수동 `docs git push` → 이번엔 원격이
     그새 앞서가 있어 non-fast-forward로 거부되는 것까지 재현.
  5. `POST /api/git/pull|sync` 라우트도 API 서버를 띄워 동일 시나리오로
     재확인, `docs new`(API)가 만든 커밋이 bare 저장소에 실제로 도착하는
     것까지 `git log --git-dir`로 확인.
- **검증 중 실제 버그 발견**: `pull()`이 실패하면 원인과 무관하게 전부
  `conflict: true`로 표시하고 있었다 — "원격이 없음"/"upstream 미설정"
  같은, 진짜 merge conflict가 아닌 실패까지 "충돌"로 잘못 분류됨(MCP
  스모크테스트 중 remote 없는 저장소로 테스트하다가 발견). git 출력에
  `CONFLICT` 문자열이 실제로 있을 때만 `conflict: true`로 좁히고, 두
  경우(진짜 충돌/그 외 실패)를 각각 다시 재현해서 구분되는 것까지 재확인.
  이번 세션에서 실제로 서버/CLI/MCP를 계속 띄워보고 잡은 세 번째 버그
  (앞선 두 개: 읽기 게이트 해시 사용 버그, Windows subprocess 인코딩
  버그와 같은 패턴).

git 테스트에 쓴 bare 저장소/클론/임시 MCP 스모크테스트 스크립트는 전부
검증 후 삭제. 실제 리포의 git 히스토리는 건드리지 않음. 남은 6~10번(git
이력/코멘트, 변경 큐, 선택적 DB, Quasar 대시보드, Docker)은 이어서
진행한다.

### 2026-09-09 (계속 6) — PL-00001 2단계 6번: git 이력/diff/blame + 코멘트

이어서 6번을 구현·검증했다. `core/gitlog.ts`는 Tier 1이 subprocess로 직접
파싱하던 `git log --pretty=format:...` 방식 대신 `simple-git`의 구조화된
`log()`를 그대로 썼다 — Node 쪽엔 이미 있는 의존성이고 굳이 포맷 문자열을
다시 파싱할 이유가 없어서(Tier 1은 stdlib뿐이라 그 방식이 유일한 선택이었을
뿐, 정본은 아니었음).

- **코멘트 저장소로 `node:sqlite`(`DatabaseSync`)를 선택** — Tier 1이 Python
  stdlib `sqlite3`를 쓴 것과 같은 이유(추가 의존성 없이 로컬 파일 DB)를
  Node 쪽에서 재현하려면 `better-sqlite3` 같은 네이티브 바인딩을 새로
  설치해야 하는데, Node 22.5+에 `node:sqlite`가 내장돼 있어(`DatabaseSync`,
  `prepare`/`run`/`get`/`all`) 그걸로 대체 — 아직 experimental이라 매 실행마다
  경고가 뜨지만(`import` 시점에 뜸, 실제 사용 여부와 무관), 별도 네이티브
  의존성을 추가하는 것보다 낫다고 판단.
- `core/localdb.ts`에 `docs/.workflow/data.db` 하나를 `doc_comments`
  테이블(이번 구현)과 `change_notices` 테이블(다음 7번에서 쓸 것 — 테이블만
  미리 만들어둠, Tier 1의 `_data_conn()`이 두 테이블을 한 커넥션 함수에
  같이 만드는 것과 동일 구조)로 공유.
- **CLI 명령어를 스펙 표기에서 실용적으로 변형** — SP-00001 4절은
  `docs comment <path> <text>` / `docs comment resolve <path> <id>`처럼
  "무동사=작성"으로 표기했지만, commander로 그대로 구현하면 `resolve`가
  `<path>` 자리의 값으로도 서브커맨드 이름으로도 동시에 해석될 수 있는
  모호성이 생긴다. 대신 `docs comment add/list/resolve`로 전부 서브커맨드화
  — API/MCP는 스펙 그대로(`action` 파라미터로 list/add/resolve 구분)
  유지했으니 계약 자체는 안 바뀌었고, CLI 표기만 좁힌 것.
- 실제 로컬 git 저장소에서 `docs new`로 커밋을 만든 뒤 `docs git log`가
  실제 `git log`와, `docs git show`/`docs git diff`가 실제 `git show`와,
  `docs git blame`이 실제 `git blame`과 각각 동일한 내용을 반환하는지
  직접 대조 확인. 코멘트는 CLI(`add`→`list`→`resolve`→`list`)와 MCP
  (SDK `Client`+`StdioClientTransport`로 동일 시나리오) 양쪽에서 재현,
  한글 본문이 그대로 왕복하는 것까지 확인.

남은 7~10번(변경 추적 큐, 선택적 서비스 DB, Quasar 대시보드, Docker)은
이어서 진행한다.

### 2026-09-09 (계속 7) — PL-00001 2단계 7번: 변경 추적 큐

"계속진행해" 요청으로 7번(SP-00003 5절)을 구현했다. 6번까지 만들어둔 읽기
게이트(`scanMeta`)에 `source` 파라미터를 추가하고, 콜드 스타트가 아닌
변경을 감지하는 순간 `core/changes.ts`의 `createChangeNotice`를 부르도록
연결 — 개별 이벤트(git_pull/직접편집/...)를 따로 후킹하지 않고 게이트
하나가 전부 잡는다는 5절/6절의 핵심 설계를 그대로 지킴.

**검증 과정에서 두 가지를 발견했다.**

1. **진짜 버그**: `diffSummarySync`(git에 위임하는 "뭐가 바뀌었는지" 요약)가
   워킹트리 diff와 스테이지 diff만 시도하고 실패하면 바로 "내용이 변경됨"
   이라는 밋밋한 메시지로 떨어졌다. 그런데 `git pull` 직후는 워킹트리가
   이미 `HEAD`와 똑같은 상태라 그 두 fallback이 항상 비어있다 — 즉 가장
   흔하게 발생할 케이스(pull로 받은 변경)에서 오히려 요약이 항상 실패하는
   구조였다. 실제로 두 클론으로 pull을 재현하며 결과를 눈으로 확인하다
   발견 — `HEAD~1..HEAD` diff를 세 번째 fallback으로 추가해서 고침
   (`docs/spec/index.md | 1 +`처럼 실제 유용한 요약이 나오는 것까지 확인).
2. **버그처럼 보였지만 설계 특성이었던 것**: `docs git pull`을 CLI로 한 번
   호출하면 변경 큐에 아무것도 안 쌓였다. 원인을 파다가 한참을 잘못된
   방향(수동 `node -e` 스크립트로 sqlite 파일을 직접 열어 비교하다가, Git
   Bash의 POSIX 경로 자동 변환이 임베딩된 문자열 안에서는 안 먹어서
   `C:\c\Users\...`라는 존재하지도 않는 엉뚱한 파일에 쓰고 읽고 있었던 것)
   으로 헤맸다 — 실제 CLI 코드의 경로 해석 자체는 처음부터 정확했다(디버그
   프린트로 확인). 진짜 원인은 따로 있었다: 캐시가 프로세스 메모리에만
   있어서, 그 파일을 이 프로세스가 "이미 본 적"이 있어야만 "달라졌다"고
   판단할 수 있는데, CLI는 매번 새 프로세스라 그 파일을 처음 보는 콜드
   스타트로만 취급된다. 오래 떠 있는 프로세스(API/MCP 서버)가 먼저 한 번
   읽어서 캐시를 데워야, 그 다음 pull이나 직접 편집이 실제로 큐에 잡힌다.
   이건 Tier 1의 in-memory 캐시와 완전히 같은 성격의 제약이라 설계를
   바꾸지 않고, 대신 "오래 떠 있는 백엔드/MCP가 큐를 채우고 CLI는 그걸
   나중에 읽고 ack만 한다"는 실제 사용 패턴에 맞는 특성으로 문서화(위
   PL-00001 7번)하기로 함.

실제 검증(전부 실제 bare 저장소 + 두 클론): 캐시를 데운 서버가 pull로
`source: git_pull` 알림 생성 → CLI `docs changes`가 그 항목을 (같은
`docs/.workflow/data.db`를 통해) 정확히 읽음 → `docs changes ack <id>`가
지움 → API 바깥에서 직접 파일을 고친 뒤 다음 조회에서 `source: scan`으로
잡히는 것도 재확인(Tier 1이 닫았던 "직접 편집 감지 구멍"과 동일 경로가
Tier 2에서도 막혀 있음을 확인). MCP `docs_changes` 도구도 등록/list/ack
스모크테스트로 확인.

남은 8~10번(선택적 서비스 DB, Quasar 대시보드, Docker)은 이어서 진행한다.

### 2026-09-09 (계속 8) — PL-00001 2단계 8번: 선택적 서비스 DB

"계속 진행해줘"로 8번(SP-00001 6절, `docs db enable`/`disable`)을
구현했다. DC-00001에서 ORM으로 이미 Prisma를 확정해뒀는데, 실제로 붙여보니
예상 밖의 구조적 문제부터 풀어야 했다.

- **Prisma가 스키마 하나당 provider를 고정한다는 걸 실제로 붙이면서 알게
  됨** — "설정으로 mysql/postgres/sqlite 중 고른다"는 요구사항과 정면으로
  부딪힘. `prisma/schema.{mysql,postgres,sqlite}.prisma` 세 개를 각자 다른
  `generated/<driver>/`로 생성해두고 런타임에 `driver` 값 보고 동적
  `import()`하는 방식으로 우회. `generated/`는 빌드 산출물이라 커밋 안 함,
  `npm run build`가 `db:generate`를 먼저 돌리게 연결.
- **Prisma 7이 아키텍처를 크게 바꿔서 다운그레이드함** — 처음에 최신
  (7.10.0)을 깔았더니 스키마 안의 `datasource { url = env(...) }` 자체가
  더 이상 지원 안 되고(`prisma.config.ts` + driver adapter 방식으로
  전환됐음), 그러면 DB별 어댑터 패키지 설치에 config.ts 셋업까지 범위가
  확 늘어난다. 이 프로젝트가 필요한 건 "런타임에 URL만 바꿔 연결"하는
  단순한 요구라 안정된 6.x(6.19.3)로 고정 — 오래된 방식을 붙잡은 게 아니라
  실제 요구사항에 맞는 더 단순한 버전을 고른 것.
- 코멘트 CRUD(`core/comments.ts`)가 `db.enabled`를 매번 확인해 로컬
  SQLite/서비스 DB 중 어디로 갈지 라우팅하도록 재작성 — Prisma 호출이
  비동기라 세 함수가 전부 `Promise`가 됐고, 5번(git 자동화) 때와 같은
  패턴으로 `api`/`cli`/`mcp` 세 진입점을 다시 `await`로 맞춤.
- **설정 파일 안에서 스스로 모순되는 걸 발견** — `docs/.config.json`에
  같은 스위치가 두 자리에 다르게 적혀 있었다: SP-00003 3절은
  `features.db`(boolean), SP-00001 6절은 `db.enabled`(중첩 객체 안).
  구현하다 보니 하나만 갱신하면 나머지가 거짓말하는 상태가 되길래,
  `docs db enable`/`disable`이 항상 둘 다 같이 쓰도록 함.
- **테스트 중 실제 버그 두 개**: (1) `execFileSync("npx", ...)`가 Windows
  에서 즉시 `spawnSync npx ENOENT`로 죽음 — `npx`가 셸 래퍼(`.cmd`)라
  셸 없이 spawn하는 `execFileSync`가 못 찾는다. `node`로 prisma CLI의 JS
  진입점(`node_modules/prisma/build/index.js`)을 직접 실행하도록 고쳐서
  플랫폼 무관하게 만듦. (2) sqlite 서비스 DB 테스트에서 "Unique constraint
  failed" — 원인을 좇다 보니 테스트에 쓴 Git Bash 스타일 절대경로
  (`/c/Users/...`)가 `file:` URL로 그대로 들어가면 POSIX 경로도 Windows
  경로도 아닌 애매한 문자열이 돼서 Prisma가 엉뚱한 곳에 db를 만들고 있었던
  것 — `buildConnectionUrl`을 `path.resolve()`로 정규화하도록 고침(이번
  세션에서 반복해서 마주친 "Git Bash POSIX 경로가 도구마다 다르게
  해석된다"는 패턴의 또 다른 사례).
- **`docs_index` 캐시 테이블은 이번엔 만들지 않음** — SP-00001 6절이
  설명하는 용도(여러 백엔드 인스턴스가 캐시를 DB로 공유)는 지금 단계(단일
  인스턴스 검증)엔 필요 없고, 6번에서 이미 만든 프로세스 메모리 캐시로
  충분해서 의도적으로 범위 밖으로 남김(PL-00001 8번에 명시).
- 실제 검증은 별도 DB 서버 설치 없이 **Prisma의 sqlite provider를 진짜
  "서비스 DB"처럼 써서** 전체 파이프라인(로컬 코멘트 작성 → enable →
  행 개수 검증 → 켜진 상태에서 작성/해결 → disable → 행 개수 검증 →
  로컬로 복귀, 해결 상태까지 보존)을 끝까지 재현 — MySQL/PostgreSQL 실서버
  연결 자체는 이 환경에서 검증 못 함(별도 후속 확인 필요, `buildConnectionUrl`
  의 URL 조합 로직만 정적으로 맞음을 확인).

남은 9~10번(Quasar 대시보드, Docker)은 이어서 진행한다.

### 2026-09-09 (계속 9) — PL-00001 2단계 9번: Quasar 대시보드, 실제 클릭으로 버그 둘 발견

"계속 진행해줘"로 9번을 구현했다. Quasar CLI 없이 표준 Vite 프로젝트에
`@quasar/vite-plugin`만 얹는 방식으로 구성(Tier 2가 이미 Vite 생태계라
자연스러움). Tier 1 대시보드의 화면 구성에 커밋 이력/diff, 코멘트,
변경 큐 배너를 더해 로컬 API를 호출.

- 세팅 중 자잘한 문제 둘: Quasar의 sass 소스를 커스텀 변수와 함께 쓰려면
  `sass-embedded` + include 경로 설정이 더 필요했는데, 이 프로젝트엔
  브랜드 커스터마이징이 필요 없어서 사전 컴파일된 `quasar/dist/quasar.css`
  로 단순화해서 회피. 편집기 텍스트영역은 `QInput`으로 만들면 네이티브
  `selectionStart`/`setSelectionRange`에 접근을 못 해 굵게/취소선 툴바가
  안 먹혀서, Tier 1처럼 순수 `<textarea>`로 되돌림.
- **이번에도 "실제로 브라우저에서 클릭해보기"가 스크린샷만으로는 못 잡을
  버그를 두 개 잡아냈다** — 이 세션 전체에서 반복된 패턴의 또 다른 사례:
  1. **UI 버그**: 답변을 제출하면 좌측 트리는(상태 `answered`로) 갱신되는데,
     열려 있던 문서 패널은 그대로 옛 "답변 대기" 상태를 계속 보여줬다.
     `DocViewer`가 `path` prop이 바뀔 때만 다시 읽어오는 구조인데, 같은
     문서에 답변한 거라 `path`가 그대로였던 게 원인. `viewerRefreshKey`를
     둬서 답변/저장 후 `:key`를 바꿔 강제로 다시 마운트하도록 고침.
  2. **백엔드 버그(스펙 위반, UI를 실제로 클릭하다 발견)**: 답변을
     제출한 직후 대시보드 상단에 "확인 안 된 변경"이 계속 쌓이는 게
     눈에 보였다. SP-00003 5절은 "내가 스스로 만든 변경은 쓰기 경로에서
     캐시를 최신 상태로 갱신해두므로... 큐에 안 쌓인다"고 명시적으로
     약속하는데, 확인해보니 7번(변경 큐)을 만들 때 `saveDocBody`에만
     `invalidateCache`를 넣고 `create.ts`/`reply.ts`/`transition.ts`
     세 곳엔 빠뜨렸었다 — 즉 8번까지 CLI/curl로만 검증했을 땐 이 경로가
     한 번도 노출이 안 됐던 것. 실제로 대시보드에서 같은 문서를 답변하고
     또 답변하는 걸 눈으로 반복하고 나서야 드러남. `invalidateCache`를
     export하고 `rebuildTable`(색인 재생성 공통 경로) 안에 넣은 뒤, 세
     파일이 직접 쓰는 나머지 파일(대상 문서/LG/DN/PL 스텁/plan 색인)마다
     쓰기 직후 호출하도록 고침 — 서버 재시작 후 다시 재현해서 변경 배너가
     더 이상 뜨지 않는 것까지 확인.
- `.claude/launch.json`에 `tier2-dashboard`(포트 9200) 설정 추가.
  `tier2/dashboard/.gitignore`로 `node_modules`/`dist` 제외.

이번에도 "일단 API/CLI로 확인됐다"에서 멈추지 않고 실제 화면을 계속
클릭해봤기 때문에 잡을 수 있었던 버그였다 — 특히 2번은 8번(선택적 DB)
때까지 CLI로만 검증하던 코드 경로에 숨어 있던 실제 스펙 위반이라, UI가
없었다면 한동안 못 봤을 것.

남은 10번(Docker)은 이어서 진행한다.

### 2026-09-09 (계속 10) — PL-00001 2단계 10번: Docker, 2단계 전체 완료

"계속 진행해줘"로 마지막 10번을 구현·검증하고, PL-00001 2단계(평범/
Tier 2) 전체를 마쳤다. `tier2/docker/docker-compose.yml`이 backend(단일
스테이지 — devDependencies까지 남겨 컨테이너 안에서도 `docs db enable/
disable`이 prisma CLI를 쓸 수 있게 함)와 dashboard(빌드 스테이지 +
`nginx:alpine` 정적 서빙, `/api/`는 nginx가 `backend:8766`으로 프록시)를
함께 기동한다.

이번에도 "빌드까지만 확인"에서 멈추지 않고 실제로 `docker compose build`
→ `up -d`까지 돌려서 검증했고, 그 덕에 배포 환경에서만 드러나는 진짜
버그를 두 개 잡았다:

1. **치명적**: backend가 `127.0.0.1`에 바인딩되어 있었다. 로컬 개발
   에서는 SP-00001 2절의 "신뢰된 로컬 환경만"이라는 의도와 정확히
   맞았지만, 컨테이너 안에서 `127.0.0.1`은 그 컨테이너 자신만의 루프백
   이라 같은 compose 네트워크의 dashboard(nginx `proxy_pass`)도, 호스트의
   포트 매핑도 전혀 못 닿아 브라우저에서 `502 Bad Gateway`가 났다.
   `--host` CLI 옵션을 새로 추가(기본값은 그대로 `127.0.0.1` — 로컬
   실행 동작은 안 바뀜)하고, `backend/Dockerfile`의 `CMD`에서만
   `--host 0.0.0.0`을 넘기도록 고쳤다 — 실제 노출 범위는 이미
   `docker-compose.yml`의 `ports:`가 결정하니 컨테이너 안에서의
   `0.0.0.0`은 SP-00001이 경계하는 "신뢰 안 된 네트워크 노출"이 아니다.
2. `node:22-slim` 베이스 이미지엔 Prisma 쿼리 엔진이 링크하는 `libssl`이
   기본으로 없어서, 빌드 로그에 "failed to detect the libssl/openssl
   version" 경고가 계속 남았다 — 경고 메시지가 정확히 안내하는 대로
   `apt-get install -y openssl`을 Dockerfile에 추가해서 해결.

고친 뒤 다시 빌드해 `up -d` → 호스트에서 backend API 직접 호출, dashboard
경유(nginx 프록시) 호출, 브라우저로 대시보드 화면이 실제로 렌더링되는
것까지 확인 → `down` + 이미지/스캐치 프로젝트 폴더 정리(실제 이 저장소
자신에는 이미지가 남지 않음).

**PL-00001 2단계(평범/Tier 2) 전체가 이걸로 끝났다** — core/api/cli/mcp/
git 자동화/git 이력·코멘트/변경 큐/선택적 DB/대시보드/Docker, 10개 항목
전부 실제로 띄우고 클릭하거나 호출해서 검증했다. 이 세션 전체에서 반복된
"실제로 띄우고 눌러본다"는 검증 방식이 아니었으면 못 잡았을 버그를
세면: 읽기 게이트 diff 요약 fallback 버그(7번), 자기 자신이 만든 변경이
변경 큐에 스팸처럼 쌓이던 버그(9번 — `invalidateCache` 누락, 8번까지
CLI로만 검증하던 경로라 안 드러났었음), 대시보드가 답변 후 열린 패널을
안 새로고침하던 버그(9번), 그리고 이번 Docker 바인딩 버그(10번) — 최소
네 개. 전부 "일단 API가 200을 반환한다"에서 멈췄다면 놓쳤을 것들이다.

남은 건 [PL-00001](docs/plan/PL-00001.md) 3단계(고급/Tier 3, SP-00002)와
4단계(문서 정리/`DN` 전환)뿐이다.

### 2026-09-09 (계속 11) — PL-00001 3단계 착수: 착수 전 발견한 동시성 설계 문제

"계속 진행해"로 3단계(고급/Tier 3, SP-00002)에 들어갔다. 시작하자마자
실제 인증/프로젝트 코드를 짜기 전에, SP-00002 4절의 `/api/projects/
:projectId/...` 설계를 `tier2/backend`의 기존 구조에 겹쳐 보다가 진짜
문제를 하나 발견했다 — 이번엔 실제로 부딪혀서가 아니라 **설계 단계에서
미리 짚어낸** 것이라는 점이 지금까지의 다른 발견들과 다르다.

`tier2/backend/core/`는 애초부터 "프로세스 하나 = 프로젝트 하나"를
전제로 짰다(CLI 한 번 실행, API 서버 하나가 로컬 `docs/` 하나만 담당,
MCP 서버 하나가 그 세션의 프로젝트 하나만 담당 — 지금까지 전부 이
전제였다). 그런데 Tier 3는 서버 프로세스 하나가 **여러 프로젝트를
동시에** 처리해야 한다. 겹쳐보니 두 가지가 바로 걸렸다:
- `paths.ts`가 "현재 프로젝트 루트"를 프로세스 전역 변수로 들고 있어서,
  두 요청이 인터리빙되면 나중 요청이 루트를 덮어써 앞 요청이 남의
  프로젝트를 건드릴 수 있었다.
- `docstore.ts`의 읽기 게이트 캐시가 `docs/` 기준 **상대경로**를 키로
  써서, 서로 다른 프로젝트에 동명 파일(`spec/SP-00001.md`)이 있으면
  캐시가 프로젝트 간에 내용을 섞어 보여줄 수 있었다.

고친 방법: `paths.ts`를 `AsyncLocalStorage`로 바꿔서, Tier 2가 쓰는
`setProjectRoot()`(전역 격, `enterWith`로 그대로 유지 — 동작 안 바뀜)와
Tier 3가 쓸 `runWithProjectRoot(root, fn)`(요청 하나의 비동기 체인에만
격리)을 둘 다 지원하게 함 — `core/`의 나머지 모든 파일은 여전히
`getProjectRoot()`/`docsDir()`만 호출하므로 손댈 필요가 없었다. 캐시는
키를 절대경로로 바꿔서 프로젝트 간 충돌 가능성을 원천 차단.

검증은 두 갈래: (1) 기존 Tier 2 CLI 시나리오가 그대로 되는지 회귀 테스트,
(2) 진짜 동시성을 재현 — `runWithProjectRoot`로 프로젝트 A/B를 일부러
인터리빙시켜(A 시작 → 50ms 대기 도중 B가 시작해서 먼저 끝남 → A 재개)
각자 자기 루트만 보고, 파일도 각자의 `docs/`에 정확히 쓰이는지 직접 확인
(콘솔에 "root seen at write time"을 찍어 실제로 대조).

이어서 SP-00002 1~3절의 DB 스키마(`users`/`refresh_tokens`/`projects`/
`project_members`)를 세 Prisma 스키마 파일 전부에 추가. `doc_comments`에
`project_id`(nullable)도 같이 추가했는데, 이유는 SP-00002 8절이 "모든
프로젝트가 하나의 서비스 DB를 공유하고 project_id로 나눈다"고 명시하기
때문 — 처음엔 프로젝트마다 별도 DB 커넥션을 두는 그림을 막연히 생각했다가,
스펙을 다시 읽고 "공유 DB + 컬럼으로 분리"가 맞다는 걸 확인하고 방향을
바꿈. `role`은 Prisma `enum` 대신 평문 `String`으로 — sqlite 변형엔
네이티브 enum이 없어서 세 provider 공통으로 쓸 수 있는 표현이 이것뿐이라
(Tier 2 때 이미 같은 이유로 다른 곳에서도 이렇게 처리한 적 있음). 스키마
확장 후 세 provider `prisma generate`가 전부 통과하는지, 그리고 기존
Tier 2 코멘트+서비스 DB enable/disable 회귀 테스트까지 재확인.

다음은 실제 인증(회원가입/로그인/토큰 갱신/로그아웃, argon2id+JWT)과
프로젝트 CRUD/멤버십, 그 다음 이 전부를 감싸는 라우트 미들웨어 순서로
이어간다.

### 2026-09-09 (계속 12) — PL-00001 3단계 2~4번: 인증·프로젝트·git 동기화

"계속 진행해줘"로 이어서 `tier3/backend`를 실제로 만들었다. `tier2/backend`
를 `file:../../tier2/backend` npm 의존성으로 참조하는 별도 패키지로
설계한 대로(DC-00001 "B안") 구성 — Windows에서 `file:` 의존성이 심볼릭
링크로 걸린다는 걸 실제로 확인했고, 그 덕에 `tier2/backend`의 `dist/`와
`generated/`(Prisma 클라이언트)를 깊은 경로 import로 그대로 재사용할 수
있었다. 다만 `tier2/backend/tsconfig.json`이 그동안 `.d.ts`를 안 만들고
있었다(라이브러리로 쓰인 적이 없어서) — `declaration: true`로 바꿔서 해결.

**인증**은 `argon2id` 비밀번호 해시 + JWT(15분) access token + 회전식
refresh token(고엔트로피 난수, DB엔 SHA-256 해시만 저장, 30일) 조합으로
구현. 회원가입 → 로그인 → refresh(회전 확인 — 쓴 토큰 재사용 시도가 실제로
막히는지까지) → logout(로그아웃 후 재사용도 막히는지) 전부 curl로 끝까지
재현.

**프로젝트 네임스페이스**를 짜면서 설계 선택을 하나 했다 — tier2의
`api/server.ts`(Express 앱)를 `/api/projects/:id` 아래 그대로 마운트하는
방법도 잠깐 생각했지만, 그러면 경로가 `/api/projects/:id/api/tree`처럼
이중으로 겹쳐서 SP-00002 4절이 원하는 모양과 안 맞았다. 대신 tier3도
tier2의 `core/` 함수를 똑같이 직접 호출하는 쪽으로 갔다 — 어차피
SP-00001 1절의 "MCP/CLI/API가 서로를 거치지 않고 같은 core를 직접
호출한다"는 원칙을 그대로 잇는 게 맞다는 걸 재확인한 셈. 두 계정(생성자
owner, 초대받은 사람은 처음 viewer → editor로 승격)으로 role 강제가
실제로 되는지(viewer 쓰기 403 → editor로 승격 후 성공) curl로 확인.

**git 동기화**에서 진짜 설계 충돌을 하나 풀어야 했다: SP-00002 5절은
"커밋 작성자를 실제 요청한 설계자로 남긴다"고 하는데, tier2의 `core/
create.ts`/`reply.ts`/`transition.ts`는 저장 직후 **자기도** 자동으로
commit+push한다(SP-00001 5절, 저장소에 고정된 git user로). 그대로 두면
커밋이 두 번 생기고 작성자도 엉뚱하게 남는다. `core/` 자체를 고치는 대신,
프로젝트를 clone한 직후 그 체크아웃의 `docs/.config.json`에서
`git.enabled=false`를 써서 tier2 쪽 자동 커밋을 꺼버리고, tier3가 매
요청 끝에서 직접 올바른 작성자로 커밋하도록 했다 — 이미 있는 토글을
그대로 활용한 것. owner/editor 각각의 커밋에 실제로 그 사람 이름/이메일이
남는 것, bare 저장소까지 push되는 것까지 `git log`로 확인.

**웹훅 서명 검증(HMAC-SHA256)을 짜다가 두 개를 잡았다:**
1. 전역 `express.json()`이 등록 순서상 먼저면 웹훅 라우트에 도착하기도
   전에 원문 바이트 스트림을 이미 소비해버려서, HMAC 검증에 필요한 원문이
   사라진다는 걸 짜면서 바로 알아챔 — 웹훅 라우트의 `express.raw()`를
   전역 파서보다 앞서 등록해서 해결(실제로 걸려서 고친 게 아니라, 코드
   순서를 보다가 미리 알아챈 것).
2. `crypto.timingSafeEqual`은 두 버퍼 길이가 다르면 예외를 던진다(애초에
   길이가 다르면 상수 시간 비교 자체가 성립 안 함) — 실제로 curl로 짧은
   서명 헤더를 보내보고서야 발견. 그대로 두면 공격자가 이상한 길이의
   서명을 보낼 때마다 401 대신 500류의 내부 에러 메시지가 담긴 400이
   샜다. 길이를 먼저 비교하도록 고치고, 정상/짧은 서명/길이는 맞지만
   틀린 서명 세 가지를 전부 재현해서 확인.

웹훅이 실제로 어느 프로젝트를 찾아 캐시를 최신화하는 부분(`git_repo_url`
역매핑)은 다음으로 미룸. 남은 건 5번(클라이언트 토큰 보관 - Skill 쪽 작업),
6번(대시보드 프로젝트 전환/멤버 관리 UI), 7번(배포 설정 정리)이다.

### 2026-09-09 (계속 13) — 웹훅 캐시 최신화, tier2/tier3 사이 진짜 설계 충돌 하나 더

"계속 진행해줘"로 미뤄뒀던 웹훅 캐시 최신화를 마저 구현하다가, tier2와
tier3가 같은 설정을 서로 다른 의도로 건드리는 진짜 충돌을 하나 더
발견했다. 앞선 세션(3단계 2~4번)에서 "tier2의 자동 커밋을 끄고 tier3가
직접 올바른 작성자로 커밋한다"는 걸 `docs/.config.json`의
`git.enabled=false`로 구현했었는데, 웹훅 핸들러가 그 프로젝트에 대해
`pull()`을 부르니 "git 자동화가 꺼져 있습니다"로 막혔다 — `enabled` 하나가
"쓰기 후 자동 커밋"과 "pull/push 명령 자체 가능 여부"를 동시에 게이팅하고
있었던 것. tier3 입장에선 자동 커밋만 끄고 싶었지, pull/push까지 막고
싶었던 게 아니었다.

고친 방법: tier2의 `GitConfig`에 `auto_commit`(기본 `true`)을 새로
추가해서 두 개념을 분리 — `enabled`는 여전히 "git 저장소 자체가 아니면
전부 꺼짐"이라는 원래 의미 그대로 두고, `auto_commit`은 `afterWrite()`
(쓰기 성공 직후 자동 커밋)만 게이팅한다. tier3의 `workspace.ts`는 이제
`auto_commit=false`만 쓰고 `enabled`는 건드리지 않는다. tier2 자체의
동작이 이 변경으로 안 바뀌었는지(설정 파일 없을 때 기본값 `auto_commit:
true`라 기존 사용자에겐 아무 차이가 없어야 함) CLI로 재확인.

이어서 실제 캐시 최신화 로직: `core/projects.ts`의 `findProjectsByRepoUrl`
이 웹훅 페이로드의 `repository.{clone,html,ssh}_url`을 정규화(프로토콜/
`.git` 접미사/대소문자 차이 무시)해서 저장된 프로젝트와 매칭하고, 매칭된
각 프로젝트에서 `runWithProjectRoot`로 스코프해 pull한다. "캐시 최신화"의
실체는 pull이 로컬 파일을 최신 커밋으로 맞추는 것뿐이라는 걸 다시 한번
확인 — 그 다음은 2단계 7번에서 이미 만든 읽기 게이트가 알아서 diff를
감지한다.

검증은 진짜 시나리오 그대로: 로컬 bare 저장소 + Tier 3에 프로젝트 등록
(clone) → API로 트리 한 번 읽어 캐시 데움 → **완전히 별도의 클론**에서
직접 편집→커밋→push(다른 설계자가 로컬에서 직접 작업하는 상황 재현) →
GitHub 스타일 웹훅(HMAC 서명 포함)을 쐈을 때 프로젝트가 올바르게 매칭되고
(`matched_projects`), 그 프로젝트의 체크아웃이 실제로 pull되는지(`git
log`/파일 내용으로) 확인 — 이걸 새 프로젝트를 만들어 처음부터 재현해서
config 수정이 실제로 적용된 상태로 검증.

남은 건 5번(클라이언트 토큰 보관), 6번(대시보드 UI 확장), 7번(배포)이다.

### 2026-09-09 (계속 14) — 5번: `docs3` CLI로 클라이언트 토큰 보관 구현

"계속 진행하자"로 5번(SP-00002 2절)을 구현했다. 스펙 문구가 "Skill이
안내하는 얇은 REST 클라이언트"라 처음엔 이걸 Skill 문서(안내 절차서)
작성 작업으로만 봤는데, 다시 생각해보니 그 문서가 안내할 실제 CLI가
없으면 문서만 있어봐야 소용이 없다는 걸 깨닫고, 문서보다 `tier3/backend`
에 `docs3` CLI를 먼저 구현하는 쪽으로 순서를 바꿨다(Skill 문서 자체는
아직 안 씀).

`core/credentials.ts`(`~/.claude-native-workflow/credentials.json`,
권한 600)와 `core/apiclient.ts`(401 받으면 refresh token으로 자동 갱신 -
회전된 새 refresh token도 다시 저장해둬야 다음 401 때 안 막힌다는 걸
설계 단계에서 미리 챙김) 위에, tier2의 CLI와는 성격이 다른 CLI를 짰다 -
tier2 CLI는 core를 직접 호출하지만, `docs3`는 REST 클라이언트라 로컬
파일이 아예 없고 전부 HTTP로 tier3 서버를 부른다(login/logout/whoami/
projects/project-create/members/invite/tree/doc/pending/new/reply/
transition-done/git commit·push·pull).

검증하면서 신경 쓴 부분: `os.homedir()`가 실제 내(Claude 세션이 도는 이
Windows 머신) 홈 디렉터리를 가리키므로, 테스트를 실제 홈에 자격 증명
파일을 쓰면서 할 수는 없었다 - `USERPROFILE`/`HOME` 환경변수를 스캐치
디렉터리로 덮어써서 전체 시나리오(로그인 → 자격 증명 파일 생성 확인 →
프로젝트 생성 → 문서 생성(한글 제목) → 답변 대기 조회 → 답변(한글 인자)
→ 로그아웃 → 자격 증명 파일이 실제로 지워지는 것)를 재현했고, 끝난 뒤
실제 홈 디렉터리(`~/.claude-native-workflow/`)가 안 생겼는지도 따로
확인했다.

남은 건 6번(대시보드 프로젝트 전환/멤버 관리 UI), 7번(배포), Skill 문서
작성이다.

### 2026-09-09 (계속 15) — 6번: `tier3/dashboard` 다중 설계자 UI

"계속 진행해줘"로 6번(SP-00002 8절)을 구현했다. 스펙의 "화면 자체는
SP-00001과 동일하다"는 문구를 그대로 지켜서, `tier2/dashboard`의
`DocTree`/`DocViewer`/`ReplyDialog`/`api.ts`를 복제하지 않고
`tier3/dashboard`가 상대경로로 직접 import하는 방식을 택했다(컴포넌트
패키지를 새로 배포하는 대신 Vite `server.fs.allow`만 확장). 이러려면
`api.ts`가 하드코딩하고 있던 `/api` base path와 무인증 호출 전제를
깨야 해서, `configureApi({basePath, authToken})`로 주입 가능하게 바꿨다 -
tier2/dashboard는 인자 없이 호출하면 예전 그대로 동작하는 걸 회귀
확인했다.

이 재사용을 위해 tier3 백엔드 쪽에 SP-00002 4절엔 명시 안 됐지만 실제로
빠져 있던 라우트들(search/validate/doc-save/git 이력·blame·diff, 프로젝트별
코멘트, 변경 큐)을 마저 채웠다. 코멘트는 tier2의 `core/comments.ts`(프로젝트
하나 = 로컬 DB 하나 가정)를 그대로 못 써서 `tier3/backend/src/core/
comments.ts`를 새로 만들어 하나의 서비스 DB를 `project_id`로 나눠 쓰게
했다(스키마는 이미 1번 항목에서 준비돼 있었음).

새로 짠 화면은 `LoginView`/`ProjectSelector`/`DashboardView`/
`MembersView` 4개뿐이고, 문서 조회/편집 자체는 정말로 tier2 컴포넌트가
그대로 렌더링됐다. 스크래치 bare 저장소+SQLite 서비스 DB로 tier3
백엔드를 띄우고 브라우저로 전체 플로우(회원가입/로그인 → 프로젝트 생성 →
문서 열람+커밋 이력에 실제 요청자 이름으로 커밋된 것 확인 → 코멘트
작성(한글)/해결 → 멤버 초대/역할 변경/제거 → git pull → 프로젝트 전환 →
로그아웃)를 직접 조작해서 확인했다. 중간에 브라우저 자동화 클릭이 간헐적
으로 안 먹히는 문제를 겪었는데, 원인을 파고들어보니 앱 버그가 아니라
테스트 도구(브라우저 프리뷰)를 뷰포트보다 크게 리사이즈했을 때 스크린샷
좌표계가 실제 좌표와 어긋나는 현상이었다 - 페이지 내 `fetch`를 직접
호출해 서버는 정상 응답(200)하는 걸 먼저 확인해두고, 프리뷰 크기를
프리셋 기본값/뷰포트 이하로 되돌리니 재현이 사라졌다. 스크래치 환경과
백그라운드 서버는 검증 후 모두 정리했다.

이걸로 3단계 1~6번이 전부 끝났다. 남은 건 7번(배포)과 Skill 문서
작성, 그리고 4단계다.

### 2026-09-10 (계속 16) — 7번: Docker 배포 패키징, 3단계 전체 완료

"계속 진행해줘"로 7번(SP-00002 7절, DC-00002 확정대로)을 구현했다.
호스팅 벤더는 정하지 않고 Docker/Docker Compose 패키징만 만든다는
원칙이라, tier2의 `Dockerfile`/`docker-compose.yml`을 참고해 같은
패턴으로 짰다.

가장 신경 쓴 부분은 tier2에는 없던 문제 - tier3는 tier2를 `file:`
의존성(백엔드)과 상대경로 import(대시보드)로 재사용하고 있어서, 이미지
빌드 컨텍스트도 tier2/backend·tier2/dashboard를 tier3와 같은 상대
위치에 함께 담아야 했다. 그래서 두 Dockerfile 다 tier2 것들과 달리
**monorepo 루트**를 빌드 컨텍스트로 받게 짰다(빌드를 최종 이미지 안에서
그대로 하니 멀티스테이지로 나눌 때 흔한 "심볼릭 링크가 스테이지 넘어가며
깨지는" 걱정도 자연히 없어짐). 루트 컨텍스트를 쓰면 전체 monorepo의
`node_modules`가 전송 대상이 될 수 있어서 루트 `.dockerignore`도
새로 추가했다(서브폴더 컨텍스트를 쓰는 tier2 기존 이미지엔 영향 없음).

대시보드 이미지는 실제로 빌드해보고서야 진짜 문제 하나를 발견했다 -
tier2/dashboard 소스가 쓰는 `marked`/`vue`/`quasar`는 "import하는 파일
기준 위쪽 `node_modules`"로 찾아지는데, tier3/dashboard의 `node_modules`는
그 파일 입장에서 형제 디렉터리라 안 잡힌다. 로컬 dev에서 이 문제가 안
보였던 건 순전히 tier2/dashboard가 이미 따로 `npm install`돼 있었기
때문 - 이미지 빌드 중 tier2/dashboard도 그 자리에서 `npm ci`해주는
걸로 고쳤다.

백엔드는 DB가 선택이 아니라 필수라(6절) 컨테이너 기동 스크립트
(`docker-entrypoint.sh`)가 `DB_DRIVER`에 맞는 Prisma 스키마로 먼저
`db push`한 뒤 서버를 띄운다. `docker-compose.yml`엔 mysql 서비스도
같이 넣었다(SP-00001 6절 "MySQL 메인"이 기본값). 시크릿은 `.env`
(저장소 `.gitignore`가 이미 `.env`/`.env.*`를 막고 `.env.example`만
예외로 허용해서 그대로 씀)로 주입.

실제로 `docker compose build && up`까지 돌려서 mysql+backend+dashboard
3개 컨테이너로 회원가입/로그인(백엔드 직접 호출 + dashboard `/api`
프록시 양쪽)/웹훅 401/브라우저로 nginx 프로덕션 빌드 로그인 화면까지
확인했다. `down && up`(볼륨 유지)으로 재기동해 mysql 데이터가 실제로
살아남는지도 확인하다가 진짜 버그 하나를 더 잡았다 - mysql healthcheck를
급하게 `-proot`로 하드코딩해뒀는데 실제 비밀번호(`.env`의
`MYSQL_ROOT_PASSWORD`)와 안 맞았다. 이것 때문인지 mysql 공식 이미지
자체의 "임시 서버로 초기화 → 잠깐 내림 → 진짜 서버로 재기동" 2단계
기동 과정 때문인지(둘 다 겹쳤을 가능성이 큼) backend가 mysql이 아직
진짜로 안 떠 있는 짧은 공백에 붙었다가 두 번 연속 `P1001`로 실패하는
걸 실제로 봤다 - `restart: unless-stopped`가 세 번째 시도에서 자연
복구시켰다(최초 기동 1회성 문제라 별도 재시도 로직은 안 넣음).
healthcheck를 `$MYSQL_ROOT_PASSWORD`를 셸로 참조하게 고친 뒤 재현
안 되는 것까지 재확인. 테스트에 쓴 `.env`/컨테이너/이미지/볼륨은
전부 정리.

이걸로 3단계(SP-00002, 1~7번)가 전부 끝났다. 남은 건 Skill 문서
작성과 4단계(문서 정리 및 마무리)뿐이다.

### 2026-09-10 (계속 17) — docs3 CLI Skill 문서 작성, 빠진 명령 발견

"계속 진행해줘"로 5번에서 미뤄뒀던 Skill 문서를 썼다. Claude Code Skill
포맷(정확한 frontmatter 필드, 경로 규칙)은 claude-code-guide 서브에이전트에게
먼저 물어보고 확인한 뒤 진행 - `.claude/skills/<name>/SKILL.md`, `description`
+`when_to_use` 합쳐 1536자 제한 등.

이 저장소 자신은 Tier 3를 쓰지 않으므로(자기 문서는 초간단 등급 로컬
방식), Skill을 여기서 바로 활성화하지 않고 `tier1/`과 같은 위치에
"참조 원본"으로 뒀다 - `tier3/skill/.claude/skills/docs3-cli/SKILL.md`.
새 Tier 3 프로젝트가 이 디렉터리를 복사해 가면 그 프로젝트에서 자동
인식된다(`tier3/skill/README.md`에 설치 안내). 내용은 `docs/PROTOCOL.md`의
규칙(타입 분류·추적 번호·답변 대기 표기·PL→DN 전환)이 그대로 적용되고
"실행 방법만 docs3 명령으로 바뀐다"는 걸 강조하는 방향으로 썼다 - 로컬
파일을 직접 만들거나 고치지 말고 항상 `docs3` 경로로 가라는 게 핵심.

문서를 쓰다가 실제 CLI 명령과 서버 라우트를 하나씩 대조해보니 진짜로
빠진 게 있었다 - 기존 문서 본문을 통째로 갱신하는 경로(`POST doc/save`에
대응하는 CLI 명령)가 없었다. `new`(새 문서)와 `reply`(답변 대기 질문에
답)만 있고, 이 세션에서 PL-00001.md 자체를 몇 번이나 그렇게 고쳐온 "기존
SP/PL 본문 갱신"에 해당하는 명령이 빠져 있었던 것 - Skill 문서를 정확하게
쓰려다 발견한 실제 기능 공백이다. `docs3 save <projectId> <path> <로컬
파일>`을 추가해서 메꿨다(로컬 마크다운 파일을 읽어 그대로 `doc/save`
바디로 보냄).

검증은 여느 때처럼 스크래치 환경(bare 저장소 + SQLite 서비스 DB)에 실제
서버를 띄워서 했다 - 로그인 → 프로젝트 생성 → `new`로 SP 만들고 → `save`로
본문 교체 → `new`로 DC 만들고 → `save`로 "## 답변 대기" 질문을 추가 →
`pending`으로 조회 → `reply`로 답변 → `git commit`/`push`/`pull`까지
전부 실행했고, 프로젝트 checkout의 `git log`를 직접 열어 모든 커밋이
실제 요청자 이름(`clitest`)으로 남았는지 확인했다. `tsc` 빌드도 통과.
스크래치 환경/백그라운드 서버 정리, 실제 홈 디렉터리는 안 건드림.

PL-00001의 남은 건 이제 4단계(문서 정리 및 마무리)뿐이다.

### 2026-09-10 (계속 18) — 4단계: 문서 정리, PL-00001 → DN-00001 전환

"계속 진행해줘"로 마지막 단계를 마쳤다. `README.md`를 세 등급이 전부
갖춰진 지금 상태에 맞게 전면 개정 - 등급 비교표, 등급별 설치 안내(초간단
복붙/평범·고급 `docker compose up`), tier2/tier3 문서 링크를 추가했다.

`docs/PROTOCOL.md`(와 그 원본인 `tier1/docs/PROTOCOL.md`)는 손대지
않기로 판단했다 - PL-00001 4단계 원문은 "최종 3-등급 구조에 맞게 갱신"
이라고 적어뒀지만, 실제로 그 파일이 규정하는 건 `docs/` 파일 포맷
계약뿐이고 이건 애초에 등급과 무관하게 세 등급이 전부 공유하는
합의라 등급이 늘었다고 내용이 바뀔 이유가 없었다. 오히려
`tier1/docs/PROTOCOL.md`는 새 Tier 1 프로젝트에 그대로 bootstrap되는
템플릿이라, 거기에 Tier 2/3 CLI 얘기를 섞으면 Tier 1만 쓰는 사람에게
잘못된 안내가 된다 - "왜 안 고쳤는지"를 DN-00001에 명시적으로 남겨서
누락처럼 보이지 않게 했다.

등급별로 `DN`을 따로 만들지, 이 PL 전체를 한 번에 전환할지는 4단계
계획 문구가 열어둔 판단이었는데, 세 등급이 한 세션 안에서 연속으로
끝나서 굳이 쪼개면 배경 설명(DS-00001, 코드 공유 관계)만 세 번
반복될 뿐이라 판단해서 **하나의 DN-00001로 일괄 전환**했다.
`tier2/backend`의 `transitionDone()` 구현(`prisma`가 아니라 이 세션
초반에 직접 포팅한 core 함수)을 코드 그대로 손으로 재현 - DN
frontmatter(`id`/`type`/`title`/`created`/`updated`/`links`, status
없음)와 PL 스텁 형식(`status: done`, `links: [DN-00001]`, "완료됨 →
DN 참조" 본문)을 정확히 맞췄다. 전환 후 `docs/plan/index.md`에서
PL-00001 행 제거, `docs/done/index.md`에 DN-00001 등재,
`.tracking.json`의 DN 카운터를 0→1로 증가.

이 저장소 자신은 Tier 1 로컬 도구를 쓰지만, 검증 도구는 Tier 2의
`docs validate --root .`(같은 `core/validate.ts`를 코드로 공유)를 실제로
돌려서 새로 만든 DN-00001과 PL-00001 스텁이 스키마를 통과하는지
확인했다 - "모든 문서가 유효합니다".

이걸로 PL-00001(3개 배포 등급 재구성)이 완전히 끝났다 -
[DN-00001](docs/done/DN-00001.md) 참고.

### 2026-09-10 (계속 19) — tier2용 docs-cli Skill 신설, save 누락 + 문서화 버그 발견

설계자가 "tier2/CLAUDE.md, tier3/CLAUDE.md는 안 만들어도 되는지"를 먼저
물었을 때는 "SP-00001 3절에 이미 MCP 우선/CLI 폴백 원칙이 적혀 있으니
Tier 2엔 Skill이 필요 없다"고 답했다. 그런데 이어서 "tier2 CLI에도
skill 문서 필요한지 확인해줘"라고 재차 물어서 다시 들여다보니 이 답이
틀렸다는 걸 알아챘다 - [DS-00001](docs/design/DS-00001.md) 평범 절이
"Skill이 우선 MCP 도구 호출을 안내"라고 명시적으로 설계해뒀는데, 내가
근거로 든 SP-00001 3절 문구는 이 저장소 **자신의** 내부 스펙에만 있고
Tier 2를 실제로 채택하는 **다른** 프로젝트에는 전혀 전달되지 않는다는
걸 놓쳤다. PL-00001이 이미 DN-00001로 닫힌 뒤에 발견한 진짜 미완료
항목이었다.

`tier3/skill`과 똑같은 패턴으로 `tier2/skill/.claude/skills/docs-cli/
SKILL.md` + `tier2/skill/README.md`를 신설했다. 쓰다가 tier2의 `docs`
CLI/MCP에도 tier3와 같은 구멍이 있다는 걸 재확인 - 기존 문서 본문을
통째로 갱신하는 경로(`POST /api/doc/save`, 대시보드 편집기가 이미 쓰고
있음)가 CLI/MCP엔 없었다. `docs save <path> <file>`, MCP `docs_save`를
추가하고 `tsc` 빌드(tier2/tier3 둘 다, tier3가 tier2를 `file:` 의존성으로
참조하므로)로 확인.

이 명령을 스크래치 환경에서 검증하다가 **진짜 버그를 하나 잡았다** -
Skill 문서(tier2/tier3 둘 다)에 "프론트매터 포함 전체 마크다운을 그대로
넘긴다"고 적어놨었는데, 실제로 `saveDocBody`는 받은 문자열을 새
프론트매터 뒤에 그대로 이어붙인다(`dumpFrontmatter(meta, body)`) -
프론트매터를 포함해서 넘기면 저장된 파일 안에 프론트매터 블록이 두 번
겹쳐 들어간다. 실제로 재현해서 확인했고(파일을 열어보니 정말로
`---...---`가 두 번 있었다), 대시보드 편집기가 쓰는 `doc.body`엔 애초에
프론트매터가 없다는 것도 `DocViewer.vue` 코드로 재확인한 뒤 두 Skill
문서 모두 "본문만 넘긴다"로 정정 - 정정된 방식으로 다시 테스트해서
깨끗하게 저장되는 것까지 재확인.

겸사겸사 저장소 전체를 문서 검증기 + 상대링크 스캐너로 훑어서 두 가지를
더 잡았다: `docs/spec/SP-00003.md`가 `tier1/tools/docs/server.py`를
`../`가 하나 많은 잘못된 경로로 가리키던 실제 깨진 링크 하나, 그리고
`PL-00001 → DN-00001` 전환 이후 안 고쳐둔 "구현 노트는 PL-00001 N단계
참고" 식 링크 여러 개(README.md 두 곳, DC-00001/DC-00002, SP-00003 -
전부 DN-00001을 가리키게 정정). 상세는 [DN-00001](docs/done/DN-00001.md)
"종료 후 추가 발견 사항" 참고.

### 2026-09-10 (계속 20) — docs3 CLI 전면 재검증: 15개 명령 누락 발견 + 추가

"tier3 CLI도 같은 방식으로 한번 더 검증해줘"라는 요청으로, 이번엔
개별 명령 하나씩 보는 대신 `tier3/backend/src/api/server.ts`의 라우트
전체를 `docs3` CLI와 1:1로 대조했다. `save` 하나가 아니라 15개 명령이
통째로 빠져 있었다는 걸 이번에 알았다 - `register`(가입 경로 자체가
없었음), design/logs/all/search/validate, git log/blame/show/diff(이력
조회 - commit/push/pull만 있었음), comment list/add/resolve, changes
list/ack, 멤버 역할변경/제거. 규모가 커서 먼저 확인받고 진행했다.

추가하면서 진짜 버그를 하나 더 잡았다 - `git/blame`·`git/diff/:sha`는
`text/plain`을 돌려주는데 `apiCall<T>()`는 항상 `.json()`을 부르므로
그대로 쓰면 파싱 에러가 난다. `apiclient.ts`를 리팩터링해서 인증/refresh
로직을 공유하는 `apiFetch()`로 뽑고, JSON용 `apiCall()`/텍스트용
`apiCallText()`로 나눴다. `changes`도 tier2처럼 인자 없이 둘 수 없다는
걸 알아채서(`<projectId>`가 필요해 `ack` 서브커맨드와 위치 인자가
겹침) `git`/`comment`처럼 `list`/`ack` 서브커맨드를 가진 그룹으로
바꿨다.

검증은 스크래치 서버에 15개 명령을 전부 실행해서 확인했다 - register→
login→project-create→design/logs/validate(빈 프로젝트)→new→all/search
(한글)→save(본문만)→new(DC)→save(질문 추가)→pending→reply→comment
add/list/resolve→git log(요청자 이름으로 커밋된 것 확인)→git show/
diff/blame(텍스트 정상)→두 번째 계정 가입→invite→members→member-role→
member-remove→git commit/push/pull→logout. 스크래치 셋업 중 진짜
실수도 하나 났다 - bare 저장소를 `git init --bare`한 뒤 `main`에만
push했는데 이 환경 git 기본 브랜치가 `master`라 bare 저장소 HEAD가
계속 빈 `master`를 가리키고 있었다(project-create가 빈 작업 트리를
clone해서 `docs/.config.json` ENOENT) - `git branch -a`로 바로 원인
잡아내고 `master`에 다시 push해서 해결(tier3 코드 버그 아님).

`tier3/skill`의 "명령 전체 목록"에 15개 전부 반영, `SP-00002` 4절에도
표에 없던 라우트 존재를 명시. 상세는 [DN-00001](docs/done/DN-00001.md)
"tier3 CLI 전체 재검증" 참고.

### 2026-09-10 (계속 21) — tier2 CLI/MCP도 라우트 전체 대조: search 하나 누락

"tier2 CLI도 같은 방식으로 전체 라우트 대조해줘"로 `tier2/backend`의
라우트 25개를 `docs` CLI + MCP 도구와 전부 대조했다. tier3와 달리
이번엔 대부분 이미 맞춰져 있었고 - `search` 딱 하나만 빠져 있었다.
`GET /api/search?q=` 라우트는 있는데 CLI(`docs search`)도 MCP
(`docs_search`)도 없었다. 추가하고 스크래치 환경에서 CLI/MCP 양쪽
다 한글 검색어로 실제 결과가 나오는 것까지 확인했다. `tier2/skill`
SKILL.md와 `SP-00001` 3·4절에도 반영.

이걸로 tier2/tier3 두 CLI(및 tier2 MCP) 모두 실제 REST 라우트 표면과
완전히 1:1로 맞춰졌다 - 상세는 [DN-00001](docs/done/DN-00001.md)
"tier2 CLI/MCP도 같은 방식으로 라우트 전체 대조" 참고.

### 2026-09-10 (계속 22) — tier1: CLI가 아니라 대시보드 UI 4곳 준동문 발견+연결

"tier1 CLI도 같은 방식으로 전체 대조해줘"에 먼저 전제부터 정정했다 -
Tier 1은 CLI가 없다(DS-00001: Claude는 파일을 직접 편집·확인, HTTP
API를 안 씀). 그래서 같은 방법론을 적용할 대상은 `server.py` 라우트
vs 유일한 실제 소비자인 대시보드 프론트(`static/app.js`, 사람 설계자
화면)로 바꿔서 진행했다.

라우트-프론트 대조로 준동문 4개를 찾았다 - 전체 미답변 목록(`/api/
pending`), 검색(`/api/search`, 검색창 자체가 없었음), git blame,
커밋 클릭 시 "변경된 파일" 목록. 규모 확인받고 4개 다 dependency-free
vanilla JS로 연결 - 사이드바 검색창, "답변 대기" 탭(클릭하면 문서+
답변 다이얼로그 동시에 열림), blame 토글, 커밋 diff 위 파일 목록.

검증 중 실수 하나 - 스크래치 서버를 포트 8760으로 띄웠는데 이 저장소
에서 동시에 작업 중인 다른 세션(`claude-native-workflow-44`)이 이미
그 포트에서 저장소 루트를 가리키는 자기 대시보드를 띄워두고 있어서,
처음엔 내 스크래치 문서가 아니라 이 저장소의 진짜 운영 문서가 뜨는 걸
보고 당황했다. 다른 세션 프로세스는 안 건드리고 내 서버만 다른
포트(8799)로 옮겨서 해결 - 그쪽엔 읽기 전용 GET 호출 몇 개 말고 영향
없음.

브라우저로 검색/답변 대기 탭/blame/커밋 파일목록 전부 직접 클릭해
확인, 기존 "문서" 탭 회귀 없음과 콘솔 에러 없음까지 확인. 상세는
[DN-00001](docs/done/DN-00001.md) "tier1 — CLI가 아니라 대시보드 UI와
라우트를 대조" 참고.

### 2026-09-10 (계속 23) — QA 확대: tier2/dashboard(Quasar)도 준동문 3개+1

"QA 진행하면서 미비되거나 보완해야될걸 찾으면서 문서화도 하고 커밋,
푸시도 단위별로 진행하도록 해"라는 지시로, tier1에서 찾은 패턴(백엔드
메서드는 있는데 화면이 안 씀)을 tier2/dashboard(Quasar)에도 적용했다.
`api.ts`의 `client` 객체 vs 실제 `.vue`가 부르는 지점을 대조해서
`validate`/`gitBlame`/`gitCommit`(파일 목록) 3개가 완전히 준동문,
전체 답변 대기 뷰도 없다는 걸 확인(`search`는 `ReplyDialog.vue`가
내부적으로만 씀 - tier1과 똑같은 증상).

tier1과 같은 4가지를 Quasar 컴포넌트로 연결 - 사이드바 검색 입력,
"답변 대기" 탭(클릭 시 문서+답변 다이얼로그 동시 오픈), 헤더 "검증"
버튼(결과 다이얼로그), 커밋 이력 섹션에 blame 토글+"변경된 파일"
목록. `api.ts`에 실제 반환 모양에 맞는 `SearchResult` 타입도 새로
만들었다(기존 `DocListItem[]` 타입은 부정확했음).

`tier3/dashboard`가 `DocViewer.vue`/`DocTree.vue`를 그대로 재사용하므로
blame·커밋 파일 목록은 자동으로 같이 적용된다 - 검색/전체 답변 대기/
검증은 tier3가 자기 `DashboardView.vue`를 따로 갖고 있어서 다음 QA
단위에서 별도로 본다.

`vue-tsc -b`(tier2/tier3 둘 다) 통과 확인 후 스크래치 프로젝트에 실제
서버를 띄워 브라우저로 4개 기능 전부 클릭 검증, 콘솔 에러 없음까지
확인. 상세는 [DN-00001](docs/done/DN-00001.md) "QA 확대: tier2/dashboard
(Quasar)도 같은 준동문 패턴 발견" 참고.

### 2026-09-10 (계속 24) — QA 단위 이어서: tier3/dashboard도 동일 적용

예고한 다음 단위 - tier3는 `App.vue`를 안 쓰고 자기 `DashboardView.vue`
를 따로 갖고 있어서 tier2 쪽 수정만으론 검색/전체 답변 대기/검증이
안 딸려왔다. 같은 3가지를 그대로 옮겨 붙였다 - `DocViewer.vue` 재사용
덕에 blame·커밋 파일 목록은 이미 공짜로 따라와 있었으니 이걸로 tier3도
tier2와 완전히 같은 기능 집합.

실제 Tier 3 스택(스크래치 bare 저장소+SQLite 서비스 DB로 backend, dev
서버로 dashboard)에서 검증 - `docs3` CLI로 계정/프로젝트/pending 질문을
미리 만들어두고 브라우저로 로그인→검색→답변 대기 탭(문서+다이얼로그
동시 오픈, 커밋 이력에 실제 요청자 이름 확인)→검증 버튼까지 전부 확인,
콘솔 에러 없음, `vue-tsc -b` 통과.

이걸로 tier1/tier2/tier3 세 대시보드 전부 같은 QA 방식(백엔드 기능인데
화면에 안 뚫려 있는 것 찾기)을 한 바퀴 돌았다 - 상세는
[DN-00001](docs/done/DN-00001.md) "QA 단위 이어서: tier3/dashboard의
DashboardView.vue에도 동일 적용" 참고.

### 2026-09-10 (계속 25) — QA: validator 정합성 재확인 + 서비스 DB 진짜 postgres로 검증, 진짜 버그 발견

두 가지를 더 봤다. 하나는 확인만 - `docs/PROTOCOL.md` 3절 검증 규칙이
Tier1(Python) `validate_doc`과 Tier2(TypeScript) `validateDoc`에서
여전히 완전히 일치하는지(SP-00003 7.4절 정합성 원칙) 줄 단위로 대조,
드리프트 없음. `--validate` 플래그도 정상/깨진 문서 양쪽 실제 실행해
exit code까지 확인.

다른 하나는 진짜 버그를 찾았다 - 선택적 서비스 DB(`docs db enable/
disable`)를 이 세션 내내 SQLite로만 "서비스 DB"를 흉내 내며 테스트해
왔었는데, Docker로 실제 `postgres:16-alpine`을 띄워 처음 제대로
검증해봤다. 첫 enable은 됐는데, `disable`(기본값 `--drop` 없음) 후
다시 `enable`하니 `Unique constraint failed`로 실패했다 - 이전
사이클에 서비스 DB에 남아있던 행 위에 로컬 상태를 그대로 `create()`
하려다 기본키가 충돌한 것. `disable`은 로컬 쪽을 지우고 다시 채우는데
`enable`은 서비스 DB 쪽을 안 지우고 무조건 create만 해서 생긴 비대칭
버그 - "enable→disable(--drop 없이)을 한 번이라도 거치면 그다음
enable은 항상 실패한다"는 뜻이었다. `enableServiceDb`에 `deleteMany()`
로 먼저 비우는 처리를 대칭으로 추가해서 고쳤고, enable→disable(기본)→
enable→disable(--drop)→enable 5단계 전체를 실제 postgres로 다시
돌려 `psql`로 직접 확인까지 통과.

### 2026-09-10 (계속 26) — QA: 진짜 저장형 XSS 발견 + 수정

보안 관점으로 방향을 바꿔봤다. `tier2/dashboard`(→ `tier3/dashboard`도
그대로 재사용)의 `DocViewer.vue`가 `marked.parse()` → `v-html`로 문서
본문을 렌더링하는데, `marked`는 raw HTML을 기본 통과시킨다(sanitize
옵션이 v5+에서 없어짐) - `tier1`의 손수 짠 렌더러는 애초에 HTML을
이스케이프하고 시작해서 이 문제가 없다는 것도 대조하며 확인.

`<img src=x onerror="...">`를 본문에 심은 문서로 실제 재현 - 문서를
열자마자 스크립트가 실행돼 탭 제목이 바뀌는 것까지 직접 봤다. 진짜
저장형 XSS였다 - 문서를 쓸 수 있는 사람(tier3라면 editor)이면 그
문서를 보는 다른 사람(owner 포함)의 브라우저에서 임의 코드를 실행시킬
수 있었다는 뜻이고, localStorage의 로그인 토큰을 훔치는 권한 상승까지
이론상 가능했다.

`dompurify`를 추가해서 `marked.parse()` 출력을 `v-html`에 넣기 전에
`sanitize()`로 걸러내도록 고쳤다. 같은 페이로드로 재검증 - `onerror`
실행 안 됨, 안전한 raw HTML(`<img>`, `<b>`)은 그대로 정상 렌더링(과도한
차단 없음)까지 확인. `tier2/tier3 dashboard` 둘 다 `vue-tsc -b`와 실제
프로덕션 `vite build` 통과, `dompurify`가 tier3에도 별도 설치 없이
그대로 재사용되는 것까지 확인. 상세는 [DN-00001](docs/done/DN-00001.md)
"QA: 저장형 XSS(stored XSS) 진짜 취약점 발견 + 수정" 참고.
