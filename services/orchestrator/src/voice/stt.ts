/**
 * Speech-to-text, provider-switchable via VOICE_STT (README §4).
 * "deepgram" — nova-3 prerecorded endpoint (primary).
 * "whisper"  — OpenAI whisper-1 (fallback).
 * "none"     — text-only mode; /voice reports voice disabled.
 */

const STT_PROVIDER = (process.env.VOICE_STT ?? "none") as
  | "deepgram"
  | "whisper"
  | "none";

export function sttEnabled(): boolean {
  return STT_PROVIDER !== "none";
}

export interface Transcription {
  text: string;
  /** 0..1 where the provider reports it; undefined otherwise */
  confidence?: number;
}

export async function transcribe(
  audio: Buffer,
  mime = "audio/webm",
): Promise<Transcription> {
  switch (STT_PROVIDER) {
    case "deepgram":
      return transcribeDeepgram(audio, mime);
    case "whisper":
      return transcribeWhisper(audio, mime);
    case "none":
      throw new Error("VOICE_STT=none — voice input disabled");
  }
}

async function transcribeDeepgram(
  audio: Buffer,
  mime: string,
): Promise<Transcription> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY missing");
  const res = await fetch(
    "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true",
    {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Token ${key}`, "Content-Type": mime },
      body: new Uint8Array(audio),
    },
  );
  if (!res.ok) throw new Error(`deepgram ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    results?: {
      channels?: {
        alternatives?: { transcript?: string; confidence?: number }[];
      }[];
    };
  };
  const alt = json.results?.channels?.[0]?.alternatives?.[0];
  return { text: alt?.transcript ?? "", confidence: alt?.confidence };
}

async function transcribeWhisper(
  audio: Buffer,
  mime: string,
): Promise<Transcription> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY missing");
  const form = new FormData();
  const ext = mime.includes("webm") ? "webm" : mime.includes("ogg") ? "ogg" : "wav";
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `audio.${ext}`);
  form.append("model", "whisper-1");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
      signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) throw new Error(`whisper ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { text?: string };
  return { text: json.text ?? "" };
}
