#!/usr/bin/env node
import { Command } from "commander";
import { setProjectRoot } from "../core/paths.js";
import { buildTree, listPending, listByTypes, getDoc } from "../core/docstore.js";
import { validateAll } from "../core/validate.js";
import { answerPending } from "../core/reply.js";
import { createDoc } from "../core/create.js";
import { transitionDone } from "../core/transition.js";
import { DESIGN_TYPES, TYPE_NAMES } from "../core/types.js";

// SP-00001 4절의 CLI. api/server.ts와 마찬가지로 core/를 직접 호출한다
// (SP-00001 1절: "MCP 서버, CLI, 로컬 API가 전부 같은 core/ 함수를 직접
// 호출한다"). git/comment 하위 명령은 core에 그 모듈이 아직 없어(PL-00001
// 2단계 5~6번) 이번엔 등록하지 않는다.

const program = new Command();
program
  .name("docs")
  .description("claude-native-workflow 문서 워크플로우 CLI (Tier 2)")
  .option("--root <path>", "프로젝트 루트(docs/의 부모 디렉터리)", process.cwd())
  .hook("preAction", (thisCommand) => {
    setProjectRoot(thisCommand.opts().root as string);
  });

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

program
  .command("tree")
  .description("문서 트리 조회")
  .action(() => printJson(buildTree()));

program
  .command("pending")
  .description("답변 대기 목록 조회")
  .action(() => printJson(listPending()));

program
  .command("list")
  .description("타입별 문서 목록 조회")
  .requiredOption("--type <types>", "쉼표로 구분된 타입 목록, 예: DC,RV,FX")
  .action((opts: { type: string }) => {
    const types = new Set(opts.type.split(",").map((t) => t.trim()).filter(Boolean));
    printJson(listByTypes(types));
  });

program
  .command("design")
  .description("DC/RV/FX 목록 조회")
  .action(() => printJson(listByTypes(DESIGN_TYPES)));

program
  .command("all")
  .description("전체 문서 목록 조회")
  .action(() => printJson(listByTypes(new Set(Object.keys(TYPE_NAMES).filter((t) => t !== "IX")))));

program
  .command("get <path>")
  .description("문서 1건 조회 (docs/ 기준 상대 경로)")
  .action((path: string) => {
    const doc = getDoc(path);
    if (!doc) {
      console.error(`찾을 수 없습니다: ${path}`);
      process.exitCode = 1;
      return;
    }
    printJson(doc);
  });

program
  .command("new <type>")
  .description("새 문서 생성")
  .requiredOption("--title <title>", "문서 제목")
  .option("--links <ids>", "쉼표로 구분된 links 목록, 예: DS-00001,PL-00001")
  .action((type: string, opts: { title: string; links?: string }) => {
    const links = opts.links ? opts.links.split(",").map((s) => s.trim()).filter(Boolean) : [];
    printJson(createDoc({ type, title: opts.title, links }));
  });

program
  .command("reply <path> <questionId> <answer...>")
  .description("답변 대기 질문에 답변 처리")
  .action((path: string, questionId: string, answerParts: string[]) => {
    printJson(answerPending(path, questionId, answerParts.join(" ")));
  });

program
  .command("transition-done <planId>")
  .description("PL -> DN 전환")
  .requiredOption("--report <text>", "완료 결과 보고 내용")
  .action((planId: string, opts: { report: string }) => {
    printJson(transitionDone(planId, opts.report));
  });

program
  .command("validate")
  .description("docs/ 구조 검증")
  .action(() => {
    const violations = validateAll();
    if (!violations.length) {
      console.log("모든 문서가 유효합니다.");
      return;
    }
    for (const v of violations) {
      console.log(`${v.path}: [${v.rule}] ${v.field} - ${v.message}`);
    }
    process.exitCode = 1;
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
