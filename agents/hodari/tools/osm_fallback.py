"""Free place search from OpenStreetMap (Overpass + Nominatim). No API key, no billing.

Used as a fallback when Google Places (New) is unavailable (no key, 403, quota).
Results are normalized to the same shape as maps_client._normalize_place so the
rest of the discovery pipeline does not need to know where a place came from.
Turn it off with HODARI_OSM_FALLBACK=0.
"""

from __future__ import annotations

import logging
import math
import os
import re
import unicodedata
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_OVERPASS_URLS = [
    u.strip()
    for u in os.getenv(
        "OSM_OVERPASS_URLS",
        "https://overpass-api.de/api/interpreter,https://overpass.private.coffee/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter,https://overpass.kumi.systems/api/interpreter",
    ).split(",")
    if u.strip()
]
_NOMINATIM_URL = os.getenv("OSM_NOMINATIM_URL", "https://nominatim.openstreetmap.org/search")
_UA = os.getenv("OSM_USER_AGENT", "MapForAll-local-demo/1.0 (https://github.com/Jocos12/MapForAll)")

# Google place type -> (OSM tag filters, Google-style categories to report)
_TYPE_TAGS: dict[str, tuple[list[str], list[str]]] = {
    "cafe": (['"amenity"="cafe"'], ["cafe", "food"]),
    "coffee_shop": (['"amenity"="cafe"'], ["cafe", "coffee_shop", "food"]),
    "restaurant": (['"amenity"="restaurant"', '"amenity"="fast_food"', '"amenity"="food_court"'], ["restaurant", "food"]),
    "fast_food_restaurant": (['"amenity"="fast_food"'], ["fast_food_restaurant", "restaurant", "food"]),
    "bar": (['"amenity"="bar"', '"amenity"="pub"'], ["bar"]),
    "night_club": (['"amenity"="nightclub"'], ["night_club"]),
    "bakery": (['"shop"="bakery"'], ["bakery", "food"]),
    "pharmacy": (['"amenity"="pharmacy"', '"shop"="chemist"'], ["pharmacy", "health"]),
    "drugstore": (['"amenity"="pharmacy"'], ["pharmacy", "drugstore", "health"]),
    "hospital": (['"amenity"="hospital"'], ["hospital", "health"]),
    "doctor": (['"amenity"="clinic"', '"amenity"="doctors"'], ["doctor", "health"]),
    "dentist": (['"amenity"="dentist"'], ["dentist", "health"]),
    "hotel": (['"tourism"="hotel"', '"tourism"="guest_house"', '"tourism"="hostel"'], ["hotel", "lodging"]),
    "lodging": (['"tourism"="hotel"', '"tourism"="guest_house"', '"tourism"="hostel"', '"tourism"="motel"'], ["lodging"]),
    "supermarket": (['"shop"="supermarket"'], ["supermarket", "grocery_store", "store"]),
    "grocery_store": (['"shop"="supermarket"', '"shop"="convenience"', '"shop"="greengrocer"'], ["grocery_store", "store"]),
    "convenience_store": (['"shop"="convenience"'], ["convenience_store", "store"]),
    "market": (['"amenity"="marketplace"'], ["market"]),
    "shopping_mall": (['"shop"="mall"'], ["shopping_mall"]),
    "clothing_store": (['"shop"="clothes"'], ["clothing_store", "store"]),
    "store": (['"shop"'], ["store"]),
    "bank": (['"amenity"="bank"'], ["bank", "finance"]),
    "atm": (['"amenity"="atm"'], ["atm", "finance"]),
    "school": (['"amenity"="school"'], ["school"]),
    "university": (['"amenity"="university"', '"amenity"="college"'], ["university"]),
    "library": (['"amenity"="library"'], ["library"]),
    "museum": (['"tourism"="museum"'], ["museum", "tourist_attraction"]),
    "tourist_attraction": (['"tourism"="attraction"', '"tourism"="museum"', '"tourism"="viewpoint"', '"historic"'], ["tourist_attraction"]),
    "park": (['"leisure"="park"', '"leisure"="garden"'], ["park"]),
    "gym": (['"leisure"="fitness_centre"'], ["gym"]),
    "stadium": (['"leisure"="stadium"'], ["stadium"]),
    "gas_station": (['"amenity"="fuel"'], ["gas_station"]),
    "bus_station": (['"amenity"="bus_station"', '"highway"="bus_stop"'], ["bus_station", "transit_station"]),
    "transit_station": (['"amenity"="bus_station"', '"public_transport"="station"'], ["transit_station"]),
    "parking": (['"amenity"="parking"'], ["parking"]),
    "church": (['"amenity"="place_of_worship"'], ["church", "place_of_worship"]),
    "mosque": (['"amenity"="place_of_worship"'], ["mosque", "place_of_worship"]),
    "place_of_worship": (['"amenity"="place_of_worship"'], ["place_of_worship"]),
    "police": (['"amenity"="police"'], ["police"]),
    "post_office": (['"amenity"="post_office"'], ["post_office"]),
    "beauty_salon": (['"shop"="beauty"', '"shop"="hairdresser"'], ["beauty_salon"]),
    "hair_care": (['"shop"="hairdresser"'], ["hair_care", "beauty_salon"]),
}

# Words in a free-text query -> Google place type (FR / EN / RW)
_KEYWORDS: list[tuple[str, str]] = [
    (r"\b(cafe|cafes|coffee|kawa)\b", "cafe"),
    (r"\b(restaurant|restaurants|resto|food|manger|nourriture|resitora)\b", "restaurant"),
    (r"\b(fast ?food|burger|pizza)\b", "fast_food_restaurant"),
    (r"\b(bar|bars|pub|akabari)\b", "bar"),
    (r"\b(boulangerie|bakery|pain)\b", "bakery"),
    (r"\b(pharmacie|pharmacy|pharmacies|farumasi)\b", "pharmacy"),
    (r"\b(hopital|hospital|ibitaro)\b", "hospital"),
    (r"\b(clinique|clinic|docteur|doctor|medecin)\b", "doctor"),
    (r"\b(dentiste|dentist)\b", "dentist"),
    (r"\b(hotel|hotels|hebergement|logement|lodging|guest ?house|hostel|auberge)\b", "lodging"),
    (r"\b(supermarche|supermarket|supermarkets)\b", "supermarket"),
    (r"\b(epicerie|grocery|alimentation|boutique)\b", "grocery_store"),
    (r"\b(marche|marches|market|markets|isoko)\b", "market"),
    (r"\b(mall|centre commercial)\b", "shopping_mall"),
    (r"\b(vetements|clothes|clothing|habits)\b", "clothing_store"),
    (r"\b(magasin|shop|shops|store|stores|commerce|commerces)\b", "store"),
    (r"\b(banque|bank|banks|banki)\b", "bank"),
    (r"\b(atm|distributeur|guichet)\b", "atm"),
    (r"\b(ecole|school|ishuri)\b", "school"),
    (r"\b(universite|university|college|kaminuza)\b", "university"),
    (r"\b(bibliotheque|library)\b", "library"),
    (r"\b(musee|museum|museums|memorial)\b", "museum"),
    (r"\b(touris|attraction|attractions|a visiter|visit|sightseeing)\w*", "tourist_attraction"),
    (r"\b(parc|park|parks|jardin|garden)\b", "park"),
    (r"\b(gym|salle de sport|fitness)\b", "gym"),
    (r"\b(stade|stadium)\b", "stadium"),
    (r"\b(station.?service|essence|fuel|gas station|carburant)\b", "gas_station"),
    (r"\b(bus|gare|arret|moto|taxi|transport)\b", "transit_station"),
    (r"\b(parking)\b", "parking"),
    (r"\b(eglise|church|kiliziya)\b", "church"),
    (r"\b(mosquee|mosque)\b", "mosque"),
    (r"\b(police)\b", "police"),
    (r"\b(poste|post office)\b", "post_office"),
    (r"\b(salon|coiffure|coiffeur|hair|beauty|beaute)\b", "beauty_salon"),
]

_NOMINATIM_PHRASE: dict[str, list[str]] = {
    "cafe": ["cafe"], "coffee_shop": ["cafe"], "restaurant": ["restaurant", "fast food"],
    "fast_food_restaurant": ["fast food"], "bar": ["bar", "pub"], "bakery": ["bakery"],
    "pharmacy": ["pharmacy"], "drugstore": ["pharmacy"], "hospital": ["hospital"], "doctor": ["clinic"],
    "dentist": ["dentist"], "hotel": ["hotel"], "lodging": ["hotel", "guest house"],
    "supermarket": ["supermarket"], "grocery_store": ["supermarket", "convenience store"],
    "market": ["marketplace"], "shopping_mall": ["mall"], "bank": ["bank"], "atm": ["atm"],
    "school": ["school"], "university": ["university"], "museum": ["museum"],
    "tourist_attraction": ["attraction", "museum"], "park": ["park"], "gym": ["fitness centre"],
    "gas_station": ["fuel"], "bus_station": ["bus station"], "place_of_worship": ["place of worship"],
    "church": ["church"], "mosque": ["mosque"], "police": ["police"], "post_office": ["post office"],
}

_STOP = {
    "pres", "de", "du", "des", "la", "le", "les", "a", "au", "aux", "dans", "near", "me", "moi", "the",
    "in", "at", "of", "un", "une", "around", "autour", "proche", "nearby", "kigali", "rwanda", "et",
    "and", "for", "pour", "ouvert", "open", "now", "maintenant", "best", "meilleur", "meilleurs", "bon",
    "bons", "good", "find", "trouve", "trouver", "cherche", "show", "montre", "accessible", "accessibles",
    "ouverte", "ouvert", "ouverts", "ouvertes", "cheap", "pas", "cher", "chere", "quartier", "area", "zone",
    "wheelchair", "fauteuil", "roulant", "with", "avec", "sur", "vers", "where", "ou", "est", "is", "what",
}


def enabled() -> bool:
    return (os.getenv("HODARI_OSM_FALLBACK", "1").strip().lower() not in ("0", "false", "no", "off"))


def _fold(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "")
    return "".join(c for c in text if not unicodedata.combining(c)).lower()


def guess_type(query: str) -> str | None:
    q = _fold(query)
    for pattern, place_type in _KEYWORDS:
        if re.search(pattern, q):
            return place_type
    return None


def _name_words(query: str) -> list[str]:
    """Words that look like part of a name (not stop words, not category words)."""
    words = re.findall(r"[a-z0-9]+", _fold(query))
    return [
        w for w in words
        if len(w) >= 3 and w not in _STOP and not any(re.search(p, w) for p, _ in _KEYWORDS)
    ]


def build_overpass_query(lat: float, lng: float, radius_m: float, place_type: str | None, name_words: list[str]) -> str:
    r = int(max(200, min(radius_m, 25000)))
    around = f"(around:{r},{lat:.6f},{lng:.6f})"
    clauses: list[str] = []
    if place_type and place_type in _TYPE_TAGS:
        for tag in _TYPE_TAGS[place_type][0]:
            clauses.append(f'nwr[{tag}]["name"]{around};')
    elif name_words:
        rx = "|".join(re.escape(w) for w in name_words[:4])
        clauses.append(f'nwr["name"~"{rx}",i]{around};')
    if not clauses:
        return ""
    return f"[out:json][timeout:12];({''.join(clauses)});out center tags 60;"


def _distance_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p = math.pi / 180
    a = 0.5 - math.cos((lat2 - lat1) * p) / 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * (1 - math.cos((lng2 - lng1) * p)) / 2
    return 12742000 * math.asin(math.sqrt(max(a, 0.0)))


def _address(tags: dict[str, str]) -> str:
    parts = [
        " ".join(p for p in (tags.get("addr:housenumber"), tags.get("addr:street")) if p),
        tags.get("addr:suburb") or tags.get("addr:neighbourhood") or "",
        tags.get("addr:city") or "",
    ]
    return ", ".join(p for p in parts if p)


def _category_for(tags: dict[str, str], fallback_type: str | None) -> list[str]:
    for place_type, (filters, cats) in _TYPE_TAGS.items():
        for f in filters:
            m = re.fullmatch(r'"([^"]+)"(?:="([^"]+)")?', f)
            if not m:
                continue
            key, value = m.group(1), m.group(2)
            if key in tags and (value is None or tags[key] == value):
                return list(cats)
    return list(_TYPE_TAGS[fallback_type][1]) if fallback_type in _TYPE_TAGS else ["point_of_interest"]


def _stock_photo(name: str, categories: list[str]) -> str:
    """Same themed Kigali photos the website uses when a place has no real picture."""
    text = _fold(f"{name} {' '.join(categories)}")
    if re.search(r"market|super|shop|store|grocery|duka|mall", text):
        return "/landing/kigali-market-real.jpg"
    if re.search(r"caf|coffee|bakery", text):
        return "/landing/kigali-table.jpg"
    if re.search(r"pharm|health|hospital|doctor|dentist", text):
        return "/landing/kigali-street-real.jpg"
    if re.search(r"hotel|lodg|museum|attraction|university|library|stadium", text):
        return "/landing/kigali-view-real.jpg"
    if re.search(r"restaurant|food|bar", text):
        return "/landing/kigali-city-real.jpg"
    return "/landing/kigali-hills.jpg"


def normalize_element(el: dict[str, Any], place_type: str | None, origin: tuple[float, float] | None = None) -> dict[str, Any] | None:
    tags = el.get("tags") or {}
    name = tags.get("name") or tags.get("name:fr") or tags.get("name:en")
    if not name:
        return None
    lat = el.get("lat") if el.get("lat") is not None else (el.get("center") or {}).get("lat")
    lng = el.get("lon") if el.get("lon") is not None else (el.get("center") or {}).get("lon")
    if lat is None or lng is None:
        return None
    osm_ref = f"osm_{el.get('type', 'node')}_{el.get('id')}"
    wheelchair = (tags.get("wheelchair") or "").lower()
    hours = tags.get("opening_hours")
    summary_bits = [b for b in (tags.get("cuisine", "").replace(";", ", "), f"Horaires : {hours}" if hours else "") if b]
    place = {
        "place_id": osm_ref,
        "name": name,
        "address": _address(tags),
        "coordinates": {"lat": float(lat), "lng": float(lng)},
        "categories": _category_for(tags, place_type),
        "rating": None,
        "price_level": None,
        "summary": " · ".join(summary_bits),
        "maps_url": f"https://www.openstreetmap.org/{el.get('type', 'node')}/{el.get('id')}",
        "website": tags.get("website") or tags.get("contact:website"),
        "phone": tags.get("phone") or tags.get("contact:phone"),
        "open_now": None,
        "opening_hours_text": hours,
        "personalization_score": 0.0,
        "local_business": False,
        "accessible": wheelchair in ("yes", "designated"),
        "status": "validated",
        "source": "openstreetmap",
        "photo_url": _stock_photo(name, _category_for(tags, place_type)),
        "user_ratings_total": None,
        "google_place_id": None,
        "confirmations_count": 0,
    }
    if origin:
        place["distance_m"] = round(_distance_m(origin[0], origin[1], float(lat), float(lng)))
    return place


_overpass_down_until = 0.0
_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}


async def _overpass(client: httpx.AsyncClient, query: str) -> list[dict[str, Any]]:
    """Try Overpass mirrors quickly; when all fail, skip Overpass for 10 minutes."""
    global _overpass_down_until
    import time
    if time.monotonic() < _overpass_down_until:
        return []
    for url in _OVERPASS_URLS[:1]:
        try:
            resp = await client.get(url, params={"data": query}, headers={"User-Agent": _UA}, timeout=httpx.Timeout(6.0, connect=3.0))
            if resp.status_code == 200:
                return (resp.json() or {}).get("elements") or []
            logger.info("OSM overpass HTTP %s from %s", resp.status_code, url)
        except Exception as exc:  # try the next mirror
            logger.info("OSM overpass error from %s: %s %r", url, type(exc).__name__, exc)
    _overpass_down_until = time.monotonic() + 600
    logger.info("OSM overpass unreachable: using Nominatim only for 10 minutes")
    return []


_nominatim_last = 0.0


async def _nominatim(client: httpx.AsyncClient, query: str, lat: float, lng: float, radius_m: float) -> list[dict[str, Any]]:
    global _nominatim_last
    import asyncio, time
    wait = 1.1 - (time.monotonic() - _nominatim_last)  # Nominatim policy: max 1 request/second
    if wait > 0:
        await asyncio.sleep(wait)
    _nominatim_last = time.monotonic()
    d = max(radius_m, 5000) / 111_000
    params = {
        "q": query, "format": "jsonv2", "limit": 25, "addressdetails": 0, "extratags": 1,
        "viewbox": f"{lng - d},{lat + d},{lng + d},{lat - d}", "bounded": 1,
    }
    try:
        resp = await client.get(_NOMINATIM_URL, params=params, headers={"User-Agent": _UA}, timeout=10.0)
        if resp.status_code != 200:
            logger.info("OSM nominatim HTTP %s", resp.status_code)
            return []
        out = []
        for row in resp.json() or []:
            tags = dict(row.get("extratags") or {})
            tags.setdefault("name", row.get("name") or (row.get("display_name") or "").split(",")[0])
            if row.get("category") and row.get("type"):
                tags.setdefault(row["category"], row["type"])
            out.append({
                "type": row.get("osm_type", "node"), "id": row.get("osm_id"),
                "lat": float(row["lat"]), "lon": float(row["lon"]), "tags": tags,
                "_address": row.get("display_name", ""),
            })
        return out
    except Exception as exc:
        logger.info("OSM nominatim error: %s", exc)
        return []


# ── Real photos (free): Wikimedia Commons via OSM's image / wikimedia_commons / wikidata tags ──
_COMMONS_API = "https://commons.wikimedia.org/w/api.php"
_WIKIDATA_API = "https://www.wikidata.org/w/api.php"
_photo_cache: dict[str, str | None] = {}


async def _commons_thumb(client: httpx.AsyncClient, filename: str) -> str | None:
    title = filename if filename.startswith("File:") else f"File:{filename}"
    resp = await client.get(
        _COMMONS_API,
        params={"action": "query", "titles": title, "prop": "imageinfo", "iiprop": "url", "iiurlwidth": 900, "format": "json"},
        headers={"User-Agent": _UA},
        timeout=httpx.Timeout(4.0, connect=3.0),
    )
    pages = ((resp.json() or {}).get("query") or {}).get("pages") or {}
    for page in pages.values():
        info = (page.get("imageinfo") or [{}])[0]
        url = info.get("thumburl") or info.get("url")
        if url:
            return url
    return None


async def _photo_for_tags(client: httpx.AsyncClient, tags: dict[str, str]) -> str | None:
    key = tags.get("wikimedia_commons") or tags.get("wikidata") or tags.get("image") or ""
    if not key:
        return None
    if key in _photo_cache:
        return _photo_cache[key]
    url: str | None = None
    try:
        image = (tags.get("image") or "").strip()
        commons = (tags.get("wikimedia_commons") or "").strip()
        if image.startswith("https://upload.wikimedia.org/"):
            url = image
        elif "commons.wikimedia.org/wiki/File:" in image:
            url = await _commons_thumb(client, image.split("/wiki/", 1)[1])
        elif commons.startswith("File:"):
            url = await _commons_thumb(client, commons)
        elif tags.get("wikidata", "").startswith("Q"):
            resp = await client.get(
                _WIKIDATA_API,
                params={"action": "wbgetclaims", "entity": tags["wikidata"], "property": "P18", "format": "json"},
                headers={"User-Agent": _UA},
                timeout=httpx.Timeout(4.0, connect=3.0),
            )
            claims = ((resp.json() or {}).get("claims") or {}).get("P18") or []
            filename = (((claims[0] if claims else {}).get("mainsnak") or {}).get("datavalue") or {}).get("value")
            if filename:
                url = await _commons_thumb(client, filename)
    except Exception as exc:
        logger.info("OSM photo lookup failed for %s: %s", key, exc)
        url = None
    _photo_cache[key] = url
    return url


async def search_osm_places(
    text_query: str, lat: float, lng: float, radius_m: float,
    *, included_type: str | None = None, page_size: int = 10,
) -> list[dict[str, Any]]:
    """Places near (lat, lng) matching the query, nearest first. Never raises."""
    import time
    place_type = included_type if included_type in _TYPE_TAGS else guess_type(text_query)
    words = _name_words(text_query)
    cache_key = f"{_fold(text_query)}|{place_type}|{lat:.3f},{lng:.3f}|{int(radius_m)}"
    hit = _cache.get(cache_key)
    if hit and time.monotonic() - hit[0] < 600:
        return [dict(p) for p in hit[1]][: max(1, page_size)]
    async with httpx.AsyncClient() as client:
        elements: list[dict[str, Any]] = []
        if place_type and words:
            # "Cafés près de AUCA Gishushu": search around the named place, not the user.
            anchor = await _nominatim(client, " ".join(words), lat, lng, 30000)
            if anchor:
                lat, lng = anchor[0]["lat"], anchor[0]["lon"]
                logger.info("OSM recentred on %r -> %.5f,%.5f", " ".join(words), lat, lng)
                words = []
        query = build_overpass_query(lat, lng, radius_m, place_type, words)
        if query:
            elements = await _overpass(client, query)
        # Names that contain the typed word ("burger" -> Burger Planet) come first.
        named = await _nominatim(client, text_query, lat, lng, radius_m) if text_query.strip() else []
        named_keys = {_fold((e.get("tags") or {}).get("name", "")) for e in named}
        if not elements and place_type in _NOMINATIM_PHRASE:
            # Overpass busy/unreachable: Nominatim understands "cafe", "pharmacy"... in a box.
            for phrase in _NOMINATIM_PHRASE[place_type]:
                elements += await _nominatim(client, phrase, lat, lng, radius_m)
        if not elements and words:
            # A named place ("AUCA Gishushu", "Kimironko Market"): ask the geocoder.
            elements = await _nominatim(client, text_query, lat, lng, radius_m)
            if not elements:
                elements = await _nominatim(client, " ".join(words), lat, lng, radius_m)

        elements = named + elements
        photo_jobs: list[tuple[dict[str, Any], dict[str, str]]] = []
        seen: set[str] = set()
        places: list[dict[str, Any]] = []
        for el in elements:
            place = normalize_element(el, place_type, origin=(lat, lng))
            if not place:
                continue
            if not place["address"] and el.get("_address"):
                place["address"] = ", ".join(el["_address"].split(", ")[1:4])
            key = _fold(place["name"])
            if key in seen:
                continue
            seen.add(key)
            places.append(place)
            if any(k in (el.get("tags") or {}) for k in ("wikidata", "wikimedia_commons", "image")):
                photo_jobs.append((place, el.get("tags") or {}))
        if photo_jobs:
            import asyncio
            try:
                photos = await asyncio.wait_for(
                    asyncio.gather(*(_photo_for_tags(client, tags) for _, tags in photo_jobs[:12]), return_exceptions=True),
                    timeout=6.0,
                )
            except asyncio.TimeoutError:
                photos = []
            for (place, _), photo in zip(photo_jobs, photos):
                if isinstance(photo, str) and photo:
                    place["photo_url"] = photo
                    place["photos"] = [photo]
                    place["photo_source"] = "Wikimedia Commons"

    if named_keys:
        places.sort(key=lambda p: (_fold(p["name"]) not in named_keys, p.get("distance_m", 0)))
    elif words and place_type:
        # Prefer places whose name also matches the extra words ("café Java" -> Java House first).
        places.sort(key=lambda p: (not any(w in _fold(p["name"]) for w in words), p.get("distance_m", 0)))
    else:
        places.sort(key=lambda p: p.get("distance_m", 0))
    logger.info(
        "OSM search query=%r type=%s words=%s radius=%s -> %d places",
        text_query, place_type or "-", words, int(radius_m), len(places),
    )
    _cache[cache_key] = (time.monotonic(), places)
    return places[: max(1, page_size)]
