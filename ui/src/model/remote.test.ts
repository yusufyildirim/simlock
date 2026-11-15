import { describe, expect, it } from "vitest";

import { device, worker } from "../test/fixtures";
import { keyControl, remoteOf, remoteView, sendOf } from "./remote";
import type { WorkerView } from "./workers";

const INPUT = [{ name: "input", state: "available" }] as WorkerView["capabilities"];

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

const HOST = worker({
  capabilities: INPUT,
  catalog: [
    catalog("ios", { "Apple TV 4K (3rd generation)": "tv", "iPhone 16": "phone" }),
    catalog("android", { "Pixel 9": "phone", "Television (1080p)": "tv" }),
  ],
});

function on(platform: "ios" | "android", model: string, host: WorkerView = HOST) {
  return remoteOf(host, device({ spec: { model, osVersion: "27.0", physical: false, platform } }));
}

const PAD = ["up", "down", "left", "right", "select"];

describe("which remote a device gets", () => {
  it.each([
    { model: "Apple TV 4K (3rd generation)", platform: "ios", controls: [...PAD, "back", "home"] },
    {
      model: "Television (1080p)",
      platform: "android",
      controls: [...PAD, "back", "home", "lock"],
    },
    { model: "iPhone 16", platform: "ios", controls: ["home"] },
    { model: "Pixel 9", platform: "android", controls: ["back", "home"] },
  ] as const)("$model on $platform gets $controls", ({ controls, model, platform }) => {
    expect(on(platform, model)?.controls).toEqual(controls);
  });

  it("names a TV by the class the worker's catalog gives its model", () => {
    expect(on("ios", "Apple TV 4K (3rd generation)")?.tv).toBe(true);
    expect(on("ios", "iPhone 16")?.tv).toBe(false);
    expect(on("android", "Television (1080p)", worker({ capabilities: INPUT }))?.tv).toBe(false);
  });

  it("names a physical device's class from the device itself", () => {
    const phone = device({
      class: "phone",
      physical: true,
      spec: { model: "Pixel 8", osVersion: "35", physical: true, platform: "android" },
    } as never);
    expect(remoteOf(HOST, phone)?.controls).toEqual(["back", "home"]);
  });

  it.each([
    { capabilities: [], name: "a worker whose input is off" },
    { capabilities: [{ name: "input", state: "unavailable" }], name: "unavailable input" },
  ])("offers no remote for $name", ({ capabilities }) => {
    expect(on("ios", "Apple TV 4K (3rd generation)", { ...HOST, capabilities } as WorkerView)).toBe(
      undefined,
    );
  });
});

describe("what a control sends", () => {
  it.each([
    { control: "up", send: { kind: "key", usage: 0x52 } },
    { control: "down", send: { kind: "key", usage: 0x51 } },
    { control: "left", send: { kind: "key", usage: 0x50 } },
    { control: "right", send: { kind: "key", usage: 0x4f } },
    { control: "select", send: { kind: "key", usage: 0x28 } },
    { control: "back", send: { button: "back", kind: "button" } },
    { control: "home", send: { button: "home", kind: "button" } },
    { control: "lock", send: { button: "lock", kind: "button" } },
  ] as const)("$control sends $send", ({ control, send }) => {
    expect(sendOf(control)).toEqual(send);
  });
});

describe("the keyboard on a TV's screen", () => {
  const tv = on("android", "Television (1080p)")!;
  const phone = on("android", "Pixel 9")!;

  it.each([
    ["ArrowUp", "up"],
    ["ArrowDown", "down"],
    ["ArrowLeft", "left"],
    ["ArrowRight", "right"],
    ["Enter", "select"],
    ["Escape", "back"],
    ["Backspace", "back"],
    ["a", undefined],
  ] as const)("%s presses %s", (key, control) => {
    expect(keyControl(tv, key)).toBe(control);
  });

  it("drives no phone from the keyboard", () => {
    expect(keyControl(phone, "Escape")).toBe(undefined);
    expect(keyControl(phone, "ArrowUp")).toBe(undefined);
  });
});

describe("the remote's view", () => {
  const appleTv = on("ios", "Apple TV 4K (3rd generation)")!;
  const androidTv = on("android", "Television (1080p)")!;

  it("labels Back as Menu on an Apple TV, and Lock on an Android TV", () => {
    const apple = remoteView(appleTv, "ios", { kind: "ready", keys: true });
    const android = remoteView(androidTv, "android", { kind: "ready", keys: true });

    expect(apple.buttons.map((button) => button.label)).toEqual([
      "Up",
      "Down",
      "Left",
      "Right",
      "Select",
      "Menu",
      "Home",
    ]);
    expect(android.buttons.map((button) => button.label)).toContain("Lock");
    expect(android.buttons.find((button) => button.control === "back")?.label).toBe("Back");
  });

  it("enables every control once input is admitted, and tells how to drive it from the keyboard", () => {
    const view = remoteView(appleTv, "ios", { kind: "ready", keys: true });

    expect(view.buttons.every((button) => !button.disabled)).toBe(true);
    expect(view.keyboard).toBe(true);
    expect(view.note).toBe(
      "Click the screen, then use the arrow keys, Enter for Select, and Esc or Backspace for Menu.",
    );
  });

  it("keeps the buttons and drops the pad when the device takes no keys", () => {
    const view = remoteView(appleTv, "ios", { kind: "ready", keys: false });

    expect(
      view.buttons.filter((button) => !button.disabled).map((button) => button.control),
    ).toEqual(["back", "home"]);
    expect(view.note).toBe("This device takes no keys: only Menu and Home work.");
  });

  it.each([
    { phase: { kind: "connecting" }, note: "Connecting to the device's input…", retry: false },
    { phase: { kind: "unavailable" }, note: "This device takes no input.", retry: false },
    {
      phase: { kind: "refused" },
      note: "The daemon did not open input for this lease. It needs capabilities.input.enabled, and through a gateway on the lease's worker too.",
      retry: true,
    },
    { phase: { kind: "closed" }, note: "Input stopped.", retry: true },
  ] as const)("disables every control while $phase.kind", ({ note, phase, retry }) => {
    const view = remoteView(androidTv, "android", phase);

    expect(view.buttons.every((button) => button.disabled)).toBe(true);
    expect(view.keyboard).toBe(false);
    expect(view.note).toBe(note);
    expect(view.retry).toBe(retry);
  });
});
