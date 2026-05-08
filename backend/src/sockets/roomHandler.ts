import { Server, Socket } from 'socket.io';
import { rooms, Room, Player } from '../store/memoryStore';
import { getCities } from '../config/db';
import { getSmartHint } from '../services/aiService'; // 👈 IMPORT AI SERVICE DI SINI

export const startQuestion = (io: Server, roomId: string) => {
  const room = rooms.get(roomId);
  if (!room) return;

  // Reset status jawaban pemain untuk soal baru
  room.players.forEach(p => {
    p.hasAnsweredCorrectly = false;
    p.wrongAttempts = 0;
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

  if (room.timerInterval) clearInterval(room.timerInterval);

  room.timerInterval = setInterval(() => {
    room.timer--;
    
    // 👈 BROADCAST TIMER UPDATE BIAR ANGKA DI PYTHON BISA MUNDUR
    io.to(roomId).emit('timer_update', { timer: room.timer });
    
    // Cek apakah semua orang sudah menjawab dengan benar
    const allAnswered = Array.from(room.players.values()).every(p => p.hasAnsweredCorrectly);
    
    if (room.timer <= 0 || allAnswered) {
      clearInterval(room.timerInterval);
      
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
          io.to(roomId).emit('game_over', {
            players: Array.from(room.players.values())
          });
        }
      }, 5000);
    }
  }, 1000);
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
        io.to(data.roomId).emit('room_update', { players: Array.from(room.players.values()) });

    } else {
        // --- LOGIC JAWABAN SALAH ---
        player.wrongAttempts++;
        
        // Munculin jawaban salahnya di chat global biar diketawain yang lain wkwk
        io.to(data.roomId).emit('chat_message', {
            sender: player.name,
            message: data.answer
        });

        // TRIGGER AI HINT KALAU SALAH 5x
        if (player.wrongAttempts === 5) {
            const hint = await getSmartHint(currentQuestion.id, currentQuestion.city_name);
            
            // Kirim hint ke orang yang salah tersebut aja (atau bisa io.to kalau mau se-room tahu)
            socket.emit('game_hint', { message: `💡 Hint AI: ${hint}` });
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
      timer: data.difficulty === 'Easy' ? 60 : data.difficulty === 'Medium' ? 70 : 80, // 👈 FIX TIMER
      questions: [],
      hostName: data.hostName || 'Host',
      winPoints: 100
    };
    
    rooms.set(roomId, newRoom);
    socket.emit('room_created', { roomId, message: 'Room berhasil dibuat' });
  });

  socket.on('join_room', (data: { roomId: string, playerName: string, avatar: string, isHost: boolean }) => {
    const room = rooms.get(data.roomId);
    if (!room) return socket.emit('error', { message: 'Room not found' });
    if (room.players.size >= room.maxPlayers && !data.isHost) return socket.emit('error', { message: 'Room is full' });
    if (room.status !== 'waiting' && !data.isHost) return socket.emit('error', { message: 'Game has started' });

    if (data.isHost) {
      room.hostId = socket.id;
    }

    room.players.set(socket.id, { 
        id: socket.id, 
        name: data.playerName, 
        score: 0, 
        wrongAttempts: 0, 
        hasAnsweredCorrectly: false,
        avatar: data.avatar,
        is_host: data.isHost
    } as any);

    socket.join(data.roomId);
    
    io.to(data.roomId).emit('room_update', { 
        players: Array.from(room.players.values()),
        status: room.status,
        max_players: room.maxPlayers,
        win_points: room.winPoints || 100
    });
  });

  socket.on('kick_player', (data: { roomId: string, targetId: string }) => {
    const room = rooms.get(data.roomId);
    if (room && room.hostId === socket.id) {
      room.players.delete(data.targetId);
      io.sockets.sockets.get(data.targetId)?.leave(data.roomId);
      io.sockets.sockets.get(data.targetId)?.emit('kicked', { reason: 'Dikeluarkan oleh Host.' });
      io.to(data.roomId).emit('room_update', { message: 'Pemain telah dikeluarkan.' });
    }
  });

  socket.on('start_game', async (roomId: string) => {
      const room = rooms.get(roomId);
      if(room && room.hostId === socket.id) {
          try {
            const cities = await getCities(room.difficulty);
            room.questions = cities.sort(() => 0.5 - Math.random()).slice(0, 10);
            
            room.status = 'playing';
            room.currentQuestionIndex = 0;
            
            startQuestion(io, roomId);
          } catch (error) {
            console.error("Gagal mengambil soal dari DB:", error);
            socket.emit('error', { message: 'Gagal memulai game karena masalah Database.' });
          }
      }
  });
};