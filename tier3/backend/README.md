# @claude-native-workflow/tier3-backend

[claude-native-workflow](https://github.com/jay94ks/claude-native-workflow)의
고급(Tier 3) 등급 - `docs3` CLI(REST 클라이언트)와 그 CLI가 호출하는
멀티테넌시 서버를 함께 담고 있다.

## `docs3` CLI 설치 (설계자/Claude용)

```bash
npm install -g @claude-native-workflow/tier3-backend
```

전역 설치하면 `docs3` 명령이 생긴다. 서버 주소와 프로젝트에 로그인한 뒤
바로 쓸 수 있다:

```bash
docs3 register --api <서버 주소> --username <아이디> --email <이메일> --password <비밀번호>
docs3 login --api <서버 주소> --username <아이디> --password <비밀번호>
docs3 projects
docs3 tree <projectId>
```

전체 명령은 `docs3 --help`, 사용 가이드는 저장소의
[tier3/skill](https://github.com/jay94ks/claude-native-workflow/tree/main/tier3/skill)
(Claude Code Skill)과
[SP-00002](https://github.com/jay94ks/claude-native-workflow/blob/main/docs/spec/SP-00002.md)
참고.

## 서버

이 패키지가 감싸고 있는 REST 서버는 `npm install`만으로는 뜨지 않는다 -
MySQL/PostgreSQL 등 DB와 `JWT_SECRET`/`GITHUB_WEBHOOK_SECRET` 같은
설정이 필요해서, Docker Compose로 배포하는 것을 전제로 한다:

```bash
cd tier3/docker
cp .env.example .env   # 시크릿 채우기
docker compose up -d --build
```

자세한 내용은 저장소의
[tier3/docker](https://github.com/jay94ks/claude-native-workflow/tree/main/tier3/docker)
참고.

## 라이선스

MIT

---

## (메인테이너용) 배포 절차

`package.json`의 `@claude-native-workflow/tier2-backend` 의존성은
로컬 모노레포 개발용으로 `file:../../tier2/backend`를 그대로 쓴다 -
npm 레지스트리에 발행하는 패키지 안에 `file:` 경로가 그대로 남아있으면
설치하는 쪽에서 그 경로를 찾지 못해 조용히 생략된다(에러 없이 그냥
빠짐). 이 저장소의 `docs3` CLI 자체는 `tier2-backend`를 전혀 import하지
않아서(REST 클라이언트라 서버 쪽 코드와 완전히 분리돼 있음) 실제로는
문제없이 동작하는 걸 확인했지만, `package.json`에 깨진 의존성을 그대로
남겨두는 건 지저분하다 - 배포 시점에만 실제 버전으로 바꿨다 되돌린다:

```bash
# 1. tier2/backend를 먼저 배포했는지 확인(버전 확인: npm view @claude-native-workflow/tier2-backend version)

# 2. 의존성을 임시로 실제 버전으로 바꾼다
#    package.json: "@claude-native-workflow/tier2-backend": "file:../../tier2/backend"
#    →            "@claude-native-workflow/tier2-backend": "^0.1.0" (방금 배포한 버전)

cd tier3/backend
npm install        # 레지스트리에서 새로 받아 resolve
npm run build
npm publish

# 3. 로컬 개발로 되돌린다(커밋하지 않을 거라면 git checkout으로 되돌려도 됨)
#    package.json을 다시 "file:../../tier2/backend"로 바꾸고:
npm install
```

한 번 배포할 때마다 수동으로 이 3단계를 거친다(자동화는 하지 않기로
결정 - [DC-00003](https://github.com/jay94ks/claude-native-workflow/blob/main/docs/decision/DC-00003.md)
참고).
