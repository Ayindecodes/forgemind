import pytest

from forgemind_api.settings import SettingsError, load_settings

DATABASE = "postgresql+psycopg://a:b@db/c"


def test_the_queue_address_must_be_a_redis_url() -> None:
    with pytest.raises(SettingsError, match=r"FORGEMIND_REDIS_URL: .*redis://"):
        load_settings({"FORGEMIND_REDIS_URL": "http://queue:6379"})
    for url in ("redis://queue:6379/0", "rediss://queue:6380/0"):
        assert load_settings({"FORGEMIND_REDIS_URL": url}).redis_url == url


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_a_queue_is_required_where_work_must_run(environment: str) -> None:
    with pytest.raises(
        SettingsError, match=f"FORGEMIND_REDIS_URL is required in {environment}"
    ):
        load_settings(
            {
                "FORGEMIND_ENVIRONMENT": environment,
                "FORGEMIND_DATABASE_URL": DATABASE,
            }
        )


def test_development_and_tests_may_run_without_a_queue() -> None:
    assert load_settings({}).redis_url is None
    assert (
        load_settings(
            {"FORGEMIND_ENVIRONMENT": "test", "FORGEMIND_DATABASE_URL": DATABASE}
        ).redis_url
        is None
    )


def test_a_worker_is_given_time_to_prove_itself_before_it_is_given_up_on() -> None:
    with pytest.raises(SettingsError, match="at least twice"):
        load_settings(
            {
                "FORGEMIND_WORKER_HEARTBEAT_SECONDS": "20",
                "FORGEMIND_WORKER_STALE_SECONDS": "30",
            }
        )
    settings = load_settings(
        {
            "FORGEMIND_WORKER_HEARTBEAT_SECONDS": "10",
            "FORGEMIND_WORKER_STALE_SECONDS": "20",
        }
    )
    assert settings.worker_stale_seconds == 20


@pytest.mark.parametrize(
    ("variable", "value"),
    [
        ("FORGEMIND_WORKER_MAX_ATTEMPTS", "0"),
        ("FORGEMIND_WORKER_MAX_ATTEMPTS", "11"),
        ("FORGEMIND_WORKER_CONCURRENCY", "0"),
        ("FORGEMIND_WORKER_CONCURRENCY", "17"),
        ("FORGEMIND_WORKER_HEARTBEAT_SECONDS", "0"),
        ("FORGEMIND_WORKER_SWEEP_SECONDS", "0"),
        ("FORGEMIND_WORKER_REDISPATCH_SECONDS", "-1"),
    ],
)
def test_worker_limits_are_bounded(variable: str, value: str) -> None:
    with pytest.raises(SettingsError, match=variable):
        load_settings({variable: value})


def test_retries_and_recovery_are_bounded_by_default() -> None:
    settings = load_settings({})
    assert settings.worker_max_attempts == 3
    assert settings.worker_stale_seconds >= 2 * settings.worker_heartbeat_seconds
