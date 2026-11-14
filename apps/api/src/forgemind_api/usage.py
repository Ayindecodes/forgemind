"""What usage comes to at the prices set on this server."""

from __future__ import annotations

from collections.abc import Iterable
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from forgemind_api.metering import Measure
from forgemind_api.settings import Prices

MICRODOLLAR = Decimal("0.000001")


def estimated_cost(measures: Iterable[Measure], prices: Prices) -> dict[str, Any]:
    """What the usage comes to at the prices set on this server, or why that
    cannot be said. Always an estimate: this service reads no bill, so it has
    no actual cost to report."""
    amount = Decimal(0)
    models: set[str] = set()
    sandbox_unpriced = False
    for item in measures:
        if item.kind == "tokens":
            name = f"{item.provider}/{item.model}"
            price = prices.tokens.get(name)
            if price is None:
                models.add(name)
                continue
            rate = price.input if item.direction == "input" else price.output
            amount += item.quantity * rate / 1_000_000
        elif item.kind == "sandbox_seconds":
            if prices.sandbox_hour is None:
                sandbox_unpriced = True
                continue
            amount += item.quantity * prices.sandbox_hour / 3600
    unpriced = [*sorted(models), *(["sandbox time"] if sandbox_unpriced else [])]
    if unpriced:
        return {
            "kind": "unavailable",
            "reason": f"No price is set on this server for {_listed(unpriced)}.",
        }
    return {
        "kind": "estimate",
        "amountUsd": float(amount.quantize(MICRODOLLAR, ROUND_HALF_UP)),
    }


def _listed(names: list[str]) -> str:
    if len(names) == 1:
        return names[0]
    return f"{', '.join(names[:-1])} or {names[-1]}"
