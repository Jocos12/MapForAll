"""Same venue must collapse to one result across sources."""

from hodari.tools.place_dedupe import dedupe_places


def test_same_place_id_merges():
    places = [
        {
            "place_id": "ChIJshared",
            "name": "Radisson Blu Hotel Kigali",
            "rating": 4.5,
            "coordinates": {"lat": -1.944, "lng": 30.061},
            "source": "catalog",
        },
        {
            "place_id": "ChIJshared",
            "name": "Radisson Blu",
            "rating": 4.8,
            "coordinates": {"lat": -1.950, "lng": 30.090},
            "source": "official",
        },
    ]
    merged = dedupe_places(places)
    assert len(merged) == 1
    assert merged[0]["rating"] == 4.8
    assert "catalog" in merged[0]["sources"]
    assert "official" in merged[0]["sources"]


def test_google_place_id_alias_merges():
    places = [
        {
            "place_id": "seed_radisson",
            "google_place_id": "ChIJradisson",
            "name": "Radisson Blu Hotel Kigali",
            "coordinates": {"lat": -1.944, "lng": 30.061},
            "source": "catalog",
        },
        {
            "place_id": "ChIJradisson",
            "name": "Radisson Blu Hotel Kigali",
            "coordinates": {"lat": -1.944, "lng": 30.062},
            "source": "official",
            "rating": 4.8,
        },
    ]
    assert len(dedupe_places(places)) == 1


def test_same_name_forty_meters_apart_merges_and_keeps_google_rating():
    # ~40 m north of the first pin. 1 degree of latitude is about 111.32 km.
    places = [
        {
            "place_id": "seed_rad",
            "name": "Radisson Blu Hotel Kigali",
            "rating": 4.5,
            "coordinates": {"lat": -1.9441, "lng": 30.0614},
            "source": "catalog",
            "summary": "Seeded listing with a long description of the hotel.",
            "personalization_score": 0.2,
        },
        {
            "place_id": "ChIJrealRadissonKigali",
            "name": "Radisson Blu Hotel Kigali",
            "rating": 4.8,
            "user_ratings_total": 2100,
            "coordinates": {"lat": -1.9441 + (40 / 111_320), "lng": 30.0614},
            "source": "official",
            "personalization_score": 0.6,
        },
    ]
    merged = dedupe_places(places)
    assert len(merged) == 1
    assert merged[0]["rating"] == 4.8
    assert merged[0]["user_ratings_total"] == 2100
    assert merged[0]["personalization_score"] == 0.6
    assert merged[0]["name"] == "Radisson Blu Hotel Kigali"
    assert merged[0]["summary"]


def test_same_name_city_only_address_merges_even_when_pins_are_far():
    """The seeded Radisson pin and the official listing share a name; one address is only the city."""
    places = [
        {
            "place_id": "kgl_demo_022",
            "name": "Radisson Blu Hotel Kigali",
            "address": "Gatenga, Kigali",
            "rating": 4.8,
            "source": "owner_claimed",
            "accessible": True,
            "coordinates": {"lat": -1.9891532805813223, "lng": 30.101172848050435},
        },
        {
            "place_id": "kgl_radisson",
            "name": "Radisson Blu Hotel Kigali",
            "address": "Kigali",
            "rating": 4.5,
            "source": "official",
            "coordinates": {"lat": -1.9544, "lng": 30.0942},
        },
    ]
    merged = dedupe_places(places)
    assert len(merged) == 1
    assert merged[0]["rating"] == 4.5
    assert merged[0]["accessible"] is True


def test_similar_hotels_far_apart_stay_separate():
    places = [
        {
            "place_id": "a",
            "name": "Hotel des Mille Collines",
            "rating": 4.4,
            "coordinates": {"lat": -1.944, "lng": 30.061},
            "source": "official",
        },
        {
            "place_id": "b",
            "name": "Mille Collines Hotel",
            "rating": 4.1,
            "coordinates": {"lat": -1.700, "lng": 29.700},
            "source": "official",
        },
    ]
    merged = dedupe_places(places)
    assert len(merged) == 2
    assert {place["place_id"] for place in merged} == {"a", "b"}


def test_accessible_flag_survives_merge():
    places = [
        {
            "place_id": "seed_cafe",
            "name": "Cafe Neo Kigali",
            "accessible": False,
            "local_business": False,
            "coordinates": {"lat": -1.9500, "lng": 30.0600},
            "source": "catalog",
            "summary": "Neighbourhood coffee shop.",
        },
        {
            "place_id": "ChIJcafeNeo",
            "name": "Cafe Neo Kigali",
            "accessible": True,
            "local_business": True,
            "access": {"entrance": True, "toilet": False, "parking": False},
            "coordinates": {"lat": -1.9502, "lng": 30.0600},
            "source": "official",
            "rating": 4.6,
        },
    ]
    merged = dedupe_places(places)
    assert len(merged) == 1
    assert merged[0]["accessible"] is True
    assert merged[0]["local_business"] is True
    assert merged[0]["access"]["entrance"] is True


def test_limit_backfills_after_duplicate_collapses():
    places = [
        {"place_id": "1", "name": "Alpha Hotel", "coordinates": {"lat": -1.90, "lng": 30.00}, "rating": 4.9},
        {"place_id": "1b", "name": "Alpha Hotel", "coordinates": {"lat": -1.9002, "lng": 30.00}, "rating": 4.2},
        {"place_id": "2", "name": "Bravo Hotel", "coordinates": {"lat": -1.92, "lng": 30.08}, "rating": 4.5},
        {"place_id": "3", "name": "Charlie Hotel", "coordinates": {"lat": -1.96, "lng": 30.12}, "rating": 4.0},
    ]
    merged = dedupe_places(places, limit=2)
    assert [place["name"] for place in merged] == ["Alpha Hotel", "Bravo Hotel"]
