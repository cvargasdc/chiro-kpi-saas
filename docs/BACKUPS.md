# Backups and restore drills — Path B

**Audience:** Chris Vargas  
**As of:** Week 4 (2026-09-18)

Patient rows are ePHI. A dump of Postgres is ePHI. Keep dumps off git, off GitHub Actions, and off laptops that are not encrypted.

This is a **skeleton**, not a tested disaster-recovery program.

---

## What Week 4 provides

| Piece | Behavior |
|-------|----------|
| `npm run backup:db` | Runs `scripts/backup-db.sh` |
| `scripts/backup-db.sh` | `pg_dump` → `backups/chirokpi-<UTC timestamp>.sql` when `DATABASE_URL` is set and `pg_dump` exists. **No-ops with instructions** if the client tools are missing. |
| `scripts/restore-db.sh` | Refuses unless `CONFIRM=YES`. Overwrites the target database. |
| `backups/` | Gitignored. CI must not upload this directory. |

RDS automated snapshots (AWS, encryption at rest, BAA account) remain the **production** backup. Local `pg_dump` is for operator drills against **non-production** copies.

---

## Local dump

```bash
cp .env.example .env   # DATABASE_URL points at local docker
docker compose up -d
npm run backup:db
```

If `pg_dump` is not installed:

```bash
mkdir -p backups
docker compose exec -T postgres pg_dump -U chirokpi --no-owner --no-acl chirokpi \
  > backups/chirokpi-$(date -u +%Y%m%dT%H%M%SZ).sql
```

---

## Restore drill (staging copy, never production-by-accident)

1. Snapshot / dump the **source**.
2. Restore into a **separate** database (new RDS instance or local docker).
3. Confirm `DATABASE_URL` is the drill target. Wrong URL mixes tenants (threat T13).
4. Run:

```bash
CONFIRM=YES DATABASE_URL=postgres://… ./scripts/restore-db.sh backups/chirokpi-YYYYMMDDTHHMMSSZ.sql
```

Or:

```bash
docker compose exec -T postgres psql -U chirokpi -d chirokpi < backups/chirokpi-YYYYMMDDTHHMMSSZ.sql
```

5. Log in as Practice A and Practice B fixtures (or `npm test` against a copy of the app pointed at the restored DB). Isolation must still hold.
6. Record the drill date. HIPAA documentation retention intent is 6 years; keep the **record that the drill happened**, not the dump, in the ops log.

---

## Production (AWS) — still required

- RDS encryption at rest (KMS). App-layer field encryption is extra, not a substitute.
- Automated snapshots, retention ≥ 7 days for staging, longer for production (set when the instance exists).
- Snapshot copies stay in the BAA account. Do not share snapshots with a non-BAA account.
- Point-in-time recovery enabled.

Week 4 does **not** wire snapshot export to S3. When it does, the bucket must be private, encrypted, and blocked from public access.

---

## What not to do

- Do not commit `backups/`.
- Do not upload dumps as GitHub Actions artifacts.
- Do not restore production onto staging without a written cutover.
- Do not put patient names in the drill ticket — use org/practice IDs.
