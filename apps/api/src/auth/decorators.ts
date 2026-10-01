import type { Permission, SessionRealm } from "@dsd/shared";

/**
 * Who may call a route (ADR-0004, section 2): anyone, or a valid session
 * of one realm. Every route must declare one; the boot check refuses to
 * start the API otherwise.
 */
export type Access =
  { kind: "public" } | { kind: "realm"; realm: SessionRealm };

const ACCESS_METADATA = "dsd:access";
const PERMISSIONS_METADATA = "dsd:permissions";

type HandlerDecorator = ClassDecorator & MethodDecorator;

/**
 * Stores `value` under `key` on the handler itself. On a class, it is
 * copied to every method that hasn't declared its own, so the declaration
 * always lives on the handler: that is what Nest hands to Fastify, which
 * lets the route registry see each route's rules next to its real URL.
 */
function onHandlers(key: string, value: unknown): HandlerDecorator {
  return (
    target: object,
    _property?: string | symbol,
    descriptor?: PropertyDescriptor,
  ): void => {
    if (descriptor !== undefined) {
      Reflect.defineMetadata(key, value, descriptor.value as object);
      return;
    }
    // Method decorators run before class decorators, so a method's own
    // declaration is already in place and wins.
    const prototype = (target as { prototype: Record<string, unknown> })
      .prototype;
    for (const name of Object.getOwnPropertyNames(prototype)) {
      const method = prototype[name];
      if (
        name !== "constructor" &&
        typeof method === "function" &&
        !Reflect.hasOwnMetadata(key, method)
      ) {
        Reflect.defineMetadata(key, value, method);
      }
    }
  };
}

/** Anyone may call this route, signed in or not. */
export const Public = (): HandlerDecorator =>
  onHandlers(ACCESS_METADATA, { kind: "public" } satisfies Access);

/** Only a valid session of `realm` may call this route; anything else gets 401. */
export const Realm = (realm: SessionRealm): HandlerDecorator =>
  onHandlers(ACCESS_METADATA, { kind: "realm", realm } satisfies Access);

/**
 * The staff permissions this route needs, all of them (ADR-0004). Code
 * checks permissions, never role names. Every route under /api/v1/staff/
 * must declare at least one.
 */
export const RequirePermissions = (
  ...permissions: [Permission, ...Permission[]]
): HandlerDecorator => onHandlers(PERMISSIONS_METADATA, permissions);

export function accessOf(handler: object): Access | undefined {
  return Reflect.getMetadata(ACCESS_METADATA, handler) as Access | undefined;
}

export function permissionsOf(handler: object): readonly Permission[] {
  return (
    (Reflect.getMetadata(PERMISSIONS_METADATA, handler) as
      Permission[] | undefined) ?? []
  );
}
