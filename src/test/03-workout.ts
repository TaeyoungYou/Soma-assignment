import { signIn } from "../utils/signIn";
import { signOut } from "../utils/signOut";
import { supabase } from "../lib/supabase";

const USER_A = {
  email: "arnold.4778@gmail.com",
  password: "test1234",
};

const USER_B = {
  email: "you.00027@algonquinlive.com",
  password: "test1234",
};

async function runWorkoutsRLSTest() {
  console.log("=== USER A LOGIN ===");

  const { data: userAData, error: userAError } = await signIn(
    USER_A.email,
    USER_A.password,
  );

  if (userAError || !userAData.user) {
    console.error("User A login failed:", userAError?.message);
    return;
  }

  const userA = userAData.user;

  console.log("User A:", userA.id);

  // --------------------------------------------------
  // 1. User A creates their own workout
  // --------------------------------------------------

  const { data: workoutA, error: insertAError } = await supabase
    .from("workouts")
    .insert({
      user_id: userA.id,
      source_workout_id: 1001,
      started_at: new Date().toISOString(),
      active_bands: [0, 3],
    })
    .select()
    .single();

  console.log("\nUser A workout insert:", workoutA);
  console.log("User A workout insert error:", insertAError);

  if (insertAError || !workoutA) {
    await signOut();
    return;
  }

  // --------------------------------------------------
  // 2. User A inserts a sensor data chunk
  // --------------------------------------------------

  const { data: chunkA, error: chunkAError } = await supabase
    .from("workout_chunks")
    .insert({
      workout_id: workoutA.id,
      sequence: 0,
      sample_count: 0,
      sensor_data: {
        dat0: [],
        dat1: [],
        dat2: [],
      },
    })
    .select()
    .single();

  console.log("\nUser A chunk insert:", chunkA);
  console.log("User A chunk insert error:", chunkAError);

  await signOut();

  // ==================================================
  // USER B
  // ==================================================

  console.log("\n=== USER B LOGIN ===");

  const { data: userBData, error: userBError } = await signIn(
    USER_B.email,
    USER_B.password,
  );

  if (userBError || !userBData.user) {
    console.error("User B login failed:", userBError?.message);
    return;
  }

  const userB = userBData.user;

  console.log("User B:", userB.id);

  // --------------------------------------------------
  // 3. User B should NOT see User A's workout
  // --------------------------------------------------

  const { data: userBWorkouts, error: selectBError } = await supabase
    .from("workouts")
    .select("*");

  console.log("\nUser B visible workouts:", userBWorkouts);
  console.log("User B select error:", selectBError);

  // --------------------------------------------------
  // 4. User B should NOT see User A's chunks
  // --------------------------------------------------

  const { data: userBChunks, error: selectChunkError } = await supabase
    .from("workout_chunks")
    .select("*");

  console.log("\nUser B visible chunks:", userBChunks);
  console.log("User B chunk select error:", selectChunkError);

  // --------------------------------------------------
  // 5. User B tries to create a workout for User A
  // Expected: RLS rejection
  // --------------------------------------------------

  const { data: illegalWorkout, error: illegalWorkoutError } = await supabase
    .from("workouts")
    .insert({
      user_id: userA.id,
      source_workout_id: 2001,
      started_at: new Date().toISOString(),
      active_bands: [0],
    })
    .select();

  console.log("\nIllegal workout insert:", illegalWorkout);
  console.log(
    "Illegal workout insert error:",
    illegalWorkoutError?.message ?? null,
  );

  // --------------------------------------------------
  // 6. User B tries to insert a chunk into User A's workout
  // Expected: RLS rejection
  // --------------------------------------------------

  const { data: illegalChunk, error: illegalChunkError } = await supabase
    .from("workout_chunks")
    .insert({
      workout_id: workoutA.id,
      sequence: 1,
      sample_count: 0,
      sensor_data: {
        dat0: [],
        dat1: [],
        dat2: [],
      },
    })
    .select();

  console.log("\nIllegal chunk insert:", illegalChunk);
  console.log(
    "Illegal chunk insert error:",
    illegalChunkError?.message ?? null,
  );

  // --------------------------------------------------
  // 7. User B creates their own workout
  // --------------------------------------------------

  const { data: workoutB, error: insertBError } = await supabase
    .from("workouts")
    .insert({
      user_id: userB.id,
      source_workout_id: 2002,
      started_at: new Date().toISOString(),
      active_bands: [3, 5],
    })
    .select()
    .single();

  console.log("\nUser B workout insert:", workoutB);
  console.log("User B workout insert error:", insertBError);

  if (insertBError || !workoutB) {
    await signOut();
    return;
  }

  // --------------------------------------------------
  // 8. User B inserts a chunk into their own workout
  // --------------------------------------------------

  const { data: chunkB, error: chunkBError } = await supabase
    .from("workout_chunks")
    .insert({
      workout_id: workoutB.id,
      sequence: 0,
      sample_count: 0,
      sensor_data: {
        dat0: [],
        dat1: [],
        dat2: [],
      },
    })
    .select()
    .single();

  console.log("\nUser B chunk insert:", chunkB);
  console.log("User B chunk insert error:", chunkBError);

  // --------------------------------------------------
  // 9. User B finishes their workout
  // Tests UPDATE RLS
  // --------------------------------------------------

  const { data: completedWorkoutB, error: updateBError } = await supabase
    .from("workouts")
    .update({
      final_score: 75,
      ended_at: new Date().toISOString(),
    })
    .eq("id", workoutB.id)
    .select()
    .single();

  console.log("\nUser B workout update:", completedWorkoutB);
  console.log("User B workout update error:", updateBError);

  await signOut();
}

runWorkoutsRLSTest().catch(console.error);
