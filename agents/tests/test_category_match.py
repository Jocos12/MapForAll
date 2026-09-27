from hodari.tools.category_match import keep_for_category, requested_category


def test_hotel_request_drops_supermarkets():
    places = [
        {"name": "Ndoli's Joint Supermarket", "categories": ["market"]},
        {"name": "La Galette Supermarket", "categories": ["shop"]},
        {"name": "Kigali Marriott Hotel", "categories": ["hotel"]},
        {"name": "Ubumwe Grande Hotel", "categories": ["hotel"]},
    ]
    assert requested_category("trouve-moi des hôtels à Kigali") == "hotel"
    kept = keep_for_category(places, "hotel")
    assert [p["name"] for p in kept] == ["Kigali Marriott Hotel", "Ubumwe Grande Hotel"]


def test_pharmacy_and_clinic_are_distinct():
    assert requested_category("une pharmacie près de moi") == "pharmacy"
    assert requested_category("un centre de santé") == "clinic"
    places = [
        {"name": "Pharmacie Conseil", "categories": ["pharmacy"]},
        {"name": "Legacy Clinics", "categories": ["clinic"]},
        {"name": "Kimironko Market", "categories": ["market"]},
    ]
    assert [p["name"] for p in keep_for_category(places, "pharmacy")] == ["Pharmacie Conseil"]
    assert [p["name"] for p in keep_for_category(places, "clinic")] == ["Legacy Clinics"]


def test_open_request_keeps_every_place():
    places = [{"name": "A"}, {"name": "B"}]
    assert requested_category("où aller ce soir") is None
    assert keep_for_category(places, None) == places
