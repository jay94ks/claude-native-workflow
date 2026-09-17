// 배치 2i(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 세부
// 접근 권한. mcp/server.ts에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜.
import { z } from "zod";
import { call, type ToolRegistrar } from "../shared.js";

export function registerAccessControlTools(tool: ToolRegistrar): void {
  tool(
    "access_set",
    "세부 접근 권한 설정",
    "프로젝트 공통/문서타입/개별문서 스코프 중 하나(docTypeId나 documentId를 주면 그 스코프, 둘 다 안 주면 프로젝트 공통)로 특정 사용자의 읽기/쓰기/삭제 권한을 설정한다 - owner 전용.",
    {
      projectId: z.string(),
      userId: z.string(),
      docTypeId: z.string().optional(),
      documentId: z.string().optional(),
      canRead: z.boolean().optional(),
      canWrite: z.boolean().optional(),
      canDelete: z.boolean().optional(),
    },
    async (a) => {
      const patch = { userId: a.userId, canRead: a.canRead, canWrite: a.canWrite, canDelete: a.canDelete };
      if (a.documentId) return call(`/api/documents/${a.documentId}/access`, { method: "PUT", body: JSON.stringify(patch) });
      if (a.docTypeId) return call(`/api/projects/${a.projectId}/doc-types/${a.docTypeId}/access`, { method: "PUT", body: JSON.stringify(patch) });
      return call(`/api/projects/${a.projectId}/access`, { method: "PUT", body: JSON.stringify(patch) });
    },
  );
  tool(
    "access_list",
    "세부 접근 권한 목록",
    "프로젝트에 설정된 모든 오버라이드 목록. page/pageSize를 주면 페이지네이션 응답(total 포함), 생략하면 전체 배열.",
    { projectId: z.string(), page: z.number().optional(), pageSize: z.number().optional() },
    async (a) => {
      if (a.page === undefined && a.pageSize === undefined) return call(`/api/projects/${a.projectId}/access`);
      const qs = new URLSearchParams({ page: String(a.page ?? 1), pageSize: String(a.pageSize ?? 20) });
      return call(`/api/projects/${a.projectId}/access/page?${qs}`);
    },
  );
  tool(
    "access_overview",
    "내 접근 제한 전체 조회",
    "이 설계자가 전체 설치에서 어떤 접근 제한을 받고 있는지 프로젝트를 가로질러 한 번에 조회한다.",
    {},
    async () => call("/api/auth/me/access-overview"),
  );
}
