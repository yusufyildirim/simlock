import type { WorkerDevice, WorkerView } from "./workers";

/**
 * why: the remote a console draws for a leased device, and what each of its controls sends over the
 * lease's input socket. A TV gets a D-pad, Select, Back (an Apple TV's Menu) and Home, and an Android
 * TV Lock too; any other device only the buttons its driver takes (Home, and Back on Android). Touch
 * is not offered here.
 */
export type RemoteControl = "up" | "down" | "left" | "right" | "select" | "back" | "home" | "lock";

export type RemoteSend =
  | { readonly kind: "key"; readonly usage: number }
  | { readonly kind: "button"; readonly button: "back" | "home" | "lock" };

export interface RemoteSpec {
  readonly tv: boolean;
  readonly controls: readonly RemoteControl[];
}

const PAD: readonly RemoteControl[] = ["up", "down", "left", "right", "select"];

// why: the keyboard's HID usages the TV drivers map to the remote's D-pad and Select.
const SENDS: Readonly<Record<RemoteControl, RemoteSend>> = {
  back: { button: "back", kind: "button" },
  down: { kind: "key", usage: 0x51 },
  home: { button: "home", kind: "button" },
  left: { kind: "key", usage: 0x50 },
  lock: { button: "lock", kind: "button" },
  right: { kind: "key", usage: 0x4f },
  select: { kind: "key", usage: 0x28 },
  up: { kind: "key", usage: 0x52 },
};

export function sendOf(control: RemoteControl): RemoteSend {
  return SENDS[control];
}

// why: a virtual device's class is its model's, which only the worker's catalog knows; a physical
// device carries its own.
function classOf(worker: WorkerView, device: WorkerDevice): string | undefined {
  if (device.class !== undefined) return device.class;
  const entry = worker.catalog?.find((each) => each.platform === device.spec.platform);
  return entry?.modelClasses[device.spec.model];
}

// why: a worker whose input capability is not available answers the socket with a 404 (or a
// gateway with a 503), so the console offers no remote there rather than one that cannot connect.
export function remoteOf(
  worker: WorkerView | undefined,
  device: WorkerDevice,
): RemoteSpec | undefined {
  if (worker === undefined) return undefined;
  const input = worker.capabilities?.find((capability) => capability.name === "input");
  if (input?.state !== "available") return undefined;
  const android = device.spec.platform === "android";
  if (classOf(worker, device) === "tv") {
    return {
      controls: android ? [...PAD, "back", "home", "lock"] : [...PAD, "back", "home"],
      tv: true,
    };
  }
  return { controls: android ? ["back", "home"] : ["home"], tv: false };
}

const KEYS: Readonly<Record<string, RemoteControl>> = {
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  Backspace: "back",
  Enter: "select",
  Escape: "back",
};

// why: only a TV is driven from the keyboard; on a phone an arrow key means nothing, and Esc would
// press Back behind the reader's back.
export function keyControl(spec: RemoteSpec, key: string): RemoteControl | undefined {
  if (!spec.tv || !Object.hasOwn(KEYS, key)) return undefined;
  const control = KEYS[key];
  return control !== undefined && spec.controls.includes(control) ? control : undefined;
}

export type RemotePhase =
  | { readonly kind: "connecting" }
  | { readonly kind: "ready"; readonly keys: boolean }
  | { readonly kind: "unavailable" }
  | { readonly kind: "refused" }
  | { readonly kind: "closed" };

export interface RemoteButton {
  readonly control: RemoteControl;
  readonly label: string;
  readonly disabled: boolean;
}

export interface RemoteView {
  readonly tv: boolean;
  readonly buttons: readonly RemoteButton[];
  readonly keyboard: boolean;
  readonly note: string;
  readonly retry: boolean;
}

function labelOf(control: RemoteControl, platform: string): string {
  if (control === "back" && platform === "ios") return "Menu";
  return control === "select" ? "Select" : control.charAt(0).toUpperCase() + control.slice(1);
}

function noteOf(spec: RemoteSpec, platform: string, phase: RemotePhase): string {
  const back = labelOf("back", platform);
  switch (phase.kind) {
    case "connecting":
      return "Connecting to the device's input…";
    case "unavailable":
      return "This device takes no input.";
    case "refused":
      return "The daemon did not open input for this lease. It needs capabilities.input.enabled, and through a gateway on the lease's worker too.";
    case "closed":
      return "Input stopped.";
    case "ready": {
      if (!spec.tv) return "Presses the device's buttons.";
      if (!phase.keys) {
        const working = spec.controls.filter((control) => sendOf(control).kind === "button");
        const names = working.map((control) => labelOf(control, platform));
        return `This device takes no keys: only ${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""} work.`;
      }
      return `Click the screen, then use the arrow keys, Enter for Select, and Esc or Backspace for ${back}.`;
    }
  }
}

export function remoteView(spec: RemoteSpec, platform: string, phase: RemotePhase): RemoteView {
  const ready = phase.kind === "ready";
  const keys = ready && phase.keys;
  return {
    buttons: spec.controls.map((control) => ({
      control,
      disabled: !ready || (sendOf(control).kind === "key" && !keys),
      label: labelOf(control, platform),
    })),
    keyboard: ready && spec.tv,
    note: noteOf(spec, platform, phase),
    retry: phase.kind === "refused" || phase.kind === "closed",
    tv: spec.tv,
  };
}
