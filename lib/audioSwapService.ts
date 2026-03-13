import prisma from "@/lib/prisma";
import { cfg } from "@/lib/config";
import { uploadPublicObject } from "@/lib/s3Service";

type AudioSwapArgs = {
  projectId: string;
  storyboardId: string;
  scriptId: string;
  mergedVideoUrl: string;
  elevenLabsVoiceId?: string | null;
  runId?: string | null;
};

type AudioSwapResult = {
  outputAudioUrl: string;
  provider: "elevenlabs";
};

export async function runAudioSwapForScript(args: AudioSwapArgs): Promise<AudioSwapResult> {
  const apiKey = String(cfg.raw("ELEVENLABS_API_KEY") ?? "").trim();
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured");
  const modelId = String(cfg.raw("ELEVENLABS_STS_MODEL") ?? "eleven_english_sts_v2").trim();
  const outputFormat = String(cfg.raw("ELEVENLABS_OUTPUT_FORMAT") ?? "mp3_44100_128").trim();

  const voiceId =
    String(args.elevenLabsVoiceId ?? "").trim() ||
    String(cfg.raw("ELEVENLABS_VOICE_ID") ?? "").trim();
  if (!voiceId) throw new Error("No ElevenLabs voice ID — character voice profile not yet created");

  let mergedVideoUrl = String(args.mergedVideoUrl ?? "").trim();
  if (!mergedVideoUrl) {
    const script = await prisma.script.findUnique({
      where: { id: args.scriptId },
      select: { mergedVideoUrl: true },
    });
    mergedVideoUrl = String(script?.mergedVideoUrl ?? "").trim();
  }
  if (!mergedVideoUrl) throw new Error("Script has no mergedVideoUrl to swap audio");

  // TODO(medium): this downloads the full merged asset into memory before forwarding it to ElevenLabs.
  // Download the source audio payload from merged video URL.
  const audioRes = await fetch(mergedVideoUrl);
  if (!audioRes.ok) throw new Error(`Failed to fetch source audio: ${audioRes.status}`);
  const audioBlob = await audioRes.blob();

  // Call ElevenLabs Speech-to-Speech.
  const formData = new FormData();
  formData.append("audio", audioBlob, "source.mp3");
  formData.append("model_id", modelId);
  formData.append("remove_background_noise", "true");

  const elevenRes = await fetch(
    `https://api.elevenlabs.io/v1/speech-to-speech/${voiceId}?output_format=${encodeURIComponent(outputFormat)}`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: formData,
    },
  );

  if (!elevenRes.ok) {
    const err = await elevenRes.text();
    throw new Error(`ElevenLabs STS failed (${elevenRes.status}): ${err}`);
  }

  const audioBuffer = await elevenRes.arrayBuffer();
  const outputAudioUrl = await uploadAudioToStorage(args.scriptId, audioBuffer);

  await prisma.script.update({
    where: { id: args.scriptId },
    data: {
      // TODO(medium): store swapped-audio outputs in a dedicated field once the schema can distinguish audio artifacts from upscaled video assets.
      upscaledVideoUrl: outputAudioUrl,
      status: "upscaled",
      upscaleError: null,
    },
  });

  return { outputAudioUrl, provider: "elevenlabs" };
}

async function uploadAudioToStorage(scriptId: string, buffer: ArrayBuffer): Promise<string> {
  const key = ["scripts", scriptId, "audio-swap", `v${Date.now()}.mp3`].join("/");
  const uploaded = await uploadPublicObject({
    key,
    body: new Uint8Array(buffer),
    contentType: "audio/mpeg",
    cacheControl: "public,max-age=31536000,immutable",
  });
  if (!uploaded) {
    throw new Error("Failed to upload swapped audio. Check S3 bucket configuration.");
  }
  return uploaded;
}
