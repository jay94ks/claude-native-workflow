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
import os
import re
import sqlite3
import subprocess
import sys
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


def _is_inside(p: Path, base: Path) -> bool:
    """p가 base 안에 있는지 검사한다. QA로 발견: 기존 코드는 전부
    str(p).startswith(str(base))라는 단순 문자열 접두사 비교였는데, 이건
    경로 구분자 경계를 안 본다 - 예를 들어 base가 ".../docs"면
    ".../docs-backup"도 접두사가 같다는 이유로 통과해버린다(TypeScript
    쪽 isInsideDocs()는 이미 `resolved === base ||
    resolved.startsWith(base + path.sep)`로 구분자 경계를 보고 있었는데,
    여기 Python만 그 검사가 빠져 있었다). base와 정확히 같거나, base +
    구분자로 시작할 때만 안쪽으로 인정한다."""
    base_str = str(base.resolve())
    p_str = str(p)
    return p_str == base_str or p_str.startswith(base_str + os.sep)


def resolve_in_docs_or_raise(rel_path: str) -> Path:
    """docs/ 밖 경로 접근을 막는 /api/doc 등과 같은 경계를 git 이력류
    함수에도 강제한다 - git_log/git_blame이 이 검사 없이 rel_path를 그대로
    docs_dir()에 이어붙이고 있어서 `?path=../../SECRET.txt`처럼 같은 git
    저장소 안의 docs/ 밖 파일 내용을 그대로 읽어올 수 있는 걸 실제로
    재현해서 발견한 경로 순회 취약점 - QA 중 tier2(TypeScript) 쪽에서
    먼저 찾아 고치고, 같은 문제가 여기 Python 구현에도 그대로 있다는 걸
    확인해서 대칭으로 고침."""
    p = (docs_dir() / rel_path).resolve()
    if not _is_inside(p, docs_dir()):
        raise ValueError(f"docs/ 밖 경로입니다: {rel_path}")
    return p


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
_META_CACHE = {}  # rel_path -> (mtime, meta, pending_list, size)


def scan_meta(path: Path, source="scan"):
    """(meta, pending_list) for path, via the mtime+size checked in-memory
    cache (SP-00003 6.2). Unchanged files cost one stat() call, no read.
    When a file actually changed since we last saw it (not a cold start),
    records a change_notice - this is the single place that happens, so
    every caller (tree/list/search, and eventually git-pull/webhook/api
    handlers once those exist) gets it for free."""
    rel_path = rel(path)
    st = path.stat()
    with _META_CACHE_LOCK:
        cached = _META_CACHE.get(rel_path)
        if cached and cached[0] == st.st_mtime and cached[3] == st.st_size:
            return cached[1], cached[2]
        was_cached = cached is not None

    _, meta, body = read_doc(path)
    pending = scan_pending_in_text(body)
    with _META_CACHE_LOCK:
        _META_CACHE[rel_path] = (st.st_mtime, meta, pending, st.st_size)

    if was_cached:
        create_change_notice(rel_path, source, git_diff_summary(rel_path))

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
                meta, _ = scan_meta(entry)
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


OPTION_RE = re.compile(r"^\s+- (권장|대안): (.+)$")


def scan_pending_in_text(body):
    """[(qid, question, options)] - options is [{"kind": "권장"|"대안", "text": ...}],
    read from indented `- 권장: ...` / `- 대안: ...` lines directly under a
    `- [ ] (Qn) ...` line (docs/PROTOCOL.md 4절). Optional - most questions
    have none."""
    lines = body.split("\n")
    out = []
    i = 0
    while i < len(lines):
        m = re.match(r"^- \[ \] \(Q(\d+)\) (.+)$", lines[i])
        if not m:
            i += 1
            continue
        qid, question = m.group(1), m.group(2)
        options = []
        j = i + 1
        while j < len(lines):
            om = OPTION_RE.match(lines[j])
            if not om:
                break
            options.append({"kind": om.group(1), "text": om.group(2)})
            j += 1
        out.append((qid, question, options))
        i = j
    return out


def list_pending():
    items = []
    for p in iter_doc_files():
        meta, pending = scan_meta(p)
        for qid, question, options in pending:
            items.append({
                "doc_path": rel(p),
                "doc_id": meta.get("id", p.stem),
                "title": meta.get("title", ""),
                "question_id": qid,
                "question": question,
                "options": options,
                "updated": meta.get("updated", meta.get("created", "")),
            })
    return items


def list_by_types(types):
    out = []
    for p in iter_doc_files():
        meta, _ = scan_meta(p)
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


# ---------------------------------------------------------------- local data store
#
# change_notices (SP-00003 5절) and doc_comments (SP-00003 2절/코멘트) are not
# derived from docs/*.md - they're real data with no markdown-file source of
# truth, so (unlike the meta cache above) they live in a small SQLite file
# instead of memory. docs/.workflow/ is gitignored; this file never gets
# committed.

_DATA_LOCK = threading.Lock()


def _data_db_path():
    d = docs_dir() / ".workflow"
    d.mkdir(exist_ok=True)
    return d / "data.db"


def _data_conn():
    conn = sqlite3.connect(str(_data_db_path()))
    conn.execute(
        "CREATE TABLE IF NOT EXISTS change_notices ("
        " id INTEGER PRIMARY KEY AUTOINCREMENT, doc_path TEXT NOT NULL,"
        " source TEXT NOT NULL, summary TEXT NOT NULL, ref TEXT, created_at TEXT NOT NULL)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS doc_comments ("
        " id INTEGER PRIMARY KEY AUTOINCREMENT, doc_path TEXT NOT NULL,"
        " body TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT)"
    )
    return conn


def _now():
    return datetime.datetime.now().isoformat(timespec="seconds")


def create_change_notice(doc_path, source, summary, ref=None):
    with _DATA_LOCK:
        conn = _data_conn()
        try:
            conn.execute(
                "INSERT INTO change_notices (doc_path, source, summary, ref, created_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (doc_path, source, summary, ref, _now()),
            )
            conn.commit()
        finally:
            conn.close()


def list_change_notices():
    with _DATA_LOCK:
        conn = _data_conn()
        try:
            rows = conn.execute(
                "SELECT id, doc_path, source, summary, ref, created_at"
                " FROM change_notices ORDER BY id"
            ).fetchall()
        finally:
            conn.close()
    return [
        {"id": r[0], "doc_path": r[1], "source": r[2], "summary": r[3], "ref": r[4], "created_at": r[5]}
        for r in rows
    ]


def ack_change_notice(notice_id):
    with _DATA_LOCK:
        conn = _data_conn()
        try:
            conn.execute("DELETE FROM change_notices WHERE id = ?", (notice_id,))
            conn.commit()
        finally:
            conn.close()


def list_comments(doc_path):
    with _DATA_LOCK:
        conn = _data_conn()
        try:
            rows = conn.execute(
                "SELECT id, body, created_at, resolved_at FROM doc_comments"
                " WHERE doc_path = ? ORDER BY id",
                (doc_path,),
            ).fetchall()
        finally:
            conn.close()
    return [{"id": r[0], "body": r[1], "created_at": r[2], "resolved_at": r[3]} for r in rows]


def add_comment(doc_path, body):
    with _DATA_LOCK:
        conn = _data_conn()
        try:
            cur = conn.execute(
                "INSERT INTO doc_comments (doc_path, body, created_at) VALUES (?, ?, ?)",
                (doc_path, body, _now()),
            )
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()


def resolve_comment(doc_path, comment_id):
    with _DATA_LOCK:
        conn = _data_conn()
        try:
            conn.execute(
                "UPDATE doc_comments SET resolved_at = ? WHERE id = ? AND doc_path = ?",
                (_now(), comment_id, doc_path),
            )
            conn.commit()
        finally:
            conn.close()


# ---------------------------------------------------------------- git (subprocess)
#
# docs/*.md is a git-tracked directory. We shell out to the git binary rather
# than reimplementing diffing/history ourselves (SP-00003 6.2) - it's already
# there, already correct, already fast.

def _git(args, cwd=None, timeout=10):
    try:
        # encoding="utf-8" is required, not just text=True: on Windows,
        # text=True decodes subprocess output with the OS locale encoding
        # (e.g. cp949 on Korean Windows), which crashes on the UTF-8 bytes
        # git actually writes for any non-ASCII commit message/diff content.
        return subprocess.run(
            ["git", *args], cwd=cwd or str(project_root()),
            capture_output=True, encoding="utf-8", errors="replace", timeout=timeout,
        )
    except Exception as e:
        class _Fail:
            returncode = 1
            stdout = ""
            stderr = str(e)
        return _Fail()


def git_diff_summary(rel_path):
    target = str(docs_dir() / rel_path)
    out = _git(["diff", "--stat", "--", target])
    if out.returncode == 0 and out.stdout.strip():
        return out.stdout.strip().splitlines()[0]
    out = _git(["diff", "--cached", "--stat", "--", target])
    if out.returncode == 0 and out.stdout.strip():
        return out.stdout.strip().splitlines()[0]
    return f"{rel_path} 내용이 변경됨"


def git_log(rel_path=None, limit=30):
    args = ["log", f"-{int(limit)}", "--pretty=format:%H|%an|%ad|%s", "--date=short"]
    if rel_path:
        args += ["--", str(resolve_in_docs_or_raise(rel_path))]
    out = _git(args)
    commits = []
    for line in out.stdout.splitlines():
        parts = line.split("|", 3)
        if len(parts) == 4:
            commits.append({"sha": parts[0], "author": parts[1], "date": parts[2], "message": parts[3]})
    return commits


_SHA_RE = re.compile(r"^[0-9a-f]{4,40}$", re.IGNORECASE)


def _assert_valid_sha(sha):
    # QA로 발견: sha를 검증 없이 `git show`의 argv 원소로 그대로 넘기면, git은
    # "-"로 시작하는 값을 리비전이 아니라 옵션으로 해석한다 - 예를 들어
    # "--output=/tmp/pwned.txt"를 sha로 보내면 결과가 서버 파일시스템의 임의
    # 경로에 그대로 쓰인다(뒤에 "-- docs"가 있어도 그 앞의 옵션이 먼저 파싱돼
    # 막아주지 못함). 정상 sha는 항상 git_log()가 돌려준 16진수 문자열뿐이라,
    # 그 형태가 아니면 아예 git에 넘기지 않는다. tier2/backend의
    # assertValidSha()와 동일한 검사.
    if not _SHA_RE.match(sha or ""):
        return None
    return sha


def git_commit_detail(sha):
    sha = _assert_valid_sha(sha)
    if sha is None:
        return None
    # git_diff와 같은 이유로 "-- docs"를 붙인다 - 안 붙이면 그 커밋이 docs/
    # 밖 파일도 같이 바꿨을 때 그 파일명까지 "변경된 파일" 목록에 새어나간다.
    out = _git(["show", "--stat", "--pretty=format:%H|%an|%ad|%s", "--date=iso", sha, "--", "docs"])
    lines = out.stdout.splitlines()
    if not lines:
        return None
    parts = lines[0].split("|", 3)
    files = [l.strip() for l in lines[1:] if l.strip() and "|" in l]
    return {
        "sha": parts[0] if len(parts) > 0 else sha,
        "author": parts[1] if len(parts) > 1 else "",
        "date": parts[2] if len(parts) > 2 else "",
        "message": parts[3] if len(parts) > 3 else "",
        "files": files,
    }


def git_diff(sha):
    sha = _assert_valid_sha(sha)
    if sha is None:
        return ""
    out = _git(["show", sha, "--", "docs"])
    return out.stdout


def git_blame(rel_path):
    out = _git(["blame", "--date=short", "--", str(resolve_in_docs_or_raise(rel_path))])
    return out.stdout


# ---------------------------------------------------------------- section read / search

def slugify(text):
    s = text.strip().lower()
    s = re.sub(r"[`~!@#$%^&*()+=\[\]{}|\\:;\"'<>,.?/]", "", s)
    s = re.sub(r"\s+", "-", s)
    return s


def extract_section(body, anchor):
    lines = body.split("\n")
    heading_re = re.compile(r"^(#{1,6})\s+(.*)$")
    start, start_level = None, None
    for i, line in enumerate(lines):
        m = heading_re.match(line)
        if m and slugify(m.group(2)) == anchor:
            start, start_level = i, len(m.group(1))
            break
    if start is None:
        return None
    end = len(lines)
    for j in range(start + 1, len(lines)):
        m = heading_re.match(lines[j])
        if m and len(m.group(1)) <= start_level:
            end = j
            break
    return "\n".join(lines[start:end]).rstrip("\n")


def search_docs(query):
    q = (query or "").strip().lower()
    if not q:
        return []
    results = []
    for p in iter_doc_files():
        _, meta, body = read_doc(p)
        haystack = f"{meta.get('id', '')} {meta.get('title', '')}\n{body}".lower()
        idx = haystack.find(q)
        if idx == -1:
            continue
        start = max(0, idx - 40)
        snippet = haystack[start:idx + len(q) + 40].strip()
        results.append({
            "path": rel(p), "id": meta.get("id", p.stem), "title": meta.get("title", ""),
            "type": meta.get("type", ""), "snippet": snippet,
        })
    return results


# ---------------------------------------------------------------- structure validation
#
# SP-00003 7절: hand-coded rules mirroring docs/PROTOCOL.md 3절. A full
# schemas/*.schema.json + cross-tier conformance suite is future work for
# when Tier 2/3 exist to drift against - not needed yet with one implementation.

STATUS_ENUM = {
    "SP": {"draft", "active", "superseded", "archived"},
    "DS": {"draft", "active", "superseded", "archived"},
    "RM": {"draft", "active", "superseded", "archived"},
    "TP": {"draft", "active", "superseded", "archived"},
    "PL": {"planned", "in_progress", "done"},
    "DC": {"open", "answered", "applied", "rejected", "wontfix"},
    "RV": {"open", "answered", "applied", "rejected", "wontfix"},
    "FX": {"open", "answered", "applied", "rejected", "wontfix"},
}
ID_RE = re.compile(r"^[A-Z]{2}-\d{5}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def validate_doc(path, meta):
    violations = []

    def add(field, rule, message):
        violations.append({"path": rel(path), "field": field, "rule": rule, "message": message})

    doc_id = meta.get("id")
    if not doc_id:
        add("id", "required", "id 필드가 없습니다")
    else:
        if not ID_RE.match(str(doc_id)):
            add("id", "pattern", f"id 형식이 TYPE-00000이 아닙니다: {doc_id}")
        if doc_id != path.stem:
            add("id", "consistency", f"id({doc_id})가 파일명({path.stem})과 다릅니다")

    if not meta.get("type"):
        add("type", "required", "type 필드가 없습니다")

    for field in ("created", "updated"):
        val = meta.get(field)
        if not val:
            add(field, "required", f"{field} 필드가 없습니다")
        elif not DATE_RE.match(str(val)):
            add(field, "pattern", f"{field} 값이 YYYY-MM-DD 형식이 아닙니다: {val}")

    doc_type = meta.get("type")
    if doc_type in STATUS_ENUM:
        status = meta.get("status")
        if not status:
            add("status", "required", "status 필드가 없습니다")
        elif status not in STATUS_ENUM[doc_type]:
            add("status", "enum", f"status 값 '{status}'는 {doc_type} 타입에서 허용되지 않습니다")

    links = meta.get("links")
    if links is not None:
        if not isinstance(links, list):
            add("links", "type", "links는 배열이어야 합니다")
        else:
            for link in links:
                if not ID_RE.match(str(link)):
                    add("links", "pattern", f"links 항목 형식이 잘못됨: {link}")

    return violations


def validate_all():
    violations = []
    for p in iter_doc_files():
        _, meta, _ = read_doc(p)
        violations.extend(validate_doc(p, meta))
    return violations


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
    if not _is_inside(doc_path, docs_dir()) or not doc_path.exists():
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


def save_doc_body(doc_path_rel, new_body):
    """Overwrite a document's body from the dashboard's markdown editor.
    Frontmatter is untouched except `updated` - this is a body-content edit,
    not a metadata change (status/links/etc. still only change through the
    controlled flows: answer_pending, or Claude directly). Runs the same
    structure check as `docs validate` before writing, so a broken edit
    can't corrupt the file's frontmatter contract."""
    doc_path = (docs_dir() / doc_path_rel).resolve()
    if not _is_inside(doc_path, docs_dir()) or not doc_path.exists():
        raise FileNotFoundError(doc_path_rel)

    _, meta, _ = read_doc(doc_path)
    meta["updated"] = today()
    violations = validate_doc(doc_path, meta)
    if violations:
        raise ValueError("검증 실패: " + "; ".join(v["message"] for v in violations))

    doc_path.write_text(dump_frontmatter(meta, new_body), encoding="utf-8")
    return {"path": doc_path_rel, "updated": meta["updated"]}


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
            if parsed.path == "/api/changes":
                return self._json(list_change_notices())
            if parsed.path == "/api/validate":
                return self._json(validate_all())
            if parsed.path == "/api/search":
                return self._json(search_docs(qs.get("q", [""])[0]))
            if parsed.path == "/api/git/log":
                rel_path = qs.get("path", [None])[0]
                limit = int(qs.get("limit", ["30"])[0])
                return self._json(git_log(rel_path, limit))
            if parsed.path == "/api/git/blame":
                rel_path = qs.get("path", [""])[0]
                return self._text(git_blame(rel_path))
            m = re.match(r"^/api/git/commits/(.+)$", parsed.path)
            if m:
                detail = git_commit_detail(m.group(1))
                if detail is None:
                    return self._json({"error": "not found"}, 404)
                return self._json(detail)
            m = re.match(r"^/api/git/diff/(.+)$", parsed.path)
            if m:
                return self._text(git_diff(m.group(1)))
            m = re.match(r"^/api/docs/(.+)/comments$", parsed.path)
            if m:
                return self._json(list_comments(m.group(1)))
            if parsed.path == "/api/doc":
                rel_path = qs.get("path", [""])[0]
                anchor = qs.get("anchor", [None])[0]
                p = (docs_dir() / rel_path).resolve()
                if not _is_inside(p, docs_dir()) or not p.exists():
                    return self._json({"error": "not found"}, 404)
                text, meta, body = read_doc(p)
                if anchor:
                    section = extract_section(body, anchor)
                    if section is None:
                        return self._json({"error": "anchor not found"}, 404)
                    return self._json({"path": rel_path, "meta": meta, "body": section, "anchor": anchor})
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
            if parsed.path == "/api/doc/save":
                result = save_doc_body(payload["path"], payload["body"])
                return self._json(result)
            m = re.match(r"^/api/changes/(\d+)/ack$", parsed.path)
            if m:
                ack_change_notice(int(m.group(1)))
                return self._json({"ok": True})
            m = re.match(r"^/api/docs/(.+)/comments/(\d+)/resolve$", parsed.path)
            if m:
                resolve_comment(m.group(1), int(m.group(2)))
                return self._json({"ok": True})
            m = re.match(r"^/api/docs/(.+)/comments$", parsed.path)
            if m:
                cid = add_comment(m.group(1), payload["body"])
                return self._json({"id": cid})
            return self._json({"error": "not found"}, 404)
        except Exception as e:
            return self._json({"error": str(e)}, 400)

    def _serve_static(self, path):
        if path == "/":
            path = "/index.html"
        safe = path.lstrip("/")
        p = (STATIC_DIR / safe).resolve()
        if not _is_inside(p, STATIC_DIR) or not p.exists():
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
    parser.add_argument("--validate", action="store_true",
                         help="check docs/ structure (SP-00003 7절) and exit, no server")
    ARGS = parser.parse_args()

    if ARGS.validate:
        violations = validate_all()
        if not violations:
            print("모든 문서가 유효합니다.")
            return
        for v in violations:
            print(f"{v['path']}: [{v['rule']}] {v['field']} - {v['message']}")
        sys.exit(1)

    server = ThreadingHTTPServer(("127.0.0.1", ARGS.port), Handler)
    print(f"docs dashboard: http://127.0.0.1:{ARGS.port}  (root: {project_root()})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
