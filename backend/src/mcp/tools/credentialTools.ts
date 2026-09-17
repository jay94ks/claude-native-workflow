// 배치 2b(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - git
// 자격증명. mcp/server.ts에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜.
// (API 키 쪽은 CLI 전용이라 MCP 도구가 원래 없음 - 여기 없는 게 맞음.)
import { z } from "zod";
import { call, type ToolRegistrar } from "../shared.js";

export function registerCredentialTools(tool: ToolRegistrar): void {
  tool(
    "credential_add",
    "git 자격증명 등록",
    "외부 git 저장소용 자격증명을 AES-256-GCM으로 암호화해 저장한다.",
    { credentialType: z.enum(["token", "username_password", "ssh_key"]), value: z.string(), hostPattern: z.string().optional() },
    async (a) => call("/api/credentials", { method: "POST", body: JSON.stringify(a) }),
  );
  tool(
    "credential_list",
    "git 자격증명 목록",
    "저장된 자격증명 목록(payload는 제외). page/pageSize를 주면 페이지네이션 응답(total 포함), 생략하면 전체 배열.",
    { page: z.number().optional(), pageSize: z.number().optional() },
    async (a) => {
      if (a.page === undefined && a.pageSize === undefined) return call("/api/credentials");
      const qs = new URLSearchParams({ page: String(a.page ?? 1), pageSize: String(a.pageSize ?? 20) });
      return call(`/api/credentials/page?${qs}`);
    },
  );
  tool("credential_remove", "git 자격증명 삭제", "id로 자격증명을 삭제한다.", { id: z.string() }, async (a) =>
    call(`/api/credentials/${a.id}`, { method: "DELETE" }),
  );
}
