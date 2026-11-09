"""Place search answers without a model call, and Gemini retries stay bounded."""

from hodari.llm.fast_path import templated_places_sentence
from hodari.llm.retry import MAX_RETRIES, REQUEST_BUDGET_S, delay_for_attempt, retryable_status


class _Err(Exception):
    def __init__(self, code: int, retry_after: str | None = None) -> None:
        super().__init__(f"HTTP {code}")
        self.code = code
        self.headers = {"Retry-After": retry_after} if retry_after else {}


def test_place_sentence_uses_the_keyword():
    text = templated_places_sentence(4, "where can i find tomatoes")
    assert text == "Here are 4 places for 'tomatoes' near you."
    empty = templated_places_sentence(0, "i want tomatoes")
    assert "tomatoes" in empty
    assert "couldn't find" in empty


def test_retries_stop_after_two_and_honor_the_budget():
    assert MAX_RETRIES == 2
    assert REQUEST_BUDGET_S == 12
    assert retryable_status(429) and retryable_status(503)
    assert retryable_status(400) is False
    first = delay_for_attempt(1, _Err(429), now=0, deadline=12)
    second = delay_for_attempt(2, _Err(503), now=1, deadline=12)
    assert first is not None and 0.5 <= first <= 0.8
    assert second is not None and 1.5 <= second <= 1.8
    assert delay_for_attempt(3, _Err(429), now=2, deadline=12) is None
    assert delay_for_attempt(1, _Err(429), now=11.9, deadline=12) is None
    honored = delay_for_attempt(1, _Err(429, "1"), now=0, deadline=12)
    assert honored is not None and 1 <= honored <= 1.3
