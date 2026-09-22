import type { Json } from "./database";

export type WorkoutJson = {
  id: number;
  finalScore: number | null;
  date: string;
  end: string | null;
  activeBands: number[];
  dat0: Json[][][];
  dat1: Json[][];
  dat2: Json[][][];
};
