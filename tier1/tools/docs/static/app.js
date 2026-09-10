// docs dashboard - vanilla JS SPA (no build step, no dependencies)

const TYPE_LABEL = {
  IX: "최상위 색인", SP: "설계 명세", PL: "실행 계획", DN: "결과 보고",
  DS: "설계", RM: "기억 지시", TP: "임시 문서", DC: "결정 요청",
  RV: "검토 요청", FX: "수정 검토", LG: "처리 기록", RP: "답변 항목",
};
const DESIGN_TYPES = new Set(["DC", "RV", "FX"]);

const state = {
  tab: "all",
  idIndex: {},       // id -> {path, type, title}
  currentDoc: null,  // {path, meta, body}
  changedPaths: new Set(),  // doc_path들 - 확인 안 된 변경 큐(RV-00001 결합안 1번, 트리 배지용)
};

// ---------------------------------------------------------------- helpers

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

function slugify(s) {
  return s.trim().toLowerCase()
    .replace(/[`~!@#$%^&*()+=[\]{}|\\:;"'<>,.?/]/g, "")
    .replace(/\s+/g, "-");
}

// ---------------------------------------------------------------- markdown (lite)

function renderMarkdown(src) {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  let html = [];
  let i = 0;
  let inCode = false, codeBuf = [];
  let listBuf = null; // {ordered, items: []}

  function flushList() {
    if (!listBuf) return;
    const tag = listBuf.ordered ? "ol" : "ul";
    html.push(`<${tag}>` + listBuf.items.join("") + `</${tag}>`);
    listBuf = null;
  }

  function inline(text) {
    text = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // stash code spans and links first so later passes (bold/italic/doc-ref)
    // never re-match text sitting inside an href or code span.
    const stash = [];
    const save = (html) => { stash.push(html); return `\x00${stash.length - 1}\x00`; };

    text = text.replace(/`([^`]+)`/g, (_, code) => save(`<code>${code}</code>`));
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) =>
      save(`<a href="${url}" data-link="1">${label}</a>`));

    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    // bare TYPE-00000 references -> clickable doc-ref
    text = text.replace(/\b([A-Z]{2}-\d{5})\b/g, (m) => `<span class="doc-ref" data-id="${m}">${m}</span>`);

    text = text.replace(/\x00(\d+)\x00/g, (_, i) => stash[Number(i)]);
    return text;
  }

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      if (!inCode) { inCode = true; codeBuf = []; i++; continue; }
      inCode = false;
      html.push(`<pre><code>${codeBuf.join("\n")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`);
      i++; continue;
    }
    if (inCode) { codeBuf.push(line); i++; continue; }

    if (!line.trim()) { flushList(); i++; continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushList();
      const level = h[1].length;
      const text = h[2].trim();
      html.push(`<h${level} id="${slugify(text)}">${inline(text)}</h${level}>`);
      i++; continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line) && lines[i + 1] && /^\s*\|?[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      flushList();
      const headerCells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      let j = i + 2;
      const rows = [];
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) {
        rows.push(lines[j].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
        j++;
      }
      let t = "<table><thead><tr>" + headerCells.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>";
      for (const r of rows) t += "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>";
      t += "</tbody></table>";
      html.push(t);
      i = j; continue;
    }

    const task = line.match(/^-\s+\[( |x)\]\s+(.*)$/);
    if (task) {
      if (!listBuf || listBuf.ordered) { flushList(); listBuf = { ordered: false, items: [] }; }
      const checked = task[1] === "x" ? "checked" : "";
      listBuf.items.push(`<li class="task"><input type="checkbox" disabled ${checked}> ${inline(task[2])}</li>`);
      i++; continue;
    }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      if (!listBuf || listBuf.ordered) { flushList(); listBuf = { ordered: false, items: [] }; }
      listBuf.items.push(`<li>${inline(bullet[1])}</li>`);
      i++; continue;
    }
    const numbered = line.match(/^\d+\.\s+(.*)$/);
    if (numbered) {
      if (!listBuf || !listBuf.ordered) { flushList(); listBuf = { ordered: true, items: [] }; }
      listBuf.items.push(`<li>${inline(numbered[1])}</li>`);
      i++; continue;
    }

    if (line.trim().startsWith(">")) {
      flushList();
      const buf = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        buf.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      html.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }

    if (/^---+$/.test(line.trim())) { flushList(); html.push("<hr>"); i++; continue; }

    flushList();
    html.push(`<p>${inline(line)}</p>`);
    i++;
  }
  flushList();
  return html.join("\n");
}

// ---------------------------------------------------------------- tree

async function loadTree() {
  const tree = await api("/api/tree");
  const container = document.getElementById("tree");
  container.innerHTML = "";
  indexTree(tree);
  container.appendChild(renderTreeNode(tree, true));
}

function indexTree(node) {
  if (node.type === "file") {
    state.idIndex[node.id] = node;
  }
  for (const c of node.children || []) indexTree(c);
}

// index.md(폴더별 색인)/PROTOCOL.md는 실제 설계 문서가 아니라 항상 존재하는
// 뼈대 파일이라, 이 둘만 빼고 세면 "문서가 하나도 없는 타입 폴더"를 정확히
// 판별할 수 있다(tier2/dashboard의 DocTree.vue isDocFile()과 동일한 기준).
function isDocFile(node) {
  return node.type === "file" && node.name !== "index.md" && node.name !== "PROTOCOL.md";
}

function countDocs(node) {
  if (isDocFile(node)) return 1;
  if (node.type !== "dir") return 0;
  return (node.children || []).reduce((sum, c) => sum + countDocs(c), 0);
}

function renderTreeNode(node, isRoot) {
  const wrap = document.createElement("div");
  if (node.type === "dir") {
    // RV-00001 결합안 1번: 문서가 하나도 없는 타입 폴더는 렌더링하지 않는다
    // (이 저장소 자신의 docs/도 11개 타입 폴더 중 7개가 비어 있었음).
    const count = countDocs(node);
    if (!isRoot && count === 0) return null;
    if (!isRoot) wrap.appendChild(el("div", { class: "tree-dir" }, `${node.name} (${count})`));
    const kids = el("div", { class: isRoot ? "" : "tree-children" });
    for (const c of node.children) {
      const rendered = renderTreeNode(c, false);
      if (rendered) kids.appendChild(rendered);
    }
    wrap.appendChild(kids);
  } else {
    const label = node.title ? `${node.id} · ${node.title}` : node.name;
    // isDocFile()로 걸러야 한다 - QA로 발견: PROTOCOL.md 본문이 "답변 대기"
    // 형식 예시를 문서화 목적으로 그대로 담고 있어서(`- [ ] (Q1) ...`류),
    // reply_pending을 본문 스캔으로 바꾸면서 PROTOCOL.md도 "답변 대기 중"으로
    // 잘못 표시되는 걸 실제로 확인(iter_doc_files()가 PROTOCOL.md/index.md를
    // 원래부터 답변 대기 목록에서 빼는 것과 같은 이유 - build_tree()는 그
    // 제외를 안 해서 트리 표시에서만 새어나갔다). tier2/dashboard의
    // DocTree.vue는 애초에 index.md/PROTOCOL.md를 파일 행 자체로 렌더링하지
    // 않아 이 문제가 없다.
    const needsAttention = isDocFile(node) && (!!node.reply_pending || state.changedPaths.has(node.path));
    const fileEl = el("div", {
      class: "tree-file", title: label,
      onclick: () => openDoc(node.path),
    }, label);
    if (needsAttention) {
      fileEl.appendChild(el("span", { class: "tree-attn", title: "답변 대기 중이거나 최근 변경됨" }, "⚠"));
    }
    wrap.appendChild(fileEl);
  }
  return wrap;
}

// ---------------------------------------------------------------- tabs & lists

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  showListPane();
  loadList();
}

function showListPane() {
  document.getElementById("list-pane").hidden = false;
  document.getElementById("doc-pane").hidden = true;
}

async function loadList() {
  const pane = document.getElementById("list-pane");
  pane.innerHTML = "불러오는 중...";
  if (state.tab === "pending") return loadPendingList(pane);

  let items;
  if (state.tab === "all") items = await api("/api/all");
  else if (state.tab === "design") items = await api("/api/design");
  else items = await api("/api/logs");

  pane.innerHTML = "";
  if (!items.length) {
    pane.appendChild(el("div", { class: "empty-note" }, "문서가 없습니다."));
    return;
  }
  for (const it of items) {
    const card = el("div", { class: "doc-card", onclick: () => openDoc(it.path) }, [
      el("div", { class: "row1" }, [
        el("span", {}, [
          el("span", { class: "id" }, it.id),
          el("span", { class: "title" }, it.title || "(제목 없음)"),
        ]),
        el("span", { class: "badge" + (it.reply_pending ? " pending" : "") },
          it.reply_pending ? "답변 대기" : (it.status || "-")),
      ]),
      el("div", { class: "meta" }, `${TYPE_LABEL[it.type] || it.type} · ${it.updated || ""}`),
    ]);
    pane.appendChild(card);
  }
}

// 프로젝트 전체를 훑어 미답변 (Qn)을 전부 모아 보여준다 - 문서 하나를 열어야만
// 보이던 pending-section(scanPending, 그 문서 안 질문만)과 달리 여러 문서에
// 흩어진 질문을 한 화면에서 확인할 수 있다.
async function loadPendingList(pane) {
  const items = await api("/api/pending");
  pane.innerHTML = "";
  if (!items.length) {
    pane.appendChild(el("div", { class: "empty-note" }, "답변 대기 중인 질문이 없습니다."));
    return;
  }
  for (const it of items) {
    const rec = (it.options || []).find((o) => o.kind === "권장");
    pane.appendChild(el("div", {
      class: "doc-card",
      onclick: async () => {
        await openDoc(it.doc_path);
        openReplyDialog(it.doc_path, it.question_id, it.question, it.options || []);
      },
    }, [
      el("div", { class: "row1" }, [
        el("span", {}, [
          el("span", { class: "id" }, it.doc_id),
          el("span", { class: "title" }, it.title || "(제목 없음)"),
        ]),
        el("span", { class: "badge pending" }, `Q${it.question_id}`),
      ]),
      el("div", { class: "meta" }, it.question),
      rec ? el("div", { class: "rec-preview" }, `권장: ${rec.text}`) : null,
    ]));
  }
}

// ---------------------------------------------------------------- search

let searchDebounce = null;

function initSearch() {
  const input = document.getElementById("search-input");
  const results = document.getElementById("search-results");
  const tree = document.getElementById("tree");

  input.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    const q = input.value.trim();
    if (!q) {
      results.hidden = true;
      results.innerHTML = "";
      tree.hidden = false;
      return;
    }
    searchDebounce = setTimeout(() => runSearch(q, results, tree), 250);
  });
}

async function runSearch(q, results, tree) {
  const items = await api("/api/search?q=" + encodeURIComponent(q));
  tree.hidden = true;
  results.hidden = false;
  results.innerHTML = "";
  if (!items.length) {
    results.appendChild(el("div", { class: "empty-note" }, "검색 결과가 없습니다."));
    return;
  }
  for (const it of items) {
    results.appendChild(el("div", {
      class: "search-result", onclick: () => openDoc(it.path),
    }, [
      el("div", { class: "search-result-title" }, `${it.id} · ${it.title || "(제목 없음)"}`),
      el("div", { class: "search-result-snippet" }, `…${it.snippet}…`),
    ]));
  }
}

// ---------------------------------------------------------------- doc viewer

async function openDoc(path) {
  const doc = await api("/api/doc?path=" + encodeURIComponent(path));
  state.currentDoc = doc;
  document.getElementById("list-pane").hidden = true;
  const pane = document.getElementById("doc-pane");
  pane.hidden = false;
  renderDoc(doc);
}

function renderDoc(doc) {
  const pane = document.getElementById("doc-pane");
  pane.innerHTML = "";
  const meta = doc.meta || {};

  pane.appendChild(el("span", { class: "back", onclick: showListPane }, "← 목록으로"));
  pane.appendChild(el("div", { class: "doc-header" }, [
    el("h2", {}, `${meta.id || doc.path} ${meta.title ? "· " + meta.title : ""}`),
    el("span", { class: "header-actions" }, [
      el("span", { class: "badge" }, meta.status || ""),
      el("button", { class: "edit-btn", onclick: () => enterEditMode(doc) }, "편집"),
    ]),
  ]));
  pane.appendChild(el("div", { class: "doc-meta-line" },
    `${meta.type ? TYPE_LABEL[meta.type] || meta.type : ""} · updated ${meta.updated || meta.created || "-"} · ${doc.path}`));

  const body = el("div", { class: "doc-body", html: renderMarkdown(doc.body) });
  pane.appendChild(body);
  body.querySelectorAll(".doc-ref").forEach((n) => {
    n.addEventListener("click", () => jumpToId(n.dataset.id));
  });
  body.querySelectorAll("a[data-link]").forEach((a) => {
    a.addEventListener("click", (ev) => {
      const href = a.getAttribute("href");
      if (/^https?:\/\//.test(href)) return; // let external links behave normally
      ev.preventDefault();
      resolveRelativeLink(doc.path, href);
    });
  });

  const pendingItems = scanPending(doc.body);
  if (pendingItems.length) {
    const section = el("div", { class: "pending-section" }, [
      el("h4", {}, `답변 대기 항목 (${pendingItems.length})`),
    ]);
    for (const p of pendingItems) {
      const rec = p.options.find((o) => o.kind === "권장");
      section.appendChild(el("div", { class: "pending-card" }, [
        el("div", {}, [
          el("div", { class: "q" }, `(Q${p.qid}) ${p.text}`),
          rec ? el("div", { class: "rec-preview" }, `권장: ${rec.text}`) : null,
        ]),
        el("button", { onclick: () => openReplyDialog(doc.path, p.qid, p.text, p.options) }, "답변 입력"),
      ]));
    }
    pane.appendChild(section);
  }

  if (DESIGN_TYPES.has(meta.type)) {
    pane.appendChild(el("div", { class: "howto-section" }, [
      el("h4", {}, "답변 입력 후 처리 요령"),
      el("ol", {}, [
        el("li", {}, "답변을 제출하면 RP-XXXXX 번호가 발급되고, 이 문서 하단 \"## 답변 기록\" 섹션에 질문·답변 전문이 직접 기록됩니다(별도 파일을 만들지 않습니다)."),
        el("li", {}, "이 문서의 해당 (Qn) 줄이 체크되고 그 기록으로 가는 앵커 링크가 남습니다."),
        el("li", {}, "docs/reply/index.md 미답변 큐에서 이 항목이 제거됩니다."),
        el("li", {}, "docs/logs/에 처리 기록(LG, 대상 문서당 1개)이 남고 이 문서·RP 앵커에 연결됩니다."),
        el("li", {}, "이 문서의 모든 질문에 답변되면 상태가 answered로 바뀝니다."),
      ]),
    ]));
  }

  loadCommentsSection(pane, doc.path);
  loadHistorySection(pane, doc.path);
}

// ---------------------------------------------------------------- body editor
//
// Body-only editing (frontmatter is never touched here - id/type/status/links
// still only change through the controlled flows). Plain textarea + a small
// toolbar that wraps the current selection with markdown syntax, rather than
// a WYSIWYG editor - keeps this dependency-free and the saved file exactly
// what the designer sees in the box.

function wrapSelection(textarea, before, after) {
  after = after === undefined ? before : after;
  const start = textarea.selectionStart, end = textarea.selectionEnd;
  const val = textarea.value;
  textarea.value = val.slice(0, start) + before + val.slice(start, end) + after + val.slice(end);
  textarea.focus();
  textarea.selectionStart = start + before.length;
  textarea.selectionEnd = end + before.length;
}

function prefixCurrentLine(textarea, prefix) {
  const start = textarea.selectionStart;
  const val = textarea.value;
  const lineStart = val.lastIndexOf("\n", start - 1) + 1;
  textarea.value = val.slice(0, lineStart) + prefix + val.slice(lineStart);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + prefix.length;
}

function enterEditMode(doc) {
  const pane = document.getElementById("doc-pane");
  const bodyDiv = pane.querySelector(".doc-body");
  if (!bodyDiv) return;

  const textarea = el("textarea", { class: "doc-edit-area", spellcheck: "false" });
  textarea.value = doc.body;

  const toolbar = el("div", { class: "edit-toolbar" }, [
    el("button", { type: "button", title: "굵게", onclick: () => wrapSelection(textarea, "**") }, "B"),
    el("button", { type: "button", title: "취소선", onclick: () => wrapSelection(textarea, "~~") }, "S"),
    el("button", { type: "button", title: "제목 1", onclick: () => prefixCurrentLine(textarea, "# ") }, "H1"),
    el("button", { type: "button", title: "제목 2", onclick: () => prefixCurrentLine(textarea, "## ") }, "H2"),
    el("button", { type: "button", title: "코드", onclick: () => wrapSelection(textarea, "`") }, "Code"),
    el("button", { type: "button", title: "링크", onclick: () => wrapSelection(textarea, "[", "](url)") }, "Link"),
  ]);

  const status = el("span", { class: "edit-status" }, "");
  const actions = el("div", { class: "edit-actions" }, [
    status,
    el("button", { type: "button", class: "edit-cancel", onclick: () => renderDoc(doc) }, "취소"),
    el("button", {
      type: "button", class: "edit-save",
      onclick: async () => {
        status.textContent = "저장 중...";
        try {
          await api("/api/doc/save", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: doc.path, body: textarea.value }),
          });
          await openDoc(doc.path);
        } catch (e) {
          status.textContent = "";
          alert("저장 실패: " + e.message);
        }
      },
    }, "저장"),
  ]);

  const editWrap = el("div", { class: "doc-edit-wrap" }, [toolbar, textarea, actions]);
  bodyDiv.replaceWith(editWrap);
  textarea.focus();
}

// ---------------------------------------------------------------- comments

async function loadCommentsSection(pane, docPath) {
  const section = el("div", { class: "comments-section" }, [
    el("h4", {}, "코멘트"),
  ]);
  pane.appendChild(section);
  const list = el("div", { class: "comments-list" }, "불러오는 중...");
  section.appendChild(list);

  let comments;
  try {
    comments = await api("/api/docs/" + docPath + "/comments");
  } catch (e) {
    list.textContent = "코멘트를 불러오지 못했습니다.";
    return;
  }

  list.innerHTML = "";
  if (!comments.length) {
    list.appendChild(el("div", { class: "empty-note" }, "아직 코멘트가 없습니다."));
  }
  for (const c of comments) {
    list.appendChild(el("div", { class: "comment-card" + (c.resolved_at ? " resolved" : "") }, [
      el("div", { class: "comment-body" }, c.body),
      el("div", { class: "comment-meta" }, [
        el("span", {}, c.created_at + (c.resolved_at ? " · 해결됨" : "")),
        c.resolved_at ? null : el("button", {
          onclick: async () => {
            await api("/api/docs/" + docPath + "/comments/" + c.id + "/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
            openDoc(docPath);
          },
        }, "해결 처리"),
      ]),
    ]));
  }

  const form = el("div", { class: "comment-form" }, [
    el("textarea", { id: "new-comment-text", rows: "2", placeholder: "코멘트 작성 (비공식 토론용 - 마크다운 파일에는 남지 않습니다)" }),
    el("button", {
      onclick: async () => {
        const ta = document.getElementById("new-comment-text");
        const body = ta.value.trim();
        if (!body) return;
        await api("/api/docs/" + docPath + "/comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
        openDoc(docPath);
      },
    }, "코멘트 등록"),
  ]);
  section.appendChild(form);
}

// ---------------------------------------------------------------- git history

async function loadHistorySection(pane, docPath) {
  const section = el("div", { class: "history-section" }, [
    el("h4", {}, "커밋 이력"),
    el("button", {
      class: "blame-toggle-btn",
      onclick: async () => {
        if (!blameBox.hidden) { blameBox.hidden = true; return; }
        blameBox.hidden = false;
        blameBox.textContent = "불러오는 중...";
        const res = await fetch("/api/git/blame?path=" + encodeURIComponent(docPath));
        blameBox.textContent = await res.text();
      },
    }, "blame 보기"),
  ]);
  pane.appendChild(section);
  const blameBox = el("pre", { class: "diff-box", hidden: "hidden" });
  section.appendChild(blameBox);
  const list = el("div", { class: "history-list" }, "불러오는 중...");
  section.appendChild(list);
  const filesBox = el("div", { class: "commit-files", hidden: "hidden" });
  section.appendChild(filesBox);
  const diffBox = el("pre", { class: "diff-box", hidden: "hidden" });
  section.appendChild(diffBox);

  let commits;
  try {
    commits = await api("/api/git/log?path=" + encodeURIComponent(docPath) + "&limit=10");
  } catch (e) {
    list.textContent = "git 이력을 불러오지 못했습니다(git 저장소가 아니거나 git이 없을 수 있습니다).";
    return;
  }

  list.innerHTML = "";
  if (!commits.length) {
    list.appendChild(el("div", { class: "empty-note" }, "커밋 이력이 없습니다."));
    return;
  }
  for (const c of commits) {
    list.appendChild(el("div", { class: "commit-row", onclick: async () => {
      diffBox.hidden = false;
      diffBox.textContent = "불러오는 중...";
      filesBox.hidden = true;
      const [detail, diffText] = await Promise.all([
        api("/api/git/commits/" + c.sha).catch(() => null),
        fetch("/api/git/diff/" + c.sha).then((r) => r.text()),
      ]);
      if (detail && detail.files && detail.files.length) {
        filesBox.hidden = false;
        filesBox.innerHTML = "";
        filesBox.appendChild(el("div", { class: "commit-files-title" }, `변경된 파일 (${detail.files.length})`));
        for (const f of detail.files) filesBox.appendChild(el("div", { class: "commit-file-row" }, f));
      }
      diffBox.textContent = diffText;
    } }, [
      el("span", { class: "commit-sha" }, c.sha.slice(0, 8)),
      el("span", { class: "commit-date" }, c.date),
      el("span", { class: "commit-msg" }, c.message),
    ]));
  }
}

// ---------------------------------------------------------------- change queue

async function loadChangeBanner() {
  const holder = document.getElementById("change-banner");
  let notices;
  try {
    notices = await api("/api/changes");
  } catch (e) {
    return;
  }
  state.changedPaths = new Set(notices.map((n) => n.doc_path));
  loadTree();  // 트리의 "주의 필요" 배지가 이 변경 큐를 반영하도록 다시 그린다

  holder.innerHTML = "";
  if (!notices.length) { holder.hidden = true; return; }
  holder.hidden = false;
  holder.appendChild(el("span", {}, `변경 감지: ${notices.length}건 (직접 편집 등으로 캐시와 달라진 문서)`));
  for (const n of notices) {
    holder.appendChild(el("span", { class: "change-chip", onclick: () => openDoc(n.doc_path) }, n.doc_path));
    holder.appendChild(el("button", {
      onclick: async (ev) => {
        ev.stopPropagation();
        await api("/api/changes/" + n.id + "/ack", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        loadChangeBanner();
      },
    }, "확인"));
  }
}

function scanPending(body) {
  // mirrors server.py scan_pending_in_text: an optional indented
  // "- 권장: ..." / "- 대안: ..." block right under the (Qn) line becomes
  // clickable quick-answer options in the reply dialog.
  const lines = body.split("\n");
  const qRe = /^- \[ \] \(Q(\d+)\) (.+)$/;
  const optRe = /^\s+- (권장|대안): (.+)$/;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(qRe);
    if (!m) continue;
    const options = [];
    let j = i + 1;
    while (j < lines.length) {
      const om = lines[j].match(optRe);
      if (!om) break;
      options.push({ kind: om[1], text: om[2] });
      j++;
    }
    out.push({ qid: m[1], text: m[2], options });
  }
  return out;
}

function jumpToId(id) {
  const type = id.split("-")[0];
  const node = state.idIndex[id];
  if (!node) { alert(`${id} 문서를 찾을 수 없습니다.`); return; }
  if (DESIGN_TYPES.has(type)) setTabAndOpen("design", node.path);
  else if (type === "LG") setTabAndOpen("logs", node.path);
  else setTabAndOpen("all", node.path);
}

function setTabAndOpen(tab, path) {
  state.tab = tab;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  openDoc(path);
}

function resolveRelativeLink(fromPath, href) {
  if (href.startsWith("#")) {
    const target = document.getElementById(href.slice(1));
    if (target) target.scrollIntoView({ behavior: "smooth" });
    return;
  }
  const [linkPath, anchor] = href.split("#");
  const baseParts = fromPath.split("/"); baseParts.pop();
  const parts = baseParts.concat(linkPath.split("/"));
  const resolved = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  const path = resolved.join("/");
  openDoc(path).then(() => {
    if (anchor) {
      const target = document.getElementById(anchor);
      if (target) target.scrollIntoView({ behavior: "smooth" });
    }
  }).catch(() => alert("문서를 열 수 없습니다: " + path));
}

// ---------------------------------------------------------------- reply dialog

let pendingReply = null; // {docPath, qid}

async function openReplyDialog(docPath, qid, text, options) {
  pendingReply = { docPath, qid };
  document.getElementById("reply-question").textContent = `(Q${qid}) ${text}`;
  const answerBox = document.getElementById("reply-answer");
  answerBox.value = "";

  // Reference material = the related SP/DS/PL/... docs this one cites via
  // its own frontmatter `links` - the context that motivated the question -
  // not the question sheet's own text (that's already open behind the dialog).
  const ref = document.getElementById("reply-reference");
  ref.innerHTML = "불러오는 중...";
  const links = (state.currentDoc && state.currentDoc.path === docPath && state.currentDoc.meta.links) || [];
  if (!links.length) {
    ref.innerHTML = `<div class="empty-note">이 문서에 연결된(links) 참고 문서가 없습니다.</div>`;
  } else {
    const parts = [];
    for (const id of links) {
      const node = state.idIndex[id];
      if (!node) { parts.push(`<div class="empty-note">${id} (문서를 찾을 수 없음)</div>`); continue; }
      try {
        const linked = await api("/api/doc?path=" + encodeURIComponent(node.path));
        parts.push(
          `<details><summary>${id} · ${linked.meta.title || node.path}</summary>` +
          `<div class="doc-body">${renderMarkdown(linked.body)}</div></details>`
        );
      } catch (e) {
        parts.push(`<div class="empty-note">${id} 불러오기 실패</div>`);
      }
    }
    ref.innerHTML = parts.join("");
  }

  // Quick-answer: DC/RV/FX authored with "- 권장: ..." / "- 대안: ..." lines
  // under the question show up here as one-click fills - the designer can
  // still edit before submitting, this just saves retyping the option text.
  const optBox = document.getElementById("reply-options");
  optBox.innerHTML = "";
  optBox.hidden = !options || !options.length;
  for (const o of options || []) {
    optBox.appendChild(el("button", {
      type: "button",
      class: "reply-option-btn" + (o.kind === "권장" ? " recommended" : ""),
      onclick: () => { answerBox.value = o.text; answerBox.focus(); },
    }, `${o.kind}: ${o.text}`));
  }

  document.getElementById("reply-dialog").showModal();
}

function initReplyDialog() {
  const dialog = document.getElementById("reply-dialog");
  document.getElementById("reply-cancel").addEventListener("click", () => dialog.close());
  document.getElementById("reply-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const answer = document.getElementById("reply-answer").value.trim();
    if (!answer || !pendingReply) return;
    try {
      await api("/api/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doc_path: pendingReply.docPath,
          question_id: pendingReply.qid,
          answer,
        }),
      });
      dialog.close();
      await loadTree();
      await openDoc(pendingReply.docPath);
    } catch (e) {
      alert("답변 처리 실패: " + e.message);
    }
  });
}

// ---------------------------------------------------------------- init

document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
initReplyDialog();
initSearch();
loadTree();
setTab("all");
loadChangeBanner();
