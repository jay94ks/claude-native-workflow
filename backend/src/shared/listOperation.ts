// BL-57F8DF17 #64(PN-01007911) - CLI 명령/MCP 도구를 하나의 "연산
// 서술자"로 동시 생성하는 패턴의 첫 시범 적용. 목록/필터 계열 명령이
// CLI(cli/commands/*.ts)/MCP(mcp/tools/*.ts) 양쪽에 거의 동일한
// URLSearchParams 빌딩 로직을 복붙하고 있던 것을, 런타임(Commander/
// zod)에 무관한 순수 서술자 하나로 통합한다 - `audit:cli-mcp`가
// 사후 검사하던 CLI/MCP 대칭성이 이 패턴을 쓰는 명령에 한해 설계상
// 항상 보장된다(같은 서술자에서 CLI 옵션/MCP 파라미터를 둘 다 만드니
// 이름을 깜빡 하나만 바꾸는 실수 자체가 안 남).
//
// 단순 CRUD가 아닌 명령(git 계열처럼 옵션 조합이 복잡하거나 본문
// 스트림을 그대로 넘기는 것)은 이 패턴으로 억지로 묶지 않는다 - PN
// -01007911 본문 3단계 그대로. 이 파일은 "목록/필터" 모양에 맞는
// 것만 다룬다.
//
// 이 API가 실제로 겪는 페이지네이션 관례가 두 가지라 `paginated`로
// 구분해야 한다(둘 다 이 저장소에 실존 - doctypes류는 A, relation
// list는 B):
//   - "suffix": page/pageSize 중 하나라도 있으면 URL에 "/page"를
//     붙이고 그 둘만 쿼리스트링에 싣는다, 없으면 그 접미사 없이
//     평범한 배열 응답(예: GET /doc-types vs GET /doc-types/page).
//   - "inline": URL은 항상 그대로, page/pageSize가 있으면 그냥 같은
//     쿼리스트링에 실어 보낸다 - 서버가 그 유무로 배열/Page 응답을
//     스스로 가른다(예: GET /relations?page=1&pageSize=20).
export type ListParamType = "string" | "boolean";

export interface ListFilterParam {
  /** MCP zod 파라미터 이름(정본) - 예: "rootOnly". */
  key: string;
  /** REST 쿼리스트링 키가 `key`와 다를 때만 명시(예: rootOnly는
   * 쿼리스트링에선 "hasNoParent"). 생략하면 `key`를 그대로 쓴다. */
  qsKey?: string;
  type: ListParamType;
  /** Commander 옵션 선언 문자열 - 예: "--file <path>", "--root-only". */
  cliFlag: string;
  /** Commander가 cliFlag로부터 자동 유도하는 opts 프로퍼티 이름이
   * `key`와 다를 때만 명시(예: "--file <path>" → opts.file인데 정본
   * 키는 filePath). 생략하면 cliFlag에서 자동 유도한 이름을 그대로
   * 쓴다(즉 opts 키 == 정본 키인 흔한 경우). */
  cliOptsKey?: string;
  /** CLI 옵션 설명(둘 다 있으면 MCP 쪽 설명 조립에도 재사용). */
  description?: string;
  /** true면 일반적인 "값 있으면 qs.set(key, value)" 처리를 건너뛰고
   * `extraQs`가 이 값까지 포함해 전적으로 책임진다(예: relation list의
   * branchName/allBranches처럼 두 필드가 서로 배타적으로 하나의
   * 쿼리스트링 키만 채우는 경우). */
  custom?: boolean;
}

export interface ListOperationSpec {
  /** CLI: 이 이름으로 `<parent>.command("<cliName> <projectId>")`. */
  cliName: string;
  cliDescription?: string;
  /** MCP: 도구 이름/제목/설명(전체 설명 한 문단 - 기존 관례와 동일). */
  mcpName: string;
  mcpTitle: string;
  mcpDescription: string;
  /** 페이지네이션 접미사 없는 REST 기본 경로(예: "doc-types",
   * "relations" - 앞뒤 슬래시 없이). */
  restPath: (projectId: string) => string;
  filters?: ListFilterParam[];
  paginated: "suffix" | "inline" | false;
  /** custom 필터나 그 외 공식화하기 애매한 추가 쿼리스트링을 채우는
   * 탈출구(예: 브랜치 자동 감지) - args는 정본 키로 채워진 값들. */
  extraQs?: (args: Record<string, unknown>) => Record<string, string | undefined>;
}

function flagToOptsKey(cliFlag: string): string {
  const long = cliFlag.trim().split(/\s+/)[0]; // "--root-only" 또는 "--file"
  const name = long.replace(/^--/, "");
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** ListFilterParam마다 CLI opts에서 실제로 읽어올 프로퍼티 이름. */
export function paramOptsKey(p: ListFilterParam): string {
  return p.cliOptsKey ?? flagToOptsKey(p.cliFlag);
}

/** 정본 키(예: filePath)로 채워진 args(필터값+선택적 page/pageSize)로부터
 * 최종 요청 URL을 만든다 - CLI/MCP 양쪽이 이 함수 하나만 공유하면
 * 쿼리스트링 조립 로직이 완전히 한 곳에만 있게 된다. */
export function buildListUrl(spec: ListOperationSpec, projectId: string, args: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const f of spec.filters ?? []) {
    if (f.custom) continue;
    const v = args[f.key];
    const qsKey = f.qsKey ?? f.key;
    if (f.type === "boolean") {
      if (v) qs.set(qsKey, "true");
    } else if (v !== undefined && v !== null && v !== "") {
      qs.set(qsKey, String(v));
    }
  }
  if (spec.extraQs) {
    for (const [k, v] of Object.entries(spec.extraQs(args))) {
      if (v !== undefined) qs.set(k, v);
    }
  }

  const base = spec.restPath(projectId);
  if (spec.paginated === false) {
    const s = qs.toString();
    return s ? `${base}?${s}` : base;
  }

  const page = args.page as number | string | undefined;
  const pageSize = args.pageSize as number | string | undefined;
  const paged = page !== undefined || pageSize !== undefined;

  if (spec.paginated === "suffix") {
    if (paged) {
      qs.set("page", String(page ?? 1));
      qs.set("pageSize", String(pageSize ?? 20));
      return `${base}/page?${qs}`;
    }
    const s = qs.toString();
    return s ? `${base}?${s}` : base;
  }

  // "inline"
  if (paged) {
    qs.set("page", String(page ?? 1));
    qs.set("pageSize", String(pageSize ?? 20));
  }
  return `${base}?${qs}`;
}
