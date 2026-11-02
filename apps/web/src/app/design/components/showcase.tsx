'use client';

import {
  Bell,
  Check,
  CircleAlert,
  Copy,
  GitBranch,
  GitPullRequest,
  Play,
  Search,
  Settings,
  Trash2,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Badge, type BadgeTone } from '@/components/ui/badge';
import {
  Button,
  type ButtonSize,
  type ButtonVariant,
} from '@/components/ui/button';
import { Checkbox, Switch } from '@/components/ui/checkbox';
import {
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { Input, Textarea } from '@/components/ui/input';
import { Kbd, Shortcut } from '@/components/ui/kbd';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/menu';
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Select, SelectItem } from '@/components/ui/select';
import { Skeleton, SkeletonText, Spinner } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip } from '@/components/ui/tooltip';
import { toast, type ToastTone } from '@/lib/toast';

const variants: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger'];
const sizes: ButtonSize[] = ['md', 'sm'];
const previews = ['hover', 'focus', 'active'] as const;
const badgeTones: BadgeTone[] = [
  'neutral',
  'accent',
  'success',
  'warning',
  'error',
  'info',
];
const toastTones: ToastTone[] = ['info', 'success', 'warning', 'error'];

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-md font-semibold">{title}</h2>
        {description && <p className="text-fg-secondary">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="w-20 shrink-0 font-mono text-xs text-fg-secondary">
        {label}
      </span>
      {children}
    </div>
  );
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function Showcase() {
  const [confirmed, setConfirmed] = useState(0);
  const [deleted, setDeleted] = useState(0);

  return (
    <div className="flex flex-col gap-10">
      <Section title="Buttons">
        <div className="flex flex-col gap-3">
          {variants.map((variant) => (
            <Row key={variant} label={variant}>
              <Button variant={variant} data-testid={`button-${variant}`}>
                Run task
              </Button>
              {previews.map((preview) => (
                <Button
                  key={preview}
                  variant={variant}
                  data-preview={preview}
                  data-testid={`button-${variant}-${preview}`}
                >
                  {preview}
                </Button>
              ))}
              <Button variant={variant} disabled>
                Disabled
              </Button>
              <Button
                variant={variant}
                loading
                data-testid={`button-${variant}-loading`}
              >
                Running
              </Button>
              <Button variant={variant} icon={<Play />}>
                With icon
              </Button>
            </Row>
          ))}
          <Row label="sizes">
            {sizes.map((size) => (
              <Button key={size} size={size} variant="primary">
                Size {size}
              </Button>
            ))}
            {sizes.map((size) => (
              <IconButton
                key={size}
                size={size}
                label={`Copy commit hash (${size})`}
                icon={<Copy />}
              />
            ))}
          </Row>
          <Row label="link">
            <Button asChild variant="ghost">
              <a href="/design">Foundations</a>
            </Button>
          </Row>
        </div>
      </Section>

      <Section
        title="Glass toolbar"
        description="Icon buttons on a floating glass surface, with a shortcut hint."
      >
        <div className="material-toolbar inline-flex items-center gap-1 self-start px-1.5 py-1">
          <IconButton label="Run" variant="ghost" icon={<Play />} />
          <IconButton label="Branches" variant="ghost" icon={<GitBranch />} />
          <IconButton
            label="Pull requests"
            variant="ghost"
            icon={<GitPullRequest />}
          />
          <span aria-hidden="true" className="mx-1 h-4 w-px bg-line" />
          <IconButton
            label="Notifications"
            variant="ghost"
            icon={<Bell />}
            data-testid="tooltip-trigger"
          />
          <IconButton label="Settings" variant="ghost" icon={<Settings />} />
          <Shortcut keys={['Ctrl', 'K']} className="ml-1" />
        </div>
      </Section>

      <Section title="Inputs">
        <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
          <Field label="Repository" description="Owner and name.">
            <Input placeholder="forgemind/forgemind" />
          </Field>
          <Field label="Search">
            <Input icon={<Search />} placeholder="Find a file or symbol" />
          </Field>
          <Field label="Branch" error="A branch with this name already exists.">
            <Input
              defaultValue="fix/retry-budget"
              data-testid="input-invalid"
            />
          </Field>
          <Field label="Base commit">
            <Input defaultValue="49691f7" disabled />
          </Field>
          <Field label="Task" className="sm:col-span-2">
            <Textarea placeholder="Describe what ForgeMind should do." />
          </Field>
        </div>
      </Section>

      <Section title="Select">
        <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
          <Field label="Execution budget">
            <Select defaultValue="medium" data-testid="select">
              <SelectItem value="small">Small, up to 15 minutes</SelectItem>
              <SelectItem value="medium">Medium, up to 1 hour</SelectItem>
              <SelectItem value="large">Large, up to 4 hours</SelectItem>
            </Select>
          </Field>
          <Field label="Reviewer">
            <Select placeholder="Choose a reviewer">
              <SelectItem value="ayinde">Ayinde</SelectItem>
              <SelectItem value="none" disabled>
                No one available
              </SelectItem>
            </Select>
          </Field>
        </div>
      </Section>

      <Section title="Checkbox and switch">
        <div className="flex flex-col gap-3">
          <Checkbox
            label="Open a pull request when verification passes"
            description="Never merges automatically."
            defaultChecked
            data-testid="checkbox"
          />
          <Checkbox label="Allow network access in the sandbox" />
          <Checkbox label="Disabled option" disabled />
          <Switch
            label="Follow new log output"
            defaultChecked
            data-testid="switch"
          />
          <Switch label="Compact sidebar" />
          <Switch label="Disabled switch" disabled />
        </div>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap gap-2">
          {badgeTones.map((tone) => (
            <Badge key={tone} tone={tone}>
              {tone}
            </Badge>
          ))}
          <Badge tone="success" icon={<Check />}>
            Verified
          </Badge>
          <Badge tone="error" icon={<CircleAlert />}>
            Failed
          </Badge>
        </div>
      </Section>

      <Section title="Loading">
        <div className="flex flex-wrap items-start gap-8">
          <div className="flex items-center gap-3">
            <Spinner />
            <Spinner className="size-6" />
          </div>
          <div className="flex w-64 flex-col gap-3">
            <div className="flex items-center gap-3">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-4 w-32" data-testid="skeleton" />
            </div>
            <SkeletonText />
          </div>
        </div>
      </Section>

      <Section title="Shortcut hints">
        <div className="flex flex-wrap items-center gap-4">
          <Kbd>Esc</Kbd>
          <Shortcut keys={['Ctrl', 'K']} />
          <Shortcut keys={['⌘', '⇧', 'P']} />
          <Shortcut keys={['G', 'then', 'R']} />
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="diff" className="max-w-xl" data-testid="tabs">
          <TabsList>
            <TabsTrigger value="diff">Diff</TabsTrigger>
            <TabsTrigger value="checks">Checks</TabsTrigger>
            <TabsTrigger value="findings">Findings</TabsTrigger>
            <TabsTrigger value="disabled" disabled>
              Logs
            </TabsTrigger>
          </TabsList>
          <TabsContent value="diff">3 files changed, 42 additions.</TabsContent>
          <TabsContent value="checks">All 4 checks passed.</TabsContent>
          <TabsContent value="findings">No findings.</TabsContent>
        </Tabs>
      </Section>
    </div>
  );
}
