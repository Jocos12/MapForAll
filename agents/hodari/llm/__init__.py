"""Shared LLM resolution for MapForAll ADK agents (Gemini → Groq → Claude → OpenAI)."""

from .resolve import (
    call_llm_with_fallback,
    friendly_overload_text,
    gemini_in_cooldown,
    mark_gemini_cooldown,
    on_model_error_callback,
    resolve_agent_model,
)

__all__ = [
    "call_llm_with_fallback",
    "friendly_overload_text",
    "gemini_in_cooldown",
    "mark_gemini_cooldown",
    "on_model_error_callback",
    "resolve_agent_model",
]
