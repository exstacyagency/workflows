import { NextResponse } from 'next/server';
import { createTestUser } from '@/lib/testStore';
import { cfg } from '@/lib/config';

export async function POST() {
  if (cfg.nodeEnv === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }

  const { id, email, token } = await createTestUser();
  // TODO(medium): keep this helper scoped to local/test runs; it returns a live test-session token to the caller.
  
  return NextResponse.json({ 
    userId: id, 
    email, 
    token 
  });
}
