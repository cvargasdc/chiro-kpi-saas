# Week 3 — Auth hardening

Path B isolation (`org_id` + `practice_id` on PHI) is unchanged. No OpenAI. No ChiroTouch parsers. Live Replit / chiro-kpi.com was not touched.

Week 4 hardening (headers, field encryption, expanded audit, backups, CI) is in [WEEK4-HARDENING.md](./WEEK4-HARDENING.md).

---

## What landed

| Area | Behavior |
|------|----------|
| Password reset | Hashed tokens in `password_reset_tokens`. Generic forgot-password response. Reset requires policy ≥12. Old sessions die via `credentialsChangedAt`. |
| Practice invites | `team_invitations` (email, org, practice, role, token hash, expiry, invitedBy). Create/list/revoke = owner\|admin. Accept creates or links memberships. |
| TOTP MFA | Real enrollment. Secret encrypted at rest (`MFA_ENCRYPTION_KEY`, AES-256-GCM). Recovery codes hashed, shown once. Login returns `mfaRequired` + challenge token until `/api/auth/mfa/verify`. |
| RBAC | readonly: GET patients only. staff/clinician: patient writes. owner\|admin: delete patients, invites. |
| Sessions | Password change/reset and MFA disable bump `credentialsChangedAt` and regenerate the current session. Production cookie flags from Week 2 unchanged. |
| Email | Stub only (`LoggingMailer` / `InMemoryMailer`). No Resend keys required. |

---

## APIs

### Password

| Method | Path | Notes |
|--------|------|--------|
| POST | `/api/auth/forgot-password` | Always `{ ok, message }`. Rate-limited per IP and email; still generic. |
| POST | `/api/auth/reset-password` | `{ token, password }`. Invalid/expired → `invalid_or_expired_token`. |
| POST | `/api/auth/change-password` | Authenticated. `{ currentPassword, newPassword }`. Regenerates session. |

Audit actions: `password_reset_requested`, `password_reset_completed`, `password_changed`. Metadata must not include email or the raw token.

### Invites

| Method | Path | Roles |
|--------|------|--------|
| POST | `/api/practices/:practiceId/invites` | owner\|admin. Body `{ email, role }` |
| GET | `/api/practices/:practiceId/invites` | owner\|admin. Pending only |
| DELETE | `/api/practices/:practiceId/invites/:inviteId` | owner\|admin |
| GET | `/api/invites/preview?token=` | Public. Practice name + role + whether the email already has an account |
| POST | `/api/invites/accept` | Public. New user: `{ token, password, username, displayName }`. Existing: `{ token, password }` |

Audit: `invite_created`, `invite_accepted`, `invite_revoked` (role in metadata, not email).

### MFA

| Method | Path | Notes |
|--------|------|--------|
| POST | `/api/auth/mfa/enroll/start` | Authenticated. Returns `{ secret, otpauthUri }`. Does **not** enable MFA. |
| POST | `/api/auth/mfa/enroll/confirm` | `{ code }`. Enables MFA, returns recovery codes **once**. |
| POST | `/api/auth/login` | If MFA enabled: `{ mfaRequired: true, challengeToken }` and no session. |
| POST | `/api/auth/mfa/verify` | `{ challengeToken, code }` — TOTP or single-use recovery code. Then full session. |
| POST | `/api/auth/mfa/disable` | `{ password, code }`. Regenerates session. |

`GET /api/me` → `user.mfa = { enabled, methods, status }` reflects real state (`enabled` / `not_enrolled` / `pending_enrollment`).

TOTP is RFC 6238 (HMAC-SHA1, 30s, 6 digits), compatible with Google Authenticator / otplib defaults. The secret is never logged.

---

## Email stub → Resend later

Week 3 does **not** send mail over the network.

- Tests inject `InMemoryMailer` and read `.outbox[].actionUrl` for the token.
- The running server uses `LoggingMailer`, which logs `template` + `to` + `subject` only (no URL/token).
- Ready-to-swap adapter: `server/mailer/resend.ts` (`ResendMailer`).

To plug in Resend (after a BAA if any mail could include ePHI — our templates must not):

1. Set `RESEND_API_KEY` and `RESEND_FROM` in the environment. Never commit them.
2. In `server/index.ts`, pass `mailer: new ResendMailer(config.resendApiKey, config.resendFrom)` into `createApp`.
3. Keep tests on `InMemoryMailer`.

Password-reset and invite messages contain a workforce email address and a link. No patient names.

---

## Environment

```
SESSION_SECRET=          # existing, required
MFA_ENCRYPTION_KEY=      # 32+ chars; openssl rand -hex 32
APP_BASE_URL=http://localhost:5000
# RESEND_API_KEY=        # unused in Week 3
# RESEND_FROM=
```

If `MFA_ENCRYPTION_KEY` is missing, the server refuses to start (same posture as `SESSION_SECRET`). Enrollment endpoints return `503 mfa_not_configured` if the key is empty at request time.

---

## How to test

```bash
cp .env.example .env   # set SESSION_SECRET and MFA_ENCRYPTION_KEY
npm test
npx tsc --noEmit
npm run build
```

`npm test` uses the in-memory store and `InMemoryMailer`. Postgres is not required.

Manual:

1. Register at `/register`.
2. Sign out → `/forgot-password`. In development, watch the server log for `[mailer] queued` (no token). Tests read the outbox; locally you can call the API and inspect `InMemoryMailer` in a test, or temporarily log `actionUrl` in a private branch (do not commit).
3. `/mfa/enroll` — add the secret to an authenticator, confirm, save recovery codes.
4. Sign out and sign in — you should land on `/mfa/verify`.
5. As owner, invite a teammate from the dashboard. Accept at `/invite/accept?token=`.
6. A readonly member can list patients and cannot add them or send invites.

---

## Session list / revoke (Week 4+)

Not implemented. Password reset, password change, and MFA disable already invalidate **all** sessions by setting `users.credentialsChangedAt` and comparing it to `session.authIssuedAt` in `authenticate`. Listing and revoking individual sessions (and a shared MFA-challenge store for multi-instance) can wait until Postgres session inspection or Redis.

---

## Isolation

Invite rows are tenant-scoped (`org_id` + `practice_id`). Patient routes still take tenant from the session/membership, not from the client body. Prior isolation tests still run.
