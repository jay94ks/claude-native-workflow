// 배치 2c(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 코드
// 관계도(Code Relation Graph). mcp/server.ts에서 그대로 잘라낸 것 -
// 로직은 전혀 안 바뀜.
//
// 코드 탐색 중 스스로 발견한 "무엇이 어디서 왜 참조되는지"를 기록해
// 두는 개인 인덱스 - 프로젝트 내 설계자(로그인 계정)별로 완전히
// 독립적이다(폴더와 동일 원칙, 다른 설계자의 관계는 전혀 안 보임).
// 상위/하위는 단일 부모 트리가 아니라 다대다 그래프(순환 허용) - 한
// 관계가 여러 부모/여러 자식을 동시에 가질 수 있다. 여러 파일을
// 가로지르는 탐색이라 다시 파악하려면 비용이 드는 발견일 때만
// 기록한다(사소한 한 줄짜리 조회까지 전부 기록하는 감사 로그가
// 아님) - 탐색 전에 relation_list/relation_descendants로 이미
// 기록된 게 있는지 먼저 확인하는 습관을 들인다.
import { z } from "zod";
import { detectCurrentGitBranch } from "../../cli/apiclient.js";
import { call, registerListTool, type ToolRegistrar } from "../shared.js";
import { relationListSpec } from "../../shared/listOperation.specs.js";

const relationItemObject = z.object({
  target: z.string(),
  referrer: z.string(),
  purpose: z.string(),
  filePath: z.string(),
  line: z.number().optional(),
  column: z.number().optional(),
  data: z.unknown().optional(),
  trackingCodes: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  parentIds: z.array(z.string()).optional(),
  childIds: z.array(z.string()).optional(),
  branchName: z.string().optional(),
});

export function registerRelationTools(tool: ToolRegistrar): void {
  tool(
    "relation_add",
    "코드 관계 추가",
    "무엇을(target) 어디서(referrer) 어느 파일의 몇 줄/몇 열에서(filePath/line/column) 무슨 목적으로(purpose) 참조했는지 기록한다. trackingCodes로 연관 문서(여러 개 가능, 실제 존재하는 문서여야 함)를 묶고, tags로 자유롭게 분류하고, parentIds/childIds로 다른 관계와 다대다로 연결할 수 있다(순환 허용). branchName을 생략하면 이 MCP 서버 프로세스의 현재 디렉터리에서 git으로 자동 감지한 브랜치가 쓰인다.",
    { projectId: z.string(), ...relationItemObject.shape },
    async (a) => {
      const { projectId, ...body } = a;
      if (body.branchName === undefined) body.branchName = detectCurrentGitBranch() ?? undefined;
      return call(`/api/projects/${projectId}/relations`, { method: "POST", body: JSON.stringify(body) });
    },
  );

  tool(
    "relation_update",
    "코드 관계 수정",
    "필드는 준 것만 갱신된다. tags를 주면 전체 교체, 상위/하위 연결은 addParentIds/removeParentIds/addChildIds/removeChildIds로 개별 추가·제거한다. branchName을 안 주면 기존 값을 유지한다(자동 감지 안 함).",
    {
      projectId: z.string(),
      id: z.string(),
      ...relationItemObject.omit({ parentIds: true, childIds: true }).partial().shape,
      addParentIds: z.array(z.string()).optional(),
      removeParentIds: z.array(z.string()).optional(),
      addChildIds: z.array(z.string()).optional(),
      removeChildIds: z.array(z.string()).optional(),
    },
    async (a) => {
      const { projectId, id, ...body } = a;
      return call(`/api/projects/${projectId}/relations/${id}`, { method: "PUT", body: JSON.stringify(body) });
    },
  );

  tool("relation_remove", "코드 관계 삭제", "관련 엣지/태그만 함께 정리되고 나머지 그래프는 그대로 남는다.", { projectId: z.string(), id: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/relations/${a.id}`, { method: "DELETE" }),
  );

  tool("relation_get", "코드 관계 단건 조회", "직접 상위/하위 id 목록(parentIds/childIds)을 포함해 반환한다.", { projectId: z.string(), id: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/relations/${a.id}`),
  );

  registerListTool(tool, relationListSpec);

  tool("relation_parents", "직접 상위 관계 목록", "이 관계의 직접 부모들(1단계)만 반환한다.", { projectId: z.string(), id: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/relations/${a.id}/parents`),
  );
  tool("relation_children", "직접 하위 관계 목록", "이 관계의 직접 자식들(1단계)만 반환한다.", { projectId: z.string(), id: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/relations/${a.id}/children`),
  );

  tool(
    "relation_ancestors",
    "상위 방향 깊이 순회",
    "id에서 위(부모 방향)로 depth까지 펼쳐서 반환(기본 3, 최대 20) - tag/q로 필터링해도 순회 자체는 안 끊긴다(필터링된 노드만 결과에서 빠짐).",
    { projectId: z.string(), id: z.string(), depth: z.number().optional(), tag: z.string().optional(), q: z.string().optional() },
    async (a) => {
      const qs = new URLSearchParams();
      if (a.depth !== undefined) qs.set("depth", String(a.depth));
      if (a.tag) qs.set("tag", String(a.tag));
      if (a.q) qs.set("q", String(a.q));
      return call(`/api/projects/${a.projectId}/relations/${a.id}/ancestors?${qs}`);
    },
  );
  tool(
    "relation_descendants",
    "하위 방향 깊이 순회",
    "id에서 아래(자식 방향)로 depth까지 펼쳐서 반환(기본 3, 최대 20) - tag/q로 필터링해도 순회 자체는 안 끊긴다(필터링된 노드만 결과에서 빠짐).",
    { projectId: z.string(), id: z.string(), depth: z.number().optional(), tag: z.string().optional(), q: z.string().optional() },
    async (a) => {
      const qs = new URLSearchParams();
      if (a.depth !== undefined) qs.set("depth", String(a.depth));
      if (a.tag) qs.set("tag", String(a.tag));
      if (a.q) qs.set("q", String(a.q));
      return call(`/api/projects/${a.projectId}/relations/${a.id}/descendants?${qs}`);
    },
  );

  tool(
    "relation_add_bulk",
    "코드 관계 일괄 추가",
    "한 번의 탐색으로 여러 관계가 나왔을 때 배열로 한 번에 등록한다. 항목별 성공/실패 결과 배열을 반환(부분 성공 허용).",
    { projectId: z.string(), items: z.array(relationItemObject) },
    async (a) => call(`/api/projects/${a.projectId}/relations/bulk`, { method: "POST", body: JSON.stringify({ items: a.items }) }),
  );
  tool(
    "relation_update_bulk",
    "코드 관계 일괄 수정",
    "id를 포함한 항목 배열로 여러 관계를 한 번에 갱신한다. 항목별 성공/실패 결과 배열을 반환.",
    {
      projectId: z.string(),
      items: z.array(relationItemObject.partial().extend({ id: z.string() })),
    },
    async (a) => call(`/api/projects/${a.projectId}/relations/bulk`, { method: "PUT", body: JSON.stringify({ items: a.items }) }),
  );
  tool(
    "relation_remove_bulk",
    "코드 관계 일괄 삭제",
    "id 배열로 여러 관계를 한 번에 삭제한다. 항목별 성공/실패 결과 배열을 반환.",
    { projectId: z.string(), ids: z.array(z.string()) },
    async (a) => call(`/api/projects/${a.projectId}/relations/bulk`, { method: "DELETE", body: JSON.stringify({ ids: a.ids }) }),
  );
  tool(
    "relation_reset",
    "코드 관계도 일괄 초기화",
    "이 설계자의 관계를 브랜치 기준으로 한 번에 삭제한다(관계도 초기화). branchName을 생략하고 allBranches도 안 주면 '브랜치 없음' 관계만 삭제한다.",
    { projectId: z.string(), branchName: z.string().optional(), allBranches: z.boolean().optional() },
    async (a) => {
      const qs = new URLSearchParams();
      if (a.allBranches) qs.set("allBranches", "true");
      else qs.set("branchName", String(a.branchName ?? "__none__"));
      return call(`/api/projects/${a.projectId}/relations/reset?${qs}`, { method: "DELETE" });
    },
  );
}
