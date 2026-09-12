import fs from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import { apiCall } from "./apiclient.js";

// Windows PowerShell의 `>` 리다이렉트(README/SKILL.md가 안내하는
// `docs migrate scan ... > manifest.json` 그대로)와 `Out-File -Encoding
// utf8`은 기본적으로 UTF-8 BOM(U+FEFF)을 파일 맨 앞에 쓴다 - 이걸 안
// 벗기면 옛 문서 파일은 frontmatter 검사(`startsWith("---")`)가 조용히
// 실패해 스캔 후보에서 소리 없이 빠지고(가장 위험한 실패 모드 - 사용자가
// 놓친 줄도 모름), 매니페스트 JSON은 파싱 자체가 깨진다(실측으로 재현
// 확인). 파일을 읽는 두 지점(스캔 대상 .md, apply가 읽는 manifest.json)
// 전부 이 함수를 거친다.
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// 가이디드 마이그레이션(Phase 6) - concept 브랜치 스타일 파일 기반
// 프로젝트(YAML frontmatter + 마크다운 본문)를 이 DB 기반 시스템으로
// 옮긴다. scan은 로컬 파일 시스템만 읽는다(HTTP 호출 없음 - 옛 프로젝트의
// docs/ 디렉터리는 backend 서버가 아니라 CLI/MCP를 실행하는 이 머신에
// 있음). apply는 로컬 매니페스트+원본 파일을 읽어 이미 존재하는
// document/link 생성 API를 순서대로 호출하는 클라이언트 오케스트레이션 -
// 새 백엔드 라우트 없음. CLI(cli/index.ts)와 MCP(mcp/server.ts) 둘 다 이
// 모듈을 그대로 공유한다(MCP가 apiclient.ts를 공유하는 것과 같은 패턴).

export interface MigrateCandidate {
  sourcePath: string;
  oldId: string;
  oldType: string;
  title: string;
  docTypeCode: string;
  statusCode: string;
  /** statusCode가 STATUS_MAPPING_PRESET으로 실제 바뀐 경우에만 채워지는
   * 원본 값 - 매니페스트만 보고도 무엇이 무엇으로 제안됐는지 바로 알 수
   * 있게(안 바뀐 항목엔 안 실어 노이즈 방지). */
  originalStatusCode?: string;
  links: string[];
  skip: boolean;
}

/** concept 스타일 프로젝트에서 흔히 쓰이던 옛 상태 어휘 → 이 시스템의
 * 표준 6종 코드(core/docTypes.ts의 seedStandardStatusFlow가 심는
 * draft/review/pending/approved/deprecated/archived) 매핑 - 매번
 * 수작업으로 statusCode를 고치는 걸 줄이기 위한 "제안"일 뿐, 확정이
 * 아니다(#migrate-status-mapping-preset). 여기 없는 값은 지금까지처럼
 * 원본 그대로 남는다 - 잘못 추측하는 것보다 안전한 실패(그대로 두고
 * 사용자가 검토)가 낫다는 이 저장소의 일관된 원칙. */
const STATUS_MAPPING_PRESET: Record<string, string> = {
  active: "approved",
  final: "approved",
  done: "approved",
  approved: "approved",
  wip: "draft",
  "in-progress": "draft",
  in_progress: "draft",
  draft: "draft",
  review: "review",
  "in-review": "review",
  pending: "pending",
  obsolete: "deprecated",
  deprecated: "deprecated",
  retired: "archived",
  archive: "archived",
  archived: "archived",
};

interface OldFrontmatter {
  id?: string;
  type?: string;
  title?: string;
  status?: string;
  links?: string[];
}

function splitFrontmatter(content: string): { frontmatter: string; body: string } | null {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return null;
  const frontmatter = content.slice(3, end).trim();
  const body = content.slice(end + 4).replace(/^\r?\n/, "");
  return { frontmatter, body };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

export interface ScanOptions {
  /** 옛 상태 어휘 자동 제안 여부 - 기본 true. false면 프리셋을 아예
   * 건너뛰고 frontmatter의 status 값을 지금까지처럼 그대로 둔다. */
  applyStatusPreset?: boolean;
}

/** sourceDir를 재귀 탐색해 옛 frontmatter 스키마(id+type 필수)를 가진
 * 파일만 후보로 삼는다 - 그 외(README, index.md 등 frontmatter 없는
 * 목차 파일)는 에러 없이 조용히 건너뛴다. */
export function scanDirectory(sourceDir: string, opts: ScanOptions = {}): MigrateCandidate[] {
  const applyPreset = opts.applyStatusPreset ?? true;
  const candidates: MigrateCandidate[] = [];
  for (const file of walk(sourceDir)) {
    const content = stripBom(fs.readFileSync(file, "utf-8"));
    const split = splitFrontmatter(content);
    if (!split) continue;
    let fm: OldFrontmatter;
    try {
      fm = (loadYaml(split.frontmatter) as OldFrontmatter) ?? {};
    } catch {
      continue; // frontmatter가 있지만 YAML로 파싱 안 되면 후보에서 제외
    }
    if (!fm.id || !fm.type) continue;
    const rawStatus = fm.status ?? "";
    const mapped = applyPreset ? STATUS_MAPPING_PRESET[rawStatus.trim().toLowerCase()] : undefined;
    candidates.push({
      sourcePath: path.resolve(file),
      oldId: fm.id,
      oldType: fm.type,
      title: fm.title ?? fm.id,
      docTypeCode: fm.type,
      statusCode: mapped && mapped !== rawStatus ? mapped : rawStatus,
      ...(mapped && mapped !== rawStatus ? { originalStatusCode: rawStatus } : {}),
      links: Array.isArray(fm.links) ? fm.links : [],
      skip: false,
    });
  }
  return candidates;
}

export interface ApplyResult {
  created: { oldId: string; trackingCode: string }[];
  errors: { oldId: string; message: string }[];
  warnings: string[];
}

interface CreatedDocument {
  trackingCode: string;
  statusCode: string;
}

/** 매니페스트를 읽어 skip 안 된 항목을 순서대로 생성 → 상태 전이(가능하면)
 * → 이번 배치 안에서 해석되는 링크만 연결한다. 개별 항목 실패가 배치
 * 전체를 막지 않는다(리뷰를 거친 배치라도 항목별 실패는 생길 수 있음). */
export async function applyManifest(projectId: string, manifestPath: string): Promise<ApplyResult> {
  const manifest = JSON.parse(stripBom(fs.readFileSync(manifestPath, "utf-8"))) as MigrateCandidate[];
  const result: ApplyResult = { created: [], errors: [], warnings: [] };
  const oldIdToTrackingCode = new Map<string, string>();
  const linksByTrackingCode = new Map<string, string[]>();

  for (const item of manifest) {
    if (item.skip) continue;
    try {
      const sourceContent = stripBom(fs.readFileSync(item.sourcePath, "utf-8"));
      const split = splitFrontmatter(sourceContent);
      const body = split ? split.body : sourceContent;

      const doc = await apiCall<CreatedDocument>(`/api/projects/${projectId}/documents`, {
        method: "POST",
        body: JSON.stringify({ docTypeCode: item.docTypeCode, title: item.title, body }),
      });

      oldIdToTrackingCode.set(item.oldId, doc.trackingCode);
      linksByTrackingCode.set(doc.trackingCode, item.links);
      result.created.push({ oldId: item.oldId, trackingCode: doc.trackingCode });

      if (item.statusCode && item.statusCode !== doc.statusCode) {
        try {
          await apiCall(`/api/documents/${doc.trackingCode}/transition`, {
            method: "POST",
            body: JSON.stringify({ toStatusCode: item.statusCode }),
          });
        } catch (err) {
          result.warnings.push(
            `${item.oldId} → ${doc.trackingCode}: 상태를 "${item.statusCode}"로 전이하지 못해 초기 상태로 남았습니다(${err instanceof Error ? err.message : String(err)}) - 필요하면 docs transition으로 직접 옮기세요.`,
          );
        }
      }
    } catch (err) {
      result.errors.push({ oldId: item.oldId, message: err instanceof Error ? err.message : String(err) });
    }
  }

  for (const [trackingCode, links] of linksByTrackingCode) {
    for (const oldTarget of links) {
      const targetTrackingCode = oldIdToTrackingCode.get(oldTarget);
      if (!targetTrackingCode) {
        result.warnings.push(`${trackingCode}: 링크 대상 "${oldTarget}"이 이번 배치에 없어(또는 skip돼) 건너뜀`);
        continue;
      }
      try {
        await apiCall(`/api/documents/${trackingCode}/links`, {
          method: "POST",
          body: JSON.stringify({ toTrackingCode: targetTrackingCode }),
        });
      } catch (err) {
        result.warnings.push(
          `${trackingCode} → ${targetTrackingCode}: 링크 생성 실패(${err instanceof Error ? err.message : String(err)})`,
        );
      }
    }
  }

  return result;
}
