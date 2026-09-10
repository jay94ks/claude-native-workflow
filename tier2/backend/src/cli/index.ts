#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import { setProjectRoot } from "../core/paths.js";
import { buildTree, listPending, listByTypes, getDoc, saveDocBody, searchDocs, rebuildReplyIndex } from "../core/docstore.js";
import { validateAll } from "../core/validate.js";
import { answerPending } from "../core/reply.js";
import { createDoc } from "../core/create.js";
import { transitionDone } from "../core/transition.js";
import { DESIGN_TYPES, TYPE_NAMES } from "../core/types.js";
import { pull as gitPull, push as gitPush, commitDocsChange, sync as gitSync } from "../core/git.js";
import { gitLog, gitCommitDetail, gitDiff, gitBlame } from "../core/gitlog.js";
import { listComments, addComment, resolveComment } from "../core/comments.js";
import { listChangeNotices, ackChangeNotice } from "../core/changes.js";
import { enableServiceDb, disableServiceDb } from "../core/dbmigrate.js";
import type { DbConfig } from "../core/config.js";

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
  .command("search <query>")
  .description("전문 검색")
  .action((query: string) => printJson(searchDocs(query)));

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
  .command("save <path> <file>")
  .description("문서 본문을 로컬 마크다운 파일 내용으로 갱신(git 자동 커밋 없음 - 필요하면 docs git commit/sync를 따로 실행)")
  .action((path: string, file: string) => {
    const body = fs.readFileSync(file, "utf-8");
    printJson(saveDocBody(path, body));
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
  .action(async (path: string) => printJson(await listComments(path)));

commentCmd
  .command("add <path> <text...>")
  .description("코멘트 작성")
  .action(async (path: string, textParts: string[]) => printJson({ id: await addComment(path, textParts.join(" ")) }));

commentCmd
  .command("resolve <path> <commentId>")
  .description("코멘트 해결 처리")
  .action(async (path: string, commentId: string) => {
    await resolveComment(path, Number(commentId));
    printJson({ ok: true });
  });

const changesCmd = program
  .command("changes")
  .description("미확인 변경 목록 조회(SP-00003 5절)")
  .action(() => printJson(listChangeNotices()));

changesCmd
  .command("ack <id>")
  .description("변경 항목을 확인 처리(큐에서 제거)")
  .action((id: string) => {
    ackChangeNotice(Number(id));
    printJson({ ok: true });
  });

const dbCmd = program.command("db").description("선택적 서비스 DB 전환(SP-00001 6절, 양방향 무손실)");

dbCmd
  .command("enable")
  .description("서비스 DB로 이관하며 켜기 - 검증 실패 시 설정 파일은 건드리지 않음")
  .requiredOption("--driver <driver>", "mysql|mariadb|postgres|sqlite")
  .requiredOption("--connection <json>", "접속 정보 JSON, 예: '{\"host\":\"...\",\"port\":3306,\"user\":\"...\",\"password\":\"...\",\"database\":\"...\"}' (sqlite는 '{\"file\":\"./service.db\"}')")
  .action(async (opts: { driver: string; connection: string }) => {
    const connection = JSON.parse(opts.connection) as Record<string, unknown>;
    printJson(await enableServiceDb(opts.driver as DbConfig["driver"], connection));
  });

dbCmd
  .command("disable")
  .description("로컬 SQLite로 되돌리며 끄기 - 검증 실패 시 설정 파일은 건드리지 않음")
  .option("--drop", "서비스 DB 쪽 데이터도 삭제(기본은 보존)", false)
  .action(async (opts: { drop: boolean }) => printJson(await disableServiceDb(opts.drop)));

program
  .command("rebuild-reply-index")
  .description("docs/reply/index.md를 본문 스캔 기준으로 재생성 - `docs save`/`docs new`를 거치지"
    + " 않고 docs/*.md를 직접 써서 '## 답변 대기' 섹션을 추가/수정했을 때 동기화하는 용도"
    + "(docs/PROTOCOL.md 4절)")
  .action(() => {
    rebuildReplyIndex();
    console.log("docs/reply/index.md 재생성 완료.");
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
