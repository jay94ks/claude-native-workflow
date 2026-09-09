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

function renderTreeNode(node, isRoot) {
  const wrap = document.createElement("div");
  if (node.type === "dir") {
    if (!isRoot) wrap.appendChild(el("div", { class: "tree-dir" }, node.name));
    const kids = el("div", { class: isRoot ? "" : "tree-children" });
    for (const c of node.children) kids.appendChild(renderTreeNode(c, false));
    wrap.appendChild(kids);
  } else {
    const label = node.title ? `${node.id} · ${node.title}` : node.name;
    wrap.appendChild(el("div", {
      class: "tree-file", title: label,
      onclick: () => openDoc(node.path),
    }, label));
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
    el("span", { class: "badge" }, meta.status || ""),
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
      section.appendChild(el("div", { class: "pending-card" }, [
        el("div", { class: "q" }, `(Q${p.qid}) ${p.text}`),
        el("button", { onclick: () => openReplyDialog(doc.path, p.qid, p.text) }, "답변 입력"),
      ]));
    }
    pane.appendChild(section);
  }

  if (DESIGN_TYPES.has(meta.type)) {
    pane.appendChild(el("div", { class: "howto-section" }, [
      el("h4", {}, "답변 입력 후 처리 요령"),
      el("ol", {}, [
        el("li", {}, "답변을 제출하면 RP-XXXXX 번호가 발급되고, docs/reply/RP-XXXXX.md에 질문·답변 전문이 저장됩니다."),
        el("li", {}, "이 문서의 해당 (Qn) 줄이 체크되고 RP 링크가 남습니다 (전문은 중복 저장하지 않음)."),
        el("li", {}, "docs/reply/index.md 미답변 큐에서 이 항목이 제거됩니다."),
        el("li", {}, "docs/logs/에 처리 기록(LG)이 생성되고 이 문서·RP에 연결됩니다."),
        el("li", {}, "이 문서의 모든 질문에 답변되면 상태가 answered로 바뀝니다."),
      ]),
    ]));
  }
}

function scanPending(body) {
  const out = [];
  const re = /^- \[ \] \(Q(\d+)\) (.+)$/gm;
  let m;
  while ((m = re.exec(body))) out.push({ qid: m[1], text: m[2] });
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

function openReplyDialog(docPath, qid, text) {
  pendingReply = { docPath, qid };
  document.getElementById("reply-question").textContent = `(Q${qid}) ${text}`;
  document.getElementById("reply-answer").value = "";
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
loadTree();
setTab("all");
