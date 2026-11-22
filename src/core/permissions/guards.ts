import { PERMISSION_SCOPES, type PermissionScope } from "@/shared";

export interface OwnerPrincipal {
  actorId: string;
  email: string;
  scopes: ReadonlySet<PermissionScope>;
}

export class AuthorizationError extends Error {
  readonly statusCode = 403;
  readonly requiredScope: PermissionScope;

  constructor(scope: PermissionScope) {
    super(`Missing required permission scope: ${scope}`);
    this.name = "AuthorizationError";
    this.requiredScope = scope;
  }
}

export function createOwnerPrincipal(actorId: string, email: string): OwnerPrincipal {
  return {
    actorId,
    email,
    scopes: new Set<PermissionScope>(PERMISSION_SCOPES),
  };
}

export function hasScope(principal: OwnerPrincipal | null, scope: PermissionScope): boolean {
  return principal !== null && principal.scopes.has(scope);
}

export function assertScope(
  principal: OwnerPrincipal | null,
  scope: PermissionScope,
): asserts principal is OwnerPrincipal {
  if (!hasScope(principal, scope)) {
    throw new AuthorizationError(scope);
  }
}
