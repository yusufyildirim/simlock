# 0077. A browser sends its token on a lease socket as a subprotocol, and the console drives a leased device's buttons and a TV's remote

- **Status:** Accepted
- **Date:** 2026-11-15
- **Narrows:** [ADR 0011](0011-the-console-is-a-built-app-the-daemon-serves.md)
  §6 ("sends it only as `Authorization: Bearer`"): the console also sends
  its token as a WebSocket subprotocol, to the input socket of a lease on
  the same origin (§1 here). And
  [ADR 0049](0049-a-lease-holder-watches-and-drives-its-devices-screen.md)
  §1, for how a caller authenticates `WS /v1/leases/{id}/input`.
- **Evidence:** the input socket driven end to end on an Apple TV lease by
  a Node client over `Authorization: Bearer`; a browser's `WebSocket`
  constructor takes a URL and subprotocols only, and no headers
  ([WHATWG WebSockets](https://websockets.spec.whatwg.org/#the-websocket-interface)).

## Context

The input socket (ADR 0049) authenticates like every route: a bearer token
in `Authorization`, or a sign-in proxy's header. A Node client sets the
header. A browser cannot: `new WebSocket(url, protocols)` sends cookies but
no header the page chooses. The console signs in with an operator token
kept in `sessionStorage` (ADR 0011 §6), so it could stream a leased TV's
screen but never press its remote.

A proxy session needs nothing new: the browser sends the proxy's cookie on
the upgrade, the proxy adds its header, and ADR 0033 §5's same-origin rule
already covers the upgrade.

`ws` answers the first subprotocol a client offers when the server names
no choice, so any credential carried in a subprotocol would be echoed back
in the handshake.

## Decision

### 1. On an upgrade, a token may come as the subprotocol `simlock.bearer.<token>`

The console opens `ws(s)://<its origin>/v1/leases/<id>/input` with the
subprotocols `simlock` and `simlock.bearer.<token>`. A token is `slk_` and
base64url, which is a valid subprotocol token.

- The token strategy reads the item only on a request with
  `Upgrade: websocket`, and only when `Authorization` carries no bearer
  value: `Authorization` still wins, and a plain request cannot use it.
- What the token may do does not change: an agent drives its own lease, an
  operator any lease, and anyone else gets 404 before the upgrade.
- The upgrade router answers `simlock` when it is offered, else the first
  item that carries no token, else no subprotocol. It never answers a
  `simlock.bearer.` item.
- A proxy session offers `simlock` alone.
- Clients that send `Authorization` (T3 Code's device panel, scripts)
  are not affected.

```mermaid
sequenceDiagram
  participant B as Console (browser)
  participant G as Gateway or worker
  participant W as Worker
  B->>G: GET /v1/leases/L/input, Upgrade, Sec-WebSocket-Protocol: simlock, simlock.bearer.slk_…
  G->>G: token strategy reads the item; lease resolved for the caller (404 if not theirs)
  G-->>B: 101, Sec-WebSocket-Protocol: simlock
  G->>W: two-way relay (a new request: the browser's headers stay on the gateway)
  W-->>B: 0x83, 0x82
  B->>W: 0x06 key, 0x04 button
```

### 2. Through a gateway the token stays on the gateway

The gateway authenticates the upgrade and opens the worker's two-way relay
with a request of its own (`createGatewayChannelLink`), so neither the
token nor the subprotocol header reaches the worker. The console works the
same on a gateway and on a standalone worker.

### 3. The console drives a leased device's buttons, and a TV's remote

On a device's streaming page, a device under a lease whose worker reports
the `input` capability available gets a Remote card:

- A TV (its model's class in the worker's catalog, or a physical device's
  own class, is `tv`) gets a D-pad and Select, sent as the keyboard's HID
  usages (arrows `0x4F`–`0x52`, Return `0x28`), and Back and Home as
  buttons; an Android TV gets Lock too. Back is labelled Menu on an Apple
  TV, where the driver sends it as the remote's Menu.
- Any other device gets Home, and Back on Android.
- While a TV's remote takes keys, the picture is a focusable group: the
  arrows, Enter, and Esc or Backspace press the same controls.
- The card says what the socket says: connecting, ready, no keys
  (`keyboardUnavailable`: the pad is disabled, the buttons stay), no input
  (`inputUnavailable`), or refused (closed before `0x83`: a browser sees no
  status) and stopped, each with **Connect again**. Nothing reconnects by
  itself.
- Touch is not sent.

## Consequences

- The token appears in the `Sec-WebSocket-Protocol` request header of an
  upgrade. A proxy that logs request headers logs it, as it would log
  `Authorization`; it never appears in a URL or a response.
- The console's `connect-src 'self'` covers the socket: CSP Level 3 matches
  `ws:` and `wss:` to the page's own host and port under `'self'`.
- Behind a sign-in proxy served over plain HTTP on a network name, a
  browser sends no `Sec-Fetch-Site`, so the upgrade is refused as every
  proxied write is (ADR 0033 §5).
- Two console tabs on one lease take two of the lease's 8 sockets.

## Alternatives considered

- **A short-lived, single-use ticket from an authenticated `POST`,
  presented in the URL.** No credential in a header, but a new route, new
  state on every daemon that answers the socket, a ticket in a URL (and so
  in access logs), and a second round trip per connection. Rejected for
  the subprotocol, which needs no state.
- **The token in the query string.** Logged by every proxy and kept in
  browser history. Rejected.
- **A cookie set by the console.** Ambient, so every cross-site page could
  open the socket with it; it would need the same-origin rule and a
  sign-in flow the console does not have. Rejected.
