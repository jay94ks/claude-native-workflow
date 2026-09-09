# docs3 CLI Skill — 배포 방법

이 폴더는 `docs3` CLI([tier3/backend](../backend))를 Claude에게 안내하는
Claude Code Skill의 **참조 원본**이다(`tier1/`이 초간단 등급 파일들의
참조 원본인 것과 같은 역할 — 이 저장소 자신이 이 Skill을 쓰는 게 아니라,
Tier 3로 배포되는 **다른** 프로젝트가 가져가 쓴다).

## 새 Tier 3 프로젝트에 설치하기

`.claude/skills/docs3-cli/` 디렉터리 전체를 그 프로젝트의 저장소 루트로
복사한다:

```bash
cp -r .claude/skills/docs3-cli <프로젝트 루트>/.claude/skills/docs3-cli
```

그 프로젝트에서 Claude Code 세션을 새로 시작하면 `.claude/skills/`가
자동으로 인식되어, docs3 관련 작업을 할 때 이 Skill이 자동으로 로드된다.
설치 후 별도 빌드/설정은 필요 없다 — `docs3` CLI 자체(바이너리)는
[tier3/backend](../backend)를 `npm install -g` 하거나 `npx` 로 실행하는
쪽을 그 프로젝트의 `CLAUDE.md`나 온보딩 문서에서 별도로 안내한다.
