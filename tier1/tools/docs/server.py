#!/usr/bin/env python3
"""tools/docs dashboard - zero-dependency local tool for the docs/ design workflow.

Designer-only tool, not part of the project deliverable. Serves a small SPA
that browses docs/ and lets the designer answer pending questions raised in
DC/RV/FX documents.

Run:
    python tools/docs/server.py [--port 8756] [--root <project-root>]
"""
import argparse
import datetime
import json
import re
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

TYPE_NAMES = {
    "IX": "최상위 색인", "SP": "설계 명세", "PL": "실행 계획", "DN": "결과 보고",
    "DS": "설계", "RM": "기억 지시", "TP": "임시 문서", "DC": "결정 요청",
    "RV": "검토 요청", "FX": "수정 검토", "LG": "처리 기록", "RP": "답변 항목",
}
DESIGN_TYPES = {"DC", "RV", "FX"}
PENDING_RE = re.compile(r"^- \[ \] \(Q(\d+)\) (.+)$", re.MULTILINE)

STATIC_DIR = Path(__file__).parent / "static"
ARGS = None


# ---------------------------------------------------------------- frontmatter

def parse_frontmatter(text):
    if not text.startswith("---"):
        return {}, text
    lines = text.split("\n")
    if lines[0].strip() != "---":
        return {}, text
    end_idx = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end_idx = i
            break
    if end_idx is None:
        return {}, text
    fm_lines = lines[1:end_idx]
    body = "\n".join(lines[end_idx + 1:])
    if body.startswith("\n"):
        body = body[1:]

    meta = {}
    i = 0
    while i < len(fm_lines):
        line = fm_lines[i]
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            i += 1
            continue
        if ":" not in line:
            i += 1
            continue
        key, _, val = line.partition(":")
        key = key.strip()
        val = val.strip()
        if val in ("|", "|-"):
            block = []
            i += 1
            base_indent = None
            while i < len(fm_lines):
                l = fm_lines[i]
                if l.strip() == "":
                    block.append("")
                    i += 1
                    continue
                indent = len(l) - len(l.lstrip(" "))
                if base_indent is None:
                    base_indent = indent
                if indent < base_indent:
                    break
                block.append(l[base_indent:])
                i += 1
            meta[key] = "\n".join(block).rstrip("\n")
            continue
        elif val.startswith("[") and val.endswith("]"):
            meta[key] = [v.strip() for v in val[1:-1].split(",") if v.strip()]
        elif val.lower() in ("true", "false"):
            meta[key] = val.lower() == "true"
        elif len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
            meta[key] = val[1:-1]
        else:
            meta[key] = val
        i += 1
    return meta, body


def dump_frontmatter(meta, body):
    lines = ["---"]
    for k, v in meta.items():
        if isinstance(v, list):
            lines.append(f"{k}: [{', '.join(str(x) for x in v)}]")
        elif isinstance(v, bool):
            lines.append(f"{k}: {'true' if v else 'false'}")
        elif isinstance(v, str) and "\n" in v:
            lines.append(f"{k}: |")
            for l in v.split("\n"):
                lines.append(f"  {l}")
        else:
            lines.append(f"{k}: {v}")
    lines.append("---")
    return "\n".join(lines) + "\n" + body


# ---------------------------------------------------------------- docs scan

def project_root():
    return Path(ARGS.root).resolve()


def docs_dir():
    return project_root() / "docs"


def rel(path: Path):
    return str(path.relative_to(docs_dir())).replace("\\", "/")


def iter_doc_files():
    d = docs_dir()
    if not d.exists():
        return
    for p in sorted(d.rglob("*.md")):
        if p.stem == "index" or p.name == "PROTOCOL.md":
            continue
        yield p


def read_doc(path: Path):
    text = path.read_text(encoding="utf-8")
    meta, body = parse_frontmatter(text)
    return text, meta, body


# ---------------------------------------------------------------- meta cache
#
# Every list/tree endpoint used to open + parse every *.md file on every
# request. That's fine for a handful of docs but gets visibly slow as a
# project accumulates hundreds of them (each is a full file read + regex
# parse on every request, even when nothing changed since the last one).
# The server is a long-running process (ThreadingHTTPServer), so a plain
# in-memory dict keyed by mtime is enough - no need for a cache file on
# disk. A file is only re-read/re-parsed when its mtime no longer matches
# what we last saw; everything here is derived from docs/*.md, so losing
# the cache on restart just costs one full (still fast) rescan.

_META_CACHE_LOCK = threading.Lock()
_META_CACHE = {}  # rel_path -> (mtime, meta, pending_list)


def get_doc_meta(path: Path):
    """(meta, pending_list) for path, via the mtime-checked in-memory cache."""
    rel_path = rel(path)
    mtime = path.stat().st_mtime
    with _META_CACHE_LOCK:
        cached = _META_CACHE.get(rel_path)
        if cached and cached[0] == mtime:
            return cached[1], cached[2]
    _, meta, body = read_doc(path)
    pending = scan_pending_in_text(body)
    with _META_CACHE_LOCK:
        _META_CACHE[rel_path] = (mtime, meta, pending)
    return meta, pending


def build_tree():
    d = docs_dir()

    def walk(dir_path):
        node = {"name": dir_path.name, "type": "dir", "children": []}
        try:
            entries = sorted(dir_path.iterdir(), key=lambda p: (p.is_file(), p.name))
        except FileNotFoundError:
            return node
        for entry in entries:
            if entry.name.startswith("."):
                continue
            if entry.is_dir():
                node["children"].append(walk(entry))
            elif entry.suffix == ".md":
                meta, _ = get_doc_meta(entry)
                node["children"].append({
                    "name": entry.name,
                    "type": "file",
                    "path": rel(entry),
                    "id": meta.get("id", entry.stem),
                    "title": meta.get("title", ""),
                    "doc_type": meta.get("type", ""),
                    "status": meta.get("status", ""),
                })
        return node

    return walk(d)


def scan_pending_in_text(body):
    return [(m.group(1), m.group(2)) for m in PENDING_RE.finditer(body)]


def list_pending():
    items = []
    for p in iter_doc_files():
        meta, pending = get_doc_meta(p)
        for qid, question in pending:
            items.append({
                "doc_path": rel(p),
                "doc_id": meta.get("id", p.stem),
                "title": meta.get("title", ""),
                "question_id": qid,
                "question": question,
                "updated": meta.get("updated", meta.get("created", "")),
            })
    return items


def list_by_types(types):
    out = []
    for p in iter_doc_files():
        meta, _ = get_doc_meta(p)
        t = meta.get("type", "")
        if t in types:
            out.append({
                "path": rel(p),
                "id": meta.get("id", p.stem),
                "title": meta.get("title", ""),
                "type": t,
                "status": meta.get("status", ""),
                "updated": meta.get("updated", ""),
                "reply_pending": bool(meta.get("reply_pending", False)),
                "target": meta.get("target", ""),
                "rp": meta.get("rp", ""),
            })
    out.sort(key=lambda x: x["updated"], reverse=True)
    return out


def today():
    return datetime.date.today().isoformat()


def next_seq(doc_type):
    tf = docs_dir() / ".tracking.json"
    data = json.loads(tf.read_text(encoding="utf-8")) if tf.exists() else {}
    n = data.get(doc_type, 0) + 1
    data[doc_type] = n
    tf.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return f"{doc_type}-{n:05d}"


def rebuild_table(index_path: Path, rows, header):
    text = index_path.read_text(encoding="utf-8")
    lines = [header[0], header[1]]
    lines.extend(rows if rows else ["| _(항목 없음)_ | | | |"])
    table_md = "\n".join(lines)
    new_text = re.sub(
        r"(<!-- TABLE:START -->\n)(.*?)(\n<!-- TABLE:END -->)",
        lambda m: m.group(1) + table_md + m.group(3),
        text, flags=re.DOTALL,
    )
    index_path.write_text(new_text, encoding="utf-8")


def rebuild_reply_index():
    rows = [
        f"| [{it['doc_id']}](../{it['doc_path']}) | Q{it['question_id']} | {it['question']} | {it['updated']} |"
        for it in list_pending()
    ]
    rebuild_table(
        docs_dir() / "reply" / "index.md", rows,
        ("| 대상 문서 | 질문 ID | 질문 요약 | 등록일 |", "|---|---|---|---|"),
    )


def rebuild_logs_index():
    rows = []
    logs_dir = docs_dir() / "logs"
    if logs_dir.exists():
        for p in sorted(logs_dir.glob("LG-*.md")):
            _, meta, _ = read_doc(p)
            qids = ", ".join(meta.get("question_ids", []) or [])
            rows.append(
                f"| [{meta.get('id', p.stem)}]({p.name}) | {meta.get('target', '')} | "
                f"{qids} | {meta.get('updated', meta.get('created', ''))} |"
            )
    rebuild_table(
        docs_dir() / "logs" / "index.md", rows,
        ("| 번호 | 대상 문서 | 답변된 질문 | 최근 처리일 |", "|---|---|---|---|"),
    )


def find_lg_by_target(doc_id):
    """Find the LG file (one per target document) whose `target` matches
    doc_id, if any exists yet."""
    folder = docs_dir() / "logs"
    if not folder.exists():
        return None, None, None
    for p in sorted(folder.glob("LG-*.md")):
        text, meta, body = read_doc(p)
        if meta.get("target") == doc_id:
            return p, meta, body
    return None, None, None


def answer_pending(doc_path_rel, question_id, answer_text):
    """Answer one (Qn) item of a DC/RV/FX document.

    RP is not a separate file: the answer is recorded as a `### RP-XXXXX`
    entry inside the target document's own "## 답변 기록" section, so
    answering N questions on one document never creates more than that one
    file (avoids the RP-per-question / RP-per-document file pile-up).
    RP-XXXXX itself becomes an in-page anchor (`#rp-00001`) rather than a
    filename. LG stays one file per target document (a log entry per answer),
    linking to that anchor instead of a separate RP file.
    """
    doc_path = (docs_dir() / doc_path_rel).resolve()
    if not str(doc_path).startswith(str(docs_dir().resolve())) or not doc_path.exists():
        raise FileNotFoundError(doc_path_rel)

    _, meta, body = read_doc(doc_path)
    pattern = re.compile(r"^- \[ \] \(Q" + re.escape(question_id) + r"\) (.+)$", re.MULTILINE)
    m = pattern.search(body)
    if not m:
        raise ValueError("질문을 찾을 수 없거나 이미 답변되었습니다")
    question_text = m.group(1)

    doc_id = meta.get("id", doc_path.stem)
    q_tag = f"Q{question_id}"

    rp_id = next_seq("RP")
    rp_anchor = rp_id.lower()  # "RP-00001" -> "rp-00001", matches the GitHub-style slug the dashboard's renderer gives the "### RP-00001" heading below.

    new_line = f"- [x] (Q{question_id}) {question_text} → [{rp_id}](#{rp_anchor})"
    new_body = body[:m.start()] + new_line + body[m.end():]

    remaining = bool(PENDING_RE.search(new_body))

    record = (
        f"\n### {rp_id}\n\n"
        f"- 질문 ID: {q_tag}\n"
        f"- 답변일: {today()}\n\n"
        f"**질문**\n\n{question_text}\n\n"
        f"**답변**\n\n{answer_text}\n"
    )
    if "## 답변 기록" not in new_body:
        new_body = new_body.rstrip("\n") + "\n\n## 답변 기록\n" + record
    else:
        new_body = new_body.rstrip("\n") + "\n" + record

    meta["reply_pending"] = remaining
    meta["updated"] = today()
    if not remaining and meta.get("status") == "open":
        meta["status"] = "answered"
    doc_path.write_text(dump_frontmatter(meta, new_body), encoding="utf-8")

    # one LG file per target document: find it, or mint a new number.
    lg_path, lg_meta, lg_body = find_lg_by_target(doc_id)
    if lg_path is None:
        lg_id = next_seq("LG")
        lg_path = docs_dir() / "logs" / f"{lg_id}.md"
        lg_meta = {
            "id": lg_id, "type": "LG", "target": doc_id,
            "question_ids": [], "created": today(), "updated": today(),
        }
        lg_body = f"# {lg_id}\n\n- 대상 문서: [{doc_id}](../{doc_path_rel})\n"
    else:
        lg_id = lg_meta["id"]
        lg_meta.setdefault("question_ids", [])

    if q_tag not in lg_meta["question_ids"]:
        lg_meta["question_ids"].append(q_tag)
    lg_meta["updated"] = today()
    lg_body += (
        f"- 처리 내용: `{doc_path_rel}`의 ({q_tag}) 항목에 답변 반영 → "
        f"[{rp_id}](../{doc_path_rel}#{rp_anchor}), 상태 갱신.\n"
    )
    lg_path.write_text(dump_frontmatter(lg_meta, lg_body), encoding="utf-8")

    rebuild_reply_index()
    rebuild_logs_index()
    return {"rp_id": rp_id, "lg_id": lg_id, "reply_pending": remaining}


# ---------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *a):
        pass

    def _json(self, obj, status=200):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _text(self, text, status=200, ctype="text/plain; charset=utf-8"):
        data = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        try:
            if parsed.path == "/api/tree":
                return self._json(build_tree())
            if parsed.path == "/api/pending":
                return self._json(list_pending())
            if parsed.path == "/api/design":
                return self._json(list_by_types(DESIGN_TYPES))
            if parsed.path == "/api/logs":
                return self._json(list_by_types({"LG"}))
            if parsed.path == "/api/all":
                return self._json(list_by_types(set(TYPE_NAMES) - {"IX"}))
            if parsed.path == "/api/doc":
                rel_path = qs.get("path", [""])[0]
                p = (docs_dir() / rel_path).resolve()
                if not str(p).startswith(str(docs_dir().resolve())) or not p.exists():
                    return self._json({"error": "not found"}, 404)
                text, meta, body = read_doc(p)
                return self._json({"path": rel_path, "meta": meta, "body": body})
            return self._serve_static(parsed.path)
        except Exception as e:
            return self._json({"error": str(e)}, 500)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:
            return self._json({"error": "invalid json"}, 400)
        try:
            if parsed.path == "/api/reply":
                result = answer_pending(
                    payload["doc_path"], str(payload["question_id"]), payload["answer"])
                return self._json(result)
            return self._json({"error": "not found"}, 404)
        except Exception as e:
            return self._json({"error": str(e)}, 400)

    def _serve_static(self, path):
        if path == "/":
            path = "/index.html"
        safe = path.lstrip("/")
        p = (STATIC_DIR / safe).resolve()
        if not str(p).startswith(str(STATIC_DIR.resolve())) or not p.exists():
            return self._json({"error": "not found"}, 404)
        ctype = "text/html; charset=utf-8"
        if p.suffix == ".js":
            ctype = "application/javascript; charset=utf-8"
        elif p.suffix == ".css":
            ctype = "text/css; charset=utf-8"
        return self._text(p.read_text(encoding="utf-8"), 200, ctype)


def main():
    global ARGS
    parser = argparse.ArgumentParser(description="docs/ design-workflow dashboard")
    parser.add_argument("--port", type=int, default=8756)
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[2]))
    ARGS = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", ARGS.port), Handler)
    print(f"docs dashboard: http://127.0.0.1:{ARGS.port}  (root: {project_root()})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
