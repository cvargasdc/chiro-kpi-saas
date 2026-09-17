import { defineConfig } from "drizzle-kit";

const url =
  process.env.DATABASE_URL ??
  "postgres://chirokpi:chirokpi_local@localhost:5432/chirokpi";

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url },
});
