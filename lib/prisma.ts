import { PrismaClient } from "@prisma/client";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const connectionString = getRuntimeDatabaseUrl();

if (!connectionString) {
  throw new Error("DATABASE_URL is not set.");
}

// In Node runtime, prefer fetch for simple pooled queries and keep WebSocket
// support explicit for cases that still need sessions/transactions.
neonConfig.poolQueryViaFetch = true;
if (typeof WebSocket !== "undefined") {
  neonConfig.webSocketConstructor = WebSocket;
}

const adapter = new PrismaNeon(
  { connectionString },
  {
    onPoolError: (error) => console.error("Neon pool error", error),
    onConnectionError: (error) => console.error("Neon connection error", error),
  }
);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

function getRuntimeDatabaseUrl() {
  const runtimeUrl = process.env.DATABASE_URL;
  const directUrl = process.env.DIRECT_URL;

  if (runtimeUrl?.includes("-pooler.")) {
    return runtimeUrl;
  }

  if (runtimeUrl?.includes(".neon.tech")) {
    return toNeonPoolerUrl(runtimeUrl);
  }

  if (directUrl?.includes(".neon.tech")) {
    return toNeonPoolerUrl(directUrl);
  }

  return runtimeUrl || directUrl;
}

function toNeonPoolerUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes(".neon.tech")) return url;
    if (!parsed.hostname.includes("-pooler.")) {
      const [endpoint, ...rest] = parsed.hostname.split(".");
      parsed.hostname = `${endpoint}-pooler.${rest.join(".")}`;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}
