"""The database schema. Importing this module registers every table on Base."""

from forgemind_api.models.accounts import (
    GitHubInstallation,
    IntegrationCredential,
    Organization,
    OrganizationMember,
    Session,
    SignInState,
    User,
)
from forgemind_api.models.activity import AuditEvent, Notification, UsageRecord
from forgemind_api.models.base import Base
from forgemind_api.models.execution import (
    AgentRun,
    Artifact,
    ExecutionEvent,
    PullRequest,
    Run,
    Task,
    VerificationResult,
)
from forgemind_api.models.repositories import (
    Repository,
    RepositoryAnalysis,
    SecurityFinding,
)

__all__ = [
    "AgentRun",
    "Artifact",
    "AuditEvent",
    "Base",
    "ExecutionEvent",
    "GitHubInstallation",
    "IntegrationCredential",
    "Notification",
    "Organization",
    "OrganizationMember",
    "PullRequest",
    "Repository",
    "RepositoryAnalysis",
    "Run",
    "SecurityFinding",
    "Session",
    "SignInState",
    "Task",
    "UsageRecord",
    "User",
    "VerificationResult",
]
