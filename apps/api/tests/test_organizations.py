"""Members, roles, the audit trail, and one organization never seeing another."""

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session as DbSession

from forgemind_api.app import create_app
from forgemind_api.auth import token_hash
from forgemind_api.models import OrganizationMember, Session, User
from forgemind_api.seed import seed
from forgemind_api.settings import Settings

OWNER = {"cookie": "fm_session=dev-owner"}
REVIEWER = {"cookie": "fm_session=dev-reviewer"}


@pytest.fixture(scope="module")
def client(database_url: str, engine: Engine) -> Iterator[TestClient]:
    settings = Settings(environment="test", database_url=database_url)
    seed(engine, settings)
    app = create_app(settings)
    yield TestClient(app)
    app.state.engine.dispose()


def session_for(engine: Engine, email: str) -> dict[str, str]:
    """A cookie for an existing person, created straight in the database."""
    token = f"test-{uuid.uuid4().hex}"
    with DbSession(engine) as db, db.begin():
        user = db.scalars(select(User).where(User.email == email)).one()
        db.add(
            Session(
                token_hash=token_hash(token),
                user_id=user.id,
                expires_at=datetime.now(UTC) + timedelta(days=1),
            )
        )
    return {"cookie": f"fm_session={token}"}


def newcomer(engine: Engine, name: str) -> dict[str, str]:
    """A person with no organization at all, signed in."""
    email = f"{uuid.uuid4().hex[:8]}@example.com"
    with DbSession(engine) as db, db.begin():
        db.add(User(email=email, name=name))
    return session_for(engine, email)


def invite(
    client: TestClient, headers: dict[str, str], role: str = "developer"
) -> dict[str, Any]:
    response = client.post(
        "/organization/members",
        json={
            "email": f"{uuid.uuid4().hex[:8]}@example.com",
            "name": "Temp Person",
            "role": role,
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def test_members_are_listed_with_their_roles(client: TestClient) -> None:
    response = client.get("/organization/members", headers=OWNER)
    assert response.status_code == 200
    roles = {member["user"]["email"]: member["role"] for member in response.json()}
    assert roles["ayindegraphicscreation@gmail.com"] == "owner"
    assert roles["mariette@example.com"] == "admin"
    assert roles["lena@example.com"] == "reviewer"
    first = response.json()[0]
    assert set(first) == {"user", "role", "joinedAt"}
    assert set(first["user"]) == {
        "id",
        "email",
        "name",
        "avatarUrl",
        "githubLogin",
        "createdAt",
    }


def test_an_owner_invites_and_the_audit_trail_says_so(client: TestClient) -> None:
    member = invite(client, OWNER, "reviewer")
    assert member["role"] == "reviewer"
    again = client.post(
        "/organization/members",
        json={
            "email": member["user"]["email"].upper(),
            "name": "Twin",
            "role": "viewer",
        },
        headers=OWNER,
    )
    assert again.status_code == 409
    assert "already a member" in again.json()["error"]["message"]
    latest = client.get("/audit", headers=OWNER).json()["items"][0]
    assert latest["action"] == "member.invited"
    assert latest["actorName"] == "Ayinde"
    assert latest["target"] == {
        "type": "user",
        "id": member["user"]["id"],
        "label": "Temp Person",
    }


def test_only_managers_manage_and_only_owners_touch_owners(
    client: TestClient, engine: Engine
) -> None:
    admin = session_for(engine, "mariette@example.com")
    refused = client.post(
        "/organization/members",
        json={"email": "x@example.com", "name": "X", "role": "developer"},
        headers=REVIEWER,
    )
    assert refused.status_code == 403
    assert refused.json()["error"]["message"] == "This needs the owner or admin role"

    as_admin = invite(client, admin, "developer")
    assert as_admin["role"] == "developer"
    owner_by_admin = client.post(
        "/organization/members",
        json={"email": "y@example.com", "name": "Y", "role": "owner"},
        headers=admin,
    )
    assert owner_by_admin.status_code == 403
    assert owner_by_admin.json()["error"]["message"] == "Only an owner can add an owner"

    owner_id = next(
        m["user"]["id"]
        for m in client.get("/organization/members", headers=OWNER).json()
        if m["role"] == "owner"
    )
    demote_owner = client.patch(
        f"/organization/members/{owner_id}", json={"role": "admin"}, headers=admin
    )
    assert demote_owner.status_code == 403
    promote = client.patch(
        f"/organization/members/{as_admin['user']['id']}",
        json={"role": "owner"},
        headers=admin,
    )
    assert promote.status_code == 403
    remove_owner = client.delete(f"/organization/members/{owner_id}", headers=admin)
    assert remove_owner.status_code == 403


def test_the_last_owner_stays(client: TestClient) -> None:
    owner_id = next(
        m["user"]["id"]
        for m in client.get("/organization/members", headers=OWNER).json()
        if m["role"] == "owner"
    )
    demote = client.patch(
        f"/organization/members/{owner_id}", json={"role": "admin"}, headers=OWNER
    )
    assert demote.status_code == 409
    assert (
        demote.json()["error"]["message"] == "The organization needs at least one owner"
    )
    remove = client.delete(f"/organization/members/{owner_id}", headers=OWNER)
    assert remove.status_code == 409


def test_a_role_change_is_recorded(client: TestClient) -> None:
    member = invite(client, OWNER, "viewer")
    changed = client.patch(
        f"/organization/members/{member['user']['id']}",
        json={"role": "developer"},
        headers=OWNER,
    )
    assert changed.status_code == 200
    assert changed.json()["role"] == "developer"
    latest = client.get("/audit", headers=OWNER).json()["items"][0]
    assert latest["action"] == "member.role_changed"
    assert latest["target"]["label"] == "Temp Person: developer"
    nobody = client.patch(
        f"/organization/members/{uuid.uuid4()}", json={"role": "viewer"}, headers=OWNER
    )
    assert nobody.status_code == 404
    garbage = client.patch(
        "/organization/members/not-a-uuid", json={"role": "viewer"}, headers=OWNER
    )
    assert garbage.status_code == 404


def test_removing_a_member_signs_them_out_everywhere(
    client: TestClient, engine: Engine
) -> None:
    member = invite(client, OWNER, "developer")
    theirs = session_for(engine, member["user"]["email"])
    assert client.get("/auth/session", headers=theirs).status_code == 200
    removed = client.delete(
        f"/organization/members/{member['user']['id']}", headers=OWNER
    )
    assert removed.status_code == 200
    assert removed.json() == {"ok": True}
    assert client.get("/auth/session", headers=theirs).status_code == 401
    emails = [
        m["user"]["email"]
        for m in client.get("/organization/members", headers=OWNER).json()
    ]
    assert member["user"]["email"] not in emails
    latest = client.get("/audit", headers=OWNER).json()["items"][0]
    assert latest["action"] == "member.removed"


def test_the_audit_trail_pages_newest_first(client: TestClient) -> None:
    first = client.get("/audit", params={"limit": 2}, headers=OWNER).json()
    assert len(first["items"]) == 2
    assert first["nextCursor"] == "2"
    second = client.get(
        "/audit", params={"limit": 2, "cursor": "2"}, headers=OWNER
    ).json()
    assert {e["id"] for e in first["items"]}.isdisjoint(
        {e["id"] for e in second["items"]}
    )
    times = [e["at"] for e in first["items"] + second["items"]]
    assert times == sorted(times, reverse=True)
    assert (
        client.get("/audit", params={"cursor": "x"}, headers=OWNER).status_code == 400
    )


def test_a_newcomer_creates_an_organization_once(
    client: TestClient, engine: Engine
) -> None:
    riley = newcomer(engine, "Riley Chen")
    assert client.get("/organization", headers=riley).status_code == 403
    short = client.post("/organization", json={"name": " R "}, headers=riley)
    assert short.status_code == 400
    created = client.post("/organization", json={"name": "Rivera Labs"}, headers=riley)
    assert created.status_code == 201, created.text
    assert created.json()["slug"] == "rivera-labs"
    assert created.json()["plan"] == "free"
    assert client.get("/auth/session", headers=riley).json()["role"] == "owner"
    again = client.post("/organization", json={"name": "Another"}, headers=riley)
    assert again.status_code == 409
    assert again.json()["error"]["message"] == "You already belong to an organization"
    latest = client.get("/audit", headers=riley).json()["items"]
    assert [e["action"] for e in latest] == ["organization.created"]


def test_one_organization_never_sees_another(
    client: TestClient, engine: Engine
) -> None:
    riley = newcomer(engine, "Riley Chen")
    client.post("/organization", json={"name": "Rivera Labs"}, headers=riley)
    theirs = client.get("/organization/members", headers=riley).json()
    assert [m["user"]["name"] for m in theirs] == ["Riley Chen"]

    ayinde_members = client.get("/organization/members", headers=OWNER).json()
    some_member = next(m for m in ayinde_members if m["role"] != "owner")
    hidden = client.patch(
        f"/organization/members/{some_member['user']['id']}",
        json={"role": "viewer"},
        headers=riley,
    )
    assert hidden.status_code == 404
    gone = client.delete(
        f"/organization/members/{some_member['user']['id']}", headers=riley
    )
    assert gone.status_code == 404
    assert client.get("/organization/members", headers=OWNER).json() == ayinde_members

    their_audit = client.get("/audit", headers=riley).json()["items"]
    assert all(e["actorName"] == "Riley Chen" for e in their_audit)
    ours = client.get("/audit", headers=OWNER).json()["items"]
    assert all(e["actorName"] != "Riley Chen" for e in ours)
    with DbSession(engine) as db:
        riley_org = client.get("/organization", headers=riley).json()["id"]
        rows = db.scalars(
            select(OrganizationMember).where(
                OrganizationMember.organization_id == uuid.UUID(riley_org)
            )
        ).all()
        assert len(rows) == 1
