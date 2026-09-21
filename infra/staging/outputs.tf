output "aws_region" {
  value = var.aws_region
}

output "vpc_id" {
  value = aws_vpc.staging.id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "rds_endpoint" {
  description = "Private RDS hostname (not publicly reachable)"
  value       = aws_db_instance.staging.address
}

output "rds_port" {
  value = aws_db_instance.staging.port
}

output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}

output "kms_key_arn" {
  value = aws_kms_key.staging.arn
}

output "cloudwatch_log_group" {
  value = aws_cloudwatch_log_group.app.name
}

output "secret_arns" {
  description = "Secrets Manager ARNs (names match docs/SECRETS.md staging prefix)"
  value = {
    SESSION_SECRET         = aws_secretsmanager_secret.session.arn
    MFA_ENCRYPTION_KEY     = aws_secretsmanager_secret.mfa.arn
    PHI_ENCRYPTION_KEY     = aws_secretsmanager_secret.phi.arn
    DATABASE_URL           = aws_secretsmanager_secret.database_url.arn
    RESEND_API_KEY         = aws_secretsmanager_secret.optional[local.secret_ids.RESEND_API_KEY].arn
    STRIPE_SECRET_KEY      = aws_secretsmanager_secret.optional[local.secret_ids.STRIPE_SECRET_KEY].arn
    STRIPE_WEBHOOK_SECRET  = aws_secretsmanager_secret.optional[local.secret_ids.STRIPE_WEBHOOK_SECRET].arn
    STRIPE_PRICE_ID        = aws_secretsmanager_secret.optional[local.secret_ids.STRIPE_PRICE_ID].arn
    STRIPE_PUBLISHABLE_KEY = aws_secretsmanager_secret.optional[local.secret_ids.STRIPE_PUBLISHABLE_KEY].arn
  }
}

output "apprunner_service_url" {
  description = "Set after enable_apprunner=true"
  value       = var.enable_apprunner ? aws_apprunner_service.app[0].service_url : null
}

output "apprunner_service_arn" {
  value = var.enable_apprunner ? aws_apprunner_service.app[0].arn : null
}

output "uploads_bucket" {
  value = var.create_uploads_bucket ? aws_s3_bucket.uploads[0].id : null
}

output "vpc_connector_arn" {
  value = aws_apprunner_vpc_connector.staging.arn
}
