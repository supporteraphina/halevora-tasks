import { PrismaClient } from "@prisma/client";

// Single PrismaClient across hot reloads in dev. Models arrive in Section 1.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
