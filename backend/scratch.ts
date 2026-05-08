import { PrismaClient } from '@prisma/client';

console.log(PrismaClient.toString());
const p = new PrismaClient({ url: process.env.DATABASE_URL });
console.log(p);
