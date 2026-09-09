#!/usr/bin/env python3
"""Assemble bootstrap-prompt.md from the tier1/ reference files.

Not part of the deliverable prompt itself - a dev-time helper so the prompt
is always byte-identical to the tested tier1/ template files instead of being
hand-transcribed. tier1/ is a pristine, unpopulated copy of the docs/
workflow + dashboard, kept separate from this repo's own live docs/ (which
tracks claude-native-workflow's own design work and must never leak into the
prompt). Source paths below are read from tier1/<path>; the generated prompt
tells Claude to create each file at <path> (tier1/ stripped) in the new
project.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = ROOT / "tier1"

FILES = [
    "CLAUDE.md",
    "docs/index.md",
    "docs/PROTOCOL.md",
    "docs/.tracking.json",
    "docs/spec/index.md",
    "docs/plan/index.md",
    "docs/done/index.md",
    "docs/design/index.md",
    "docs/remind/index.md",
    "docs/temp/index.md",
    "docs/decision/index.md",
    "docs/review/index.md",
    "docs/fix/index.md",
    "docs/logs/index.md",
    "docs/reply/index.md",
    "tools/docs/server.py",
    "tools/docs/static/index.html",
    "tools/docs/static/style.css",
    "tools/docs/static/app.js",
]

LANG = {
    ".md": "markdown", ".json": "json", ".py": "python",
    ".html": "html", ".css": "css", ".js": "javascript",
}

HEADER = """\
# 새 프로젝트 문서 워크플로우 부트스트랩

아래 지시를 따라 이 프로젝트에 설계/기획 문서 워크플로우(`docs/` 체계 +
`CLAUDE.md` + `tools/docs` 대시보드)를 구축해줘.

## 지시사항

1. 아래 "파일 목록"에 나열된 각 파일을, 표시된 경로에 **주어진 내용 그대로**
   생성해. 이미 같은 경로에 파일이 있다면 덮어쓰기 전에 나에게 확인해줘
   (특히 `CLAUDE.md`는 기존 내용이 있으면 이 섹션을 병합해줘, 통째로 덮어쓰지 말고).
2. 폴더가 없으면 만들어. `docs/.tracking.json`은 카운터 상태 파일이니 있는
   그대로(모두 0) 생성해.
3. 모든 파일 생성이 끝나면:
   - `docs/index.md`의 표와 실제로 생성된 파일 목록이 일치하는지 확인해.
   - `python tools/docs/server.py` 로 대시보드가 뜨는지 확인해줘(가능하면).
   - 이 프로젝트의 고유한 빌드/테스트/코딩 규칙이 있다면 `CLAUDE.md` 맨 아래
     플레이스홀더 자리에 이어서 물어보고 채워줘.
4. 이후 내 프롬프트를 받을 때마다 `docs/PROTOCOL.md` 7절의 절차(기존 문서 확인 →
   문서 갱신/생성 → 계획은 승인 후 실행 → PL→DN 전환 → 답변 대기 알림)를 따라줘.

## 파일 목록
"""

FOOTER = """

## 완료 후 알려줄 것

- 생성된 파일 목록 요약
- `docs/reply/index.md`에 미답변 항목이 있는지 (초기 상태는 없음)
- 대시보드 실행 명령어(`python tools/docs/server.py`)와 접속 주소
"""


def main():
    parts = [HEADER]
    for rel in FILES:
        path = SOURCE_ROOT / rel
        text = path.read_text(encoding="utf-8")
        ext = path.suffix
        lang = LANG.get(ext, "")
        fence = "````" if rel in ("CLAUDE.md", "docs/PROTOCOL.md") else "```"
        parts.append(f"\n### 파일: `{rel}`\n\n{fence}{lang}\n{text.rstrip(chr(10))}\n{fence}\n")
    parts.append(FOOTER)
    out = ROOT / "bootstrap-prompt.md"
    out.write_text("".join(parts), encoding="utf-8")
    print(f"wrote {out} ({sum(len(p) for p in parts)} chars)")


if __name__ == "__main__":
    main()
