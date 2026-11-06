'use client';

import type { AuditEvent, Member, Role } from '@forgemind/contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import { InstallationPanel } from '@/components/repositories/installation-panel';
import { PageHeader } from '@/components/shell/page-header';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectItem } from '@/components/ui/select';
import { SkeletonText } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { ApiRequestError, request } from '@/lib/api-client';
import { formatRelative } from '@/lib/format';
import {
  canChangeRole,
  canManageMembers,
  canRemove,
  roleHelp,
  roleLabels,
  roles,
} from '@/lib/members';
import { describeAction } from '@/lib/overview';
import {
  useAudit,
  useOrganization,
  useRepositories,
  useSession,
} from '@/lib/queries';
import { toast } from '@/lib/toast';

/*
 * Settings: the organisation, who is in it and with which role, the GitHub
 * connection and the repositories it reaches, appearance, and the audit
 * log. Controls appear only to roles the API would accept, and anything
 * that takes access away asks first.
 */

const failed = (error: unknown) =>
  toast({
    title: 'That did not go through',
    description:
      error instanceof ApiRequestError
        ? error.message
        : 'The API did not answer.',
    tone: 'error',
  });

export function SettingsPage() {
  const session = useSession();
  const role = session.data?.role ?? null;

  return (
    <div
      className="flex flex-col gap-6"
      data-testid="settings"
      data-role={role ?? ''}
    >
      <PageHeader
        title="Settings"
        description="Organization, members and roles, GitHub connection, appearance and the audit log."
      />
      <OrganizationPanel />
      <MembersPanel actor={role} selfId={session.data?.user.id ?? null} />
      <Panel id="github" title="GitHub connection" testId="github-settings">
        <div className="flex flex-col gap-3 p-4">
          <InstallationPanel
            canInstall={
              role === 'owner' || role === 'admin' || role === 'developer'
            }
          />
          <RepositoryAccess actor={role} />
        </div>
      </Panel>
      <Panel id="appearance" title="Appearance" testId="appearance">
        <div className="flex flex-wrap items-center gap-4 px-4 py-4 text-sm">
          <span className="text-fg-secondary">Theme</span>
          <ThemeSwitcher />
        </div>
      </Panel>
      <AuditPanel />
    </div>
  );
}

function OrganizationPanel() {
  const organization = useOrganization();
  return (
    <Panel
      id="organization"
      title="Organization"
      testId="organization-settings"
    >
      {organization.isPending ? (
        <Loading />
      ) : organization.error || !organization.data ? (
        <p className="px-4 py-3 text-sm text-error-fg">
          Could not load the organization.
        </p>
      ) : (
        <dl className="grid gap-x-6 gap-y-2 px-4 py-4 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
          <dt className="text-fg-secondary">Name</dt>
          <dd className="font-medium">{organization.data.name}</dd>
          <dt className="text-fg-secondary">Slug</dt>
          <dd className="font-mono">{organization.data.slug}</dd>
          <dt className="text-fg-secondary">Plan</dt>
          <dd>
            <Badge tone="accent">{organization.data.plan}</Badge>
          </dd>
          <dt className="text-fg-secondary">Created</dt>
          <dd>{formatRelative(organization.data.createdAt)}</dd>
        </dl>
      )}
    </Panel>
  );
}

function MembersPanel({
  actor,
  selfId,
}: {
  actor: Role | null;
  selfId: string | null;
}) {
  const client = useQueryClient();
  const members = useQuery({
    queryKey: ['members'],
    queryFn: ({ signal }) => request('members', { signal }),
  });
  const [inviting, setInviting] = useState(false);
  const [invite, setInvite] = useState<{
    email: string;
    name: string;
    role: Role;
  }>({
    email: '',
    name: '',
    role: 'viewer',
  });
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ['members'] }),
      client.invalidateQueries({ queryKey: ['audit'] }),
    ]);

  const send = useMutation({
    mutationFn: () => request('inviteMember', { body: invite }),
    onSuccess: async (member) => {
      toast({
        title: `${member.user.name} added as ${roleLabels[member.role].toLowerCase()}`,
        tone: 'success',
      });
      setInviting(false);
      setInvite({ email: '', name: '', role: 'viewer' });
      await refresh();
    },
    onError: failed,
  });
  const change = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      request('updateMemberRole', { params: { id }, body: { role } }),
    onSuccess: async (member) => {
      toast({
        title: `${member.user.name} is now ${roleLabels[member.role].toLowerCase()}`,
        tone: 'info',
      });
      await refresh();
    },
    onError: failed,
  });
  const remove = useMutation({
    mutationFn: (id: string) => request('removeMember', { params: { id } }),
    onSuccess: async () => {
      toast({ title: 'Access revoked', tone: 'info' });
      await refresh();
    },
    onError: failed,
  });

  const list = members.data ?? [];
  const owners = list.filter((member) => member.role === 'owner').length;
  const manages = canManageMembers(actor);

  return (
    <Panel
      id="members"
      title={`Members (${list.length})`}
      testId="members"
      aside={
        manages && (
          <Dialog open={inviting} onOpenChange={setInviting}>
            <Button
              size="sm"
              variant="primary"
              icon={<Plus />}
              onClick={() => setInviting(true)}
              data-testid="invite-member"
            >
              Invite
            </Button>
            <DialogContent
              title="Invite a member"
              description="They join right away with the role you choose."
            >
              <form
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  send.mutate();
                }}
              >
                <Field label="Name">
                  <Input
                    data-testid="invite-name"
                    value={invite.name}
                    onChange={(event) =>
                      setInvite({ ...invite, name: event.target.value })
                    }
                    required
                  />
                </Field>
                <Field label="Email">
                  <Input
                    type="email"
                    data-testid="invite-email"
                    value={invite.email}
                    onChange={(event) =>
                      setInvite({ ...invite, email: event.target.value })
                    }
                    required
                  />
                </Field>
                <Field label="Role" description={roleHelp[invite.role]}>
                  <Select
                    aria-label="Role"
                    value={invite.role}
                    onValueChange={(value) =>
                      setInvite({ ...invite, role: value as Role })
                    }
                    data-testid="invite-role"
                  >
                    {roles
                      .filter(
                        (option) => option !== 'owner' || actor === 'owner',
                      )
                      .map((option) => (
                        <SelectItem key={option} value={option}>
                          {roleLabels[option]}
                        </SelectItem>
                      ))}
                  </Select>
                </Field>
                <div className="flex justify-end gap-2">
                  <DialogClose asChild>
                    <Button variant="ghost" size="sm" type="button">
                      Cancel
                    </Button>
                  </DialogClose>
                  <Button
                    variant="primary"
                    size="sm"
                    type="submit"
                    loading={send.isPending}
                    data-testid="send-invite"
                  >
                    Add member
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )
      }
    >
      {members.isPending ? (
        <Loading />
      ) : members.error ? (
        <ErrorState
          title="Could not load members"
          onRetry={async () => {
            await members.refetch();
          }}
        />
      ) : (
        <ul className="divide-y divide-line">
          {list.map((member) => (
            <MemberRow
              key={member.user.id}
              member={member}
              self={member.user.id === selfId}
              canChange={(to) => canChangeRole(actor, member.role, to, owners)}
              canRemove={
                canRemove(actor, member.role, owners) &&
                member.user.id !== selfId
              }
              onChange={(to) => change.mutate({ id: member.user.id, role: to })}
              onRemove={() =>
                remove.mutateAsync(member.user.id).then(() => undefined)
              }
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function MemberRow({
  member,
  self,
  canChange,
  canRemove: removable,
  onChange,
  onRemove,
}: {
  member: Member;
  self: boolean;
  canChange: (to: Role) => boolean;
  canRemove: boolean;
  onChange: (to: Role) => void;
  onRemove: () => Promise<void>;
}) {
  const changeable = roles.filter((to) => to !== member.role && canChange(to));
  return (
    <li
      data-testid={`member-${member.user.id}`}
      data-role={member.role}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm"
    >
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-hover text-xs font-medium"
        aria-hidden="true"
      >
        {member.user.name
          .split(' ')
          .map((part) => part[0])
          .join('')
          .slice(0, 2)
          .toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-medium">{member.user.name}</span>
        {self && <Badge className="ml-2">you</Badge>}
        <span className="block truncate text-xs text-fg-secondary">
          {member.user.email}
          {member.user.githubLogin && ` · ${member.user.githubLogin}`}
        </span>
      </span>
      {changeable.length > 0 ? (
        <div className="w-40">
          <Select
            aria-label={`Role of ${member.user.name}`}
            value={member.role}
            onValueChange={(value) => onChange(value as Role)}
            data-testid={`role-${member.user.id}`}
          >
            {[member.role, ...changeable].map((option) => (
              <SelectItem key={option} value={option}>
                {roleLabels[option]}
              </SelectItem>
            ))}
          </Select>
        </div>
      ) : (
        <Badge
          tone={member.role === 'owner' ? 'accent' : 'neutral'}
          data-testid={`role-${member.user.id}`}
        >
          {roleLabels[member.role]}
        </Badge>
      )}
      <span className="text-xs text-fg-muted">
        joined {formatRelative(member.joinedAt)}
      </span>
      {removable && (
        <ConfirmDialog
          trigger={
            <Button
              size="sm"
              variant="danger"
              data-testid={`remove-${member.user.id}`}
            >
              Revoke access
            </Button>
          }
          destructive
          title={`Revoke ${member.user.name}'s access?`}
          description="They are signed out everywhere at once and lose every permission. Their past actions stay in the audit log."
          confirmLabel="Revoke access"
          onConfirm={onRemove}
        />
      )}
    </li>
  );
}

function RepositoryAccess({ actor }: { actor: Role | null }) {
  const client = useQueryClient();
  const repositories = useRepositories();
  const disconnect = useMutation({
    mutationFn: (id: string) =>
      request('disconnectRepository', { params: { id } }),
    onSuccess: async () => {
      toast({ title: 'Repository access revoked', tone: 'info' });
      await Promise.all([
        client.invalidateQueries({ queryKey: ['repositories'] }),
        client.invalidateQueries({ queryKey: ['audit'] }),
      ]);
    },
    onError: failed,
  });
  const connected = (repositories.data?.items ?? []).filter(
    ({ status }) => status !== 'revoked',
  );
  const manages =
    actor === 'owner' || actor === 'admin' || actor === 'developer';

  return (
    <div data-testid="repository-access">
      <p className="mb-2 text-sm text-fg-secondary">
        ForgeMind reads {connected.length}{' '}
        {connected.length === 1 ? 'repository' : 'repositories'}.{' '}
        <Link
          href="/repositories"
          className="underline-offset-2 hover:underline"
        >
          Manage them
        </Link>
        .
      </p>
      <ul className="divide-y divide-line rounded-md border border-line">
        {connected.map((repo) => (
          <li
            key={repo.id}
            className="flex items-center gap-3 px-3 py-2 text-sm"
          >
            <span className="min-w-0 flex-1 truncate font-mono">
              {repo.fullName}
            </span>
            {manages && (
              <ConfirmDialog
                trigger={
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid={`revoke-${repo.id}`}
                  >
                    Revoke access
                  </Button>
                }
                destructive
                title={`Stop reading ${repo.fullName}?`}
                description="ForgeMind drops its analysis and stops reading the repository. Tasks and reports stay."
                confirmLabel="Revoke access"
                onConfirm={() =>
                  disconnect.mutateAsync(repo.id).then(() => undefined)
                }
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AuditPanel() {
  const audit = useAudit(50);
  const target = (event: AuditEvent) =>
    event.target.type === 'repository'
      ? `/repositories/${event.target.id}`
      : event.target.type === 'task'
        ? `/tasks/${event.target.id}`
        : null;
  return (
    <Panel id="audit" title="Audit log" testId="audit-log">
      {audit.isPending ? (
        <Loading />
      ) : audit.error ? (
        <p className="px-4 py-3 text-sm text-error-fg">
          Could not load the audit log.
        </p>
      ) : (
        <ol className="divide-y divide-line">
          {audit.data.items.map((event) => {
            const href = target(event);
            return (
              <li
                key={event.id}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 py-2 text-sm"
                data-testid="audit-entry"
              >
                <span className="font-medium">{event.actorName}</span>
                <span className="text-fg-secondary">
                  {describeAction(event)}
                </span>
                {href ? (
                  <Link
                    href={href}
                    className="font-mono text-xs hover:underline"
                  >
                    {event.target.label}
                  </Link>
                ) : (
                  <span className="font-mono text-xs">
                    {event.target.label}
                  </span>
                )}
                <time
                  dateTime={event.at}
                  className="ml-auto text-xs text-fg-muted"
                >
                  {formatRelative(event.at)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

function Panel({
  id,
  title,
  testId,
  aside,
  children,
}: {
  id: string;
  title: string;
  testId: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid={testId}
      className="material-solid"
    >
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <h2 id={`${id}-title`} className="text-sm font-semibold">
          {title}
        </h2>
        <div className="ml-auto">{aside}</div>
      </div>
      {children}
    </section>
  );
}

const Loading = () => (
  <div className="p-4" aria-busy="true">
    <SkeletonText lines={3} />
  </div>
);
