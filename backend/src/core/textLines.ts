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

/** 정규식(JS 문법) 패턴으로 콘텐츠를 줄 단위 검색한다 - Grep 도구의
 * "content" 출력 모드와 같은 모양(줄 번호+텍스트). 잘못된 정규식은
 * 명확한 에러로 거부(추측해서 고쳐주지 않음). */
export function grepLines(content: string, pattern: string, opts: GrepOptions = {}): GrepMatch[] {
  let re: RegExp;
  try {
    re = new RegExp(pattern, opts.caseInsensitive ? "i" : "");
  } catch (err) {
    throw new Error(`잘못된 정규식입니다: ${err instanceof Error ? err.message : String(err)}`);
  }
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
