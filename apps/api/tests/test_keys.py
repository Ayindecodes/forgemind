"""Reading a block as a key, and the process it is read in."""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
from collections.abc import Callable
from typing import Any

import pytest
from cryptography.hazmat.primitives.asymmetric.types import PrivateKeyTypes

from forgemind_api.keys import COMMAND, Block, Key, Reader, read_key
from tests import keys

# What `ssh-keygen -lf` prints for the key `keys.ed25519_key("one")`.
FINGERPRINT = "SHA256:2Ep4KZ7BvzsP01jG0FC1S490fDK9sPOiEhCOlDoB+a4"


def read(text: str) -> Key:
    return read_key(keys.block(text))


def says(script: str) -> tuple[str, ...]:
    """A process in place of the one that reads keys, doing what `script`
    says. It is given the lifetime as that one is, and has no use for it."""
    return (sys.executable, "-I", "-c", script)


READY = "import sys, time; print('ready', flush=True); "
ASLEEP = READY + "time.sleep(60)"
# Answers for the first block and takes too long over every one after it.
TIRING = READY + (
    "import json; sys.stdin.readline(); "
    "print(json.dumps({'standing': 'open', 'identity': 'first'}), flush=True); "
    "time.sleep(60)"
)


# --- what a block is read as


def test_a_key_that_loads_is_told_by_its_kind() -> None:
    assert read(keys.pem()) == Key(
        "open",
        read(keys.pem()).identity,
        "an",
        "Ed25519 private key",
        "",
        FINGERPRINT,
    )
    rsa = read(keys.pem(keys.rsa_key()))
    assert (rsa.standing, rsa.article, rsa.name, rsa.detail) == (
        "open",
        "an",
        "RSA private key",
        " of 2048 bits",
    )
    ec = read(keys.pem(keys.ec_key(), keys.TRADITIONAL))
    assert (ec.standing, ec.name, ec.detail) == (
        "open",
        "EC private key",
        " on the curve secp256r1",
    )


def test_the_fingerprint_is_the_one_ssh_prints() -> None:
    assert read(keys.pem()).ssh_fingerprint == FINGERPRINT
    assert read(keys.pem(form=keys.OPENSSH)).ssh_fingerprint == FINGERPRINT
    assert read(keys.pem(keys.ed25519_key("two"))).ssh_fingerprint != FINGERPRINT


@pytest.mark.parametrize("key", [keys.ed25519_key, keys.rsa_key, keys.ec_key])
def test_a_key_is_the_same_key_however_it_is_written(
    key: Callable[[], PrivateKeyTypes],
) -> None:
    made = key()
    forms = [keys.PKCS8, keys.OPENSSH]
    if key is not keys.ed25519_key:
        # Ed25519 has no form of its own older than PKCS #8.
        forms.append(keys.TRADITIONAL)
    identities = {read(keys.pem(made, form)).identity for form in forms}
    assert len(identities) == 1
    # And it is not the digest of the text, which differs with the form.
    assert identities.isdisjoint(
        keys.block(keys.pem(made, form)).digest() for form in forms
    )


def test_two_keys_are_told_apart() -> None:
    assert (
        read(keys.pem(keys.ed25519_key("one"))).identity
        != read(keys.pem(keys.ed25519_key("two"))).identity
    )


@pytest.mark.parametrize(
    "text",
    [
        pytest.param(lambda: keys.pem(keys.rsa_key(), keys.PKCS8, b"a"), id="pkcs8"),
        pytest.param(
            lambda: keys.pem(keys.rsa_key(), keys.TRADITIONAL, b"a"), id="traditional"
        ),
        pytest.param(keys.protected_openssh, id="openssh"),
    ],
)
def test_a_key_that_asks_for_a_passphrase_is_not_read(
    text: Callable[[], str],
) -> None:
    written = text()
    found = read(written)
    assert found == Key("protected", keys.block(written).digest())


def test_what_is_no_key_is_not_read_as_one() -> None:
    for written in (
        keys.pgp_block(),
        keys.enclosed("PRIVATE KEY", keys.wrapped(keys.noise("no key", 300))),
        keys.enclosed("OPENSSH PRIVATE KEY", keys.wrapped(keys.noise("nor this", 300))),
        # A key cut off before its end.
        keys.enclosed("PRIVATE KEY", keys.pem(keys.rsa_key()).splitlines()[1:9]),
    ):
        assert read(written) == Key("unread", keys.block(written).digest())


def test_an_rsa_key_whose_numbers_do_not_go_together_is_not_one() -> None:
    """The check that would take seconds is skipped, and this one is made in
    its place."""
    assert read(keys.rsa_with_modulus()).standing == "open"
    wrong = keys.rsa_key().private_numbers().public_numbers.n + 2
    assert read(keys.rsa_with_modulus(wrong)).standing == "unread"


def test_a_block_is_put_back_together_as_a_file_would_have_it() -> None:
    written = keys.pem(keys.rsa_key(), keys.TRADITIONAL, b"a")
    assert keys.block(written).pem().decode() == written
    block = Block("PRIVATE KEY", (), b"A" * 100)
    assert block.pem().split(b"\n")[1:3] == [b"A" * 64, b"A" * 36]


# --- the process a key is read in


def test_keys_are_read_in_one_process_started_for_the_first() -> None:
    with Reader() as reader:
        assert reader.process is None
        first = reader.read(keys.block(keys.pem()))
        assert reader.process is not None
        process = reader.process
        assert process.pid != os.getpid()
        second = reader.read(keys.block(keys.pem(keys.rsa_key(), keys.PKCS8, b"a")))
        third = reader.read(keys.block(keys.pgp_block()))
        assert reader.process is process
        assert reader.left < reader.seconds
    assert first == read(keys.pem())
    assert second is not None and second.standing == "protected"
    assert third is not None and third.standing == "unread"
    assert (reader.slow, reader.stopped, reader.process) == (0, None, None)
    # It was ended with the reader, not left to end itself.
    assert process.returncode == -signal.SIGKILL


def test_a_key_that_takes_too_long_is_given_up_and_the_next_is_read() -> None:
    block = keys.block(keys.pem())
    with Reader(each=0.3, command=says(TIRING)) as reader:
        assert reader.read(block) == Key("open", "first")
        process = reader.process
        assert process is not None
        began = time.monotonic()
        assert reader.read(block) == Key("slow", block.digest())
        assert 0.3 <= time.monotonic() - began < 3
        # The process is ended, since nothing else stops what it is doing.
        assert process.returncode == -signal.SIGKILL
        assert (reader.slow, reader.stopped) == (1, None)
        # The next key has a process of its own.
        assert reader.read(block) == Key("open", "first")
        assert reader.process is not None and reader.process is not process


def test_reading_stops_when_the_time_for_the_whole_scan_is_spent() -> None:
    block = keys.block(keys.pem())
    with Reader(seconds=1, each=0.6, command=says(ASLEEP)) as reader:
        assert reader.read(block) == Key("slow", block.digest())
        assert reader.stopped is None
        assert reader.read(block) == Key("slow", block.digest())
        assert reader.read(block) is None
        assert reader.stopped is not None
        assert reader.stopped.startswith("It gives itself 1 seconds to read keys")
        # Nothing is started for a key that will not be read.
        assert reader.process is None
        assert reader.read(block) is None
        assert reader.slow == 2


@pytest.mark.parametrize(
    "script",
    [
        pytest.param(READY + "sys.stdin.readline()", id="ends"),
        pytest.param(READY + "sys.stdin.readline(); sys.exit(3)", id="fails"),
        pytest.param(
            READY + "import os; sys.stdin.readline(); os.kill(os.getpid(), 9)",
            id="is killed",
        ),
        pytest.param(
            READY + "sys.stdin.readline(); print('no answer', flush=True)",
            id="says something else",
        ),
        pytest.param(
            READY + "sys.stdin.readline(); print('{\"standing\": 1}', flush=True)",
            id="answers with no key",
        ),
        pytest.param(
            READY + "sys.stdin.readline(); print('[1, 2]', flush=True)",
            id="answers with a list",
        ),
    ],
)
def test_a_block_the_process_fails_over_was_not_read(script: str) -> None:
    block = keys.block(keys.pem())
    with Reader(command=says(script)) as reader:
        assert reader.read(block) == Key("unread", block.digest())
        assert reader.process is None
        assert (reader.slow, reader.stopped) == (0, None)


@pytest.mark.parametrize(
    "command",
    [
        pytest.param(("/nonexistent/python",), id="missing"),
        pytest.param(says("import time; time.sleep(60)"), id="silent"),
        pytest.param(says("print('something else', flush=True)"), id="not ready"),
        pytest.param(says("raise SystemExit(1)"), id="ends"),
    ],
)
def test_no_key_is_read_when_the_process_does_not_start(
    command: tuple[str, ...],
) -> None:
    with Reader(starting=0.5, command=command) as reader:
        assert reader.read(keys.block(keys.pem())) is None
        assert reader.stopped == "The process that reads keys did not start."
        assert reader.process is None
        # And it is not tried again for every key there is.
        began = time.monotonic()
        assert reader.read(keys.block(keys.pem())) is None
        assert time.monotonic() - began < 0.2


def test_the_process_is_given_nothing_of_the_servers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FORGEMIND_DATABASE_PASSWORD", "not for it")
    names = READY + (
        "import json, os; sys.stdin.readline(); "
        "print(json.dumps({'standing': 'open', "
        "'identity': ' '.join(sorted(os.environ))}), flush=True)"
    )
    with Reader(command=says(names)) as reader:
        found = reader.read(keys.block(keys.pem()))
    assert found is not None and found.identity == "LC_ALL PATH"


def test_the_process_ends_itself_when_no_one_ends_it() -> None:
    """A worker that is killed ends no one. The process is given how long it
    has, and the system ends it then."""
    process = subprocess.Popen(
        [*COMMAND, "1"], stdin=subprocess.PIPE, stdout=subprocess.PIPE
    )
    try:
        assert process.stdout is not None
        assert process.stdout.readline() == b"ready\n"
        assert process.wait(timeout=10) == -signal.SIGALRM
    finally:
        process.kill()
        process.wait()
        for channel in (process.stdin, process.stdout):
            assert channel is not None
            channel.close()


def test_the_process_says_nothing_but_its_answers() -> None:
    """What it is asked about is a key, and what it says goes down a pipe."""
    written = keys.pem(keys.rsa_key())
    block = keys.block(written)
    asked: dict[str, Any] = {
        "label": block.label,
        "headers": [],
        "data": block.data.decode(),
    }
    damaged: dict[str, Any] = {**asked, "data": "AAAA" + block.data.decode()}
    done = subprocess.run(
        [*COMMAND, "30"],
        input=f"{json.dumps(asked)}\n{json.dumps(damaged)}\n".encode(),
        capture_output=True,
        timeout=30,
        check=False,
    )
    assert done.returncode == 0
    said = done.stdout.decode().splitlines()
    assert said[0] == "ready" and len(said) == 3
    assert '"standing": "open"' in said[1] and '"standing": "unread"' in said[2]
    for line in keys.body(written):
        assert line not in done.stdout.decode()
        assert line not in done.stderr.decode()
