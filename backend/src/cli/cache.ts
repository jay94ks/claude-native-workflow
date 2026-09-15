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
    .map((d) => `| [${d.trackingCode}](./${d.trackingCode}.md) | ${d.title} | ${d.statusCode} | ${new Date(d.updatedAt).toISOString()} |`)
    .join("\n");
  return `# 문서 목록 (자동 생성)

<!-- 이 파일은 자동 생성된 사본(캐시)입니다 - 손으로 편집하지 마세요, docs cache sync로 재생성됩니다.
     "최종 수정" 열은 다음 sync가 무엇을 다시 써야 할지 판단하는 데도 쓰인다(표시용 겸 상태 비교용). -->

| 추적 코드 | 제목 | 상태 | 최종 수정 |
|---|---|---|---|
${rows}
`;
}

// index.md의 "최종 수정" 열을 다시 읽어 trackingCode→updatedAt(ms) 맵을
// 복원한다 - 트래킹코드는 `[XX-XXXXXXXX]` 고정 형식으로, 시각은 줄 끝의
// ISO 8601(`...Z`) 고정 형식으로 각각 정규식이 정확히 잡아내므로, 그
// 사이에 있는 제목에 `|`가 섞여 있어도(이스케이프 안 해도) 안전하다.
// index.md가 없거나(첫 동기화) 파싱에 실패한 줄은 그냥 무시 - "모르면
// 다시 쓴다"는 안전한 기본값으로 자연히 떨어진다.
const INDEX_ROW_RE = /\[([A-Z]{2}-[0-9A-F]{8})\][\s\S]*\|\s*(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s*\|?\s*$/;

function readPreviousUpdatedAt(dir: string): Map<string, number> {
  const previous = new Map<string, number>();
  const indexPath = path.join(dir, INDEX_FILENAME);
  let content: string;
  try {
    content = fs.readFileSync(indexPath, "utf-8");
  } catch {
    return previous;
  }
  for (const line of content.split("\n")) {
    const m = line.match(INDEX_ROW_RE);
    if (m) previous.set(m[1], new Date(m[2]).getTime());
  }
  return previous;
}

export interface CacheSyncResult {
  dir: string;
  written: number;
  unchanged: number;
  removed: number;
}

/** 프로젝트의 전체 문서 목록(과 각자의 updatedAt)은 매번 새로 받지만,
 * 실제로 파일을 다시 쓰는 건 index.md에 기록해둔 지난 updatedAt과
 * 달라진(또는 파일이 아예 없어진) 문서만으로 좁힌다(설계자 지시 -
 * "목록과 변경시간을 index.md에 함께 기록해두고 대조하면서 변경된
 * 것만 새로 생성"). 안 바뀐 문서는 디스크에 손을 대지 않으므로,
 * 이 캐시를 git으로 커밋해 쓰는 프로젝트(minicore 등)에서 매번 전체
 * 파일이 diff에 잡히는 낭비가 없어진다. index.md 자체는 "최종 수정"
 * 값이 이번 판단의 근거이자 다음 sync의 비교 기준이라 매번 다시
 * 쓴다(전체 목록이 한눈에 최신인지도 보장). 삭제되거나 다른
 * 프로젝트로 옮겨진 문서의 캐시 파일 정리는 기존과 동일. */
export async function syncDocumentCache(projectId: string, dir: string): Promise<CacheSyncResult> {
  const { items } = await apiCall<{ items: ExportedDocument[] }>(`/api/projects/${projectId}/documents/export`);

  fs.mkdirSync(dir, { recursive: true });

  const previous = readPreviousUpdatedAt(dir);
  const currentCodes = new Set(items.map((d) => d.trackingCode));

  let written = 0;
  let unchanged = 0;
  for (const doc of items) {
    const filePath = path.join(dir, `${doc.trackingCode}.md`);
    if (previous.get(doc.trackingCode) === doc.updatedAt && fs.existsSync(filePath)) {
      unchanged++;
      continue;
    }
    fs.writeFileSync(filePath, renderDocFile(doc, projectId, dir), "utf-8");
    written++;
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

  return { dir, written, unchanged, removed };
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
