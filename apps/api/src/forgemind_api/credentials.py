"""Finds credentials committed to a repository: private keys, and tokens in a
format their issuer documents.

Everything is found by reading bytes, and nothing found is tried anywhere. A
private key is recognised by the boundary lines RFC 7468 gives it and is then
read as a key: one that loads is a private key, with nothing left to doubt,
and is reported as confirmed. A token is recognised by a prefix its issuer
documents, which proves less, and is reported as a suspicion that says so.

Nothing found is copied. A finding says where the credential is and of what
kind. What tells it from another is a digest: of the public half of a key
that loads, of the text otherwise.

Not found: a key in a binary form (DER, PKCS #12, a Java keystore), a key
encoded once more (the base64 of a whole PEM file, as a Kubernetes secret has
it), a key written some other way than on its own lines or as the lines of a
quoted string, and anything that is only in the history, since one commit is
read.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any

from forgemind_api.inspection import (
    ILLUSTRATIONS,
    MAX_EVIDENCE,
    TRIALS,
    amount,
    plural,
    scan,
    series,
    set_aside,
)
from forgemind_api.keys import ONE_KEY_SECONDS, Block, Key, Reader
from forgemind_api.scanning import Raised, Scanned, Severity

TOOL = "credential-scan"
CATEGORY = "exposed_credential"

# The most files one scan lists and the most it reads of any one.
MAX_SCAN_FILES = 200_000
MAX_SCAN_BYTES = 5_000_000
# How far after the beginning of a key its end is looked for, and how many
# beginnings are looked into in one file. Together they bound the work a file
# written to waste it can cause.
MAX_BLOCK_BYTES = 64_000
MAX_BEGINNINGS = 200
# The most findings listed for one file, and for one scan.
MAX_PER_FILE = 20
MAX_RAISED = 500

# What tells a key from a placeholder for one before it is read: enough
# base64, and not one character over and over. The shortest key there is, an
# Ed25519 one in PKCS #8, is 64 characters.
MIN_KEY_CHARACTERS = 60
MIN_DISTINCT = 10

# Every directory is looked in, other people's code and build output too: a
# credential is exposed wherever it is committed.
SKIPPED = frozenset({".git"})
DEPENDENCIES = frozenset(
    {
        "node_modules",
        "bower_components",
        "vendor",
        "third_party",
        "site-packages",
        ".venv",
        "venv",
        ".tox",
    }
)

BEGINNING = b"-----BEGIN "
# RFC 7468's boundary, for any label that ends as a private key's does:
# PRIVATE KEY (PKCS #8), ENCRYPTED PRIVATE KEY, RSA, EC and DSA PRIVATE KEY
# (each algorithm's own form), OPENSSH PRIVATE KEY, PGP PRIVATE KEY BLOCK.
BEGIN = re.compile(rb"-----BEGIN ((?:[A-Z0-9]{1,20} ){0,3}PRIVATE KEY(?: BLOCK)?)-----")
# A key written into a string: an escape for a new line stands for one, and
# the quotes, commas and plus signs that string the lines together go. A plus
# sign goes only beside a quote, since base64 has plus signs of its own.
ESCAPED_LINE = re.compile(rb"\\r\\n|\\[nr]")
JOIN = re.compile(rb"""[\s+,;()\\]*["'`][\s"'`+,;()\\]*""")
CLOSING = re.compile(rb"""(?:["'`]+\s*[+,;)\\]*|[,;\\]+)$""")
OPENING = re.compile(rb"""^(?:\+\s*)?["'`]+""")
# `Proc-Type: 4,ENCRYPTED` in an encrypted key of the older forms, `Version:`
# and `Comment:` in a PGP block; and the checksum that ends a PGP block.
HEADER = re.compile(rb"[A-Za-z][A-Za-z0-9-]*: ?\S")
CHECKSUM = re.compile(rb"=[A-Za-z0-9+/]{4}")
BASE64 = re.compile(rb"[A-Za-z0-9+/]+={0,2}")

# The prefixes GitHub documents for its tokens, each with what it says the
# token is. It documents the prefix and not what follows, so the rest of the
# rule is this scanner's own: at least this many letters, digits and
# underscores, among them a small letter, a capital and a digit. That is a
# guess at what tells a token from a placeholder for one, and it can be wrong
# both ways.
GITHUB_TOKENS: dict[bytes, str] = {
    b"ghp": "personal access token (classic)",
    b"github_pat": "fine-grained personal access token",
    b"gho": "OAuth access token",
    b"ghu": "user access token for a GitHub App",
    b"ghs": "installation access token for a GitHub App",
    b"ghr": "refresh token for a GitHub App",
}
MIN_TOKEN_CHARACTERS = 30
TOKEN = re.compile(
    rb"(?<![A-Za-z0-9_])(%s)_([A-Za-z0-9_]{%d,})"
    % (b"|".join(GITHUB_TOKENS), MIN_TOKEN_CHARACTERS)
)
MIXED = (re.compile(rb"[a-z]"), re.compile(rb"[A-Z]"), re.compile(rb"[0-9]"))

NOT_KEPT = (
    "It is not copied here: what is kept is where it is, and a digest to know "
    "it again by."
)
HISTORY = (
    "Removing it in a new commit does not take it out of the history: whoever "
    "can read the repository can still read it there."
)
AMONG_TRIALS = (
    " It is under a directory of tests or examples, where credentials made for "
    "the purpose are usual, so it is rated low."
)
AMONG_DEPENDENCIES = (
    " It is under a directory of dependencies, where a credential has usually "
    "come with a published package, so it is rated low."
)


def lines_of(body: bytes) -> list[bytes]:
    """The lines of a key as a file of its own would have them."""
    lines: list[bytes] = []
    for raw in ESCAPED_LINE.sub(b"\n", body).splitlines():
        if JOIN.fullmatch(raw):
            continue
        line = OPENING.sub(b"", CLOSING.sub(b"", raw.strip())).strip()
        if line:
            lines.append(line)
    return lines


def block_of(label: str, body: bytes) -> Block | None:
    """The key between two boundary lines, or None where what is between
    them is not one: prose about keys, or a placeholder for one."""
    headers: list[bytes] = []
    data: list[bytes] = []
    for line in lines_of(body):
        if not data and HEADER.match(line):
            headers.append(line)
        elif label.endswith("BLOCK") and CHECKSUM.fullmatch(line):
            continue
        else:
            data.append(line)
    joined = b"".join(data)
    if (
        len(joined) < MIN_KEY_CHARACTERS
        or len(set(joined)) < MIN_DISTINCT
        or not BASE64.fullmatch(joined)
    ):
        return None
    return Block(label, tuple(headers), joined)


def rated(path: str, otherwise: Severity) -> tuple[Severity, str]:
    """How a credential at `path` is rated, and why if it is rated low."""
    if set_aside(path, TRIALS | ILLUSTRATIONS):
        return "low", AMONG_TRIALS
    if set_aside(path, DEPENDENCIES):
        return "low", AMONG_DEPENDENCIES
    return otherwise, ""


def key_finding(path: str, first: int, last: int, block: Block, key: Key) -> Raised:
    where = f"Line {first} holds" if first == last else f"Lines {first} to {last} hold"
    labelled = f"{where} a block labelled {block.label}"
    if key.standing == "open":
        severity, why = rated(path, "high")
        told = (
            f" Its public half has the SSH fingerprint {key.ssh_fingerprint}."
            if key.ssh_fingerprint
            else ""
        )
        return Raised(
            rule="private-key",
            identity=key.identity,
            title=f"{key.name[0].upper()}{key.name[1:]} committed",
            severity=severity,
            confidence="confirmed",
            category=CATEGORY,
            path=path,
            line=first,
            evidence=(
                f"{labelled}, which loads as {key.article} {key.name}{key.detail} "
                f"with no passphrase.{told} Whether anything still accepts the "
                f"key was not checked.{why} {NOT_KEPT}"
            ),
            remediation=(
                "Replace the key wherever it is accepted, then remove it from "
                f"the repository. {HISTORY}"
            ),
        )
    if key.standing == "protected":
        severity, why = rated(path, "medium")
        return Raised(
            rule="encrypted-private-key",
            identity=key.identity,
            title="Private key protected by a passphrase committed",
            severity=severity,
            confidence="likely",
            category=CATEGORY,
            path=path,
            line=first,
            evidence=(
                f"{labelled}, which is a private key that asks for a "
                "passphrase. No passphrase was tried, so the key was not read: "
                f"how exposed it is rests on how hard its passphrase is to "
                f"guess.{why} {NOT_KEPT}"
            ),
            remediation=(
                "Unless the passphrase is strong and kept somewhere else, "
                "replace the key wherever it is accepted. Either way, remove "
                f"it from the repository. {HISTORY}"
            ),
        )
    severity, why = rated(path, "medium")
    if key.standing == "slow":
        unread = (
            f"reading it took longer than the {ONE_KEY_SECONDS:.0f} seconds this "
            "scan gives one key"
        )
    elif block.label.endswith("BLOCK"):
        unread = "a format this scan does not read"
    else:
        unread = "it may be damaged, cut short, or of a kind this scan does not read"
    return Raised(
        rule="unread-private-key",
        identity=key.identity,
        title="What may be a private key committed",
        severity=severity,
        confidence="suspected",
        category=CATEGORY,
        path=path,
        line=first,
        evidence=(
            f"{labelled} with {len(block.data):,} characters of base64 in it. "
            f"It was not read as a key: {unread}. Whether it is one is not "
            f"known.{why} {NOT_KEPT}"
        ),
        remediation=(
            "Look at the block. If it is a key that is in use, replace the key "
            f"wherever it is accepted and remove it from the repository. {HISTORY}"
        ),
    )


def token_finding(path: str, line: int, prefix: bytes, rest: bytes) -> Raised | None:
    if not all(kind.search(rest) for kind in MIXED):
        return None
    name = GITHUB_TOKENS[prefix]
    severity, why = rated(path, "high")
    return Raised(
        rule="github-token",
        identity=hashlib.sha256(prefix + b"_" + rest).hexdigest(),
        title=f"What may be a GitHub {name} committed",
        severity=severity,
        confidence="likely",
        category=CATEGORY,
        path=path,
        line=line,
        evidence=(
            f"Line {line} holds text that begins {prefix.decode()}_, the prefix "
            f"GitHub documents for a {name}, and goes on for {len(rest):,} "
            "letters, digits and underscores. It was not tried at GitHub, so "
            f"whether it is a token that works, or ever did, is not known.{why} "
            f"{NOT_KEPT}"
        ),
        remediation=(
            "Check it at GitHub and revoke it if it is live, then take it out "
            f"of the file. {HISTORY}"
        ),
    )


def line_at(data: bytes, offset: int) -> int:
    return data.count(b"\n", 0, offset) + 1


def credentials_in(path: str, data: bytes, reader: Reader) -> tuple[list[Raised], bool]:
    """The credentials in one file, each once, and whether the file has more
    in it than is looked into or listed."""
    found: dict[tuple[str, str], Raised] = {}
    more = False
    if BEGINNING in data:
        for count, match in enumerate(BEGIN.finditer(data)):
            if count >= MAX_BEGINNINGS or len(found) > MAX_PER_FILE:
                more = True
                break
            label = match.group(1)
            end = data.find(
                b"-----END " + label + b"-----",
                match.end(),
                match.end() + MAX_BLOCK_BYTES,
            )
            if end < 0:
                continue
            block = block_of(label.decode(), data[match.end() : end])
            if block is None:
                continue
            key = reader.read(block)
            if key is None:
                break
            raised = key_finding(
                path, line_at(data, match.start()), line_at(data, end), block, key
            )
            found.setdefault((raised.rule, raised.identity), raised)
    if any(prefix + b"_" in data for prefix in GITHUB_TOKENS):
        # Counted on from the match before: a file may hold any number.
        at, line = 0, 1
        for match in TOKEN.finditer(data):
            if len(found) > MAX_PER_FILE:
                break
            line += data.count(b"\n", at, match.start())
            at = match.start()
            token = token_finding(path, line, match.group(1), match.group(2))
            if token is not None:
                found.setdefault((token.rule, token.identity), token)
    listed = list(found.values())
    return listed[:MAX_PER_FILE], more or len(listed) > MAX_PER_FILE


def scan_credentials(
    root: Path, max_files: int = MAX_SCAN_FILES, reader: Reader | None = None
) -> Scanned:
    """Scans the checkout at `root`."""
    tree = scan(root, max_files, ignored=SKIPPED)
    raised: list[Raised] = []
    oversized: list[str] = []
    unopened: list[str] = []
    overfull: list[str] = []
    slowed: list[str] = []
    stopped = (
        f"Only the first {len(tree.sizes):,} files were listed."
        if tree.truncated
        else None
    )
    with reader or Reader() as reading:
        for path, size in tree.sizes.items():
            if size == 0:
                continue
            if size > MAX_SCAN_BYTES:
                oversized.append(path)
                continue
            data = tree.read_bytes(path, MAX_SCAN_BYTES)
            if data is None:
                unopened.append(path)
                continue
            slow = reading.slow
            found, more = credentials_in(path, data, reading)
            if more:
                overfull.append(path)
            if reading.slow > slow:
                slowed.append(path)
            raised += found
            if reading.stopped is not None:
                stopped = reading.stopped
                break
            if len(raised) > MAX_RAISED:
                del raised[MAX_RAISED:]
                stopped = f"It lists {MAX_RAISED} findings and there were more."
                break
    return Scanned(
        tool=TOOL,
        raised=tuple(raised),
        unread=frozenset([*oversized, *unopened, *overfull, *slowed]),
        cut_short=stopped is not None,
        concerns=tuple(
            concerns(oversized, unopened, overfull, slowed, tree.unshown, stopped)
        ),
    )


def concerns(
    oversized: list[str],
    unopened: list[str],
    overfull: list[str],
    slowed: list[str],
    unshown: int,
    stopped: str | None,
) -> list[dict[str, Any]]:
    """What the scan did not cover, for the analysis to say."""
    found: list[dict[str, Any]] = []
    parts: list[str] = []
    if oversized:
        parts.append(
            f"{plural(len(oversized), 'file')} larger than the "
            f"{amount(MAX_SCAN_BYTES)} read of any one"
        )
    if unopened:
        parts.append(f"{plural(len(unopened), 'file')} that could not be opened")
    if overfull:
        parts.append(
            f"{plural(len(overfull), 'file')} with more in them than is listed "
            "for any one"
        )
    if slowed:
        parts.append(
            f"{plural(len(slowed), 'file')} with a key that took longer than "
            f"{ONE_KEY_SECONDS:.0f} seconds to read"
        )
    if unshown:
        # They are not among the evidence: a name that cannot be shown cannot
        # be listed either.
        parts.append(
            f"{plural(unshown, 'file')} with a name that holds characters "
            "that cannot be shown"
        )
    if parts:
        found.append(
            {
                "title": "Some files were not scanned for credentials",
                "detail": (
                    f"Left out, in whole or in part: {series(parts)}. A "
                    "credential in one of them is not reported, and a finding "
                    "raised there before is left as it was."
                ),
                "evidence": [
                    {"path": path, "line": None}
                    for path in sorted([*oversized, *unopened, *overfull, *slowed])[
                        :MAX_EVIDENCE
                    ]
                ],
            }
        )
    if stopped:
        found.append(
            {
                "title": "The scan for credentials stopped early",
                "detail": (
                    f"{stopped} The rest of the repository was not scanned, so "
                    "a credential there is not reported and no finding raised "
                    "before was closed."
                ),
                "evidence": [],
            }
        )
    return found
