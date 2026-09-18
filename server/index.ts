import { createServer } from "node:http";
import { loadConfig } from "./config";
import { createApp } from "./app";
import { createDb, createPool } from "./db";
import { logError, logInfo } from "./log/redact";
import { DrizzleStorage } from "./storage/drizzle";

async function main() {
  const config = loadConfig();

  if (!config.databaseUrl) {
    logError(
      "DATABASE_URL is required to run the server. Start Postgres with docker compose and copy .env.example to .env.",
    );
    process.exit(1);
  }

  const pool = createPool(config.databaseUrl);
  const db = createDb(pool);
  const storage = new DrizzleStorage(db, { phiEncryptionKey: config.phiEncryptionKey });

  const app = createApp({
    storage,
    session: {
      secret: config.sessionSecret,
      secure: config.cookieSecure,
      sameSite: config.cookieSameSite,
      trustProxy: config.trustProxy,
      pgPool: pool,
    },
    mfaEncryptionKey: config.mfaEncryptionKey,
    publicBaseUrl: config.publicBaseUrl,
    forceHttps: config.forceHttps,
    isProduction: config.isProduction,
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
    logInfo(`Chiro-KPI Path B listening on :${config.port}`, {
      nodeEnv: config.nodeEnv,
      trustProxy: config.trustProxy,
      forceHttps: config.forceHttps,
    });
  });
}

main().catch((err) => {
  logError("[boot] fatal", {
    error: err instanceof Error ? err.message : "unknown",
  });
  process.exit(1);
});
