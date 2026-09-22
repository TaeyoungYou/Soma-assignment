import fs from "fs";
import path from "path";

import { supabase } from "../lib/supabase";
import { signIn } from "../utils/signIn";
import { signOut } from "../utils/signOut";
import type { WorkoutJson } from "../types/workout";
import countSamples from "../utils/sampleCount";

async function uploadWorkout(fileName: string, userId: string) {
  console.log(`\n=== Uploading ${fileName} ===`);

  // 1. Read JSON file
  const filePath = path.resolve("src/samples", fileName);
  const file = fs.readFileSync(filePath, "utf-8");
  const workout: WorkoutJson = JSON.parse(file);

  const sampleCount = countSamples(workout);

  console.log("Source workout ID:", workout.id);
  console.log("Final score:", workout.finalScore);
  console.log("Started at:", workout.date);
  console.log("Ended at:", workout.end);
  console.log("Sample count:", sampleCount);

  // ---------------------------------------------------------
  // 2. Create workout metadata
  // ---------------------------------------------------------
  const { data: createdWorkout, error: workoutError } = await supabase
    .from("workouts")
    .insert({
      user_id: userId,
      source_workout_id: workout.id,
      final_score: workout.finalScore,
      started_at: workout.date,
      ended_at: workout.end,
      active_bands: workout.activeBands,
    })
    .select()
    .single();

  if (workoutError || !createdWorkout) {
    throw new Error(`Workout insert failed: ${workoutError?.message}`);
  }

  console.log("Created workout:", createdWorkout.id);

  // ---------------------------------------------------------
  // 3. Insert sensor data as a chunk
  // ---------------------------------------------------------
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

  if (chunkError || !chunk) {
    throw new Error(`Chunk insert failed: ${chunkError?.message}`);
  }

  console.log("Created chunk:", chunk.id);

  // ---------------------------------------------------------
  // 4. Verify stored workout
  // ---------------------------------------------------------
  const { data: storedWorkout, error: verifyWorkoutError } = await supabase
    .from("workouts")
    .select("*")
    .eq("id", createdWorkout.id)
    .single();

  if (verifyWorkoutError) {
    throw new Error(
      `Workout verification failed: ${verifyWorkoutError.message}`,
    );
  }

  // ---------------------------------------------------------
  // 5. Verify stored chunks
  // ---------------------------------------------------------
  const { data: storedChunks, error: verifyChunkError } = await supabase
    .from("workout_chunks")
    .select("id, workout_id, sequence, sample_count")
    .eq("workout_id", createdWorkout.id)
    .order("sequence");

  if (verifyChunkError) {
    throw new Error(`Chunk verification failed: ${verifyChunkError.message}`);
  }

  const storedSampleCount =
    storedChunks?.reduce((sum, chunk) => sum + chunk.sample_count, 0) ?? 0;

  console.log("\nVerification:");
  console.log("Workout:", storedWorkout);
  console.log("Chunks:", storedChunks);
  console.log(
    `Sample count: original=${sampleCount}, stored=${storedSampleCount}`,
  );

  if (storedSampleCount !== sampleCount) {
    throw new Error("Sample count verification failed.");
  }

  console.log("Workout verified successfully.");

  return {
    workoutId: createdWorkout.id,
    sampleCount,
  };
}

async function testAllSamples() {
  console.log("=== Upload All Workout Samples ===");

  // ---------------------------------------------------------
  // 1. Sign in
  // ---------------------------------------------------------
  const { data: authData, error: authError } = await signIn(
    "you.00027@algonquinlive.com",
    "test1234",
  );

  if (authError || !authData.user) {
    console.error("Sign in failed:", authError?.message);
    return;
  }

  console.log("Logged in user:", authData.user.id);

  try {
    // ---------------------------------------------------------
    // 2. Upload all three samples
    // ---------------------------------------------------------
    await uploadWorkout("sample_workout_small.json", authData.user.id);

    await uploadWorkout("sample_workout_partial.json", authData.user.id);

    await uploadWorkout("sample_workout.json", authData.user.id);

    // ---------------------------------------------------------
    // 3. Call usage statistics RPC
    // ---------------------------------------------------------
    console.log("\n========================================");
    console.log("=== Usage Statistics ===");
    console.log("========================================\n");

    const { data: statistics, error: statisticsError } = await supabase.rpc(
      "get_usage_statistics",
    );

    if (statisticsError) {
      throw new Error(`Statistics RPC failed: ${statisticsError.message}`);
    }

    console.log(statistics);
  } catch (error) {
    console.error("\nTest failed:", error);
  } finally {
    await signOut();
    console.log("\nSigned out.");
  }
}

testAllSamples().catch(console.error);
