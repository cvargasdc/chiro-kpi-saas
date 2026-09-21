data "aws_caller_identity" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, var.az_count)

  # Secret ids match docs/SECRETS.md staging prefix
  secret_ids = {
    SESSION_SECRET         = "chirokpi/staging/SESSION_SECRET"
    MFA_ENCRYPTION_KEY     = "chirokpi/staging/MFA_ENCRYPTION_KEY"
    PHI_ENCRYPTION_KEY     = "chirokpi/staging/PHI_ENCRYPTION_KEY"
    DATABASE_URL           = "chirokpi/staging/DATABASE_URL"
    RESEND_API_KEY         = "chirokpi/staging/RESEND_API_KEY"
    STRIPE_SECRET_KEY      = "chirokpi/staging/STRIPE_SECRET_KEY"
    STRIPE_WEBHOOK_SECRET  = "chirokpi/staging/STRIPE_WEBHOOK_SECRET"
    STRIPE_PRICE_ID        = "chirokpi/staging/STRIPE_PRICE_ID"
    STRIPE_PUBLISHABLE_KEY = "chirokpi/staging/STRIPE_PUBLISHABLE_KEY"
  }

  common_tags = {
    Project     = "chiro-kpi"
    Environment = "staging"
    Path        = "B"
  }
}
