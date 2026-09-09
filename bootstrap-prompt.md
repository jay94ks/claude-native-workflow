# 새 프로젝트 문서 워크플로우 부트스트랩

아래 지시를 따라 이 프로젝트에 설계/기획 문서 워크플로우(`docs/` 체계 +
`CLAUDE.md` + `tools/docs` 대시보드)를 구축해줘.

## 지시사항

1. 아래 "파일 목록"에 나열된 각 파일을, 표시된 경로에 **주어진 내용 그대로**
   생성해. 이미 같은 경로에 파일이 있다면 덮어쓰기 전에 나에게 확인해줘
   (특히 `CLAUDE.md`는 기존 내용이 있으면 이 섹션을 병합해줘, 통째로 덮어쓰지 말고).
2. 폴더가 없으면 만들어. `docs/.tracking.json`은 카운터 상태 파일이니 있는
   그대로(모두 0) 생성해.
3. 모든 파일 생성이 끝나면:
   - `docs/index.md`의 표와 실제로 생성된 파일 목록이 일치하는지 확인해.
   - `python tools/docs/server.py` 로 대시보드가 뜨는지 확인해줘(가능하면).
   - 이 프로젝트의 고유한 빌드/테스트/코딩 규칙이 있다면 `CLAUDE.md` 맨 아래
     플레이스홀더 자리에 이어서 물어보고 채워줘.
4. 이후 내 프롬프트를 받을 때마다 `docs/PROTOCOL.md` 7절의 절차(기존 문서 확인 →
   문서 갱신/생성 → 계획은 승인 후 실행 → PL→DN 전환 → 답변 대기 알림)를 따라줘.

## 파일 목록

### 파일: `CLAUDE.md`

````markdown
# CLAUDE.md

## 설계 문서 워크플로우

이 프로젝트의 설계/기획 논의는 `docs/` 문서 공간을 통해서만 진행한다. 전체 규칙은
[docs/PROTOCOL.md](docs/PROTOCOL.md)를 따른다. 요약:

- 문서는 `[TYPE]-[00001].md` 형식의 추적 번호를 가지며, 타입별로 `docs/<폴더>/`에
  저장되고 `docs/<폴더>/index.md`에 등재된다. 번호 발급은 `docs/.tracking.json`을
  따른다.
- 설계자의 프롬프트를 받으면:
  1. `docs/index.md`와 관련 타입 색인에서 기존 문서를 먼저 확인한다.
  2. 필요한 문서(`SP`/`PL`/`DS`/...)를 갱신·생성하고, 결정/검토/수정이 필요한
     지점은 `DC`/`RV`/`FX`로 분리해 등재한다(`docs/PROTOCOL.md` 4절 형식).
  3. 실행 계획(`PL`)은 즉시 실행하지 말고 요약을 제시해 검토·승인을 받은 뒤에만
     진행한다.
  4. 계획이 완료되면 `PL → DN` 전환 절차(`docs/PROTOCOL.md` 5절)를 따른다.
- `docs/reply/index.md`에 미답변 항목이 있으면 대화 시작 시 설계자에게 알린다.
- 문서/설계를 언급할 때는 항상 해당 섹션 딥링크를 함께 제시한다
  (예: `[DC-00005](docs/decision/DC-00005.md#선택지-b)`).
- `tools/docs`는 설계자 전용 로컬 대시보드다. 프로젝트 산출물이 아니며, 빌드/배포
  대상에 포함하지 않는다. 실행: `python tools/docs/server.py`.

<!-- 아래에 프로젝트 고유의 빌드/테스트/코딩 규칙을 추가한다. -->
````

### 파일: `docs/index.md`

```markdown
# 문서 색인 (IX-00000)

이 프로젝트의 모든 설계/기획 문서는 이 색인 체계를 따른다. 전체 규칙은
[docs/PROTOCOL.md](PROTOCOL.md)를 참고한다.

## 타입 분류표

| 타입 | 대상 | 색인 파일 | 비고 |
|---|---|---|---|
| `IX` | 최상위 색인/레지스트리 | [docs/index.md](index.md) | 이 문서 |
| `SP` | `docs/spec/` | [docs/spec/index.md](spec/index.md) | 설계 명세 |
| `PL` | `docs/plan/` | [docs/plan/index.md](plan/index.md) | 실행 계획 |
| `DN` | `docs/done/` | [docs/done/index.md](done/index.md) | 결과 보고 |
| `DS` | `docs/design/` | [docs/design/index.md](design/index.md) | 설계 |
| `RM` | `docs/remind/` | [docs/remind/index.md](remind/index.md) | 기억하라고 지시받은 것들 |
| `TP` | `docs/temp/` | [docs/temp/index.md](temp/index.md) | 임시로 문서화한 것들 |
| `DC` | `docs/decision/` | [docs/decision/index.md](decision/index.md) | 결정 요청 |
| `RV` | `docs/review/` | [docs/review/index.md](review/index.md) | 검토 요청 |
| `FX` | `docs/fix/` | [docs/fix/index.md](fix/index.md) | 수정 검토 |
| `LG` | `docs/logs/` | [docs/logs/index.md](logs/index.md) | 답변 처리 기록 |
| `RP` | `docs/reply/` | [docs/reply/index.md](reply/index.md) | 답변 항목 (미답변 큐) |

## 하위 색인 바로가기

- [설계 명세 (SP)](spec/index.md)
- [실행 계획 (PL)](plan/index.md)
- [결과 보고 (DN)](done/index.md)
- [설계 (DS)](design/index.md)
- [기억 지시 (RM)](remind/index.md)
- [임시 문서 (TP)](temp/index.md)
- [결정 요청 (DC)](decision/index.md)
- [검토 요청 (RV)](review/index.md)
- [수정 검토 (FX)](fix/index.md)
- [처리 기록 (LG)](logs/index.md)
- [답변 큐 (RP)](reply/index.md)
```

### 파일: `docs/PROTOCOL.md`

````markdown
# 문서 기반 설계 워크플로우 프로토콜 (v1)

이 프로젝트의 모든 설계/기획 논의는 `docs/`를 매개로 진행한다. Claude는 설계자의
프롬프트를 받으면 이 규칙에 따라 문서를 갱신/생성하고, `tools/docs` 대시보드로
조회·답변할 수 있게 유지한다.

## 1. 타입 분류표

[docs/index.md](index.md)의 표가 원본이다. 요약:

`IX`(최상위 색인) · `SP`(설계 명세) · `PL`(실행 계획) · `DN`(결과 보고) ·
`DS`(설계) · `RM`(기억 지시) · `TP`(임시 문서) · `DC`(결정 요청) · `RV`(검토 요청) ·
`FX`(수정 검토) · `LG`(처리 기록) · `RP`(답변 항목)

모든 타입은 `docs/<폴더>/index.md` 색인 파일을 가지며, 문서 파일명은
`[TYPE]-[00001].md` (0패딩 5자리) 형식이다. **`RP`만 예외**로 자기 파일이
없다 — 답변 대상 문서 안의 앵커일 뿐이다(3절, 6절).

## 2. 추적 번호

- `docs/.tracking.json`에 타입별 다음 번호(next seq)를 저장한다.
- 새 문서를 만들 때: 해당 타입 값을 읽고 → 그 값+1을 번호로 사용 → 파일에 즉시
  갱신된 값을 다시 쓴다. 번호는 결번이 생겨도 재사용하지 않는다.
- 이 파일은 사람이 읽는 문서가 아니다. 색인에 나타나지 않는다.

## 3. 프론트매터 스키마

모든 문서는 아래 YAML 프론트매터로 시작한다.

```yaml
---
id: SP-00012
type: SP
title: 인증 흐름 재설계
status: draft
created: 2026-09-09
updated: 2026-09-09
links: [DS-00003, PL-00002]
reply_pending: false
---
```

`status` 값은 타입별로 다르다:

| 타입 | 상태값 |
|---|---|
| `SP`/`DS`/`RM`/`TP` | `draft` → `active` → `superseded` / `archived` |
| `PL` | `planned` → `in_progress` → `done` |
| `DC`/`RV`/`FX` | `open` → `answered` → `applied` (`FX`는 `rejected`/`wontfix` 가능) |
| `RP` | `pending` → `answered` |
| `DN`/`LG` | 상태 없음(기록물) |

**`RP`는 예외적으로 자기 파일을 갖지 않는다.** 답변 전문은 답변 대상
문서(`DC`/`RV`/`FX`) 자체의 "## 답변 기록" 섹션에 `### RP-XXXXX` 소제목으로
직접 적힌다(5절, 6절). `RP-XXXXX`는 그 소제목이 만드는 문서 내 앵커
(`#rp-00005`)일 뿐, 별도 파일이나 `docs/reply/` 아래 산출물이 아니다 — 질문이
몇 개든 답변 대상 문서 1개당 파일이 늘어나지 않게 하기 위한 설계.

## 4. 답변 대기 항목 표기 규칙

`DC`/`RV`/`FX` 문서 본문에 답변 대기 항목은 반드시 아래 형식의 섹션으로 적는다
(대시보드가 이 패턴을 정규식으로 스캔해서 카드를 만든다):

```markdown
## 답변 대기
- [ ] (Q1) 인증 토큰 저장 방식은 A안(로컬스토리지)/B안(세션 쿠키) 중 무엇으로?
- [ ] (Q2) 세션 만료 시간은 몇 분으로?
```

**질문 바로 아래 들여쓴 줄로 권장/대안을 붙일 수 있다(선택)** — 대시보드가
이걸 답변 다이얼로그의 원클릭 채우기 버튼으로 보여준다. 없어도 되고, 있으면
설계자가 프롬프트로 직접 물었을 때 Claude가 그랬던 것처럼 "권장 + 이유"를
먼저, 나머지 대안을 뒤에 적는다:

```markdown
## 답변 대기
- [ ] (Q1) 로컬 API 서버 프레임워크는?
  - 권장: Express — 생태계가 가장 넓고 실수가 적음
  - 대안: Fastify — 스키마 검증 내장, 생태계는 더 작음
```

답변이 처리되면 해당 줄이 다음과 같이 바뀐다(링크는 같은 문서 안의 앵커,
`권장`/`대안` 줄은 무엇이 제안됐었는지 기록으로 그대로 남는다):

```markdown
- [x] (Q1) 인증 토큰 저장 방식은 A안(로컬스토리지)/B안(세션 쿠키) 중 무엇으로? → [RP-00007](#rp-00007)
```

`- [ ]`가 하나도 남지 않으면 프론트매터 `reply_pending`을 `false`로 내린다.

## 5. 문서 생애주기

1. 모든 문서는 자기 타입의 색인 파일에 등재되어야 한다.
2. 색인 항목이 30개를 넘는 카테고리는 하위 폴더 + 별도 `index.md`를 만들고
   상위 색인에서 링크한다.
3. **`PL` → `DN` 전환**: 계획이 완료되면
   - `docs/done/DN-XXXXX.md`를 새로 만들어 계획 원문 + 결과 보고를 함께 적는다.
   - 원본 `docs/plan/PL-XXXXX.md`는 삭제하지 않고 스텁으로 축소한다:
     ```markdown
     ---
     id: PL-00002
     type: PL
     status: done
     ---
     # (완료됨) → [DN-00001](../done/DN-00001.md) 참조
     ```
   - `docs/plan/index.md`에서는 제거하되 스텁 파일은 남겨 링크를 보존한다.
4. 문서/설계를 가리킬 때는 항상 해당 섹션 딥링크를 함께 쓴다. 앵커는 GitHub
   스타일 헤딩 슬러그(소문자화, 공백→`-`, 특수문자 제거)를 따른다.

## 6. 답변(RP) 처리 흐름

1. 설계자가 답변을 입력하면(대시보드 다이얼로그 또는 채팅으로 직접) `RP`
   번호를 새로 발급하되, 파일은 만들지 않는다.
2. 대상 문서(`DC`/`RV`/`FX`)에서:
   - 4절 표기대로 해당 줄을 `[x]`로 바꾸고 `→ [RP-XXXXX](#rp-xxxxx)` 링크를
     남긴다.
   - 문서 하단(없으면 새로 만드는) "## 답변 기록" 섹션에 `### RP-XXXXX`
     소제목으로 질문/답변 전문을 적는다. 한 문서에 질문이 여러 개면 이
     섹션 안에 `### RP-...` 소제목이 여러 개 쌓인다 — 질문 개수만큼
     새 파일이 생기지 않는다.
3. `docs/reply/index.md`에서 해당 항목을 제거한다(이 파일은 미답변만 유지 —
   RP 파일 목록이 아니라 "아직 답변 안 된 (Qn) 목록"이다).
4. `docs/logs/`에서 **대상 문서당 LG 파일 1개**를 찾아 없으면 새로 만들고,
   있으면 처리 내역 한 줄을 이어붙인다(이것도 질문마다 새 파일을 만들지
   않는다). 처리 내역은 어떤 문서의 어떤 질문에 어떤 RP 앵커로 답이 반영됐는지
   적는다.
5. 후속 조치(문서/코드 반영)가 끝나면 대상 문서 상태를 `applied`로 올린다.

이 흐름 덕분에 질문 N개짜리 결정 요청 하나를 답변 처리해도 늘어나는 파일은
최대 1개(그 문서의 LG 로그, 이미 있으면 0개)뿐이다 — `DC`/`RV`/`FX` 자체와
`docs/logs/`의 LG만 프로젝트 규모에 비례해서 늘고, 나머지는 늘지 않는다.

## 7. 설계자 프롬프트 처리 순서 (Claude 운영 규칙)

설계자의 프롬프트를 받으면:

1. `docs/index.md` 및 관련 타입 색인에서 기존 문서를 먼저 확인한다.
2. 필요한 문서(`SP`/`PL`/`DS`/...)를 갱신하거나 새로 만든다. 결정/검토/수정이
   필요한 지점은 `DC`/`RV`/`FX`로 분리해 4절 형식으로 등재한다.
3. 실행 계획(`PL`)을 세운 뒤에는 바로 실행하지 말고, 계획 요약을 제시해 검토를
   요청하고 승인을 받은 뒤에만 진행한다.
4. 계획이 완료되면 5절의 `PL → DN` 전환 절차를 따른다.
5. `docs/reply/`에 미답변 항목이 있으면 대화 시작 시 알려준다.
6. 문서/설계를 언급할 때는 항상 해당 섹션 딥링크를 함께 제시한다.

## 8. `tools/docs` 대시보드

설계자 전용 로컬 도구(프로젝트 산출물 아님). 실행:

```bash
python tools/docs/server.py
```

기본적으로 `http://localhost:8756`에서 열리며, 좌측 트리(문서 계층), `문서`/`설계`
(`DC`/`RV`/`FX`)/`기록`(`LG`) 탭, 답변 대기 카드와 다이얼로그를 제공한다. 문서
본문은 대시보드에서 직접 편집할 수도 있다(각 문서 뷰의 "편집" 버튼 — 마크다운
툴바로 굵게/취소선/제목/코드/링크를 넣을 수 있다). **프론트매터는 이 편집기가
건드리지 않는다** — `id`/`type`/`status`/`links` 같은 구조적 필드는 여전히
답변 처리 흐름이나 Claude와의 대화로만 바뀐다. 저장 시 서버가 7절의 구조
검증을 통과해야만 실제로 파일에 반영한다. 새 문서 생성은 여전히 Claude와의
대화로만 이뤄진다(번호 발급·색인 등재까지 걸린 절차라 대시보드에서 직접
만들지 않는다).

문서 수가 늘어나도 매 요청마다 전체 파일을 다시 읽지 않도록, 대시보드
프로세스가 파일별 mtime을 기준으로 프론트매터·답변 대기 목록을 메모리에
캐싱한다(파일이 바뀌지 않았으면 다시 읽지 않음). 대시보드를 재시작하면
캐시는 사라지지만 다음 요청에서 다시 채워질 뿐, 데이터 손실은 없다.
````

### 파일: `docs/.tracking.json`

```json
{
  "IX": 0,
  "SP": 0,
  "PL": 0,
  "DN": 0,
  "DS": 0,
  "RM": 0,
  "TP": 0,
  "DC": 0,
  "RV": 0,
  "FX": 0,
  "LG": 0,
  "RP": 0
}
```

### 파일: `docs/spec/index.md`

```markdown
# 설계 명세 색인 (SP)

> 제품/기술 설계 명세 문서.
> 상위 색인: [docs/index.md](../index.md) · 전체 규칙: [docs/PROTOCOL.md](../PROTOCOL.md)

| 번호 | 제목 | 상태 | 갱신일 |
|---|---|---|---|
| _(아직 문서 없음)_ | | | |
```

### 파일: `docs/plan/index.md`

```markdown
# 실행 계획 색인 (PL)

> 승인된 실행 계획. 완료되면 done/으로 전환(스텁만 남김).
> 상위 색인: [docs/index.md](../index.md) · 전체 규칙: [docs/PROTOCOL.md](../PROTOCOL.md)

| 번호 | 제목 | 상태 | 갱신일 |
|---|---|---|---|
| _(아직 문서 없음)_ | | | |
```

### 파일: `docs/done/index.md`

```markdown
# 결과 보고 색인 (DN)

> 완료된 계획 + 결과 보고서.
> 상위 색인: [docs/index.md](../index.md) · 전체 규칙: [docs/PROTOCOL.md](../PROTOCOL.md)

| 번호 | 제목 | 상태 | 갱신일 |
|---|---|---|---|
| _(아직 문서 없음)_ | | | |
```

### 파일: `docs/design/index.md`

```markdown
# 설계 색인 (DS)

> 구조/아키텍처 설계 문서.
> 상위 색인: [docs/index.md](../index.md) · 전체 규칙: [docs/PROTOCOL.md](../PROTOCOL.md)

| 번호 | 제목 | 상태 | 갱신일 |
|---|---|---|---|
| _(아직 문서 없음)_ | | | |
```

### 파일: `docs/remind/index.md`

```markdown
# 기억 지시 색인 (RM)

> 설계자가 기억하라고 지시한 항목.
> 상위 색인: [docs/index.md](../index.md) · 전체 규칙: [docs/PROTOCOL.md](../PROTOCOL.md)

| 번호 | 제목 | 상태 | 갱신일 |
|---|---|---|---|
| _(아직 문서 없음)_ | | | |
```

### 파일: `docs/temp/index.md`

```markdown
# 임시 문서 색인 (TP)

> 임시로 문서화한 것들. 정리 대상.
> 상위 색인: [docs/index.md](../index.md) · 전체 규칙: [docs/PROTOCOL.md](../PROTOCOL.md)

| 번호 | 제목 | 상태 | 갱신일 |
|---|---|---|---|
| _(아직 문서 없음)_ | | | |
```

### 파일: `docs/decision/index.md`

```markdown
# 결정 요청 색인 (DC)

> 여러 선택지 중 설계자가 확정해야 하는 항목.
> 상위 색인: [docs/index.md](../index.md) · 전체 규칙: [docs/PROTOCOL.md](../PROTOCOL.md)

| 번호 | 제목 | 상태 | 갱신일 |
|---|---|---|---|
| _(아직 문서 없음)_ | | | |
```

### 파일: `docs/review/index.md`

```markdown
# 검토 요청 색인 (RV)

> 잠정 결정에 대한 설계자 확인/승인이 필요한 항목.
> 상위 색인: [docs/index.md](../index.md) · 전체 규칙: [docs/PROTOCOL.md](../PROTOCOL.md)

| 번호 | 제목 | 상태 | 갱신일 |
|---|---|---|---|
| _(아직 문서 없음)_ | | | |
```

### 파일: `docs/fix/index.md`

```markdown
# 수정 검토 색인 (FX)

> 발견된 버그/불일치/제한 사항의 처리 방침 검토.
> 상위 색인: [docs/index.md](../index.md) · 전체 규칙: [docs/PROTOCOL.md](../PROTOCOL.md)

| 번호 | 제목 | 상태 | 갱신일 |
|---|---|---|---|
| _(아직 문서 없음)_ | | | |
```

### 파일: `docs/logs/index.md`

```markdown
# 처리 기록 색인 (LG)

> RP 답변 처리 결과 기록.
> 상위 색인: [docs/index.md](../index.md) · 전체 규칙: [docs/PROTOCOL.md](../PROTOCOL.md)
>
> 이 표는 `tools/docs` 대시보드가 자동으로 재생성한다(수동 편집 금지, 마커 사이만 갱신됨).

<!-- TABLE:START -->
| 번호 | 대상 문서 | RP | 처리일 |
|---|---|---|---|
| _(아직 문서 없음)_ | | | |
<!-- TABLE:END -->
```

### 파일: `docs/reply/index.md`

```markdown
# 답변 큐 (RP)

> **이 파일에는 미답변 항목만 나열한다.** RP 번호는 답변이 입력되는 시점에
> 발급되며 별도 파일을 만들지 않는다 — 답변 대상 문서 안의 "## 답변 기록"
> 섹션에 `### RP-XXXXX` 앵커로 직접 적힌다(`docs/PROTOCOL.md` 6절). 답변이
> 입력되면 이 목록에서 제거하고, 처리 결과는
> [docs/logs/index.md](../logs/index.md)에 기록한다.
> 상위 색인: [docs/index.md](../index.md) · 전체 규칙: [docs/PROTOCOL.md](../PROTOCOL.md)
>
> 이 표는 `tools/docs` 대시보드가 자동으로 재생성한다(수동 편집 금지, 마커 사이만 갱신됨).

<!-- TABLE:START -->
| 대상 문서 | 질문 ID | 질문 요약 | 등록일 |
|---|---|---|---|
| _(미답변 항목 없음)_ | | | |
<!-- TABLE:END -->
```

### 파일: `tools/docs/server.py`

```python
#!/usr/bin/env python3
"""tools/docs dashboard - zero-dependency local tool for the docs/ design workflow.

Designer-only tool, not part of the project deliverable. Serves a small SPA
that browses docs/ and lets the designer answer pending questions raised in
DC/RV/FX documents.

Run:
    python tools/docs/server.py [--port 8756] [--root <project-root>]
"""
import argparse
import datetime
import json
import re
import sqlite3
import subprocess
import sys
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

TYPE_NAMES = {
    "IX": "최상위 색인", "SP": "설계 명세", "PL": "실행 계획", "DN": "결과 보고",
    "DS": "설계", "RM": "기억 지시", "TP": "임시 문서", "DC": "결정 요청",
    "RV": "검토 요청", "FX": "수정 검토", "LG": "처리 기록", "RP": "답변 항목",
}
DESIGN_TYPES = {"DC", "RV", "FX"}
PENDING_RE = re.compile(r"^- \[ \] \(Q(\d+)\) (.+)$", re.MULTILINE)

STATIC_DIR = Path(__file__).parent / "static"
ARGS = None


# ---------------------------------------------------------------- frontmatter

def parse_frontmatter(text):
    if not text.startswith("---"):
        return {}, text
    lines = text.split("\n")
    if lines[0].strip() != "---":
        return {}, text
    end_idx = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end_idx = i
            break
    if end_idx is None:
        return {}, text
    fm_lines = lines[1:end_idx]
    body = "\n".join(lines[end_idx + 1:])
    if body.startswith("\n"):
        body = body[1:]

    meta = {}
    i = 0
    while i < len(fm_lines):
        line = fm_lines[i]
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            i += 1
            continue
        if ":" not in line:
            i += 1
            continue
        key, _, val = line.partition(":")
        key = key.strip()
        val = val.strip()
        if val in ("|", "|-"):
            block = []
            i += 1
            base_indent = None
            while i < len(fm_lines):
                l = fm_lines[i]
                if l.strip() == "":
                    block.append("")
                    i += 1
                    continue
                indent = len(l) - len(l.lstrip(" "))
                if base_indent is None:
                    base_indent = indent
                if indent < base_indent:
                    break
                block.append(l[base_indent:])
                i += 1
            meta[key] = "\n".join(block).rstrip("\n")
            continue
        elif val.startswith("[") and val.endswith("]"):
            meta[key] = [v.strip() for v in val[1:-1].split(",") if v.strip()]
        elif val.lower() in ("true", "false"):
            meta[key] = val.lower() == "true"
        elif len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
            meta[key] = val[1:-1]
        else:
            meta[key] = val
        i += 1
    return meta, body


def dump_frontmatter(meta, body):
    lines = ["---"]
    for k, v in meta.items():
        if isinstance(v, list):
            lines.append(f"{k}: [{', '.join(str(x) for x in v)}]")
        elif isinstance(v, bool):
            lines.append(f"{k}: {'true' if v else 'false'}")
        elif isinstance(v, str) and "\n" in v:
            lines.append(f"{k}: |")
            for l in v.split("\n"):
                lines.append(f"  {l}")
        else:
            lines.append(f"{k}: {v}")
    lines.append("---")
    return "\n".join(lines) + "\n" + body


# ---------------------------------------------------------------- docs scan

def project_root():
    return Path(ARGS.root).resolve()


def docs_dir():
    return project_root() / "docs"


def rel(path: Path):
    return str(path.relative_to(docs_dir())).replace("\\", "/")


def iter_doc_files():
    d = docs_dir()
    if not d.exists():
        return
    for p in sorted(d.rglob("*.md")):
        if p.stem == "index" or p.name == "PROTOCOL.md":
            continue
        yield p


def read_doc(path: Path):
    text = path.read_text(encoding="utf-8")
    meta, body = parse_frontmatter(text)
    return text, meta, body


# ---------------------------------------------------------------- meta cache
#
# Every list/tree endpoint used to open + parse every *.md file on every
# request. That's fine for a handful of docs but gets visibly slow as a
# project accumulates hundreds of them (each is a full file read + regex
# parse on every request, even when nothing changed since the last one).
# The server is a long-running process (ThreadingHTTPServer), so a plain
# in-memory dict keyed by mtime is enough - no need for a cache file on
# disk. A file is only re-read/re-parsed when its mtime no longer matches
# what we last saw; everything here is derived from docs/*.md, so losing
# the cache on restart just costs one full (still fast) rescan.

_META_CACHE_LOCK = threading.Lock()
_META_CACHE = {}  # rel_path -> (mtime, meta, pending_list, size)


def scan_meta(path: Path, source="scan"):
    """(meta, pending_list) for path, via the mtime+size checked in-memory
    cache (SP-00003 6.2). Unchanged files cost one stat() call, no read.
    When a file actually changed since we last saw it (not a cold start),
    records a change_notice - this is the single place that happens, so
    every caller (tree/list/search, and eventually git-pull/webhook/api
    handlers once those exist) gets it for free."""
    rel_path = rel(path)
    st = path.stat()
    with _META_CACHE_LOCK:
        cached = _META_CACHE.get(rel_path)
        if cached and cached[0] == st.st_mtime and cached[3] == st.st_size:
            return cached[1], cached[2]
        was_cached = cached is not None

    _, meta, body = read_doc(path)
    pending = scan_pending_in_text(body)
    with _META_CACHE_LOCK:
        _META_CACHE[rel_path] = (st.st_mtime, meta, pending, st.st_size)

    if was_cached:
        create_change_notice(rel_path, source, git_diff_summary(rel_path))

    return meta, pending


def build_tree():
    d = docs_dir()

    def walk(dir_path):
        node = {"name": dir_path.name, "type": "dir", "children": []}
        try:
            entries = sorted(dir_path.iterdir(), key=lambda p: (p.is_file(), p.name))
        except FileNotFoundError:
            return node
        for entry in entries:
            if entry.name.startswith("."):
                continue
            if entry.is_dir():
                node["children"].append(walk(entry))
            elif entry.suffix == ".md":
                meta, _ = scan_meta(entry)
                node["children"].append({
                    "name": entry.name,
                    "type": "file",
                    "path": rel(entry),
                    "id": meta.get("id", entry.stem),
                    "title": meta.get("title", ""),
                    "doc_type": meta.get("type", ""),
                    "status": meta.get("status", ""),
                })
        return node

    return walk(d)


OPTION_RE = re.compile(r"^\s+- (권장|대안): (.+)$")


def scan_pending_in_text(body):
    """[(qid, question, options)] - options is [{"kind": "권장"|"대안", "text": ...}],
    read from indented `- 권장: ...` / `- 대안: ...` lines directly under a
    `- [ ] (Qn) ...` line (docs/PROTOCOL.md 4절). Optional - most questions
    have none."""
    lines = body.split("\n")
    out = []
    i = 0
    while i < len(lines):
        m = re.match(r"^- \[ \] \(Q(\d+)\) (.+)$", lines[i])
        if not m:
            i += 1
            continue
        qid, question = m.group(1), m.group(2)
        options = []
        j = i + 1
        while j < len(lines):
            om = OPTION_RE.match(lines[j])
            if not om:
                break
            options.append({"kind": om.group(1), "text": om.group(2)})
            j += 1
        out.append((qid, question, options))
        i = j
    return out


def list_pending():
    items = []
    for p in iter_doc_files():
        meta, pending = scan_meta(p)
        for qid, question, options in pending:
            items.append({
                "doc_path": rel(p),
                "doc_id": meta.get("id", p.stem),
                "title": meta.get("title", ""),
                "question_id": qid,
                "question": question,
                "options": options,
                "updated": meta.get("updated", meta.get("created", "")),
            })
    return items


def list_by_types(types):
    out = []
    for p in iter_doc_files():
        meta, _ = scan_meta(p)
        t = meta.get("type", "")
        if t in types:
            out.append({
                "path": rel(p),
                "id": meta.get("id", p.stem),
                "title": meta.get("title", ""),
                "type": t,
                "status": meta.get("status", ""),
                "updated": meta.get("updated", ""),
                "reply_pending": bool(meta.get("reply_pending", False)),
                "target": meta.get("target", ""),
                "rp": meta.get("rp", ""),
            })
    out.sort(key=lambda x: x["updated"], reverse=True)
    return out


def today():
    return datetime.date.today().isoformat()


def next_seq(doc_type):
    tf = docs_dir() / ".tracking.json"
    data = json.loads(tf.read_text(encoding="utf-8")) if tf.exists() else {}
    n = data.get(doc_type, 0) + 1
    data[doc_type] = n
    tf.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return f"{doc_type}-{n:05d}"


# ---------------------------------------------------------------- local data store
#
# change_notices (SP-00003 5절) and doc_comments (SP-00003 2절/코멘트) are not
# derived from docs/*.md - they're real data with no markdown-file source of
# truth, so (unlike the meta cache above) they live in a small SQLite file
# instead of memory. docs/.workflow/ is gitignored; this file never gets
# committed.

_DATA_LOCK = threading.Lock()


def _data_db_path():
    d = docs_dir() / ".workflow"
    d.mkdir(exist_ok=True)
    return d / "data.db"


def _data_conn():
    conn = sqlite3.connect(str(_data_db_path()))
    conn.execute(
        "CREATE TABLE IF NOT EXISTS change_notices ("
        " id INTEGER PRIMARY KEY AUTOINCREMENT, doc_path TEXT NOT NULL,"
        " source TEXT NOT NULL, summary TEXT NOT NULL, ref TEXT, created_at TEXT NOT NULL)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS doc_comments ("
        " id INTEGER PRIMARY KEY AUTOINCREMENT, doc_path TEXT NOT NULL,"
        " body TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT)"
    )
    return conn


def _now():
    return datetime.datetime.now().isoformat(timespec="seconds")


def create_change_notice(doc_path, source, summary, ref=None):
    with _DATA_LOCK:
        conn = _data_conn()
        try:
            conn.execute(
                "INSERT INTO change_notices (doc_path, source, summary, ref, created_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (doc_path, source, summary, ref, _now()),
            )
            conn.commit()
        finally:
            conn.close()


def list_change_notices():
    with _DATA_LOCK:
        conn = _data_conn()
        try:
            rows = conn.execute(
                "SELECT id, doc_path, source, summary, ref, created_at"
                " FROM change_notices ORDER BY id"
            ).fetchall()
        finally:
            conn.close()
    return [
        {"id": r[0], "doc_path": r[1], "source": r[2], "summary": r[3], "ref": r[4], "created_at": r[5]}
        for r in rows
    ]


def ack_change_notice(notice_id):
    with _DATA_LOCK:
        conn = _data_conn()
        try:
            conn.execute("DELETE FROM change_notices WHERE id = ?", (notice_id,))
            conn.commit()
        finally:
            conn.close()


def list_comments(doc_path):
    with _DATA_LOCK:
        conn = _data_conn()
        try:
            rows = conn.execute(
                "SELECT id, body, created_at, resolved_at FROM doc_comments"
                " WHERE doc_path = ? ORDER BY id",
                (doc_path,),
            ).fetchall()
        finally:
            conn.close()
    return [{"id": r[0], "body": r[1], "created_at": r[2], "resolved_at": r[3]} for r in rows]


def add_comment(doc_path, body):
    with _DATA_LOCK:
        conn = _data_conn()
        try:
            cur = conn.execute(
                "INSERT INTO doc_comments (doc_path, body, created_at) VALUES (?, ?, ?)",
                (doc_path, body, _now()),
            )
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()


def resolve_comment(doc_path, comment_id):
    with _DATA_LOCK:
        conn = _data_conn()
        try:
            conn.execute(
                "UPDATE doc_comments SET resolved_at = ? WHERE id = ? AND doc_path = ?",
                (_now(), comment_id, doc_path),
            )
            conn.commit()
        finally:
            conn.close()


# ---------------------------------------------------------------- git (subprocess)
#
# docs/*.md is a git-tracked directory. We shell out to the git binary rather
# than reimplementing diffing/history ourselves (SP-00003 6.2) - it's already
# there, already correct, already fast.

def _git(args, cwd=None, timeout=10):
    try:
        # encoding="utf-8" is required, not just text=True: on Windows,
        # text=True decodes subprocess output with the OS locale encoding
        # (e.g. cp949 on Korean Windows), which crashes on the UTF-8 bytes
        # git actually writes for any non-ASCII commit message/diff content.
        return subprocess.run(
            ["git", *args], cwd=cwd or str(project_root()),
            capture_output=True, encoding="utf-8", errors="replace", timeout=timeout,
        )
    except Exception as e:
        class _Fail:
            returncode = 1
            stdout = ""
            stderr = str(e)
        return _Fail()


def git_diff_summary(rel_path):
    target = str(docs_dir() / rel_path)
    out = _git(["diff", "--stat", "--", target])
    if out.returncode == 0 and out.stdout.strip():
        return out.stdout.strip().splitlines()[0]
    out = _git(["diff", "--cached", "--stat", "--", target])
    if out.returncode == 0 and out.stdout.strip():
        return out.stdout.strip().splitlines()[0]
    return f"{rel_path} 내용이 변경됨"


def git_log(rel_path=None, limit=30):
    args = ["log", f"-{int(limit)}", "--pretty=format:%H|%an|%ad|%s", "--date=short"]
    if rel_path:
        args += ["--", str(docs_dir() / rel_path)]
    out = _git(args)
    commits = []
    for line in out.stdout.splitlines():
        parts = line.split("|", 3)
        if len(parts) == 4:
            commits.append({"sha": parts[0], "author": parts[1], "date": parts[2], "message": parts[3]})
    return commits


def git_commit_detail(sha):
    out = _git(["show", "--stat", "--pretty=format:%H|%an|%ad|%s", "--date=iso", sha])
    lines = out.stdout.splitlines()
    if not lines:
        return None
    parts = lines[0].split("|", 3)
    files = [l.strip() for l in lines[1:] if l.strip() and "|" in l]
    return {
        "sha": parts[0] if len(parts) > 0 else sha,
        "author": parts[1] if len(parts) > 1 else "",
        "date": parts[2] if len(parts) > 2 else "",
        "message": parts[3] if len(parts) > 3 else "",
        "files": files,
    }


def git_diff(sha):
    out = _git(["show", sha, "--", "docs"])
    return out.stdout


def git_blame(rel_path):
    out = _git(["blame", "--date=short", "--", str(docs_dir() / rel_path)])
    return out.stdout


# ---------------------------------------------------------------- section read / search

def slugify(text):
    s = text.strip().lower()
    s = re.sub(r"[`~!@#$%^&*()+=\[\]{}|\\:;\"'<>,.?/]", "", s)
    s = re.sub(r"\s+", "-", s)
    return s


def extract_section(body, anchor):
    lines = body.split("\n")
    heading_re = re.compile(r"^(#{1,6})\s+(.*)$")
    start, start_level = None, None
    for i, line in enumerate(lines):
        m = heading_re.match(line)
        if m and slugify(m.group(2)) == anchor:
            start, start_level = i, len(m.group(1))
            break
    if start is None:
        return None
    end = len(lines)
    for j in range(start + 1, len(lines)):
        m = heading_re.match(lines[j])
        if m and len(m.group(1)) <= start_level:
            end = j
            break
    return "\n".join(lines[start:end]).rstrip("\n")


def search_docs(query):
    q = (query or "").strip().lower()
    if not q:
        return []
    results = []
    for p in iter_doc_files():
        _, meta, body = read_doc(p)
        haystack = f"{meta.get('id', '')} {meta.get('title', '')}\n{body}".lower()
        idx = haystack.find(q)
        if idx == -1:
            continue
        start = max(0, idx - 40)
        snippet = haystack[start:idx + len(q) + 40].strip()
        results.append({
            "path": rel(p), "id": meta.get("id", p.stem), "title": meta.get("title", ""),
            "type": meta.get("type", ""), "snippet": snippet,
        })
    return results


# ---------------------------------------------------------------- structure validation
#
# SP-00003 7절: hand-coded rules mirroring docs/PROTOCOL.md 3절. A full
# schemas/*.schema.json + cross-tier conformance suite is future work for
# when Tier 2/3 exist to drift against - not needed yet with one implementation.

STATUS_ENUM = {
    "SP": {"draft", "active", "superseded", "archived"},
    "DS": {"draft", "active", "superseded", "archived"},
    "RM": {"draft", "active", "superseded", "archived"},
    "TP": {"draft", "active", "superseded", "archived"},
    "PL": {"planned", "in_progress", "done"},
    "DC": {"open", "answered", "applied", "rejected", "wontfix"},
    "RV": {"open", "answered", "applied", "rejected", "wontfix"},
    "FX": {"open", "answered", "applied", "rejected", "wontfix"},
}
ID_RE = re.compile(r"^[A-Z]{2}-\d{5}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def validate_doc(path, meta):
    violations = []

    def add(field, rule, message):
        violations.append({"path": rel(path), "field": field, "rule": rule, "message": message})

    doc_id = meta.get("id")
    if not doc_id:
        add("id", "required", "id 필드가 없습니다")
    else:
        if not ID_RE.match(str(doc_id)):
            add("id", "pattern", f"id 형식이 TYPE-00000이 아닙니다: {doc_id}")
        if doc_id != path.stem:
            add("id", "consistency", f"id({doc_id})가 파일명({path.stem})과 다릅니다")

    if not meta.get("type"):
        add("type", "required", "type 필드가 없습니다")

    for field in ("created", "updated"):
        val = meta.get(field)
        if not val:
            add(field, "required", f"{field} 필드가 없습니다")
        elif not DATE_RE.match(str(val)):
            add(field, "pattern", f"{field} 값이 YYYY-MM-DD 형식이 아닙니다: {val}")

    doc_type = meta.get("type")
    if doc_type in STATUS_ENUM:
        status = meta.get("status")
        if not status:
            add("status", "required", "status 필드가 없습니다")
        elif status not in STATUS_ENUM[doc_type]:
            add("status", "enum", f"status 값 '{status}'는 {doc_type} 타입에서 허용되지 않습니다")

    links = meta.get("links")
    if links is not None:
        if not isinstance(links, list):
            add("links", "type", "links는 배열이어야 합니다")
        else:
            for link in links:
                if not ID_RE.match(str(link)):
                    add("links", "pattern", f"links 항목 형식이 잘못됨: {link}")

    return violations


def validate_all():
    violations = []
    for p in iter_doc_files():
        _, meta, _ = read_doc(p)
        violations.extend(validate_doc(p, meta))
    return violations


def rebuild_table(index_path: Path, rows, header):
    text = index_path.read_text(encoding="utf-8")
    lines = [header[0], header[1]]
    lines.extend(rows if rows else ["| _(항목 없음)_ | | | |"])
    table_md = "\n".join(lines)
    new_text = re.sub(
        r"(<!-- TABLE:START -->\n)(.*?)(\n<!-- TABLE:END -->)",
        lambda m: m.group(1) + table_md + m.group(3),
        text, flags=re.DOTALL,
    )
    index_path.write_text(new_text, encoding="utf-8")


def rebuild_reply_index():
    rows = [
        f"| [{it['doc_id']}](../{it['doc_path']}) | Q{it['question_id']} | {it['question']} | {it['updated']} |"
        for it in list_pending()
    ]
    rebuild_table(
        docs_dir() / "reply" / "index.md", rows,
        ("| 대상 문서 | 질문 ID | 질문 요약 | 등록일 |", "|---|---|---|---|"),
    )


def rebuild_logs_index():
    rows = []
    logs_dir = docs_dir() / "logs"
    if logs_dir.exists():
        for p in sorted(logs_dir.glob("LG-*.md")):
            _, meta, _ = read_doc(p)
            qids = ", ".join(meta.get("question_ids", []) or [])
            rows.append(
                f"| [{meta.get('id', p.stem)}]({p.name}) | {meta.get('target', '')} | "
                f"{qids} | {meta.get('updated', meta.get('created', ''))} |"
            )
    rebuild_table(
        docs_dir() / "logs" / "index.md", rows,
        ("| 번호 | 대상 문서 | 답변된 질문 | 최근 처리일 |", "|---|---|---|---|"),
    )


def find_lg_by_target(doc_id):
    """Find the LG file (one per target document) whose `target` matches
    doc_id, if any exists yet."""
    folder = docs_dir() / "logs"
    if not folder.exists():
        return None, None, None
    for p in sorted(folder.glob("LG-*.md")):
        text, meta, body = read_doc(p)
        if meta.get("target") == doc_id:
            return p, meta, body
    return None, None, None


def answer_pending(doc_path_rel, question_id, answer_text):
    """Answer one (Qn) item of a DC/RV/FX document.

    RP is not a separate file: the answer is recorded as a `### RP-XXXXX`
    entry inside the target document's own "## 답변 기록" section, so
    answering N questions on one document never creates more than that one
    file (avoids the RP-per-question / RP-per-document file pile-up).
    RP-XXXXX itself becomes an in-page anchor (`#rp-00001`) rather than a
    filename. LG stays one file per target document (a log entry per answer),
    linking to that anchor instead of a separate RP file.
    """
    doc_path = (docs_dir() / doc_path_rel).resolve()
    if not str(doc_path).startswith(str(docs_dir().resolve())) or not doc_path.exists():
        raise FileNotFoundError(doc_path_rel)

    _, meta, body = read_doc(doc_path)
    pattern = re.compile(r"^- \[ \] \(Q" + re.escape(question_id) + r"\) (.+)$", re.MULTILINE)
    m = pattern.search(body)
    if not m:
        raise ValueError("질문을 찾을 수 없거나 이미 답변되었습니다")
    question_text = m.group(1)

    doc_id = meta.get("id", doc_path.stem)
    q_tag = f"Q{question_id}"

    rp_id = next_seq("RP")
    rp_anchor = rp_id.lower()  # "RP-00001" -> "rp-00001", matches the GitHub-style slug the dashboard's renderer gives the "### RP-00001" heading below.

    new_line = f"- [x] (Q{question_id}) {question_text} → [{rp_id}](#{rp_anchor})"
    new_body = body[:m.start()] + new_line + body[m.end():]

    remaining = bool(PENDING_RE.search(new_body))

    record = (
        f"\n### {rp_id}\n\n"
        f"- 질문 ID: {q_tag}\n"
        f"- 답변일: {today()}\n\n"
        f"**질문**\n\n{question_text}\n\n"
        f"**답변**\n\n{answer_text}\n"
    )
    if "## 답변 기록" not in new_body:
        new_body = new_body.rstrip("\n") + "\n\n## 답변 기록\n" + record
    else:
        new_body = new_body.rstrip("\n") + "\n" + record

    meta["reply_pending"] = remaining
    meta["updated"] = today()
    if not remaining and meta.get("status") == "open":
        meta["status"] = "answered"
    doc_path.write_text(dump_frontmatter(meta, new_body), encoding="utf-8")

    # one LG file per target document: find it, or mint a new number.
    lg_path, lg_meta, lg_body = find_lg_by_target(doc_id)
    if lg_path is None:
        lg_id = next_seq("LG")
        lg_path = docs_dir() / "logs" / f"{lg_id}.md"
        lg_meta = {
            "id": lg_id, "type": "LG", "target": doc_id,
            "question_ids": [], "created": today(), "updated": today(),
        }
        lg_body = f"# {lg_id}\n\n- 대상 문서: [{doc_id}](../{doc_path_rel})\n"
    else:
        lg_id = lg_meta["id"]
        lg_meta.setdefault("question_ids", [])

    if q_tag not in lg_meta["question_ids"]:
        lg_meta["question_ids"].append(q_tag)
    lg_meta["updated"] = today()
    lg_body += (
        f"- 처리 내용: `{doc_path_rel}`의 ({q_tag}) 항목에 답변 반영 → "
        f"[{rp_id}](../{doc_path_rel}#{rp_anchor}), 상태 갱신.\n"
    )
    lg_path.write_text(dump_frontmatter(lg_meta, lg_body), encoding="utf-8")

    rebuild_reply_index()
    rebuild_logs_index()
    return {"rp_id": rp_id, "lg_id": lg_id, "reply_pending": remaining}


def save_doc_body(doc_path_rel, new_body):
    """Overwrite a document's body from the dashboard's markdown editor.
    Frontmatter is untouched except `updated` - this is a body-content edit,
    not a metadata change (status/links/etc. still only change through the
    controlled flows: answer_pending, or Claude directly). Runs the same
    structure check as `docs validate` before writing, so a broken edit
    can't corrupt the file's frontmatter contract."""
    doc_path = (docs_dir() / doc_path_rel).resolve()
    if not str(doc_path).startswith(str(docs_dir().resolve())) or not doc_path.exists():
        raise FileNotFoundError(doc_path_rel)

    _, meta, _ = read_doc(doc_path)
    meta["updated"] = today()
    violations = validate_doc(doc_path, meta)
    if violations:
        raise ValueError("검증 실패: " + "; ".join(v["message"] for v in violations))

    doc_path.write_text(dump_frontmatter(meta, new_body), encoding="utf-8")
    return {"path": doc_path_rel, "updated": meta["updated"]}


# ---------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *a):
        pass

    def _json(self, obj, status=200):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _text(self, text, status=200, ctype="text/plain; charset=utf-8"):
        data = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        try:
            if parsed.path == "/api/tree":
                return self._json(build_tree())
            if parsed.path == "/api/pending":
                return self._json(list_pending())
            if parsed.path == "/api/design":
                return self._json(list_by_types(DESIGN_TYPES))
            if parsed.path == "/api/logs":
                return self._json(list_by_types({"LG"}))
            if parsed.path == "/api/all":
                return self._json(list_by_types(set(TYPE_NAMES) - {"IX"}))
            if parsed.path == "/api/changes":
                return self._json(list_change_notices())
            if parsed.path == "/api/validate":
                return self._json(validate_all())
            if parsed.path == "/api/search":
                return self._json(search_docs(qs.get("q", [""])[0]))
            if parsed.path == "/api/git/log":
                rel_path = qs.get("path", [None])[0]
                limit = int(qs.get("limit", ["30"])[0])
                return self._json(git_log(rel_path, limit))
            if parsed.path == "/api/git/blame":
                rel_path = qs.get("path", [""])[0]
                return self._text(git_blame(rel_path))
            m = re.match(r"^/api/git/commits/(.+)$", parsed.path)
            if m:
                detail = git_commit_detail(m.group(1))
                if detail is None:
                    return self._json({"error": "not found"}, 404)
                return self._json(detail)
            m = re.match(r"^/api/git/diff/(.+)$", parsed.path)
            if m:
                return self._text(git_diff(m.group(1)))
            m = re.match(r"^/api/docs/(.+)/comments$", parsed.path)
            if m:
                return self._json(list_comments(m.group(1)))
            if parsed.path == "/api/doc":
                rel_path = qs.get("path", [""])[0]
                anchor = qs.get("anchor", [None])[0]
                p = (docs_dir() / rel_path).resolve()
                if not str(p).startswith(str(docs_dir().resolve())) or not p.exists():
                    return self._json({"error": "not found"}, 404)
                text, meta, body = read_doc(p)
                if anchor:
                    section = extract_section(body, anchor)
                    if section is None:
                        return self._json({"error": "anchor not found"}, 404)
                    return self._json({"path": rel_path, "meta": meta, "body": section, "anchor": anchor})
                return self._json({"path": rel_path, "meta": meta, "body": body})
            return self._serve_static(parsed.path)
        except Exception as e:
            return self._json({"error": str(e)}, 500)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:
            return self._json({"error": "invalid json"}, 400)
        try:
            if parsed.path == "/api/reply":
                result = answer_pending(
                    payload["doc_path"], str(payload["question_id"]), payload["answer"])
                return self._json(result)
            if parsed.path == "/api/doc/save":
                result = save_doc_body(payload["path"], payload["body"])
                return self._json(result)
            m = re.match(r"^/api/changes/(\d+)/ack$", parsed.path)
            if m:
                ack_change_notice(int(m.group(1)))
                return self._json({"ok": True})
            m = re.match(r"^/api/docs/(.+)/comments/(\d+)/resolve$", parsed.path)
            if m:
                resolve_comment(m.group(1), int(m.group(2)))
                return self._json({"ok": True})
            m = re.match(r"^/api/docs/(.+)/comments$", parsed.path)
            if m:
                cid = add_comment(m.group(1), payload["body"])
                return self._json({"id": cid})
            return self._json({"error": "not found"}, 404)
        except Exception as e:
            return self._json({"error": str(e)}, 400)

    def _serve_static(self, path):
        if path == "/":
            path = "/index.html"
        safe = path.lstrip("/")
        p = (STATIC_DIR / safe).resolve()
        if not str(p).startswith(str(STATIC_DIR.resolve())) or not p.exists():
            return self._json({"error": "not found"}, 404)
        ctype = "text/html; charset=utf-8"
        if p.suffix == ".js":
            ctype = "application/javascript; charset=utf-8"
        elif p.suffix == ".css":
            ctype = "text/css; charset=utf-8"
        return self._text(p.read_text(encoding="utf-8"), 200, ctype)


def main():
    global ARGS
    parser = argparse.ArgumentParser(description="docs/ design-workflow dashboard")
    parser.add_argument("--port", type=int, default=8756)
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[2]))
    parser.add_argument("--validate", action="store_true",
                         help="check docs/ structure (SP-00003 7절) and exit, no server")
    ARGS = parser.parse_args()

    if ARGS.validate:
        violations = validate_all()
        if not violations:
            print("모든 문서가 유효합니다.")
            return
        for v in violations:
            print(f"{v['path']}: [{v['rule']}] {v['field']} - {v['message']}")
        sys.exit(1)

    server = ThreadingHTTPServer(("127.0.0.1", ARGS.port), Handler)
    print(f"docs dashboard: http://127.0.0.1:{ARGS.port}  (root: {project_root()})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
```

### 파일: `tools/docs/static/index.html`

```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>docs dashboard</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<div id="app">
  <aside id="tree-pane">
    <div class="brand">docs</div>
    <div id="tree"></div>
  </aside>
  <main id="main-pane">
    <nav id="tabs">
      <button class="tab active" data-tab="all">문서</button>
      <button class="tab" data-tab="design">설계</button>
      <button class="tab" data-tab="logs">기록</button>
    </nav>
    <div id="change-banner" hidden></div>
    <div id="list-pane"></div>
    <div id="doc-pane" hidden></div>
  </main>
</div>

<dialog id="reply-dialog">
  <form method="dialog" id="reply-form">
    <h3>답변 입력</h3>
    <p class="reply-question" id="reply-question"></p>
    <details class="reply-reference-wrap" open>
      <summary>관련 문서 참고 (이 문서가 links로 연결한 SP/DS/PL 등)</summary>
      <div class="reply-reference" id="reply-reference"></div>
    </details>
    <div id="reply-options" class="reply-options" hidden></div>
    <textarea id="reply-answer" rows="6" placeholder="답변 내용을 입력하세요"></textarea>
    <div class="dialog-actions">
      <button type="button" id="reply-cancel">취소</button>
      <button type="submit" id="reply-submit">답변 제출</button>
    </div>
  </form>
</dialog>

<script src="/app.js"></script>
</body>
</html>
```

### 파일: `tools/docs/static/style.css`

```css
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --bg-alt: #f5f6f8;
  --border: #e1e4e8;
  --text: #1f2328;
  --text-dim: #656d76;
  --accent: #2563eb;
  --accent-bg: #eaf1ff;
  --warn: #b45309;
  --warn-bg: #fff3e0;
  --ok: #15803d;
  --ok-bg: #e8f8ee;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14171c;
    --bg-alt: #1b1f26;
    --border: #2b3038;
    --text: #e6e8eb;
    --text-dim: #9aa2ad;
    --accent: #6699ff;
    --accent-bg: #1c2a44;
    --warn: #f5b342;
    --warn-bg: #3a2c10;
    --ok: #4fd07c;
    --ok-bg: #0f2f1c;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, "Segoe UI", "Malgun Gothic", sans-serif;
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
}
#app { display: flex; height: 100vh; }
#tree-pane {
  width: 260px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: var(--bg-alt);
  overflow-y: auto;
  padding: 12px 8px;
}
.brand {
  font-weight: 700;
  padding: 4px 8px 12px;
  color: var(--text-dim);
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: .08em;
}
#main-pane { flex: 1; display: flex; flex-direction: column; min-width: 0; }
#tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  padding: 8px 16px 0;
}
.tab {
  border: none;
  background: transparent;
  padding: 8px 14px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-dim);
  border-bottom: 2px solid transparent;
}
.tab.active { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }
#list-pane, #doc-pane { overflow-y: auto; padding: 16px 20px; flex: 1; }

.tree-dir { font-weight: 600; padding: 4px 6px; color: var(--text-dim); font-size: 12px; margin-top: 6px; }
.tree-file {
  padding: 4px 6px 4px 14px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tree-file:hover { background: var(--accent-bg); }
.tree-children { margin-left: 8px; border-left: 1px solid var(--border); padding-left: 4px; }

.doc-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 10px;
  cursor: pointer;
}
.doc-card:hover { border-color: var(--accent); }
.doc-card .row1 { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.doc-card .id { font-family: monospace; color: var(--accent); font-weight: 700; font-size: 12px; }
.doc-card .title { font-weight: 600; margin-left: 8px; }
.doc-card .meta { color: var(--text-dim); font-size: 12px; margin-top: 4px; }
.badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-alt);
  color: var(--text-dim);
  border: 1px solid var(--border);
}
.badge.pending { background: var(--warn-bg); color: var(--warn); border-color: transparent; }

#doc-pane .doc-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
.header-actions { display: flex; align-items: center; gap: 8px; }
.edit-btn { border: 1px solid var(--border); background: var(--bg-alt); color: var(--text); border-radius: 6px; padding: 3px 10px; font-size: 12px; cursor: pointer; }
.edit-btn:hover { border-color: var(--accent); color: var(--accent); }

.doc-edit-wrap { display: flex; flex-direction: column; gap: 8px; }
.edit-toolbar { display: flex; gap: 4px; flex-wrap: wrap; }
.edit-toolbar button {
  border: 1px solid var(--border); background: var(--bg-alt); color: var(--text);
  border-radius: 6px; padding: 4px 10px; font-size: 12px; font-family: inherit; cursor: pointer;
}
.edit-toolbar button:hover { border-color: var(--accent); color: var(--accent); }
.doc-edit-area {
  width: 100%; min-height: 360px; font-family: ui-monospace, monospace; font-size: 12.5px;
  line-height: 1.5; padding: 10px; border-radius: 8px; border: 1px solid var(--border);
  background: var(--bg); color: var(--text); resize: vertical;
}
.edit-actions { display: flex; justify-content: flex-end; align-items: center; gap: 10px; }
.edit-status { font-size: 12px; color: var(--text-dim); }
.edit-actions button { padding: 7px 14px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-alt); color: var(--text); cursor: pointer; }
.edit-save { background: var(--accent); color: #fff; border-color: var(--accent); }
#doc-pane .back { cursor: pointer; color: var(--accent); font-size: 13px; margin-bottom: 12px; display: inline-block; }
#doc-pane .doc-meta-line { color: var(--text-dim); font-size: 12px; margin-bottom: 16px; }
.doc-body h1, .doc-body h2, .doc-body h3 { line-height: 1.3; }
.doc-body table { border-collapse: collapse; margin: 8px 0; width: 100%; }
.doc-body th, .doc-body td { border: 1px solid var(--border); padding: 6px 10px; font-size: 13px; text-align: left; }
.doc-body code { background: var(--bg-alt); padding: 1px 5px; border-radius: 4px; font-size: 12.5px; }
.doc-body pre { background: var(--bg-alt); padding: 10px 12px; border-radius: 6px; overflow-x: auto; }
.doc-body pre code { background: none; padding: 0; }
.doc-body blockquote { border-left: 3px solid var(--border); margin: 8px 0; padding: 2px 12px; color: var(--text-dim); }
.doc-body a { color: var(--accent); }
.doc-body li.task { list-style: none; margin-left: -20px; }
.doc-ref {
  color: var(--accent);
  font-family: monospace;
  font-weight: 700;
  cursor: pointer;
  text-decoration: underline dotted;
}

.pending-section { margin-top: 24px; border-top: 1px solid var(--border); padding-top: 16px; }
.pending-section h4 { margin-bottom: 8px; }
.pending-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  border: 1px solid var(--warn);
  background: var(--warn-bg);
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 8px;
}
.pending-card .q { font-size: 13px; }
.pending-card .rec-preview { font-size: 11.5px; color: var(--text-dim); margin-top: 3px; }
.pending-card button {
  flex-shrink: 0;
  border: none;
  background: var(--accent);
  color: #fff;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12.5px;
}

.howto-section {
  margin-top: 24px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 14px 16px;
  color: var(--text-dim);
  font-size: 12.5px;
  background: var(--bg-alt);
}
.howto-section h4 { color: var(--text); margin-top: 0; }
.howto-section ol { margin: 6px 0 0 18px; padding: 0; }

dialog {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 20px;
  width: min(520px, 90vw);
  background: var(--bg);
  color: var(--text);
}
dialog::backdrop { background: rgba(0,0,0,.4); }
#reply-dialog { width: min(720px, 92vw); max-height: 85vh; overflow: auto; }
.reply-question { font-size: 13px; color: var(--text-dim); background: var(--bg-alt); padding: 8px 10px; border-radius: 6px; }
.reply-reference-wrap { margin-top: 10px; border: 1px solid var(--border); border-radius: 8px; }
.reply-reference-wrap > summary { cursor: pointer; padding: 6px 10px; font-size: 12px; color: var(--text-dim); }
.reply-reference { max-height: 280px; overflow: auto; padding: 4px 12px 10px; font-size: 12.5px; }
.reply-reference details { border-top: 1px solid var(--border); padding: 6px 0; }
.reply-reference details:first-child { border-top: none; }
.reply-reference details summary { cursor: pointer; font-weight: 600; font-size: 12.5px; }
.reply-reference details .doc-body { margin-top: 6px; }
.reply-options { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
.reply-option-btn {
  text-align: left; font-size: 12.5px; padding: 8px 10px; border-radius: 6px;
  border: 1px solid var(--border); background: var(--bg-alt); color: var(--text); cursor: pointer;
}
.reply-option-btn.recommended { border-color: var(--accent); background: var(--accent-bg); font-weight: 600; }
#reply-answer { width: 100%; margin-top: 10px; font-family: inherit; font-size: 13px; padding: 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.dialog-actions button { padding: 7px 14px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-alt); cursor: pointer; }
#reply-submit { background: var(--accent); color: #fff; border-color: var(--accent); }

.empty-note { color: var(--text-dim); padding: 20px 0; }

/* change queue banner */
#change-banner {
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
  margin: 0 20px 12px; padding: 8px 12px; border-radius: 8px;
  background: var(--warn-bg); color: var(--warn); font-size: 12.5px;
}
.change-chip {
  font-family: monospace; background: var(--bg); border: 1px solid var(--border);
  border-radius: 6px; padding: 2px 8px; cursor: pointer; color: var(--text);
}
#change-banner button {
  border: none; background: var(--accent); color: #fff; border-radius: 6px;
  padding: 2px 8px; cursor: pointer; font-size: 12px;
}

/* comments */
.comments-section, .history-section { margin-top: 24px; border-top: 1px solid var(--border); padding-top: 16px; }
.comment-card { border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; }
.comment-card.resolved { opacity: .6; }
.comment-body { font-size: 13px; white-space: pre-wrap; }
.comment-meta { display: flex; justify-content: space-between; align-items: center; margin-top: 6px; font-size: 11.5px; color: var(--text-dim); }
.comment-meta button { border: none; background: var(--bg-alt); border: 1px solid var(--border); border-radius: 6px; padding: 2px 8px; cursor: pointer; color: var(--text); }
.comment-form { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.comment-form textarea { width: 100%; font-family: inherit; font-size: 13px; padding: 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); }
.comment-form button { align-self: flex-end; border: none; background: var(--accent); color: #fff; border-radius: 6px; padding: 6px 12px; cursor: pointer; }

/* git history */
.commit-row { display: flex; gap: 10px; padding: 6px 8px; border-radius: 6px; cursor: pointer; font-size: 12.5px; align-items: baseline; }
.commit-row:hover { background: var(--accent-bg); }
.commit-sha { font-family: monospace; color: var(--accent); }
.commit-date { color: var(--text-dim); flex-shrink: 0; }
.commit-msg { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.diff-box { margin-top: 10px; background: var(--bg-alt); border: 1px solid var(--border); border-radius: 8px; padding: 10px; font-size: 11.5px; max-height: 360px; overflow: auto; white-space: pre-wrap; }
```

### 파일: `tools/docs/static/app.js`

```javascript
// docs dashboard - vanilla JS SPA (no build step, no dependencies)

const TYPE_LABEL = {
  IX: "최상위 색인", SP: "설계 명세", PL: "실행 계획", DN: "결과 보고",
  DS: "설계", RM: "기억 지시", TP: "임시 문서", DC: "결정 요청",
  RV: "검토 요청", FX: "수정 검토", LG: "처리 기록", RP: "답변 항목",
};
const DESIGN_TYPES = new Set(["DC", "RV", "FX"]);

const state = {
  tab: "all",
  idIndex: {},       // id -> {path, type, title}
  currentDoc: null,  // {path, meta, body}
};

// ---------------------------------------------------------------- helpers

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

function slugify(s) {
  return s.trim().toLowerCase()
    .replace(/[`~!@#$%^&*()+=[\]{}|\\:;"'<>,.?/]/g, "")
    .replace(/\s+/g, "-");
}

// ---------------------------------------------------------------- markdown (lite)

function renderMarkdown(src) {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  let html = [];
  let i = 0;
  let inCode = false, codeBuf = [];
  let listBuf = null; // {ordered, items: []}

  function flushList() {
    if (!listBuf) return;
    const tag = listBuf.ordered ? "ol" : "ul";
    html.push(`<${tag}>` + listBuf.items.join("") + `</${tag}>`);
    listBuf = null;
  }

  function inline(text) {
    text = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // stash code spans and links first so later passes (bold/italic/doc-ref)
    // never re-match text sitting inside an href or code span.
    const stash = [];
    const save = (html) => { stash.push(html); return `\x00${stash.length - 1}\x00`; };

    text = text.replace(/`([^`]+)`/g, (_, code) => save(`<code>${code}</code>`));
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) =>
      save(`<a href="${url}" data-link="1">${label}</a>`));

    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    // bare TYPE-00000 references -> clickable doc-ref
    text = text.replace(/\b([A-Z]{2}-\d{5})\b/g, (m) => `<span class="doc-ref" data-id="${m}">${m}</span>`);

    text = text.replace(/\x00(\d+)\x00/g, (_, i) => stash[Number(i)]);
    return text;
  }

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      if (!inCode) { inCode = true; codeBuf = []; i++; continue; }
      inCode = false;
      html.push(`<pre><code>${codeBuf.join("\n")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`);
      i++; continue;
    }
    if (inCode) { codeBuf.push(line); i++; continue; }

    if (!line.trim()) { flushList(); i++; continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushList();
      const level = h[1].length;
      const text = h[2].trim();
      html.push(`<h${level} id="${slugify(text)}">${inline(text)}</h${level}>`);
      i++; continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line) && lines[i + 1] && /^\s*\|?[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      flushList();
      const headerCells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      let j = i + 2;
      const rows = [];
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) {
        rows.push(lines[j].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
        j++;
      }
      let t = "<table><thead><tr>" + headerCells.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>";
      for (const r of rows) t += "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>";
      t += "</tbody></table>";
      html.push(t);
      i = j; continue;
    }

    const task = line.match(/^-\s+\[( |x)\]\s+(.*)$/);
    if (task) {
      if (!listBuf || listBuf.ordered) { flushList(); listBuf = { ordered: false, items: [] }; }
      const checked = task[1] === "x" ? "checked" : "";
      listBuf.items.push(`<li class="task"><input type="checkbox" disabled ${checked}> ${inline(task[2])}</li>`);
      i++; continue;
    }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      if (!listBuf || listBuf.ordered) { flushList(); listBuf = { ordered: false, items: [] }; }
      listBuf.items.push(`<li>${inline(bullet[1])}</li>`);
      i++; continue;
    }
    const numbered = line.match(/^\d+\.\s+(.*)$/);
    if (numbered) {
      if (!listBuf || !listBuf.ordered) { flushList(); listBuf = { ordered: true, items: [] }; }
      listBuf.items.push(`<li>${inline(numbered[1])}</li>`);
      i++; continue;
    }

    if (line.trim().startsWith(">")) {
      flushList();
      const buf = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        buf.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      html.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }

    if (/^---+$/.test(line.trim())) { flushList(); html.push("<hr>"); i++; continue; }

    flushList();
    html.push(`<p>${inline(line)}</p>`);
    i++;
  }
  flushList();
  return html.join("\n");
}

// ---------------------------------------------------------------- tree

async function loadTree() {
  const tree = await api("/api/tree");
  const container = document.getElementById("tree");
  container.innerHTML = "";
  indexTree(tree);
  container.appendChild(renderTreeNode(tree, true));
}

function indexTree(node) {
  if (node.type === "file") {
    state.idIndex[node.id] = node;
  }
  for (const c of node.children || []) indexTree(c);
}

function renderTreeNode(node, isRoot) {
  const wrap = document.createElement("div");
  if (node.type === "dir") {
    if (!isRoot) wrap.appendChild(el("div", { class: "tree-dir" }, node.name));
    const kids = el("div", { class: isRoot ? "" : "tree-children" });
    for (const c of node.children) kids.appendChild(renderTreeNode(c, false));
    wrap.appendChild(kids);
  } else {
    const label = node.title ? `${node.id} · ${node.title}` : node.name;
    wrap.appendChild(el("div", {
      class: "tree-file", title: label,
      onclick: () => openDoc(node.path),
    }, label));
  }
  return wrap;
}

// ---------------------------------------------------------------- tabs & lists

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  showListPane();
  loadList();
}

function showListPane() {
  document.getElementById("list-pane").hidden = false;
  document.getElementById("doc-pane").hidden = true;
}

async function loadList() {
  const pane = document.getElementById("list-pane");
  pane.innerHTML = "불러오는 중...";
  let items;
  if (state.tab === "all") items = await api("/api/all");
  else if (state.tab === "design") items = await api("/api/design");
  else items = await api("/api/logs");

  pane.innerHTML = "";
  if (!items.length) {
    pane.appendChild(el("div", { class: "empty-note" }, "문서가 없습니다."));
    return;
  }
  for (const it of items) {
    const card = el("div", { class: "doc-card", onclick: () => openDoc(it.path) }, [
      el("div", { class: "row1" }, [
        el("span", {}, [
          el("span", { class: "id" }, it.id),
          el("span", { class: "title" }, it.title || "(제목 없음)"),
        ]),
        el("span", { class: "badge" + (it.reply_pending ? " pending" : "") },
          it.reply_pending ? "답변 대기" : (it.status || "-")),
      ]),
      el("div", { class: "meta" }, `${TYPE_LABEL[it.type] || it.type} · ${it.updated || ""}`),
    ]);
    pane.appendChild(card);
  }
}

// ---------------------------------------------------------------- doc viewer

async function openDoc(path) {
  const doc = await api("/api/doc?path=" + encodeURIComponent(path));
  state.currentDoc = doc;
  document.getElementById("list-pane").hidden = true;
  const pane = document.getElementById("doc-pane");
  pane.hidden = false;
  renderDoc(doc);
}

function renderDoc(doc) {
  const pane = document.getElementById("doc-pane");
  pane.innerHTML = "";
  const meta = doc.meta || {};

  pane.appendChild(el("span", { class: "back", onclick: showListPane }, "← 목록으로"));
  pane.appendChild(el("div", { class: "doc-header" }, [
    el("h2", {}, `${meta.id || doc.path} ${meta.title ? "· " + meta.title : ""}`),
    el("span", { class: "header-actions" }, [
      el("span", { class: "badge" }, meta.status || ""),
      el("button", { class: "edit-btn", onclick: () => enterEditMode(doc) }, "편집"),
    ]),
  ]));
  pane.appendChild(el("div", { class: "doc-meta-line" },
    `${meta.type ? TYPE_LABEL[meta.type] || meta.type : ""} · updated ${meta.updated || meta.created || "-"} · ${doc.path}`));

  const body = el("div", { class: "doc-body", html: renderMarkdown(doc.body) });
  pane.appendChild(body);
  body.querySelectorAll(".doc-ref").forEach((n) => {
    n.addEventListener("click", () => jumpToId(n.dataset.id));
  });
  body.querySelectorAll("a[data-link]").forEach((a) => {
    a.addEventListener("click", (ev) => {
      const href = a.getAttribute("href");
      if (/^https?:\/\//.test(href)) return; // let external links behave normally
      ev.preventDefault();
      resolveRelativeLink(doc.path, href);
    });
  });

  const pendingItems = scanPending(doc.body);
  if (pendingItems.length) {
    const section = el("div", { class: "pending-section" }, [
      el("h4", {}, `답변 대기 항목 (${pendingItems.length})`),
    ]);
    for (const p of pendingItems) {
      const rec = p.options.find((o) => o.kind === "권장");
      section.appendChild(el("div", { class: "pending-card" }, [
        el("div", {}, [
          el("div", { class: "q" }, `(Q${p.qid}) ${p.text}`),
          rec ? el("div", { class: "rec-preview" }, `권장: ${rec.text}`) : null,
        ]),
        el("button", { onclick: () => openReplyDialog(doc.path, p.qid, p.text, p.options) }, "답변 입력"),
      ]));
    }
    pane.appendChild(section);
  }

  if (DESIGN_TYPES.has(meta.type)) {
    pane.appendChild(el("div", { class: "howto-section" }, [
      el("h4", {}, "답변 입력 후 처리 요령"),
      el("ol", {}, [
        el("li", {}, "답변을 제출하면 RP-XXXXX 번호가 발급되고, 이 문서 하단 \"## 답변 기록\" 섹션에 질문·답변 전문이 직접 기록됩니다(별도 파일을 만들지 않습니다)."),
        el("li", {}, "이 문서의 해당 (Qn) 줄이 체크되고 그 기록으로 가는 앵커 링크가 남습니다."),
        el("li", {}, "docs/reply/index.md 미답변 큐에서 이 항목이 제거됩니다."),
        el("li", {}, "docs/logs/에 처리 기록(LG, 대상 문서당 1개)이 남고 이 문서·RP 앵커에 연결됩니다."),
        el("li", {}, "이 문서의 모든 질문에 답변되면 상태가 answered로 바뀝니다."),
      ]),
    ]));
  }

  loadCommentsSection(pane, doc.path);
  loadHistorySection(pane, doc.path);
}

// ---------------------------------------------------------------- body editor
//
// Body-only editing (frontmatter is never touched here - id/type/status/links
// still only change through the controlled flows). Plain textarea + a small
// toolbar that wraps the current selection with markdown syntax, rather than
// a WYSIWYG editor - keeps this dependency-free and the saved file exactly
// what the designer sees in the box.

function wrapSelection(textarea, before, after) {
  after = after === undefined ? before : after;
  const start = textarea.selectionStart, end = textarea.selectionEnd;
  const val = textarea.value;
  textarea.value = val.slice(0, start) + before + val.slice(start, end) + after + val.slice(end);
  textarea.focus();
  textarea.selectionStart = start + before.length;
  textarea.selectionEnd = end + before.length;
}

function prefixCurrentLine(textarea, prefix) {
  const start = textarea.selectionStart;
  const val = textarea.value;
  const lineStart = val.lastIndexOf("\n", start - 1) + 1;
  textarea.value = val.slice(0, lineStart) + prefix + val.slice(lineStart);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + prefix.length;
}

function enterEditMode(doc) {
  const pane = document.getElementById("doc-pane");
  const bodyDiv = pane.querySelector(".doc-body");
  if (!bodyDiv) return;

  const textarea = el("textarea", { class: "doc-edit-area", spellcheck: "false" });
  textarea.value = doc.body;

  const toolbar = el("div", { class: "edit-toolbar" }, [
    el("button", { type: "button", title: "굵게", onclick: () => wrapSelection(textarea, "**") }, "B"),
    el("button", { type: "button", title: "취소선", onclick: () => wrapSelection(textarea, "~~") }, "S"),
    el("button", { type: "button", title: "제목 1", onclick: () => prefixCurrentLine(textarea, "# ") }, "H1"),
    el("button", { type: "button", title: "제목 2", onclick: () => prefixCurrentLine(textarea, "## ") }, "H2"),
    el("button", { type: "button", title: "코드", onclick: () => wrapSelection(textarea, "`") }, "Code"),
    el("button", { type: "button", title: "링크", onclick: () => wrapSelection(textarea, "[", "](url)") }, "Link"),
  ]);

  const status = el("span", { class: "edit-status" }, "");
  const actions = el("div", { class: "edit-actions" }, [
    status,
    el("button", { type: "button", class: "edit-cancel", onclick: () => renderDoc(doc) }, "취소"),
    el("button", {
      type: "button", class: "edit-save",
      onclick: async () => {
        status.textContent = "저장 중...";
        try {
          await api("/api/doc/save", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: doc.path, body: textarea.value }),
          });
          await openDoc(doc.path);
        } catch (e) {
          status.textContent = "";
          alert("저장 실패: " + e.message);
        }
      },
    }, "저장"),
  ]);

  const editWrap = el("div", { class: "doc-edit-wrap" }, [toolbar, textarea, actions]);
  bodyDiv.replaceWith(editWrap);
  textarea.focus();
}

// ---------------------------------------------------------------- comments

async function loadCommentsSection(pane, docPath) {
  const section = el("div", { class: "comments-section" }, [
    el("h4", {}, "코멘트"),
  ]);
  pane.appendChild(section);
  const list = el("div", { class: "comments-list" }, "불러오는 중...");
  section.appendChild(list);

  let comments;
  try {
    comments = await api("/api/docs/" + docPath + "/comments");
  } catch (e) {
    list.textContent = "코멘트를 불러오지 못했습니다.";
    return;
  }

  list.innerHTML = "";
  if (!comments.length) {
    list.appendChild(el("div", { class: "empty-note" }, "아직 코멘트가 없습니다."));
  }
  for (const c of comments) {
    list.appendChild(el("div", { class: "comment-card" + (c.resolved_at ? " resolved" : "") }, [
      el("div", { class: "comment-body" }, c.body),
      el("div", { class: "comment-meta" }, [
        el("span", {}, c.created_at + (c.resolved_at ? " · 해결됨" : "")),
        c.resolved_at ? null : el("button", {
          onclick: async () => {
            await api("/api/docs/" + docPath + "/comments/" + c.id + "/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
            openDoc(docPath);
          },
        }, "해결 처리"),
      ]),
    ]));
  }

  const form = el("div", { class: "comment-form" }, [
    el("textarea", { id: "new-comment-text", rows: "2", placeholder: "코멘트 작성 (비공식 토론용 - 마크다운 파일에는 남지 않습니다)" }),
    el("button", {
      onclick: async () => {
        const ta = document.getElementById("new-comment-text");
        const body = ta.value.trim();
        if (!body) return;
        await api("/api/docs/" + docPath + "/comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
        openDoc(docPath);
      },
    }, "코멘트 등록"),
  ]);
  section.appendChild(form);
}

// ---------------------------------------------------------------- git history

async function loadHistorySection(pane, docPath) {
  const section = el("div", { class: "history-section" }, [
    el("h4", {}, "커밋 이력"),
  ]);
  pane.appendChild(section);
  const list = el("div", { class: "history-list" }, "불러오는 중...");
  section.appendChild(list);
  const diffBox = el("pre", { class: "diff-box", hidden: "hidden" });
  section.appendChild(diffBox);

  let commits;
  try {
    commits = await api("/api/git/log?path=" + encodeURIComponent(docPath) + "&limit=10");
  } catch (e) {
    list.textContent = "git 이력을 불러오지 못했습니다(git 저장소가 아니거나 git이 없을 수 있습니다).";
    return;
  }

  list.innerHTML = "";
  if (!commits.length) {
    list.appendChild(el("div", { class: "empty-note" }, "커밋 이력이 없습니다."));
    return;
  }
  for (const c of commits) {
    list.appendChild(el("div", { class: "commit-row", onclick: async () => {
      diffBox.hidden = false;
      diffBox.textContent = "불러오는 중...";
      const res = await fetch("/api/git/diff/" + c.sha);
      diffBox.textContent = await res.text();
    } }, [
      el("span", { class: "commit-sha" }, c.sha.slice(0, 8)),
      el("span", { class: "commit-date" }, c.date),
      el("span", { class: "commit-msg" }, c.message),
    ]));
  }
}

// ---------------------------------------------------------------- change queue

async function loadChangeBanner() {
  const holder = document.getElementById("change-banner");
  let notices;
  try {
    notices = await api("/api/changes");
  } catch (e) {
    return;
  }
  holder.innerHTML = "";
  if (!notices.length) { holder.hidden = true; return; }
  holder.hidden = false;
  holder.appendChild(el("span", {}, `변경 감지: ${notices.length}건 (직접 편집 등으로 캐시와 달라진 문서)`));
  for (const n of notices) {
    holder.appendChild(el("span", { class: "change-chip", onclick: () => openDoc(n.doc_path) }, n.doc_path));
    holder.appendChild(el("button", {
      onclick: async (ev) => {
        ev.stopPropagation();
        await api("/api/changes/" + n.id + "/ack", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        loadChangeBanner();
      },
    }, "확인"));
  }
}

function scanPending(body) {
  // mirrors server.py scan_pending_in_text: an optional indented
  // "- 권장: ..." / "- 대안: ..." block right under the (Qn) line becomes
  // clickable quick-answer options in the reply dialog.
  const lines = body.split("\n");
  const qRe = /^- \[ \] \(Q(\d+)\) (.+)$/;
  const optRe = /^\s+- (권장|대안): (.+)$/;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(qRe);
    if (!m) continue;
    const options = [];
    let j = i + 1;
    while (j < lines.length) {
      const om = lines[j].match(optRe);
      if (!om) break;
      options.push({ kind: om[1], text: om[2] });
      j++;
    }
    out.push({ qid: m[1], text: m[2], options });
  }
  return out;
}

function jumpToId(id) {
  const type = id.split("-")[0];
  const node = state.idIndex[id];
  if (!node) { alert(`${id} 문서를 찾을 수 없습니다.`); return; }
  if (DESIGN_TYPES.has(type)) setTabAndOpen("design", node.path);
  else if (type === "LG") setTabAndOpen("logs", node.path);
  else setTabAndOpen("all", node.path);
}

function setTabAndOpen(tab, path) {
  state.tab = tab;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  openDoc(path);
}

function resolveRelativeLink(fromPath, href) {
  if (href.startsWith("#")) {
    const target = document.getElementById(href.slice(1));
    if (target) target.scrollIntoView({ behavior: "smooth" });
    return;
  }
  const [linkPath, anchor] = href.split("#");
  const baseParts = fromPath.split("/"); baseParts.pop();
  const parts = baseParts.concat(linkPath.split("/"));
  const resolved = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  const path = resolved.join("/");
  openDoc(path).then(() => {
    if (anchor) {
      const target = document.getElementById(anchor);
      if (target) target.scrollIntoView({ behavior: "smooth" });
    }
  }).catch(() => alert("문서를 열 수 없습니다: " + path));
}

// ---------------------------------------------------------------- reply dialog

let pendingReply = null; // {docPath, qid}

async function openReplyDialog(docPath, qid, text, options) {
  pendingReply = { docPath, qid };
  document.getElementById("reply-question").textContent = `(Q${qid}) ${text}`;
  const answerBox = document.getElementById("reply-answer");
  answerBox.value = "";

  // Reference material = the related SP/DS/PL/... docs this one cites via
  // its own frontmatter `links` - the context that motivated the question -
  // not the question sheet's own text (that's already open behind the dialog).
  const ref = document.getElementById("reply-reference");
  ref.innerHTML = "불러오는 중...";
  const links = (state.currentDoc && state.currentDoc.path === docPath && state.currentDoc.meta.links) || [];
  if (!links.length) {
    ref.innerHTML = `<div class="empty-note">이 문서에 연결된(links) 참고 문서가 없습니다.</div>`;
  } else {
    const parts = [];
    for (const id of links) {
      const node = state.idIndex[id];
      if (!node) { parts.push(`<div class="empty-note">${id} (문서를 찾을 수 없음)</div>`); continue; }
      try {
        const linked = await api("/api/doc?path=" + encodeURIComponent(node.path));
        parts.push(
          `<details><summary>${id} · ${linked.meta.title || node.path}</summary>` +
          `<div class="doc-body">${renderMarkdown(linked.body)}</div></details>`
        );
      } catch (e) {
        parts.push(`<div class="empty-note">${id} 불러오기 실패</div>`);
      }
    }
    ref.innerHTML = parts.join("");
  }

  // Quick-answer: DC/RV/FX authored with "- 권장: ..." / "- 대안: ..." lines
  // under the question show up here as one-click fills - the designer can
  // still edit before submitting, this just saves retyping the option text.
  const optBox = document.getElementById("reply-options");
  optBox.innerHTML = "";
  optBox.hidden = !options || !options.length;
  for (const o of options || []) {
    optBox.appendChild(el("button", {
      type: "button",
      class: "reply-option-btn" + (o.kind === "권장" ? " recommended" : ""),
      onclick: () => { answerBox.value = o.text; answerBox.focus(); },
    }, `${o.kind}: ${o.text}`));
  }

  document.getElementById("reply-dialog").showModal();
}

function initReplyDialog() {
  const dialog = document.getElementById("reply-dialog");
  document.getElementById("reply-cancel").addEventListener("click", () => dialog.close());
  document.getElementById("reply-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const answer = document.getElementById("reply-answer").value.trim();
    if (!answer || !pendingReply) return;
    try {
      await api("/api/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doc_path: pendingReply.docPath,
          question_id: pendingReply.qid,
          answer,
        }),
      });
      dialog.close();
      await loadTree();
      await openDoc(pendingReply.docPath);
    } catch (e) {
      alert("답변 처리 실패: " + e.message);
    }
  });
}

// ---------------------------------------------------------------- init

document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
initReplyDialog();
loadTree();
setTab("all");
loadChangeBanner();
```


## 완료 후 알려줄 것

- 생성된 파일 목록 요약
- `docs/reply/index.md`에 미답변 항목이 있는지 (초기 상태는 없음)
- 대시보드 실행 명령어(`python tools/docs/server.py`)와 접속 주소
