import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { type Answer, renderConsole, type Routes } from "../../test/console";
import { device, lease, NOW, worker } from "../../test/fixtures";
import type { WorkerView } from "../../model/workers";

const PAGE = "/fleet/wrk_1/devices/dev_1/";
const APPLE_TV = "Apple TV 4K (3rd generation)";
const ANDROID_TV = "Television (1080p)";

// why: the picture is not what these tests are about, so its request stays open and unanswered.
const PENDING = () => new Promise<Answer>(() => undefined);

function catalog(platform: "ios" | "android", classes: Record<string, string>) {
  return {
    classDefaults: {},
    modelAliases: {},
    modelClasses: classes,
    modelRuntimes: {},
    models: Object.keys(classes),
    platform,
    runtimes: [],
  } as unknown as NonNullable<WorkerView["catalog"]>[number];
}

function host(
  model: string,
  options: { platform?: "ios" | "android"; leased?: boolean; input?: boolean } = {},
) {
  const { input = true, leased = true, platform = "ios" } = options;
  return worker({
    capabilities: [
      { name: "stream", state: "available" },
      ...(input ? [{ name: "input", state: "available" }] : []),
    ] as never,
    catalog: [
      catalog("ios", { [APPLE_TV]: "tv", "iPhone 16": "phone" }),
      catalog("android", { [ANDROID_TV]: "tv", "Pixel 9": "phone" }),
    ],
    devices: [
      device({
        spec: { model, osVersion: "27.0", physical: false, platform },
        state: leased ? "leased" : "ready",
      }),
    ],
    leases: leased ? [lease()] : [],
  });
}

function routes(view: WorkerView): Routes {
  return {
    "GET /v1/stream/workers/wrk_1/devices/dev_1": PENDING,
    "/v1/leases": { body: { leases: view.leases ?? [] } },
    "/v1/leases/lse_1": {
      body: {
        lease: {
          createdAt: new Date(NOW - 3_600_000).toISOString(),
          device: "Apple TV",
          deviceId: "dev_1",
          expiresAt: new Date(NOW + 600_000).toISOString(),
          id: "lse_1",
          workerId: "wrk_1",
        },
      },
    },
    "/v1/workers": { body: { workers: [view] } },
  };
}

async function remote() {
  return screen.findByRole("region", { name: "Remote" });
}

function button(name: string) {
  return within(screen.getByRole("region", { name: "Remote" })).getByRole("button", { name });
}

const KEY = 0x06;
const BUTTON = 0x04;

function keyPress(usage: number) {
  return [
    { body: { type: "down", usage }, tag: KEY },
    { body: { type: "up", usage }, tag: KEY },
  ];
}

describe("the remote on a leased TV's streaming page", () => {
  it("opens the lease's input socket with the token as a subprotocol, and enables the remote once input is admitted", async () => {
    const { inputSockets } = renderConsole({ path: PAGE, routes: routes(host(APPLE_TV)) });

    expect(await remote()).toBeVisible();
    await waitFor(() => expect(inputSockets).toHaveLength(1));
    const socket = inputSockets[0]!;
    expect(socket.url).toMatch(/^ws:\/\/[^/]+\/v1\/leases\/lse_1\/input$/);
    expect(socket.protocols).toEqual(["simlock", "simlock.bearer.tok_operator"]);
    expect(button("Up")).toBeDisabled();
    expect(screen.getByText("Connecting to the device's input…")).toBeVisible();

    act(() => socket.admit());

    for (const name of ["Up", "Down", "Left", "Right", "Select", "Menu", "Home"]) {
      expect(button(name)).toBeEnabled();
    }
    expect(
      within(screen.getByRole("region", { name: "Remote" })).queryByRole("button", {
        name: "Lock",
      }),
    ).toBeNull();
    expect(
      screen.getByText(
        "Click the screen, then use the arrow keys, Enter for Select, and Esc or Backspace for Menu.",
      ),
    ).toBeVisible();
  });

  it("sends a key press for the pad and Select, and a button for Menu and Home", async () => {
    const { inputSockets, user } = renderConsole({ path: PAGE, routes: routes(host(APPLE_TV)) });
    await remote();
    await waitFor(() => expect(inputSockets).toHaveLength(1));
    const socket = inputSockets[0]!;
    act(() => socket.admit());

    await user.click(button("Up"));
    await user.click(button("Right"));
    await user.click(button("Select"));
    await user.click(button("Menu"));
    await user.click(button("Home"));

    expect(socket.sent).toEqual([
      ...keyPress(0x52),
      ...keyPress(0x4f),
      ...keyPress(0x28),
      { body: { button: "back" }, tag: BUTTON },
      { body: { button: "home" }, tag: BUTTON },
    ]);
  });

  it("drives the remote from the keyboard while the screen has focus", async () => {
    const { inputSockets } = renderConsole({ path: PAGE, routes: routes(host(APPLE_TV)) });
    await remote();
    await waitFor(() => expect(inputSockets).toHaveLength(1));
    const socket = inputSockets[0]!;
    act(() => socket.admit());
    const stage = screen.getByRole("group", { name: "Screen. Keys drive the remote." });

    for (const key of ["ArrowDown", "ArrowLeft", "Enter", "Escape", "Backspace", "a"]) {
      fireEvent.keyDown(stage, { key });
    }

    expect(socket.sent).toEqual([
      ...keyPress(0x51),
      ...keyPress(0x50),
      ...keyPress(0x28),
      { body: { button: "back" }, tag: BUTTON },
      { body: { button: "back" }, tag: BUTTON },
    ]);
  });

  it("offers Lock and Back on an Android TV", async () => {
    const { inputSockets, user } = renderConsole({
      path: PAGE,
      routes: routes(host(ANDROID_TV, { platform: "android" })),
    });
    await remote();
    await waitFor(() => expect(inputSockets).toHaveLength(1));
    act(() => inputSockets[0]!.admit());

    await user.click(button("Back"));
    await user.click(button("Lock"));

    expect(inputSockets[0]!.sent).toEqual([
      { body: { button: "back" }, tag: BUTTON },
      { body: { button: "lock" }, tag: BUTTON },
    ]);
  });

  it("keeps Menu and Home but not the pad when the device takes no keys", async () => {
    const { inputSockets } = renderConsole({ path: PAGE, routes: routes(host(APPLE_TV)) });
    await remote();
    await waitFor(() => expect(inputSockets).toHaveLength(1));
    act(() => inputSockets[0]!.admit({ height: 1080, keyboardUnavailable: true, width: 1920 }));

    expect(button("Up")).toBeDisabled();
    expect(button("Select")).toBeDisabled();
    expect(button("Menu")).toBeEnabled();
    expect(screen.getByText("This device takes no keys: only Menu and Home work.")).toBeVisible();
    fireEvent.keyDown(screen.getByRole("group", { name: "Screen. Keys drive the remote." }), {
      key: "ArrowUp",
    });
    expect(inputSockets[0]!.sent).toEqual([]);
  });

  it("disables the remote when the device says it takes no input", async () => {
    const { inputSockets } = renderConsole({ path: PAGE, routes: routes(host(APPLE_TV)) });
    await remote();
    await waitFor(() => expect(inputSockets).toHaveLength(1));
    act(() => inputSockets[0]!.admit({ height: 1, inputUnavailable: true, width: 1 }));

    expect(button("Home")).toBeDisabled();
    expect(screen.getByText("This device takes no input.")).toBeVisible();
  });

  it("says the daemon refused input when the socket closes before it is admitted, and connects again on request", async () => {
    const { inputSockets, user } = renderConsole({ path: PAGE, routes: routes(host(APPLE_TV)) });
    await remote();
    await waitFor(() => expect(inputSockets).toHaveLength(1));

    act(() => inputSockets[0]!.close(1006));

    expect(button("Home")).toBeDisabled();
    expect(
      screen.getByText(
        "The daemon did not open input for this lease. It needs capabilities.input.enabled, and through a gateway on the lease's worker too.",
      ),
    ).toBeVisible();
    await user.click(button("Connect again"));
    await waitFor(() => expect(inputSockets).toHaveLength(2));
    act(() => inputSockets[1]!.admit());
    expect(button("Home")).toBeEnabled();
  });

  it("closes the input socket when the page is left", async () => {
    const { inputSockets, user } = renderConsole({ path: PAGE, routes: routes(host(APPLE_TV)) });
    await remote();
    await waitFor(() => expect(inputSockets).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "Stop watching" }));

    await waitFor(() => expect(inputSockets[0]!.closed).toBe(true));
  });

  it.each([
    { name: "a device with no lease", view: host(APPLE_TV, { leased: false }) },
    { name: "a worker whose input is off", view: host(APPLE_TV, { input: false }) },
  ])("shows no remote and opens no socket for $name", async ({ view }) => {
    const { inputSockets } = renderConsole({ path: PAGE, routes: routes(view) });

    expect(await screen.findByLabelText("The device's screen")).toBeVisible();
    expect(screen.queryByRole("region", { name: "Remote" })).toBeNull();
    expect(inputSockets).toEqual([]);
  });

  it("offers a leased phone its Home button, and no keyboard", async () => {
    const { inputSockets, user } = renderConsole({ path: PAGE, routes: routes(host("iPhone 16")) });
    await remote();
    await waitFor(() => expect(inputSockets).toHaveLength(1));
    act(() => inputSockets[0]!.admit());

    expect(
      within(screen.getByRole("region", { name: "Remote" }))
        .getAllByRole("button")
        .map((each) => each.textContent),
    ).toEqual(["Home"]);
    expect(screen.queryByRole("group", { name: "Screen. Keys drive the remote." })).toBeNull();
    await user.click(button("Home"));
    expect(inputSockets[0]!.sent).toEqual([{ body: { button: "home" }, tag: BUTTON }]);
  });
});
