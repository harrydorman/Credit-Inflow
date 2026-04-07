/**
 * Minimal org / auth context bridge for dev mode.
 *
 * In production replace `getOrgId()` with a call to your auth provider
 * (Clerk, Auth0, Supabase, etc.) that returns the current organization ID.
 *
 * The `VITE_ORG_ID` environment variable lets you override the dev org ID
 * without changing code (useful for CI seeded databases or multi-tenant
 * local testing).
 */

/** Organization ID used for all API calls. */
export function getOrgId(): string {
  // In Vite, import.meta.env is the standard mechanism; fall back to a
  // stable demo string so the UI renders without any configuration.
  return (
    (typeof import.meta !== "undefined" &&
      (import.meta as { env?: Record<string, string> }).env?.VITE_ORG_ID) ||
    "demo-org"
  );
}

/**
 * React hook that returns the current organization ID.
 * This is intentionally trivial for now — replace with context or a real
 * auth hook when multi-org support is added.
 */
export function useOrgId(): string {
  return getOrgId();
}
