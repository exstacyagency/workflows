import { cfg } from "@/lib/config";
import type { ImageProviderId, VideoImageProvider } from "./types";
import { KieImageProvider } from "./kieImage";

const providers = {
  "kie:nano-banana-2": new KieImageProvider({
    id: "kie:nano-banana-2",
    model: "nano-banana-2",
  }),
  "kie:nano-banana-pro": new KieImageProvider({
    id: "kie:nano-banana-pro",
    model: "nano-banana-pro",
  }),
  "kie:seedream-4.5-edit": new KieImageProvider({
    id: "kie:seedream-4.5-edit",
    model: "seedream-4.5-edit",
  }),
} satisfies Record<ImageProviderId, VideoImageProvider>;

export function getProvider(id?: string | null): VideoImageProvider {
  const envDefault = cfg.raw("VIDEO_IMAGE_PROVIDER_ID") as ImageProviderId | undefined;
  const chosen = (id ?? envDefault ?? "kie:nano-banana-2") as ImageProviderId;

  const p = providers[chosen];
  if (!p) {
    throw new Error(
      `Unknown VIDEO_IMAGE_PROVIDER_ID="${chosen}". Valid: ${Object.keys(providers).join(", ")}`
    );
  }
  return p;
}
