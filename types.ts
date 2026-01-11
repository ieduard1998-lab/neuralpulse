
export enum GameState {
  START = 'START',
  PLAYING = 'PLAYING',
  JUDGING = 'JUDGING',
  RESULT = 'RESULT',
  GAMEOVER = 'GAMEOVER'
}

export interface Pose {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export interface MatchResult {
  matched: boolean;
  score: number;
  feedback: string;
}
