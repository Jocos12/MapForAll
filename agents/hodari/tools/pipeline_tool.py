"""AgentTool wrapper: intent routing + pipeline + background preference saves."""

from __future__ import annotations

import json
import logging
from typing import Any

from google.adk.agents.base_agent import BaseAgent
from google.adk.tools.agent_tool import AgentTool
from google.adk.tools.tool_context import ToolContext

from ..intent import CHAT, ITINERARY_PLANNING, LIST_DISCOVERY, classify_intent
from ..telemetry import record_intent
from .discovery import discover_places
from .place_dedupe import rewrite_candidates_json, rewrite_itinerary_json
from .mongo_tools import (
    _user_id,
    enqueue_preference_saves,
    parse_itinerary_stops,
)

logger = logging.getLogger(__name__)


class HodariPipelineTool(AgentTool):
    """Routes LIST_DISCOVERY to the fast path; ITINERARY_PLANNING runs the full pipeline."""

    def __init__(self, agent: BaseAgent, **kwargs: Any) -> None:
        super().__init__(agent, **kwargs)

    async def run_async(
        self,
        *,
        args: dict[str, Any],
        tool_context: ToolContext,
    ) -> Any:
        request = args.get("request", "")
        intent = classify_intent(request)
        record_intent(intent)
        tool_context.state["intent_type"] = intent
        logger.info("hodari_pipeline intent=%s request=%r", intent, request[:120])

        if intent == CHAT:
            tool_context.state["intent_type"] = CHAT
            return json.dumps({
                "intent_type": CHAT,
                "candidates": [],
                "say": "Answer in conversation. Do not list places or reuse an earlier search.",
            })

        if intent == LIST_DISCOVERY:
            return await discover_places(request, tool_context)

        tool_context.state["candidates"] = "[]"
        tool_context.state["places_query"] = request
        tool_context.state["intent_type"] = ITINERARY_PLANNING
        result = await super().run_async(args=args, tool_context=tool_context)
        cleaned_candidates = rewrite_candidates_json(tool_context.state.get("candidates"), limit=10)
        if cleaned_candidates:
            tool_context.state["candidates"] = cleaned_candidates
        cleaned_itinerary = rewrite_itinerary_json(tool_context.state.get("itinerary"))
        if cleaned_itinerary:
            tool_context.state["itinerary"] = cleaned_itinerary
        try:
            stops = parse_itinerary_stops(tool_context.state.get("itinerary"))
            if stops:
                enqueue_preference_saves(_user_id(tool_context), stops)
        except Exception as exc:
            logger.warning("Failed to enqueue background preference saves: %s", exc)
        return result
