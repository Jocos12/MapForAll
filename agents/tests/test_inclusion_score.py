"""MapForAll inclusion scoring: local bonus, accessible bonus, hard filter."""

import time

from hodari.tools.discovery import inclusion_flags, rank_places
from hodari.tools.place_schema import ACCESS_BONUS, LOCAL_BONUS, inclusion_bonus, with_place_defaults


def _place(pid: str, rating: float, **flags) -> dict:
    return {
        "place_id": pid,
        "name": pid,
        "rating": rating,
        "price_level": "PRICE_LEVEL_MODERATE",
        **flags,
    }


def test_defaults_do_not_overwrite_existing_flags():
    doc = with_place_defaults({
        "name": "Kimironko",
        "local_business": True,
        "accessible": True,
        "status": "pending",
        "source": "user_submitted",
        "confirmations_count": 3,
    })
    assert doc["local_business"] is True
    assert doc["accessible"] is True
    assert doc["status"] == "pending"
    assert doc["source"] == "user_submitted"
    assert doc["confirmations_count"] == 3


def test_submitted_place_starts_pending():
    doc = with_place_defaults({"name": "Stall", "local_business": True, "accessible": False}, submitted=True)
    assert doc["status"] == "pending"
    assert doc["source"] == "user_submitted"
    assert doc["confirmations_count"] == 0


def test_missing_photo_and_description_still_rank():
    places = [
        _place("bare", 4.0, local_business=True),
        _place("chain", 4.0),
    ]
    ranked = rank_places(places, "food nearby", limit=5, prefer_local=True)
    assert ranked[0]["place_id"] == "bare"
    assert ranked[0].get("photo_url") is None
    assert ranked[0].get("description") is None


def test_local_bonus_outranks_equal_rating():
    places = [
        _place("chain", 4.2, local_business=False, accessible=False),
        _place("market", 4.2, local_business=True, accessible=False),
    ]
    ranked = rank_places(places, "lunch nearby", limit=5, prefer_local=True, require_accessible=False)
    assert [p["place_id"] for p in ranked] == ["market", "chain"]
    assert ranked[0]["prioritized"] is True
    assert ranked[1]["prioritized"] is False
    assert inclusion_bonus(places[1], prefer_local=True) == LOCAL_BONUS


def test_accessible_filter_drops_the_rest_and_still_bonuses():
    places = [
        _place("stairs", 4.9, local_business=True, accessible=False),
        _place("ramp", 4.0, local_business=False, accessible=True),
    ]
    ranked = rank_places(places, "coffee", limit=5, prefer_local=False, require_accessible=True)
    assert [p["place_id"] for p in ranked] == ["ramp"]
    assert inclusion_bonus(places[1], prefer_local=False) == ACCESS_BONUS


def test_flags_from_french_and_tokens():
    assert inclusion_flags("commerces locaux uniquement") == (True, False)
    assert inclusion_flags("lieux accessibles") == (False, True)
    assert inclusion_flags("prefer_local: nearby") == (True, False)
    assert inclusion_flags("require_accessible: nearby") == (False, True)
    assert inclusion_flags("lunch", prefer_local=False, require_accessible=False) == (False, False)


def test_rank_thirty_places_under_two_seconds():
    places = [
        _place(f"p{i}", 3.5 + (i % 10) / 10, local_business=i % 2 == 0, accessible=i % 3 == 0)
        for i in range(30)
    ]
    start = time.perf_counter()
    ranked = rank_places(places, "prefer_local require_accessible food", limit=10)
    elapsed = time.perf_counter() - start
    assert len(ranked) <= 10
    assert all(p["accessible"] is True for p in ranked)
    assert elapsed < 2.0
