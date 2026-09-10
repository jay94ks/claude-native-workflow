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

## `docs3` CLI 자체를 Claude가 쓸 수 있게 하기

`tier3/backend`의 `package.json`도 `"private": true`라 **npm
레지스트리에 공개돼 있지 않다** — `npm install -g` / `npx`는 지금은
동작하지 않는다. `docs3`는 (tier2의 `docs`와 달리) REST API를 호출하는
얇은 클라이언트일 뿐이라 서버 컨테이너 안이 아니라 **설계자 자신의
머신에서** 실행돼야 한다 — 그래서 tier2처럼 `docker compose exec`로
우회할 수 없고, 로컬에 빌드해 둬야 한다:

```bash
git clone https://github.com/jay94ks/claude-native-workflow.git
cd claude-native-workflow/tier2/backend && npm install && npm run build
cd ../../tier3/backend && npm install && npm run build
npm link   # 전역에 `docs3` 명령을 심는다(npm install -g . 도 동일)
```

(`tier3/backend`가 `tier2/backend`를 `file:../../tier2/backend`
의존성으로 참조하므로 두 디렉터리 모두 이 상대 위치 그대로 있어야 하고,
tier2 쪽을 먼저 빌드해야 한다.) 이후 `docs3 login --api <서버 주소>
...`로 이 프로젝트에 연결한다(계정/프로젝트 ID 확인은 이 Skill 본문
"계정과 로그인"/"프로젝트 ID 확인" 절 참고).

저장소를 통째로 clone해서 두 단계를 빌드해야 하는 이 임시 안내는
마찰이 있다는 걸 알고 있다 — npm에 정식 공개 배포할지는 별도 결정
사항으로 남겨뒀다. [DC-00003](../../docs/decision/DC-00003.md) 참고.
