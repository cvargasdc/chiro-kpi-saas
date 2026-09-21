terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state must live in the same AWS account that signed the HIPAA BAA.
  # Uncomment and fill after creating the state bucket + DynamoDB lock table
  # in that account (see README.md). Do not use a personal or non-BAA account.
  #
  # backend "s3" {
  #   bucket         = "chirokpi-tfstate-REPLACE_ACCOUNT"
  #   key            = "staging/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "chirokpi-tfstate-lock"
  #   encrypt        = true
  # }
}
