"""Reads what the boundary lines of a private key enclose as a key.

A key that loads is a private key, with nothing left to doubt, which is what
lets a finding say so. But a loader checks what it loads, and for some kinds
of key the check takes as long as the numbers in it are large: seconds for a
large key, hours for one written to waste them. A call into a loader cannot be
interrupted and a process can be ended, so keys are read in a process of their
own: `Reader` starts it, asks it about one block at a time and ends it when an
answer takes too long.

That process is this module, run as a program. It is given the block on its
input and answers with what kind of key it is. It writes nothing else
anywhere, and it ends itself after the time it was started for, so that it
does not outlive a worker that was killed.
"""

from __future__ import annotations

import base64
import contextlib
import hashlib
import json
import math
import os
import resource
import select
import signal
import subprocess
import sys
import time
import warnings
from dataclasses import asdict, dataclass
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

# How long one scan gives itself to read keys, how long it gives any one, and
# how long it waits for the process that reads them to start.
KEY_SECONDS = 20.0
ONE_KEY_SECONDS = 5.0
START_SECONDS = 10.0
# How long after its time the process ends itself. The reader ends it on
# time; this is for when the reader cannot.
OUTLIVED_SECONDS = 5

COMMAND = (sys.executable, "-I", "-m", "forgemind_api.keys")
READY = b"ready"


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


class Late(Exception):
    """The process did not answer in time."""


class Ended(Exception):
    """The process ended, or said something that is not an answer."""


class Reader:
    """Reads keys in a process of its own, within the time one scan has.

    The process is started for the first key there is to read, so a
    repository that holds none starts none."""

    def __init__(
        self,
        seconds: float = KEY_SECONDS,
        each: float = ONE_KEY_SECONDS,
        starting: float = START_SECONDS,
        command: tuple[str, ...] = COMMAND,
    ) -> None:
        self.seconds = seconds
        self.left = seconds
        self.each = each
        self.starting = starting
        self.command = command
        # How many keys took too long to read, and why no more are read.
        self.slow = 0
        self.stopped: str | None = None
        self.process: subprocess.Popen[bytes] | None = None
        self.pending = b""

    def __enter__(self) -> Reader:
        return self

    def __exit__(self, *_: object) -> None:
        self.end()

    def read(self, block: Block) -> Key | None:
        """The block read as a key, or None once no more are read, which
        `stopped` then gives the reason for."""
        if self.stopped is None and self.left <= 0:
            self.stopped = (
                f"It gives itself {self.seconds:.0f} seconds to read keys, and "
                "they were spent."
            )
        if self.stopped is not None:
            return None
        began = time.monotonic()
        try:
            return self.ask(block)
        finally:
            self.left -= time.monotonic() - began

    def ask(self, block: Block) -> Key | None:
        if self.process is None and not self.start():
            self.stopped = "The process that reads keys did not start."
            return None
        asked = {
            "label": block.label,
            "headers": [header.decode("latin-1") for header in block.headers],
            "data": block.data.decode("ascii"),
        }
        deadline = time.monotonic() + self.each
        try:
            self.send(json.dumps(asked).encode() + b"\n", deadline)
            return Key(**json.loads(self.receive(deadline)))
        except Late:
            self.end()
            self.slow += 1
            return Key("slow", block.digest())
        except (Ended, OSError, ValueError, TypeError):
            # It ended over this block, or answered with something else than
            # a key. Either way the block was not read as one.
            self.end()
            return Key("unread", block.digest())

    def start(self) -> bool:
        lifetime = math.ceil(self.left + self.starting) + OUTLIVED_SECONDS
        try:
            self.process = subprocess.Popen(
                [*self.command, str(lifetime)],
                # Nothing of the server's own: it has no use for any of it.
                env={"PATH": "/usr/local/bin:/usr/bin:/bin", "LC_ALL": "C"},
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                # What a loader says of a key may quote it.
                stderr=subprocess.DEVNULL,
                bufsize=0,
            )
        except OSError:
            return False
        assert self.process.stdin is not None
        os.set_blocking(self.process.stdin.fileno(), False)
        try:
            said = self.receive(time.monotonic() + self.starting)
        except (Late, Ended, OSError):
            said = None
        if said != READY:
            self.end()
            return False
        return True

    def send(self, data: bytes, deadline: float) -> None:
        assert self.process is not None and self.process.stdin is not None
        channel = self.process.stdin.fileno()
        view = memoryview(data)
        while view:
            wait = deadline - time.monotonic()
            if wait <= 0 or not select.select([], [channel], [], wait)[1]:
                raise Late
            view = view[os.write(channel, view) :]

    def receive(self, deadline: float) -> bytes:
        """The next line the process says."""
        assert self.process is not None and self.process.stdout is not None
        channel = self.process.stdout.fileno()
        while b"\n" not in self.pending:
            wait = deadline - time.monotonic()
            if wait <= 0 or not select.select([channel], [], [], wait)[0]:
                raise Late
            chunk = os.read(channel, 1 << 16)
            if not chunk:
                raise Ended
            self.pending += chunk
        line, _, self.pending = self.pending.partition(b"\n")
        return line

    def end(self) -> None:
        """Ends the process, whatever it is doing."""
        process, self.process, self.pending = self.process, None, b""
        if process is None:
            return
        with contextlib.suppress(ProcessLookupError):
            process.kill()
        for channel in (process.stdin, process.stdout):
            if channel is not None:
                with contextlib.suppress(OSError):
                    channel.close()
        process.wait()


def serve(lifetime: int) -> None:
    """Answers for one block after another, until there are no more or the
    time is up."""
    # The system ends the process then, whatever it is in the middle of.
    signal.signal(signal.SIGALRM, signal.SIG_DFL)
    signal.alarm(lifetime)
    # Its memory holds the keys it reads, and is not to be written out.
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    out = sys.stdout.buffer
    out.write(READY + b"\n")
    out.flush()
    for line in sys.stdin.buffer:
        asked = json.loads(line)
        block = Block(
            asked["label"],
            tuple(header.encode("latin-1") for header in asked["headers"]),
            asked["data"].encode("ascii"),
        )
        out.write(json.dumps(asdict(read_key(block))).encode() + b"\n")
        out.flush()


if __name__ == "__main__":
    serve(int(sys.argv[1]))
