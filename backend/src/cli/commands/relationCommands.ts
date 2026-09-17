// 배치 2c(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 코드
// 관계도(Code Relation Graph). cli/index.ts에서 그대로 잘라낸 것 -
// 로직은 전혀 안 바뀜.
//
// Claude가 코드 탐색 중 스스로 발견한 "무엇이 어디서 왜 참조되는지"를
// 기록해두는 개인 인덱스 - 프로젝트 내 설계자(로그인 계정)별로
// 완전히 독립적이다(폴더와 동일 원칙). 상위/하위는 단일 부모 트리가
// 아니라 다대다 그래프(순환 허용) - 한 관계가 여러 부모/여러 자식을
// 동시에 가질 수 있다. --tags/--parents/--children류는 이 저장소의
// --refs 관례와 동일하게 쉼표로 구분한 문자열 하나로 받는다.
import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { z } from "zod";
import { apiCall, detectCurrentGitBranch } from "../apiclient.js";
import { printJson, registerListCommand, run, splitCsv, parseDataOption } from "../shared.js";
import { relationListSpec } from "../../shared/listOperation.specs.js";

// #apiclient-response-validation(BL-57F8DF17 #66) 시범 적용 대상 -
// relCmd list는 응답이 배열(필터만)/Page 객체(page·pageSize 지정)
// 둘 중 하나로 갈리는 대표적인 "드리프트에 취약한" 응답이라 골랐다.
const codeRelationDetailSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  userId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  target: z.string(),
  referrer: z.string(),
  purpose: z.string(),
  filePath: z.string(),
  line: z.number().nullable(),
  column: z.number().nullable(),
  data: z.unknown(),
  branchName: z.string().nullable(),
  trackingCodes: z.array(z.string()),
  tags: z.array(z.string()),
  parentIds: z.array(z.string()),
  childIds: z.array(z.string()),
});
const relationListResponseSchema = z.union([
  z.array(codeRelationDetailSchema),
  z.object({
    items: z.array(codeRelationDetailSchema),
    page: z.number(),
    pageSize: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
]);

export function registerRelationCommands(program: Command): void {
  const relCmd = program.command("relation").description("코드 관계도(관계 그래프) 관리");

  relCmd
    .command("add <projectId>")
    .requiredOption("--target <t>")
    .requiredOption("--referrer <r>")
    .requiredOption("--purpose <p>")
    .requiredOption("--file <path>")
    .option("--line <n>")
    .option("--column <n>")
    .option("--data <json>")
    .option("--refs <codes>", "쉼표로 구분된 연관 문서 trackingCode 목록(여러 개 가능)")
    .option("--tags <t1,t2>", "쉼표로 구분")
    .option("--parents <id1,id2>", "쉼표로 구분 - 상위 관계 id들")
    .option("--children <id1,id2>", "쉼표로 구분 - 하위 관계 id들")
    .option("--branch <name>", "생략하면 현재 디렉터리의 git 브랜치를 자동 감지")
    .action((projectId, opts) =>
      run(async () => {
        printJson(
          await apiCall(`/api/projects/${projectId}/relations`, {
            method: "POST",
            body: JSON.stringify({
              target: opts.target,
              referrer: opts.referrer,
              purpose: opts.purpose,
              filePath: opts.file,
              line: opts.line !== undefined ? Number(opts.line) : undefined,
              column: opts.column !== undefined ? Number(opts.column) : undefined,
              data: parseDataOption(opts.data),
              trackingCodes: splitCsv(opts.refs),
              tags: splitCsv(opts.tags),
              parentIds: splitCsv(opts.parents),
              childIds: splitCsv(opts.children),
              branchName: opts.branch ?? detectCurrentGitBranch() ?? undefined,
            }),
          }),
        );
      }),
    );

  relCmd
    .command("update <projectId> <id>")
    .option("--target <t>")
    .option("--referrer <r>")
    .option("--purpose <p>")
    .option("--file <path>")
    .option("--line <n>")
    .option("--column <n>")
    .option("--data <json>")
    .option("--refs <codes>", "쉼표로 구분된 연관 문서 trackingCode 목록 - 전체를 이 목록으로 교체")
    .option("--tags <t1,t2>", "쉼표로 구분 - 전체를 이 목록으로 교체")
    .option("--add-parents <id1,id2>", "쉼표로 구분")
    .option("--remove-parents <id1,id2>", "쉼표로 구분")
    .option("--add-children <id1,id2>", "쉼표로 구분")
    .option("--remove-children <id1,id2>", "쉼표로 구분")
    .option("--branch <name>", "명시해야만 갱신됨(생략하면 기존 값 유지 - 자동 감지 안 함)")
    .action((projectId, id, opts) =>
      run(async () => {
        printJson(
          await apiCall(`/api/projects/${projectId}/relations/${id}`, {
            method: "PUT",
            body: JSON.stringify({
              target: opts.target,
              referrer: opts.referrer,
              purpose: opts.purpose,
              filePath: opts.file,
              line: opts.line !== undefined ? Number(opts.line) : undefined,
              column: opts.column !== undefined ? Number(opts.column) : undefined,
              data: parseDataOption(opts.data),
              trackingCodes: splitCsv(opts.refs),
              tags: splitCsv(opts.tags),
              addParentIds: splitCsv(opts.addParents),
              removeParentIds: splitCsv(opts.removeParents),
              addChildIds: splitCsv(opts.addChildren),
              removeChildIds: splitCsv(opts.removeChildren),
              branchName: opts.branch,
            }),
          }),
        );
      }),
    );

  relCmd
    .command("remove <projectId> <id>")
    .action((projectId, id) =>
      run(async () => printJson(await apiCall(`/api/projects/${projectId}/relations/${id}`, { method: "DELETE" }))),
    );

  relCmd
    .command("get <projectId> <id>")
    .action((projectId, id) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/relations/${id}`))));

  registerListCommand(relCmd, relationListSpec, relationListResponseSchema);

  relCmd
    .command("parents <projectId> <id>")
    .action((projectId, id) =>
      run(async () => printJson(await apiCall(`/api/projects/${projectId}/relations/${id}/parents`))),
    );

  relCmd
    .command("children <projectId> <id>")
    .action((projectId, id) =>
      run(async () => printJson(await apiCall(`/api/projects/${projectId}/relations/${id}/children`))),
    );

  relCmd
    .command("ancestors <projectId> <id>")
    .option("--depth <n>", "기본 3")
    .option("--tag <tag>")
    .option("--q <query>")
    .action((projectId, id, opts) =>
      run(async () => {
        const qs = new URLSearchParams();
        if (opts.depth !== undefined) qs.set("depth", opts.depth);
        if (opts.tag) qs.set("tag", opts.tag);
        if (opts.q) qs.set("q", opts.q);
        printJson(await apiCall(`/api/projects/${projectId}/relations/${id}/ancestors?${qs}`));
      }),
    );

  relCmd
    .command("descendants <projectId> <id>")
    .option("--depth <n>", "기본 3")
    .option("--tag <tag>")
    .option("--q <query>")
    .action((projectId, id, opts) =>
      run(async () => {
        const qs = new URLSearchParams();
        if (opts.depth !== undefined) qs.set("depth", opts.depth);
        if (opts.tag) qs.set("tag", opts.tag);
        if (opts.q) qs.set("q", opts.q);
        printJson(await apiCall(`/api/projects/${projectId}/relations/${id}/descendants?${qs}`));
      }),
    );

  // 항목이 target/referrer/purpose/file/line/column/data/tags/parentIds/
  // childIds를 가진 완전한 구조체라 단순 variadic 인자로는 못 받는다
  // (기존 bulk 명령들은 전부 문자열 배열 하나뿐이었음) - 로컬 JSON 파일
  // (항목 배열)을 읽어 그대로 보낸다. Claude가 Write 도구로 임시 파일을
  // 만든 뒤 이 명령을 호출하는 흐름을 전제.
  relCmd
    .command("add-bulk <projectId> <file>")
    .description("로컬 JSON 파일(항목 배열)로 여러 관계를 한 번에 추가한다")
    .action((projectId, file) =>
      run(async () => {
        const items = JSON.parse(fs.readFileSync(path.resolve(file), "utf-8"));
        printJson(await apiCall(`/api/projects/${projectId}/relations/bulk`, { method: "POST", body: JSON.stringify({ items }) }));
      }),
    );

  relCmd
    .command("update-bulk <projectId> <file>")
    .description("로컬 JSON 파일(id 포함 항목 배열)로 여러 관계를 한 번에 갱신한다")
    .action((projectId, file) =>
      run(async () => {
        const items = JSON.parse(fs.readFileSync(path.resolve(file), "utf-8"));
        printJson(await apiCall(`/api/projects/${projectId}/relations/bulk`, { method: "PUT", body: JSON.stringify({ items }) }));
      }),
    );

  relCmd
    .command("remove-bulk <projectId> <ids...>")
    .description("여러 관계를 id로 한 번에 삭제한다")
    .action((projectId, ids) =>
      run(async () =>
        printJson(await apiCall(`/api/projects/${projectId}/relations/bulk`, { method: "DELETE", body: JSON.stringify({ ids }) })),
      ),
    );

  relCmd
    .command("reset <projectId>")
    .description("이 설계자의 관계도를 브랜치 기준으로 일괄 삭제한다(관계도 초기화)")
    .option("--branch <name>", "이 브랜치만 삭제(생략하면 '브랜치 없음' 버킷)")
    .option("--all-branches", "브랜치 구분 없이 전체 삭제")
    .action((projectId, opts) =>
      run(async () => {
        const qs = new URLSearchParams();
        if (opts.allBranches) qs.set("allBranches", "true");
        else qs.set("branchName", opts.branch ?? "__none__");
        printJson(await apiCall(`/api/projects/${projectId}/relations/reset?${qs}`, { method: "DELETE" }));
      }),
    );
}
