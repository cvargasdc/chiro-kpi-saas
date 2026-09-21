resource "random_password" "db" {
  length  = 32
  special = false # URL-safe for DATABASE_URL construction
}

resource "aws_db_subnet_group" "staging" {
  name       = "${var.name_prefix}-db"
  subnet_ids = aws_subnet.private[*].id

  tags = merge(local.common_tags, { Name = "${var.name_prefix}-db-subnets" })
}

resource "aws_db_parameter_group" "postgres" {
  name   = "${var.name_prefix}-pg16"
  family = "postgres16"

  # Require TLS clients (encryption in transit)
  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }

  tags = merge(local.common_tags, { Name = "${var.name_prefix}-pg-params" })
}

resource "aws_db_instance" "staging" {
  identifier = "${var.name_prefix}-pg"

  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_allocated_storage * 2
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.staging.arn

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.staging.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = false # staging cost; enable for production
  parameter_group_name   = aws_db_parameter_group.postgres.name

  backup_retention_period   = var.db_backup_retention_days
  backup_window             = "07:00-08:00"
  maintenance_window        = "sun:08:00-sun:09:00"
  copy_tags_to_snapshot     = true
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name_prefix}-final"

  # PITR is implied by backup_retention > 0 on RDS
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  tags = merge(local.common_tags, { Name = "${var.name_prefix}-pg" })
}

# Constructed DATABASE_URL for Secrets Manager (sslmode=require).
# App should append or already expect SSL; RDS parameter forces SSL.
locals {
  database_url = format(
    "postgres://%s:%s@%s:%s/%s?sslmode=require",
    var.db_username,
    random_password.db.result,
    aws_db_instance.staging.address,
    aws_db_instance.staging.port,
    var.db_name
  )
}
