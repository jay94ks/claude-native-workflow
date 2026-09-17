// 배치 2g(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 문서
// 타입 체계. cli/index.ts에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜.
// doctypes는 BL-57F8DF17 #64(PN-01007911)의 "연산 서술자" 패턴 시범
// 적용 대상(단순 페이지네이션 전용 목록, 필터 없음) - docTypeListSpec
// 은 mcp/tools/docTypeTools.ts와 공유(../shared/listOperation.js).
import type { Command } from "commander";
import { apiCall } from "../apiclient.js";
import { printJson, registerListCommand, run } from "../shared.js";
import { docTypeListSpec } from "../../shared/listOperation.specs.js";

export function registerDocTypeCommands(program: Command): void {
  program
    .command("doctype-create <projectId> <code> <label>")
    .option("--guideline <text>", "이 타입은 무엇을 하기 위한 것인지(선택)")
    .action((projectId, code, label, opts) =>
      run(async () =>
        printJson(
          await apiCall(`/api/projects/${projectId}/doc-types`, {
            method: "POST",
            body: JSON.stringify({ code, label, guideline: opts.guideline }),
          }),
        ),
      ),
    );

  registerListCommand(program, docTypeListSpec);

  program
    .command("doctype-update <projectId> <docTypeId>")
    .option("--code <c>", "타입 코드(영문 2글자) - 기본 시드 타입은 거부됨")
    .option("--label <l>")
    .action((projectId, docTypeId, opts) =>
      run(async () =>
        printJson(
          await apiCall(`/api/projects/${projectId}/doc-types/${docTypeId}`, {
            method: "PUT",
            body: JSON.stringify({ code: opts.code, label: opts.label }),
          }),
        ),
      ),
    );

  program
    .command("doctype-delete <projectId> <docTypeId>")
    .description("문서 타입 삭제 - 이 타입으로 만든 문서가 하나라도 남아있으면 거부됨")
    .action((projectId, docTypeId) =>
      run(async () => printJson(await apiCall(`/api/projects/${projectId}/doc-types/${docTypeId}`, { method: "DELETE" }))),
    );

  program
    .command("doctype-guideline-set <projectId> <docTypeId> <guideline...>")
    .action((projectId, docTypeId, guidelineParts) =>
      run(async () =>
        printJson(
          await apiCall(`/api/projects/${projectId}/doc-types/${docTypeId}/guideline`, {
            method: "PUT",
            body: JSON.stringify({ guideline: guidelineParts.join(" ") }),
          }),
        ),
      ),
    );
}
