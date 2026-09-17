// gitea.ts(REST 전용 래퍼)와 gitExec.ts(es-git 기반 영구 로컬 클론)가
// 공통으로 참조하는 git 도메인 타입 - 원래 gitea.ts에 정의돼 있었는데,
// 더 최신/주력 모듈인 gitExec.ts가 그걸 역으로 import하는 의존성 역전이
// 있었다(#gitea-gitexec-read-consolidation 조사로 발견, BL-57F8DF17
// #61) - 두 모듈보다 한 단계 낮은 공용 위치로 옮겨 정리한다. gitea.ts는
// 하위 호환을 위해 이 파일에서 그대로 재수출(re-export)한다 - 다른
// 파일들(gitRepos.ts/gitStaging.ts/members.ts 등)은 여전히 "./gitea.js"
// 에서 import해도 그대로 동작한다.

/** 항상 호출부가 이미 계산해 넘긴 org/repo 조합만 다룬다 - Gitea REST
 * 래퍼(gitea.ts)와 로컬 클론 실행기(gitExec.ts) 양쪽에서 "어느 저장소를
 * 가리키는지"를 표현하는 공용 타입. */
export interface GiteaRepoRef {
  org: string;
  repo: string;
}

/** migrateRepo()가 "인증이 필요해서 실패"를 다른 실패와 구분해 던질 때
 * 쓴다 - 호출부(gitRepos.ts)가 이 타입만 잡아서 "자격증명 입력 후
 * 재시도" 흐름으로 안내할 수 있게. */
export class GitAuthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitAuthRequiredError";
  }
}
