import { marked } from "marked";
import DOMPurify from "dompurify";

// 설계자 요청(2026-09-21 후속) - Q&A/opinion 카드 본문이 지금까지
// white-space:pre-wrap으로 원문 그대로 찍혔는데, 실제로는 Markdown으로
// 작성될 수 있으니 렌더링해서 보여줘야 한다. MarkdownSourceView.vue의
// 보기 모드는 yiitap(ProseMirror)에 HTML을 넘겨 그 에디터 스키마로
// 다시 파싱시키는 방식이라 사실상 안전하지만(스키마에 없는 태그/속성은
// 버려짐), 여기서는 짧은 카드 여러 개를 가볍게 렌더링해야 해서 무거운
// 에디터 인스턴스 대신 순수 v-html을 쓴다 - marked는 자체적으로
// sanitize를 안 하므로(v5+에서 그 옵션 자체가 없어짐) DOMPurify로
// 직접 한 번 걸러야 새 XSS 경로가 생기지 않는다.
export function renderMarkdownSafe(content: string): string {
  const html = marked.parse(content || "", { async: false }) as string;
  return DOMPurify.sanitize(html);
}
