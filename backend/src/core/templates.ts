import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./db.js";

// CLAUDE.md/SKILL.md 같은 템플릿 파일을 DocType과 같은 스코프 패턴
// (institutionId?/projectGroupId?/projectId? 중 최대 하나)으로 저장한다.
// 셋 다 null이면 설치 전역 기본값 - resolveTemplate()이 project →
// group → institution → 전역 기본값 순으로 override를 찾는다.

export interface TemplateFile {
  id: string;
  filename: string;
  content: string;
  institutionId: string | null;
  projectGroupId: string | null;
  projectId: string | null;
  updatedAt: Date;
}

export interface TemplateScopeInput {
  institutionId?: string;
  projectGroupId?: string;
  projectId?: string;
}

function assertAtMostOneScope(scope: TemplateScopeInput): void {
  const set = [scope.institutionId, scope.projectGroupId, scope.projectId].filter(Boolean);
  if (set.length > 1) {
    throw new Error("institutionId/projectGroupId/projectId 중 최대 하나만 지정해야 합니다");
  }
}

function toTemplateFile(row: {
  id: string;
  filename: string;
  content: string;
  institutionId: string | null;
  projectGroupId: string | null;
  projectId: string | null;
  updatedAt: Date;
}): TemplateFile {
  return {
    id: row.id,
    filename: row.filename,
    content: row.content,
    institutionId: row.institutionId,
    projectGroupId: row.projectGroupId,
    projectId: row.projectId,
    updatedAt: row.updatedAt,
  };
}

/** project → group → institution → 전역 기본값 순으로 override를
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
      if (group?.institutionId) {
        const institutionRow = await db.templateFile.findFirst({
          where: { institutionId: group.institutionId, filename },
        });
        if (institutionRow) return toTemplateFile(institutionRow);
      }
    }
  }

  const globalRow = await db.templateFile.findFirst({
    where: { institutionId: null, projectGroupId: null, projectId: null, filename },
  });
  return globalRow ? toTemplateFile(globalRow) : null;
}

/** 주어진 스코프(또는 스코프 없음 = 전역 기본값)에 대한 override를
 * 설정한다. @@unique 제약은 null 스코프에서는 DB가 중복을 못 걸러내므로
 * (Postgres/MySQL/SQLite 전부 unique 인덱스에서 NULL은 서로 다른 값으로
 * 취급) findFirst로 먼저 조회해 update/create를 애플리케이션에서
 * 결정한다. */
export async function setTemplateOverride(
  filename: string,
  scope: TemplateScopeInput,
  content: string,
): Promise<TemplateFile> {
  assertAtMostOneScope(scope);
  const db = getDb();
  const where = {
    institutionId: scope.institutionId ?? null,
    projectGroupId: scope.projectGroupId ?? null,
    projectId: scope.projectId ?? null,
    filename,
  };
  const existing = await db.templateFile.findFirst({ where });
  const row = existing
    ? await db.templateFile.update({ where: { id: existing.id }, data: { content } })
    : await db.templateFile.create({ data: { ...where, content } });
  return toTemplateFile(row);
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
      where: { institutionId: null, projectGroupId: null, projectId: null, filename },
    });
    if (existing) continue;
    const sourceName = SEED_SOURCE_BY_FILENAME[filename];
    const content = fs.readFileSync(path.join(SEED_DIR, sourceName), "utf-8");
    await db.templateFile.create({ data: { filename, content } });
  }
}
