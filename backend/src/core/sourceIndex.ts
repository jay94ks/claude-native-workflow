import * as gitea from "./gitea.js";
import { requireGiteaWorkingSlug } from "./gitRepos.js";
import {
  indexSourceFileUpsert,
  indexSourceFilesBulkUpsert,
  indexSourceFileDelete,
  indexSourceFilesBulkDelete,
  clearSourceFileIndexForProject,
  sourceFileId,
  type SearchableSourceFile,
} from "./search.js";
import type { ParsedPush } from "./pushHooks.js";

// 소스 코드 "포함" 검색(사이드바 다중 스코프 검색, 웹 전용)이 조회하는
// Meilisearch sourceFiles 인덱스를 채우는 곳 - 문서의 write-through와
// 같은 정신을 소스 코드까지 확장한다. 어떤 파일을 색인할지는 블랙리스트
// 대신 화이트리스트로 정한다 - 바이너리 파일을 실수로 UTF-8로 디코드해
// 인덱스에 쓰레기 데이터를 넣는 것보다, 새 텍스트 확장자 하나를 당장
// 못 찾는 쪽이 안전한 실패다.

const INDEXABLE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "vue",
  "json", "md", "mdx", "yml", "yaml", "toml", "ini", "cfg", "conf", "env",
  "html", "htm", "css", "scss", "sass", "less",
  "py", "go", "rs", "java", "kt", "swift",
  "c", "h", "cpp", "hpp", "cs", "rb", "php",
  "sh", "bash", "ps1", "sql", "xml", "txt",
]);

// 확장자가 없는 파일 중 흔히 텍스트인 것들(대소문자 무관).
const INDEXABLE_EXTENSIONLESS = new Set(["dockerfile", "makefile", "license", "readme", "gitignore", "gitattributes"]);

// 크고 검색 신호가 낮은 락파일 - 화이트리스트를 통과해도 명시 제외.
const EXCLUDED_FILENAMES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "cargo.lock", "go.sum"]);

const MAX_INDEXABLE_BYTES = 300 * 1024;

function baseName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

/** sizeBytes를 안 넘기면(웹훅 증분 동기화 - 목록 API에 크기가 없음)
 * 확장자/파일명만으로 판단하고, 실제 내용을 받은 뒤 길이로 한 번 더
 * 거른다(호출부 책임). */
export function isIndexableFile(path: string, sizeBytes?: number): boolean {
  if (sizeBytes !== undefined && sizeBytes > MAX_INDEXABLE_BYTES) return false;
  const name = baseName(path).toLowerCase();
  if (EXCLUDED_FILENAMES.has(name)) return false;
  const dotIdx = name.lastIndexOf(".");
  if (dotIdx < 0) return INDEXABLE_EXTENSIONLESS.has(name);
  const ext = name.slice(dotIdx + 1);
  return INDEXABLE_EXTENSIONS.has(ext);
}

/** 저장소를 처음 연결했을 때 전체 파일을 훑어 색인한다 - 링크 라우트가
 * 응답을 기다리지 않고 호출(`void backfillProjectSourceIndex(...)`)하는
 * 백그라운드 1회성 작업. 실패해도 로그만 남기고 조용히 끝난다(gitRepos.ts의
 * computeSyncStatusInBackground()와 같은 fail-soft 패턴 - 저장소 연결
 * 자체를 막을 이유가 없음). */
export async function backfillProjectSourceIndex(projectId: string): Promise<void> {
  try {
    const slug = await requireGiteaWorkingSlug(projectId);
    await clearSourceFileIndexForProject(projectId);
    const tree = await gitea.getFullTree(slug);
    const candidates = tree.filter((e) => isIndexableFile(e.path, e.size));

    const docs: SearchableSourceFile[] = [];
    const now = Date.now();
    for (const entry of candidates) {
      try {
        const file = await gitea.getFileContent(slug, entry.path);
        if (Buffer.byteLength(file.content, "utf-8") > MAX_INDEXABLE_BYTES) continue;
        docs.push({ id: sourceFileId(projectId, entry.path), projectId, path: entry.path, content: file.content, updatedAt: now });
      } catch (err) {
        console.error(`소스 파일 백필 실패 - ${projectId}:${entry.path}:`, err);
      }
    }
    await indexSourceFilesBulkUpsert(docs);
  } catch (err) {
    console.error(`소스 코드 색인 백필 실패 (project ${projectId}):`, err);
  }
}

/** 소스 에디터에서 파일을 저장한 직후 - 문서 저장과 같은 "저장 직후
 * 검색에 바로 보인다" 보장을 위해 기다린다(호출부가 await). */
export async function syncSourceFileOnSave(projectId: string, path: string, content: string): Promise<void> {
  if (!isIndexableFile(path, Buffer.byteLength(content, "utf-8"))) {
    // 화이트리스트 밖으로 바뀌었을 수도 있으니(예: 내용이 커져서) 기존
    // 색인이 있었다면 정리한다 - 실패해도 무시(애초에 없었을 수 있음).
    await indexSourceFileDelete(projectId, path).catch(() => {});
    return;
  }
  await indexSourceFileUpsert({ id: sourceFileId(projectId, path), projectId, path, content, updatedAt: Date.now() });
}

/** push 웹훅으로 들어온 커밋들의 added/modified/removed를 순서대로
 * 접어(같은 경로가 여러 번 나오면 마지막 상태만 적용) 최종 upsert/delete
 * 집합을 구한 뒤 반영한다. 이 시스템에서 브라우징 가능한 git 콘텐츠는
 * 항상 Gitea가 호스팅하는 저장소(자체 호스팅 또는 외부 연동의 "작업
 * 저장소")뿐이라 - 웹훅은 항상 Gitea 발신이고, 이 함수는 그 전제로
 * 동작한다(미러 저장소는 읽기 전용 사본이라 검색 대상이 아님). */
export async function syncSourceFilesForPush(projectId: string, parsed: ParsedPush): Promise<void> {
  try {
    const finalState = new Map<string, "upsert" | "delete">();
    for (const commit of parsed.commits) {
      for (const path of commit.added) finalState.set(path, "upsert");
      for (const path of commit.modified) finalState.set(path, "upsert");
      for (const path of commit.removed) finalState.set(path, "delete");
    }
    if (finalState.size === 0) return;

    const slug = await requireGiteaWorkingSlug(projectId);
    const toDelete: string[] = [];
    const toUpsert: SearchableSourceFile[] = [];
    const now = Date.now();

    for (const [path, action] of finalState) {
      if (action === "delete") {
        toDelete.push(path);
        continue;
      }
      if (!isIndexableFile(path)) continue;
      try {
        const file = await gitea.getFileContent(slug, path);
        if (Buffer.byteLength(file.content, "utf-8") > MAX_INDEXABLE_BYTES) continue;
        toUpsert.push({ id: sourceFileId(projectId, path), projectId, path, content: file.content, updatedAt: now });
      } catch (err) {
        console.error(`소스 파일 증분 동기화 실패 - ${projectId}:${path}:`, err);
      }
    }

    await indexSourceFilesBulkDelete(projectId, toDelete);
    await indexSourceFilesBulkUpsert(toUpsert);
  } catch (err) {
    console.error(`소스 코드 색인 증분 동기화 실패 (project ${projectId}):`, err);
  }
}
