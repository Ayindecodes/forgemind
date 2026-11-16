"""What a scan of a repository raises, in the form every scanner gives it.

A scanner reads the files of a checkout and says what it found and where. It
runs nothing, and what it hands back holds nothing of what it read: a finding
says where something is and of what kind.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any, Literal

Severity = Literal["critical", "high", "medium", "low", "info"]
Confidence = Literal["confirmed", "likely", "suspected"]


@dataclass(frozen=True)
class Raised:
    """One thing a scanner found, at a path and a line of the commit scanned.

    `identity` tells it from anything else the rule could raise in the same
    file, and is the same each time the same thing is found, whatever line it
    has moved to. It is a digest, never the thing itself."""

    rule: str
    identity: str
    title: str
    severity: Severity
    confidence: Confidence
    category: str
    path: str
    line: int | None
    evidence: str
    remediation: str
    advisory_url: str | None = None


@dataclass(frozen=True)
class Scanned:
    """What one scanner made of a checkout.

    `unread` are the files it cannot speak for, and `cut_short` says it
    stopped before the end. Not finding something again in either proves
    nothing, so what was raised there before is left as it was. `concerns`
    say the same to people, in the form the analysis lists them."""

    tool: str
    raised: tuple[Raised, ...]
    unread: frozenset[str] = frozenset()
    cut_short: bool = False
    concerns: tuple[dict[str, Any], ...] = ()


def fingerprint(tool: str, raised: Raised) -> str:
    """What the next scan knows a finding again by: the scanner, the rule, the
    file and the identity, as one digest."""
    digest = hashlib.sha256()
    for part in (tool, raised.rule, raised.path, raised.identity):
        data = part.encode()
        digest.update(len(data).to_bytes(8, "big"))
        digest.update(data)
    return digest.hexdigest()
