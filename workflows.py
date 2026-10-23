#!/usr/bin/env python3
"""Workflows: named, repeatable actions over the machine and the memory layer.

Deliberately narrow. A workflow here is a verb with no parameters, run on demand,
that completes in seconds and cannot destroy anything:

    kb-index    rebuild the knowledge maps
    kb-lint     check structure, report problems
    board-snap  copy board.md aside as board-<date>.md

Anything longer or riskier (bench rounds, model runs) stays a human decision in the
palette, not a one-click flow.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
MEMORY = Path(r"E:\AI\memory\ai-unlimited-memory")
NO_WINDOW = 0x08000000


def _python(script: str, args: list[str], cwd: Path) -> tuple[bool, str]:
    try:
        res = subprocess.run([sys.executable, str(cwd / script), *args], cwd=str(cwd),
                             capture_output=True, text=True, timeout=120,
                             creationflags=NO_WINDOW)
        out = (res.stdout or res.stderr).strip().splitlines()
        return res.returncode == 0, (out[-1] if out else f"exit {res.returncode}")
    except Exception as exc:
        return False, str(exc)


def kb_index() -> tuple[bool, str]:
    return _python("kb.py", ["index"], MEMORY)


def kb_lint() -> tuple[bool, str]:
    return _python("kb.py", ["lint"], MEMORY)


def board_snap() -> tuple[bool, str]:
    src = HERE / "board.md"
    if not src.is_file():
        return False, "board.md missing"
    dst = HERE / f"board-{date.today().isoformat()}.md"
    shutil.copyfile(src, dst)
    return True, f"saved {dst.name}"


WORKFLOWS = {
    "kb-index": {"label": "knowledge: rebuild maps", "run": kb_index},
    "kb-lint": {"label": "knowledge: lint", "run": kb_lint},
    "board-snap": {"label": "board: snapshot", "run": board_snap},
}


def list_workflows() -> list[dict]:
    return [{"name": name, "label": spec["label"]} for name, spec in WORKFLOWS.items()]


def run(name: str) -> tuple[bool, str]:
    spec = WORKFLOWS.get(name)
    if not spec:
        return False, f"no workflow named {name}"
    try:
        return spec["run"]()
    except Exception as exc:
        return False, str(exc)


if __name__ == "__main__":
    if len(sys.argv) > 1:
        ok, message = run(sys.argv[1])
        print(("ok: " if ok else "failed: ") + message)
        raise SystemExit(0 if ok else 1)
    for item in list_workflows():
        print(f"  {item['name']:<12} {item['label']}")
