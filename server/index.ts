import { createServer } from "node:http";
import { loadConfig } from "./config";
import { createApp } from "./app";
import { createDb, createPool } from "./db";
import { DrizzleStorage } from "./storage/drizzle";

async function main() {
  const config = loadConfig();

  if (!config.databaseUrl) {
    console.error("DATABASE_URL is required to run the server. Start Postgres with docker compose and copy .env.example to .env.");
    process.exit(1);
  }

  const pool = createPool(config.databaseUrl);
  const db = createDb(pool);
  const storage = new DrizzleStorage(db);

  const app = createApp({
    storage,
    session: {
      secret: config.sessionSecret,
      secure: config.cookieSecure,
      sameSite: config.cookieSameSite,
      trustProxy: config.isProduction,
      pgPool: pool,
    },
  });

  const httpServer = createServer(app);

  if (config.isProduction) {
    const { serveStatic } = await import("./static");
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  httpServer.listen(config.port, "0.0.0.0", () => {
    console.log(
      `Chiro-KPI Path B listening on :${config.port} (${config.nodeEnv})`,
    );
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
