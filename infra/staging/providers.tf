provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "chiro-kpi"
      Environment = "staging"
      Path        = "B"
      ManagedBy   = "terraform"
    }
  }
}
