# claude-native-workflow

Claude와 함께 새 프로젝트를 시작할 때, **프롬프트 하나 복사-붙여넣기만으로**
`docs/` 설계 문서 체계 + `CLAUDE.md` 운영 규칙 + `tools/docs` 로컬 대시보드를
그대로 구축하기 위한 템플릿 저장소.

## 사용법

1. 새 프로젝트를 열고 Claude Code 세션을 시작한다.
2. 이 저장소의 [bootstrap-prompt.md](bootstrap-prompt.md) 전체 내용을 복사해
   그대로 붙여넣는다.
3. Claude가 프로젝트에 `CLAUDE.md`, `docs/` 전체 구조, `tools/docs` 대시보드를
   생성한다.
4. 이후 설계/기획 논의는 그 프로젝트 안에서 Claude와의 대화로 진행하면 되고,
   `python tools/docs/server.py`로 대시보드를 띄워 문서 현황과 답변 대기
   항목을 확인/처리할 수 있다.

## 이 저장소의 구성

- `bootstrap-prompt.md` — 실제 배포용 산출물. 이 파일 전체를 복사-붙여넣기한다.
- `CLAUDE.md`, `docs/`, `tools/docs/` — 프롬프트 안에 실제로 삽입되는 파일들의
  **참조 원본**이자 로컬 개발/테스트용 실행 가능한 사본. 여기서 대시보드를
  직접 띄워 확인할 수 있다: `python tools/docs/server.py`
- `DESIGN-NOTES.md` — 이 워크플로우 자체를 설계하며 나눈 논의와 결정 기록
  (프로토콜 v1 초안).
- `scripts/build_prompt.py` — 위 참조 원본 파일들을 읽어 `bootstrap-prompt.md`를
  재조립하는 개발용 스크립트. 참조 원본을 수정했으면 반드시 다시 실행해서
  프롬프트를 최신 상태로 맞춘다.

## 참조 원본을 수정했을 때

```bash
python scripts/build_prompt.py
```

`bootstrap-prompt.md`가 현재 `CLAUDE.md`/`docs/`/`tools/docs/` 내용 그대로
재생성된다. 수동으로 `bootstrap-prompt.md`를 직접 편집하지 않는다(다음 재생성 때
덮어써진다).

## 문서 워크플로우 요약

전체 규칙은 [docs/PROTOCOL.md](docs/PROTOCOL.md) 참고. 요점만 보면:

- 모든 설계 문서는 `[TYPE]-[00001].md` 추적 번호를 가지며 타입별 폴더에 저장된다
  (`SP` 설계 명세, `PL` 실행 계획, `DN` 결과 보고, `DS` 설계, `RM` 기억 지시,
  `TP` 임시 문서, `DC` 결정 요청, `RV` 검토 요청, `FX` 수정 검토, `LG` 처리 기록,
  `RP` 답변 항목).
- `DC`/`RV`/`FX` 문서의 "답변 대기" 항목은 대시보드에서 답변을 입력하면 자동으로
  `RP` 파일 생성 → 원문서 갱신 → 큐에서 제거 → `LG` 기록까지 처리된다.
- `PL`이 완료되면 `DN`으로 전환되고 원본 `PL`은 스텁만 남는다.
