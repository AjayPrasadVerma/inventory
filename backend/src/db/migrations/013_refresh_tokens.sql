-- 013_refresh_tokens.sql — long-lived sessions for the mobile app.
--
-- The access token is a JWT and stays stateless: it is verified by signature, not
-- by a lookup. That is what makes it cheap, and also what makes it impossible to
-- take back once handed out. On the web that never mattered — the tab is open, the
-- session is short by nature. On a phone the app is expected to stay signed in for
-- months, and a token nobody can revoke is not something to hand out for months.
--
-- So the long-lived half lives here instead, one row per session, and every
-- refresh is a database read. That read is the point: it is the only moment the
-- server can refuse to extend a session it has decided to end.
--
-- What is stored is a SHA-256 of the token, never the token. Anyone reading this
-- table gets hashes they cannot present, the same reason password_hash exists.
-- SHA-256 rather than bcrypt because the token is 256 bits of randomness, not a
-- password: there is no dictionary to slow an attacker down through, and the hash
-- has to be indexed and looked up on every refresh.

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  -- Set when the token is spent by a refresh, or when the session is ended:
  -- by signing out, by the owner removing the user, or by a password change.
  revoked_at  TIMESTAMPTZ,
  -- The token issued in its place. Rotation means a refresh token is used once,
  -- so a second use of an already-spent token is not a race — it is a copy being
  -- presented, and the honest holder has one too. Which of the two is the thief
  -- cannot be known, so the whole family goes.
  replaced_by TEXT
);

-- Every refresh looks a token up by its hash; UNIQUE already indexes that.
-- These two cover the other reads: everything for one user (revoking a session,
-- removing a user) and the expiry sweep.
CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx    ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_expires_idx ON refresh_tokens (expires_at);
