import type { JobCompletionPayload } from "@/lib/notifications/notifyAll";

type Controller = ReadableStreamDefaultController<Uint8Array>;

const subscribers = new Map<string, Set<Controller>>();

export function sseSubscribe(projectId: string, controller: Controller) {
  if (!subscribers.has(projectId)) {
    subscribers.set(projectId, new Set());
  }
  subscribers.get(projectId)!.add(controller);
}

export function sseUnsubscribe(projectId: string, controller: Controller) {
  const set = subscribers.get(projectId);
  if (!set) return;
  set.delete(controller);
  if (set.size === 0) {
    subscribers.delete(projectId);
  }
}

export async function ssePublish(projectId: string, payload: JobCompletionPayload) {
  const controllers = subscribers.get(projectId);
  if (!controllers || controllers.size === 0) return;

  const data = `data: ${JSON.stringify(payload)}\n\n`;
  const encoded = new TextEncoder().encode(data);

  for (const ctrl of controllers) {
    try {
      ctrl.enqueue(encoded);
    } catch {
      controllers.delete(ctrl);
    }
  }

  if (controllers.size === 0) {
    subscribers.delete(projectId);
  }
}
