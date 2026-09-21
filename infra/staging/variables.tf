variable "aws_region" {
  description = "AWS region for staging (HIPAA-eligible services). Prefer a region you already use for Artifact/BAA."
  type        = string
  default     = "us-east-1"
}

variable "name_prefix" {
  description = "Resource name prefix"
  type        = string
  default     = "chirokpi-staging"
}

variable "vpc_cidr" {
  description = "CIDR for the staging VPC"
  type        = string
  default     = "10.40.0.0/16"
}

variable "az_count" {
  description = "Number of AZs (min 2 for RDS subnet group)"
  type        = number
  default     = 2
}

variable "db_instance_class" {
  description = "RDS instance class (staging-sized)"
  type        = string
  default     = "db.t4g.micro"
}

variable "db_name" {
  description = "Initial Postgres database name"
  type        = string
  default     = "chirokpi"
}

variable "db_username" {
  description = "RDS master username (password is generated and stored in Secrets Manager)"
  type        = string
  default     = "chirokpi_admin"
}

variable "db_allocated_storage" {
  description = "RDS allocated storage (GB)"
  type        = number
  default     = 20
}

variable "db_backup_retention_days" {
  description = "Automated backup retention (days). Staging floor is 7."
  type        = number
  default     = 7
}

variable "app_port" {
  description = "Container listen port (matches Dockerfile PORT)"
  type        = number
  default     = 5000
}

variable "container_image" {
  description = "ECR image URI:tag for App Runner. Leave empty until first push; set enable_apprunner=true after."
  type        = string
  default     = ""
}

variable "enable_apprunner" {
  description = "Create the App Runner service. Set true after an image exists in ECR."
  type        = bool
  default     = false
}

variable "app_cpu" {
  description = "App Runner CPU units"
  type        = string
  default     = "1024"
}

variable "app_memory" {
  description = "App Runner memory (MB)"
  type        = string
  default     = "2048"
}

variable "cloudwatch_retention_days" {
  description = "Log retention. Staging can be shorter; bump for production."
  type        = number
  default     = 30
}

variable "create_uploads_bucket" {
  description = "Create a private encrypted S3 stub for future uploads (no public access)."
  type        = bool
  default     = true
}
