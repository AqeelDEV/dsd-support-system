import {
  AGENT_ROLES,
  type AgentAllowedActions,
  type AgentRole,
  permissionsFor,
  PROBLEM_TYPES,
} from "@dsd/shared";

import { ProblemException } from "../../../common/problem-details.js";

/*
 * Who may manage whom (FR-14; ADR-0004, section 4, amended). Pure
 * functions over the rows the service has locked, so every combination is
 * unit-tested and the agent app is told the outcome rather than working it
 * out (`allowedAgentActions`).
 *
 * - A manager needs `user:manage` and an active account.
 * - Supervisors manage colleagues ranked below them. Admins, the top rank,
 *   manage everyone else, other admins included: otherwise nobody could
 *   ever remove an admin.
 * - Nobody manages their own account.
 * - Roles can be given up to the manager's own rank, so only an admin can
 *   make an admin.
 * - No change may leave the system without an active admin (409).
 */

/** Ranks from ADR-0004: a higher number outranks a lower one. */
export const RANK: Readonly<Record<AgentRole, number>> = {
  agent: 1,
  supervisor: 2,
  admin: 3,
};

/** The person making the change, as their locked row says now. */
export interface Manager {
  id: string;
  role: AgentRole;
  active: boolean;
}

/** The colleague being managed, as their locked row says now. */
export interface Colleague {
  id: string;
  role: AgentRole;
  active: boolean;
  /** False until they accept their invite. */
  hasPassword: boolean;
}

const forbidden = (detail: string) =>
  new ProblemException(403, PROBLEM_TYPES.blank, detail);

const lastAdmin = () =>
  new ProblemException(
    409,
    PROBLEM_TYPES.lastAdmin,
    "This is the last active admin. Make someone else an admin first.",
  );

function mayManagePeople(manager: Manager): boolean {
  return manager.active && permissionsFor(manager.role).includes("user:manage");
}

/** Whether `manager` may change anything about `colleague`. */
export function canManage(manager: Manager, colleague: Colleague): boolean {
  if (!mayManagePeople(manager) || manager.id === colleague.id) return false;
  return manager.role === "admin" || RANK[colleague.role] < RANK[manager.role];
}

/** The roles `manager` may give anyone: up to and including their own. */
export function grantableRoles(manager: Manager): AgentRole[] {
  if (!mayManagePeople(manager)) return [];
  return AGENT_ROLES.filter((role) => RANK[role] <= RANK[manager.role]);
}

function assertCanManage(manager: Manager, colleague: Colleague): void {
  if (manager.id === colleague.id) {
    throw forbidden("You can't change your own role or account status.");
  }
  if (!canManage(manager, colleague)) {
    throw forbidden("You can only manage colleagues ranked below you.");
  }
}

function assertCanGrant(manager: Manager, role: AgentRole): void {
  if (!grantableRoles(manager).includes(role)) {
    throw forbidden("You can't give a role above your own.");
  }
}

/** Whether the colleague is an active admin, whom the last-admin rule protects. */
const isActiveAdmin = (colleague: Colleague) =>
  colleague.active && colleague.role === "admin";

/** A new agent may get any role up to the inviter's own. */
export function assertCanInvite(manager: Manager, role: AgentRole): void {
  assertCanGrant(manager, role);
}

export function assertCanEdit(manager: Manager, colleague: Colleague): void {
  assertCanManage(manager, colleague);
}

/**
 * The colleague's new role, or `unchanged`. `otherActiveAdmins` counts the
 * active admins besides the colleague, read under lock.
 */
export function decideRoleChange(
  manager: Manager,
  colleague: Colleague,
  role: AgentRole,
  otherActiveAdmins: number,
): AgentRole | "unchanged" {
  assertCanManage(manager, colleague);
  assertCanGrant(manager, role);
  if (role === colleague.role) return "unchanged";
  if (isActiveAdmin(colleague) && otherActiveAdmins === 0) throw lastAdmin();
  return role;
}

export function decideDeactivation(
  manager: Manager,
  colleague: Colleague,
  otherActiveAdmins: number,
): "deactivate" | "unchanged" {
  assertCanManage(manager, colleague);
  if (!colleague.active) return "unchanged";
  if (isActiveAdmin(colleague) && otherActiveAdmins === 0) throw lastAdmin();
  return "deactivate";
}

export function decideReactivation(
  manager: Manager,
  colleague: Colleague,
): "reactivate" | "unchanged" {
  assertCanManage(manager, colleague);
  return colleague.active ? "unchanged" : "reactivate";
}

/** An invite can be sent again while the colleague is active and hasn't set a password. */
export function assertCanResendInvite(
  manager: Manager,
  colleague: Colleague,
): void {
  assertCanManage(manager, colleague);
  if (colleague.hasPassword || !colleague.active) {
    throw new ProblemException(
      409,
      PROBLEM_TYPES.blank,
      colleague.hasPassword
        ? "They have already accepted their invite."
        : "Reactivate them before sending an invite.",
    );
  }
}

/** What the agent app may offer for this colleague; the API checks the same rules again. */
export function allowedAgentActions(
  manager: Manager,
  colleague: Colleague,
): AgentAllowedActions {
  const manageable = canManage(manager, colleague);
  return {
    edit: manageable,
    changeRole: manageable,
    deactivate: manageable && colleague.active,
    reactivate: manageable && !colleague.active,
    resendInvite: manageable && colleague.active && !colleague.hasPassword,
  };
}
