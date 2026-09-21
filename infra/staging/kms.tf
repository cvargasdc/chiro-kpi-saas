data "aws_iam_policy_document" "kms" {
  statement {
    sid    = "RootAdmin"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
    actions   = ["kms:*"]
    resources = ["*"]
  }

  statement {
    sid    = "CloudWatchLogs"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["logs.${var.aws_region}.amazonaws.com"]
    }
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:CreateGrant",
      "kms:DescribeKey",
    ]
    resources = ["*"]
    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values = [
        "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:*",
      ]
    }
  }
}

resource "aws_kms_key" "staging" {
  description             = "Chiro-KPI staging encryption (RDS, Secrets Manager, S3, CloudWatch, ECR)"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.kms.json

  tags = merge(local.common_tags, { Name = "${var.name_prefix}-kms" })
}

resource "aws_kms_alias" "staging" {
  name          = "alias/${var.name_prefix}"
  target_key_id = aws_kms_key.staging.key_id
}
