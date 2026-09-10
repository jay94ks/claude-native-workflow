import crypto from "node:crypto";

// 추적 코드 형식: "영문 2글자 + HEX 코드 8글자" (예: DC-A1B2C3D4). 옛
// concept 브랜치의 .tracking.json 순번 카운터를 대체한다 - 순번 증가가
// 원자적이지 않아서 겪었던 문제(답변 처리 중 카운터가 잘못 올라가
// 되돌려야 했던 사례)가 애초에 생길 수 없는 설계. 8자리 hex(2^32,
// 약 43억 가지) 무작위 생성이라 충돌 확률이 극히 낮고, 그래도 충돌하면
// DB의 unique 제약이 막아주니 재시도만 하면 된다.
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

/** 트래킹 코드를 생성해 tryCreate를 실행하고, unique 제약 충돌(P2002)이면
 * 새 코드로 재시도한다. 8자리 hex 충돌 확률을 감안하면 maxAttempts는
 * 여유 있게 잡아도 실사용에서 소진될 일이 거의 없다. */
export async function withTrackingCode<T>(
  typeCode: string,
  tryCreate: (trackingCode: string) => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    const code = generateTrackingCode(typeCode);
    try {
      return await tryCreate(code);
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err;
      lastErr = err;
    }
  }
  throw new Error(
    `트래킹 코드 생성이 ${maxAttempts}번 연속 충돌했습니다(원인: ${String(lastErr)})`,
  );
}
