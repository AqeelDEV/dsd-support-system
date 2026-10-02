"use client";

import { ApiProblem } from "@dsd/api-client";
import {
  type StaffTicket,
  TICKET_PRIORITIES,
  type TicketPriority,
  type TicketStatus,
} from "@dsd/shared";
import {
  Avatar,
  Button,
  Dialog,
  DialogContent,
  DialogTrigger,
  Field,
  Popover,
  PopoverContent,
  PopoverTrigger,
  PRIORITY_LABELS,
  ProblemAlert,
  ROLE_LABELS,
  Select,
  Spinner,
  STATUS_LABELS,
  Textarea,
  toast,
} from "@dsd/ui";
import { Flame, UserPlus } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

import { useSession } from "@/lib/session";
import { useAssignable, useTicketActions } from "@/lib/tickets";

/** Shows what a refused change means, from the API's own answer. */
function onRefused(error: Error) {
  toast.error(
    error instanceof ApiProblem && error.status === 409
      ? `${error.message} The ticket has been refreshed.`
      : error.message,
  );
}

function Row({
  label,
  children,
  htmlFor,
}: {
  label: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-center gap-2 py-1.5">
      {htmlFor === undefined ? (
        <span className="text-xs text-muted-foreground">{label}</span>
      ) : (
        <label htmlFor={htmlFor} className="text-xs text-muted-foreground">
          {label}
        </label>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * Status, priority, assignee and escalation (FR-9, FR-11, UC-6). Each
 * control appears only when the ticket's `allowedActions` say the change is
 * possible, and the status list is exactly `allowedTransitions`.
 */
export function Properties({ ticket }: { ticket: StaffTicket }) {
  const actions = useTicketActions(ticket.id);
  const statusId = useId();
  const priorityId = useId();
  const allowed = ticket.allowedActions;

  return (
    <section aria-labelledby={`${statusId}-heading`} className="px-4 py-3">
      <h2 id={`${statusId}-heading`} className="sr-only">
        Properties
      </h2>
      <Row label="Status" htmlFor={allowed.changeStatus ? statusId : undefined}>
        {allowed.changeStatus ? (
          <Select
            id={statusId}
            size="sm"
            value={ticket.status}
            disabled={actions.status.isPending}
            onChange={(event) => {
              actions.status.mutate(event.target.value as TicketStatus, {
                onSuccess: (next) => {
                  toast.success(`Status set to ${STATUS_LABELS[next.status]}`);
                },
                onError: onRefused,
              });
            }}
          >
            <option value={ticket.status}>
              {STATUS_LABELS[ticket.status]}
            </option>
            {ticket.allowedTransitions.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        ) : (
          <span className="text-sm">{STATUS_LABELS[ticket.status]}</span>
        )}
      </Row>
      <Row
        label="Priority"
        htmlFor={allowed.changePriority ? priorityId : undefined}
      >
        {allowed.changePriority ? (
          <Select
            id={priorityId}
            size="sm"
            value={ticket.priority}
            disabled={actions.priority.isPending}
            onChange={(event) => {
              actions.priority.mutate(event.target.value as TicketPriority, {
                onError: onRefused,
              });
            }}
          >
            {[...TICKET_PRIORITIES].reverse().map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABELS[priority]}
              </option>
            ))}
          </Select>
        ) : (
          <span className="text-sm">{PRIORITY_LABELS[ticket.priority]}</span>
        )}
      </Row>
      <Row label="Assignee">
        <Assignee ticket={ticket} />
      </Row>
      {ticket.escalatedAt === null && !allowed.escalate ? null : (
        <Row label="Escalation">
          {ticket.escalatedAt === null ? (
            <EscalateDialog ticket={ticket} />
          ) : (
            <span className="flex items-center gap-1.5 text-sm text-tone-danger-fg">
              <Flame aria-hidden="true" className="size-3.5" />
              Escalated
              {ticket.escalatedBy === null
                ? ""
                : ` by ${ticket.escalatedBy.displayName}`}
            </span>
          )}
        </Row>
      )}
    </section>
  );
}

function Assignee({ ticket }: { ticket: StaffTicket }) {
  const actions = useTicketActions(ticket.id);
  const session = useSession();
  const allowed = ticket.allowedActions;
  const [open, setOpen] = useState(false);
  const colleagues = useAssignable(allowed.assign);
  const pending = actions.assignment.isPending;
  const me = session.data?.agent.id;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ticket.assignee === null ? (
        <span className="text-sm text-muted-foreground">Unassigned</span>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5 text-sm">
          <Avatar name={ticket.assignee.displayName} size="sm" />
          <span className="truncate">
            {ticket.assignee.id === me ? "You" : ticket.assignee.displayName}
          </span>
        </span>
      )}
      <span className="ml-auto flex gap-1">
        {pending ? (
          <Spinner className="size-3.5 text-muted-foreground" />
        ) : null}
        {allowed.claim ? (
          <Button
            size="xs"
            variant="secondary"
            disabled={pending}
            onClick={() => {
              actions.assignment.mutate(
                { action: "claim" },
                {
                  onSuccess: () => {
                    toast.success("It's yours");
                  },
                  onError: onRefused,
                },
              );
            }}
          >
            Take it
          </Button>
        ) : null}
        {allowed.assign ? (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                size="xs"
                variant="ghost"
                disabled={pending}
                aria-label="Assign to a colleague"
              >
                <UserPlus aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64">
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                Assign to
              </p>
              <ul className="max-h-64 overflow-y-auto" aria-label="Colleagues">
                {colleagues.isPending ? (
                  <li className="flex justify-center p-3">
                    <Spinner />
                  </li>
                ) : (
                  (colleagues.data?.items ?? []).map((agent) => (
                    <li key={agent.id}>
                      <button
                        type="button"
                        disabled={agent.id === ticket.assignee?.id}
                        aria-label={`${agent.displayName}${agent.id === me ? " (you)" : ""}, ${ROLE_LABELS[agent.role]}`}
                        onClick={() => {
                          setOpen(false);
                          actions.assignment.mutate(
                            { action: "assign", agentId: agent.id },
                            {
                              onSuccess: () => {
                                toast.success(
                                  `Assigned to ${agent.displayName}`,
                                );
                              },
                              onError: onRefused,
                            },
                          );
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
                      >
                        <Avatar name={agent.displayName} size="sm" />
                        <span className="min-w-0 flex-1 truncate">
                          {agent.displayName}
                          {agent.id === me ? " (you)" : ""}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {ROLE_LABELS[agent.role]}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </PopoverContent>
          </Popover>
        ) : null}
        {allowed.unassign ? (
          <Button
            size="xs"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              actions.assignment.mutate(
                { action: "unassign" },
                { onError: onRefused },
              );
            }}
          >
            Unassign
          </Button>
        ) : null}
      </span>
    </div>
  );
}

/** Escalation (UC-6): a reason is required; a supervisor may be named. */
function EscalateDialog({ ticket }: { ticket: StaffTicket }) {
  const actions = useTicketActions(ticket.id);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [supervisorId, setSupervisorId] = useState("");
  const [error, setError] = useState<string>();
  const colleagues = useAssignable(open);
  const supervisors = (colleagues.data?.items ?? []).filter(
    (agent) => agent.role !== "agent",
  );
  const supervisorField = useId();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) actions.escalate.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="xs" variant="destructive-outline">
          <Flame aria-hidden="true" />
          Escalate
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Escalate this ticket"
        description="A supervisor will take a look. The reason is kept as an internal note, and the priority rises to at least High."
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              pending={actions.escalate.isPending}
              onClick={() => {
                const text = reason.trim();
                if (text === "") {
                  setError("Say why it needs a supervisor.");
                  return;
                }
                setError(undefined);
                actions.escalate.mutate(
                  {
                    reason: text,
                    ...(supervisorId === "" ? {} : { supervisorId }),
                  },
                  {
                    onSuccess: () => {
                      setOpen(false);
                      setReason("");
                      toast.success("Escalated");
                    },
                  },
                );
              }}
            >
              Escalate
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <ProblemAlert problem={actions.escalate.error} />
          <Field label="Reason" error={error}>
            {(control) => (
              <Textarea
                {...control}
                size="sm"
                rows={3}
                maxLength={2000}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
              />
            )}
          </Field>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={supervisorField} className="text-sm font-medium">
              Hand it to{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </label>
            <Select
              id={supervisorField}
              size="sm"
              value={supervisorId}
              onChange={(event) => {
                setSupervisorId(event.target.value);
              }}
            >
              <option value="">Any supervisor</option>
              {supervisors.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.displayName} ({ROLE_LABELS[agent.role]})
                </option>
              ))}
            </Select>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
