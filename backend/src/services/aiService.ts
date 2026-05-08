import { prisma } from '../config/db';
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';

dotenv.config(); // Pastikan API Key terbaca

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

export const getSmartHint = async (questionId: number, cityName: string) => {
  try {
    // 1. Cek dulu di Database pakai Prisma
    const question = await prisma.question.findUnique({
      where: { id: questionId }
    });

    // Kalau di DB udah ada hint-nya, langsung pakai itu aja (biar hemat kuota & cepat)
    if (question && question.ai_hint) {
      console.log(`✅ Mengambil hint dari database untuk kota ${cityName}`);
      return question.ai_hint;
    }

    // 2. Kalau belum ada, baru nanya ke Google Gemini
    console.log(`🤖 Meminta hint ke AI untuk kota ${cityName}...`);
    const prompt = `Berikan satu kalimat petunjuk singkat untuk menebak kota "${cityName}". Petunjuk bisa berupa julukan kota, makanan khas, atau lokasi provinsinya. JANGAN sebutkan nama kotanya sama sekali.`;
    
    const result = await model.generateContent(prompt);
    const aiResponse = result.response.text().trim();

    // 3. Simpan jawaban AI ke Database supaya besok-besok nggak perlu nanya API lagi
    await prisma.question.update({
      where: { id: questionId },
      data: { ai_hint: aiResponse }
    });

    return aiResponse;

  } catch (error: any) {
    console.error("❌ Gagal ambil hint AI:", error.message);
    
    // Fallback kalau AI lagi error (misal: error 429 Too Many Requests)
    return "Kota ini memiliki ciri khas yang sangat terkenal di provinsinya. Ayo tebak!";
  }
};