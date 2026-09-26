"""
Standalone seeder script — populates hodari.places in MongoDB Atlas.
Uses pymongo directly (no MCP server required).

Usage (from the agents/ directory, with .env in agents/):
    python scripts/seed_places.py
    python scripts/seed_places.py --dry-run

Environment variables (loaded from agents/.env via python-dotenv):
    MONGODB_URI          — Atlas connection string
    MONGODB_DATABASE     — database name (default hodari)
    GOOGLE_CLOUD_PROJECT — GCP project for Vertex AI embeddings
    GOOGLE_CLOUD_LOCATION — Vertex AI region (default us-central1)
"""

import argparse
import logging
import os
import sys
from pathlib import Path
from typing import Optional

# ── Load .env from the agents/ directory ────────────────────────────────────
# Support running from scripts/ or agents/ or project root.
_here = Path(__file__).resolve().parent        # agents/scripts/
_agents_dir = _here.parent                     # agents/
try:
    from dotenv import load_dotenv
    _env_path = _agents_dir / ".env"
    if _env_path.exists():
        load_dotenv(_env_path)
    else:
        load_dotenv()  # search upward from cwd
except ImportError:
    pass  # python-dotenv not installed; rely on shell env

# Allow importing places_data from the same directory regardless of cwd.
if str(_here) not in sys.path:
    sys.path.insert(0, str(_here))

from places_data import PLACES  # noqa: E402 (import after path setup)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

HODARI_DB: str = os.getenv("MONGODB_DATABASE", "hodari")
MONGODB_URI: str = os.getenv("MONGODB_URI", "")

import requests  # noqa: E402

try:
    from pymongo import MongoClient, UpdateOne
    from pymongo.errors import PyMongoError
except ImportError:
    sys.exit("pymongo not installed — run: pip install pymongo")

if not MONGODB_URI:
    sys.exit("MONGODB_URI not set in .env")

_mongo_client: Optional[MongoClient] = None

def _get_collection():
    global _mongo_client
    if _mongo_client is None:
        _mongo_client = MongoClient(
            MONGODB_URI,
            maxPoolSize=5,
            serverSelectionTimeoutMS=30_000,
        )
    return _mongo_client[HODARI_DB]["places"]


# ── Vertex AI embedding (copied from mongo_tools.py — standalone) ────────────

def _embed(text: str) -> list:
    """768-dim embedding via Vertex AI text-embedding-004 (ADC auth)."""
    import google.auth
    import google.auth.transport.requests as _tr

    creds, detected_project = google.auth.default(
        scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    creds.refresh(_tr.Request())

    project = os.environ.get("GOOGLE_CLOUD_PROJECT") or detected_project
    location = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")
    if location == "global":
        location = "us-central1"

    url = (
        f"https://{location}-aiplatform.googleapis.com/v1"
        f"/projects/{project}/locations/{location}"
        f"/publishers/google/models/text-embedding-004:predict"
    )
    resp = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {creds.token}",
            "Content-Type": "application/json",
        },
        json={"instances": [{"content": text, "task_type": "RETRIEVAL_DOCUMENT"}]},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()["predictions"][0]["embeddings"]["values"]


# ── Seeding logic ────────────────────────────────────────────────────────────

def _build_embed_text(place: dict) -> str:
    """Concatenate fields that should drive semantic similarity."""
    categories = " ".join(place.get("categories", []))
    return (
        f"{place['name']} {place['city']} {place['country']} "
        f"{categories} {place['description']}"
    )


def seed_places(dry_run: bool = False) -> None:
    total = len(PLACES)
    inserted = 0
    errors = 0

    logger.info(
        "Starting place seeder — %d places, database=%s, dry_run=%s",
        total,
        HODARI_DB,
        dry_run,
    )

    for i, place in enumerate(PLACES, start=1):
        place_id = place["place_id"]
        name = place["name"]
        city = place["city"]

        # Build embedding text
        embed_text = _build_embed_text(place)

        if dry_run:
            logger.info("[dry-run] Would upsert: %s — %s (%s)", place_id, name, city)
            inserted += 1
        else:
            try:
                embedding = _embed(embed_text)
                doc_with_embedding = {**place, "embedding": embedding}
                inclusion_defaults = {
                    "local_business": False,
                    "accessible": False,
                    "status": "validated",
                    "source": "official",
                    "confirmations_count": 0,
                }
                # Re-seeding refreshes content but does not reset inclusion flags
                # already stored on the document.
                for key in inclusion_defaults:
                    doc_with_embedding.pop(key, None)

                col = _get_collection()
                col.update_one(
                    {"place_id": place_id},
                    {"$set": doc_with_embedding, "$setOnInsert": inclusion_defaults},
                    upsert=True,
                )
                inserted += 1
                logger.debug("Upserted: %s — %s", place_id, name)
            except Exception as exc:
                errors += 1
                logger.error("Failed to upsert %s (%s): %s", place_id, name, exc)

        if i % 10 == 0 or i == total:
            logger.info(
                "Progress: %d/%d processed (inserted/updated: %d, errors: %d)",
                i,
                total,
                inserted,
                errors,
            )

    logger.info(
        "Seeding complete. Total=%d  Inserted/updated=%d  Errors=%d",
        total,
        inserted,
        errors,
    )


# ── Entry point ──────────────────────────────────────────────────────────────

def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Seed hodari.places collection with pre-embedded FIFA 2026 host-city venues."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Print what would be inserted without making any MCP calls.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    seed_places(dry_run=args.dry_run)
