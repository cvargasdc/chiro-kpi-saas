# App Runner instance role: runtime reads Secrets Manager + writes CloudWatch.
# Access role: pulls images from ECR.

data "aws_iam_policy_document" "apprunner_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["tasks.apprunner.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "apprunner_ecr_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["build.apprunner.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "apprunner_instance" {
  name               = "${var.name_prefix}-apprunner-instance"
  assume_role_policy = data.aws_iam_policy_document.apprunner_assume.json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "apprunner_instance" {
  statement {
    sid    = "ReadStagingSecrets"
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]
    resources = [
      aws_secretsmanager_secret.session.arn,
      aws_secretsmanager_secret.mfa.arn,
      aws_secretsmanager_secret.phi.arn,
      aws_secretsmanager_secret.database_url.arn,
      aws_secretsmanager_secret.optional[local.secret_ids.RESEND_API_KEY].arn,
      aws_secretsmanager_secret.optional[local.secret_ids.STRIPE_SECRET_KEY].arn,
      aws_secretsmanager_secret.optional[local.secret_ids.STRIPE_WEBHOOK_SECRET].arn,
      aws_secretsmanager_secret.optional[local.secret_ids.STRIPE_PRICE_ID].arn,
      aws_secretsmanager_secret.optional[local.secret_ids.STRIPE_PUBLISHABLE_KEY].arn,
    ]
  }

  statement {
    sid    = "DecryptWithStagingKms"
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:DescribeKey",
    ]
    resources = [aws_kms_key.staging.arn]
  }

  statement {
    sid    = "CloudWatchLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogStreams",
    ]
    resources = [
      aws_cloudwatch_log_group.app.arn,
      "${aws_cloudwatch_log_group.app.arn}:*",
    ]
  }
}

resource "aws_iam_role_policy" "apprunner_instance" {
  name   = "${var.name_prefix}-apprunner-instance"
  role   = aws_iam_role.apprunner_instance.id
  policy = data.aws_iam_policy_document.apprunner_instance.json
}

resource "aws_iam_role" "apprunner_ecr_access" {
  name               = "${var.name_prefix}-apprunner-ecr"
  assume_role_policy = data.aws_iam_policy_document.apprunner_ecr_assume.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "apprunner_ecr_access" {
  role       = aws_iam_role.apprunner_ecr_access.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"
}

# GitHub Actions OIDC deploy role is intentionally not created here.
# Wire aws-actions/configure-aws-credentials in .github/workflows/deploy-staging.yml
# only after an OIDC provider exists in this BAA account. GitHub must never hold
# DATABASE_URL, dumps, or PHI (see docs/BAA-VENDORS.md).
