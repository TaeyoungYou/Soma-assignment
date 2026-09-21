import { supabase } from "../lib/supabase";

async function connection() {
  const { data, error } = await supabase.auth.getSession();

  console.log("session:", data.session);
  console.log("error:", error);
}

connection();
