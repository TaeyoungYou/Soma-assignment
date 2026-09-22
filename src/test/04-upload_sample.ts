import fs from "fs";
import path from "path";

import { supabase } from "../lib/supabase";
import { signIn } from "../utils/signIn";
import { signOut } from "../utils/signOut";
import type { WorkoutJson } from "../types/workout";
import countSamples from "../utils/sampleCount";

async function testUploadSample() {
  // 1. Sign in
  const { data: authData, error: authError } = await signIn(
    "arnold.4778@gmail.com",
    "test1234",
  );

  if (authError || !authData.user) {
    console.error("Login failed:", authError?.message);
    return;
  }

  const user = authData.user;

  console.log("Logged in user:", user.id);

  // 2. Read sample workout JSON
  const filePath = path.resolve("src/samples/sample_workout_small.json");

  const file = fs.readFileSync(filePath, "utf-8");
  const workout: WorkoutJson = JSON.parse(file);

  // 3. Calculate the number of sensor messages
  const sampleCount = countSamples(workout);

  console.log("Sample count:", sampleCount);

  // 4. Create the workout first
  // A workout starts without final_score / ended_at.
  const { data: createdWorkout, error: workoutError } = await supabase
    .from("workouts")
    .insert({
      user_id: user.id,
      source_workout_id: workout.id,
      started_at: workout.date,
      active_bands: workout.activeBands,
    })
    .select()
    .single();

  if (workoutError || !createdWorkout) {
    console.error("Workout insert failed:", workoutError?.message);
    await signOut();
    return;
  }

  console.log("\nCreated workout:", createdWorkout);

  // 5. Insert the sensor data as the first chunk
  const { data: chunk, error: chunkError } = await supabase
    .from("workout_chunks")
    .insert({
      workout_id: createdWorkout.id,
      sequence: 0,
      sample_count: sampleCount,
      sensor_data: {
        dat0: workout.dat0,
        dat1: workout.dat1,
        dat2: workout.dat2,
      },
    })
    .select()
    .single();

  if (chunkError) {
    console.error("Chunk insert failed:", chunkError.message);
    await signOut();
    return;
  }

  console.log("\nInserted chunk:", chunk);

  // 6. Mark the workout as completed
  const { data: completedWorkout, error: updateError } = await supabase
    .from("workouts")
    .update({
      final_score: workout.finalScore,
      ended_at: workout.end,
      sample_count: sampleCount,
    })
    .eq("id", createdWorkout.id)
    .select()
    .single();

  console.log("\nCompleted workout:", completedWorkout);
  console.log("Update error:", updateError);

  await signOut();
}

testUploadSample().catch(console.error);
