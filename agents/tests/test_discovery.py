"""Tests for fast discovery ranking helpers."""

from hodari.tools.discovery import extract_place_limit, rank_places


def test_extract_place_limit_from_request():
    assert extract_place_limit("Find 4 restaurants near Camp Nou") == 4
    assert extract_place_limit("find 2 restaurant near Amahoro stadium") == 2
    assert extract_place_limit("4 high-end restaurants near Camp Nou") == 4
    assert extract_place_limit("restaurants near stadium") == 5


def test_relevant_local_is_kept_in_the_first_three():
    places = [
        {"place_id": str(i), "name": f"Market {i}", "categories": ["market"], "rating": 5, "local_business": False}
        for i in range(5)
    ]
    places.append({
        "place_id": "t",
        "name": "Tomates Kigali",
        "categories": ["shop"],
        "description": "tomates et légumes frais",
        "rating": 1,
        "local_business": True,
        "_distance_km": 12,
    })
    ranked = rank_places(places, "i want tomatoes", limit=6)
    assert "Tomates Kigali" in [place["name"] for place in ranked[:3]]


def test_rank_places_prefers_higher_rating():
    places = [
        {"place_id": "a", "name": "A Restaurant", "rating": 4.1, "categories": ["restaurant"]},
        {"place_id": "b", "name": "B Restaurant", "rating": 4.8, "categories": ["restaurant"]},
        {"place_id": "c", "name": "C Restaurant", "rating": 4.5, "categories": ["restaurant"]},
        {"place_id": "h", "name": "Radisson Hotel", "rating": 5.0, "categories": ["hotel"]},
    ]
    ranked = rank_places(places, "find restaurants", limit=2)
    assert [p["name"] for p in ranked] == ["B Restaurant", "C Restaurant"]
