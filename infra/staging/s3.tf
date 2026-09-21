# Minimal private encrypted stub for future uploads / snapshot export.
# Block all public access. No PHI until backup drill + app wiring exist.

resource "aws_s3_bucket" "uploads" {
  count  = var.create_uploads_bucket ? 1 : 0
  bucket = "${var.name_prefix}-uploads-${data.aws_caller_identity.current.account_id}"

  tags = merge(local.common_tags, { Name = "${var.name_prefix}-uploads" })
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  count  = var.create_uploads_bucket ? 1 : 0
  bucket = aws_s3_bucket.uploads[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  count  = var.create_uploads_bucket ? 1 : 0
  bucket = aws_s3_bucket.uploads[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.staging.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "uploads" {
  count  = var.create_uploads_bucket ? 1 : 0
  bucket = aws_s3_bucket.uploads[0].id

  versioning_configuration {
    status = "Enabled"
  }
}
