import { isDev } from "./auth.js";

// Authentication identifies the person; this identity selects the shared data.
// Reuse the existing owner's rows so no financial records need to be rewritten.
export async function familyDataUser(request, env, actor) {
  const email = env.FAMILY_DATA_OWNER_EMAIL?.trim().toLowerCase();
  if (!email) return actor;
  const { results } = await env.DB.prepare(
    "SELECT id,email,name FROM users WHERE lower(email)=? LIMIT 2",
  ).bind(email).all();
  if (results.length === 1) return results[0];
  // Local preview uses its own database, which normally has only the test user.
  if (!results.length && isDev(request, env)) return actor;
  throw new Error("FAMILY_DATA_OWNER_UNAVAILABLE");
}
