# Secrets Manager structure matching docs/SECRETS.md (staging prefix).
# Placeholder strings only for app keys - Chris replaces via console/CLI before boot.
# DATABASE_URL is populated from RDS (sensitive; never echo in CI).

resource "random_password" "session_placeholder" {
  length  = 48
  special = false
}

resource "random_password" "mfa_placeholder" {
  length  = 48
  special = false
}

resource "random_password" "phi_placeholder" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "session" {
  name       = local.secret_ids.SESSION_SECRET
  kms_key_id = aws_kms_key.staging.arn
  tags       = merge(local.common_tags, { SecretKey = "SESSION_SECRET" })
}

resource "aws_secretsmanager_secret_version" "session" {
  secret_id     = aws_secretsmanager_secret.session.id
  secret_string = random_password.session_placeholder.result
}

resource "aws_secretsmanager_secret" "mfa" {
  name       = local.secret_ids.MFA_ENCRYPTION_KEY
  kms_key_id = aws_kms_key.staging.arn
  tags       = merge(local.common_tags, { SecretKey = "MFA_ENCRYPTION_KEY" })
}

resource "aws_secretsmanager_secret_version" "mfa" {
  secret_id     = aws_secretsmanager_secret.mfa.id
  secret_string = random_password.mfa_placeholder.result
}

resource "aws_secretsmanager_secret" "phi" {
  name       = local.secret_ids.PHI_ENCRYPTION_KEY
  kms_key_id = aws_kms_key.staging.arn
  tags       = merge(local.common_tags, { SecretKey = "PHI_ENCRYPTION_KEY" })
}

resource "aws_secretsmanager_secret_version" "phi" {
  secret_id     = aws_secretsmanager_secret.phi.id
  secret_string = random_password.phi_placeholder.result
}

resource "aws_secretsmanager_secret" "database_url" {
  name       = local.secret_ids.DATABASE_URL
  kms_key_id = aws_kms_key.staging.arn
  tags       = merge(local.common_tags, { SecretKey = "DATABASE_URL" })
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = local.database_url
}

# Deferred / optional - placeholders so IAM + App Runner wiring exists.
# Stripe deferred per product priority; Resend unused until mail is wired.
resource "aws_secretsmanager_secret" "optional" {
  for_each = toset([
    local.secret_ids.RESEND_API_KEY,
    local.secret_ids.STRIPE_SECRET_KEY,
    local.secret_ids.STRIPE_WEBHOOK_SECRET,
    local.secret_ids.STRIPE_PRICE_ID,
    local.secret_ids.STRIPE_PUBLISHABLE_KEY,
  ])

  name       = each.value
  kms_key_id = aws_kms_key.staging.arn
  tags       = merge(local.common_tags, { SecretKey = each.key })
}

resource "aws_secretsmanager_secret_version" "optional" {
  for_each = aws_secretsmanager_secret.optional

  secret_id = each.value.id
  # Explicit non-production placeholders - app fail-fast rejects these in NODE_ENV=production
  # until Chris replaces them. Stripe can stay unset until billing go-live.
  secret_string = "replace-with-staging-value-not-for-production"
}
