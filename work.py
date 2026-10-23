#!/usr/bin/env python3
"""Kanban store: one markdown file, human-editable, no database.

    ## backlog
    - fix the probe race | bench | 2026-10-23 | a1b2c3
    ## next
    ## doing
    ## done

The file is the truth: editing it by hand is supported, and the board rewrites it
on every change. Cards carry a short id so a move survives reordering.

Stdlib only.
"""
from __future__ import annotations

import re
import secrets
from datetime import date
from pathlib import Path

BOARD = Path(__file__).resolve().parent / "board.md"
COLUMNS = ("backlog", "next", "doing", "done")
HEADER = "# Muther board\n\nOne line per card: `title | project | date | id`.\n"


def _blank() -> dict[str, list[dict]]:
    return {column: [] for column in COLUMNS}


def load() -> dict[str, list[dict]]:
    if not BOARD.is_file():
        return _blank()
    board = _blank()
    column = None
    for raw in BOARD.read_text(encoding="utf-8-sig").splitlines():
        line = raw.rstrip()
        match = re.match(r"^##\s+(\w+)\s*$", line)
        if match:
            name = match.group(1).lower()
            column = name if name in board else None
            continue
        if column is None or not line.startswith("- "):
            continue
        parts = [part.strip() for part in line[2:].split("|")]
        if not parts or not parts[0]:
            continue
        board[column].append({
            "title": parts[0],
            "project": parts[1] if len(parts) > 1 else "",
            "date": parts[2] if len(parts) > 2 else "",
            "id": parts[3] if len(parts) > 3 else secrets.token_hex(3),
        })
    return board


def save(board: dict[str, list[dict]]) -> None:
    lines = [HEADER]
    for column in COLUMNS:
        lines.append(f"## {column}\n")
        for card in board.get(column, []):
            lines.append(f"- {card['title']} | {card.get('project', '')} | "
                         f"{card.get('date', '')} | {card['id']}\n")
        lines.append("\n")
    BOARD.write_text("".join(lines), encoding="utf-8")


def find(board: dict, card_id: str) -> tuple[str, int] | None:
    for column in COLUMNS:
        for index, card in enumerate(board.get(column, [])):
            if card["id"] == card_id:
                return column, index
    return None


def add(title: str, project: str = "", column: str = "backlog") -> dict:
    title = " ".join(title.split())[:160]
    if not title:
        raise ValueError("empty card title")
    board = load()
    card = {"title": title, "project": project.strip()[:40],
            "date": date.today().isoformat(), "id": secrets.token_hex(3)}
    board[column if column in COLUMNS else "backlog"].append(card)
    save(board)
    return card


def move(card_id: str, direction: str = "next") -> dict | None:
    """`direction` is a column name or left/right/done."""
    board = load()
    found = find(board, card_id)
    if not found:
        return None
    column, index = found
    card = board[column].pop(index)
    order = list(COLUMNS)
    if direction in COLUMNS:
        target = direction
    elif direction == "right":
        target = order[min(len(order) - 1, order.index(column) + 1)]
    elif direction == "left":
        target = order[max(0, order.index(column) - 1)]
    elif direction == "done":
        target = "done"
    else:
        target = column
    board[target].append(card)
    save(board)
    return card


def remove(card_id: str) -> bool:
    board = load()
    found = find(board, card_id)
    if not found:
        return False
    column, index = found
    board[column].pop(index)
    save(board)
    return True


def summary() -> dict:
    board = load()
    return {column: len(cards) for column, cards in board.items()}
