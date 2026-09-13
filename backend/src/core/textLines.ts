// 문서 본문(documents.ts)과 소스 코드 파일(gitea.ts) 둘 다 "줄 단위
// 부분 읽기/정규식 검색"이 필요해져서(#document-partial-read-grep-diff
// 다음 라운드에 소스 코드까지 확장) 순수 문자열 처리 로직만 여기 한
// 곳에 뽑아뒀다 - 두 호출부는 각자 원본 콘텐츠를 가져오는 방식만
// 다르고(검색 엔진 경유 vs Gitea REST), 그 뒤 처리는 완전히 동일하다.

export interface LinesResult {
  totalLines: number;
  offset: number;
  lines: string[];
}

const DEFAULT_LINES_LIMIT = 2000;

/** offset(1부터)부터 최대 limit줄 - 둘 다 생략하면 처음부터
 * DEFAULT_LINES_LIMIT줄(Read 도구의 offset/limit 관례와 동일). */
export function sliceLines(content: string, offset?: number, limit?: number): LinesResult {
  const allLines = content.split("\n");
  const start = Math.max(1, offset ?? 1);
  const count = limit ?? DEFAULT_LINES_LIMIT;
  return {
    totalLines: allLines.length,
    offset: start,
    lines: allLines.slice(start - 1, start - 1 + count),
  };
}

export interface GrepMatch {
  line: number;
  text: string;
}

export interface GrepOptions {
  caseInsensitive?: boolean;
  /** 앞뒤로 몇 줄씩 더 붙일지(grep -C와 동일) - 붙은 줄도 matches 배열에
   * 그대로 섞여 나오고, 실제 매치 여부는 각 항목에 없으므로 호출부가
   * 굳이 구분할 필요가 없을 때(대부분의 탐색)만 쓴다. */
  context?: number;
}

// 쉘 grep/ripgrep에 익숙한 호출부(특히 AI)가 POSIX 문자 클래스
// (`[[:alpha:]]` 등)를 그대로 쓰는 경우가 실제로 있었다(#grep-posix-classes) -
// JS RegExp는 이 문법을 모르는데, 에러를 던지는 대신 대괄호 표현식
// 안의 리터럴 문자들로 조용히 잘못 해석해버려서(`[[:alpha:]]` →
// ":alpha" 문자들과 "]" 하나로) 호출부가 "grep이 안 된다"고 오인하게
// 만들었다. RegExp에 넘기기 전에 알려진 POSIX 클래스만 동등한 JS
// 문자 범위로 치환한다 - 그 외 문법(BRE의 `\(`/`\)` 그룹핑 등)은
// 여전히 손대지 않는다(설계자 확정 - 이 클래스 치환 하나로 범위 한정).
const POSIX_CLASSES: Record<string, string> = {
  alpha: "A-Za-z",
  digit: "0-9",
  alnum: "A-Za-z0-9",
  upper: "A-Z",
  lower: "a-z",
  space: " \\t\\n\\r\\f\\v",
  blank: " \\t",
  punct: "!-/:-@\\[-`{-~",
  cntrl: "\\x00-\\x1f\\x7f",
  print: "\\x20-\\x7e",
  graph: "\\x21-\\x7e",
  xdigit: "0-9A-Fa-f",
};

function translatePosixClasses(pattern: string): string {
  return pattern.replace(/\[:(\w+):\]/g, (whole, name: string) => POSIX_CLASSES[name] ?? whole);
}

function escapeForLiteralSearch(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 패턴을 실제로 매칭에 쓸 매처로 컴파일한다 - 3단계 순차 폴백
 * (설계자 확정, #grep-posix-classes): (1) 있는 그대로 JS 정규식으로
 * 시도(기존 유효한 정규식은 전부 이 단계에서 그대로 통과) → (2)
 * 실패하면 POSIX 문자 클래스(`[[:alpha:]]` 등)만 JS 문자 범위로
 * 치환해 다시 시도 → (3) 그래도 실패하면(정말 정규식이 아니거나
 * 문법이 다른 경우) 정규식이 아니라 순수 리터럴 문자열 검색으로
 * 폴백한다(대소문자 옵션은 그대로 적용, 특수문자는 이스케이프해
 * 있는 그대로 찾음). 이 3단계 덕에 grepLines는 이제 "잘못된
 * 정규식" 에러를 던지지 않는다 - 항상 뭔가는 찾아본다.
 *
 * **1단계를 "그냥 시도"가 아니라 반드시 거쳐야 하는 이유**: POSIX
 * 문자 클래스는 JS 정규식 문법 관점에서 "틀린 문법"이 아니라 "다른
 * 뜻으로 유효하게 파싱되는 문법"이다 - `new RegExp("[[:alpha:]]")`는
 * 예외를 던지지 않고 조용히 컴파일된다(대괄호 표현식 안의 리터럴
 * 문자들 + 그 뒤 홑 `]`로). 즉 1단계는 절대 실패(예외)하지 않으므로,
 * "1단계가 실패하면 2단계로"라는 try/catch만으로는 2단계에 절대
 * 도달할 수 없다 - 그래서 POSIX 치환은 예외 발생 여부와 무관하게
 * 항상 먼저 적용해본 뒤(치환됐으면 그 결과로, 안 됐으면 원본 그대로)
 * 컴파일을 시도해야 한다(#grep-posix-classes 실측으로 확인 - 치환을
 * try/catch 뒤로 미뤘던 1차 구현은 `[[:alpha:]]`를 여전히 오해석해
 * 빈 결과를 냈다). 진짜 JS 문법 자체가 깨진 경우(괄호 미종료 등)만
 * 3단계 리터럴 폴백으로 넘어간다. */
function compilePattern(pattern: string, caseInsensitive: boolean): RegExp {
  const flags = caseInsensitive ? "i" : "";
  const translated = translatePosixClasses(pattern);
  try {
    return new RegExp(translated, flags);
  } catch {
    // 3단계(리터럴)로 폴백 - 원본 패턴 기준(치환 결과가 아니라
    // 사용자가 실제로 찾고 싶어한 문자열 그대로).
  }
  return new RegExp(escapeForLiteralSearch(pattern), flags);
}

/** 정규식(JS 문법 + POSIX 문자 클래스, 그래도 안 되면 리터럴 문자열)
 * 패턴으로 콘텐츠를 줄 단위 검색한다 - Grep 도구의 "content" 출력
 * 모드와 같은 모양(줄 번호+텍스트). compilePattern()의 3단계 폴백
 * 덕에 이 함수는 더 이상 에러를 던지지 않는다. */
export function grepLines(content: string, pattern: string, opts: GrepOptions = {}): GrepMatch[] {
  const re = compilePattern(pattern, !!opts.caseInsensitive);
  const lines = content.split("\n");
  const contextSize = Math.max(0, opts.context ?? 0);
  const matchedLineNumbers = new Set<number>();
  lines.forEach((line, i) => {
    if (!re.test(line)) return;
    for (let n = Math.max(0, i - contextSize); n <= Math.min(lines.length - 1, i + contextSize); n++) {
      matchedLineNumbers.add(n);
    }
  });
  return [...matchedLineNumbers]
    .sort((a, b) => a - b)
    .map((i) => ({ line: i + 1, text: lines[i] }));
}
