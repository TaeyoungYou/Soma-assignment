import fs from "fs";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { supabase } from "../lib/supabase";
import { signIn } from "../utils/signIn";
import { signOut } from "../utils/signOut";
import type { WorkoutJson } from "../types/workout";
import countSamples from "../utils/sampleCount";

/**
 * ============================================================
 * Test Users
 * ============================================================
 *
 * Two existing Supabase Auth users are used for integration tests.
 *
 * The credentials are NOT hardcoded in the source code.
 * They are loaded from environment variables so secrets are not
 * committed to GitHub.
 *
 * USER_A:
 *   - Used as the main workout owner.
 *
 * USER_B:
 *   - Used to verify Row Level Security (RLS).
 *   - USER_B must not be able to access USER_A's workout data.
 */
const USER_A = {
  email: process.env.TEST_USER_A_EMAIL!,
  password: process.env.TEST_USER_A_PASSWORD!,
};

const USER_B = {
  email: process.env.TEST_USER_B_EMAIL!,
  password: process.env.TEST_USER_B_PASSWORD!,
};

/**
 * ============================================================
 * loadWorkout()
 * ============================================================
 *
 * Reads one of the workout JSON files provided with the assignment.
 *
 * Example:
 *
 *   sample_workout_small.json
 *   sample_workout_partial.json
 *   sample_workout.json
 *
 * path.resolve() creates an absolute path to the file.
 *
 * fs.readFileSync() reads the JSON file as text.
 *
 * JSON.parse() converts the JSON text into a JavaScript object.
 *
 * WorkoutJson is a TypeScript type describing the structure
 * of the workout data provided by SOMA.
 */
function loadWorkout(fileName: string): WorkoutJson {
  const filePath = path.resolve("src/samples", fileName);

  const file = fs.readFileSync(filePath, "utf-8");

  return JSON.parse(file);
}

/**
 * ============================================================
 * login()
 * ============================================================
 *
 * Helper function used by multiple tests.
 *
 * Instead of repeating signIn() + validation in every test,
 * this function:
 *
 * 1. Signs the user in.
 * 2. Verifies that Supabase returned no authentication error.
 * 3. Verifies that an authenticated user object exists.
 * 4. Returns the authenticated user.
 *
 * If authentication fails, Vitest marks the test as failed.
 */
async function login(email: string, password: string) {
  const { data, error } = await signIn(email, password);

  // Authentication request should succeed.
  expect(error).toBeNull();

  // Successful login should return a user.
  expect(data.user).not.toBeNull();

  /**
   * TypeScript still considers data.user potentially null,
   * even though Vitest checked it above.
   *
   * This explicit check narrows the TypeScript type and prevents
   * the remaining test code from working with a null user.
   */
  if (!data.user) {
    throw new Error("Expected authenticated user.");
  }

  return data.user;
}

/**
 * ============================================================
 * SOMA Supabase Integration Test Suite
 * ============================================================
 *
 * These are integration tests rather than pure unit tests.
 *
 * They connect to the real Supabase backend and verify:
 *
 * - Authentication
 * - PostgreSQL inserts
 * - Workout storage
 * - Sensor-data storage
 * - Row Level Security
 * - Workout retrieval
 * - Partial workout handling
 * - Statistics RPC permissions
 *
 * This means the tests verify that the application,
 * Supabase Auth, PostgreSQL, RLS policies, and RPC functions
 * work together correctly.
 */
describe("SOMA Supabase integration", () => {
  /**
   * ----------------------------------------------------------
   * Test Isolation
   * ----------------------------------------------------------
   *
   * Before every test, force the Supabase client into a
   * logged-out state.
   *
   * This prevents authentication state from a previous test
   * from affecting the next test.
   */
  beforeEach(async () => {
    await signOut();
  });

  /**
   * Also sign out after every test.
   *
   * This ensures that even if a test logs a user in,
   * the authentication session does not leak into another test.
   */
  afterEach(async () => {
    await signOut();
  });

  // ==========================================================
  // Authentication
  // ==========================================================

  /**
   * Verifies that:
   *
   * 1. The application can communicate with Supabase.
   * 2. USER_A can authenticate successfully.
   * 3. Supabase creates a valid session.
   * 4. The session belongs to the user who logged in.
   */
  it("connects to Supabase and authenticates a user", async () => {
    const user = await login(USER_A.email, USER_A.password);

    // Supabase Auth users must have an ID.
    expect(user.id).toBeDefined();

    /**
     * getSession() checks the session currently stored
     * by the Supabase client.
     */
    const { data, error } = await supabase.auth.getSession();

    expect(error).toBeNull();

    // Login should have created an active session.
    expect(data.session).not.toBeNull();

    /**
     * Verify that the session belongs to the exact
     * same user returned from signIn().
     */
    expect(data.session?.user.id).toBe(user.id);
  });

  // ==========================================================
  // Workout + Chunk RLS
  // ==========================================================

  /**
   * Tests the normal write path.
   *
   * An authenticated user should be able to:
   *
   * 1. Create their own workout.
   * 2. Add sensor data to that workout.
   *
   * This verifies the INSERT RLS policies for both tables.
   */
  it("allows users to create their own workout and chunk", async () => {
    const user = await login(USER_A.email, USER_A.password);

    /**
     * Create workout metadata.
     *
     * The important security relationship here is:
     *
     * user_id === authenticated user's auth.uid()
     *
     * Our workouts INSERT RLS policy checks this.
     */
    const { data: workout, error: workoutError } = await supabase
      .from("workouts")
      .insert({
        user_id: user.id,

        // Arbitrary test source ID.
        source_workout_id: 9001,

        started_at: new Date().toISOString(),

        active_bands: [0, 3],
      })
      /**
       * INSERT normally does not need to return the row.
       *
       * .select() asks PostgreSQL to return the inserted row.
       */
      .select()

      /**
       * We expect exactly one row,
       * so convert the returned array into one object.
       */
      .single();

    // The database operation should succeed.
    expect(workoutError).toBeNull();

    // An inserted workout should be returned.
    expect(workout).not.toBeNull();

    if (!workout) {
      throw new Error("Workout was not created.");
    }

    /**
     * Insert one sensor-data chunk belonging to the workout.
     *
     * Current assignment samples are stored as one chunk,
     * therefore the first and only sequence is 0.
     */
    const { data: chunk, error: chunkError } = await supabase
      .from("workout_chunks")
      .insert({
        // Foreign key to workouts.id
        workout_id: workout.id,

        // First chunk
        sequence: 0,

        /**
         * Empty test sensor data contains no samples,
         * therefore sample_count is 0.
         */
        sample_count: 0,

        sensor_data: {
          dat0: [],
          dat1: [],
          dat2: [],
        },
      })
      .select()
      .single();

    expect(chunkError).toBeNull();
    expect(chunk).not.toBeNull();

    /**
     * Verify that the chunk was attached to the
     * correct workout.
     */
    expect(chunk?.workout_id).toBe(workout.id);

    // This is the first chunk.
    expect(chunk?.sequence).toBe(0);
  });

  /**
   * ==========================================================
   * Cross-user RLS test
   * ==========================================================
   *
   * This is one of the most important security tests.
   *
   * USER_A owns the workout.
   *
   * USER_B should NOT be able to:
   *
   * - Read USER_A's workout
   * - Read USER_A's sensor chunks
   * - Create a workout pretending to be USER_A
   * - Insert a chunk into USER_A's workout
   */
  it("prevents another user from reading or writing someone else's workout", async () => {
    // ------------------------------------------------------
    // USER_A creates a workout
    // ------------------------------------------------------

    const userA = await login(USER_A.email, USER_A.password);

    const { data: workoutA, error: createError } = await supabase
      .from("workouts")
      .insert({
        user_id: userA.id,
        source_workout_id: 9002,
        started_at: new Date().toISOString(),
        active_bands: [0],
      })
      .select()
      .single();

    expect(createError).toBeNull();
    expect(workoutA).not.toBeNull();

    if (!workoutA) {
      throw new Error("User A workout was not created.");
    }

    /**
     * USER_A also creates a sensor chunk.
     */
    const { data: chunkA, error: chunkError } = await supabase
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

    expect(chunkError).toBeNull();
    expect(chunkA).not.toBeNull();

    /**
     * Important:
     * remove USER_A's authentication session before
     * testing USER_B.
     */
    await signOut();

    // ------------------------------------------------------
    // USER_B logs in
    // ------------------------------------------------------

    const userB = await login(USER_B.email, USER_B.password);

    // ------------------------------------------------------
    // USER_B cannot read USER_A's workout
    // ------------------------------------------------------

    const { data: visibleWorkout, error: readError } = await supabase
      .from("workouts")
      .select("*")
      .eq("id", workoutA.id);

    /**
     * Important RLS behavior:
     *
     * SELECT blocked by RLS generally does NOT produce
     * a permission error.
     *
     * PostgreSQL simply makes the unauthorized row invisible.
     *
     * Therefore:
     *
     * error === null
     * result === []
     */
    expect(readError).toBeNull();
    expect(visibleWorkout).toEqual([]);

    // ------------------------------------------------------
    // USER_B cannot read USER_A's sensor chunks
    // ------------------------------------------------------

    const { data: visibleChunks, error: chunkReadError } = await supabase
      .from("workout_chunks")
      .select("*")
      .eq("workout_id", workoutA.id);

    expect(chunkReadError).toBeNull();

    /**
     * USER_A's chunk should also be invisible to USER_B.
     */
    expect(visibleChunks).toEqual([]);

    // ------------------------------------------------------
    // USER_B cannot pretend to be USER_A
    // ------------------------------------------------------

    const { error: illegalWorkoutError } = await supabase
      .from("workouts")
      .insert({
        /**
         * USER_B is currently logged in,
         * but this row claims USER_A owns it.
         *
         * RLS should reject:
         *
         * auth.uid() !== userA.id
         */
        user_id: userA.id,

        /**
         * IMPORTANT:
         *
         * Use an ordinary INTEGER value here.
         *
         * Do NOT use Date.now().
         *
         * Date.now() is too large for PostgreSQL INTEGER,
         * which would make the insert fail because of
         * integer overflow rather than RLS.
         *
         * That would create a false-positive security test.
         */
        source_workout_id: 9003,

        started_at: new Date().toISOString(),

        active_bands: [0],
      });

    /**
     * We expect an actual RLS write rejection.
     */
    expect(illegalWorkoutError).not.toBeNull();

    // ------------------------------------------------------
    // USER_B cannot write into USER_A's workout
    // ------------------------------------------------------

    const { error: illegalChunkError } = await supabase
      .from("workout_chunks")
      .insert({
        /**
         * workoutA belongs to USER_A.
         *
         * USER_B is currently authenticated,
         * therefore the chunk INSERT RLS policy should fail.
         */
        workout_id: workoutA.id,

        /**
         * sequence 1 is used simply so it does not violate
         * the unique(workout_id, sequence) constraint.
         *
         * Otherwise the test could fail because of the
         * UNIQUE constraint instead of RLS.
         */
        sequence: 1,

        sample_count: 0,

        sensor_data: {
          dat0: [],
          dat1: [],
          dat2: [],
        },
      });

    expect(illegalChunkError).not.toBeNull();

    /**
     * Sanity check:
     *
     * Verify that USER_A and USER_B really are
     * different accounts.
     */
    expect(userB.id).not.toBe(userA.id);
  });

  // ==========================================================
  // Provided Workout Samples
  // ==========================================================

  /**
   * it.each() is Vitest's parameterized testing feature.
   *
   * Instead of writing the same test three times,
   * Vitest executes the following test once for each filename.
   *
   * So this single block actually becomes 3 tests.
   */
  it.each([
    "sample_workout_small.json",
    "sample_workout_partial.json",
    "sample_workout.json",
  ])(
    /**
     * %s is replaced with the current filename.
     *
     * Example output:
     *
     * stores and reads provided workout sample:
     * sample_workout_small.json
     */
    "stores and reads provided workout sample: %s",

    async (fileName) => {
      const user = await login(USER_A.email, USER_A.password);

      /**
       * Load the original SOMA sample JSON.
       */
      const workout = loadWorkout(fileName);

      /**
       * Calculate the number of individual sensor messages
       * contained in dat0, dat1, and dat2.
       *
       * This reproduces the purpose of Workout.sampleCount
       * from the supplied Flutter data structure.
       */
      const expectedSampleCount = countSamples(workout);

      // ------------------------------------------------------
      // Store workout metadata
      // ------------------------------------------------------

      const { data: createdWorkout, error: workoutError } = await supabase
        .from("workouts")
        .insert({
          user_id: user.id,

          /**
           * Keep the ID from the original workout JSON.
           *
           * This is NOT our database primary key.
           *
           * workouts.id remains a UUID generated by PostgreSQL.
           */
          source_workout_id: workout.id,

          /**
           * Partial workouts may contain null finalScore.
           */
          final_score: workout.finalScore,

          started_at: workout.date,

          /**
           * In-progress workout may have end = null.
           */
          ended_at: workout.end,

          active_bands: workout.activeBands,
        })
        .select()
        .single();

      expect(workoutError).toBeNull();

      expect(createdWorkout).not.toBeNull();

      if (!createdWorkout) {
        throw new Error(`Failed to create ${fileName}`);
      }

      // ------------------------------------------------------
      // Store sensor data
      // ------------------------------------------------------

      /**
       * For the assignment implementation, each supplied
       * workout JSON file is stored as ONE chunk.
       *
       * Therefore:
       *
       * sequence = 0
       *
       * A production streaming implementation could use:
       *
       * sequence 0
       * sequence 1
       * sequence 2
       * ...
       */
      const { data: chunk, error: chunkError } = await supabase
        .from("workout_chunks")
        .insert({
          workout_id: createdWorkout.id,

          sequence: 0,

          /**
           * Store a pre-computed count to avoid repeatedly
           * traversing a large JSON structure just to obtain
           * usage statistics.
           */
          sample_count: expectedSampleCount,

          /**
           * The raw sensor payload is stored as JSONB.
           */
          sensor_data: {
            dat0: workout.dat0,
            dat1: workout.dat1,
            dat2: workout.dat2,
          },
        })
        .select()
        .single();

      expect(chunkError).toBeNull();
      expect(chunk).not.toBeNull();

      expect(chunk?.sequence).toBe(0);

      expect(chunk?.sample_count).toBe(expectedSampleCount);

      // ------------------------------------------------------
      // Read the workout back
      // ------------------------------------------------------

      /**
       * This validates one of the assignment's important
       * requirements:
       *
       * A user should be able to store workout data and later
       * retrieve the same data, including from another device
       * after authenticating with the same account.
       */
      const { data: storedWorkout, error: readWorkoutError } = await supabase
        .from("workouts")
        .select("*")
        /**
         * Use the database UUID rather than the original
         * workout.id because source_workout_id does not have
         * to be globally unique.
         */
        .eq("id", createdWorkout.id)
        .single();

      expect(readWorkoutError).toBeNull();

      /**
       * Verify important metadata survived the database
       * write/read cycle.
       */
      expect(storedWorkout?.source_workout_id).toBe(workout.id);

      expect(storedWorkout?.final_score).toBe(workout.finalScore);

      expect(storedWorkout?.active_bands).toEqual(workout.activeBands);

      // ------------------------------------------------------
      // Read sensor chunks back
      // ------------------------------------------------------

      const { data: storedChunks, error: readChunksError } = await supabase
        .from("workout_chunks")
        .select("id, workout_id, sequence, sample_count, sensor_data")
        .eq("workout_id", createdWorkout.id)

        /**
         * Chunks must be read in sequence order.
         *
         * Current sample workouts only contain one chunk,
         * so sequence is currently always 0.
         *
         * This ordering becomes important if production
         * ingestion is later changed to upload multiple chunks.
         */
        .order("sequence", {
          ascending: true,
        });

      expect(readChunksError).toBeNull();

      expect(storedChunks).not.toBeNull();

      /**
       * Current assignment implementation stores one
       * supplied JSON file as one chunk.
       */
      expect(storedChunks?.length).toBe(1);

      /**
       * Sum sample_count across all chunks.
       *
       * Although there is currently only one chunk,
       * this code also works if the workout is later
       * divided into multiple chunks.
       */
      const storedSampleCount =
        storedChunks?.reduce((sum, item) => sum + item.sample_count, 0) ?? 0;

      /**
       * Verify that the count calculated from the original
       * JSON matches the count stored in PostgreSQL.
       */
      expect(storedSampleCount).toBe(expectedSampleCount);

      // Current first/only chunk.
      expect(storedChunks?.[0].sequence).toBe(0);

      /**
       * Confirm that the actual raw sensor JSON was also
       * retrieved from the database.
       */
      expect(storedChunks?.[0].sensor_data).toBeDefined();
    },

    /**
     * Vitest's default test timeout is 5 seconds.
     *
     * sample_workout.json contains significantly more sensor
     * data, so uploading JSONB to a remote Supabase project
     * and reading it back can take longer than 5 seconds.
     *
     * Give each sample integration test up to 15 seconds.
     */
    15000,
  );

  // ==========================================================
  // Partial / In-progress Workout
  // ==========================================================

  /**
   * Tests whether the schema correctly supports a workout
   * that has started but has not finished.
   *
   * The supplied partial workout has:
   *
   * finalScore = null
   * end = null
   *
   * Those values are valid and must remain null after being
   * stored in PostgreSQL.
   */
  it("preserves an unfinished workout with null score and end time", async () => {
    const user = await login(USER_A.email, USER_A.password);

    const workout = loadWorkout("sample_workout_partial.json");

    const { data, error } = await supabase
      .from("workouts")
      .insert({
        user_id: user.id,

        source_workout_id: workout.id,

        final_score: workout.finalScore,

        started_at: workout.date,

        ended_at: workout.end,

        active_bands: workout.activeBands,
      })
      .select()
      .single();

    expect(error).toBeNull();

    /**
     * Verify that the database did not incorrectly convert
     * an unfinished workout into a completed workout.
     */
    expect(data?.final_score).toBeNull();

    expect(data?.ended_at).toBeNull();
  });

  // ==========================================================
  // Usage Statistics RPC
  // ==========================================================

  /**
   * Verify RPC authorization.
   *
   * get_usage_statistics() aggregates data across users,
   * therefore direct execution is intentionally not available
   * to anonymous callers.
   */
  it("blocks anonymous users from calling usage statistics", async () => {
    // Explicitly guarantee no active user session.
    await signOut();

    const { data, error } = await supabase.rpc("get_usage_statistics");

    /**
     * Anonymous caller should receive no statistics.
     */
    expect(data).toBeNull();

    /**
     * RPC permission should reject the operation.
     */
    expect(error).not.toBeNull();
  });

  /**
   * Verify that an authenticated user is allowed to execute
   * the statistics RPC.
   */
  it("allows authenticated users to retrieve usage statistics", async () => {
    await login(USER_A.email, USER_A.password);

    const { data, error } = await supabase.rpc("get_usage_statistics");

    expect(error).toBeNull();
    expect(data).not.toBeNull();

    /**
     * Supabase RPC data is initially typed generically.
     *
     * Define the JSON object structure expected from our
     * get_usage_statistics() PostgreSQL function.
     */
    const statistics = data as {
      unique_users: number;
      total_samples: number;
      total_workouts: number;
      completed_workouts: number;

      average_final_score: number | null;

      average_duration_minutes: number | null;
    };

    /**
     * Verify that every expected statistics field exists.
     *
     * We do NOT assert exact values because these integration
     * tests insert additional workouts every time they run.
     *
     * Therefore values such as total_workouts change over time.
     */
    expect(statistics).toHaveProperty("unique_users");

    expect(statistics).toHaveProperty("total_samples");

    expect(statistics).toHaveProperty("total_workouts");

    expect(statistics).toHaveProperty("completed_workouts");

    expect(statistics).toHaveProperty("average_final_score");

    expect(statistics).toHaveProperty("average_duration_minutes");

    /**
     * There should be at least one user with workout data.
     */
    expect(statistics.unique_users).toBeGreaterThan(0);

    /**
     * At least one workout should exist because the tests
     * above have inserted workouts.
     */
    expect(statistics.total_workouts).toBeGreaterThan(0);

    /**
     * Sample count cannot be negative.
     */
    expect(statistics.total_samples).toBeGreaterThanOrEqual(0);
  });
});
