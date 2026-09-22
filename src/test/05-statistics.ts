import { supabase } from "../lib/supabase";
import { signIn } from "../utils/signIn";
import { signOut } from "../utils/signOut";

async function testStatistics() {
  console.log("=== Usage Statistics RPC Test ===\n");

  // ---------------------------------------------------------
  // 1. Test while logged out
  // ---------------------------------------------------------
  await signOut();

  const { data: anonData, error: anonError } = await supabase.rpc(
    "get_usage_statistics",
  );

  console.log("1. Anonymous user test");
  console.log("Data:", anonData);
  console.log("Error:", anonError?.message ?? null);

  if (!anonError) {
    console.error("Anonymous user should NOT be able to call the RPC.");
  } else {
    console.log("Anonymous user was blocked correctly.");
  }

  console.log("\n----------------------------------------\n");

  // ---------------------------------------------------------
  // 2. Sign in
  // ---------------------------------------------------------
  const { data: authData, error: authError } = await signIn(
    "arnold.4778@gmail.com",
    "test1234",
  );

  if (authError || !authData.user) {
    console.error("Sign in failed:", authError?.message);
    return;
  }

  console.log("2. Authenticated user");
  console.log("Logged in user:", authData.user.id);

  // ---------------------------------------------------------
  // 3. Call statistics RPC
  // ---------------------------------------------------------
  const { data: statistics, error: statisticsError } = await supabase.rpc(
    "get_usage_statistics",
  );

  if (statisticsError) {
    console.error("Statistics RPC failed:", statisticsError.message);
    await signOut();
    return;
  }

  console.log("\n3. Statistics RPC result");
  console.log(statistics);

  console.log("\nAuthenticated user can call the RPC.");

  // ---------------------------------------------------------
  // 4. Sign out
  // ---------------------------------------------------------
  await signOut();

  console.log("\nSigned out.");
}

testStatistics().catch(console.error);
