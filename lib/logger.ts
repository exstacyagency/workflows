import { prisma } from '@/lib/prisma';

export type AuditAction =
  | 'auth.register'
  | 'project.create'
  | 'job.create'
  | 'job.error'
  | 'project.error'
  | 'auth.error';

interface LogAuditParams {
  userId?: string | null;
  projectId?: string | null;
  jobId?: string | null;
  action: AuditAction | string;
  metadata?: Record<string, any>;
  ip?: string | null;
}

export async function logAudit(params: LogAuditParams): Promise<void> {
  const { userId, projectId, jobId, action, metadata, ip } = params;
  try {
    await prisma.auditLog.create({
      data: {
        userId: userId ?? undefined,
        projectId: projectId ?? undefined,
        jobId: jobId ?? undefined,
        action,
        metadata: metadata ?? undefined,
        ip: ip ?? undefined,
      },
    });
  } catch (error) {
    console.error('Failed to write audit log', error);
  }
}

export function log(event: string, data: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...data,
    })
  );
}

export function logError(event: string, err: unknown, data: Record<string, unknown> = {}) {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      event,
      error: e.message,
      stack: e.stack,
      ...data,
    })
  );
}
