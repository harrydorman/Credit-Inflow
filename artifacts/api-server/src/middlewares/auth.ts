/**
 * middlewares/auth.ts
 *
 * Phase 4: Auth/session foundation.
 *
 * Design goals:
 * - Clean abstraction layer that works standalone in dev
 * - Easy to replace with Clerk, Auth0, NextAuth, Supabase Auth, etc.
 * - Current-user + current-organization context injected into every request
 *
 * Dev/mock mode (NODE_ENV !== "production"):
 *   Read org from `X-Organization-Id` header (or `MOCK_ORG_ID` env var).
 *   Read user from `X-User-Id` header (or `MOCK_USER_ID` env var).
 *   If neither is provided, injects null context (unauthenticated).
 *
 * Production integration:
 *   Replace the body of `resolveAuthContext()` with real token verification.
 *   The rest of the codebase only reads `req.orgId` / `req.userId`, so
 *   swapping the resolver is a one-file change.
 */
import type { Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// Augment Express Request with auth context
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Resolved organization ID for the current request, or null. */
      orgId: string | null;
      /** Resolved user ID for the current request, or null. */
      userId: string | null;
    }
  }
}

// ---------------------------------------------------------------------------
// Auth context resolver (injectable for testing / future providers)
// ---------------------------------------------------------------------------

export interface AuthContext {
  orgId: string | null;
  userId: string | null;
}

export type AuthContextResolver = (req: Request) => Promise<AuthContext> | AuthContext;

/**
 * Default dev/mock resolver.
 * Reads org + user IDs from request headers (primary) or env vars (fallback).
 */
export const mockAuthResolver: AuthContextResolver = (req: Request): AuthContext => {
  const orgId =
    (req.headers["x-organization-id"] as string | undefined) ??
    process.env.MOCK_ORG_ID ??
    null;

  const userId =
    (req.headers["x-user-id"] as string | undefined) ??
    process.env.MOCK_USER_ID ??
    null;

  return { orgId, userId };
};

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Creates an Express middleware that resolves and attaches auth context.
 * Call once in app.ts:  `app.use(createAuthMiddleware())`
 *
 * @param resolver - optional custom resolver (e.g. real Clerk JWT verifier)
 */
export function createAuthMiddleware(
  resolver: AuthContextResolver = mockAuthResolver,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const ctx = resolver(req);

    if (ctx instanceof Promise) {
      ctx
        .then((resolved) => {
          req.orgId = resolved.orgId;
          req.userId = resolved.userId;
          next();
        })
        .catch(next);
    } else {
      req.orgId = ctx.orgId;
      req.userId = ctx.userId;
      next();
    }
  };
}

// ---------------------------------------------------------------------------
// Guard helpers — use in route handlers that require an org context
// ---------------------------------------------------------------------------

/**
 * Returns the org ID from the request or throws a 401/400 response.
 * Usage:
 *   const orgId = requireOrgId(req, res);
 *   if (!orgId) return;   // response already sent
 */
export function requireOrgId(req: Request, res: Response): string | null {
  if (!req.orgId) {
    res.status(401).json({ error: "Organization context is required. Provide X-Organization-Id header." });
    return null;
  }
  return req.orgId;
}
