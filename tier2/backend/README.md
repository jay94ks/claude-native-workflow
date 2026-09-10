# @claude-native-workflow/tier2-backend

[claude-native-workflow](https://github.com/jay94ks/claude-native-workflow)의
평범(Tier 2) 등급 백엔드 — `docs/` 설계 문서 조작 로직을 한 번만 구현하고,
`docs` CLI·MCP 서버·REST API·대시보드가 전부 이 패키지를 통해 그 로직을
공유한다. 문서 생성/저장/답변마다 자동으로 git commit까지 수행한다.

전체 배경과 설계는 저장소 루트의
[README](https://github.com/jay94ks/claude-native-workflow#평범-tier-2--로컬-상시-기동-mcpclii대시보드)와
[SP-00001](https://github.com/jay94ks/claude-native-workflow/blob/main/docs/spec/SP-00001.md)
참고.

## 설치

```bash
npm install -g @claude-native-workflow/tier2-backend
```

전역 설치하면 `docs` 명령이 생긴다. MCP 서버로 쓰려면 `claude mcp add`에
`docs-mcp -- node $(npm root -g)/@claude-native-workflow/tier2-backend/dist/mcp/server.js --root <프로젝트 루트>`
형태로 등록한다(정확한 경로는 `npm root -g`로 확인).

## 사용

```bash
docs tree --root <프로젝트 루트>       # 문서 트리
docs doc <path> --root <프로젝트 루트> # 문서 1건 조회
docs new SP --title "..." --root <프로젝트 루트>
docs validate --root <프로젝트 루트>
```

`--root`를 생략하면 현재 디렉터리를 프로젝트 루트로 본다. 전체 명령
목록은 `docs --help`.

## 서버로 실행 (REST API/대시보드용)

```bash
docs-server --port 8766 --root <프로젝트 루트>
```

Docker Compose로 백엔드+대시보드를 한 번에 띄우는 방법은 저장소의
[tier2/docker](https://github.com/jay94ks/claude-native-workflow/tree/main/tier2/docker)
참고.

## 라이선스

MIT

---

## (메인테이너용) 배포 절차

```bash
npm login          # 최초 1회, 로그인 안 돼 있으면
cd tier2/backend
npm run build
npm publish         # publishConfig.access:public이라 --access public 안 붙여도 됨
```

`tier3/backend`가 이 패키지를 `file:` 의존성으로 참조하므로(모노레포
로컬 개발용), tier2를 새 버전으로 배포했다면 `tier3/backend`도 같이
배포하기 전에 그쪽 README의 "메인테이너용 배포 절차"를 먼저 읽는다 -
tier3는 이 파일과 달리 배포 시점에 의존성을 임시로 바꿔야 한다.
