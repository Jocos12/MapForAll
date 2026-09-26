"""Add MapForAll inclusion fields to existing `places` documents.

Only sets a field when it is missing, so a re-run does not overwrite
local_business, accessible, status, source, or confirmations_count.

Usage (from agents/, with MONGODB_URI in agents/.env):
    python scripts/migrate_places_schema.py
    python scripts/migrate_places_schema.py --dry-run
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

_here = Path(__file__).resolve().parent
_agents_dir = _here.parent
if str(_agents_dir) not in sys.path:
    sys.path.insert(0, str(_agents_dir))

try:
    from dotenv import load_dotenv
    load_dotenv(_agents_dir / ".env")
except ImportError:
    pass

import importlib.util  # noqa: E402

_schema_path = _agents_dir / "hodari" / "tools" / "place_schema.py"
_spec = importlib.util.spec_from_file_location("place_schema", _schema_path)
_schema = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(_schema)
PLACE_DEFAULTS = _schema.PLACE_DEFAULTS

try:
    from pymongo import MongoClient
except ImportError:
    sys.exit("pymongo not installed — run: pip install pymongo")


def migrate(dry_run: bool = False) -> dict[str, int]:
    uri = os.getenv("MONGODB_URI", "")
    if not uri:
        sys.exit("MONGODB_URI not set")
    db_name = os.getenv("MONGODB_DATABASE", "hodari")
    client = MongoClient(uri, serverSelectionTimeoutMS=15_000)
    col = client[db_name]["places"]
    touched: dict[str, int] = {}
    for field, value in PLACE_DEFAULTS.items():
        query = {field: {"$exists": False}}
        count = col.count_documents(query)
        touched[field] = count
        if dry_run or count == 0:
            continue
        col.update_many(query, {"$set": {field: value}})
    # Optional keys are left absent; readers treat them as missing.
    client.close()
    return touched


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill inclusion fields on places.")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = migrate(dry_run=args.dry_run)
    label = "would update" if args.dry_run else "updated"
    for field, count in result.items():
        print(f"{label} {count} documents missing {field}")


if __name__ == "__main__":
    main()
