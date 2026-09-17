/** `if (!field) { res.status(400).json({ error: "..." }); return; }` 형태로
 * server.ts 전체에 반복되던 필수 필드 검증 보일러플레이트를 한 줄로
 * 줄인다 - `assertTruthy(field, "...");`로 호출한다. TS assertion
 * function이라 이 호출이 정상 반환되면(=값이 있으면) 이후 코드에서
 * field가 자동으로 non-nullable로 좁혀진다(원래 `if (!field) return`
 * 가드가 주던 타입 좁히기 효과와 동일). 실패하면 `ValidationError`를
 * 던지고, server.ts 전역 에러 핸들러가 그걸 잡아 원래와 동일하게
 * 400 + 같은 메시지로 응답한다(로그는 안 남김 - 클라이언트 실수는
 * 버그가 아니므로 console.error 대상에서 제외).
 *
 * 원래 `!field` 검사와 동일하게 falsy(빈 문자열/0/false 포함)면
 * 실패로 본다 - `hidden`/`isPublic`처럼 false가 유효한 값인 필드는
 * 이 대신 assertDefined를 쓴다. */
export class ValidationError extends Error {}

export function assertTruthy<T>(value: T, message: string): asserts value is NonNullable<T> {
  if (!value) throw new ValidationError(message);
}

/** `if (field === undefined) { ...; return; }` 형태 - false/0처럼
 * falsy지만 유효한 값을 허용해야 하는 필드(hidden, isPublic, priority
 * 등)에 쓴다. */
export function assertDefined<T>(value: T, message: string): asserts value is Exclude<T, undefined> {
  if (value === undefined) throw new ValidationError(message);
}

/** `if (!field?.length) { ...; return; }` 형태 - 배열/문자열이 비어
 * 있으면(undefined/null 포함) 실패로 본다. */
export function assertNonEmpty<T extends { length: number }>(
  value: T | null | undefined,
  message: string,
): asserts value is T {
  if (!value?.length) throw new ValidationError(message);
}
