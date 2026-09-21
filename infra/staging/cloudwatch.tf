resource "aws_cloudwatch_log_group" "app" {
  name              = "/chirokpi/staging/app"
  retention_in_days = var.cloudwatch_retention_days
  kms_key_id        = aws_kms_key.staging.arn

  tags = merge(local.common_tags, { Name = "${var.name_prefix}-app-logs" })
}
