import type { WorkoutJson } from "../types/workout";

export default function countSamples(workout: WorkoutJson) {
  let count = 0;

  for (const location of workout.dat0) {
    for (const channel of location) {
      count += channel.length;
    }
  }

  for (const location of workout.dat1) {
    count += location.length;
  }

  for (const location of workout.dat2) {
    for (const analyte of location) {
      count += analyte.length;
    }
  }

  return count;
}
