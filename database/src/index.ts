import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/client/client.js";

export * from "../generated/client/client.js";

export function createPrismaClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}
