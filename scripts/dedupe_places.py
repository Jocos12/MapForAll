"""Find duplicate venues in the MongoDB ``places`` collection.

Dry-run by default. ``--apply`` keeps the richest record in each group (filling
gaps, including accessibility flags) and deletes the other place documents.
Interactions and users are not touched.

Usage (from the repo root, with agents/.env present):
    python scripts/dedupe_places.py
    python scripts/dedupe_places.py --apply
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
_AGENTS = _ROOT / "agents"
if str(_AGENTS) not in sys.path:
    sys.path.insert(0, str(_AGENTS))

try:
    from dotenv import load_dotenv

    env_path = _AGENTS / ".env"
    if env_path.exists():
        load_dotenv(env_path)
except ImportError:
    pass

from hodari.tools.place_dedupe import dedupe_places, duplicate_groups  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Report or remove duplicate places.")
    parser.add_argument("--apply", action="store_true", help="Update the keeper and delete the other documents.")
    args = parser.parse_args()

    uri = os.getenv("MONGODB_URI") or os.getenv("MDB_MCP_CONNECTION_STRING")
    if not uri:
        print("MONGODB_URI is not set. Nothing was changed.")
        return 1
    database_name = os.getenv("MONGODB_DATABASE", "hodari")

    from pymongo import MongoClient

    client = MongoClient(uri, serverSelectionTimeoutMS=8000)
    collection = client[database_name]["places"]
    docs = list(collection.find({}, {"embedding": 0, "photos": 0}))
    groups = duplicate_groups(docs)
    print(f"Scanned {len(docs)} places. Duplicate groups: {len(groups)}.")

    for index, group in enumerate(groups, start=1):
        keeper = dedupe_places(group)[0]
        keeper_id = keeper.get("_id")
        print(f"\nGroup {index} ({len(group)} records) — keep {keeper.get('place_id')} ({keeper.get('name')})")
        for doc in group:
            marker = "KEEP" if doc.get("_id") == keeper_id else "DROP"
            print(
                f"  {marker} place_id={doc.get('place_id')} name={doc.get('name')!r} "
                f"rating={doc.get('rating')} accessible={doc.get('accessible')}"
            )
        if not args.apply:
            continue
        if keeper_id is None:
            print("  skipped write: keeper has no _id")
            continue
        payload = {key: value for key, value in keeper.items() if key != "_id"}
        collection.update_one({"_id": keeper_id}, {"$set": payload})
        drop_ids = [doc["_id"] for doc in group if doc.get("_id") is not None and doc.get("_id") != keeper_id]
        if drop_ids:
            result = collection.delete_many({"_id": {"$in": drop_ids}})
            print(f"  deleted {result.deleted_count} duplicate place document(s)")

    if not args.apply:
        print("\nDry run only. Re-run with --apply to write.")
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
