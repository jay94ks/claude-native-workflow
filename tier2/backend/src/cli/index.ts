#!/usr/bin/env node
import { Command } from "commander";
import { setProjectRoot } from "../core/paths.js";
import { buildTree, listPending, listByTypes, getDoc } from "../core/docstore.js";
import { validateAll } from "../core/validate.js";
import { answerPending } from "../core/reply.js";
import { createDoc } from "../core/create.js";
import { transitionDone } from "../core/transition.js";
import { DESIGN_TYPES, TYPE_NAMES } from "../core/types.js";
import { pull as gitPull, push as gitPush, commitDocsChange, sync as gitSync } from "../core/git.js";
import { gitLog, gitCommitDetail, gitDiff, gitBlame } from "../core/gitlog.js";
import { listComments, addComment, resolveComment } from "../core/comments.js";

// SP-00001 4절의 CLI. api/server.ts와 마찬가지로 core/를 직접 호출한다
// (SP-00001 1절: "MCP 서버, CLI, 로컬 API가 전부 같은 core/ 함수를 직접
// 호출한다").

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
  .action(async (type: string, opts: { title: string; links?: string }) => {
    const links = opts.links ? opts.links.split(",").map((s) => s.trim()).filter(Boolean) : [];
    printJson(await createDoc({ type, title: opts.title, links }));
  });

program
  .command("reply <path> <questionId> <answer...>")
  .description("답변 대기 질문에 답변 처리")
  .action(async (path: string, questionId: string, answerParts: string[]) => {
    printJson(await answerPending(path, questionId, answerParts.join(" ")));
  });

program
  .command("transition-done <planId>")
  .description("PL -> DN 전환")
  .requiredOption("--report <text>", "완료 결과 보고 내용")
  .action(async (planId: string, opts: { report: string }) => {
    printJson(await transitionDone(planId, opts.report));
  });

const gitCmd = program.command("git").description("git 자동화(SP-00001 5절)");

gitCmd
  .command("pull")
  .description("git pull (충돌 시 자동 병합하지 않고 보고)")
  .action(async () => printJson(await gitPull()));

gitCmd
  .command("commit")
  .description("docs/ 변경분 커밋")
  .option("-m, --message <text>", "커밋 메시지", "docs: manual commit")
  .action(async (opts: { message: string }) => printJson(await commitDocsChange(opts.message)));

gitCmd
  .command("push")
  .description("git push (push_mode와 무관하게 항상 실행)")
  .action(async () => printJson(await gitPush()));

gitCmd
  .command("sync")
  .description("pull -> commit -> push를 한 번에")
  .option("-m, --message <text>", "커밋 메시지", "docs: sync")
  .action(async (opts: { message: string }) => printJson(await gitSync(opts.message)));

gitCmd
  .command("log")
  .description("docs/ 커밋 이력 조회")
  .option("--path <path>", "특정 문서로 한정")
  .option("--limit <n>", "최대 개수", "30")
  .action(async (opts: { path?: string; limit: string }) => {
    printJson(await gitLog(opts.path, Number(opts.limit)));
  });

gitCmd
  .command("diff <sha>")
  .description("커밋 diff 조회")
  .action(async (sha: string) => console.log(await gitDiff(sha)));

gitCmd
  .command("blame <path>")
  .description("문서 blame 조회")
  .action(async (path: string) => console.log(await gitBlame(path)));

gitCmd
  .command("show <sha>")
  .description("커밋 1건 상세 조회")
  .action(async (sha: string) => {
    const detail = await gitCommitDetail(sha);
    if (!detail) {
      console.error(`찾을 수 없습니다: ${sha}`);
      process.exitCode = 1;
      return;
    }
    printJson(detail);
  });

const commentCmd = program.command("comment").description("문서 코멘트(SP-00003 2절, 비공식 토론용)");

commentCmd
  .command("list <path>")
  .description("문서의 코멘트 목록 조회")
  .action((path: string) => printJson(listComments(path)));

commentCmd
  .command("add <path> <text...>")
  .description("코멘트 작성")
  .action((path: string, textParts: string[]) => printJson({ id: addComment(path, textParts.join(" ")) }));

commentCmd
  .command("resolve <path> <commentId>")
  .description("코멘트 해결 처리")
  .action((path: string, commentId: string) => {
    resolveComment(path, Number(commentId));
    printJson({ ok: true });
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
