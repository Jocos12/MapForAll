"""Shared LLM resolution for all MapForAll ADK agents.

Primary: Gemini (Vertex / GEMINI_MODEL).
Fallbacks on 429 / 5xx: Groq → Claude → OpenAI (same order as the Next.js cascade).

Uses ADK's built-in FallbackModel so tool-calling agents keep working across
providers. Keys live in agents/.env (see .env.example).
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any

logger = logging.getLogger("hodari.llm")

# After a Gemini 429, skip it for this many seconds (avoids burning retries).
_GEMINI_COOLDOWN_S = float(os.getenv("HODARI_GEMINI_COOLDOWN_S", "60"))
_gemini_cooldown_until = 0.0

_FRIENDLY_OVERLOAD = (
    "Nos assistants sont temporairement surchargés, réessaie dans un instant. "
    "Our assistants are temporarily overloaded — please try again in a moment."
)


def mark_gemini_cooldown(seconds: float | None = None) -> None:
    """Record that Gemini just returned 429 / quota exhausted."""
    global _gemini_cooldown_until
    ttl = _GEMINI_COOLDOWN_S if seconds is None else seconds
    _gemini_cooldown_until = max(_gemini_cooldown_until, time.monotonic() + ttl)
    logger.warning("[llm] Gemini in cooldown for %.0fs", ttl)


def gemini_in_cooldown() -> bool:
    return time.monotonic() < _gemini_cooldown_until


def _env(name: str) -> str:
    return (os.getenv(name) or "").strip()


def _configured_backups() -> list[Any]:
    """Build LiteLLM / Claude backup model instances for configured keys."""
    backups: list[Any] = []

    groq_key = _env("GROQ_API_KEY")
    if groq_key:
        os.environ.setdefault("GROQ_API_KEY", groq_key)
        try:
            from google.adk.models import LiteLlm

            model = _env("GROQ_MODEL") or "llama-3.3-70b-versatile"
            backups.append(LiteLlm(model=f"groq/{model}"))
            logger.info("[llm] Groq backup ready (%s)", model)
        except ImportError as exc:
            logger.warning("[llm] Groq skipped — install litellm / google-adk[extensions]: %s", exc)

    anthropic_key = _env("ANTHROPIC_API_KEY")
    if anthropic_key:
        os.environ.setdefault("ANTHROPIC_API_KEY", anthropic_key)
        try:
            from google.adk.models import Claude

            model = _env("ANTHROPIC_MODEL") or "claude-sonnet-4-5"
            backups.append(Claude(model=model))
            logger.info("[llm] Claude backup ready (%s)", model)
        except Exception as exc:
            # Fall back to LiteLLM Anthropic route if native Claude fails to import.
            try:
                from google.adk.models import LiteLlm

                model = _env("ANTHROPIC_MODEL") or "claude-sonnet-4-5"
                backups.append(LiteLlm(model=f"anthropic/{model}"))
                logger.info("[llm] Claude via LiteLLM ready (%s)", model)
            except Exception:
                logger.warning("[llm] Claude backup skipped: %s", exc)

    openai_key = _env("OPENAI_API_KEY")
    if openai_key:
        os.environ.setdefault("OPENAI_API_KEY", openai_key)
        try:
            from google.adk.models import LiteLlm

            model = _env("OPENAI_MODEL") or "gpt-4.1-mini"
            backups.append(LiteLlm(model=f"openai/{model}"))
            logger.info("[llm] OpenAI backup ready (%s)", model)
        except ImportError as exc:
            logger.warning("[llm] OpenAI skipped — install litellm: %s", exc)

    return backups


def _wrap_gemini_primary(model_name: str):
    """Gemini delegate that respects cooldown and records 429s for the next turn."""
    from google.adk.models.registry import LLMRegistry
    from google.adk.models.base_llm import BaseLlm
    from google.genai.errors import APIError
    from typing_extensions import override

    inner = LLMRegistry.new_llm(model_name)

    class _CooldownAwareGemini(BaseLlm):
        model: str = model_name

        @property
        @override
        def capabilities(self):
            return inner.capabilities

        @override
        async def generate_content_async(self, llm_request, stream: bool = False):
            if gemini_in_cooldown():
                logger.info("[llm] skipping Gemini (cooldown active)")
                raise APIError(429, {"error": {"message": "Gemini cooldown after RESOURCE_EXHAUSTED"}})
            try:
                async for chunk in inner.generate_content_async(llm_request, stream=stream):
                    yield chunk
            except Exception as error:
                code = getattr(error, "code", None) or getattr(error, "status_code", None)
                detail = str(error).lower()
                if code == 429 or "resource_exhausted" in detail or "quota" in detail:
                    mark_gemini_cooldown()
                raise

        @override
        async def connect(self, llm_request):
            if gemini_in_cooldown():
                raise APIError(429, {"error": {"message": "Gemini cooldown after RESOURCE_EXHAUSTED"}})
            return await inner.connect(llm_request)

    return _CooldownAwareGemini(model=model_name)


def resolve_agent_model():
    """Return Gemini, or FallbackModel(Gemini → Groq → Claude → OpenAI).

    Safe to call at import time for every LlmAgent. If no backup keys are set,
    returns the plain Gemini model string (unchanged behaviour).
    """
    primary_name = _env("GEMINI_MODEL") or "gemini-3.5-flash"
    backups = _configured_backups()
    if not backups:
        logger.info("[llm] No backup providers configured — Gemini only (%s)", primary_name)
        return primary_name

    try:
        from google.adk.features import FeatureName, override_feature_enabled
        from google.adk.models import FallbackModel

        override_feature_enabled(FeatureName.FALLBACK_MODEL, True)
    except Exception as exc:
        logger.warning("[llm] FallbackModel unavailable (%s) — Gemini only", exc)
        return primary_name

    primary = _wrap_gemini_primary(primary_name)
    chain = [primary, *backups]
    logger.info(
        "[llm] Fallback chain: %s",
        " → ".join(getattr(m, "model", type(m).__name__) for m in chain),
    )
    return FallbackModel(models=chain)


def friendly_overload_text() -> str:
    return _FRIENDLY_OVERLOAD


async def on_model_error_callback(callback_context, llm_request, error):  # noqa: ANN001
    """Turn a total provider failure into a short user-facing reply (no raw 429)."""
    from google.genai import types
    from google.adk.models import LlmResponse

    detail = str(error or "")
    if any(s in detail.lower() for s in ("429", "resource_exhausted", "quota", "rate limit")):
        mark_gemini_cooldown()
    logger.error("[llm] all providers failed: %s", detail[:300])
    return LlmResponse(
        content=types.Content(
            role="model",
            parts=[types.Part(text=friendly_overload_text())],
        )
    )


async def call_llm_with_fallback(
    message: str,
    *,
    system: str | None = None,
) -> tuple[str, str]:
    """Simple text completion with the same provider cascade (for non-agent tools).

    Returns (text, provider_name). Raises RuntimeError if every provider fails.
    """
    import json
    import urllib.error
    import urllib.request

    system_text = (system or "You are MapForAll. Reply briefly and helpfully.").strip()
    errors: list[str] = []

    # 1) Gemini Developer API key (optional) — skip if in cooldown
    gemini_key = _env("GEMINI_API_KEY")
    if gemini_key and not gemini_in_cooldown():
        model = _env("GEMINI_FALLBACK_MODEL") or "gemini-2.0-flash"
        try:
            url = (
                f"https://generativelanguage.googleapis.com/v1beta/models/"
                f"{model}:generateContent?key={gemini_key}"
            )
            body = json.dumps({
                "systemInstruction": {"parts": [{"text": system_text}]},
                "contents": [{"role": "user", "parts": [{"text": message}]}],
            }).encode()
            req = urllib.request.Request(
                url, data=body, headers={"Content-Type": "application/json"}, method="POST"
            )
            with urllib.request.urlopen(req, timeout=45) as res:
                data = json.loads(res.read().decode())
            text = "".join(
                p.get("text", "")
                for c in data.get("candidates") or []
                for p in (c.get("content") or {}).get("parts") or []
            ).strip()
            if text:
                return text, "gemini"
            errors.append("gemini: empty")
        except urllib.error.HTTPError as exc:
            body = exc.read().decode(errors="ignore")[:200]
            if exc.code == 429:
                mark_gemini_cooldown()
            errors.append(f"gemini:{exc.code}:{body}")
        except Exception as exc:
            errors.append(f"gemini:{exc}")

    # 2) OpenAI-compatible: Groq then OpenAI
    for name, key_env, url, model_env, default_model in (
        ("groq", "GROQ_API_KEY", "https://api.groq.com/openai/v1/chat/completions", "GROQ_MODEL", "llama-3.3-70b-versatile"),
        ("openai", "OPENAI_API_KEY", "https://api.openai.com/v1/chat/completions", "OPENAI_MODEL", "gpt-4.1-mini"),
    ):
        key = _env(key_env)
        if not key:
            continue
        model = _env(model_env) or default_model
        try:
            body = json.dumps({
                "model": model,
                "messages": [
                    {"role": "system", "content": system_text},
                    {"role": "user", "content": message},
                ],
            }).encode()
            req = urllib.request.Request(
                url,
                data=body,
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=45) as res:
                data = json.loads(res.read().decode())
            text = ((data.get("choices") or [{}])[0].get("message") or {}).get("content", "").strip()
            if text:
                return text, name
            errors.append(f"{name}: empty")
        except Exception as exc:
            errors.append(f"{name}:{exc}")

    # 3) Claude
    anthropic_key = _env("ANTHROPIC_API_KEY")
    if anthropic_key:
        model = _env("ANTHROPIC_MODEL") or "claude-sonnet-4-5"
        try:
            body = json.dumps({
                "model": model,
                "max_tokens": 1200,
                "system": system_text,
                "messages": [{"role": "user", "content": message}],
            }).encode()
            req = urllib.request.Request(
                "https://api.anthropic.com/v1/messages",
                data=body,
                headers={
                    "Content-Type": "application/json",
                    "x-api-key": anthropic_key,
                    "anthropic-version": "2023-06-01",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=45) as res:
                data = json.loads(res.read().decode())
            text = "".join(
                b.get("text", "") for b in data.get("content") or [] if isinstance(b, dict)
            ).strip()
            if text:
                return text, "claude"
            errors.append("claude: empty")
        except Exception as exc:
            errors.append(f"claude:{exc}")

    raise RuntimeError("All LLM providers failed: " + "; ".join(errors[:4]))
