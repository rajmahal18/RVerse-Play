import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const connectionString = getRuntimeDatabaseUrl();

if (!connectionString) {
  throw new Error("DATABASE_URL is not set.");
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaNeon({ connectionString }),
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
      parsed.hostname = parsed.hostname.replace(".neon.tech", "-pooler.neon.tech");
    }
    return parsed.toString();
  } catch {
    return url;
  }
}
