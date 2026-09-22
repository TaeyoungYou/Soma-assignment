import { signIn } from "../utils/signIn";
import { signOut } from "../utils/signOut";
import { signUp } from "../utils/signUp";

export async function testAuth() {
  const email = "arnold.4778@gmail.com";
  const password = "test1234";

  console.log("=== SIGN UP ===");

  const { data: signUpResult, error: signUpError } = await signUp(
    email,
    password,
  );

  if (signUpError) {
    console.error("Sign Up Error: ", signUpError.message);
    return;
  }
  console.log("Success Sign Up");
  console.log("Sign Up User: ", signUpResult.user);
  console.log("Sign Up Session: ", signUpResult.session);

  console.log("=== SIGN IN ===");
  const { data: signInResult, error: signInError } = await signIn(
    email,
    password,
  );

  if (signInError) {
    console.error("Sign In Error: ", signInError.message);
    return;
  }
  console.log("Success Sign In");
  console.log("Sign In User: ", signInResult.user);
  console.log("Sign In Session: ", signInResult.session);

  console.log("=== SIGN OUT ===");
  const { error: signOutError } = await signOut();

  if (signOutError) console.error("Sign Out Error: ", signOutError.message);
  else console.log("Success Sign Out");
}

testAuth().catch(console.error);
