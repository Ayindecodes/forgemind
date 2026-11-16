"""The scan for committed credentials, on small trees written for each test
with keys made when it runs."""

from __future__ import annotations

import json
import sys
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from forgemind_api import credentials
from forgemind_api.credentials import TOOL, scan_credentials
from forgemind_api.keys import Reader, read_key
from forgemind_api.scanning import Raised, Scanned, fingerprint
from tests import keys

BEGIN = keys.boundary("BEGIN", "PRIVATE KEY")
END = keys.boundary("END", "PRIVATE KEY")
NOT_SCANNED = "Some files were not scanned for credentials"
STOPPED = "The scan for credentials stopped early"
ASLEEP = (
    sys.executable,
    "-I",
    "-c",
    "import time; print('ready', flush=True); time.sleep(60)",
)


def tree(root: Path, files: dict[str, str | bytes]) -> Path:
    for path, content in files.items():
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content if isinstance(content, bytes) else content.encode())
    return root


def scanned(root: Path, files: dict[str, str | bytes], **options: Any) -> Scanned:
    return scan_credentials(tree(root, files), **options)


def told(found: Scanned) -> list[tuple[str, str, int | None, str, str]]:
    return [
        (raised.rule, raised.path, raised.line, raised.severity, raised.confidence)
        for raised in found.raised
    ]


def only(found: Scanned) -> Raised:
    assert len(found.raised) == 1, told(found)
    return found.raised[0]


def concern(found: Scanned, title: str) -> dict[str, Any]:
    matching = [item for item in found.concerns if item["title"] == title]
    assert len(matching) == 1, found.concerns
    return matching[0]


def identity(text: str) -> str:
    return read_key(keys.block(text)).identity


def crlf(text: str) -> str:
    return text.replace("\n", "\r\n")


def indented(text: str) -> str:
    return "".join(f"\t{line}\n" for line in text.splitlines())


# --- private keys


def test_a_private_key_is_found_at_its_file_and_line(tmp_path: Path) -> None:
    written = keys.pem()
    found = scanned(tmp_path, {"deploy/id.pem": f"# The deploy key.\n\n{written}"})
    assert found.tool == TOOL == "credential-scan"
    assert (found.unread, found.cut_short, found.concerns) == (frozenset(), False, ())
    raised = only(found)
    assert raised == Raised(
        rule="private-key",
        identity=identity(written),
        title="Ed25519 private key committed",
        severity="high",
        confidence="confirmed",
        category="exposed_credential",
        path="deploy/id.pem",
        line=3,
        evidence=(
            "Lines 3 to 5 hold a block labelled PRIVATE KEY, which loads as an "
            "Ed25519 private key with no passphrase. Its public half has the SSH "
            "fingerprint SHA256:2Ep4KZ7BvzsP01jG0FC1S490fDK9sPOiEhCOlDoB+a4. "
            "Whether anything still accepts the key was not checked. It is not "
            "copied here: what is kept is where it is, and a digest to know it "
            "again by."
        ),
        remediation=(
            "Replace the key wherever it is accepted, then remove it from the "
            "repository. Removing it in a new commit does not take it out of the "
            "history: whoever can read the repository can still read it there."
        ),
        advisory_url=None,
    )


@pytest.mark.parametrize(
    ("write", "title", "label"),
    [
        pytest.param(
            lambda: keys.pem(keys.rsa_key()),
            "RSA private key committed",
            "PRIVATE KEY, which loads as an RSA private key of 2048 bits",
            id="rsa",
        ),
        pytest.param(
            lambda: keys.pem(keys.rsa_key(), keys.TRADITIONAL),
            "RSA private key committed",
            "RSA PRIVATE KEY, which loads as an RSA private key of 2048 bits",
            id="rsa in its own form",
        ),
        pytest.param(
            lambda: keys.pem(keys.ec_key(), keys.TRADITIONAL),
            "EC private key committed",
            "EC PRIVATE KEY, which loads as an EC private key on the curve secp256r1",
            id="ec in its own form",
        ),
        pytest.param(
            lambda: keys.pem(keys.rsa_key(), keys.OPENSSH),
            "RSA private key committed",
            "OPENSSH PRIVATE KEY, which loads as an RSA private key of 2048 bits",
            id="rsa as openssh writes it",
        ),
        pytest.param(
            lambda: keys.pem(form=keys.OPENSSH),
            "Ed25519 private key committed",
            "OPENSSH PRIVATE KEY, which loads as an Ed25519 private key with",
            id="ed25519 as openssh writes it",
        ),
    ],
)
def test_each_kind_of_key_is_found_and_named(
    tmp_path: Path, write: Callable[[], str], title: str, label: str
) -> None:
    written = write()
    raised = only(scanned(tmp_path, {"id": written}))
    assert (raised.rule, raised.severity, raised.confidence, raised.line) == (
        "private-key",
        "high",
        "confirmed",
        1,
    )
    assert raised.title == title
    last = len(written.splitlines())
    assert raised.evidence.startswith(
        f"Lines 1 to {last} hold a block labelled {label}"
    )
    assert raised.identity == identity(written)


@pytest.mark.parametrize(
    ("path", "within", "line"),
    [
        pytest.param("service-account.json", keys.in_json, 3, id="json"),
        pytest.param(".env", keys.in_env, 1, id="env"),
        pytest.param("k8s/secret.yaml", keys.in_yaml, 3, id="yaml"),
        pytest.param("src/key.js", keys.in_javascript, 2, id="javascript"),
        pytest.param("src/key.py", keys.in_python, 2, id="python"),
        pytest.param("src/Key.java", keys.in_java, 1, id="java"),
        pytest.param("windows.pem", crlf, 1, id="crlf"),
        pytest.param("indented.txt", indented, 1, id="indented"),
    ],
)
def test_a_key_written_into_another_file_is_the_same_key(
    tmp_path: Path, path: str, within: Callable[[str], str], line: int
) -> None:
    """The lines of a key as the lines of a quoted string, or of a block of
    text in a file of something else."""
    for written in (keys.pem(keys.rsa_key(), keys.TRADITIONAL), keys.pem()):
        root = tmp_path / str(len(written))
        raised = only(scanned(root, {path: within(written)}))
        assert (raised.rule, raised.confidence, raised.path, raised.line) == (
            "private-key",
            "confirmed",
            path,
            line,
        )
        assert raised.identity == identity(written)


@pytest.mark.parametrize(
    "write",
    [
        pytest.param(lambda: keys.pem(keys.rsa_key(), keys.PKCS8, b"a"), id="pkcs8"),
        pytest.param(
            lambda: keys.pem(keys.rsa_key(), keys.TRADITIONAL, b"a"), id="traditional"
        ),
        pytest.param(keys.protected_openssh, id="openssh"),
    ],
)
def test_a_key_that_asks_for_a_passphrase_is_likely_and_says_why(
    tmp_path: Path, write: Callable[[], str]
) -> None:
    written = write()
    found = scanned(tmp_path, {"deploy/id": written})
    raised = only(found)
    assert told(found) == [
        ("encrypted-private-key", "deploy/id", 1, "medium", "likely")
    ]
    assert raised.title == "Private key protected by a passphrase committed"
    assert "asks for a passphrase. No passphrase was tried" in raised.evidence
    assert raised.remediation.startswith("Unless the passphrase is strong")
    assert raised.identity == keys.block(written).digest()


def test_what_may_be_a_key_is_a_suspicion_that_says_so(tmp_path: Path) -> None:
    cut = keys.enclosed("PRIVATE KEY", keys.pem(keys.rsa_key()).splitlines()[1:9])
    found = scanned(tmp_path, {"secret.asc": keys.pgp_block(), "cut.pem": cut})
    assert told(found) == [
        ("unread-private-key", "cut.pem", 1, "medium", "suspected"),
        ("unread-private-key", "secret.asc", 1, "medium", "suspected"),
    ]
    damaged, pgp = found.raised
    assert damaged.title == pgp.title == "What may be a private key committed"
    assert damaged.evidence.startswith(
        "Lines 1 to 10 hold a block labelled PRIVATE KEY with 512 characters of "
        "base64 in it. It was not read as a key: it may be damaged, cut short, or "
        "of a kind this scan does not read. Whether it is one is not known."
    )
    assert "It was not read as a key: a format this scan does not read." in pgp.evidence
    assert pgp.remediation.startswith("Look at the block.")


@pytest.mark.parametrize(
    "content",
    [
        pytest.param(
            f"A key begins with `{BEGIN}` and ends with `{END}`.\n", id="prose"
        ),
        pytest.param(f"{BEGIN}\n...\n{END}\n", id="an ellipsis"),
        pytest.param(f"{BEGIN}\n<your key here>\n{END}\n", id="a placeholder"),
        pytest.param(f"{BEGIN}\n{'x' * 200}\n{END}\n", id="one letter over and over"),
        pytest.param(
            f"{BEGIN}\n{'ABCDEFGHIJ' * 5}\n{END}\n", id="too little to be a key"
        ),
        pytest.param(
            f"{BEGIN}\nPaste the key here, all of its lines, and keep the "
            f"boundary lines as they are.\n{END}\n",
            id="words",
        ),
        pytest.param(
            lambda: keys.pem().replace("PRIVATE KEY", "PUBLIC KEY"), id="a public key"
        ),
        pytest.param(
            lambda: keys.pem().replace("PRIVATE KEY", "CERTIFICATE"),
            id="a certificate",
        ),
        pytest.param(lambda: keys.pem().split("-----END")[0], id="no end"),
        pytest.param(
            lambda: keys.pem().replace("END PRIVATE", "END RSA PRIVATE"),
            id="the end of another",
        ),
        pytest.param(
            lambda: keys.pem().replace("BEGIN PRIVATE", "BEGIN private"),
            id="not the label",
        ),
        pytest.param(
            lambda: keys.pem().replace(
                "-----END", "\n" * credentials.MAX_BLOCK_BYTES + "-----END"
            ),
            id="an end too far off",
        ),
    ],
)
def test_what_only_looks_like_a_key_is_not_raised(
    tmp_path: Path, content: str | Callable[[], str]
) -> None:
    text = content if isinstance(content, str) else content()
    found = scanned(tmp_path, {"docs/keys.md": text})
    assert (found.raised, found.unread, found.concerns) == ((), frozenset(), ())


def test_no_process_is_started_where_there_is_no_key(tmp_path: Path) -> None:
    files: dict[str, str | bytes] = {
        "docs/keys.md": f"{BEGIN}\n<your key here>\n{END}\n",
        "ci/deploy.sh": f"export GH_TOKEN={keys.token()}\n",
        "src/main.py": "print('hello')\n",
    }
    reader = Reader(command=("/nonexistent/python",))
    found = scanned(tmp_path, files, reader=reader)
    assert [raised.rule for raised in found.raised] == ["github-token"]
    assert (reader.stopped, found.cut_short) == (None, False)


# --- where it is


@pytest.mark.parametrize(
    ("path", "reason"),
    [
        ("tests/fixtures/id.pem", "tests or examples"),
        ("src/__tests__/id.pem", "tests or examples"),
        ("examples/tls/server.key", "tests or examples"),
        ("e2e-browser/keys/id.pem", "tests or examples"),
        ("node_modules/http-thing/test.pem", "dependencies"),
        ("vendor/github.com/x/y/key.pem", "dependencies"),
    ],
)
def test_a_key_among_tests_or_dependencies_is_rated_low_and_says_why(
    tmp_path: Path, path: str, reason: str
) -> None:
    raised = only(scanned(tmp_path, {path: keys.pem()}))
    # What it is does not change with where it is.
    assert (raised.rule, raised.confidence, raised.severity) == (
        "private-key",
        "confirmed",
        "low",
    )
    assert f"It is under a directory of {reason}, where" in raised.evidence
    assert "so it is rated low." in raised.evidence
    protected = only(scanned(tmp_path / "p", {path: keys.protected_openssh()}))
    assert (protected.severity, protected.confidence) == ("low", "likely")
    token = only(scanned(tmp_path / "t", {path: keys.token()}))
    assert (token.severity, token.confidence) == ("low", "likely")


def test_every_directory_is_looked_in_but_gits_own(tmp_path: Path) -> None:
    """Build output and other people's code are not this repository's work,
    and a key committed there is exposed all the same."""
    files: dict[str, str | bytes] = {
        path: keys.pem(keys.ed25519_key(path))
        for path in (
            "dist/bundle.js",
            "build/out/id.pem",
            "target/key.pem",
            ".venv/lib/key.pem",
            ".hidden/key.pem",
            ".git/key.pem",
            "testing.pem",
        )
    }
    found = scanned(tmp_path, files)
    assert sorted(told(found)) == [
        ("private-key", ".hidden/key.pem", 1, "high", "confirmed"),
        ("private-key", ".venv/lib/key.pem", 1, "low", "confirmed"),
        ("private-key", "build/out/id.pem", 1, "high", "confirmed"),
        ("private-key", "dist/bundle.js", 1, "high", "confirmed"),
        ("private-key", "target/key.pem", 1, "high", "confirmed"),
        ("private-key", "testing.pem", 1, "high", "confirmed"),
    ]


def test_a_link_is_not_followed(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    tree(outside, {"id.pem": keys.pem(), "more/id.pem": keys.pem()})
    root = tree(tmp_path / "checkout", {"README.md": "Nothing here.\n"})
    (root / "key.pem").symlink_to(outside / "id.pem")
    (root / "keys").symlink_to(outside / "more")
    found = scan_credentials(root)
    assert (found.raised, found.unread, found.concerns) == ((), frozenset(), ())


# --- one finding for one credential


def test_a_key_twice_in_a_file_is_one_finding_and_two_keys_are_two(
    tmp_path: Path,
) -> None:
    one, two = keys.pem(keys.ed25519_key("one")), keys.pem(keys.ed25519_key("two"))
    found = scanned(
        tmp_path,
        {
            "twice.pem": f"{one}\n{one}",
            # The same key in another form is the same key.
            "forms.pem": f"\n{one}{keys.pem(form=keys.OPENSSH)}",
            "both.pem": f"{one}{two}",
            "other/twice.pem": one,
        },
    )
    assert sorted(told(found)) == [
        ("private-key", "both.pem", 1, "high", "confirmed"),
        ("private-key", "both.pem", 4, "high", "confirmed"),
        ("private-key", "forms.pem", 2, "high", "confirmed"),
        ("private-key", "other/twice.pem", 1, "high", "confirmed"),
        ("private-key", "twice.pem", 1, "high", "confirmed"),
    ]
    first, second, forms, other, twice = sorted(
        found.raised, key=lambda raised: (raised.path, raised.line or 0)
    )
    assert first.identity == forms.identity == other.identity == twice.identity
    assert first.identity != second.identity
    # The same key in two files is two findings: each is somewhere to remove
    # it from.
    marks = {fingerprint(found.tool, raised) for raised in found.raised}
    assert len(marks) == 5


def test_a_finding_is_known_again_wherever_in_the_file_it_moves(
    tmp_path: Path,
) -> None:
    before = only(scanned(tmp_path / "a", {"id.pem": keys.pem()}))
    after = only(scanned(tmp_path / "b", {"id.pem": f"# Moved.\n\n\n{keys.pem()}"}))
    assert (before.line, after.line) == (1, 4)
    assert fingerprint(TOOL, before) == fingerprint(TOOL, after)
    # In another file, or another key in the same file, it is another finding.
    moved = only(scanned(tmp_path / "c", {"old/id.pem": keys.pem()}))
    other = only(scanned(tmp_path / "d", {"id.pem": keys.pem(keys.ed25519_key("two"))}))
    assert len({fingerprint(TOOL, each) for each in (before, moved, other)}) == 3


# --- tokens


@pytest.mark.parametrize(
    ("prefix", "name"),
    [
        ("ghp", "personal access token (classic)"),
        ("github_pat", "fine-grained personal access token"),
        ("gho", "OAuth access token"),
        ("ghu", "user access token for a GitHub App"),
        ("ghs", "installation access token for a GitHub App"),
        ("ghr", "refresh token for a GitHub App"),
    ],
)
def test_a_token_in_githubs_form_is_likely_one_and_says_it_was_not_tried(
    tmp_path: Path, prefix: str, name: str
) -> None:
    token = keys.token(prefix)
    script = f'#!/bin/sh\n\ncurl -H "Authorization: token {token}" https://x.invalid\n'
    raised = only(scanned(tmp_path, {"ci/deploy.sh": script}))
    assert raised == Raised(
        rule="github-token",
        identity=raised.identity,
        title=f"What may be a GitHub {name} committed",
        severity="high",
        confidence="likely",
        category="exposed_credential",
        path="ci/deploy.sh",
        line=3,
        evidence=(
            f"Line 3 holds text that begins {prefix}_, the prefix GitHub documents "
            f"for a {name}, and goes on for 36 letters, digits and underscores. It "
            "was not tried at GitHub, so whether it is a token that works, or ever "
            "did, is not known. It is not copied here: what is kept is where it "
            "is, and a digest to know it again by."
        ),
        remediation=(
            "Check it at GitHub and revoke it if it is live, then take it out of "
            "the file. Removing it in a new commit does not take it out of the "
            "history: whoever can read the repository can still read it there."
        ),
    )
    assert len(raised.identity) == 64 and raised.identity not in token


def test_what_only_looks_like_a_token_is_not_raised(tmp_path: Path) -> None:
    real = keys.token()
    prefix, rest = real.split("_", 1)
    found = scanned(
        tmp_path,
        {
            "placeholders.sh": "\n".join(
                [
                    f"export A={prefix}_{'x' * 36}",
                    f"export B={prefix}_YOUR_TOKEN_HERE_REPLACE_ME_WITH_THE_REAL_ONE",
                    f"export C={prefix}_your_token_here_replace_me_with_the_real_1",
                    # Too short for the rule.
                    f"export D={prefix}_{rest[:29]}",
                    # Part of a longer word, and a prefix GitHub does not document.
                    f"export E=x{real}",
                    f"export F=ghx_{rest}",
                    f"export G={prefix}-{rest}",
                    "",
                ]
            )
        },
    )
    assert found.raised == ()


def test_tokens_are_found_on_their_lines_each_once(tmp_path: Path) -> None:
    one, two = keys.token(name="one"), keys.token("ghs", name="two")
    text = f"A={one}\n\n\nB={two} C={one}\n\nD={one}\n"
    found = scanned(tmp_path, {".env": text})
    assert told(found) == [
        ("github-token", ".env", 1, "high", "likely"),
        ("github-token", ".env", 4, "high", "likely"),
    ]


# --- nothing found is copied


def test_nothing_of_a_credential_is_in_what_the_scan_hands_back(
    tmp_path: Path,
) -> None:
    written = {
        "id.pem": keys.pem(),
        "rsa.pem": keys.pem(keys.rsa_key(), keys.TRADITIONAL),
        "id_rsa": keys.pem(keys.rsa_key(), keys.OPENSSH),
        "locked.pem": keys.pem(keys.rsa_key(), keys.PKCS8, b"a"),
        "locked": keys.protected_openssh(),
        "secret.asc": keys.pgp_block(),
        "account.json": keys.in_json(keys.pem(keys.ec_key())),
        "ci.sh": f"T={keys.token()}\nU={keys.token('github_pat', length=82)}\n",
    }
    found = scanned(tmp_path, dict(written))
    assert len(found.raised) == 9
    handed = repr(found) + json.dumps([*found.concerns])
    secret = [line for text in written.values() for line in keys.body(text)]
    assert len(secret) > 60
    for line in secret:
        assert line not in handed
        # Nor a part of a line long enough to be worth having.
        assert line[:24] not in handed and line[-24:] not in handed


# --- what the scan does not cover, and says so


def test_a_file_too_large_to_read_is_named_and_not_spoken_for(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(credentials, "MAX_SCAN_BYTES", 4000)
    found = scanned(
        tmp_path,
        {
            "big.pem": keys.pem() + "#" * 4000,
            "at-the-limit.pem": (keys.pem() + "#" * 4000)[:4000],
            "empty": "",
        },
    )
    assert told(found) == [("private-key", "at-the-limit.pem", 1, "high", "confirmed")]
    assert (found.unread, found.cut_short) == (frozenset({"big.pem"}), False)
    assert concern(found, NOT_SCANNED) == {
        "title": NOT_SCANNED,
        "detail": (
            "Left out, in whole or in part: 1 file larger than the 4 kB read of "
            "any one. A credential in one of them is not reported, and a finding "
            "raised there before is left as it was."
        ),
        "evidence": [{"path": "big.pem", "line": None}],
    }


def test_the_most_read_of_one_file_is_five_megabytes() -> None:
    assert credentials.MAX_SCAN_BYTES == 5_000_000
    assert (credentials.MAX_PER_FILE, credentials.MAX_RAISED) == (20, 500)


def test_a_file_with_more_than_is_listed_is_named(tmp_path: Path) -> None:
    many = "".join(keys.pem(keys.ed25519_key(str(number))) for number in range(23))
    tokens = "".join(f"{keys.token(name=str(number))}\n" for number in range(25))
    found = scanned(
        tmp_path, {"many.pem": many, "tokens.txt": tokens, "one": keys.pem()}
    )
    assert [raised.path for raised in found.raised] == (
        ["many.pem"] * 20 + ["one"] + ["tokens.txt"] * 20
    )
    assert (found.unread, found.cut_short) == (
        frozenset({"many.pem", "tokens.txt"}),
        False,
    )
    assert concern(found, NOT_SCANNED)["detail"].startswith(
        "Left out, in whole or in part: 2 files with more in them than is listed "
        "for any one."
    )
    assert concern(found, NOT_SCANNED)["evidence"] == [
        {"path": "many.pem", "line": None},
        {"path": "tokens.txt", "line": None},
    ]


def test_a_file_with_more_beginnings_than_are_looked_into_is_named(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(credentials, "MAX_BEGINNINGS", 5)
    found = scanned(
        tmp_path,
        {
            "late.md": f"{BEGIN}\n...\n{END}\n" * 5 + keys.pem(),
            "in-time.md": f"{BEGIN}\n...\n{END}\n" * 4 + keys.pem(),
        },
    )
    assert told(found) == [("private-key", "in-time.md", 13, "high", "confirmed")]
    assert found.unread == frozenset({"late.md"})
    assert concern(found, NOT_SCANNED)["evidence"] == [
        {"path": "late.md", "line": None}
    ]


def test_a_file_whose_name_cannot_be_shown_is_counted(tmp_path: Path) -> None:
    found = scanned(tmp_path, {"id​.pem": keys.pem(), "bell\x07/id.pem": keys.pem()})
    assert (found.raised, found.unread, found.cut_short) == ((), frozenset(), False)
    assert concern(found, NOT_SCANNED) == {
        "title": NOT_SCANNED,
        "detail": (
            "Left out, in whole or in part: 2 files with a name that holds "
            "characters that cannot be shown. A credential in one of them is not "
            "reported, and a finding raised there before is left as it was."
        ),
        "evidence": [],
    }


def test_the_scan_stops_at_the_most_it_lists_and_says_so(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(credentials, "MAX_RAISED", 3)
    files: dict[str, str | bytes] = {
        f"keys/{number}.pem": keys.pem(keys.ed25519_key(str(number)))
        for number in range(6)
    }
    found = scanned(tmp_path, files)
    assert [raised.path for raised in found.raised] == [
        "keys/0.pem",
        "keys/1.pem",
        "keys/2.pem",
    ]
    assert found.cut_short
    assert concern(found, STOPPED) == {
        "title": STOPPED,
        "detail": (
            "It lists 3 findings and there were more. The rest of the repository "
            "was not scanned, so a credential there is not reported and no finding "
            "raised before was closed."
        ),
        "evidence": [],
    }
    # As many as it lists is not more than it lists.
    exact = scanned(tmp_path / "exact", dict(list(files.items())[:3]))
    assert (len(exact.raised), exact.cut_short, exact.concerns) == (3, False, ())


def test_a_checkout_with_more_files_than_are_listed_is_cut_short(
    tmp_path: Path,
) -> None:
    files: dict[str, str | bytes] = {
        f"{number}.pem": keys.pem(keys.ed25519_key(str(number))) for number in range(4)
    }
    found = scanned(tmp_path, files, max_files=3)
    assert len(found.raised) == 3 and found.cut_short
    assert concern(found, STOPPED)["detail"].startswith(
        "Only the first 3 files were listed. The rest of the repository was not"
    )


def test_a_key_that_takes_too_long_is_a_suspicion_and_its_file_is_named(
    tmp_path: Path,
) -> None:
    files: dict[str, str | bytes] = {
        "a/slow.pem": keys.pem(),
        "b/ci.sh": f"T={keys.token()}\n",
    }
    reader = Reader(seconds=30, each=0.3, command=ASLEEP)
    found = scanned(tmp_path, files, reader=reader)
    assert told(found) == [
        ("unread-private-key", "a/slow.pem", 1, "medium", "suspected"),
        # The scan goes on to the files after it.
        ("github-token", "b/ci.sh", 1, "high", "likely"),
    ]
    assert (
        "It was not read as a key: reading it took longer than the 5 seconds this "
        "scan gives one key." in found.raised[0].evidence
    )
    assert (found.unread, found.cut_short) == (frozenset({"a/slow.pem"}), False)
    assert concern(found, NOT_SCANNED)["detail"].startswith(
        "Left out, in whole or in part: 1 file with a key that took longer than 5 "
        "seconds to read."
    )
    assert reader.process is None


def test_the_scan_stops_when_its_time_for_keys_is_spent_and_says_so(
    tmp_path: Path,
) -> None:
    files: dict[str, str | bytes] = {
        f"{number}.pem": keys.pem(keys.ed25519_key(str(number))) for number in range(5)
    }
    found = scanned(tmp_path, files, reader=Reader(seconds=1, each=0.6, command=ASLEEP))
    assert [raised.path for raised in found.raised] == ["0.pem", "1.pem"]
    assert found.cut_short
    assert found.unread == frozenset({"0.pem", "1.pem"})
    assert concern(found, STOPPED)["detail"].startswith(
        "It gives itself 1 seconds to read keys, and they were spent. The rest of"
    )


def test_the_scan_stops_when_keys_cannot_be_read_at_all(tmp_path: Path) -> None:
    files: dict[str, str | bytes] = {
        "a.pem": keys.pem(),
        "b.sh": f"T={keys.token()}\n",
    }
    found = scanned(tmp_path, files, reader=Reader(command=("/nonexistent/python",)))
    # A key that was not looked at is not said to be anything.
    assert found.raised == () and found.cut_short
    assert concern(found, STOPPED)["detail"].startswith(
        "The process that reads keys did not start. The rest of the repository"
    )


# --- a file written to waste the scan's time


@pytest.mark.parametrize(
    "content",
    [
        pytest.param(lambda: f"{BEGIN}\n".encode() * 150_000, id="beginnings"),
        pytest.param(
            lambda: f"{BEGIN}\n...\n{END}\n".encode() * 80_000, id="placeholders"
        ),
        pytest.param(
            lambda: b"ghp_" + b"x" * 40 + b"\n" + (b"ghp_" + b"y" * 40 + b" ") * 90_000,
            id="placeholder tokens",
        ),
        pytest.param(
            lambda: b"\n".join(b"ghp_" + b"z" * 40 for _ in range(100_000)),
            id="a placeholder token on every line",
        ),
        pytest.param(lambda: b"ghp_" * 1_000_000, id="prefixes"),
        pytest.param(lambda: b"-" * 4_000_000, id="dashes"),
        pytest.param(
            lambda: f"{BEGIN}\n".encode() + b"A" * 4_000_000, id="base64 with no end"
        ),
    ],
)
def test_no_file_takes_long_to_scan(
    tmp_path: Path, content: Callable[[], bytes]
) -> None:
    data = content()
    assert 500_000 < len(data) <= credentials.MAX_SCAN_BYTES
    root = tree(tmp_path, {"hostile.txt": data})
    began = time.monotonic()
    found = scan_credentials(root)
    # A hundredth of this where it was measured. It is here for the scan that
    # takes minutes, which one that counted lines from the top each time did.
    assert time.monotonic() - began < 10
    assert found.raised == ()
