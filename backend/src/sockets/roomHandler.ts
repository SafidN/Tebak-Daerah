import { Server, Socket } from 'socket.io';
import { rooms, Room } from '../store/memoryStore';
import { getCities } from '../config/db';
import { getHintForLevel } from '../services/aiService';

const HINT_THRESHOLD_BY_DIFFICULTY: Record<Room['difficulty'], number> = {
  Easy: 5,
  Medium: 3,
  Hard: 2
};

const clearRoomTimers = (room: Room) => {
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = undefined;
  }

  if (room.preStartTimeout) {
    clearTimeout(room.preStartTimeout);
    room.preStartTimeout = undefined;
  }
};

const deleteRoomIfUnused = (roomId: string) => {
  const room = rooms.get(roomId);
  if (!room) return;

  if (room.players.size === 0) {
    clearRoomTimers(room);
    rooms.delete(roomId);
  }
};

const buildRoomUpdatePayload = (room: Room) => {
  const players = Array.from(room.players.values());
  const readyPlayersCount = players.filter((player) => !player.is_host && player.ready).length;
  const nonHostPlayersCount = players.filter((player) => !player.is_host).length;
  const rematchReadyCount = players.filter((player) => !player.is_host && player.ready).length;

  return {
    players,
    status: room.status,
    max_players: room.maxPlayers,
    win_points: room.winPoints || 100,
    ready_players_count: readyPlayersCount,
    non_host_players_count: nonHostPlayersCount,
    rematch_ready_count: rematchReadyCount,
    can_start: room.status === 'waiting' && nonHostPlayersCount > 0 && readyPlayersCount === nonHostPlayersCount,
    can_restart: room.status === 'finished' && rematchReadyCount >= 1
  };
};

const resetPlayersForNewRound = (room: Room, resetScores = true) => {
  room.players.forEach((player) => {
    player.hasAnsweredCorrectly = false;
    player.wrongAttempts = 0;
    player.aiHintStage = 0;
    player.ready = false;
    if (resetScores) {
      player.score = 0;
    }
  });
};

const startGameSession = async (io: Server, roomId: string, resetScores = true) => {
  const room = rooms.get(roomId);
  if (!room) return;

  try {
    const cities = await getCities(room.difficulty);
    room.questions = cities.sort(() => 0.5 - Math.random()).slice(0, 10);
    room.status = 'playing';
    room.currentQuestionIndex = 0;

    resetPlayersForNewRound(room, resetScores);
    io.to(roomId).emit('room_update', {
      ...buildRoomUpdatePayload(room)
    });
    startQuestion(io, roomId);
  } catch (error) {
    console.error('Gagal mengambil soal dari DB:', error);
    throw error;
  }
};

const removePlayerFromRoom = (
  io: Server,
  roomId: string,
  socketId: string,
  options?: { emitLeaveNotice?: boolean }
) => {
  const room = rooms.get(roomId);
  if (!room) return;

  const isHostLeaving = room.hostId === socketId;
  const leavingPlayer = room.players.get(socketId);
  if (!room.players.has(socketId) && !isHostLeaving) return;

  room.players.delete(socketId);

  if (isHostLeaving) {
    clearRoomTimers(room);
    io.to(roomId).emit('room_closed', {
      message: 'Host keluar. Room ditutup otomatis.'
    });
    rooms.delete(roomId);
    return;
  }

  if (options?.emitLeaveNotice !== false && leavingPlayer?.name) {
    io.to(roomId).emit('room_notice', {
      message: `${leavingPlayer.name} keluar`
    });
  }

  io.to(roomId).emit('room_update', {
    ...buildRoomUpdatePayload(room)
  });

  deleteRoomIfUnused(roomId);
};

export const startQuestion = (io: Server, roomId: string) => {
  const room = rooms.get(roomId);
  if (!room) return;

  clearRoomTimers(room);

  // Reset status jawaban pemain untuk soal baru
  room.players.forEach(p => {
    p.hasAnsweredCorrectly = false;
    p.wrongAttempts = 0;
    p.aiHintStage = 0;
  });

  // Reset timer sesuai difficulty (Easy: 60s, Medium: 70s, Hard: 80s)
  room.timer = room.difficulty === 'Easy' ? 60 : room.difficulty === 'Medium' ? 70 : 80;

  const currentQuestion = room.questions[room.currentQuestionIndex];

  // Pastikan foto_url ada, jika tidak gunakan default
  const fotoUrl = currentQuestion.foto_url || 'Jakarta.jpg';

  // Kirim soal ke pemain (city_name JANGAN DIKIRIM biar nggak dicheat di frontend)
  io.to(roomId).emit('new_question', {
    questionNumber: room.currentQuestionIndex + 1,
    question: {
      id: currentQuestion.id,
      foto_url: fotoUrl
    },
    timer: room.timer
  });

  room.preStartTimeout = setTimeout(() => {
    room.timerInterval = setInterval(() => {
      room.timer--;

      // BROADCAST TIMER UPDATE BIAR ANGKA DI UI BISA MUNDUR
      io.to(roomId).emit('timer_update', { timer: room.timer });

      // Cek apakah semua orang sudah menjawab dengan benar
      const allAnswered = Array.from(room.players.values()).every(p => p.hasAnsweredCorrectly);

      if (room.timer <= 0 || allAnswered) {
        if (room.timerInterval) clearInterval(room.timerInterval);
        room.timerInterval = undefined;

        // Kirim jawaban benar dan tunggu 5 detik
        io.to(roomId).emit('question_ended', {
          correctAnswer: currentQuestion.city_name
        });

        // Lanjut ke soal berikutnya setelah 5 detik
        setTimeout(() => {
          room.currentQuestionIndex++;
          if (room.currentQuestionIndex < room.questions.length && room.currentQuestionIndex < 10) {
            startQuestion(io, roomId);
          } else {
            room.status = 'finished';
            io.to(roomId).emit('room_update', {
              ...buildRoomUpdatePayload(room)
            });
            io.to(roomId).emit('game_over', {
              players: Array.from(room.players.values())
            });
            deleteRoomIfUnused(roomId);
          }
        }, 5000);
      }
    }, 1000);
  }, 3000);
};

export const handleRoomEvents = (io: Server, socket: Socket) => {
  // ==========================================
  // FITUR BARU: REAL-TIME TYPING
  // ==========================================
  socket.on('typing', (data: { roomId: string, isTyping: boolean }) => {
    const room = rooms.get(data.roomId);
    const player = room?.players.get(socket.id);
    if (player) {
      // Kirim ke semua orang di room KECUALI si pengirim
      socket.to(data.roomId).emit('player_typing', {
        playerName: player.name,
        isTyping: data.isTyping
      });
    }
  });

  // ==========================================
  // FITUR BARU: SUBMIT ANSWER, SCORING & AI HINT
  // ==========================================
  socket.on('submit_answer', async (data: { roomId: string, answer: string }) => {
    const room = rooms.get(data.roomId);
    if (!room || room.status !== 'playing') return;

    const player = room.players.get(socket.id);
    if (!player || player.hasAnsweredCorrectly) return; // Kalau udah benar, gak usah dihitung lagi

    const currentQuestion = room.questions[room.currentQuestionIndex];
    const correctAnswer = currentQuestion.city_name.toLowerCase();
    const userAnswer = data.answer.toLowerCase().trim();

    if (userAnswer === correctAnswer) {
      // --- LOGIC JAWABAN BENAR ---
      // Hitung ada berapa orang yang udah jawab benar sebelumnya
      const correctCount = Array.from(room.players.values()).filter(p => p.hasAnsweredCorrectly).length;

      // Peringkat 1 = 10 poin, Peringkat 2 = 9 poin, dst (minimal 1 poin)
      const scoreEarned = Math.max(1, 10 - correctCount);

      player.score += scoreEarned;
      player.hasAnsweredCorrectly = true;

      // Kirim pesan "Hidden Chat", teks jawabannya nggak ditampilin
      io.to(data.roomId).emit('system_message', {
        message: `Jawaban ${player.name} benar! (+${scoreEarned} Poin)`
      });

      // Update leaderboard
      io.to(data.roomId).emit('room_update', {
        ...buildRoomUpdatePayload(room)
      });
    } else {
      // --- LOGIC JAWABAN SALAH ---
      player.wrongAttempts++;

      // Munculin jawaban salahnya di chat global biar diketawain yang lain wkwk
      io.to(data.roomId).emit('chat_message', {
        sender: player.name,
        avatar: player.avatar,
        message: data.answer
      });

      const hintThreshold = HINT_THRESHOLD_BY_DIFFICULTY[room.difficulty];
      const nextHintStage = player.aiHintStage + 1;

      if (nextHintStage <= 3 && player.wrongAttempts >= hintThreshold * nextHintStage) {
        player.aiHintStage = nextHintStage;

        const hint = await getHintForLevel(currentQuestion.id, currentQuestion.city_name, nextHintStage as 1 | 2 | 3);

        socket.emit('game_hint', {
          level: nextHintStage,
          hint
        });
      }
    }
  });

  // ==========================================
  // EVENT BAWAAN LO (UDAH GUE RAPIHIN DIKIT TIMERNYA)
  // ==========================================
  socket.on('create_room', (data: { difficulty: 'Easy'|'Medium'|'Hard', maxPlayers: number, isPrivate: boolean, hostName: string }) => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();

    const newRoom: Room = {
      id: roomId,
      hostId: socket.id,
      difficulty: data.difficulty,
      isPrivate: data.isPrivate,
      maxPlayers: data.maxPlayers,
      players: new Map(),
      status: 'waiting',
      currentQuestion: 1,
      currentQuestionIndex: 0,
      timer: data.difficulty === 'Easy' ? 60 : data.difficulty === 'Medium' ? 70 : 80,
      questions: [],
      hostName: data.hostName || 'Host',
      winPoints: 100,
      kickedUserIds: new Set<string>()
    };

    rooms.set(roomId, newRoom);
    socket.emit('room_created', { roomId, message: 'Room berhasil dibuat' });
  });

  socket.on('join_room', (data: { roomId: string, playerName: string, avatar: string, isHost: boolean, userId?: string, source?: 'code' | 'lobby' }) => {
    const room = rooms.get(data.roomId);
    if (!room) return socket.emit('error', { message: 'Room not found' });
    if (!room.kickedUserIds) room.kickedUserIds = new Set<string>();
    if (data.source === 'lobby' && data.userId && room.kickedUserIds.has(data.userId)) {
      return socket.emit('error', { message: 'Kamu sudah dikeluarkan dari room ini.' });
    }
    if (room.players.size >= room.maxPlayers && !data.isHost) return socket.emit('error', { message: 'Room is full' });
    if (room.status !== 'waiting' && !data.isHost) return socket.emit('error', { message: 'Game has started' });

    if (data.isHost) {
      room.hostId = socket.id;
    }

    room.players.set(socket.id, {
      id: socket.id,
      userId: data.userId,
      name: data.playerName,
      score: 0,
      wrongAttempts: 0,
      hasAnsweredCorrectly: false,
      aiHintStage: 0,
      avatar: data.avatar,
      is_host: data.isHost,
      ready: data.isHost
    } as any);

    socket.data.roomId = data.roomId;
    socket.join(data.roomId);

    io.to(data.roomId).emit('room_notice', {
      message: `${data.playerName} bergabung`
    });

    io.to(data.roomId).emit('room_update', {
      ...buildRoomUpdatePayload(room)
    });
  });

  socket.on('toggle_ready', (data: { roomId?: string, ready: boolean }) => {
    const roomId = data.roomId || socket.data.roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room || (room.status !== 'waiting' && room.status !== 'finished')) return;

    const player = room.players.get(socket.id);
    if (!player || player.is_host) return;

    player.ready = data.ready;

    io.to(roomId).emit('room_update', {
      ...buildRoomUpdatePayload(room)
    });
  });

  socket.on('kick_player', (data: { roomId: string, targetId: string }) => {
    const room = rooms.get(data.roomId);
    if (room && room.hostId === socket.id) {
      const targetPlayer = room.players.get(data.targetId);
      if (targetPlayer?.userId) {
        room.kickedUserIds.add(targetPlayer.userId);
      }

      removePlayerFromRoom(io, data.roomId, data.targetId, { emitLeaveNotice: false });
      io.sockets.sockets.get(data.targetId)?.leave(data.roomId);
      if (targetPlayer?.name) {
        io.to(data.roomId).emit('room_notice', { message: `${targetPlayer.name} Telah Dikeluarkan` });
      }
      io.sockets.sockets.get(data.targetId)?.emit('kicked', { reason: 'Kamu telah dikeluarkan dari room ini.' });
    }
  });

  socket.on('leave_room', (data: { roomId?: string }) => {
    const roomId = data.roomId || socket.data.roomId;
    if (!roomId) return;

    socket.leave(roomId);
    removePlayerFromRoom(io, roomId, socket.id, { emitLeaveNotice: true });
  });

  socket.on('start_game', async (roomId: string) => {
    const room = rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;

    if (room.status === 'waiting') {
      const nonHostPlayers = Array.from(room.players.values()).filter((player) => !player.is_host);
      const allReady = nonHostPlayers.length > 0 && nonHostPlayers.every((player) => player.ready);

      if (!allReady) {
        socket.emit('error', { message: 'Tunggu semua pemain siap dulu.' });
        return;
      }

      try {
        await startGameSession(io, roomId, true);
      } catch (error) {
        socket.emit('error', { message: 'Gagal memulai game karena masalah Database.' });
      }
      return;
    }

    if (room.status === 'finished') {
      const readyPlayers = Array.from(room.players.values()).filter((player) => !player.is_host && player.ready);

      if (readyPlayers.length < 1) {
        socket.emit('error', { message: 'Minimal 1 pemain siap untuk main lagi.' });
        return;
      }

      const notReadyPlayers = Array.from(room.players.values()).filter((player) => !player.is_host && !player.ready);

      notReadyPlayers.forEach((player) => {
        const targetSocket = io.sockets.sockets.get(player.id);
        if (targetSocket) {
          targetSocket.emit('rematch_excluded', {
            reason: 'Kamu tidak ikut main lagi.'
          });
          targetSocket.leave(roomId);
        }
        if (player.name) {
          io.to(roomId).emit('room_notice', {
            message: `${player.name} keluar`
          });
        }
        room.players.delete(player.id);
      });

      io.to(roomId).emit('room_notice', {
        message: 'Main ulang dimulai.'
      });

      io.to(roomId).emit('room_update', {
        ...buildRoomUpdatePayload(room)
      });

      try {
        await startGameSession(io, roomId, true);
      } catch (error) {
        socket.emit('error', { message: 'Gagal memulai game karena masalah Database.' });
      }
    }
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    removePlayerFromRoom(io, roomId, socket.id, { emitLeaveNotice: true });
  });
};
