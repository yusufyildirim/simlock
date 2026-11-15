import { describe, expect, it } from "vitest";

import {
  encodeButton,
  encodeKey,
  inputProtocols,
  inputSocketUrl,
  parseServerMessage,
} from "./input";

function frame(tag: number, body?: unknown): Uint8Array {
  const json =
    body === undefined ? new Uint8Array(0) : new TextEncoder().encode(JSON.stringify(body));
  return new Uint8Array([tag, ...json]);
}

function read(bytes: Uint8Array): { tag: number | undefined; body: unknown } {
  return { body: JSON.parse(new TextDecoder().decode(bytes.subarray(1))), tag: bytes[0] };
}

describe("the input socket's messages", () => {
  it("writes a key as 0x06 and a button as 0x04, each a tag byte and UTF-8 JSON", () => {
    expect(read(encodeKey("down", 0x52))).toEqual({
      body: { type: "down", usage: 0x52 },
      tag: 0x06,
    });
    expect(read(encodeKey("up", 0x28))).toEqual({ body: { type: "up", usage: 0x28 }, tag: 0x06 });
    expect(read(encodeButton("back"))).toEqual({ body: { button: "back" }, tag: 0x04 });
  });

  it.each([
    { bytes: frame(0x83), message: { kind: "admitted" } },
    {
      bytes: frame(0x82, { height: 1080, orientation: "portrait", width: 1920 }),
      message: { inputUnavailable: false, keyboardUnavailable: false, kind: "config" },
    },
    {
      bytes: frame(0x82, { height: 1, inputUnavailable: true, width: 1 }),
      message: { inputUnavailable: true, keyboardUnavailable: false, kind: "config" },
    },
    {
      bytes: frame(0x82, { height: 2556, keyboardUnavailable: true, width: 1179 }),
      message: { inputUnavailable: false, keyboardUnavailable: true, kind: "config" },
    },
    { bytes: new Uint8Array([0x82, 0x7b]), message: { kind: "other" } },
    { bytes: frame(0x90, { ok: true }), message: { kind: "other" } },
    { bytes: new Uint8Array(0), message: { kind: "other" } },
  ])("reads $message.kind from tag $bytes.0", ({ bytes, message }) => {
    expect(parseServerMessage(bytes)).toEqual(message);
  });
});

describe("where the console opens a lease's input socket", () => {
  it("opens it on the page's own origin, wss under https", () => {
    expect(inputSocketUrl({ host: "100.65.91.119:4701", protocol: "http:" }, "gw.lse 1")).toBe(
      "ws://100.65.91.119:4701/v1/leases/gw.lse%201/input",
    );
    expect(inputSocketUrl({ host: "simlock.example", protocol: "https:" }, "lse_1")).toBe(
      "wss://simlock.example/v1/leases/lse_1/input",
    );
  });

  it("offers its token as simlock.bearer.<token> beside simlock, and only simlock without one", () => {
    expect(inputProtocols("slk_abc-_9")).toEqual(["simlock", "simlock.bearer.slk_abc-_9"]);
    expect(inputProtocols(undefined)).toEqual(["simlock"]);
  });
});
