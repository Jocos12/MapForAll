"""Seed 24 realistic Kigali places for the MapForAll demo.

Mix of local_business and accessible so badges and the inclusion score are
visible. Does not call Vertex — these rows have no embedding. Validated so
they show on the map immediately.

Usage (from agents/, with MONGODB_URI in agents/.env):
    python scripts/seed_demo_places.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

_here = Path(__file__).resolve().parent
_agents_dir = _here.parent
try:
    from dotenv import load_dotenv
    load_dotenv(_agents_dir / ".env")
except ImportError:
    pass

try:
    from pymongo import MongoClient
except ImportError:
    sys.exit("pymongo not installed — run: pip install pymongo")


def _place(
    place_id: str,
    name: str,
    category: str,
    lat: float,
    lng: float,
    *,
    local_business: bool,
    accessible: bool,
    summary: str,
    rating: float = 4.4,
) -> dict:
    return {
        "place_id": place_id,
        "name": name,
        "city": "Kigali",
        "country": "Rwanda",
        "categories": [category],
        "description": summary,
        "summary": summary,
        "rating": rating,
        "price_level": "PRICE_LEVEL_INEXPENSIVE" if local_business else "PRICE_LEVEL_MODERATE",
        "location": {"type": "Point", "coordinates": [lng, lat]},
        "local_business": local_business,
        "accessible": accessible,
        "status": "validated",
        "source": "official",
        "confirmations_count": 0,
        "created_at": "2026-09-26T00:00:00Z",
    }


# Approximate public coordinates in Kigali. Enough for a live demo, not a survey.
DEMO_PLACES = [
    _place("kgl_kimironko", "Kimironko Market", "market", -1.9504, 30.1262, local_business=True, accessible=False, summary="Open-air neighbourhood market. Produce, clothes, and cooked food.", rating=4.6),
    _place("kgl_nyamirambo_wc", "Nyamirambo Women's Centre", "cafe", -1.9812, 30.0448, local_business=True, accessible=True, summary="Community café and craft shop run by local women. Step-free entrance.", rating=4.7),
    _place("kgl_caplaki", "Caplaki Craft Village", "shop", -1.9448, 30.0615, local_business=True, accessible=False, summary="Cluster of artisan stalls near the city centre.", rating=4.3),
    _place("kgl_gisozi", "Kigali Genocide Memorial", "attraction", -1.9312, 30.0606, local_business=False, accessible=True, summary="National memorial with ramped paths and accessible galleries.", rating=4.8),
    _place("kgl_bourbon", "Bourbon Coffee Kigali Heights", "cafe", -1.9442, 30.0894, local_business=False, accessible=True, summary="Formal café chain inside a mall. Lift access.", rating=4.2),
    _place("kgl_inema", "Inema Arts Centre", "attraction", -1.9558, 30.1044, local_business=True, accessible=True, summary="Artist-run gallery and courtyard. Ground-floor access.", rating=4.6),
    _place("kgl_city_market", "Kigali City Market", "market", -1.9436, 30.0611, local_business=True, accessible=False, summary="Covered market for fabric, baskets, and household goods.", rating=4.4),
    _place("kgl_question", "Question Coffee Café", "cafe", -1.9449, 30.1048, local_business=True, accessible=True, summary="Women-owned coffee cooperative café. Accessible seating.", rating=4.7),
    _place("kgl_heaven", "Heaven Restaurant", "restaurant", -1.9572, 30.1041, local_business=False, accessible=True, summary="Formal restaurant with a ramped entrance.", rating=4.5),
    _place("kgl_repub", "Repub Lounge", "restaurant", -1.9538, 30.0922, local_business=False, accessible=False, summary="Formal lounge. Steps at the entrance.", rating=4.3),
    _place("kgl_nyabugogo", "Nyabugogo Bus Park Stalls", "market", -1.9396, 30.0446, local_business=True, accessible=False, summary="Informal food and phone-credit stalls by the bus park.", rating=4.1),
    _place("kgl_biryogo", "Biryogo Market", "market", -1.9704, 30.0588, local_business=True, accessible=False, summary="Neighbourhood market in Nyamirambo.", rating=4.2),
    _place("kgl_ivuka", "Ivuka Arts", "shop", -1.9368, 30.1086, local_business=True, accessible=False, summary="Small independent arts workshop and shop.", rating=4.5),
    _place("kgl_library", "Kigali Public Library", "attraction", -1.9441, 30.0618, local_business=False, accessible=True, summary="Public library with step-free entry.", rating=4.4),
    _place("kgl_amahoro", "Amahoro Stadium Gate", "attraction", -1.9446, 30.0928, local_business=False, accessible=True, summary="Stadium approach with designated accessible gate.", rating=4.3),
    _place("kgl_galette", "La Galette", "cafe", -1.9502, 30.0926, local_business=True, accessible=False, summary="Small local bakery-café.", rating=4.4),
    _place("kgl_poivre", "Poivre Noir", "restaurant", -1.9551, 30.1049, local_business=False, accessible=False, summary="Formal dining room. Not step-free.", rating=4.4),
    _place("kgl_shokola", "Shokola", "cafe", -1.9488, 30.1042, local_business=True, accessible=True, summary="Independent chocolate and coffee shop. Ground floor.", rating=4.5),
    _place("kgl_nyarugenge", "Nyarugenge Market", "market", -1.9468, 30.0584, local_business=True, accessible=False, summary="Busy informal market in Nyarugenge.", rating=4.3),
    _place("kgl_ubumwe", "Ubumwe Grande Hotel", "attraction", -1.9482, 30.0921, local_business=False, accessible=True, summary="Formal hotel with lift and accessible rooms.", rating=4.4),
    _place("kgl_kimihurura", "Kimihurura Craft Stalls", "shop", -1.9486, 30.0884, local_business=True, accessible=False, summary="Roadside craft sellers. Informal, no step-free path.", rating=4.2),
    _place("kgl_pharmacie", "Pharmacie Conseil", "shop", -1.9432, 30.0596, local_business=True, accessible=True, summary="Neighbourhood pharmacy with a level entrance.", rating=4.3),
    _place("kgl_kcc", "Kigali Convention Centre", "attraction", -1.9546, 30.0936, local_business=False, accessible=True, summary="Formal venue. Lifts and accessible washrooms.", rating=4.6),
    _place("kgl_muhima", "Muhima Market", "market", -1.9364, 30.0589, local_business=True, accessible=False, summary="Informal market serving Muhima.", rating=4.2),
    _place("kgl_ikaze", "Ikaze Cooperative", "shop", -1.9602, 30.0784, local_business=True, accessible=True, summary="Local producers' cooperative shop. Step-free counter.", rating=4.6),
    _place("kgl_sawa", "Sawa Citi", "restaurant", -1.9518, 30.0914, local_business=False, accessible=False, summary="Formal chain restaurant.", rating=4.1),
]


def main() -> None:
    uri = os.getenv("MONGODB_URI", "")
    if not uri:
        sys.exit("MONGODB_URI not set")
    db_name = os.getenv("MONGODB_DATABASE", "hodari")
    client = MongoClient(uri, serverSelectionTimeoutMS=15_000)
    col = client[db_name]["places"]
    for place in DEMO_PLACES:
        col.update_one({"place_id": place["place_id"]}, {"$set": place}, upsert=True)
        print(f"upserted {place['place_id']} — {place['name']}")
    print(f"{len(DEMO_PLACES)} Kigali demo places ready")
    client.close()


if __name__ == "__main__":
    main()
