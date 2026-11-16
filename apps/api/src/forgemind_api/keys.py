"""Reads what the boundary lines of a private key enclose as a key.

A key that loads is a private key, with nothing left to doubt, which is what
lets a finding say so.
"""

from __future__ import annotations

import base64
import hashlib
import warnings
from dataclasses import dataclass
from typing import Literal

from cryptography.exceptions import UnsupportedAlgorithm
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import (
    dh,
    dsa,
    ec,
    ed448,
    ed25519,
    rsa,
    x448,
    x25519,
)
from cryptography.hazmat.primitives.asymmetric.types import (
    PrivateKeyTypes,
    PublicKeyTypes,
)

OPENSSH = "OPENSSH PRIVATE KEY"


@dataclass(frozen=True)
class Block:
    """What the boundary lines of a private key enclose."""

    label: str
    headers: tuple[bytes, ...]
    # The base64 between the boundaries, as one line.
    data: bytes

    def pem(self) -> bytes:
        """The block as a file of its own would have it."""
        label = self.label.encode()
        lines = [b"-----BEGIN " + label + b"-----"]
        if self.headers:
            lines += [*self.headers, b""]
        lines += [self.data[at : at + 64] for at in range(0, len(self.data), 64)]
        lines += [b"-----END " + label + b"-----", b""]
        return b"\n".join(lines)

    def digest(self) -> str:
        return hashlib.sha256(self.data).hexdigest()


@dataclass(frozen=True)
class Key:
    """What reading a block as a key came to: it loaded with no passphrase,
    it asks for one, it was not read, or reading it took too long."""

    standing: Literal["open", "protected", "unread", "slow"]
    identity: str
    article: str = "a"
    name: str = "private key"
    detail: str = ""
    ssh_fingerprint: str | None = None


def load(block: Block) -> PrivateKeyTypes:
    if block.label == OPENSSH:
        return serialization.load_ssh_private_key(block.pem(), password=None)
    # Checking that an RSA key's numbers are primes takes seconds for a large
    # one, and a repository may hold any number of them. `described` makes
    # the check that costs nothing instead.
    return serialization.load_pem_private_key(
        block.pem(), password=None, unsafe_skip_rsa_key_validation=True
    )


def ssh_fingerprint(public: PublicKeyTypes) -> str | None:
    """The fingerprint `ssh-keygen -l` prints for a public key, for the kinds
    of key SSH has."""
    try:
        line = public.public_bytes(
            serialization.Encoding.OpenSSH, serialization.PublicFormat.OpenSSH
        )
    except (ValueError, TypeError, UnsupportedAlgorithm):
        return None
    digest = hashlib.sha256(base64.b64decode(line.split()[1])).digest()
    return "SHA256:" + base64.b64encode(digest).decode().rstrip("=")


def described(key: PrivateKeyTypes, digest: str) -> Key:
    """A key that loaded, by its kind and its public half."""
    article, name, detail = "a", "private key", ""
    match key:
        case rsa.RSAPrivateKey():
            numbers = key.private_numbers()
            if numbers.p * numbers.q != numbers.public_numbers.n:
                return Key("unread", digest)
            article, name, detail = "an", "RSA private key", f" of {key.key_size} bits"
        case ec.EllipticCurvePrivateKey():
            article, name = "an", "EC private key"
            detail = f" on the curve {key.curve.name}"
        case ed25519.Ed25519PrivateKey():
            article, name = "an", "Ed25519 private key"
        case ed448.Ed448PrivateKey():
            article, name = "an", "Ed448 private key"
        case x25519.X25519PrivateKey():
            article, name = "an", "X25519 private key"
        case x448.X448PrivateKey():
            article, name = "an", "X448 private key"
        case dsa.DSAPrivateKey():
            name, detail = "DSA private key", f" of {key.key_size} bits"
        case dh.DHPrivateKey():
            name, detail = "Diffie-Hellman private key", f" of {key.key_size} bits"
        case _:
            pass
    public = key.public_key()
    try:
        identity = hashlib.sha256(
            public.public_bytes(
                serialization.Encoding.DER,
                serialization.PublicFormat.SubjectPublicKeyInfo,
            )
        ).hexdigest()
    except (ValueError, TypeError, UnsupportedAlgorithm):
        identity = digest
    return Key("open", identity, article, name, detail, ssh_fingerprint(public))


def read_key(block: Block) -> Key:
    """Reads the block as a key, giving no passphrase."""
    digest = block.digest()
    # The older kinds of key load with a warning that they are old.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            key = load(block)
        except TypeError:
            # What both loaders raise for a key that asks for a passphrase.
            return Key("protected", digest)
        except Exception:
            # Whatever else a loader makes of bytes it does not read as a
            # key. They come from a repository, and nothing about them may
            # stop the scan.
            return Key("unread", digest)
        return described(key, digest)
