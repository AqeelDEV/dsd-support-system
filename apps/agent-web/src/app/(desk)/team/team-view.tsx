"use client";

import { ApiProblem, ok } from "@dsd/api-client";
import {
  type Agent,
  AGENT_ROLES,
  AGENT_STATUSES,
  type AgentRole,
  type AgentStatus,
  PROBLEM_TYPES,
} from "@dsd/shared";
import {
  AGENT_STATUS_LABELS,
  AgentStatusBadge,
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  Input,
  Panel,
  ProblemAlert,
  RelativeTime,
  ROLE_LABELS,
  Select,
  Skeleton,
  toast,
} from "@dsd/ui";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { MoreHorizontal, Plus, Users } from "lucide-react";
import { useRef, useState } from "react";

import { LoadError, PageBody, PageHeader } from "@/components/page";
import { api } from "@/lib/api";
import { useCan } from "@/lib/session";

type Dialogs =
  | { kind: "invite" }
  | { kind: "rename"; agent: Agent }
  | { kind: "role"; agent: Agent }
  | { kind: "deactivate"; agent: Agent }
  | undefined;

/**
 * Agent accounts and roles (FR-14). Every action on a colleague is offered
 * only when their `allowedActions` say so, and a new role only from their
 * `grantableRoles`: the rank rules live in the API (ADR-0004, section 4).
 */
export function TeamView() {
  const can = useCan();
  const client = useQueryClient();
  const [status, setStatus] = useState<AgentStatus | "">("");
  const [role, setRole] = useState<AgentRole | "">("");
  const [dialog, setDialog] = useState<Dialogs>();
  // Each row's actions button, so a dialog opened from its menu can hand
  // focus back to it (the menu item that opened it is gone by then).
  const actionButtons = useRef(new Map<string, HTMLButtonElement>());
  const team = useInfiniteQuery({
    queryKey: ["team", status, role],
    queryFn: ({ pageParam }) =>
      ok(
        api.GET("/api/v1/staff/agents", {
          params: {
            query: {
              limit: 100,
              ...(status === "" ? {} : { status }),
              ...(role === "" ? {} : { role }),
              ...(pageParam === undefined ? {} : { cursor: pageParam }),
            },
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const members = team.data?.pages.flatMap((page) => page.items) ?? [];

  const action = useMutation({
    mutationFn: ({
      agent,
      kind,
    }: {
      agent: Agent;
      kind: "reactivate" | "resend";
    }) => {
      const options = { params: { path: { agentId: agent.id } } };
      return kind === "reactivate"
        ? ok(api.POST("/api/v1/staff/agents/{agentId}/reactivate", options))
        : ok(api.POST("/api/v1/staff/agents/{agentId}/invite", options));
    },
    onSuccess: (_result, { agent, kind }) => {
      toast.success(
        kind === "reactivate"
          ? `${agent.displayName} can sign in again`
          : `Invite sent again to ${agent.email}`,
      );
      void client.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  return (
    <>
      <PageHeader
        title="Team"
        description="Who can sign in to Support Desk, and with which role."
        actions={
          can("user:manage") ? (
            <Button
              size="sm"
              onClick={() => {
                setDialog({ kind: "invite" });
              }}
            >
              <Plus aria-hidden="true" />
              Invite a colleague
            </Button>
          ) : undefined
        }
      />
      <PageBody className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filters">
          <label htmlFor="team-status" className="sr-only">
            Status
          </label>
          <Select
            id="team-status"
            size="sm"
            className="w-40"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as AgentStatus | "");
            }}
          >
            <option value="">Any status</option>
            {AGENT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {AGENT_STATUS_LABELS[value]}
              </option>
            ))}
          </Select>
          <label htmlFor="team-role" className="sr-only">
            Role
          </label>
          <Select
            id="team-role"
            size="sm"
            className="w-40"
            value={role}
            onChange={(event) => {
              setRole(event.target.value as AgentRole | "");
            }}
          >
            <option value="">Any role</option>
            {AGENT_ROLES.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABELS[value]}
              </option>
            ))}
          </Select>
        </div>
        <Panel className="overflow-hidden" aria-busy={team.isPending}>
          {team.isPending ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="h-10" />
              ))}
            </div>
          ) : team.isError ? (
            <LoadError
              error={team.error}
              onRetry={() => void team.refetch()}
              what="the team"
            />
          ) : members.length === 0 ? (
            <EmptyState icon={Users} title="Nobody matches these filters" />
          ) : (
            <ul className="divide-y divide-border" aria-label="Colleagues">
              {members.map((agent) => {
                const offers = agent.allowedActions;
                const anything = Object.values(offers).some(Boolean);
                return (
                  <li
                    key={agent.id}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    <Avatar name={agent.displayName} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {agent.displayName}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {agent.email}
                      </p>
                    </div>
                    <Badge className="hidden sm:inline-flex">
                      {ROLE_LABELS[agent.role]}
                    </Badge>
                    <AgentStatusBadge status={agent.status} />
                    <span className="hidden w-36 text-right text-xs text-muted-foreground md:block">
                      {agent.lastLoginAt === null ? (
                        "Never signed in"
                      ) : (
                        <>
                          Last in <RelativeTime value={agent.lastLoginAt} />
                        </>
                      )}
                    </span>
                    {anything ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Actions for ${agent.displayName}`}
                            ref={(element) => {
                              if (element === null) {
                                actionButtons.current.delete(agent.id);
                              } else {
                                actionButtons.current.set(agent.id, element);
                              }
                            }}
                          >
                            <MoreHorizontal aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {offers.edit ? (
                            <DropdownMenuItem
                              onSelect={() => {
                                setDialog({ kind: "rename", agent });
                              }}
                            >
                              Change name
                            </DropdownMenuItem>
                          ) : null}
                          {offers.changeRole ? (
                            <DropdownMenuItem
                              onSelect={() => {
                                setDialog({ kind: "role", agent });
                              }}
                            >
                              Change role
                            </DropdownMenuItem>
                          ) : null}
                          {offers.resendInvite ? (
                            <DropdownMenuItem
                              onSelect={() => {
                                action.mutate({ agent, kind: "resend" });
                              }}
                            >
                              Send the invite again
                            </DropdownMenuItem>
                          ) : null}
                          {offers.reactivate ? (
                            <DropdownMenuItem
                              onSelect={() => {
                                action.mutate({ agent, kind: "reactivate" });
                              }}
                            >
                              Reactivate
                            </DropdownMenuItem>
                          ) : null}
                          {offers.deactivate ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                destructive
                                onSelect={() => {
                                  setDialog({ kind: "deactivate", agent });
                                }}
                              >
                                Deactivate…
                              </DropdownMenuItem>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <span className="size-8" aria-hidden="true" />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </PageBody>
      {dialog === undefined ? null : (
        <TeamDialog
          dialog={dialog}
          returnFocusTo={
            dialog.kind === "invite"
              ? undefined
              : () => actionButtons.current.get(dialog.agent.id)
          }
          onClose={() => {
            setDialog(undefined);
          }}
        />
      )}
    </>
  );
}

function TeamDialog({
  dialog,
  returnFocusTo,
  onClose,
}: {
  dialog: NonNullable<Dialogs>;
  returnFocusTo: (() => HTMLElement | undefined) | undefined;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const agent = dialog.kind === "invite" ? undefined : dialog.agent;
  const [email, setEmail] = useState("");
  const [name, setName] = useState(agent?.displayName ?? "");
  const [role, setRole] = useState<AgentRole>(
    dialog.kind === "role"
      ? (dialog.agent.grantableRoles.find(
          (value) => value !== dialog.agent.role,
        ) ?? dialog.agent.role)
      : "agent",
  );

  const submit = useMutation({
    mutationFn: () => {
      switch (dialog.kind) {
        case "invite":
          return ok(
            api.POST("/api/v1/staff/agents", {
              body: { email: email.trim(), displayName: name.trim(), role },
            }),
          );
        case "rename":
          return ok(
            api.PATCH("/api/v1/staff/agents/{agentId}", {
              params: { path: { agentId: dialog.agent.id } },
              body: { displayName: name.trim() },
            }),
          );
        case "role":
          return ok(
            api.PATCH("/api/v1/staff/agents/{agentId}/role", {
              params: { path: { agentId: dialog.agent.id } },
              body: { role },
            }),
          );
        case "deactivate":
          return ok(
            api.POST("/api/v1/staff/agents/{agentId}/deactivate", {
              params: { path: { agentId: dialog.agent.id } },
            }),
          );
      }
    },
    onSuccess: () => {
      toast.success(
        dialog.kind === "invite"
          ? `Invite sent to ${email.trim()}`
          : dialog.kind === "deactivate"
            ? `${dialog.agent.displayName} is deactivated`
            : "Saved",
      );
      void client.invalidateQueries({ queryKey: ["team"] });
      void client.invalidateQueries({ queryKey: ["assignable"] });
      onClose();
    },
  });

  const problem = submit.error instanceof ApiProblem ? submit.error : undefined;
  const titles = {
    invite: "Invite a colleague",
    rename: "Change name",
    role: "Change role",
    deactivate: `Deactivate ${agent?.displayName ?? ""}?`,
  };
  const descriptions = {
    invite:
      "They'll get an email with a link to choose a password. It works once, for 72 hours.",
    rename: undefined,
    role: "The change applies at once: they're signed out everywhere and sign in again with the new role.",
    deactivate:
      "They're signed out at once and can't sign in. Their open tickets go back to the queue. You can reactivate them later.",
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        returnFocusTo={returnFocusTo}
        title={titles[dialog.kind]}
        description={descriptions[dialog.kind]}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant={dialog.kind === "deactivate" ? "destructive" : "primary"}
              pending={submit.isPending}
              onClick={() => {
                submit.mutate();
              }}
            >
              {dialog.kind === "invite"
                ? "Send invite"
                : dialog.kind === "deactivate"
                  ? "Deactivate"
                  : "Save"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {problem === undefined ? null : problem.type ===
            PROBLEM_TYPES.lastAdmin ? (
            <ProblemAlert
              problem={{
                status: problem.status,
                title: "There must always be an active admin",
                detail: "Make someone else an admin first.",
                requestId: problem.requestId,
              }}
            />
          ) : problem.type === PROBLEM_TYPES.alreadyExists ? null : problem
              .errors.length === 0 ? (
            <ProblemAlert problem={problem} />
          ) : null}
          {dialog.kind === "invite" ? (
            <Field
              label="Work email"
              error={
                problem?.type === PROBLEM_TYPES.alreadyExists
                  ? "Someone with this email already has an account."
                  : problem?.fieldError("email")
              }
            >
              {(control) => (
                <Input
                  {...control}
                  size="sm"
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                  }}
                />
              )}
            </Field>
          ) : null}
          {dialog.kind === "invite" || dialog.kind === "rename" ? (
            <Field
              label="Name"
              hint="Customers see this on replies."
              error={problem?.fieldError("displayName")}
            >
              {(control) => (
                <Input
                  {...control}
                  size="sm"
                  maxLength={100}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                />
              )}
            </Field>
          ) : null}
          {dialog.kind === "invite" || dialog.kind === "role" ? (
            <Field
              label="Role"
              hint={
                dialog.kind === "invite"
                  ? "You can invite people up to your own role."
                  : undefined
              }
              error={problem?.fieldError("role")}
            >
              {(control) => (
                <Select
                  {...control}
                  size="sm"
                  value={role}
                  onChange={(event) => {
                    setRole(event.target.value as AgentRole);
                  }}
                >
                  {(dialog.kind === "role"
                    ? dialog.agent.grantableRoles
                    : AGENT_ROLES
                  ).map((value) => (
                    <option key={value} value={value}>
                      {ROLE_LABELS[value]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
