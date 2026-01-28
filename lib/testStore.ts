// lib/testStore.ts
import { db } from '@/lib/db';
import { randomBytes } from 'crypto';

export const testSessions = new Map<string, { 
  userId: string; 
  expiresAt: Date;
  email: string;
}>();

let userCounter = 0;

export async function createTestUser(): Promise<{ id: string; email: string; token: string }> {
  const timestamp = Date.now();
  const random = randomBytes(6).toString('hex');
  const id = `test_${timestamp}_${random}`;
  const email = `test_${timestamp}_${random}@test.local`;
  const token = `tok_${randomBytes(16).toString('hex')}`;
  
  await db.user.create({
    data: {
      id,
      email,
      name: `Test User ${++userCounter}`,
    },
  });
  
  testSessions.set(token, {
    userId: id,
    email,
    expiresAt: new Date(Date.now() + 3600000),
  });
  
  return { id, email, token };
}

export function getTestSession(token: string) {
  const session = testSessions.get(token);
  if (!session || session.expiresAt < new Date()) return null;
  return session;
}

export async function clearTestData() {
  const sessions = Array.from(testSessions.values());
  if (sessions.length > 0) {
    await db.user.deleteMany({
      where: {
        id: { in: sessions.map(s => s.userId) }
      }
    });
  }
  
  testSessions.clear();
  userCounter = 0;
}