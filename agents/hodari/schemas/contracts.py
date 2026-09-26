from __future__ import annotations
from typing import Optional
from pydantic import BaseModel


class Constraints(BaseModel):
    budget: Optional[str] = None
    time_available: Optional[str] = None
    dietary: Optional[list[str]] = None
    accessibility: Optional[list[str]] = None
    current_location: Optional[str] = None
    prefer_local: Optional[bool] = None
    require_accessible: Optional[bool] = None


class Subtask(BaseModel):
    description: str
    priority: int = 1


class Plan(BaseModel):
    goal: str
    constraints: Constraints
    subtasks: list[Subtask]


class Place(BaseModel):
    place_id: str
    name: str
    address: str
    coordinates: dict  # {"lat": float, "lng": float}
    categories: list[str] = []
    rating: Optional[float] = None
    price_level: Optional[str] = None
    summary: Optional[str] = None
    maps_url: Optional[str] = None
    personalization_score: float = 0.0
    local_business: bool = False
    accessible: bool = False
    status: Optional[str] = None
    source: Optional[str] = None
    photo_url: Optional[str] = None
    confirmations_count: int = 0


class CandidateSet(BaseModel):
    places: list[Place]


class TravelLeg(BaseModel):
    distance: str
    duration: str
    encoded_polyline: Optional[str] = None


class ItineraryStop(BaseModel):
    place: Place
    arrival_time: Optional[str] = None
    duration_at_stop: Optional[str] = None
    travel_from_prev: Optional[TravelLeg] = None
    rationale: str


class Itinerary(BaseModel):
    stops: list[ItineraryStop]
    total_duration: Optional[str] = None
    total_distance: Optional[str] = None
    voice_summary: str
