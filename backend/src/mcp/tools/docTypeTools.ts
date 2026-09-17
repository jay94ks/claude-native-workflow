// 배치 2g(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 문서
// 타입 체계. mcp/server.ts에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜.
// doctype_list는 BL-57F8DF17 #64(PN-01007911)의 "연산 서술자" 패턴
// 시범 적용 대상 - docTypeListSpec은 cli/commands/docTypeCommands.ts와
// 공유(../../shared/listOperation.specs.js).
import { z } from "zod";
import { call, registerListTool, type ToolRegistrar } from "../shared.js";
import { docTypeListSpec } from "../../shared/listOperation.specs.js";

export function registerDocTypeTools(tool: ToolRegistrar): void {
  tool(
    "doctype_create",
    "문서 타입 생성",
    "프로젝트 스코프로 새 문서 타입을 정의한다(code는 영문 2글자).",
    { projectId: z.string(), code: z.string(), label: z.string(), guideline: z.string().optional() },
    async (a) => call(`/api/projects/${a.projectId}/doc-types`, { method: "POST", body: JSON.stringify({ code: a.code, label: a.label, guideline: a.guideline }) }),
  );
  registerListTool(tool, docTypeListSpec);
  tool(
    "doctype_update",
    "문서 타입 이름 수정",
    "code/label을 수정한다 - 프로젝트 생성 시 자동으로 심어진 기본 타입(isDefault: true)은 거부됨(삭제만 가능).",
    { projectId: z.string(), docTypeId: z.string(), code: z.string().optional(), label: z.string().optional() },
    async (a) =>
      call(`/api/projects/${a.projectId}/doc-types/${a.docTypeId}`, {
        method: "PUT",
        body: JSON.stringify({ code: a.code, label: a.label }),
      }),
  );
  tool(
    "doctype_delete",
    "문서 타입 삭제",
    "문서 타입을 삭제한다 - 이 타입으로 만든 문서가 하나라도 남아있으면 거부됨(기본/커스텀 타입 구분 없이 동일하게 적용).",
    { projectId: z.string(), docTypeId: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/doc-types/${a.docTypeId}`, { method: "DELETE" }),
  );
  tool(
    "doctype_guideline_set",
    "문서 타입 지침 설정",
    "그 문서 타입이 무엇을 하기 위한 것인지 자연어 설명을 쓰거나 수정한다(빈 문자열이면 지움).",
    { projectId: z.string(), docTypeId: z.string(), guideline: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/doc-types/${a.docTypeId}/guideline`, { method: "PUT", body: JSON.stringify({ guideline: a.guideline }) }),
  );
}
