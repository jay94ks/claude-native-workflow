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

## `docs` CLI/MCP 서버 자체를 Claude가 쓸 수 있게 하기

`tier2/backend`의 `package.json`은 `"private": true`라 **npm 레지스트리에
공개돼 있지 않다** — `npm install -g @claude-native-workflow/tier2-backend`나
`npx @claude-native-workflow/tier2-backend`는 지금은 실행할 수 없다(둘
다 참고용으로도 안내하지 않는다 — 실제로 동작하지 않는 명령을 Skill에
남겨두면 그대로 새 프로젝트에 복붙돼 혼란만 준다).

**권장: [tier2/docker](../docker)의 Docker Compose를 이미 띄운 상태라면
컨테이너 안의 빌드 산출물을 그대로 쓴다** — 별도 로컬 설치가 전혀 필요
없다:

```bash
# CLI
docker compose -f tier2/docker/docker-compose.yml exec backend \
  node dist/cli/index.js <명령...> --root /workspace

# MCP (claude mcp add에 등록할 명령 — -T로 TTY 할당을 꺼야 stdio가 깨끗하게 전달된다)
claude mcp add docs -- docker compose -f tier2/docker/docker-compose.yml exec -T backend \
  node dist/mcp/server.js --root /workspace
```

`--root /workspace`는 필수다(컨테이너의 `WORKDIR`은 `/app`이라 생략하면
엉뚱한 위치를 본다) — `docker-compose.yml`이 프로젝트 루트를 컨테이너의
`/workspace`에 마운트해두기 때문에 이 값으로 고정. 이 경로는 실제로
빌드한 이미지에 스크래치 프로젝트를 마운트해 `docs new`까지 끝까지
실행 → git 커밋이 실제로 잡히는 것을 확인해서 검증했다(상세는
[DN-00001](../../docs/done/DN-00001.md) "QA: tier2/tier3 Docker
이미지에 git이 아예 없어 자동 commit이 실제로는 다 깨짐" 참고 — 이
경로를 검증하다가 발견한 별개의 실제 버그였고 이미 고쳐졌다).

**Docker 없이 로컬에서 바로 쓰려면**(개발 중이거나 Compose를 안 쓰는
경우): `claude-native-workflow` 저장소를 아무 데나 clone한 뒤
`tier2/backend`에서 `npm install && npm run build`, 그다음
`npm link`(또는 `npm install -g .`)로 `docs` 명령을 전역에 심는다. 이
경로는 Node/npm이 로컬에 있어야 하고 저장소 전체를 따로 받아야 하므로,
Compose로 이미 서버가 떠 있다면 위의 `docker compose exec` 쪽이 더
간단하다.

npm 레지스트리 공개 배포는 별도 결정 사항으로 남겨뒀다 —
[DC-00003](../../docs/decision/DC-00003.md) 참고.
