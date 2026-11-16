"""Reading a block as a key."""

from __future__ import annotations

from collections.abc import Callable

import pytest
from cryptography.hazmat.primitives.asymmetric.types import PrivateKeyTypes

from forgemind_api.keys import Block, Key, read_key
from tests import keys

# What `ssh-keygen -lf` prints for the key `keys.ed25519_key("one")`.
FINGERPRINT = "SHA256:2Ep4KZ7BvzsP01jG0FC1S490fDK9sPOiEhCOlDoB+a4"


def read(text: str) -> Key:
    return read_key(keys.block(text))


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
