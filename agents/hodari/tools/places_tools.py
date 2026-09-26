"""
ADK tools for querying the pre-seeded hodari.places collection via Atlas
Vector Search.

All Atlas operations are routed through the MongoDB MCP HTTP server — no
direct driver connection.
"""

import logging

from google.adk.tools import ToolContext

from .mongo_tools import (
    HODARI_DB,
    MDB_MCP_URL,  # noqa: F401 — re-exported for test introspection
    _embed,
    _mcp_tool,
    _parse_docs,
)

logger = logging.getLogger(__name__)

# Maps stadium names, neighbourhoods, and common mis-extractions to the exact
# city value stored in the seeded places collection.
_CITY_ALIASES: dict[str, str] = {
    "new york": "New York", "new jersey": "New York", "metlife": "New York", "east rutherford": "New York",
    "los angeles": "Los Angeles", "inglewood": "Los Angeles", "sofi": "Los Angeles",
    "dallas": "Dallas", "arlington": "Dallas", "at&t": "Dallas", "att stadium": "Dallas",
    "san francisco": "San Francisco", "santa clara": "San Francisco", "bay area": "San Francisco", "levi": "San Francisco",
    "seattle": "Seattle", "lumen": "Seattle",
    "kansas city": "Kansas City", "arrowhead": "Kansas City",
    "boston": "Boston", "foxborough": "Boston", "gillette": "Boston",
    "philadelphia": "Philadelphia", "lincoln financial": "Philadelphia",
    "miami": "Miami", "hard rock": "Miami", "miami gardens": "Miami",
    "houston": "Houston", "nrg": "Houston",
    "toronto": "Toronto", "bmo": "Toronto",
    "vancouver": "Vancouver", "bc place": "Vancouver",
    "mexico city": "Mexico City", "azteca": "Mexico City", "ciudad de mexico": "Mexico City",
    "guadalajara": "Guadalajara", "akron": "Guadalajara",
    "monterrey": "Monterrey", "bbva": "Monterrey",
}

# Host cities present in agents/scripts/places_data.py (World Cup venues).
SEEDED_CITIES: frozenset[str] = frozenset(_CITY_ALIASES.values())


def _normalize_city(raw: str) -> str:
    """Map a raw location string from the Planner to a seeded city name."""
    lower = raw.lower()
    for alias, city in _CITY_ALIASES.items():
        if alias in lower:
            return city
    return raw.strip()


def is_seeded_city(city: str) -> bool:
    """True when the places collection has been seeded for this city."""
    return _normalize_city(city) in SEEDED_CITIES


def find_places_by_vector(
    query: str,
    city: str,
    tool_context: ToolContext,
    limit: int = 8,
) -> list[dict]:
    """Search the pre-seeded places collection using semantic vector search.

    Use BEFORE search_places (Maps MCP) to get locally cached, pre-embedded
    venue data. Returns up to `limit` places from the specified city that
    semantically match the query.
    Returns empty list if the places collection is not yet seeded or the
    vector index is not ready.

    Args:
        query: What the user is looking for (e.g. "vegetarian tapas near the stadium").
        city:  Host city name (e.g. "Dallas", "Mexico City", "Vancouver").
        limit: Max results to return (default 8).
        tool_context: Injected by ADK.
    """
    canonical_city = _normalize_city(city)
    if canonical_city not in SEEDED_CITIES:
        logger.info(
            "VECTOR_SEARCH skipped: city=%r -> canonical=%r (not in seeded host cities)",
            city,
            canonical_city,
        )
        return []

    try:
        logger.info("VECTOR_SEARCH called: query=%r city=%r -> canonical=%r", query, city, canonical_city)
        q_embedding = _embed(query)
        pipeline = [
            {
                "$vectorSearch": {
                    "index": "places_embedding",
                    "path": "embedding",
                    "queryVector": q_embedding,
                    "numCandidates": limit * 6,
                    "limit": limit,
                    "filter": {"city": {"$eq": canonical_city}},
                }
            },
            {
                "$project": {
                    "_id": 0,
                    "place_id": 1,
                    "name": 1,
                    # Reshape to match CandidateSet schema the Explorer outputs
                    "address": {"$ifNull": ["$address", ""]},
                    "coordinates": {
                        "lat": {"$arrayElemAt": ["$location.coordinates", 1]},
                        "lng": {"$arrayElemAt": ["$location.coordinates", 0]},
                    },
                    "categories": 1,
                    "rating": "$ratings.score",
                    "price_level": 1,
                    "summary": "$description",
                    "maps_url": {"$ifNull": ["$maps_url", None]},
                    "personalization_score": 0.0,
                    "local_business": {"$ifNull": ["$local_business", False]},
                    "accessible": {"$ifNull": ["$accessible", False]},
                    "status": {"$ifNull": ["$status", "validated"]},
                    "source": {"$ifNull": ["$source", "official"]},
                    "photo_url": {"$ifNull": ["$photo_url", None]},
                    "confirmations_count": {"$ifNull": ["$confirmations_count", 0]},
                    "score": {"$meta": "vectorSearchScore"},
                }
            },
        ]
        result = _mcp_tool(
            "aggregate",
            {
                "database": HODARI_DB,
                "collection": "places",
                "pipeline": pipeline,
            },
        )
        docs = _parse_docs(result)
        logger.info("VECTOR_SEARCH returned %d results for city=%r", len(docs), canonical_city)
        return docs
    except Exception as exc:
        logger.info(
            "find_places_by_vector returned empty (index not ready?): %s", exc
        )
        return []
