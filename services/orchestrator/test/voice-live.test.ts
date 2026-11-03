import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { fluxUrl, openFlux, type FluxSocket } from "../src/voice/flux.js";
import { speakChunks, speakable } from "../src/voice/tts.js";
import { statusLine } from "../src/voice/route.js";

class FakeDeepgram extends EventEmitter {
  readyState = 0;
  sent: (Buffer | string)[] = [];
  closed = false;
  send(data: Buffer | string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.readyState = 1;
    this.emit("open");
  }
  turn(event: string, transcript: string) {
    this.emit("message", Buffer.from(JSON.stringify({ type: "TurnInfo", event, transcript })), false);
  }
}

const listen = () => {
  const socket = new FakeDeepgram();
  const log: string[] = [];
  let url = "";
  let key = "";
  const stream = openFlux("dg-key", {
    onStart: () => log.push("start"),
    onPartial: (text) => log.push(`partial:${text}`),
    onEndOfTurn: (text) => log.push(`end:${text}`),
    onError: (message) => log.push(`error:${message}`),
    onClose: () => log.push("close"),
  }, (u, k) => {
    url = u;
    key = k;
    return socket as unknown as FluxSocket;
  });
  return { socket, log, stream, url: () => url, key: () => key };
};

test("fluxUrl asks for 16 kHz linear16 from the Flux English model", () => {
  const url = new URL(fluxUrl());
  assert.equal(url.origin + url.pathname, "wss://api.deepgram.com/v2/listen");
  assert.equal(url.searchParams.get("model"), "flux-general-en");
  assert.equal(url.searchParams.get("encoding"), "linear16");
  assert.equal(url.searchParams.get("sample_rate"), "16000");
});

test("audio sent before Deepgram connects is held, then forwarded in order", () => {
  const { socket, stream, url, key } = listen();
  assert.match(url(), /v2\/listen/);
  assert.equal(key(), "dg-key");
  stream.send(Buffer.from([1]));
  stream.send(Buffer.from([2]));
  assert.equal(socket.sent.length, 0);
  socket.open();
  stream.send(Buffer.from([3]));
  assert.deepEqual(socket.sent.map((b) => (b as Buffer)[0]), [1, 2, 3]);
});

test("turn events become start, live captions and one final transcript", () => {
  const { socket, log } = listen();
  socket.open();
  socket.turn("StartOfTurn", "Find");
  socket.turn("Update", "Find flights to");
  socket.turn("EagerEndOfTurn", "Find flights to Denver");
  socket.turn("TurnResumed", "Find flights to Denver in May");
  socket.turn("EndOfTurn", " Find flights to Denver in May ");
  socket.emit("message", Buffer.from("not json"), false);
  socket.emit("message", Buffer.from(JSON.stringify({ type: "Error", description: "bad audio" })), false);
  assert.deepEqual(log, [
    "start",
    "partial:Find",
    "partial:Find flights to",
    "partial:Find flights to Denver",
    "partial:Find flights to Denver in May",
    "end:Find flights to Denver in May",
    "error:bad audio",
  ]);
});

test("closing asks Flux to finish, and nothing is sent after", () => {
  const { socket, stream, log } = listen();
  socket.open();
  stream.close();
  assert.deepEqual(JSON.parse(socket.sent.at(-1) as string), { type: "CloseStream" });
  const before = socket.sent.length;
  stream.send(Buffer.from([9]));
  assert.equal(socket.sent.length, before);
  socket.emit("close");
  assert.deepEqual(log, ["close"]);
});

test("speakable drops markdown and links; speakChunks splits at sentences", () => {
  assert.equal(speakable("**Top pick:** see https://example.com/x now."), "Top pick: see the link now.");
  const text = "One. Two is longer! Three? ".repeat(3).trim();
  const chunks = speakChunks(text, 30);
  assert.ok(chunks.every((c) => c.length <= 30), JSON.stringify(chunks));
  assert.equal(chunks.join(" "), text);
});

test("statusLine names each specialist once, in plain words", () => {
  assert.equal(statusLine(["flight-agent"]), "One moment, I'm checking flights.");
  assert.equal(
    statusLine(["flight-agent", "hotel-agent", "flight-agent", "itinerary-agent"]),
    "One moment, I'm checking flights, places to stay and an itinerary.",
  );
  assert.equal(statusLine(["unknown-agent"]), null);
});
