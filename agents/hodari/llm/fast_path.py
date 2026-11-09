"""Rule-based router. A place search never calls Gemini."""

from __future__ import annotations

import json
import logging
from typing import Any

from google.adk.models.llm_response import LlmResponse
from google.genai import types

from ..intent import LIST_DISCOVERY, classify_intent
from ..tools.discovery import _coarse_query, discover_places
from ..tools.query_intent import extracted_keyword
from ..tools.response_cache import get_response_cache

logger = logging.getLogger("hodari.llm")

SEARCH_CACHE_TTL_S = 300


class _StateTool:
    def __init__(self, state: Any) -> None:
        self.state = state


def user_text(ctx: Any) -> str:
    content = getattr(ctx, "user_content", None)
    parts = getattr(content, "parts", None) or []
    return "".join(getattr(part, "text", "") or "" for part in parts).strip()


def templated_places_sentence(count: int, request: str) -> str:
    keyword = extracted_keyword(request)
    if count <= 0:
        return f"I couldn't find places for '{keyword}' near you. I can widen the area if you want."
    noun = "place" if count == 1 else "places"
    return f"Here are {count} {noun} for '{keyword}' near you."


def _cache_key(request: str) -> str:
    return f"search::{_coarse_query(request)}"


def _response(payload: dict[str, Any], sentence: str) -> LlmResponse:
    body = dict(payload)
    body["say"] = sentence
    return LlmResponse(
        content=types.Content(
            role="model",
            parts=[
                types.Part(
                    function_response=types.FunctionResponse(
                        name="discover_places",
                        response=body,
                    )
                ),
                types.Part(text=sentence),
            ],
        )
    )


async def route_before_model(ctx: Any, llm_request: Any) -> LlmResponse | None:
    """Decide the path in code. Place search returns cards and a template, with no model call."""
    del llm_request
    request = user_text(ctx)
    if not request:
        return None
    intent = classify_intent(request)
    state = ctx.state
    if intent != LIST_DISCOVERY:
        return None

    state["intent_type"] = LIST_DISCOVERY
    key = _cache_key(request)
    cache = get_response_cache()
    cached = cache.get(key)
    if cached:
        try:
            payload = json.loads(cached)
        except json.JSONDecodeError:
            payload = None
        if isinstance(payload, dict):
            places = payload.get("candidates") if isinstance(payload.get("candidates"), list) else []
            sentence = templated_places_sentence(len(places), request)
            state["candidates"] = json.dumps(places, ensure_ascii=False)
            state["places_query"] = request
            state["pipeline_once"] = request
            state["pipeline_result"] = cached
            logger.info("[llm] search cache hit keywords=%s places=%d", extracted_keyword(request), len(places))
            return _response(payload, sentence)

    try:
        raw = await discover_places(request, _StateTool(state))  # type: ignore[arg-type]
    except Exception as exc:
        logger.warning("[llm] place search failed before the model: %s", exc)
        sentence = templated_places_sentence(0, request)
        payload = {"intent_type": "LIST_DISCOVERY", "candidates": [], "say": sentence}
        state["candidates"] = "[]"
        state["pipeline_once"] = request
        return _response(payload, sentence)
    try:
        payload = json.loads(raw) if isinstance(raw, str) else {}
    except json.JSONDecodeError:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    places = payload.get("candidates") if isinstance(payload.get("candidates"), list) else []
    sentence = templated_places_sentence(len(places), request)
    state["pipeline_once"] = request
    state["pipeline_result"] = raw if isinstance(raw, str) else json.dumps(payload)
    cache.set(key, state["pipeline_result"], ttl=SEARCH_CACHE_TTL_S)
    logger.info(
        "[llm] place search without model keywords=%s places=%d",
        extracted_keyword(request),
        len(places),
    )
    return _response(payload, sentence)
