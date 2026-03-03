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

  const voiceDescription =
    args.creatorVisualPrompt.slice(0, 1000) ||
    `A clear, natural voice for ${args.characterName}`;

  const designRes = await fetch("https://api.elevenlabs.io/v1/text-to-voice/design", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      voice_description: voiceDescription,
      model_id: "eleven_multilingual_ttv_v2",
      auto_generate_text: true,
    }),
  });
  if (!designRes.ok) {
    const errText = await designRes.text().catch(() => "(unreadable)");
    throw new Error(`ElevenLabs voice design failed (${designRes.status}): ${errText}`);
  }

  const designJson = (await designRes.json()) as {
    previews?: { generated_voice_id: string }[];
  };
  const generatedVoiceId = designJson.previews?.[0]?.generated_voice_id;
  if (!generatedVoiceId) {
    throw new Error("ElevenLabs voice design returned no previews");
  }

  const saveRes = await fetch("https://api.elevenlabs.io/v1/text-to-voice", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      voice_name: args.characterName,
      voice_description: voiceDescription,
      generated_voice_id: generatedVoiceId,
    }),
  });
  if (!saveRes.ok) {
    const errText = await saveRes.text().catch(() => "(unreadable)");
    throw new Error(`ElevenLabs voice save failed (${saveRes.status}): ${errText}`);
  }

  const saveJson = (await saveRes.json()) as { voice_id?: string };
  const voiceId = String(saveJson.voice_id ?? "").trim();
  if (!voiceId) {
    throw new Error("ElevenLabs voice save succeeded but returned no voice_id");
  }

  await prisma.character.update({
    where: { id: args.characterId },
    data: { elevenLabsVoiceId: voiceId },
  });

  return { voiceId };
}
