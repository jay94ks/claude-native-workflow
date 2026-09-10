import { getDb } from "./db.js";
import { getInstallConfig } from "./institutions.js";

export interface ProjectGroup {
  id: string;
  institutionId: string | null;
  name: string;
}

export async function createProjectGroup(name: string, institutionId?: string): Promise<ProjectGroup> {
  const db = getDb();
  // 빈 문자열은 "안 넘김"과 같은 뜻으로 취급한다 - 그렇지 않으면 아래
  // truthy 체크(`if (institutionId)`)를 다 통과해버려서 검증 없이
  // Prisma에 빈 문자열이 그대로 들어가 원본 FK 제약 에러가 새어나간다
  // (실측 중 발견 - 빈 문자열 institutionId를 넘겼을 때 "찾을 수
  // 없습니다" 같은 명확한 에러가 아니라 Prisma 내부 에러 메시지가
  // 그대로 노출됐다).
  institutionId = institutionId || undefined;
  const { institutionsEnabled } = await getInstallConfig();
  if (institutionId && !institutionsEnabled) {
    throw new Error("기관 단위 사용이 꺼져 있어 institutionId를 지정할 수 없습니다");
  }
  if (institutionId) {
    const inst = await db.institution.findUnique({ where: { id: institutionId } });
    if (!inst) throw new Error(`institution을 찾을 수 없습니다: ${institutionId}`);
  }
  const row = await db.projectGroup.create({ data: { name, institutionId: institutionId ?? null } });
  return { id: row.id, institutionId: row.institutionId, name: row.name };
}

export async function listProjectGroups(institutionId?: string): Promise<ProjectGroup[]> {
  const db = getDb();
  const rows = await db.projectGroup.findMany({
    where: institutionId ? { institutionId } : undefined,
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r: { id: string; institutionId: string | null; name: string }) => ({
    id: r.id,
    institutionId: r.institutionId,
    name: r.name,
  }));
}
