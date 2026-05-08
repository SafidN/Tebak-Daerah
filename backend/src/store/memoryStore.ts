export interface Player {
  id: string;
  name: string;
  score: number;
  wrongAttempts: number;
  hasAnsweredCorrectly: boolean;
}

export interface Room {
  id: string;
  hostId: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  isPrivate: boolean;
  maxPlayers: number;
  players: Map<string, Player>;
  status: 'waiting' | 'playing' | 'finished';
  currentQuestion: number; // The question number shown to user
  currentQuestionIndex: number; // Array index 0-9
  timer: number;
  timerInterval?: NodeJS.Timeout;
  questions: any[]; // Array untuk menyimpan data soal (nama_kota, foto_url)
  hostName?: string;
  winPoints?: number;
}

// Global state untuk menyimpan room aktif
export const rooms = new Map<string, Room>();
