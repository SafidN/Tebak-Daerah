import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'mysql://root:@localhost:3306/tebak_gambar',
    },
  },
});
console.log('Created PrismaClient');
