/**
 * why: this file speaks a wire format it does not own: `WS /v1/leases/<id>/input` carries expo
 * serve-sim's messages, one tag byte and then UTF-8 JSON, as the daemon's `src/core/input.ts` reads
 * and writes them. The console sends keys and buttons only, and reads only that input was admitted
 * and what the device says it cannot take.
 */
const TAG = { admitted: 0x83, button: 0x04, config: 0x82, key: 0x06 } as const;

// why: a browser's WebSocket cannot set `Authorization`, so the token goes as the subprotocol
// `simlock.bearer.<token>`, beside `simlock`, which the daemon answers; the daemon reads the token
// only on an upgrade and never sends it back. Kept in step with `src/ports/lease-socket.ts`.
const PROTOCOL = "simlock";
const BEARER_PREFIX = "simlock.bearer.";

function frame(tag: number, body: unknown): Uint8Array<ArrayBuffer> {
  const json = new TextEncoder().encode(JSON.stringify(body));
  const out = new Uint8Array(json.length + 1);
  out[0] = tag;
  out.set(json, 1);
  return out;
}

export function encodeKey(type: "down" | "up", usage: number): Uint8Array<ArrayBuffer> {
  return frame(TAG.key, { type, usage });
}

export function encodeButton(button: "back" | "home" | "lock"): Uint8Array<ArrayBuffer> {
  return frame(TAG.button, { button });
}

export type ServerMessage =
  | { readonly kind: "admitted" }
  | {
      readonly kind: "config";
      readonly inputUnavailable: boolean;
      readonly keyboardUnavailable: boolean;
    }
  | { readonly kind: "other" };

// why: a message this console cannot read is skipped rather than ending input: the daemon may say
// more than this console knows.
export function parseServerMessage(bytes: Uint8Array): ServerMessage {
  if (bytes[0] === TAG.admitted) return { kind: "admitted" };
  if (bytes[0] !== TAG.config) return { kind: "other" };
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes.subarray(1))) as Record<string, unknown>;
    return {
      inputUnavailable: body["inputUnavailable"] === true,
      keyboardUnavailable: body["keyboardUnavailable"] === true,
      kind: "config",
    };
  } catch {
    return { kind: "other" };
  }
}

export function inputSocketUrl(
  location: { readonly host: string; readonly protocol: string },
  leaseId: string,
): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/v1/leases/${encodeURIComponent(leaseId)}/input`;
}

// why: a proxy session has no token; its proxy signs the upgrade as it signs every request.
export function inputProtocols(token: string | undefined): readonly string[] {
  return token === undefined ? [PROTOCOL] : [PROTOCOL, `${BEARER_PREFIX}${token}`];
}

export interface InputSocket {
  send(bytes: Uint8Array<ArrayBuffer>): void;
  close(): void;
}

export interface InputSocketEvents {
  message(bytes: Uint8Array): void;
  // why: a socket the daemon refused before the upgrade closes as 1006 with no status: a browser
  // tells a page nothing more.
  close(code: number, reason: string): void;
}

export type OpenInputSocket = (
  url: string,
  protocols: readonly string[],
  events: InputSocketEvents,
) => InputSocket;

export const openBrowserInputSocket: OpenInputSocket = (url, protocols, events) => {
  const socket = new WebSocket(url, [...protocols]);
  socket.binaryType = "arraybuffer";
  socket.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) events.message(new Uint8Array(event.data));
  };
  socket.onclose = (event) => events.close(event.code, event.reason);
  return {
    close: () => socket.close(),
    send: (bytes) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(bytes);
    },
  };
};
