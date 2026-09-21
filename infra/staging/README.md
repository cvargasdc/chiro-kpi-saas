# Staging AWS infra (Path B) — Terraform

**Audience:** Chris Vargas  
**Scope:** Scaffold only. This directory does **not** run `terraform apply` from CI. No PHI. No Replit / chiro-kpi.com.

Aligned with:

- [docs/DEPLOY-STAGING.md](../../docs/DEPLOY-STAGING.md)
- [docs/SECRETS.md](../../docs/SECRETS.md)
- [docs/BAA-VENDORS.md](../../docs/BAA-VENDORS.md)
- [docs/BACKUPS.md](../../docs/BACKUPS.md)

## Hosting choice: App Runner (not ECS Fargate)

| | App Runner | ECS Fargate |
|---|------------|-------------|
| Fit for this app | Single Node 20 container, HTTP on `PORT`, TLS at edge | Better later for sidecars / multi-service |
| Docs / Dockerfile | Already assume App Runner / ALB TLS termination | Mentioned as alternative |
| Private RDS | VPC connector into private subnets | Task ENIs in private subnets |
| Ops surface | Smaller for staging | More (cluster, service, ALB, task def) |

This stack uses **App Runner + VPC connector**. Revisit ECS if you outgrow it.

## What gets created

1. **VPC** — public + private subnets (2 AZs), IGW, single NAT (staging cost), route tables  
2. **KMS** CMK — RDS, Secrets Manager, S3, CloudWatch Logs, ECR  
3. **RDS Postgres 16** — private subnets only, `publicly_accessible=false`, storage encrypted, `rds.force_ssl=1`, automated backups (default 7 days), deletion protection  
4. **Secrets Manager** — ids under `chirokpi/staging/…` matching `docs/SECRETS.md`  
5. **ECR** — KMS-encrypted repo for the app image  
6. **IAM** — App Runner instance role (secrets + KMS decrypt + CloudWatch) and ECR access role  
7. **CloudWatch** log group `/chirokpi/staging/app`  
8. **S3** (optional) — private, encrypted uploads stub  
9. **App Runner** — **off by default** (`enable_apprunner=false`) until an image is pushed  

GitHub Actions OIDC deploy role is **not** created here (GitHub is not a BAA vendor; keep dumps/PHI out of Actions).

## Backend / state (BAA account only)

Remote state must live in the **same AWS account that signed the HIPAA BAA**. Do not park state in a personal or non-BAA account.

Suggested one-time bootstrap (run in the BAA account, not from this repo’s CI):

```bash
# Example names — replace; enable bucket encryption + block public access
aws s3api create-bucket --bucket chirokpi-tfstate-<ACCOUNT_ID> --region us-east-1
aws dynamodb create-table --table-name chirokpi-tfstate-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

Then uncomment the `backend "s3"` block in `versions.tf` and run `terraform init -migrate-state`.

Until then, local state is fine for a first plan on an operator laptop with AWS creds for the BAA account. **Never commit `*.tfstate`.**

## Apply order (you run this — agents do not apply)

### Preconditions

- [x] AWS HIPAA BAA **Active** on the account (user-confirmed). Still not “HIPAA certified.”  
- AWS CLI credentials for that account (admin or sufficient IAM).  
- Region with the HIPAA-eligible services you need (default `us-east-1`).  
- Terraform >= 1.5  

### Step 1 — Init / plan (no App Runner yet)

```bash
cd infra/staging
cp terraform.tfvars.example terraform.tfvars   # edit region if needed
terraform init
terraform plan -out=staging.tfplan
# Review: no public RDS, secrets names look right, no unexpected destroys
terraform apply staging.tfplan
```

### Step 2 — Confirm secrets (synthetic only)

Terraform seeds:

- `SESSION_SECRET`, `MFA_ENCRYPTION_KEY`, `PHI_ENCRYPTION_KEY` — random 48-char hex-ish strings (not the placeholder words the app rejects).  
- `DATABASE_URL` — from RDS with `sslmode=require`.  
- Stripe / Resend — literal `replace-with-staging-value-not-for-production` (leave until needed; Stripe deferred).  

Optionally rotate app keys yourself:

```bash
aws secretsmanager put-secret-value \
  --secret-id chirokpi/staging/SESSION_SECRET \
  --secret-string "$(openssl rand -hex 32)"
# Repeat for MFA_ENCRYPTION_KEY and PHI_ENCRYPTION_KEY (must differ).
```

If you rotate outside Terraform, either add `lifecycle { ignore_changes = [secret_string] }` on those versions or accept that the next apply may overwrite.

### Step 3 — Build / push image

```bash
AWS_REGION=$(terraform output -raw aws_region)
ECR=$(terraform output -raw ecr_repository_url)
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "${ECR%%/*}"
docker build -t "$ECR:$(git rev-parse --short HEAD)" -f ../../Dockerfile ../..
docker push "$ECR:$(git rev-parse --short HEAD)"
```

### Step 4 — Enable App Runner

In `terraform.tfvars`:

```hcl
enable_apprunner = true
container_image  = "<ECR URL>:<tag from step 3>"
```

```bash
terraform plan -out=staging-app.tfplan
terraform apply staging-app.tfplan
terraform output apprunner_service_url
```

Set `APP_BASE_URL` on the service (console or tfvars/env map) to `https://<service_url>` after first deploy.

### Step 5 — First migrate + synthetic boot

From a jump path that can reach private RDS (VPN, SSM bastion, or temporary one-off — **you** choose; not scripted here):

```bash
# DATABASE_URL from Secrets Manager — never paste into GitHub
npm run db:push   # drizzle-kit push (schema to empty staging DB)
```

Then:

1. Hit `GET /api/health` — expect `path: "B"`, `openai: false`.  
2. Register **two practices with synthetic data only**.  
3. Confirm tenant isolation.  
4. **Do not load real clinic PHI** until encryption + backup drill are real (`docs/BACKUPS.md`).  

### Step 6 — Backup drill (before PHI)

Confirm RDS automated backups / PITR in console. Run a restore-into-separate-instance drill and record the date (keep the record, not the dump, in ops notes).

## What this does **not** do

- Does not sign or prove HIPAA compliance. BAA Active is necessary, not sufficient.  
- Does not wire live Stripe or Resend.  
- Does not deploy from GitHub until OIDC + environment protection exist.  
- Does not touch Replit or chiro-kpi.com.  

## Destroy / cost notes

NAT Gateway + RDS are the main ongoing costs. `deletion_protection` is on for RDS — disable in state/console before destroy. Prefer `terraform destroy` only on empty synthetic staging.
