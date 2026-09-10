import crypto from "node:crypto";
import { getDb } from "./db.js";

// 추적 코드 형식: "영문 2글자 + HEX 코드 8글자" (예: DC-A1B2C3D4). 옛
// concept 브랜치의 .tracking.json 순번 카운터를 대체한다 - 순번 증가가
// 원자적이지 않아서 겪었던 문제(답변 처리 중 카운터가 잘못 올라가
// 되돌려야 했던 사례)가 애초에 생길 수 없는 설계.
export function generateTrackingCode(typeCode: string): string {
  const hex = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `${typeCode.toUpperCase()}-${hex}`;
}

const PRISMA_UNIQUE_CONSTRAINT_CODE = "P2002";

interface PrismaKnownError {
  code?: string;
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as PrismaKnownError).code === PRISMA_UNIQUE_CONSTRAINT_CODE
  );
}

async function teamIdForProject(projectId: string): Promise<string | null> {
  const db = getDb();
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { projectGroup: true },
  });
  if (!project) throw new Error(`프로젝트를 찾을 수 없습니다: ${projectId}`);
  return project.projectGroup.teamId ?? null;
}

/**
 * 추적 코드를 프로젝트 스코프의 중앙 `TrackingCode` 레지스트리에
 * 원자적으로 예약한다 - 엔티티 테이블별 `@unique`만으로는 서로 다른
 * 엔티티 타입 간(예: Document ↔ Question) 충돌을 못 막았던 문제를
 * 레지스트리 하나로 해소한다. 코드의 유일성은 전역이 아니라 **프로젝트
 * 단위**다(`@@unique([projectId, code])`) - 팀/프로젝트 경계를 넘는
 * 충돌 검사 자체가 없다(각 팀·프로젝트의 추적 코드는 서로 별도).
 *
 * 예약 성공 후 tryCreate로 실제 엔티티(Document/Question)를 만들고, 그
 * 엔티티의 id를 레지스트리의 location에 채운다. tryCreate가 실패하면
 * 예약된 레지스트리 행은 그냥 버려진다(재사용하지 않음 - 8자리 hex
 * 공간이 넓어 무해하고, tryCreate가 자기 트랜잭션 컨텍스트를 쓸 수도
 * 있어 여기서 강제로 감싸지 않는다).
 */
export async function withTrackingCode<T extends { id: string }>(
  projectId: string,
  typeCode: string,
  which: string,
  tryCreate: (trackingCode: string) => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  const db = getDb();
  const teamId = await teamIdForProject(projectId);
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    const code = generateTrackingCode(typeCode);
    try {
      await db.trackingCode.create({
        data: { code, projectId, teamId, which, location: "" },
      });
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err;
      lastErr = err;
      continue;
    }
    const entity = await tryCreate(code);
    await db.trackingCode.update({
      where: { projectId_code: { projectId, code } },
      data: { location: entity.id },
    });
    return entity;
  }
  throw new Error(
    `트래킹 코드 생성이 ${maxAttempts}번 연속 충돌했습니다(원인: ${String(lastErr)})`,
  );
}

export interface TrackingCodeLookup {
  code: string;
  projectId: string;
  teamId: string | null;
  which: string;
  location: string;
}

/** 프로젝트 스코프 안에서 추적 코드 하나를 조회 - 어떤 엔티티 타입이고
 * 그 엔티티의 내부 id가 무엇인지(location) 알려준다. 코드가 프로젝트
 * 경계를 넘지 않으므로 조회도 반드시 projectId와 함께 한다. */
export async function lookupTrackingCode(projectId: string, code: string): Promise<TrackingCodeLookup | null> {
  const db = getDb();
  const row = await db.trackingCode.findUnique({ where: { projectId_code: { projectId, code } } });
  if (!row) return null;
  return {
    code: row.code,
    projectId: row.projectId,
    teamId: row.teamId,
    which: row.which,
    location: row.location,
  };
}
