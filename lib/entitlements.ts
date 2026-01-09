/**
 * SINGLE SOURCE OF TRUTH FOR TIER ENFORCEMENT
 *
 * All API routes, workers, background jobs, and billing logic
 * MUST call `checkEntitlement` before performing protected actions.
 *
 * This file:
 * - Has NO side effects
 * - Does NO I/O
 * - Does NOT depend on environment variables
 * - Is safe to import anywhere
 */

export type EntitlementAction =
  | "campaign:create"
  | "campaign:activate"
  | "job:enqueue"
  | "analytics:read"
  | "spend:apply";

export type UserRole = "owner" | "admin" | "member";
export type AccountTier = "free" | "pro" | "enterprise";

export type User = {
  id: string;
  role: UserRole;
};

export type AccountUsage = {
  activeCampaigns: number;
  monthlySpend: number;
};

export type Account = {
  id: string;
  tier: AccountTier;
  usage: AccountUsage;
};

export type EntitlementResult = {
  allowed: boolean;
  reason?: string;
  limits?: Record<string, number>;
};

/**
 * Entry point for all entitlement checks.
 */
export function checkEntitlement(input: {
  user: User;
  account: Account;
  action: EntitlementAction;
}): EntitlementResult {
  const { account, action } = input;

  // Enterprise tier is unrestricted by default
  if (account.tier === "enterprise") {
    return { allowed: true };
  }

  switch (account.tier) {
    case "free":
      return checkFreeTier(account, action);

    case "pro":
      return checkProTier(account, action);

    default:
      return {
        allowed: false,
        reason: "Unknown account tier",
      };
  }
}

/* -------------------------------------------------------------------------- */
/*                              TIER POLICIES                                 */
/* -------------------------------------------------------------------------- */

function checkFreeTier(
  account: Account,
  action: EntitlementAction
): EntitlementResult {
  switch (action) {
    case "campaign:create":
      if (account.usage.activeCampaigns >= 1) {
        return deny(
          "Free tier allows only 1 active campaign",
          { activeCampaigns: 1 }
        );
      }
      return allow({ activeCampaigns: 1 });

    case "campaign:activate":
      return allow();

    case "job:enqueue":
      return deny("Background jobs are not available on free tier");

    case "analytics:read":
      return deny("Analytics are not available on free tier");

    case "spend:apply":
      if (account.usage.monthlySpend >= 50) {
        return deny(
          "Monthly spend limit reached for free tier",
          { monthlySpend: 50 }
        );
      }
      return allow({ monthlySpend: 50 });

    default:
      return deny("Action not permitted on free tier");
  }
}

function checkProTier(
  account: Account,
  action: EntitlementAction
): EntitlementResult {
  switch (action) {
    case "campaign:create":
      if (account.usage.activeCampaigns >= 10) {
        return deny(
          "Pro tier allows up to 10 active campaigns",
          { activeCampaigns: 10 }
        );
      }
      return allow({ activeCampaigns: 10 });

    case "campaign:activate":
      return allow();

    case "job:enqueue":
      return allow();

    case "analytics:read":
      return allow();

    case "spend:apply":
      if (account.usage.monthlySpend >= 1000) {
        return deny(
          "Monthly spend limit reached for pro tier",
          { monthlySpend: 1000 }
        );
      }
      return allow({ monthlySpend: 1000 });

    default:
      return deny("Action not permitted on pro tier");
  }
}

/* -------------------------------------------------------------------------- */
/*                               HELPERS                                      */
/* -------------------------------------------------------------------------- */

function allow(limits?: Record<string, number>): EntitlementResult {
  return limits
    ? { allowed: true, limits }
    : { allowed: true };
}

function deny(
  reason: string,
  limits?: Record<string, number>
): EntitlementResult {
  return limits
    ? { allowed: false, reason, limits }
    : { allowed: false, reason };
}