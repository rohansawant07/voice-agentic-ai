/**
 * Text-to-speech, provider-switchable via VOICE_TTS (README §4).
 * Returns a chunked byte stream so the /voice socket can start playback
 * before synthesis finishes (first-chunk latency budget: ≤500ms).
 */

const TTS_PROVIDER = (process.env.VOICE_TTS ?? "none") as
  | "openai"
  | "elevenlabs"
  | "none";

export function ttsEnabled(): boolean {
  return TTS_PROVIDER !== "none";
}

export interface TtsStream {
  mime: string;
  stream: ReadableStream<Uint8Array>;
}

export async function synthesize(text: string): Promise<TtsStream | null> {
  switch (TTS_PROVIDER) {
    case "openai":
      return synthesizeOpenAI(text);
    case "elevenlabs":
      return synthesizeElevenLabs(text);
    case "none":
      return null;
  }
}

async function synthesizeOpenAI(text: string): Promise<TtsStream> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY missing");
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts",
      voice: process.env.OPENAI_TTS_VOICE ?? "alloy",
      input: text,
      response_format: "mp3",
    }),
  });
  if (!res.ok || !res.body)
    throw new Error(`openai tts ${res.status}: ${await res.text()}`);
  return { mime: "audio/mpeg", stream: res.body };
}

async function synthesizeElevenLabs(text: string): Promise<TtsStream> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY missing");
  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM";
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        output_format: "mp3_44100_128",
      }),
    },
  );
  if (!res.ok || !res.body)
    throw new Error(`elevenlabs ${res.status}: ${await res.text()}`);
  return { mime: "audio/mpeg", stream: res.body };
}
