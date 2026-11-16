"""Keys and tokens for a test to commit, made when the test runs.

None is written out here. A file that held one would be found by the scan
these are for, in this repository, and by anything else that looks for them.
Each key is real: generated and written by the library the scan reads keys
with, so that what a test finds is what the scan finds in a repository.
"""

from __future__ import annotations

import base64
import functools
import hashlib
import json
import struct

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519, rsa
from cryptography.hazmat.primitives.asymmetric.types import PrivateKeyTypes

from forgemind_api.keys import Block

PKCS8 = serialization.PrivateFormat.PKCS8
TRADITIONAL = serialization.PrivateFormat.TraditionalOpenSSL
OPENSSH = serialization.PrivateFormat.OpenSSH


@functools.cache
def rsa_key(bits: int = 2048) -> rsa.RSAPrivateKey:
    """One RSA key of each size for the whole run: making one takes a while."""
    return rsa.generate_private_key(public_exponent=65537, key_size=bits)


@functools.cache
def ec_key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


def ed25519_key(name: str = "one") -> ed25519.Ed25519PrivateKey:
    """The same key for the same name."""
    seed = hashlib.sha256(f"a key for the tests: {name}".encode()).digest()
    return ed25519.Ed25519PrivateKey.from_private_bytes(seed)


def pem(
    key: PrivateKeyTypes | None = None,
    form: serialization.PrivateFormat = PKCS8,
    passphrase: bytes | None = None,
) -> str:
    """The key as a file holds it, asking for the passphrase if there is one."""
    protection = (
        serialization.BestAvailableEncryption(passphrase)
        if passphrase
        else serialization.NoEncryption()
    )
    return (
        (key or ed25519_key())
        .private_bytes(serialization.Encoding.PEM, form, protection)
        .decode("ascii")
    )


def boundary(which: str, label: str) -> str:
    return f"-----{which} {label}-----"


def enclosed(label: str, lines: list[str]) -> str:
    return "\n".join([boundary("BEGIN", label), *lines, boundary("END", label), ""])


def wrapped(data: bytes, width: int = 64) -> list[str]:
    text = base64.b64encode(data).decode("ascii")
    return [text[at : at + width] for at in range(0, len(text), width)]


def noise(name: str, size: int) -> bytes:
    """Bytes that are no key, the same for the same name."""
    return hashlib.shake_256(name.encode()).digest(size)


def string(data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + data


def protected_openssh(name: str = "one") -> str:
    """An OpenSSH private key that asks for a passphrase, laid out as
    OpenSSH's PROTOCOL.key has it.

    The library writes one only with bcrypt, which is not installed. Reading
    that a key asks for a passphrase takes its first fields and no more, so
    what would be the encrypted key is noise here."""
    public = ed25519_key(name).public_key()
    blob = string(b"ssh-ed25519") + string(
        public.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    )
    options = string(noise(f"salt {name}", 16)) + struct.pack(">I", 16)
    container = (
        b"openssh-key-v1\x00"
        + string(b"aes256-ctr")
        + string(b"bcrypt")
        + string(options)
        + struct.pack(">I", 1)
        + string(blob)
        + string(noise(f"sealed {name}", 160))
    )
    return enclosed("OPENSSH PRIVATE KEY", wrapped(container, 70))


def pgp_block(name: str = "one") -> str:
    """What a PGP private key looks like in a file. It is noise between the
    boundary lines: the scan does not read PGP, and says so."""
    lines = ["Version: Example 1.0", "", *wrapped(noise(name, 300)), "=" + "Ab3d"]
    return enclosed("PGP PRIVATE KEY BLOCK", lines)


def token(prefix: str = "ghp", name: str = "one", length: int = 36) -> str:
    """Text in the form of a GitHub token, the same for the same name. No
    one issued it."""
    letters = "".join(
        letter
        for letter in base64.b64encode(noise(f"token {name}", 600)).decode("ascii")
        if letter.isalnum()
    )[:length]
    assert len(letters) == length
    assert any(letter.islower() for letter in letters)
    assert any(letter.isupper() for letter in letters)
    assert any(letter.isdigit() for letter in letters)
    return f"{prefix}_{letters}"


def body(text: str) -> list[str]:
    """The lines of a key, a token or a file of them that must be copied
    nowhere: every line of base64, and a token whole."""
    return [
        line
        for line in (raw.strip() for raw in text.splitlines())
        if len(line) >= 16 and not line.startswith("-----") and ": " not in line
    ]


def block(text: str) -> Block:
    """The block a PEM file holds, as the scan hands one to be read."""
    lines = [line for line in text.strip().splitlines() if line]
    label = lines[0].removeprefix("-----BEGIN ").removesuffix("-----")
    headers = [line for line in lines[1:-1] if ": " in line]
    data = [line for line in lines[1:-1] if ": " not in line]
    return Block(
        label, tuple(header.encode() for header in headers), "".join(data).encode()
    )


# --- the ways a key gets written into a file that is not a key file


def in_json(text: str) -> str:
    return json.dumps({"type": "service_account", "private_key": text}, indent=2)


def in_env(text: str) -> str:
    return 'SIGNING_KEY="' + text.replace("\n", "\\n") + '"\n'


def in_yaml(text: str) -> str:
    lines = text.strip().split("\n")
    return "data:\n  key: |\n" + "\n".join(f"    {line}" for line in lines) + "\n"


def in_javascript(text: str) -> str:
    lines = text.strip().split("\n")
    return "const key =\n" + " +\n".join(f"  '{line}\\n'" for line in lines) + ";\n"


def in_python(text: str) -> str:
    lines = text.strip().split("\n")
    return "KEY = (\n" + "\n".join(f'    "{line}\\n"' for line in lines) + "\n)\n"


def in_java(text: str) -> str:
    first, *rest = text.strip().split("\n")
    following = "\n".join(f'    + "{line}\\n"' for line in rest)
    return f'String key = "{first}\\n"\n{following};\n'


# --- a key written by hand, for what no library will write


def der_length(length: int) -> bytes:
    if length < 128:
        return bytes([length])
    size = length.to_bytes((length.bit_length() + 7) // 8, "big")
    return bytes([0x80 | len(size)]) + size


def der_integer(number: int) -> bytes:
    data = number.to_bytes(number.bit_length() // 8 + 1, "big")
    return b"\x02" + der_length(len(data)) + data


def rsa_with_modulus(modulus: int | None = None) -> str:
    """The RSA key of the run in the form RFC 8017 gives one, with the
    modulus given in place of its own."""
    numbers = rsa_key().private_numbers()
    fields = b"".join(
        der_integer(number)
        for number in (
            0,
            numbers.public_numbers.n if modulus is None else modulus,
            numbers.public_numbers.e,
            numbers.d,
            numbers.p,
            numbers.q,
            numbers.dmp1,
            numbers.dmq1,
            numbers.iqmp,
        )
    )
    return enclosed(
        "RSA PRIVATE KEY", wrapped(b"\x30" + der_length(len(fields)) + fields)
    )
