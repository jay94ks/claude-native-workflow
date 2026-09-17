// 배치 2n(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 가이디드
// 마이그레이션(Phase 6) + 문서 캐시(#document-cache-export). mcp/server.ts
// 에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜. 둘 다 작고 서로 인접한
// Phase 6 유틸리티 도메인이라 한 파일에 같이 둔다(CLI 쪽도 동일하게
// migrateCommands.ts로 같이 묶었다).
import { z } from "zod";
import { applyManifest, scanDirectory } from "../../cli/migrate.js";
import { cleanDocumentCache, syncDocumentCache } from "../../cli/cache.js";
import type { ToolRegistrar } from "../shared.js";

export function registerMigrateTools(tool: ToolRegistrar): void {
  tool(
    "migrate_scan",
    "마이그레이션 후보 스캔",
    "concept 스타일 파일 기반 프로젝트(YAML frontmatter+마크다운)를 로컬 sourceDir에서 스캔해 후보 목록을 반환한다 - 흔한 옛 상태 어휘(active/wip 등)를 표준 코드로 자동 제안한다(applyStatusPreset:false로 끌 수 있음, 바뀐 항목은 originalStatusCode에 원본이 남음). 순수 로컬 동작, 이 결과를 검토·수정한 뒤 로컬 매니페스트 파일로 저장해 migrate_apply에 넘긴다.",
    { sourceDir: z.string(), applyStatusPreset: z.boolean().optional() },
    async (a) => scanDirectory(String(a.sourceDir), { applyStatusPreset: a.applyStatusPreset as boolean | undefined }),
  );
  tool(
    "migrate_apply",
    "마이그레이션 반영",
    "검토·수정을 마친 로컬 매니페스트 파일(manifestFile)을 읽어 문서/링크를 실제로 생성한다.",
    { projectId: z.string(), manifestFile: z.string() },
    async (a) => applyManifest(String(a.projectId), String(a.manifestFile)),
  );
  tool(
    "cache_sync",
    "문서 캐시 동기화",
    "이 프로젝트의 전체 문서를 로컬 dir(기본 docs)에 trackingCode.md 파일 + index.md(전체 목록 표)로 내려쓰고, 삭제된 문서의 캐시 파일은 정리한다. 정본은 항상 CNW DB고 이 캐시는 읽기 전용 사본(GitHub 등에서 로그인 없이 문서를 읽거나 로컬 grep/오프라인 참고용) - 매번 전체를 다시 받아 덮어쓴다.",
    { projectId: z.string(), dir: z.string().optional() },
    async (a) => syncDocumentCache(String(a.projectId), String(a.dir ?? "docs")),
  );
  tool(
    "cache_clean",
    "문서 캐시 정리",
    "로컬 dir(기본 docs) 안에서 cache_sync가 만든 것으로 알아볼 수 있는 캐시 파일(trackingCode.md 패턴 + index.md)만 지운다 - 디렉터리 자체나 무관한 파일은 건드리지 않는다.",
    { dir: z.string().optional() },
    async (a) => cleanDocumentCache(String(a.dir ?? "docs")),
  );
}
