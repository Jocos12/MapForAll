"""Lightweight intent routing for Hodari planning requests (Phase C)."""

from __future__ import annotations

import re

LIST_DISCOVERY = "LIST_DISCOVERY"
ITINERARY_PLANNING = "ITINERARY_PLANNING"
# Names used by the fast path. SIMPLE_SEARCH is the list search; PLAN is the full pipeline.
SIMPLE_SEARCH = LIST_DISCOVERY
PLAN = ITINERARY_PLANNING
CHAT = "CHAT"

_CHAT_PATTERNS = (
    r"^\s*(hi|hello|hey|thanks|thank you|murakoze|bonjour|salut|bonsoir|mwiriwe|bite)\b",
    r"\b(who are you|what can you do|help)\b",
)

_ITINERARY_PATTERNS = (
    r"\bitinerary\b",
    r"\bplan\s+(my|a|an|the)\b",
    r"\bfood tour\b",
    r"\bday trip\b",
    r"\bschedule\b",
    r"\b(add|include)\s+(a|another)\s+stop\b",
    r"\bwalking tour\b",
    r"\boptimi[sz]e\b",
    r"\btransport\b",
    r"\bmulti[- ]stop\b",
    r"\bwhat should i do\b",
    r"\b(route|loop)\b",
    r"\b\d+\s*[- ]?hours?\b.+\b(before|after|around|near)\b",
    r"\b(before|after)\s+the\s+match\b",
)

_LIST_PATTERNS = (
    r"\b(find|locate|list|search for|show me|recommend|suggest)\b",
    r"\b(best|top)\s+\d*\s*(restaurant|hotel|cafe|coffee|bar|places?)\b",
    r"\b\d+\s+(restaurant|restaurants|hotel|hotels|cafe|cafes|coffee|bars?|places?)\b",
    # Orchestrator often paraphrases: "4 high-end fine dining restaurants near X"
    r"\b\d{1,2}\b.+\b(restaurants?|hotels?|cafes?|coffee|bars?|places?)\b",
    r"\b(restaurants?|hotels?|cafes?|coffee|bars?|places?|universit\w*|banks?|pharmac\w*|hospitals?|burgers?|supermarkets?|markets?)\s+(near|around|close to)\b",
    r"\bwhere\s+(can|should)\s+i\s+(eat|drink|stay|find)\b",
    r"\bnearby\b",
)


def classify_intent(request: str) -> str:
    """Return LIST_DISCOVERY or ITINERARY_PLANNING for a user planning request."""
    lower = request.lower()

    for pattern in _ITINERARY_PATTERNS:
        if re.search(pattern, lower):
            return ITINERARY_PLANNING

    for pattern in _LIST_PATTERNS:
        if re.search(pattern, lower):
            return SIMPLE_SEARCH

    # Bare "restaurants near X" without plan verbs → list.
    if re.search(
        r"\b(restaurant|restaurants|hotel|hotels|cafe|coffee|bar|bars|places?|tomato|tomate|market|supermarket|university|universities|bank|banks|pharmacy|hospital|burger|burgers)\b",
        lower,
    ) and not re.search(r"\bplan\b", lower):
        return SIMPLE_SEARCH

    from .tools.query_intent import modifier_only

    if modifier_only(request):
        return SIMPLE_SEARCH

    for pattern in _CHAT_PATTERNS:
        if re.search(pattern, lower):
            return CHAT

    # Anything that is not a search or a plan is conversation. Do not run the pipeline.
    if not re.search(r"\b(find|show|where|near|cherche|trouve|around)\b", lower):
        return CHAT

    return SIMPLE_SEARCH
