import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./db.js";
import { paginate, type Page } from "./pagination.js";

// CLAUDE.md/SKILL.md 같은 템플릿 파일을 DocType과 같은 스코프 패턴
// (teamId?/projectGroupId?/projectId? 중 최대 하나)으로 저장한다.
// 셋 다 null이면 설치 전역 기본값 - resolveTemplate()이 project →
// group → team → 전역 기본값 순으로 override를 찾는다.

export interface TemplateFile {
  id: string;
  filename: string;
  content: string;
  teamId: string | null;
  projectGroupId: string | null;
  projectId: string | null;
  updatedAt: Date;
}

export interface TemplateScopeInput {
  teamId?: string;
  projectGroupId?: string;
  projectId?: string;
}

export interface TemplateRevisionSummary {
  id: string;
  content: string;
  editedBy: string;
  editedAt: string;
}

function assertAtMostOneScope(scope: TemplateScopeInput): void {
  const set = [scope.teamId, scope.projectGroupId, scope.projectId].filter(Boolean);
  if (set.length > 1) {
    throw new Error("teamId/projectGroupId/projectId 중 최대 하나만 지정해야 합니다");
  }
}

function toTemplateFile(row: {
  id: string;
  filename: string;
  content: string;
  teamId: string | null;
  projectGroupId: string | null;
  projectId: string | null;
  updatedAt: Date;
}): TemplateFile {
  return {
    id: row.id,
    filename: row.filename,
    content: row.content,
    teamId: row.teamId,
    projectGroupId: row.projectGroupId,
    projectId: row.projectId,
    updatedAt: row.updatedAt,
  };
}

/** project → group → team → 전역 기본값 순으로 override를
 * 탐색해서 실제 적용될 템플릿을 반환한다. projectId를 안 주면 전역
 * 기본값만 본다. */
export async function resolveTemplate(filename: string, projectId?: string): Promise<TemplateFile | null> {
  const db = getDb();

  if (projectId) {
    const projectRow = await db.templateFile.findFirst({ where: { projectId, filename } });
    if (projectRow) return toTemplateFile(projectRow);

    const project = await db.project.findUnique({ where: { id: projectId } });
    if (project) {
      const groupRow = await db.templateFile.findFirst({
        where: { projectGroupId: project.projectGroupId, filename },
      });
      if (groupRow) return toTemplateFile(groupRow);

      const group = await db.projectGroup.findUnique({ where: { id: project.projectGroupId } });
      if (group?.teamId) {
        const teamRow = await db.templateFile.findFirst({
          where: { teamId: group.teamId, filename },
        });
        if (teamRow) return toTemplateFile(teamRow);
      }
    }
  }

  const globalRow = await db.templateFile.findFirst({
    where: { teamId: null, projectGroupId: null, projectId: null, filename },
  });
  return globalRow ? toTemplateFile(globalRow) : null;
}

/** 주어진 스코프(또는 스코프 없음 = 전역 기본값)에 대한 override를
 * 설정한다. @@unique 제약은 null 스코프에서는 DB가 중복을 못 걸러내므로
 * (Postgres/MySQL/SQLite 전부 unique 인덱스에서 NULL은 서로 다른 값으로
 * 취급) findFirst로 먼저 조회해 update/create를 애플리케이션에서
 * 결정한다. 이미 override가 있던 스코프를 덮어쓰는 경우(existing이
 * 있을 때)만, 덮어쓰기 직전의 내용을 TemplateRevision으로 스냅샷한다
 * (saveDocumentBody()가 DocumentRevision을 남기는 것과 같은 패턴 -
 * #template-history) - 스코프에 override가 아예 처음 생기는
 * create 분기는 스냅샷할 이전 값이 없다. */
export async function setTemplateOverride(
  filename: string,
  scope: TemplateScopeInput,
  content: string,
  editedBy: string,
): Promise<TemplateFile> {
  assertAtMostOneScope(scope);
  const db = getDb();
  const where = {
    teamId: scope.teamId ?? null,
    projectGroupId: scope.projectGroupId ?? null,
    projectId: scope.projectId ?? null,
    filename,
  };
  const existing = await db.templateFile.findFirst({ where });
  let row;
  if (existing) {
    await db.templateRevision.create({
      data: { templateFileId: existing.id, content: existing.content, editedBy },
    });
    row = await db.templateFile.update({ where: { id: existing.id }, data: { content } });
  } else {
    row = await db.templateFile.create({ data: { ...where, content } });
  }
  return toTemplateFile(row);
}

/** setTemplateOverride()와 정확히 같은 스코프 하나를 찾아, 그 행의
 * 리비전만 시간순으로 반환한다 - resolveTemplate()처럼 상속 체인을
 * 타지 않는다(리비전은 특정 스코프의 override 행에 귀속되므로, 체인을
 * 타면 "어느 스코프의 과거 내용인지" 자체가 모호해진다). 그 스코프에
 * override가 아예 없으면 빈 배열(조회 대상이 없다는 뜻이지 에러가
 * 아니다). */
export async function listTemplateRevisions(
  filename: string,
  scope: TemplateScopeInput,
): Promise<TemplateRevisionSummary[]> {
  assertAtMostOneScope(scope);
  const db = getDb();
  const templateFile = await db.templateFile.findFirst({
    where: {
      teamId: scope.teamId ?? null,
      projectGroupId: scope.projectGroupId ?? null,
      projectId: scope.projectId ?? null,
      filename,
    },
  });
  if (!templateFile) return [];
  const revisions = await db.templateRevision.findMany({
    where: { templateFileId: templateFile.id },
    orderBy: { editedAt: "asc" },
  });
  return revisions.map((r: { id: string; content: string; editedBy: string; editedAt: Date }) => ({
    id: r.id,
    content: r.content,
    editedBy: r.editedBy,
    editedAt: r.editedAt.toISOString(),
  }));
}

export async function listTemplateRevisionsPaged(
  filename: string,
  scope: TemplateScopeInput,
  page: number,
  pageSize: number,
): Promise<Page<TemplateRevisionSummary>> {
  assertAtMostOneScope(scope);
  const db = getDb();
  const templateFile = await db.templateFile.findFirst({
    where: {
      teamId: scope.teamId ?? null,
      projectGroupId: scope.projectGroupId ?? null,
      projectId: scope.projectId ?? null,
      filename,
    },
  });
  if (!templateFile) return { items: [], page: Math.max(1, page), pageSize: Math.max(1, pageSize), total: 0, totalPages: 1 };
  const result = await paginate<{ id: string; content: string; editedBy: string; editedAt: Date }>(
    (args) => db.templateRevision.findMany({ where: { templateFileId: templateFile.id }, orderBy: { editedAt: "asc" }, ...args }),
    () => db.templateRevision.count({ where: { templateFileId: templateFile.id } }),
    page,
    pageSize,
  );
  return {
    ...result,
    items: result.items.map((r: { id: string; content: string; editedBy: string; editedAt: Date }) => ({
      id: r.id,
      content: r.content,
      editedBy: r.editedBy,
      editedAt: r.editedAt.toISOString(),
    })),
  };
}

const SEED_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "prisma", "seed-templates");

const SEED_FILES = ["CLAUDE.md", ".claude/skills/claude-native-workflow/SKILL.md"] as const;

// SEED_FILES의 두 번째 항목처럼 배포 경로에 디렉터리가 섞여 있어도,
// 실제로 읽어오는 원본 파일은 항상 prisma/seed-templates/ 밑의 평평한
// 파일명이다(SKILL.md) - 아래 매핑으로 연결한다.
const SEED_SOURCE_BY_FILENAME: Record<string, string> = {
  "CLAUDE.md": "CLAUDE.md",
  ".claude/skills/claude-native-workflow/SKILL.md": "SKILL.md",
};

/** 서버 기동 시 호출 - 전역 기본 템플릿이 없으면 저장소에 커밋된
 * prisma/seed-templates/*.md에서 읽어 심는다. 이미 있으면 아무 것도
 * 안 함(관리자가 이미 직접 고쳤을 수 있으므로 덮어쓰지 않음). */
export async function seedDefaultTemplates(): Promise<void> {
  const db = getDb();
  for (const filename of SEED_FILES) {
    const existing = await db.templateFile.findFirst({
      where: { teamId: null, projectGroupId: null, projectId: null, filename },
    });
    if (existing) continue;
    const sourceName = SEED_SOURCE_BY_FILENAME[filename];
    const content = fs.readFileSync(path.join(SEED_DIR, sourceName), "utf-8");
    await db.templateFile.create({ data: { filename, content } });
  }
}
