import { PrismaClient } from "@prisma/client";

/**
 * After `npx prisma generate`, restart the dev server (or let the process reload) so this
 * client matches `schema.prisma`. A stale singleton causes runtime errors like unknown `receiveMode`.
 */

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient;
}

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient();

export default prisma;
