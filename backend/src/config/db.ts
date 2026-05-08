import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config(); // Pastikan .env terbaca

// Inisialisasi Prisma
export const prisma = new PrismaClient();

// Tes koneksi saat server baru nyala
prisma.$connect()
  .then(() => console.log("🐘 Prisma berhasil konek ke MySQL Laragon"))
  .catch((e) => console.error("❌ Prisma gagal konek:", e));

/**
 * Mengambil data soal berdasarkan tingkat kesulitan
 */
export async function getCities(difficulty: string) { 
  try {
    const questions = await prisma.question.findMany({
      where: {
        difficulty: difficulty
      }
    });
    return questions;
  } catch (error) {
    console.error('Error saat mengambil data soal:', error);
    throw error;
  }
}

/**
 * Fungsi untuk mengecek status Room yang Public
 */
export const getActiveRooms = async () => {
  try {
    const rooms = await prisma.room.findMany({
      where: {
        is_private: false
      }
    });
    return rooms;
  } catch (error) {
    console.error('Error saat mengambil data room:', error);
    throw error;
  }
};