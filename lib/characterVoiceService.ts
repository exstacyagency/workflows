import prisma from "@/lib/prisma";
import { cfg } from "@/lib/config";

export async function createCharacterVoiceProfile(args: {
  characterId: string;
  characterName: string;
  creatorVisualPrompt: string;
  seedVideoUrl: string;
}): Promise<{ voiceId: string }> {
  const apiKey = String(cfg.raw("ELEVENLABS_API_KEY") ?? "").trim();
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured");

  const baseVoiceId = String(cfg.raw("ELEVENLABS_BASE_VOICE_ID") ?? "JBFqnCBsd6RMkjVDRZzb").trim();
  const sampleText = `Hi, I'm ${args.characterName}. Let me tell you about something that changed my life.`;

  // Currently unused in this flow; reserved for future sample extraction from seed media.
  void args.seedVideoUrl;

  const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${baseVoiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: sampleText,
      model_id: "eleven_multilingual_v2",
    }),
  });
  if (!ttsRes.ok) throw new Error(`ElevenLabs TTS failed: ${await ttsRes.text()}`);
  const sampleAudioBuffer = await ttsRes.arrayBuffer();

  const formData = new FormData();
  formData.append("name", args.characterName);
  formData.append("description", args.creatorVisualPrompt.slice(0, 500));
  formData.append(
    "files",
    new Blob([sampleAudioBuffer], { type: "audio/mpeg" }),
    "sample.mp3",
  );

  const profileRes = await fetch("https://api.elevenlabs.io/v1/voices/add", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: formData,
  });
  if (!profileRes.ok) {
    throw new Error(`ElevenLabs voice profile creation failed: ${await profileRes.text()}`);
  }

  const json = (await profileRes.json()) as { voice_id?: string };
  const voiceId = String(json.voice_id ?? "").trim();
  if (!voiceId) {
    throw new Error("ElevenLabs voice profile creation succeeded but returned no voice_id");
  }

  await prisma.character.update({
    where: { id: args.characterId },
    data: { elevenLabsVoiceId: voiceId },
  });

  return { voiceId };
}

