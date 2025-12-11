// lib/validation/projects.ts
import { z } from 'zod';

export const CreateProjectSchema = z.object({
  name: z
    .string()
    .min(1, 'Project name is required')
    .max(200, 'Project name is too long'),
  description: z
    .string()
    .max(2000, 'Description is too long')
    .optional()
    .nullable(),
});

export const CustomerAvatarActionSchema = z.object({
  action: z.enum(['archive', 'restore']),
});

export const ProductIntelligenceActionSchema = z.object({
  action: z.enum(['archive', 'restore']),
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
    return { success: false, error: 'Invalid JSON payload' };
  }
}
