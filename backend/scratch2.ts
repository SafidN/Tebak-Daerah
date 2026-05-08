import { PrismaClient } from '@prisma/client';

console.log(new PrismaClient({ log: ['query'] }));
