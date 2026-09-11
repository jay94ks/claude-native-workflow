// 로그인 무차별 대입 방어 - 전용 DB 테이블 없이 순수 메모리 Map으로
// 추적한다(core/gitRepos.ts의 syncStateByProject와 같은 원칙: 재시작 시
// 사라져도 되는 일시적 카운터라 DB에 영속화할 이유가 없다).
// 식별자(아이디/이메일)별과 IP별을 따로 추적한다 - 하나로 합치면
// "한 IP가 여러 계정에 spray"하는 공격을 못 잡는다.

const IDENTIFIER_MAX_ATTEMPTS = 5;
const IDENTIFIER_WINDOW_MS = 15 * 60 * 1000; // 15분

const IP_MAX_ATTEMPTS = 20; // 여러 정상 사용자가 같은 IP(사무실/NAT)를 공유할 수 있어 더 느슨하게
const IP_WINDOW_MS = 15 * 60 * 1000;

const LOCKOUT_MS = 15 * 60 * 1000; // 창 길이와 동일하게 둬서 상태 하나당 타임스탬프 한 쌍이면 충분

const SWEEP_INTERVAL_MS = 10 * 60 * 1000; // 10분마다 만료된 항목 정리(메모리 상한)

interface AttemptState {
  failCount: number;
  firstFailAt: number;
  lockedUntil: number | null;
}

const attemptsByIdentifier = new Map<string, AttemptState>();
const attemptsByIp = new Map<string, AttemptState>();

export class LoginRateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super(`로그인 시도가 너무 많습니다. ${retryAfterSeconds}초 후 다시 시도하세요`);
    this.name = "LoginRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function normalizeIdentifier(usernameOrEmail: string): string {
  return usernameOrEmail.trim().toLowerCase();
}

function remainingLockSeconds(state: AttemptState | undefined, now: number): number {
  if (!state?.lockedUntil || state.lockedUntil <= now) return 0;
  return Math.ceil((state.lockedUntil - now) / 1000);
}

/** 실패 기록 전, 두 맵 다 잠겨있지 않은지 확인한다. 하나라도 잠겨 있으면
 * 남은 시간이 더 긴 쪽으로 던진다(둘 다 풀려야 재시도 가능). */
export function assertNotLocked(usernameOrEmail: string, ip: string): void {
  const now = Date.now();
  const identifierRemaining = remainingLockSeconds(attemptsByIdentifier.get(normalizeIdentifier(usernameOrEmail)), now);
  const ipRemaining = remainingLockSeconds(attemptsByIp.get(ip), now);
  const remaining = Math.max(identifierRemaining, ipRemaining);
  if (remaining > 0) throw new LoginRateLimitError(remaining);
}

function recordFailure(map: Map<string, AttemptState>, key: string, windowMs: number, maxAttempts: number, now: number): void {
  let state = map.get(key);
  if (!state || now - state.firstFailAt > windowMs) {
    state = { failCount: 0, firstFailAt: now, lockedUntil: null };
  }
  state.failCount += 1;
  if (state.failCount >= maxAttempts) {
    state.lockedUntil = now + LOCKOUT_MS;
    console.warn(`[login-rate-limit] lockout triggered for key=${key} attempts=${state.failCount}`);
  }
  map.set(key, state);
}

/** 아이디/이메일을 못 찾았을 때, 또는 비밀번호가 틀렸을 때 둘 다
 * 여기서 호출한다 - 계정 존재 여부를 흘리지 않으려고 AuthError 메시지가
 * 이미 동일하듯, 실패 카운팅도 두 경우를 구분하지 않는다. */
export function recordFailedAttempt(usernameOrEmail: string, ip: string): void {
  const now = Date.now();
  recordFailure(attemptsByIdentifier, normalizeIdentifier(usernameOrEmail), IDENTIFIER_WINDOW_MS, IDENTIFIER_MAX_ATTEMPTS, now);
  recordFailure(attemptsByIp, ip, IP_WINDOW_MS, IP_MAX_ATTEMPTS, now);
}

/** 로그인 성공 시 그 식별자의 실패 카운트만 지운다. IP 쪽은 그대로 둔다 -
 * 같은 IP에서 다른 계정들이 spray당하고 있을 수 있어, 한 계정 로그인
 * 성공이 그 IP 전체를 면죄해주진 않는다. */
export function clearIdentifierAttempts(usernameOrEmail: string): void {
  attemptsByIdentifier.delete(normalizeIdentifier(usernameOrEmail));
}

function sweep(map: Map<string, AttemptState>, windowMs: number, now: number): void {
  for (const [key, state] of map) {
    const stillLocked = state.lockedUntil !== null && state.lockedUntil > now;
    const withinWindow = now - state.firstFailAt <= windowMs;
    if (!stillLocked && !withinWindow) map.delete(key);
  }
}

// 조회 시점에 만료를 lazy하게 재계산하는 것만으로 정확성은 충분하지만,
// 공격자가 서로 다른 식별자/IP를 계속 바꿔가며 시도하면 항목이 무한정
// 쌓일 수 있어 주기적으로 쓸어낸다. unref()로 프로세스 종료를 막지 않음.
const sweepTimer = setInterval(() => {
  const now = Date.now();
  sweep(attemptsByIdentifier, IDENTIFIER_WINDOW_MS, now);
  sweep(attemptsByIp, IP_WINDOW_MS, now);
}, SWEEP_INTERVAL_MS);
sweepTimer.unref();
