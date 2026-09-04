/**
 * What a presented refresh token is allowed to do.
 *
 * Kept apart from the route and free of any database call, like
 * accessChangeProblem next door, so the rules can be read — and tested — on their
 * own rather than through an HTTP round trip.
 *
 * The one case worth understanding is reuse. Refresh tokens rotate: spending one
 * revokes it and issues a replacement, so a token that arrives already revoked
 * has been presented twice. Rotation is what makes that detectable, and the only
 * honest reading is that a copy exists — a stolen token being replayed, or the
 * real client replaying after its replacement went missing. The server cannot
 * tell those apart and must not guess, so every session for that user ends and
 * they sign in again. Ending a session the owner still wanted is a minor
 * annoyance; leaving a stolen one alive is not.
 */

export type RefreshOutcome =
  /** Spend it and issue a replacement. */
  | { kind: 'ok' }
  /** No such token: never issued, or already swept. Nothing to revoke. */
  | { kind: 'unknown'; message: string }
  /** Genuinely past its expiry — sign in again, but no reason to suspect theft. */
  | { kind: 'expired'; message: string }
  /** Presented after it was spent or revoked: end every session this user has. */
  | { kind: 'reused'; message: string };

export interface RefreshTokenState {
  expires_at: Date | string;
  revoked_at: Date | string | null;
}

/** The same sentence for every failure. Which of them it was tells an attacker
 *  whether a guessed token ever existed, and tells the user nothing they can act
 *  on — they sign in again either way. */
const SIGN_IN_AGAIN = 'Your session has ended. Please sign in again.';

export function refreshOutcome(
  row: RefreshTokenState | null | undefined,
  now: Date = new Date(),
): RefreshOutcome {
  if (!row) return { kind: 'unknown', message: SIGN_IN_AGAIN };

  // Revoked is checked before expiry on purpose. A stolen token replayed after it
  // also happens to have expired is still a replay, and the response to a replay
  // is to end the other sessions — which are not expired.
  if (row.revoked_at !== null && row.revoked_at !== undefined) {
    return { kind: 'reused', message: SIGN_IN_AGAIN };
  }
  if (new Date(row.expires_at).getTime() <= now.getTime()) {
    return { kind: 'expired', message: SIGN_IN_AGAIN };
  }
  return { kind: 'ok' };
}
