"""Build one place embedding in the background. Failures stay quiet.

    py -3.12 scripts/embed_place.py PLACE_ID
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main() -> None:
    if len(sys.argv) < 2:
        return
    place_id = sys.argv[1]
    try:
        from hodari.tools.mongo_tools import HODARI_DB, _embed, _mcp_tool, _parse_docs

        found = _parse_docs(_mcp_tool("find", {
            "database": HODARI_DB,
            "collection": "places",
            "filter": {"place_id": place_id},
            "projection": {"name": 1, "description": 1, "keywords": 1},
            "limit": 1,
        }))
        if not found:
            return
        doc = found[0]
        keywords = " ".join(item for item in (doc.get("keywords") or []) if isinstance(item, str))
        text = " ".join(part for part in (doc.get("name"), doc.get("description"), keywords) if isinstance(part, str))
        if not text.strip():
            return
        vector = _embed(text)
        _mcp_tool("update-many", {
            "database": HODARI_DB,
            "collection": "places",
            "filter": {"place_id": place_id},
            "update": {"$set": {"embedding": vector}},
        })
    except Exception:
        return


if __name__ == "__main__":
    main()
