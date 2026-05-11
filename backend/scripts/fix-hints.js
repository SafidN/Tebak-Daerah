const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config();

const prisma = new PrismaClient();

const normalizeCityName = (cityName) => (cityName || '').toString().trim();

const getCityInitial = (cityName) => {
  const normalized = normalizeCityName(cityName);
  return normalized.charAt(0).toUpperCase() || '-';
};

const safeParseAiHint = (rawAiHint) => {
  if (!rawAiHint || typeof rawAiHint !== 'string') {
    return {
      hint_1: '',
      hint_2: '',
      hint_3: ''
    };
  }

  try {
    const parsed = JSON.parse(rawAiHint);
    return {
      hint_1: typeof parsed?.hint_1 === 'string' ? parsed.hint_1 : '',
      hint_2: typeof parsed?.hint_2 === 'string' ? parsed.hint_2 : '',
      hint_3: typeof parsed?.hint_3 === 'string' ? parsed.hint_3 : ''
    };
  } catch {
    return {
      hint_1: '',
      hint_2: '',
      hint_3: ''
    };
  }
};

const isTasikmalaya = (cityName) => normalizeCityName(cityName).toLowerCase() === 'tasikmalaya';

async function main() {
  await prisma.$connect();

  const questions = await prisma.question.findMany({
    select: {
      id: true,
      city_name: true,
      ai_hint: true
    }
  });

  let updatedCount = 0;

  for (const question of questions) {
    const cityName = normalizeCityName(question.city_name);
    const currentHints = safeParseAiHint(question.ai_hint);

    if (!cityName || (!currentHints.hint_1 && !currentHints.hint_2 && !currentHints.hint_3)) {
      continue;
    }

    const nextHints = {
      hint_1: currentHints.hint_1,
      hint_2: currentHints.hint_2,
      hint_3: getCityInitial(cityName)
    };

    if (isTasikmalaya(cityName)) {
      nextHints.hint_1 = 'Nasi TO';
      nextHints.hint_3 = 'T';
    }

    const serializedHints = JSON.stringify(nextHints);

    if (serializedHints !== question.ai_hint) {
      await prisma.question.update({
        where: { id: question.id },
        data: {
          ai_hint: serializedHints
        }
      });
      updatedCount++;
      console.log(`Updated ${cityName} (ID: ${question.id})`);
    }
  }

  console.log(`Selesai. Total data diperbarui: ${updatedCount}`);
}

main()
  .catch((error) => {
    console.error('Gagal menjalankan patch hint:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
