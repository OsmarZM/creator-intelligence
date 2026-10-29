import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
export function db() {
  if (!process.env.DATABASE_URL)
    throw new Error(
      "Configure DATABASE_URL no arquivo .env e execute as migrações.",
    );
  return (globalDb.prisma ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  }));
}
