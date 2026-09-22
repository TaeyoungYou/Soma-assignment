import { supabase } from "../lib/supabase";

export async function signOut() {
  const { error } = await supabase.auth.signOut();

  return { error };
}
