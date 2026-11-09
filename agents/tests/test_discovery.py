"""Tests for fast discovery ranking helpers."""

from hodari.tools.discovery import _partition, _text_relevance, extract_place_limit, rank_places
from hodari.tools.query_intent import extracted_keyword, extract_search_intent, search_terms


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
        "_distance_km": 0.5,
    })
    ranked = rank_places(places, "i want tomatoes", limit=6)
    assert "Tomates Kigali" in [place["name"] for place in ranked[:3]]


def test_far_local_does_not_pass_a_close_match():
    close = {
        "place_id": "near",
        "name": "Tomato Shop",
        "categories": ["shop"],
        "description": "fresh tomatoes",
        "local_business": False,
        "_distance_km": 0.4,
    }
    far = {
        "place_id": "far",
        "name": "Tomates Kigali",
        "categories": ["shop"],
        "description": "tomates et legumes frais",
        "local_business": True,
        "_distance_km": 9,
    }
    ranked = rank_places([far, close], "tomatoes", limit=2)
    assert ranked[0]["name"] == "Tomato Shop"


def test_nearby_local_outranks_a_closer_supermarket():
    local = {
        "place_id": "local",
        "name": "Tomates Kigali",
        "categories": ["shop"],
        "description": "tomates et legumes frais",
        "local_business": True,
        "_distance_km": 0.5,
    }
    store = {
        "place_id": "google",
        "name": "Simba Supermarket",
        "categories": ["supermarket"],
        "local_business": False,
        "_distance_km": 0.4,
    }
    ranked = rank_places([store, local], "i want tomatoes", limit=2)
    assert ranked[0]["name"] == "Tomates Kigali"
    assert "tomate" in ranked[0]["why"]


def test_iphone_excludes_coffee_and_tomatoes():
    places = [
        {"place_id": "1", "name": "Question Coffee Café", "categories": ["cafe"], "local_business": True, "_distance_km": 0.05},
        {"place_id": "2", "name": "Tomates Kigali", "categories": ["shop"], "description": "tomates et legumes", "local_business": True, "_distance_km": 0.1},
        {"place_id": "3", "name": "Kigali Phone Shop", "categories": ["shop"], "description": "iphone and smartphone repair", "local_business": True, "_distance_km": 0.4},
        {"place_id": "4", "name": "Electronics Store", "categories": ["electronics"], "local_business": False, "_distance_km": 1.2},
    ]
    ranked = rank_places(places, "where can I find an iPhone", limit=8)
    names = [place["name"] for place in ranked]
    assert "Question Coffee Café" not in names
    assert "Tomates Kigali" not in names
    assert names[0] == "Kigali Phone Shop"
    assert "Electronics Store" in names


def test_tomatoes_starts_with_the_local_stall_and_skips_phones():
    places = [
        {"place_id": "p", "name": "Kigali Phone Shop", "categories": ["shop"], "description": "iphone repair", "local_business": True, "_distance_km": 0.2},
        {"place_id": "m", "name": "Kimironko Market", "categories": ["market"], "local_business": True, "_distance_km": 1.0},
        {"place_id": "t", "name": "Tomates Kigali", "categories": ["shop"], "description": "tomates et legumes frais", "local_business": True, "_distance_km": 0.5},
    ]
    ranked = rank_places(places, "i want tomatoes", limit=8)
    names = [place["name"] for place in ranked]
    assert names[0] == "Tomates Kigali"
    assert "Kimironko Market" in names
    assert "Kigali Phone Shop" not in names


def test_coffee_stays_on_coffee_places():
    places = [
        {"place_id": "c", "name": "Question Coffee Café", "categories": ["cafe"], "description": "coffee", "_distance_km": 0.3},
        {"place_id": "t", "name": "Tomates Kigali", "categories": ["shop"], "description": "tomates", "_distance_km": 0.1},
    ]
    ranked = rank_places(places, "coffee", limit=8)
    assert [place["name"] for place in ranked] == ["Question Coffee Café"]


def test_filler_questions_use_the_same_keyword():
    places = [
        {"place_id": "c", "name": "Question Coffee", "categories": ["cafe"], "description": "coffee", "local_business": True, "_distance_km": 0.1},
        {"place_id": "p", "name": "Kigali Phone Shop", "categories": ["shop"], "description": "iphone and electronics", "local_business": True, "_distance_km": 0.2},
        {"place_id": "g", "name": "Fresh Grocery", "categories": ["grocery"], "description": "vegetables and legumes", "local_business": False, "_distance_km": 1.4},
        {"place_id": "m", "name": "Kimironko Market", "categories": ["market"], "local_business": True, "_distance_km": 1.0},
        {"place_id": "t", "name": "Tomates Kigali", "categories": ["shop"], "description": "tomates et legumes frais", "local_business": True, "_distance_km": 0.5},
    ]
    queries = [
        "where can i find tomatoes",
        "i want tomatoes",
        "tomatoes",
        "tomates",
        "je cherche des tomates",
    ]
    seen: list[str] | None = None
    for query in queries:
        intent = extract_search_intent(query)
        kept, rejected = _partition(places, intent)
        ranked = rank_places(kept, query, limit=8)
        names = [place["name"] for place in ranked]
        print(
            "query", query,
            "keyword", extracted_keyword(query),
            "terms", search_terms(query, intent)[:8],
            "kept", len(kept),
            "excluded", rejected,
        )
        assert extracted_keyword(query) in {"tomatoes", "tomates"}
        assert _text_relevance(places[4], query) > 0
        assert names[0] == "Tomates Kigali"
        assert "Kimironko Market" in names
        assert "Fresh Grocery" in names
        assert "Kigali Phone Shop" not in names
        assert "Question Coffee" not in names
        assert seen is None or names == seen
        seen = names

    intent = extract_search_intent("where can i find an iPhone")
    kept, rejected = _partition(places, intent)
    ranked = rank_places(kept, "where can i find an iPhone", limit=8)
    names = [place["name"] for place in ranked]
    print("query iphone", "keyword", extracted_keyword("where can i find an iPhone"), "kept", len(kept), "excluded", rejected)
    assert extracted_keyword("where can i find an iPhone") == "iphone"
    assert names == ["Kigali Phone Shop"]
    assert "Tomates Kigali" not in names
    assert "Question Coffee" not in names


def test_rank_places_prefers_higher_rating():
    places = [
        {"place_id": "a", "name": "A Restaurant", "rating": 4.1, "categories": ["restaurant"]},
        {"place_id": "b", "name": "B Restaurant", "rating": 4.8, "categories": ["restaurant"]},
        {"place_id": "c", "name": "C Restaurant", "rating": 4.5, "categories": ["restaurant"]},
        {"place_id": "h", "name": "Radisson Hotel", "rating": 5.0, "categories": ["hotel"]},
    ]
    ranked = rank_places(places, "find restaurants", limit=2)
    assert [p["name"] for p in ranked] == ["B Restaurant", "C Restaurant"]
