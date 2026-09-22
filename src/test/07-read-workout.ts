import { supabase } from "../lib/supabase";
import { signIn } from "../utils/signIn";
import { signOut } from "../utils/signOut";

async function testReadWorkout() {
  console.log("=== Read Workout Test ===\n");

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

  const user = authData.user;

  console.log("Logged in user:", user.id);

  // ---------------------------------------------------------
  // 2. Read user's workouts
  // ---------------------------------------------------------
  const { data: workouts, error: workoutsError } = await supabase
    .from("workouts")
    .select("*")
    .order("started_at", { ascending: false });

  if (workoutsError) {
    console.error("Failed to read workouts:", workoutsError.message);
    await signOut();
    return;
  }

  console.log("\nWorkouts found:", workouts.length);

  if (workouts.length === 0) {
    console.log("No workouts found.");
    await signOut();
    return;
  }

  for (const workout of workouts) {
    console.log({
      id: workout.id,
      source_workout_id: workout.source_workout_id,
      final_score: workout.final_score,
      started_at: workout.started_at,
      ended_at: workout.ended_at,
      active_bands: workout.active_bands,
    });
  }

  // ---------------------------------------------------------
  // 3. Select one workout
  // ---------------------------------------------------------
  const selectedWorkout = workouts[0];

  console.log("\nSelected workout:");
  console.log(selectedWorkout);

  // ---------------------------------------------------------
  // 4. Read chunks for selected workout
  // ---------------------------------------------------------
  const { data: chunks, error: chunksError } = await supabase
    .from("workout_chunks")
    .select("*")
    .eq("workout_id", selectedWorkout.id)
    .order("sequence", { ascending: true });

  if (chunksError) {
    console.error("Failed to read workout chunks:", chunksError.message);
    await signOut();
    return;
  }

  console.log("\nChunks found:", chunks.length);

  for (const chunk of chunks) {
    console.log({
      id: chunk.id,
      sequence: chunk.sequence,
      sample_count: chunk.sample_count,
    });
  }

  // ---------------------------------------------------------
  // 5. Verify sample count
  // ---------------------------------------------------------
  const totalSampleCount = chunks.reduce(
    (sum, chunk) => sum + chunk.sample_count,
    0,
  );

  console.log("\nTotal sample count:", totalSampleCount);

  // ---------------------------------------------------------
  // 6. Reconstruct sensor data
  // ---------------------------------------------------------
  const sensorData = chunks
    .sort((a, b) => a.sequence - b.sequence)
    .map((chunk) => chunk.sensor_data);

  console.log("Sensor data chunks reconstructed:", sensorData.length);

  console.log("\nWorkout read successfully.");

  // ---------------------------------------------------------
  // 7. Sign out
  // ---------------------------------------------------------
  await signOut();

  console.log("\nSigned out.");
}

testReadWorkout().catch(console.error);
