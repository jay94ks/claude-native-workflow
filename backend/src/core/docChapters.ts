// 문서 본문을 마크다운 헤딩(#~######) 단위 "챕터"로 다루는 순수
// 문자열 처리 로직 - textLines.ts(#document-partial-read-grep-diff)와
// 같은 관례: 여기 함수들은 DB/검색 엔진을 전혀 모르고 body 문자열만
// 받아 body 문자열을 돌려준다. 실제 조회/저장(리비전 생성 등)은
// documents.ts의 얇은 래퍼가 담당한다.
//
// "챕터"는 헤딩 하나 + 그 헤딩보다 깊은(레벨 숫자가 큰) 하위 헤딩들의
// 내용까지 포함한다 - 같은 레벨 이하의 다음 헤딩(또는 문서 끝) 전까지.
// 예를 들어 "## A" 챕터는 그 밑의 "### A-1"/"### A-2"까지 통째로
// 포함하고, 다음 "## B"가 나오는 줄 바로 앞에서 끝난다.
//
// 챕터 번호(ordinal)는 매번 본문에서 새로 계산되는 1-based 순번이다
// (제목 텍스트나 별도 id로 주소를 매기지 않음 - 중복 제목이 있어도
// 항상 명확하고, sliceLines()의 offset 관례와 같은 선상). 첫 헤딩
// 앞에 본문이 있으면(흔치 않지만 가능) 그 구간만 예외적으로
// ordinal 0("서문")을 받는다. 헤딩이 아예 없는 문서는 본문 전체를
// 가리키는 합성 챕터 1개(level:0)로 취급한다.
//
// maxLevel 같은 "이 레벨까지만 챕터로 본다" 필터는 일부러 안 뒀다 -
// list와 개별 조작(get/set/add/delete)이 서로 다른 maxLevel로
// 불려서 같은 ordinal이 서로 다른 챕터를 가리키게 되는 순서 꼬임
// 위험이 있기 때문(예: 목록은 H1/H2만 보고 조작은 전체 깊이로 하면
// 번호가 안 맞음). 대신 매 챕터마다 `level` 필드를 그대로 주므로,
// 얕은 목차만 보고 싶은 호출부는 반환된 배열을 스스로 필터링하면
// 된다 - ordinal 자체는 항상 전체 깊이 기준으로 고정.

export interface ChapterInfo {
  ordinal: number;
  /** 0 = 서문(첫 헤딩 앞) 또는 헤딩이 아예 없는 문서 전체, 1-6 = 헤딩 레벨(#의 개수) */
  level: number;
  /** 헤딩 텍스트("#" 기호 제외, 앞뒤 공백 제거) - level 0이면 빈 문자열 */
  heading: string;
  /** 1-based, 헤딩 줄 자체(또는 서문의 첫 줄) */
  lineStart: number;
  /** 1-based, 포함(inclusive) - 다음 챕터 시작 줄 바로 앞 또는 문서 끝 */
  lineEnd: number;
}

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*$/;

interface RawHeading {
  line: number;
  level: number;
  heading: string;
}

function findHeadings(lines: string[]): RawHeading[] {
  const result: RawHeading[] = [];
  lines.forEach((line, i) => {
    const m = HEADING_RE.exec(line);
    if (m) result.push({ line: i + 1, level: m[1].length, heading: m[2] });
  });
  return result;
}

/** 본문을 챕터 목록으로 분해한다 - DB 접근 없는 순수 함수. */
export function listChapters(body: string): ChapterInfo[] {
  const lines = body.split("\n");
  const totalLines = lines.length;
  const headings = findHeadings(lines);

  if (headings.length === 0) {
    return [{ ordinal: 1, level: 0, heading: "", lineStart: 1, lineEnd: totalLines }];
  }

  const hasPreamble = headings[0].line > 1;
  const chapters: Omit<ChapterInfo, "ordinal">[] = [];
  if (hasPreamble) {
    chapters.push({ level: 0, heading: "", lineStart: 1, lineEnd: headings[0].line - 1 });
  }
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    let lineEnd = totalLines;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= h.level) {
        lineEnd = headings[j].line - 1;
        break;
      }
    }
    chapters.push({ level: h.level, heading: h.heading, lineStart: h.line, lineEnd });
  }

  return chapters.map((c, i) => ({ ordinal: hasPreamble ? i : i + 1, ...c }));
}

function findChapterOrThrow(chapters: ChapterInfo[], ordinal: number): ChapterInfo {
  const chapter = chapters.find((c) => c.ordinal === ordinal);
  if (!chapter) {
    const min = chapters[0].ordinal;
    const max = chapters[chapters.length - 1].ordinal;
    throw new Error(`챕터를 찾을 수 없습니다: ${ordinal}(현재 문서는 ${min}~${max}번 챕터가 있습니다)`);
  }
  return chapter;
}

export function getChapterContent(body: string, ordinal: number): { chapter: ChapterInfo; content: string } {
  const lines = body.split("\n");
  const chapter = findChapterOrThrow(listChapters(body), ordinal);
  return { chapter, content: lines.slice(chapter.lineStart - 1, chapter.lineEnd).join("\n") };
}

/** newContent는 헤딩 줄 자체를 포함해서 넘겨야 한다(레벨을 자동으로
 * 맞춰주지 않는 순수 텍스트 스플라이스). */
export function replaceChapter(body: string, ordinal: number, newContent: string): string {
  const lines = body.split("\n");
  const chapter = findChapterOrThrow(listChapters(body), ordinal);
  const before = lines.slice(0, chapter.lineStart - 1);
  const after = lines.slice(chapter.lineEnd);
  return [...before, ...newContent.split("\n"), ...after].join("\n");
}

export type ChapterInsertPosition = { after: number } | { before: number } | { atStart: true } | { atEnd: true };

/** content는 새 챕터가 될 헤딩 줄 자체를 포함해서 넘겨야 한다. */
export function insertChapter(body: string, position: ChapterInsertPosition, content: string): string {
  const lines = body.split("\n");
  const chapters = listChapters(body);
  let insertAtLine: number; // 1-based, 이 줄 앞에 삽입
  if ("atStart" in position) {
    insertAtLine = 1;
  } else if ("atEnd" in position) {
    insertAtLine = lines.length + 1;
  } else if ("after" in position) {
    insertAtLine = findChapterOrThrow(chapters, position.after).lineEnd + 1;
  } else {
    insertAtLine = findChapterOrThrow(chapters, position.before).lineStart;
  }
  const before = lines.slice(0, insertAtLine - 1);
  const after = lines.slice(insertAtLine - 1);
  return [...before, ...content.split("\n"), ...after].join("\n");
}

/** 문서에 남은 챕터가 하나뿐이면 거부한다(빈 본문을 만들지 않기
 * 위해 - "마지막 하나 남은 챕터는 삭제 대신 set으로 내용을 비우거나
 * 문서 자체를 삭제하라"는 취지). */
export function deleteChapter(body: string, ordinal: number): string {
  const lines = body.split("\n");
  const chapters = listChapters(body);
  if (chapters.length === 1) {
    throw new Error("문서에 챕터가 하나뿐이라 삭제할 수 없습니다 - chapter set으로 내용을 비우거나 문서 자체를 삭제하세요");
  }
  const chapter = findChapterOrThrow(chapters, ordinal);
  const before = lines.slice(0, chapter.lineStart - 1);
  const after = lines.slice(chapter.lineEnd);
  return [...before, ...after].join("\n");
}
