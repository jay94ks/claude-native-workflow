// 배치 2n(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 가이디드
// 마이그레이션(Phase 6) + 문서 캐시(#document-cache-export). cli/index.ts
// 에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜. 둘 다 작고 서로 인접한
// Phase 6 유틸리티 도메인이라 한 파일에 같이 둔다(MCP 쪽도 동일하게
// migrateTools.ts로 같이 묶는다).
import type { Command } from "commander";
import { applyManifest, scanDirectory } from "../migrate.js";
import { cleanDocumentCache, syncDocumentCache } from "../cache.js";
import { printJson, run } from "../shared.js";

export function registerMigrateCommands(program: Command): void {
  const migrateCmd = program.command("migrate").description("파일 기반(concept 스타일) 프로젝트를 DB로 옮기기");

  migrateCmd
    .command("scan <sourceDir>")
    .description("sourceDir를 스캔해 후보 목록을 JSON으로 출력(리다이렉트해 매니페스트로 씀) - 흔한 옛 상태 어휘(active/wip 등)를 표준 코드로 자동 제안한다")
    .option("--no-status-preset", "상태 어휘 자동 제안을 끄고 frontmatter 값을 그대로 둔다")
    .action((sourceDir, opts) => run(async () => printJson(scanDirectory(sourceDir, { applyStatusPreset: opts.statusPreset }))));

  migrateCmd
    .command("apply <projectId> <manifestFile>")
    .description("검토·수정한 매니페스트를 실제로 반영")
    .action((projectId, manifestFile) => run(async () => printJson(await applyManifest(projectId, manifestFile))));

  const cacheCmd = program.command("cache").description("작업 폴더에 문서를 파일로 내려받아두는 로컬 캐시(#document-cache-export)");

  cacheCmd
    .command("sync <projectId> [dir]")
    .description("이 프로젝트의 전체 문서를 dir(기본 docs)에 trackingCode.md 파일+index.md로 내려쓰고, 삭제된 문서의 캐시 파일은 정리한다 - 정본은 항상 DB, 이 캐시는 읽기 전용 사본")
    .action((projectId, dir) => run(async () => printJson(await syncDocumentCache(projectId, dir ?? "docs"))));

  cacheCmd
    .command("clean [dir]")
    .description("dir(기본 docs) 안에서 이 명령이 만든 것으로 알아볼 수 있는 캐시 파일만 지운다(디렉터리 자체나 무관한 파일은 안 건드림)")
    .action((dir) => run(async () => printJson(cleanDocumentCache(dir ?? "docs"))));
}
