export type EntitlementAction =
  | 'campaign:create'
  | 'campaign:activate'
  | 'job:enqueue'
  | 'analytics:read';

export type EntitlementContext = {
  user: { id: string; role?: string };
  account: { id: string; tier: 'free' | 'paid' | 'admin' };
  action: EntitlementAction;
};

export function checkEntitlements(ctx: EntitlementContext) {
  if (ctx.account.tier === 'admin') {
    return { allowed: true };
  }

  if (ctx.account.tier === 'free') {
    if (ctx.action === 'campaign:create') {
      return {
        allowed: false,
        reason: 'Free tier cannot create campaigns',
      };
    }
  }

  return { allowed: true };
}