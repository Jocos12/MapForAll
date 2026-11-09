"""Rule-based place intent for a search, before any model call.

Product words such as "tomatoes" map to a category and keywords. Equity
bonuses never run until a place has passed this gate.
"""

from __future__ import annotations

import json
import os
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

MIN_VECTOR_SCORE = float(os.getenv("MIN_VECTOR_SCORE", "0.6"))
BONUS_CAP = 0.5
_EXPANSIONS_PATH = Path(__file__).resolve().parents[1] / "config" / "query_expansions.json"


def load_expansions() -> dict[str, list[str]]:
    """en/fr/rw query expansions. Admins edit config/query_expansions.json."""
    try:
        data = json.loads(_EXPANSIONS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    out: dict[str, list[str]] = {}
    for key, value in data.items():
        if isinstance(key, str) and isinstance(value, list):
            out[key] = [str(item) for item in value if isinstance(item, str) and item.strip()]
    return out

# (category, trigger words, extra search keywords). First match wins.
_GROUPS: list[tuple[str, tuple[str, ...], tuple[str, ...]]] = [
    (
        "university",
        ("university", "universite", "université", "kaminuza", "college", "campus"),
        ("university",),
    ),
    (
        "bank",
        ("bank", "banks", "banque", "atm"),
        ("bank",),
    ),
    (
        "market",
        (
            "tomato", "tomatoes", "tomate", "tomates", "inyanya",
            "vegetable", "vegetables", "legume", "legumes", "légume", "légumes",
            "grocery", "groceries", "epicerie", "épicerie",
            "supermarket", "supermarkets", "supermarche", "supermarché", "supermarchés",
            "market", "markets", "marche", "marché", "marchés", "isoko",
        ),
        ("supermarket", "grocery", "market", "vegetable", "tomato"),
    ),
    (
        "pharmacy",
        ("pharmacy", "pharmacies", "pharmacie", "farumasi", "drugstore"),
        ("pharmacy",),
    ),
    (
        "clinic",
        ("clinic", "clinics", "clinique", "hospital", "hopital", "hôpital", "dispensaire", "ibitaro"),
        ("clinic", "hospital"),
    ),
    (
        "hotel",
        ("hotel", "hotels", "hôtel", "hôtels", "hoteli", "lodging", "auberge", "guest house", "hebergement", "hébergement"),
        ("hotel", "lodging", "auberge"),
    ),
    (
        "cafe",
        ("cafe", "cafes", "café", "cafés", "coffee", "kawa"),
        ("cafe", "coffee"),
    ),
    (
        "restaurant",
        ("restaurant", "restaurants", "resto", "restos", "resitora", "manger", "burger", "burgers"),
        ("restaurant", "burger"),
    ),
    (
        "phone",
        ("iphone", "smartphone", "telephone", "phone", "electronics", "mobile"),
        ("iphone", "smartphone", "electronics", "phone"),
    ),
    (
        "shop",
        ("shop", "shops", "boutique", "boutiques", "magasin", "magasins", "iduka"),
        ("shop",),
    ),
]

_CATEGORY_SIGNALS: dict[str, tuple[str, ...]] = {
    "market": ("market", "marché", "marche", "marches", "supermarket", "supermarché", "supermarche", "grocery", "épicerie", "epicerie", "vegetable", "legume", "légume", "greengrocer", "tomato", "tomate", "inyanya", "grocery_store", "grocery_or_supermarket"),
    "pharmacy": ("pharmacy", "pharmacie", "drugstore"),
    "clinic": ("clinic", "clinique", "hospital", "hôpital", "hopital", "dispensaire"),
    "hotel": ("hotel", "hôtel", "lodging", "hostel", "inn", "auberge", "guest"),
    "phone": ("phone", "iphone", "smartphone", "telephone", "electronics", "mobile"),
    "cafe": ("cafe", "café", "coffee", "coffee_shop"),
    "restaurant": ("restaurant", "resto", "dining", "hamburger", "burger"),
    "shop": ("shop", "boutique", "magasin", "store"),
    "university": ("university", "université", "universite", "college", "campus"),
    "bank": ("bank", "banque", "atm"),
}

# Places API (New) includedType for a category search.
INCLUDED_TYPE: dict[str, str] = {
    "hotel": "lodging",
    "university": "university",
    "market": "supermarket",
    "pharmacy": "pharmacy",
    "restaurant": "restaurant",
    "cafe": "cafe",
    "bank": "bank",
    "clinic": "hospital",
    "shop": "store",
}

# Same idea across en/fr/rw. A hit on one word searches the whole group.
_SYNONYM_GROUPS: list[tuple[str, ...]] = [
    ("tomato", "tomatoes", "tomate", "tomates", "inyanya"),
    ("vegetable", "vegetables", "legume", "legumes", "légume", "légumes"),
    ("greengrocer", "market", "markets", "marche", "marches", "marché", "marchés", "isoko", "grocery"),
]


def term_variants(token: str) -> list[str]:
    """Accent-folded word, singular/plural, a short stem, and synonym-group members."""
    folded = _fold(token)
    if len(folded) < 3:
        return []
    found = [folded]
    if folded.endswith("es") and len(folded) > 4:
        found.append(folded[:-2])
    elif folded.endswith("s") and len(folded) > 4:
        found.append(folded[:-1])
    for group in _SYNONYM_GROUPS:
        folded_group = [_fold(word) for word in group]
        if any(item in folded_group for item in found):
            found.extend(folded_group)
            break
    if folded.startswith("tomat"):
        found.append("tomat")
    elif folded.startswith("legum") or folded.startswith("veget"):
        found.append(folded[:5])
    out: list[str] = []
    seen: set[str] = set()
    for item in found:
        if item and item not in seen:
            seen.add(item)
            out.append(item)
    return out


def search_terms(text: str, intent: SearchIntent | None = None) -> list[str]:
    """Keywords the catalog should match: the user's words plus synonyms."""
    intent = intent or extract_search_intent(text)
    raw = list(intent.keywords or [])
    raw.extend(re.findall(r"[A-Za-zÀ-ÿ0-9']{3,}", text or ""))
    out: list[str] = []
    seen: set[str] = set()
    stop = {
        "the", "and", "for", "near", "with", "want", "need", "like", "find", "show",
        "kigali", "rwanda", "please", "looking", "where", "can", "how", "are", "you",
        "buy", "there", "this", "that", "cherche", "veux", "acheter",
        "des", "une", "pour", "pres", "moi", "est", "les", "dans",
    }
    for token in raw:
        if _fold(token) in stop:
            continue
        for variant in term_variants(token):
            if variant in seen:
                continue
            seen.add(variant)
            out.append(variant)
            if len(out) >= 32:
                return out
    return out


_MODIFIERS = {
    "near my location": "near",
    "near me": "near",
    "near my place": "near",
    "nearby": "near",
    "closer": "closer",
    "open now": "open_now",
    "cheaper": "cheaper",
    "another one": "more",
    "another": "more",
    "more": "more",
    "show more": "more",
}


@dataclass
class SearchIntent:
    category: str | None = None
    keywords: list[str] = field(default_factory=list)
    maps_query: str = ""
    vector_query: str = ""
    open_query: bool = False
    product_terms: list[str] = field(default_factory=list)
    # Words the user actually used, plus the same word in en/fr/rw. Broader expansions stay in product_terms.
    query_terms: list[str] = field(default_factory=list)


def _fold(text: str) -> str:
    raw = unicodedata.normalize("NFKD", text or "")
    raw = "".join(ch for ch in raw if not unicodedata.combining(ch))
    return raw.lower()


def _words(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9']{3,}", _fold(text)))


def parse_user_location(text: str) -> tuple[float, float] | None:
    folded = _fold(text)
    match = re.search(r"\[user location:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\]", folded)
    if not match:
        # The model sometimes keeps only the coordinate pair from the client tag.
        match = re.search(r"(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)", folded)
    if not match:
        return None
    lat, lng = float(match.group(1)), float(match.group(2))
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    return lat, lng


def modifier_only(text: str) -> str | None:
    """A follow-up that only changes the previous search, such as 'near my location'."""
    cleaned = re.sub(r"\[user location:[^\]]+\]", " ", _fold(text))
    cleaned = re.sub(r"[?.!]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if extract_search_intent(cleaned).category:
        return None
    return _MODIFIERS.get(cleaned)


def rejection_reason(
    place: dict[str, Any], intent: SearchIntent, vector_score: float | None = None
) -> str | None:
    if is_relevant(place, intent, vector_score):
        return None
    if intent.category:
        return f"not a {intent.category}"
    return "below vector floor"


def _edit_distance(left: str, right: str) -> int:
    if abs(len(left) - len(right)) > 2:
        return 3
    prev = list(range(len(right) + 1))
    for i, ca in enumerate(left, start=1):
        curr = [i]
        for j, cb in enumerate(right, start=1):
            curr.append(min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = curr
    return prev[-1]


def _triggered(words: set[str], folded: str, trigger: str) -> bool:
    token = _fold(trigger)
    if not token:
        return False
    if " " in token:
        return token in folded
    if token in words:
        return True
    if len(token) <= 4:
        return False
    return any(len(word) > 4 and _edit_distance(token, word) <= 2 for word in words)


def extract_search_intent(text: str) -> SearchIntent:
    """Map a request to a category and keywords. No model call.

    "the Hotel", "a hotel", and "hotels" are the hotel category. The article
    does not turn the word into a place name.
    """
    folded = _fold(text)
    words = _words(text)
    for category, triggers, extras in _GROUPS:
        fired = [trigger for trigger in triggers if _triggered(words, folded, trigger)]
        if fired:
            keywords = list(dict.fromkeys([*triggers[:4], *extras]))
            joined = " ".join(extras)
            product = [_fold(word) for word in (*triggers, *extras)]
            query_terms = [_fold(word) for word in fired]
            if category == "market":
                fired_folded = set(query_terms)
                tomatoish = {"tomato", "tomatoes", "tomate", "tomates", "inyanya"}
                groups = _SYNONYM_GROUPS if fired_folded & tomatoish else _SYNONYM_GROUPS[:2]
                for group in groups:
                    folded_group = [_fold(word) for word in group]
                    if groups is _SYNONYM_GROUPS or fired_folded & set(folded_group):
                        query_terms.extend(folded_group)
                        product.extend(folded_group)
            if category == "phone":
                query_terms.extend(["iphone", "smartphone", "telephone"])
            for extra in load_expansions().get(category, []):
                product.append(_fold(extra))
            return SearchIntent(
                category=category,
                keywords=keywords,
                maps_query=f"{joined} in Kigali",
                vector_query=joined,
                open_query=False,
                product_terms=list(dict.fromkeys(product)),
                query_terms=list(dict.fromkeys(query_terms)),
            )
    stop = {
        "the", "and", "for", "near", "with", "want", "need", "like", "find", "show",
        "kigali", "rwanda", "please", "looking", "where", "can", "how", "are", "you",
        "buy", "there", "this", "that", "cherche", "veux", "acheter",
        "des", "une", "pour", "pres", "moi", "est", "les", "dans",
    }
    content = [word for word in re.findall(r"[a-z0-9']{3,}", folded) if word not in stop]
    joined = " ".join(content)
    return SearchIntent(
        open_query=True,
        maps_query=joined,
        vector_query=joined,
        keywords=content,
        query_terms=content,
    )


def _blob(place: dict[str, Any]) -> str:
    parts = [str(place.get("name") or ""), str(place.get("summary") or ""), str(place.get("description") or "")]
    for key in ("categories", "types", "tags", "keywords"):
        value = place.get(key)
        if isinstance(value, list):
            parts.extend(str(item) for item in value)
        elif isinstance(value, str):
            parts.append(value)
    return _fold(" ".join(parts))


def _has_signal(blob: str, signal: str) -> bool:
    folded = _fold(signal)
    if not folded:
        return False
    if len(folded) <= 4:
        return re.search(rf"(?<![a-z]){re.escape(folded)}(?![a-z])", blob) is not None
    return folded in blob


def relevance_score(place: dict[str, Any], intent: SearchIntent, vector_score: float | None = None) -> float:
    """1 when the place matches the ask, the vector score when it clears the floor, else 0.

    An open query (no category and no product word) does not reject places.
    A place that is clearly another category is rejected even with a high vector score.
    """
    if intent.open_query and not intent.category:
        if vector_score is None:
            return 1.0
        return vector_score if vector_score >= MIN_VECTOR_SCORE else 0.0

    blob = _blob(place)
    name = _fold(str(place.get("name") or ""))
    exact_terms = [term for term in intent.query_terms if len(term) >= 4]
    if any(term in name or term in blob for term in exact_terms):
        return 1.0
    related_terms = [term for term in intent.product_terms if len(term) >= 4 and term not in exact_terms]
    if any(_has_signal(blob, term) or term in blob for term in related_terms):
        return 0.72
    if intent.product_terms:
        if any(len(term) >= 4 and term in name for term in intent.product_terms):
            return 1.0
        if any(len(term) >= 4 and term in blob for term in intent.product_terms):
            return 0.9
    if intent.category:
        signals = _CATEGORY_SIGNALS.get(intent.category, ())
        if any(_has_signal(blob, signal) for signal in signals):
            if intent.product_terms:
                return 0.55 if any(_has_signal(name, signal) for signal in signals) else 0.45
            return 1.0 if any(_has_signal(name, signal) for signal in signals) else 0.85
    for keyword in intent.keywords:
        needle = _fold(keyword)
        if len(needle) >= 4 and needle in name:
            return 1.0
        if len(needle) >= 4 and needle in blob:
            return 0.8
    if intent.category:
        for other, signals in _CATEGORY_SIGNALS.items():
            if other == intent.category:
                continue
            if any(_has_signal(blob, signal) for signal in signals):
                return 0.0
    if vector_score is not None and vector_score >= MIN_VECTOR_SCORE:
        return float(vector_score)
    source = str(place.get("source") or "")
    if source in {"places_api", "maps", "google", "google_maps"}:
        type_blob = _fold(
            " ".join(
                [
                    name,
                    " ".join(str(item) for item in (place.get("types") or []) if isinstance(item, str)),
                    " ".join(str(item) for item in (place.get("categories") or []) if isinstance(item, str)),
                ]
            )
        )
        expanded = [*(intent.query_terms or []), *(intent.product_terms or [])]
        if any(len(term) >= 4 and term in type_blob for term in expanded):
            return 0.7
    return 0.0


def is_relevant(place: dict[str, Any], intent: SearchIntent, vector_score: float | None = None) -> bool:
    return relevance_score(place, intent, vector_score) > 0


def equity_bonus(place: dict[str, Any], *, prefer_local: bool) -> float:
    """Re-rank bonus after relevance. Capped at +0.5 so it cannot admit a miss."""
    del prefer_local
    raw = 0.0
    if place.get("local_business") is True or place.get("is_local") is True or place.get("is_informal") is True:
        raw += 0.25
    if place.get("accessible") is True:
        raw += 0.10
    completeness = place.get("completeness")
    if isinstance(completeness, (int, float)) and float(completeness) >= 0.7:
        raw += 0.05
    if place.get("photo_url") or place.get("photos"):
        raw += 0.05
    confirmed = place.get("confirmations_count")
    if place.get("recently_confirmed") is True or (isinstance(confirmed, int) and confirmed > 0):
        raw += 0.05
    if place.get("open_now") is True:
        raw += 0.05
    return min(BONUS_CAP, raw)


def why_line(place: dict[str, Any], intent: SearchIntent) -> str:
    """One line explaining the match, using only words that are actually in the listing."""
    blob = _blob(place)
    name = _fold(str(place.get("name") or ""))
    km = place.get("_distance_km")
    if isinstance(km, (int, float)) and float(km) * 1000 < 20:
        distance = "Here"
    elif isinstance(km, (int, float)) and float(km) < 1:
        distance = f"{int(float(km) * 1000)} m"
    elif isinstance(km, (int, float)):
        distance = f"{float(km):.1f} km"
    else:
        distance = ""
    exact = next((term for term in intent.query_terms if len(term) >= 4 and term in blob), "")
    if exact and exact in name:
        label = name.split(exact)[0].strip() or exact
        return f"{exact} — {distance}".strip(" —") if distance else exact
    if exact:
        return f"Mentions {exact} in its description" + (f" — {distance}" if distance else "")
    related = next((term for term in intent.product_terms if len(term) >= 4 and term in blob), "")
    if related and distance:
        return f"{related} — {distance}"
    if related:
        return related
    return distance


def proximity_factor(place: dict[str, Any]) -> float:
    """1 beside the user, down to 0.25 at 15 km. Unknown distance stays neutral."""
    km = place.get("_distance_km")
    if not isinstance(km, (int, float)):
        return 1.0
    return max(0.25, 1.0 - min(float(km), 15.0) / 15.0 * 0.75)


def listing_is_public(doc: dict[str, Any]) -> bool:
    """Validated listings only. Pending, paused, archived and deleted stay out of search."""
    if doc.get("paused") is True or doc.get("archived") is True:
        return False
    if doc.get("deleted_at") or doc.get("deletedAt"):
        return False
    status = doc.get("status")
    return status in (None, "", "validated")


def final_score(place: dict[str, Any], intent: SearchIntent, *, prefer_local: bool) -> float:
    relevance = place.get("_relevance")
    rel = float(relevance) if isinstance(relevance, (int, float)) else relevance_score(place, intent)
    if rel <= 0:
        return 0.0
    rating = float(place.get("rating") or 0.0)
    return rel * proximity_factor(place) * (1.0 + equity_bonus(place, prefer_local=prefer_local)) + rating * 0.01


def detect_lang(text: str) -> str:
    folded = _fold(text)
    if re.search(r"\b(ndashaka|inyanya|murakoze|hejuru|aho|isoko|mwiriwe|bite)\b", folded):
        return "rw"
    if re.search(r"\b(je|des|une|près|pres|trouver|cherche|hôtel|tomates|marché|s'il)\b", folded) or "é" in (text or "").lower():
        return "fr"
    return "en"


def extracted_keyword(text: str) -> str:
    """The product word the user typed, after filler is removed. Never the raw sentence."""
    intent = extract_search_intent(text)
    stop = {
        "the", "and", "for", "near", "with", "want", "need", "like", "find", "show",
        "please", "looking", "where", "can", "how", "are", "you", "buy",
        "cherche", "veux", "acheter", "des", "une", "pour", "pres", "moi",
    }
    for word in re.findall(r"[a-z0-9']{3,}", _fold(text)):
        if word in stop:
            continue
        if any(word == term or word in term or term in word for term in intent.query_terms):
            return word
    for term in intent.query_terms:
        if len(term) >= 4:
            return term
    return "that"


def draft_reply(places: list[dict[str, Any]], request: str, *, widen: bool = False) -> str:
    """Short reply that names only places in the list, in the user's language."""
    lang = detect_lang(request)
    keyword = extracted_keyword(request)
    if not places:
        empty = {
            "en": f"I couldn't find places for '{keyword}' near you.",
            "fr": f"Je n'ai pas trouvé de lieu pour '{keyword}' près de toi.",
            "rw": f"Sinabonye ahantu ku '{keyword}' hafi yawe.",
        }
        if widen:
            offer = {
                "en": " I can widen the area if you want.",
                "fr": " Je peux élargir la zone si tu veux.",
                "rw": " Nshobora kongera umupaka niba ubishaka.",
            }
            return empty[lang] + offer[lang]
        return empty[lang]

    best = places[0]
    name = str(best.get("name") or "this place")
    why: list[str] = []
    if best.get("open_now") is True:
        why.append({"en": "open now", "fr": "ouvert maintenant", "rw": "burafunguye"}[lang])
    if best.get("accessible") is True:
        why.append({"en": "step-free entrance", "fr": "entrée sans marche", "rw": "injira utavuyemo amateka"}[lang])
    rating = best.get("rating")
    if isinstance(rating, (int, float)) and not why:
        why.append({"en": f"rated {rating}", "fr": f"noté {rating}", "rw": f"amanota {rating}"}[lang])
    reason = ", ".join(why)

    lead = {
        "en": f"{name} is the closest match" + (f" ({reason})" if reason else "") + ".",
        "fr": f"{name} est le meilleur choix" + (f" ({reason})" if reason else "") + ".",
        "rw": f"{name} ni yo ihuje neza" + (f" ({reason})" if reason else "") + ".",
    }[lang]
    alts = [str(place.get("name") or "") for place in places[1:4] if place.get("name")]
    if not alts:
        return lead
    label = {"en": "Also nearby:", "fr": "Aussi à proximité :", "rw": "Ibindi hafi:"}[lang]
    bullets = "\n".join(f"- {alt}" for alt in alts)
    return f"{lead}\n{label}\n{bullets}"
