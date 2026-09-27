"""Map a user request to one place category and drop mismatches.

A hotel query must not come back as supermarkets. Places with no category
signal are left alone so untyped results still rank. A named other category
(supermarket, pharmacy, restaurant, …) is removed.
"""

from __future__ import annotations

import re
from typing import Any

# Order matters: more specific phrases before shorter ones.
_CATEGORIES: list[tuple[str, re.Pattern[str]]] = [
    ("clinic", re.compile(
        r"centres?\s+de\s+sant[eé]|health\s+cent(?:er|re)s?|cliniques?|clinics?|h[oô]pitaux|h[oô]pital|hospitals?|dispensaires?",
        re.I,
    )),
    ("pharmacy", re.compile(r"pharmacies|pharmacie|pharmacy", re.I)),
    ("hotel", re.compile(r"h[oô]tels?|hotels?|lodging|h[eé]bergements?", re.I)),
    ("cafe", re.compile(r"caf[eé]s?|coffee", re.I)),
    ("restaurant", re.compile(r"restaurants?|restos?", re.I)),
    ("market", re.compile(r"supermarch[eé]s?|supermarkets?|march[eé]s?|markets?", re.I)),
    ("shop", re.compile(r"boutiques?|magasins?|shops?", re.I)),
]

# Words that prove a place belongs to a category (name or stored categories).
_SIGNALS: dict[str, tuple[str, ...]] = {
    "hotel": ("hotel", "hôtel", "lodging", "hostel", "marriott", "radisson", "inn"),
    "pharmacy": ("pharmacy", "pharmacie", "drugstore"),
    "clinic": ("clinic", "clinique", "hospital", "hôpital", "hopital", "dispensaire", "health"),
    "restaurant": ("restaurant", "resto", "dining"),
    "cafe": ("cafe", "café", "coffee"),
    "market": ("market", "marché", "marche", "supermarket", "supermarché", "supermarche"),
    "shop": ("shop", "boutique", "magasin", "store"),
}

_SEARCH_QUERY: dict[str, str] = {
    "hotel": "hotels in Kigali",
    "pharmacy": "pharmacies in Kigali",
    "clinic": "clinics and hospitals in Kigali",
    "restaurant": "restaurants in Kigali",
    "cafe": "cafes in Kigali",
    "market": "markets and supermarkets in Kigali",
    "shop": "shops in Kigali",
}

_EMPTY_SAY: dict[str, str] = {
    "hotel": "Je n'ai pas encore d'hôtels référencés dans cette zone.",
    "pharmacy": "Je n'ai pas encore de pharmacies référencées dans cette zone.",
    "clinic": "Je n'ai pas encore de centres de santé référencés dans cette zone.",
    "restaurant": "Je n'ai pas encore de restaurants référencés dans cette zone.",
    "cafe": "Je n'ai pas encore de cafés référencés dans cette zone.",
    "market": "Je n'ai pas encore de marchés référencés dans cette zone.",
    "shop": "Je n'ai pas encore de commerces référencés dans cette zone.",
}


def requested_category(text: str) -> str | None:
    """The category the user asked for, or None when the request is open."""
    for category, pattern in _CATEGORIES:
        if pattern.search(text or ""):
            return category
    return None


def category_search_query(category: str) -> str:
    return _SEARCH_QUERY.get(category, category)


def empty_category_message(category: str) -> str:
    return _EMPTY_SAY.get(category, "Je n'ai pas encore de lieux de cette catégorie dans cette zone.")


def _blob(place: dict[str, Any]) -> str:
    parts = [str(place.get("name") or "")]
    categories = place.get("categories") or place.get("types") or []
    if isinstance(categories, list):
        parts.extend(str(item) for item in categories)
    elif isinstance(categories, str):
        parts.append(categories)
    return " ".join(parts).lower()


def matches_category(place: dict[str, Any], category: str) -> bool:
    blob = _blob(place)
    return any(word in blob for word in _SIGNALS.get(category, ()))


def keep_for_category(places: list[dict[str, Any]], category: str | None) -> list[dict[str, Any]]:
    """Keep only places that belong to the asked category. No substitution."""
    if not category:
        return places
    return [place for place in places if matches_category(place, category)]
