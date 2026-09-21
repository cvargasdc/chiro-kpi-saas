# Private VPC: public subnets (NAT + future ALB if needed) + private subnets (RDS, App Runner VPC connector ENIs).

resource "aws_vpc" "staging" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = merge(local.common_tags, { Name = "${var.name_prefix}-vpc" })
}

resource "aws_internet_gateway" "staging" {
  vpc_id = aws_vpc.staging.id
  tags   = merge(local.common_tags, { Name = "${var.name_prefix}-igw" })
}

resource "aws_subnet" "public" {
  count                   = var.az_count
  vpc_id                  = aws_vpc.staging.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-public-${local.azs[count.index]}"
    Tier = "public"
  })
}

resource "aws_subnet" "private" {
  count             = var.az_count
  vpc_id            = aws_vpc.staging.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + 8)
  availability_zone = local.azs[count.index]

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-private-${local.azs[count.index]}"
    Tier = "private"
  })
}

resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = merge(local.common_tags, { Name = "${var.name_prefix}-nat-eip" })

  depends_on = [aws_internet_gateway.staging]
}

# Single NAT for staging cost. Production may want one NAT per AZ.
resource "aws_nat_gateway" "staging" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  tags          = merge(local.common_tags, { Name = "${var.name_prefix}-nat" })

  depends_on = [aws_internet_gateway.staging]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.staging.id
  tags   = merge(local.common_tags, { Name = "${var.name_prefix}-public-rt" })
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.staging.id
}

resource "aws_route_table_association" "public" {
  count          = var.az_count
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.staging.id
  tags   = merge(local.common_tags, { Name = "${var.name_prefix}-private-rt" })
}

resource "aws_route" "private_nat" {
  route_table_id         = aws_route_table.private.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.staging.id
}

resource "aws_route_table_association" "private" {
  count          = var.az_count
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# App Runner VPC connector ENIs — egress via NAT for Secrets Manager / ECR if needed;
# RDS traffic stays private.
resource "aws_security_group" "apprunner_vpc" {
  name        = "${var.name_prefix}-apprunner-vpc"
  description = "App Runner VPC connector ENIs"
  vpc_id      = aws_vpc.staging.id

  egress {
    description = "All egress (NAT for AWS APIs; RDS via private SG rule)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${var.name_prefix}-apprunner-vpc-sg" })
}

resource "aws_security_group" "rds" {
  name        = "${var.name_prefix}-rds"
  description = "RDS Postgres — private only, from App Runner VPC connector"
  vpc_id      = aws_vpc.staging.id

  ingress {
    description     = "Postgres from App Runner VPC connector"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.apprunner_vpc.id]
  }

  egress {
    description = "No outbound needed for RDS"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${var.name_prefix}-rds-sg" })
}
