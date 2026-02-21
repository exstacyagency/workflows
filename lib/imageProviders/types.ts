export type ImageProviderId =
  | "kie:nano-banana-pro"
  | "kie:seedream-4.5-edit";

export type CreateVideoImagesInput = {
  storyboardId: string;
  idempotencyKey: string;
  force?: boolean;

  // what your system already has / can pass:
  prompts: Array<{
    frameIndex: number;
    prompt: string;
    negativePrompt?: string;
    inputImageUrl?: string | null; // optional init image
    previousSceneLastFrameImageUrl?: string | null; // optional continuity reference
    maskImageUrl?: string | null;  // optional mask
    width?: number;
    height?: number;
  }>;

  // optional model options
  options?: Record<string, unknown>;
};

export type CreateVideoImagesOutput = {
  taskId: string;
  raw: unknown;
  httpStatus?: number;
  responseText?: string;
};

export type GetTaskOutput = {
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  // per-frame results (you can expand)
  images?: Array<{ frameIndex: number; url: string }>;
  errorMessage?: string;
  raw: unknown;
  httpStatus?: number;
  responseText?: string;
};

export interface VideoImageProvider {
  id: ImageProviderId;
  createTask(input: CreateVideoImagesInput): Promise<CreateVideoImagesOutput>;
  getTask(taskId: string): Promise<GetTaskOutput>;
}
