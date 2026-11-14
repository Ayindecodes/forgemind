"""The prices a cost is estimated from: set by whoever runs the service, and
by nobody else."""

from decimal import Decimal

import pytest

from forgemind_api.settings import Prices, SettingsError, TokenPrice, load_settings


def test_nothing_has_a_price_until_one_is_set() -> None:
    assert load_settings({}).prices == Prices(tokens={}, sandbox_hour=None)


def test_prices_are_read_as_the_digits_written() -> None:
    settings = load_settings(
        {
            "FORGEMIND_PRICES": (
                '{"tokens": {"example/model-a": {"input": 0.1, "output": 2.35},'
                ' "example/model-b": {"input": 3, "output": 0},'
                ' "example/model-c": {"input": 0.1234567890123456789, "output": 1}},'
                ' "sandbox_hour": 0.07}'
            )
        }
    )
    assert settings.prices.tokens == {
        "example/model-a": TokenPrice(input=Decimal("0.1"), output=Decimal("2.35")),
        "example/model-b": TokenPrice(input=Decimal(3), output=Decimal(0)),
        "example/model-c": TokenPrice(
            input=Decimal("0.1234567890123456789"), output=Decimal(1)
        ),
    }
    # 0.1 and 0.07 have no exact float: a price is not to pick up the error.
    assert str(settings.prices.tokens["example/model-a"].input) == "0.1"
    assert str(settings.prices.sandbox_hour) == "0.07"
    # Nor to lose the digits a float has no room for.
    assert (
        str(settings.prices.tokens["example/model-c"].input) == "0.1234567890123456789"
    )


def test_either_half_may_be_set_without_the_other() -> None:
    only_sandbox = load_settings({"FORGEMIND_PRICES": '{"sandbox_hour": 1}'}).prices
    assert only_sandbox.tokens == {} and only_sandbox.sandbox_hour == 1
    only_tokens = load_settings(
        {"FORGEMIND_PRICES": '{"tokens": {"a/b": {"input": 1, "output": 2}}}'}
    ).prices
    assert only_tokens.sandbox_hour is None and list(only_tokens.tokens) == ["a/b"]


@pytest.mark.parametrize(
    "value",
    [
        "cheap",
        '{"tokens": {"model-a": {"input": 1, "output": 2}}}',
        '{"tokens": {"example/": {"input": 1, "output": 2}}}',
        '{"tokens": {"example/model-a": {"input": 1}}}',
        '{"tokens": {"example/model-a": {"input": -1, "output": 2}}}',
        '{"tokens": {"example/model-a": {"input": 1, "output": 2, "cached": 3}}}',
        '{"sandbox_hour": -0.01}',
        '{"sandbox_hours": 1}',
        "[]",
    ],
)
def test_a_price_that_cannot_be_meant_stops_the_service(value: str) -> None:
    with pytest.raises(SettingsError, match="FORGEMIND_PRICES"):
        load_settings({"FORGEMIND_PRICES": value})
