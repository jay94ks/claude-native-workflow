# docs CLI/MCP Skill — 배포 방법

이 폴더는 `docs` CLI/MCP 서버([tier2/backend](../backend))를 Claude에게
안내하는 Claude Code Skill의 **참조 원본**이다(`tier1/`이 초간단 등급
파일들의 참조 원본인 것과 같은 역할 — 이 저장소 자신이 이 Skill을 쓰는
게 아니라, Tier 2로 배포되는 **다른** 프로젝트가 가져가 쓴다).

## 새 Tier 2 프로젝트에 설치하기

`.claude/skills/docs-cli/` 디렉터리 전체를 그 프로젝트의 저장소 루트로
복사한다:

```bash
cp -r .claude/skills/docs-cli <프로젝트 루트>/.claude/skills/docs-cli
```

그 프로젝트에서 Claude Code 세션을 새로 시작하면 `.claude/skills/`가
자동으로 인식되어, docs 관련 작업을 할 때 이 Skill이 자동으로 로드된다.
설치 후 별도 빌드/설정은 필요 없다 — `docs` CLI/MCP 서버 자체는
[tier2/backend](../backend)를 `npm install -g` 하거나 `npx` 로 실행하는
쪽, 또는 [tier2/docker](../docker)의 Docker Compose로 띄우는 쪽을 그
프로젝트의 `CLAUDE.md`나 온보딩 문서에서 별도로 안내한다. MCP 서버를
Claude Code에 등록하려면 `claude mcp add`(또는 프로젝트의 MCP 설정
파일)에 `node <tier2/backend 경로>/dist/mcp/server.js --root <프로젝트
루트>`를 등록한다.
