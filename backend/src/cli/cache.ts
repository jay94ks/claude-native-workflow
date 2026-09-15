import fs from "node:fs";
import path from "node:path";
import { apiCall } from "./apiclient.js";

// 작업 폴더에 이 프로젝트의 문서를 파일로 내려받아두는 로컬 캐시
// (`#document-cache-export`, 설계자 지시 - "minicore의 docs 폴더
// 사용 사례를 참고"). minicore가 자체 스크립트(scripts/export-cnw-docs.mjs)
// 로 직접 구현해 쓰던 것과 완전히 같은 포맷(파일당 trackingCode.md,
// 손대지 말라는 경고 + 메타데이터를 HTML 주석으로, index.md에 표)을
// CNW 자신의 CLI/MCP 명령으로 승격한 것 - 정본은 항상 DB이고 이
// 캐시는 읽기 전용 사본(GitHub 등에서 로그인 없이 문서를 읽거나,
// 로컬 grep/오프라인 참고용). CLI(cli/index.ts)와 MCP(mcp/server.ts)
// 둘 다 이 모듈을 그대로 공유한다(migrate.ts와 같은 패턴).

interface ExportedDocument {
  trackingCode: string;
  title: string;
  statusCode: string;
  updatedAt: number;
  body: string;
}

const TRACKING_CODE_FILE_RE = /^([A-Z]{2}-[0-9A-F]{8})\.md$/;
const INDEX_FILENAME = "index.md";

function renderDocFile(doc: ExportedDocument, projectId: string, dir: string): string {
  return `# ${doc.title}

<!--
  이 파일은 자동 생성된 사본(캐시)입니다 - 손으로 편집하지 마세요.
  정본은 claude-native-workflow(CNW)의 DB에 있습니다.
  trackingCode: ${doc.trackingCode}
  status: ${doc.statusCode}
  updatedAt: ${new Date(doc.updatedAt).toISOString()}
  갱신: docs cache sync ${projectId} ${dir}
-->

${doc.body}
`;
}

function renderIndexFile(docs: ExportedDocument[]): string {
  const rows = docs
    .slice()
    .sort((a, b) => a.trackingCode.localeCompare(b.trackingCode))
    .map((d) => `| [${d.trackingCode}](./${d.trackingCode}.md) | ${d.title} | ${d.statusCode} |`)
    .join("\n");
  return `# 문서 목록 (자동 생성)

<!-- 이 파일은 자동 생성된 사본(캐시)입니다 - 손으로 편집하지 마세요, docs cache sync로 재생성됩니다. -->

| 추적 코드 | 제목 | 상태 |
|---|---|---|
${rows}
`;
}

export interface CacheSyncResult {
  dir: string;
  written: number;
  removed: number;
}

/** 프로젝트의 전체 문서를 dir에 trackingCode.md 파일로 내려쓰고,
 * index.md(전체 목록 표)를 다시 만든 뒤, dir에 있던 캐시 파일 중 이번에
 * 못 받은(삭제되었거나 다른 프로젝트의) trackingCode는 정리한다 -
 * "생성하고 삭제하는 등 동기화" 요구사항 그대로. 매번 전체를 다시
 * 받아 덮어쓰는 방식(증분 diff 없음)이라 별도 상태 파일이 필요 없다 -
 * 지금 dir 안의 파일 목록 자체가 "지난 번 동기화 결과"를 대신한다. */
export async function syncDocumentCache(projectId: string, dir: string): Promise<CacheSyncResult> {
  const { items } = await apiCall<{ items: ExportedDocument[] }>(`/api/projects/${projectId}/documents/export`);

  fs.mkdirSync(dir, { recursive: true });

  const currentCodes = new Set(items.map((d) => d.trackingCode));
  for (const doc of items) {
    fs.writeFileSync(path.join(dir, `${doc.trackingCode}.md`), renderDocFile(doc, projectId, dir), "utf-8");
  }
  fs.writeFileSync(path.join(dir, INDEX_FILENAME), renderIndexFile(items), "utf-8");

  let removed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(TRACKING_CODE_FILE_RE);
    if (!match) continue;
    if (!currentCodes.has(match[1])) {
      fs.unlinkSync(path.join(dir, entry.name));
      removed++;
    }
  }

  return { dir, written: items.length, removed };
}

export interface CacheCleanResult {
  dir: string;
  removed: number;
}

/** dir 안에서 syncDocumentCache가 만든 것으로 알아볼 수 있는 파일만
 * (trackingCode.md 패턴 + index.md) 지운다 - 디렉터리 자체를 통째로
 * rm -rf하지 않는다(사용자가 다른 용도로도 같이 쓰는 폴더를 실수로
 * 가리켰을 때 무관한 파일까지 날아가는 걸 막기 위한 보수적 선택). */
export function cleanDocumentCache(dir: string): CacheCleanResult {
  if (!fs.existsSync(dir)) return { dir, removed: 0 };
  let removed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name !== INDEX_FILENAME && !TRACKING_CODE_FILE_RE.test(entry.name)) continue;
    fs.unlinkSync(path.join(dir, entry.name));
    removed++;
  }
  return { dir, removed };
}
