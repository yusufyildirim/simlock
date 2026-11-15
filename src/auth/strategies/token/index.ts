import { BEARER_PROTOCOL_PREFIX } from "../../../ports/index.js";
import type { AuthStrategyDefinition } from "../../strategy.js";

const BEARER_PREFIX = "Bearer ";
const TOKEN_PREFIX = "slk_";

const WORKER_TOKEN_REFUSAL = "A worker join token can only open an uplink, not call the HTTP API";

function bearerValue(header: string | null): string {
  if (header === null || !header.startsWith(BEARER_PREFIX)) return "";
  return header.slice(BEARER_PREFIX.length).trim();
}

// why: a browser cannot set `Authorization` on a WebSocket, so on an upgrade, and only there, the
// token may come as the subprotocol `simlock.bearer.<token>` (ADR 0077). `Authorization` still wins.
function upgradeProtocolValue(headers: Headers): string {
  if (headers.get("upgrade")?.toLowerCase() !== "websocket") return "";
  const offered = (headers.get("sec-websocket-protocol") ?? "")
    .split(",")
    .map((item) => item.trim());
  const item = offered.find((protocol) => protocol.startsWith(BEARER_PROTOCOL_PREFIX));
  return item === undefined ? "" : item.slice(BEARER_PROTOCOL_PREFIX.length);
}

export const tokenStrategy: AuthStrategyDefinition = {
  name: "token",
  enabled: () => true,
  create: (deps) => ({
    authenticate: async ({ headers }) => {
      const secret = bearerValue(headers.get("authorization")) || upgradeProtocolValue(headers);
      if (!secret.startsWith(TOKEN_PREFIX)) {
        return { kind: "not-mine", sawCredential: secret !== "" };
      }

      const record = await deps.tokens.verify(secret);
      if (record === undefined) return { kind: "rejected", message: "Unknown bearer token" };
      // why: 403, not 401 -- the token is real and recognized, it just has no authority here (ADR 0005 §25).
      if (record.role === "worker") return { kind: "forbidden", message: WORKER_TOKEN_REFUSAL };

      return {
        kind: "identified",
        identity: {
          principal: record.id,
          name: record.label ?? record.id,
          role: record.role,
          via: "token",
          ambient: false,
        },
      };
    },
  }),
};
