import { NextResponse } from 'next/server';
import { createTestUser } from '@/lib/testStore';
import { cfg } from '@/lib/config';

export async function POST() {
  if (cfg.nodeEnv === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }

  const { id, email, token } = await createTestUser();
  
  return NextResponse.json({ 
    userId: id, 
    email, 
    token 
  });
}