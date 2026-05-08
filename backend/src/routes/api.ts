import { Hono } from 'hono';
import { rooms, Room } from '../store/memoryStore';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';

dotenv.config();

const apiRoutes = new Hono();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Endpoint Create Room untuk di-hit dari index.html
apiRoutes.post('/rooms', async (c) => {
  const body = await c.req.json();
  
  const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
  
  const newRoom: Room = {
    id: roomId,
    hostId: '', // Akan diset nanti saat host join socket
    difficulty: body.difficulty || 'Medium', // Sesuai input form
    isPrivate: body.is_private === true,
    maxPlayers: parseInt(body.max_players) || 10,
    players: new Map(),
    status: 'waiting',
    currentQuestion: 1,
    currentQuestionIndex: 0,
    timer: body.difficulty === 'Easy' ? 60 : body.difficulty === 'Medium' ? 70 : 80,
    questions: [],
    hostName: body.nickname || 'Host',
    winPoints: parseInt(body.win_points) || 100
  };
  
  rooms.set(roomId, newRoom);
  
  return c.json({ success: true, room_code: roomId });
});

// Endpoint Get Lobby
apiRoutes.get('/rooms', (c) => {
  const availableRooms: any[] = [];
  rooms.forEach((room) => {
    console.log(`Room ${room.id}: status=${room.status}, isPrivate=${room.isPrivate}, players=${room.players.size}`);
    if (room.status === 'waiting' && room.isPrivate === false) {
      availableRooms.push({
        code: room.id,
        host_name: (room as any).hostName || 'Host',
        players_count: room.players.size,
        max_players: room.maxPlayers,
        win_points: (room as any).winPoints || 100,
        difficulty: room.difficulty
      });
    }
  });
  console.log(`Available rooms: ${availableRooms.length}`);
  return c.json(availableRooms);
});

// Endpoint AI Hint
apiRoutes.post('/hint/generate', async (c) => {
  try {
    const body = await c.req.json();
    const { target_city, hint_level } = body;
    
    // Validasi API Key
    if (!process.env.GEMINI_API_KEY) {
      return c.json({
        success: true,
        hint: `(API Key belum diset) Kota ini berkaitan dengan: ${target_city}`
      });
    }

    let topic = "";
    if (hint_level === 1) topic = "Julukan kota";
    else if (hint_level === 2) topic = "Makanan khas utama";
    else if (hint_level === 3) topic = "Terletak di provinsi";
    else if (hint_level === 4) topic = "Inisial kota (misalnya P_d_n_g)";
    else topic = "Fakta unik kota ini";

    const prompt = `Berikan SATU petunjuk tebakan yang ringkas untuk kota "${target_city}" di Indonesia dengan kategori: ${topic}.
Jangan sebutkan nama kotanya secara eksplisit selain dalam inisial.`;

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    return c.json({
      success: true,
      hint: responseText
    });
  } catch (error) {
    console.error("Gagal generate hint:", error);
    return c.json({
      success: false,
      hint: 'Gagal menghubungi AI.'
    }, 500);
  }
});

export default apiRoutes;
