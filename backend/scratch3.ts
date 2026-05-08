import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
prisma.$connect()
  .then(() => console.log('Connected successfully'))
  .catch((e) => console.error('Connection failed', e))
  .finally(() => prisma.$disconnect());
