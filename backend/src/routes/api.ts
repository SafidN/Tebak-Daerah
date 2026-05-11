import { Hono } from 'hono';
import { rooms, Room } from '../store/memoryStore';
import { generateHintsForCity, persistQuestionAiHints } from '../services/aiService';
import * as dotenv from 'dotenv';

dotenv.config();

const apiRoutes = new Hono();

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
  const emptyRoomIds: string[] = [];

  rooms.forEach((room) => {
    console.log(`Room ${room.id}: status=${room.status}, isPrivate=${room.isPrivate}, players=${room.players.size}`);
    if (room.players.size === 0) {
      emptyRoomIds.push(room.id);
      return;
    }

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

  emptyRoomIds.forEach((roomId) => rooms.delete(roomId));

  console.log(`Available rooms: ${availableRooms.length}`);
  return c.json(availableRooms);
});

// Endpoint AI Hint
apiRoutes.post('/hint/generate', async (c) => {
  try {
    const body = await c.req.json();
    const { target_city, hint_level, question_id, questionId } = body;

    const level = Math.min(Math.max(Number(hint_level) || 1, 1), 3) as 1 | 2 | 3;
    const hints = await generateHintsForCity(String(target_city || ''));
    const resolvedQuestionId = Number(question_id ?? questionId);

    if (Number.isInteger(resolvedQuestionId) && resolvedQuestionId > 0) {
      await persistQuestionAiHints(resolvedQuestionId, hints);
    }

    return c.json({
      success: true,
      hint: hints[`hint_${level}`]
    });
  } catch (error) {
    console.error('Gagal generate hint:', error);
    return c.json({
      success: false,
      hint: 'Gagal menghubungi AI.'
    }, 500);
  }
});

export default apiRoutes;
