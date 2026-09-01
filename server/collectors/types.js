/**
 * @typedef {{ usedPercent: number, resetAt: string | null }} LimitWindow
 * @typedef {{
 *   provider: "claude" | "codex" | "gemini",
 *   ok: boolean,
 *   error: string | null,
 *   unsupported: boolean,
 *   fiveHour: LimitWindow | null,
 *   weekly: LimitWindow | null,
 *   note: string | null,
 *   asOf: string | null,
 * }} ProviderStatus
 */

/** @returns {ProviderStatus} */
export function okStatus(provider, { fiveHour = null, weekly = null, note = null, asOf = null } = {}) {
  return { provider, ok: true, error: null, unsupported: false, fiveHour, weekly, note, asOf };
}

/** @returns {ProviderStatus} */
export function errorStatus(provider, error) {
  return {
    provider,
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    unsupported: false,
    fiveHour: null,
    weekly: null,
    note: null,
    asOf: null,
  };
}

/** @returns {ProviderStatus} */
export function unsupportedStatus(provider, reason) {
  return {
    provider,
    ok: false,
    error: reason,
    unsupported: true,
    fiveHour: null,
    weekly: null,
    note: null,
    asOf: null,
  };
}
