import { z } from 'zod';

export const ProjectJobSchema = z.object({
  projectId: z
    .string()
    .min(1, 'projectId is required')
    .max(128, 'projectId too long'),
});

export const StoryboardJobSchema = z.object({
  storyboardId: z
    .string()
    .min(1, 'storyboardId is required')
    .max(128, 'storyboardId too long'),
});

export async function parseJson<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
): Promise<
  | { success: true; data: z.infer<T> }
  | { success: false; error: string; details?: unknown }
> {
  try {
    const body = await req.json();
    const result = schema.safeParse(body);
    if (!result.success) {
      return {
        success: false,
        error: 'Invalid request body',
        details: result.error.flatten(),
      };
    }
    return { success: true, data: result.data };
  } catch (err) {
    return {
      success: false,
      error: 'Invalid JSON payload',
    };
  }
}
