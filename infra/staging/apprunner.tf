# Hosting choice: AWS App Runner (not ECS Fargate).
#
# Why App Runner (aligned with docs/DEPLOY-STAGING.md + Dockerfile):
# - Single-container Node 20 image; TLS terminates at App Runner (app speaks HTTP on PORT).
# - Less moving parts than ECS (no ALB/task-def/service discovery to maintain for staging).
# - VPC connector reaches private RDS; instance role injects Secrets Manager as env.
# - Deploy workflow stub already names App Runner first.
# Switch to ECS Fargate later if you need sidecars, multi-container, or finer networking.

resource "aws_apprunner_vpc_connector" "staging" {
  vpc_connector_name = "${var.name_prefix}-vpc"
  subnets            = aws_subnet.private[*].id
  security_groups    = [aws_security_group.apprunner_vpc.id]

  tags = merge(local.common_tags, { Name = "${var.name_prefix}-vpc-connector" })
}

resource "aws_apprunner_service" "app" {
  count = var.enable_apprunner ? 1 : 0

  service_name = var.name_prefix

  source_configuration {
    authentication_configuration {
      access_role_arn = aws_iam_role.apprunner_ecr_access.arn
    }

    image_repository {
      image_identifier      = var.container_image
      image_repository_type = "ECR"

      image_configuration {
        port = tostring(var.app_port)

        runtime_environment_variables = {
          NODE_ENV     = "production"
          PORT         = tostring(var.app_port)
          FORCE_HTTPS  = "false"
          TRUST_PROXY  = "true"
          APP_BASE_URL = "https://REPLACE_AFTER_FIRST_DEPLOY.awsapprunner.com"
        }

        # App Runner injects these as env vars from Secrets Manager (preferred path in SECRETS.md).
        runtime_environment_secrets = {
          SESSION_SECRET     = aws_secretsmanager_secret.session.arn
          MFA_ENCRYPTION_KEY = aws_secretsmanager_secret.mfa.arn
          PHI_ENCRYPTION_KEY = aws_secretsmanager_secret.phi.arn
          DATABASE_URL       = aws_secretsmanager_secret.database_url.arn
        }
      }
    }

    auto_deployments_enabled = false
  }

  instance_configuration {
    cpu               = var.app_cpu
    memory            = var.app_memory
    instance_role_arn = aws_iam_role.apprunner_instance.arn
  }

  network_configuration {
    egress_configuration {
      egress_type       = "VPC"
      vpc_connector_arn = aws_apprunner_vpc_connector.staging.arn
    }
  }

  health_check_configuration {
    protocol            = "HTTP"
    path                = "/api/health"
    interval            = 10
    timeout             = 5
    healthy_threshold   = 1
    unhealthy_threshold = 5
  }

  tags = merge(local.common_tags, { Name = var.name_prefix })

  lifecycle {
    ignore_changes = [
      source_configuration[0].image_repository[0].image_configuration[0].runtime_environment_variables["APP_BASE_URL"],
    ]
  }
}
