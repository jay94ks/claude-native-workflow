// `docs grep`/`document_grep`/`docs git grep`가 받는 정규식 규격을
// POSIX ERE(Extended Regular Expression, IEEE Std 1003.1)로 고정한다
// (#posix-regex-parser, 설계자 지시). 예전엔 (1) 패턴을 있는 그대로 JS
// 정규식으로 시도 → (2) 실패하면 POSIX 문자 클래스(`[:alpha:]` 등)만
// JS 문자 범위로 치환해 재시도 → (3) 그래도 안 되면 리터럴 문자열
// 검색으로 조용히 폴백하는 3단계 땜질이었다(#grep-posix-classes) - JS
// 문법과 POSIX 문법이 우연히 겹치는 부분만 맞았을 뿐, `\d`/`\w`/`\s`
// 같은 JS 전용 확장이 의도치 않게 통과되거나(규격이 "고정"돼 있지
// 않음), 진짜 문법이 깨진 패턴이 아무 경고 없이 리터럴로 둔갑하는
// 문제가 있었다. 이 모듈은 패턴을 실제로 문자 단위로 파싱해 동등한 JS
// RegExp 소스로 번역하고, 문법이 진짜로 깨졌으면(대괄호 미종료, 알 수
// 없는 POSIX 클래스 등) 조용히 다른 걸로 둔갑하지 않고 명확한 에러를
// 던진다 - 실제 `grep -E`도 잘못된 정규식엔 에러를 낸다.
//
// 괄호/중괄호 수량자(`( ) { }`)처럼 POSIX ERE와 JS가 그대로 같은 뜻인
// 메타문자는 번역하지 않고 통과시켜, 그 형태가 최종적으로 유효한지는
// JS 엔진 자신의 파서가 검증하게 한다(전체 정규식 엔진을 새로 구현하지
// 않고, POSIX와 JS가 실제로 다른 지점 - 대괄호 표현식 안에서 `\`가
// 특수 의미를 안 갖는 것, POSIX 문자 클래스, "정의되지 않은" `\`+보통
// 문자를 항상 리터럴로 고정하는 것 - 만 정확히 옮기는 데 집중한다).

export class PosixRegexError extends Error {}

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

// 대괄호 표현식 밖에서 POSIX ERE와 JS 정규식이 같은 뜻을 공유하는
// 메타문자 - 이 목록 밖의 모든 문자는(백슬래시로 이스케이프됐든
// 아니든) 리터럴로 취급해 JS 쪽 우연한 특수 의미를 차단한다.
const ERE_METACHARS = new Set([".", "^", "$", "*", "+", "?", "(", ")", "{", "}", "|"]);

const JS_REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/;

function escapeJsLiteral(ch: string): string {
  return JS_REGEX_SPECIAL.test(ch) ? `\\${ch}` : ch;
}

/** `pattern[start]`가 대괄호 표현식의 여는 `[`라고 가정하고 닫는 `]`
 * 까지 번역한다. POSIX 규칙: 여는 `[`(또는 그 바로 뒤 `^`) 다음에 오는
 * 첫 `]`는 표현식을 닫지 않고 리터럴 `]`다 - 그래서 진짜 닫는 `]`를
 * 못 찾으면(끝까지 못 찾으면) 에러. 대괄호 표현식 안에서는 `\`가
 * 특수 의미를 전혀 갖지 않는다(리터럴 백슬래시) - JS와 다른 지점이라
 * 반드시 이스케이프해서 넘겨야 한다. */
function translateBracketExpression(pattern: string, start: number): { js: string; next: number } {
  let i = start + 1;
  let negate = false;
  if (pattern[i] === "^") {
    negate = true;
    i++;
  }
  let body = "";
  let first = true;
  while (i < pattern.length && (pattern[i] !== "]" || first)) {
    const ch = pattern[i];
    if (ch === "[" && (pattern[i + 1] === ":" || pattern[i + 1] === "." || pattern[i + 1] === "=")) {
      const kind = pattern[i + 1];
      const closeSeq = kind + "]";
      const end = pattern.indexOf(closeSeq, i + 2);
      if (end === -1) {
        throw new PosixRegexError(`대괄호 표현식 안의 "[${kind}...${kind}]"가 닫히지 않았습니다: ${pattern}`);
      }
      const name = pattern.slice(i + 2, end);
      if (kind === ":") {
        const cls = POSIX_CLASSES[name];
        if (cls === undefined) throw new PosixRegexError(`알 수 없는 POSIX 문자 클래스입니다: [:${name}:]`);
        body += cls;
      } else {
        // collating symbol([.x.])/equivalence class([=x=])는 다국어
        // 정렬 순서 등을 다루는 고급 기능이라 이 프로젝트 범위 밖 -
        // 문자 하나만 감싼 형태([.a.] 등)만 그 문자 리터럴로 받아준다.
        if (name.length !== 1) {
          throw new PosixRegexError(`collating symbol/equivalence class는 문자 하나만 지원합니다: [${kind}${name}${kind}]`);
        }
        body += escapeJsLiteral(name);
      }
      i = end + 2;
      first = false;
      continue;
    }
    body += ch === "]" || ch === "\\" ? `\\${ch}` : ch;
    i++;
    first = false;
  }
  if (pattern[i] !== "]") {
    throw new PosixRegexError(`대괄호 표현식이 닫히지 않았습니다: [${negate ? "^" : ""}${body}`);
  }
  return { js: `[${negate ? "^" : ""}${body}]`, next: i + 1 };
}

/** POSIX ERE 패턴을 동등한 JS RegExp 소스 문자열로 번역한다. 대괄호
 * 표현식 밖에서 `\`+보통 문자는 그 문자 자체를 뜻하게 고정해(POSIX
 * 규격상으로는 정의되지 않은 조합이지만 실제 POSIX 기반 도구들의
 * 관행과 같음) `\d`/`\w`/`\s`/`\b` 같은 JS 전용 단축 클래스가 절대
 * 살아남지 않게 한다 - "규격을 POSIX로 고정한다"는 요구의 핵심. */
export function translatePosixEreToJs(pattern: string): string {
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "[") {
      const { js, next } = translateBracketExpression(pattern, i);
      out += js;
      i = next;
      continue;
    }
    if (ch === "\\") {
      const next = pattern[i + 1];
      if (next === undefined) throw new PosixRegexError(`패턴이 이스케이프 문자(\\)로 끝날 수 없습니다: ${pattern}`);
      out += ERE_METACHARS.has(next) || next === "[" || next === "]" || next === "\\" ? `\\${next}` : escapeJsLiteral(next);
      i += 2;
      continue;
    }
    if (ch === "]") {
      // 대괄호 표현식 밖의 단독 ']'는 POSIX ERE에서 그냥 리터럴 문자.
      out += "\\]";
      i++;
      continue;
    }
    if (ERE_METACHARS.has(ch)) {
      // '. ^ $ * + ? ( ) { } |' - POSIX ERE와 JS가 같은 뜻으로 공유하는
      // 메타문자라 그대로 통과시킨다. 이 형태가 최종적으로 유효한
      // 정규식을 이루는지(괄호 짝, 수량자 범위 등)는 아래 new RegExp()
      // 호출에서 JS 엔진 자신이 검증한다.
      out += ch;
      i++;
      continue;
    }
    out += escapeJsLiteral(ch);
    i++;
  }
  return out;
}

/** POSIX ERE 패턴을 컴파일한다 - 문법이 실제로 깨졌으면(대괄호 미종료,
 * 알 수 없는 POSIX 클래스, 괄호 미종료 등) `PosixRegexError`를 던진다
 * (조용한 리터럴 폴백 없음 - 실제 `grep -E`와 같은 원칙). */
export function compilePosixEre(pattern: string, caseInsensitive: boolean): RegExp {
  const source = translatePosixEreToJs(pattern);
  try {
    return new RegExp(source, caseInsensitive ? "i" : "");
  } catch (err) {
    // 번역 자체는 통과했지만(괄호/중괄호는 그대로 통과시켰으므로) 그
    // 결과가 여전히 유효한 정규식이 아닌 경우(괄호 짝 안 맞음 등) -
    // 사용자가 실제로 넘긴 원본 패턴 기준 메시지로 다시 싼다.
    const detail = err instanceof Error ? err.message : String(err);
    throw new PosixRegexError(`정규식이 올바르지 않습니다: ${pattern} (${detail})`);
  }
}
