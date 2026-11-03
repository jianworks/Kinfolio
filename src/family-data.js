import { isDev } from "./auth.js";

const holderByEmail = {
  "cc.chang@mrandmrsjian.com": "張佳琪",
  "quentin.jian@mrandmrsjian.com": "簡仲研",
  "blair.jian@mrandmrsjian.com": "簡仲晴",
};

export function familyAccess(request, env, actor, data) {
  if (!env.FAMILY_DATA_OWNER_EMAIL || isDev(request, env) ||
      actor.email.toLowerCase() === env.FAMILY_DATA_OWNER_EMAIL.trim().toLowerCase())
    return { allHolders: true, holderIds: data.holders.map(h => h.id) };
  const name = holderByEmail[actor.email.toLowerCase()];
  const matches = name ? data.holders.filter(h => h.name === name) : [];
  return { allHolders: false, holderIds: matches.length === 1 ? [matches[0].id] : [] };
}

export function scopeFamilyData(data, access) {
  if (access.allHolders) return data;
  const holders = data.holders.filter(h => access.holderIds.includes(h.id));
  const accounts = data.accounts.filter(a => access.holderIds.includes(a.holder_id));
  const accountIds = new Set(accounts.map(a => a.id));
  const loans = data.loans.filter(l => access.holderIds.includes(l.holder_id));
  const loanIds = new Set(loans.map(l => l.id));
  const completeTransfers = new Set(data.events.filter(e => e.transfer_id && accountIds.has(e.account_id))
    .filter(e => data.events.some(other => other.transfer_id === e.transfer_id &&
      other.kind !== e.kind && accountIds.has(other.account_id))).map(e => e.transfer_id));
  return {
    ...data, holders, accounts, loans,
    // Preserve own-account cash flows, but do not expose another holder's transfer endpoint.
    events: data.events.filter(e => accountIds.has(e.account_id)).map(e =>
      e.transfer_id && !completeTransfers.has(e.transfer_id) ? { ...e, transfer_id: null } : e),
    loan_balances: data.loan_balances.filter(r => loanIds.has(r.loan_id)),
    goals: data.goals.filter(g => access.holderIds.includes(g.holder_id)),
    ...Object.fromEntries(["portfolios", "holdings", "portfolio_snapshots", "portfolio_current"].map(table =>
      [table, data[table].filter(r => accountIds.has(r.account_id))])),
  };
}

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
