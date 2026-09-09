# CLAUDE.md

## 이 저장소에 대하여

claude-native-workflow는 "Claude와 함께 쓰는 문서 기반 설계 워크플로우"
자체를 연구·개발하는 저장소다. 전체 그림(초간단/평범/고급 3개 배포 등급,
왜 그렇게 나눴는지)은 [docs/design/DS-00001.md](docs/design/DS-00001.md)가
원본이다. 새 작업을 시작하기 전에 먼저 이 문서와
[docs/plan/PL-00001.md](docs/plan/PL-00001.md)(실행 계획), 미답변/미적용
`docs/decision/*.md`를 확인한다.

**`docs/` vs `tier1/docs/`를 혼동하지 말 것.** 이 저장소 루트의 `docs/`는
claude-native-workflow **자신**의 설계 기록(DS/SP/PL/DC 등, 실제 내용이 있음)
이고, `tier1/docs/`는 새 프로젝트에 배포되는 **빈 템플릿**이다. 절대로
서로 섞이면 안 된다 — 이 저장소의 `docs/` 내용이 실수로 `tier1/`에
들어가면 `bootstrap-prompt.md`를 통해 새 프로젝트에 엉뚱한 내용이
복붙된다.

## 설계 문서 워크플로우

이 저장소 자신의 설계/기획 논의는 `docs/` 문서 공간을 통해서만 진행한다.
전체 규칙은 [docs/PROTOCOL.md](docs/PROTOCOL.md)를 따른다. 요약:

- 문서는 `[TYPE]-[00001].md` 형식의 추적 번호를 가지며, 타입별로 `docs/<폴더>/`에
  저장되고 `docs/<폴더>/index.md`에 등재된다. 번호 발급은 `docs/.tracking.json`을
  따른다. `RP`(답변)만 예외로 자기 파일이 없다 — 답변 대상 문서 안에
  "## 답변 기록" 섹션으로 직접 적힌다(`docs/PROTOCOL.md` 6절). 파일 개수가
  질문 수에 비례해 늘어나는 걸 막기 위한 설계이니, 답변을 처리할 때 이
  규칙을 반드시 지킨다(RP 파일을 새로 만들지 않는다).
- 설계자의 프롬프트를 받으면:
  1. `docs/index.md`와 관련 타입 색인에서 기존 문서를 먼저 확인한다.
  2. 필요한 문서(`SP`/`PL`/`DS`/...)를 갱신·생성하고, 결정/검토/수정이 필요한
     지점은 `DC`/`RV`/`FX`로 분리해 등재한다(`docs/PROTOCOL.md` 4절 형식).
     "착수 시 결정" 같은 문구로 스펙 안에 미결 사항을 그냥 묻어두지 말고
     반드시 `DC`로 등록해 추적 코드를 부여한다.
  3. 실행 계획(`PL`)은 즉시 실행하지 말고 요약을 제시해 검토·승인을 받은 뒤에만
     진행한다.
  4. 계획이 완료되면 `PL → DN` 전환 절차(`docs/PROTOCOL.md` 5절)를 따른다.
- `docs/reply/index.md`에 미답변 항목이 있으면 대화 시작 시 설계자에게 알린다.
- 문서/설계를 언급할 때는 항상 해당 섹션 딥링크를 함께 제시한다
  (예: `[DC-00005](docs/decision/DC-00005.md#rp-00003)`).
- `tier1/tools/docs`는 설계자 전용 로컬 대시보드다. 이 저장소 **자신**의
  문서를 보려면 `python tier1/tools/docs/server.py --port 8756 --root .`
  (`.claude/launch.json`의 `docs-dashboard` 설정과 동일). 순수 템플릿
  자체를 확인하려면 `--root` 없이 실행(`tier1-template-dashboard` 설정).

## `tier1/` 참조 원본을 고쳤을 때

`tier1/CLAUDE.md`, `tier1/docs/`, `tier1/tools/docs/` 중 하나라도 고치면
반드시 재생성한다:

```bash
python scripts/build_prompt.py
```

`bootstrap-prompt.md`가 `tier1/` 내용 그대로 재조립된다. `bootstrap-prompt.md`를
손으로 직접 고치지 않는다(다음 재생성 때 덮어써짐).

<!-- 아래에 프로젝트 고유의 빌드/테스트/코딩 규칙을 추가한다. -->
