// BL-57F8DF17 #64(PN-01007911) - listOperation.ts 패턴의 실제 서술자
// 정의(정본 하나를 cli/commands/*.ts와 mcp/tools/*.ts 양쪽이 그대로
// import) - 대칭성이 두 파일에 각자 옮겨 적는 게 아니라 구조적으로
// 보장된다. 이 라운드에서 시범 적용한 2개(가장 단순한 페이지네이션
// 전용 목록 1개 + 필터+브랜치 자동 감지까지 있는 복잡한 목록 1개)만
// 담는다 - 나머지 목록/필터 계열 명령으로 넓히는 건 PN-01007911 본문
// 2단계가 "패턴이 검증되면" 조건부로 남겨둔 후속 작업.
import { detectCurrentGitBranch } from "../cli/apiclient.js";
import type { ListOperationSpec } from "./listOperation.js";

export const docTypeListSpec: ListOperationSpec = {
  cliName: "doctypes",
  mcpName: "doctype_list",
  mcpTitle: "문서 타입 목록",
  mcpDescription:
    "그 프로젝트에 정의된 문서 타입 목록(팀/그룹 단위로 획일화해 정하는 기능은 없음 - 항상 프로젝트 자신에게만 정의됨. 각 항목의 isDefault로 기본 시드 타입인지 구분 가능). page/pageSize를 주면 페이지네이션 응답(total 포함), 생략하면 전체 배열.",
  restPath: (projectId) => `/api/projects/${projectId}/doc-types`,
  paginated: "suffix",
};

export const relationListSpec: ListOperationSpec = {
  cliName: "list",
  mcpName: "relation_list",
  mcpTitle: "코드 관계 목록/검색",
  mcpDescription:
    "q(target/referrer/purpose 부분 일치)/filePath(정확 일치)/trackingCode(이 문서를 연관 문서로 갖는 관계만, 정확 일치)/tag/rootOnly(최상위만)로 필터. branchName을 생략하면(allBranches도 안 주면) 이 MCP 서버 프로세스의 현재 디렉터리에서 git으로 자동 감지한 브랜치로 필터링되고, allBranches:true면 브랜치 구분 없이 전체(과거 데이터 포함)를 본다. page/pageSize를 둘 다 생략하면 전체 배열, 하나라도 주면 페이지네이션 응답.",
  restPath: (projectId) => `/api/projects/${projectId}/relations`,
  paginated: "inline",
  filters: [
    { key: "q", type: "string", cliFlag: "--q <query>" },
    { key: "filePath", type: "string", cliFlag: "--file <path>", cliOptsKey: "file", description: "filePath 정확 일치" },
    {
      key: "trackingCode",
      type: "string",
      cliFlag: "--ref <trackingCode>",
      cliOptsKey: "ref",
      description: "이 문서를 연관 문서로 갖는 관계만(정확 일치)",
    },
    { key: "tag", type: "string", cliFlag: "--tag <tag>" },
    { key: "rootOnly", qsKey: "hasNoParent", type: "boolean", cliFlag: "--root-only", description: "상위 관계가 없는 최상위만" },
    // branchName/allBranches는 서로 배타적으로 하나의 쿼리스트링 키만
    // 채우는 co-dependent 쌍이라(extraQs 참고) 일반 필터 처리는 건너뛴다
    // (custom:true) - CLI/MCP 입력 표면(옵션/파라미터) 생성에만 쓰인다.
    { key: "branchName", type: "string", cliFlag: "--branch <name>", cliOptsKey: "branch", description: "생략하면 현재 디렉터리의 git 브랜치를 자동 감지해서 필터", custom: true },
    { key: "allBranches", type: "boolean", cliFlag: "--all-branches", description: "브랜치 필터 없이 전체(과거 데이터 포함) 조회", custom: true },
  ],
  extraQs: (args) => {
    if (args.allBranches) return { allBranches: "true" };
    return { branchName: String((args.branchName as string | undefined) ?? detectCurrentGitBranch() ?? "") };
  },
};
