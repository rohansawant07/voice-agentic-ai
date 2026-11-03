import WebSocket from "ws";

/**
 * Text-to-speech, provider-switchable via VOICE_TTS (README §4).
 * Returns a chunked byte stream to /voice. "deepgram" streams raw PCM that the
 * browser plays as it arrives; the mp3 providers are buffered until tts_end.
 */

const TTS_PROVIDER = (process.env.VOICE_TTS ?? "none") as
  | "deepgram"
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
    case "deepgram":
      return synthesizeDeepgram(text);
    case "openai":
      return synthesizeOpenAI(text);
    case "elevenlabs":
      return synthesizeElevenLabs(text);
    case "none":
      return null;
  }
}

export const DEEPGRAM_TTS_RATE = 24_000;
/** Aura rejects a Speak message over 2,000 characters. */
const SPEAK_LIMIT = 1_500;

/** Text as it should be read aloud: no markdown marks, no raw links. */
export function speakable(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "the link")
    .replace(/[*_#`>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sentence-sized pieces no longer than the Speak limit. */
export function speakChunks(text: string, limit = SPEAK_LIMIT): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const sentence of text.match(/[^.!?]+[.!?]*\s*/g) ?? []) {
    if (current && (current + sentence).length > limit) {
      chunks.push(current.trim());
      current = "";
    }
    current += sentence.length > limit ? sentence.slice(0, limit) : sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/** Aura-2 over its streaming socket: audio starts while later sentences render. */
async function synthesizeDeepgram(text: string): Promise<TtsStream> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY missing");
  const url = new URL("wss://api.deepgram.com/v1/speak");
  url.searchParams.set("model", process.env.DEEPGRAM_TTS_MODEL ?? "aura-2-thalia-en");
  url.searchParams.set("encoding", "linear16");
  url.searchParams.set("sample_rate", String(DEEPGRAM_TTS_RATE));
  const socket = new WebSocket(url, { headers: { Authorization: `Token ${key}` } });
  const chunks = speakChunks(speakable(text));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const timer = setTimeout(() => socket.close(), 60_000);
      socket.on("open", () => {
        for (const chunk of chunks) socket.send(JSON.stringify({ type: "Speak", text: chunk }));
        socket.send(JSON.stringify({ type: "Flush" }));
      });
      socket.on("message", (data: Buffer, isBinary: boolean) => {
        if (isBinary) {
          controller.enqueue(new Uint8Array(data));
          return;
        }
        const msg = JSON.parse(data.toString()) as { type?: string };
        if (msg.type === "Flushed") socket.close();
      });
      socket.on("error", (err) => controller.error(err));
      socket.on("close", () => {
        clearTimeout(timer);
        try {
          controller.close();
        } catch {
          // already errored or cancelled
        }
      });
    },
    cancel() {
      socket.close();
    },
  });
  return { mime: `audio/pcm;rate=${DEEPGRAM_TTS_RATE}`, stream };
}

async function synthesizeOpenAI(text: string): Promise<TtsStream> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY missing");
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
      signal: AbortSignal.timeout(30000),
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
      signal: AbortSignal.timeout(30000),
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
