/**
 * Whether an access change is allowed to go through.
 *
 * Kept apart from the route and free of any database call so the rules can be
 * read — and tested — on their own. Both exist to stop the shop being locked out
 * of its own app, which is not recoverable from inside the app: there is no
 * password-reset mail and no console, so the only fix is editing the database by
 * hand on the server.
 */

export interface AccessChange {
  /** The owner making the change. */
  actorId: number;
  target: { id: number; role: 'owner' | 'staff' };
  input: { role?: 'owner' | 'staff'; is_active?: boolean };
  /** Active owners other than the target. */
  otherActiveOwners: number;
}

/** The reason to refuse, or null to allow. */
export function accessChangeProblem(c: AccessChange): string | null {
  const losingOwner =
    (c.input.role === 'staff' && c.target.role === 'owner') || c.input.is_active === false;
  if (!losingOwner) return null;

  // Their token would still be valid for this request and dead for the next one,
  // which reads as the app breaking rather than as something they chose.
  if (c.target.id === c.actorId) {
    return 'You cannot remove your own access. Ask another owner to do it.';
  }
  // After this nobody could reach the user screen to undo it.
  //
  // Through the route this is currently unreachable — the caller is themselves an
  // active owner, so any *other* owner always has them as a survivor, and removing
  // the last owner means removing yourself, which the rule above already stops. It
  // stays because it is the rule that actually matters: the self check is about
  // one person's session, this is about the shop keeping a way back in, and a
  // later caller that is not a logged-in owner would land straight on it.
  if (c.target.role === 'owner' && c.otherActiveOwners === 0) {
    return 'This is the only owner left. Make someone else an owner first.';
  }
  return null;
}
