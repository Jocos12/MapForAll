"""Tomatoes must not rank hotels, and bonuses cannot outrank relevance."""

from hodari.intent import LIST_DISCOVERY, classify_intent
from hodari.tools.query_intent import (
    BONUS_CAP,
    draft_reply,
    equity_bonus,
    extract_search_intent,
    final_score,
    is_relevant,
    listing_is_public,
    modifier_only,
    parse_user_location,
    search_terms,
)


def test_tomatoes_map_to_market_keywords():
    intent = extract_search_intent("I want to find tomatoes near my place")
    assert intent.category == "market"
    assert intent.open_query is False
    assert "supermarket" in intent.maps_query
    assert any("tomato" in word for word in intent.keywords)


def test_french_and_kinyarwanda_tomatoes():
    assert extract_search_intent("je cherche des tomates").category == "market"
    assert extract_search_intent("ndashaka inyanya").category == "market"


def test_hotels_stay_hotels():
    intent = extract_search_intent("hotels in Kigali")
    assert intent.category == "hotel"


def test_hotel_is_not_relevant_for_tomatoes():
    intent = extract_search_intent("I want to find tomatoes near my place")
    hotel = {"name": "Radisson Blu Hotel Kigali", "categories": ["hotel"], "rating": 4.8, "accessible": True, "source": "owner_claimed"}
    market = {"name": "Kimironko Market", "categories": ["market"], "rating": 4.2}
    vista = {"name": "Vista Supermarket", "categories": ["shop"], "summary": "grocery supermarket"}
    assert is_relevant(hotel, intent) is False
    assert is_relevant(market, intent) is True
    assert is_relevant(vista, intent) is True


def test_tomates_kigali_matches_every_tomato_query():
    place = {
        "name": "Tomates Kigali",
        "categories": ["shop"],
        "description": "tomates et légumes frais",
        "tags": ["Tomates", "Marches"],
        "local_business": True,
        "status": "validated",
    }
    for text in ("Tomates Kigali", "tomates", "tomatoes", "i want tomatoes"):
        intent = extract_search_intent(text)
        assert intent.category == "market"
        assert any(term.startswith("tomat") for term in search_terms(text, intent))
        assert is_relevant(place, intent) is True
    assert listing_is_public(place) is True
    assert listing_is_public({"status": "pending", "name": "Tomates Kigali"}) is False
    assert listing_is_public({"status": "validated", "paused": True}) is False
    assert equity_bonus({"local_business": True}, prefer_local=False) == BONUS_CAP


def test_bonus_cannot_admit_or_outrank_an_irrelevant_place():
    intent = extract_search_intent("tomatoes")
    hotel = {
        "name": "Radisson Blu Hotel Kigali",
        "categories": ["hotel"],
        "rating": 4.8,
        "accessible": True,
        "local_business": True,
        "personalization_score": 1,
        "_relevance": 0,
    }
    market = {"name": "Kimironko Market", "categories": ["market"], "rating": 3.5, "_relevance": 1}
    assert equity_bonus(hotel, prefer_local=True) <= BONUS_CAP
    assert final_score(hotel, intent, prefer_local=True) == 0
    assert final_score(market, intent, prefer_local=True) > final_score(hotel, intent, prefer_local=True)


def test_vector_score_below_floor_is_rejected():
    intent = extract_search_intent("tomatoes")
    place = {"name": "Random Hall", "categories": ["attraction"]}
    assert is_relevant(place, intent, vector_score=0.4) is False
    assert is_relevant(place, intent, vector_score=0.72) is True


def test_article_plus_category_is_a_category_search():
    for text in (
        "where can i find the Hotel?",
        "the Hotel",
        "a hotel",
        "hotels",
        "where can I find a university?",
    ):
        intent = extract_search_intent(text)
        assert intent.open_query is False, text
    assert extract_search_intent("where can i find the Hotel?").category == "hotel"
    assert extract_search_intent("a hotel").category == "hotel"
    assert extract_search_intent("where can I find a university?").category == "university"
    assert extract_search_intent("a supermarket").category == "market"
    assert extract_search_intent("a burger").category == "restaurant"
    assert classify_intent("where can i find the Hotel?") == LIST_DISCOVERY
    assert classify_intent("where can I find a university?") == LIST_DISCOVERY


def test_follow_up_keeps_a_modifier_without_a_new_category():
    assert modifier_only("near my location") == "near"
    assert modifier_only("closer") == "closer"
    assert modifier_only("open now") == "open_now"
    assert modifier_only("cheaper") == "cheaper"
    assert modifier_only("another one") == "more"
    assert modifier_only("more") == "more"
    assert modifier_only("near my location\n[User location: -1.9441, 30.0619]") == "near"
    assert modifier_only("where can i find the Hotel?") is None
    assert classify_intent("near my location") == LIST_DISCOVERY
    assert parse_user_location("where can i find the Hotel?\n[User location: -1.9297, 30.0764]") == (-1.9297, 30.0764)
    assert parse_user_location("Find hotels near my location [-1.9297, 30.0764]") == (-1.9297, 30.0764)
    assert classify_intent("closer") == LIST_DISCOVERY
    assert classify_intent("more") == LIST_DISCOVERY


def test_google_place_types_pass_the_category_gate():
    hotel_intent = extract_search_intent("where can i find the Hotel?")
    lodging = {"name": "Kigali Marriott", "types": ["lodging"], "categories": ["lodging"]}
    bank = {"name": "Bank of Kigali", "types": ["bank"], "categories": ["bank"]}
    assert is_relevant(lodging, hotel_intent) is True
    assert is_relevant(bank, hotel_intent) is False

    uni_intent = extract_search_intent("where can I find a university?")
    campus = {"name": "University of Rwanda", "types": ["university"], "categories": ["university"]}
    assert is_relevant(campus, uni_intent) is True
    assert is_relevant(lodging, uni_intent) is False

    market_intent = extract_search_intent("where can I find a supermarket?")
    grocery = {"name": "Sawa City", "types": ["grocery_store", "supermarket"], "categories": ["grocery_store", "supermarket"]}
    store_only = {"name": "Simba", "types": ["grocery_store"], "categories": ["grocery_store"]}
    assert is_relevant(grocery, market_intent) is True
    assert is_relevant(store_only, market_intent) is True
    assert is_relevant(lodging, market_intent) is False


def test_empty_live_search_offers_a_wider_radius():
    text = draft_reply([], "where can i find the Hotel?", widen=True)
    assert "widen" in text.lower()


def test_draft_names_only_the_list():
    places = [
        {"name": "Vista Supermarket", "rating": 4.4, "accessible": True},
        {"name": "Kimironko Market", "rating": 4.2},
    ]
    text = draft_reply(places, "I want to find tomatoes near my place")
    assert "Vista Supermarket" in text
    assert "Kimironko Market" in text
    assert "Radisson" not in text
    assert "hotel" not in text.lower()
