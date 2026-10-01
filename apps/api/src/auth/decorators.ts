import type { SessionRealm } from "@dsd/shared";

/**
 * Who may call a route (ADR-0004, section 2): anyone, or a valid session
 * of one realm. Every route must declare one; the boot check refuses to
 * start the API otherwise.
 */
export type Access =
  { kind: "public" } | { kind: "realm"; realm: SessionRealm };

export const ACCESS_METADATA = "dsd:access";

type AccessDecorator = ClassDecorator & MethodDecorator;

/**
 * Stores `access` on the handler itself. On a class, it is copied to every
 * method that hasn't declared its own, so the declaration always lives on
 * the handler: that is what Nest hands to Fastify, which lets the route
 * registry see each route's access next to its real URL.
 */
function declareAccess(access: Access): AccessDecorator {
  return (
    target: object,
    _key?: string | symbol,
    descriptor?: PropertyDescriptor,
  ): void => {
    if (descriptor !== undefined) {
      Reflect.defineMetadata(
        ACCESS_METADATA,
        access,
        descriptor.value as object,
      );
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
        !Reflect.hasOwnMetadata(ACCESS_METADATA, method)
      ) {
        Reflect.defineMetadata(ACCESS_METADATA, access, method);
      }
    }
  };
}

/** Anyone may call this route, signed in or not. */
export const Public = (): AccessDecorator => declareAccess({ kind: "public" });

/** Only a valid session of `realm` may call this route; anything else gets 401. */
export const Realm = (realm: SessionRealm): AccessDecorator =>
  declareAccess({ kind: "realm", realm });

export function accessOf(handler: object): Access | undefined {
  return Reflect.getMetadata(ACCESS_METADATA, handler) as Access | undefined;
}
