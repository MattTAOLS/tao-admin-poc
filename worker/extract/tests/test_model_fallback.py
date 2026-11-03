"""Model fallback: only unplaced cells are asked for, the answer is schema-checked, every call is logged."""
import json
from types import SimpleNamespace

from worker.extract import _apply_model_cells
from worker.extract.mapper import ModelFallback, Parsed


class FakeClient:
    def __init__(self, reply: str):
        self.reply, self.prompts = reply, []
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, model, max_tokens, messages):
        self.prompts.append(messages[0]["content"])
        return SimpleNamespace(content=[SimpleNamespace(text=self.reply)])


def test_disabled_without_model_logs_and_returns_nothing(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_MODEL", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    fb = ModelFallback()
    assert fb.ask([("principal_balances", "term_limit")], {4: "TERM FACILITY LIMIT 50,000,000.00"}) == []
    assert fb.calls[0]["status"] == "skipped" and fb.calls[0]["fields"] == ["principal_balances.term_limit"]


def test_answer_is_validated_and_applied():
    reply = json.dumps({"cells": [{"field": "principal_balances.term_limit", "value": "50,000,000.00",
                                   "page": 4, "raw_text": "50,000,000.00"}]})
    client = FakeClient(reply)
    fb = ModelFallback(model="test-model", client=client)
    cells = fb.ask([("principal_balances", "term_limit")], {4: "TERM FACILITY LIMIT 50,000,000.00 d = b - h"})
    assert fb.calls[0]["status"] == "ok" and fb.calls[0]["prompt_chars"] == len(client.prompts[0])
    assert "principal_balances.term_limit" in client.prompts[0] and "--- page 4 ---" in client.prompts[0]
    p = Parsed(template={}, page_count=16, unplaced=[("principal_balances", "term_limit", 4)])
    _apply_model_cells(p, cells)
    assert p.principal["term_limit"].value == 50_000_000.0
    assert p.principal["term_limit"].confidence < 1 and p.unplaced == []


def test_non_json_answer_is_rejected():
    fb = ModelFallback(model="test-model", client=FakeClient("The term limit is 50 million."))
    assert fb.ask([("principal_balances", "term_limit")], {4: "x"}) == []
    assert fb.calls[0]["status"].startswith("error")


def test_schema_violation_is_rejected():
    fb = ModelFallback(model="test-model", client=FakeClient(json.dumps({"cells": [{"field": "x"}]})))
    assert fb.ask([("principal_balances", "term_limit")], {4: "x"}) == []
