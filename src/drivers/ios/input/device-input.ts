import {
  type DeviceInput,
  type DeviceInputFactory,
  encodeScreenFrame,
  INPUT_TAG,
  isPhysicalDriverDevice,
  type InputMessage,
  type InputScreenConfig,
  type PhysicalDriverDevice,
  type VirtualDriverDevice,
} from "../../../core/index.js";
import type {
  BytePipeExit,
  BytePipeLauncher,
  BytePipeProcess,
  Clock,
  Logger,
  ProcessRunner,
} from "../../../ports/index.js";
import { familyOfRuntimeId, type RuntimeFamily } from "../runtime-family.js";
import { iosRuntimeVersionFromId } from "../runtime-version.js";
import { stopProgram } from "../screen-capture.js";

export interface IosDeviceInputOptions {
  readonly command: string;
  readonly launcher: BytePipeLauncher;
  readonly clock: Clock;
  readonly processRunner: ProcessRunner;
  readonly baseEnvironment: NodeJS.ProcessEnv;
  /** why: absent when the simulators live in Xcode's own set, which the helper searches by default. */
  readonly deviceSet?: string;
  readonly logger?: Logger;
}

const FRAME_HEADER_BYTES = 4;
const HOME_TIMEOUT_MS = 10_000;
// why: the helper sets up its HID client before it reports a size; one that never does is stuck, and
// the open must not wait on it (architecture rule 11).
const READY_DEADLINE_MS = 10_000;
// why: the app `simctl launch` brings forward for Home: SpringBoard on iOS, HeadBoard on tvOS, where
// launching SpringBoard fails.
const HOME_APPS: Readonly<Record<RuntimeFamily, string>> = {
  iOS: "com.apple.springboard",
  tvOS: "com.apple.HeadBoard",
};
// why: the tvOS simulator reads the keyboard's Escape as the remote's Menu button, which is Back.
const TV_MENU_USAGE = 0x29;

export function createIosDeviceInput(options: IosDeviceInputOptions): DeviceInputFactory {
  return {
    open: async (device: VirtualDriverDevice | PhysicalDriverDevice) => {
      // why: nothing on a physical iPhone injects input (F23); only a simulator has a HID helper.
      if (isPhysicalDriverDevice(device)) {
        return { unavailable: "Input is not supported on physical iPhones" };
      }
      const child = options.launcher.start(options.command, [device.deviceId, "--input"], {
        env: environmentFor(options),
      });
      const sizes = sizesOf(child, options.logger);
      let size: InputScreenConfig;
      try {
        size = await within(READY_DEADLINE_MS, options.clock, firstSize(child, sizes));
      } catch (error) {
        await stopProgram(child, options.clock);
        throw error;
      }
      const family = deviceFamily(device);
      return new IosDeviceInput(
        options,
        device.deviceId,
        child,
        size,
        { family, keys: keysAvailable(family, device) },
        sizes,
      );
    },
  };
}

// why: the daemon's own device set must not reach the helper, which would search it instead of the
// one this driver owns.
function environmentFor(options: IosDeviceInputOptions): NodeJS.ProcessEnv {
  const { SIMLOCK_IOS_DEVICE_SET: _daemonDeviceSet, ...environment } = options.baseEnvironment;
  return options.deviceSet === undefined
    ? environment
    : { ...environment, SIMLOCK_IOS_DEVICE_SET: options.deviceSet };
}

function runtimeIdOf(device: VirtualDriverDevice): string {
  const data = device.driverData as { runtimeId?: unknown } | null;
  return typeof data?.runtimeId === "string" ? data.runtimeId : "";
}

// why: a runtime that cannot be read is an iPhone's: the input then behaves as it did before tvOS.
function deviceFamily(device: VirtualDriverDevice): RuntimeFamily {
  return familyOfRuntimeId(runtimeIdOf(device)) ?? "iOS";
}

// why: the iOS 27 guest ignores injected keys (F21), so keys are dropped there; a runtime that cannot
// be read is treated the same, because a key that does nothing is worse than a key refused. The tvOS
// guest takes them: they are its remote.
function keysAvailable(family: RuntimeFamily, device: VirtualDriverDevice): boolean {
  if (family === "tvOS") return true;
  const version = iosRuntimeVersionFromId(runtimeIdOf(device));
  return version !== undefined && version[0] < 27;
}

async function firstSize(
  child: BytePipeProcess,
  sizes: AsyncGenerator<InputScreenConfig>,
): Promise<InputScreenConfig> {
  const step = await sizes.next();
  if (!step.done) return step.value;
  const exit = await child.exited;
  throw new Error(
    `The input helper ${describeExit(exit)}${exit.error === undefined ? " before it reported the screen size" : ""}`,
  );
}

// why: the helper's stdout is the stream's envelope (a 4-byte length counting the tag, a tag, the
// payload); each 0x82 is a screen size, the first once its HID client is set up, a later one when
// the panel in use changes. A frame that is not a size is warned about and the next is waited for.
async function* sizesOf(
  child: BytePipeProcess,
  logger: Logger | undefined,
): AsyncGenerator<InputScreenConfig> {
  const reader = child.stdout.getReader();
  let buffered = new Uint8Array();
  for (;;) {
    const step = await reader.read();
    if (step.done) return;
    buffered = Uint8Array.from([...buffered, ...step.value]);
    for (;;) {
      if (buffered.length < FRAME_HEADER_BYTES) break;
      const length = new DataView(buffered.buffer).getUint32(0);
      if (buffered.length < FRAME_HEADER_BYTES + length) break;
      const payload = buffered.subarray(FRAME_HEADER_BYTES + 1, FRAME_HEADER_BYTES + length);
      buffered = buffered.slice(FRAME_HEADER_BYTES + length);
      const size = parseSize(payload);
      if (size === undefined)
        logger?.warn("The input helper sent a screen size that did not parse");
      else yield size;
    }
  }
}

function parseSize(payload: Uint8Array): InputScreenConfig | undefined {
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return undefined;
  }
  const { height, width } = (body ?? {}) as { height?: unknown; width?: unknown };
  if (!isPixels(width) || !isPixels(height)) return undefined;
  return { height, orientation: "portrait", width };
}

function isPixels(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 100_000;
}

function describeExit(exit: BytePipeExit): string {
  if (exit.error !== undefined) return `could not be started: ${exit.error}`;
  return exit.signal === null
    ? `exited with code ${String(exit.code)}`
    : `was killed by ${exit.signal}`;
}

function within<T>(milliseconds: number, clock: Clock, work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = clock.setTimer(milliseconds, () => {
      reject(new Error("The input helper reported no screen size within 10 s"));
    });
    void work.then(resolve, reject).finally(() => clock.cancel(timer));
  });
}

// why: the helper reads serve-sim's JSON for each tag; JSON leaves out a scroll position the client
// sent none of, so the helper scrolls under the centre.
function frameOfMessage(message: Exclude<InputMessage, { kind: "button" }>): Uint8Array {
  switch (message.kind) {
    case "touch":
      return frameOf(INPUT_TAG.touch, { type: message.type, x: message.x, y: message.y });
    case "scroll":
      return frameOf(INPUT_TAG.scroll, {
        dx: message.dx,
        dy: message.dy,
        x: message.x,
        y: message.y,
      });
    case "key":
      return frameOf(INPUT_TAG.key, { type: message.type, usage: message.usage });
    case "orientation":
      return frameOf(INPUT_TAG.orientation, { orientation: message.orientation });
  }
}

function frameOf(tag: number, body: unknown): Uint8Array {
  return encodeScreenFrame(tag, new TextEncoder().encode(JSON.stringify(body)));
}

class IosDeviceInput implements DeviceInput {
  readonly #options: IosDeviceInputOptions;
  readonly #udid: string;
  readonly #child: BytePipeProcess;
  #config: InputScreenConfig;
  readonly #keys: boolean;
  readonly #family: RuntimeFamily;
  readonly #configListeners = new Set<(config: InputScreenConfig) => void>();
  readonly #failedListeners = new Set<(error: Error) => void>();
  #closing: Promise<void> | undefined;

  constructor(
    options: IosDeviceInputOptions,
    udid: string,
    child: BytePipeProcess,
    size: InputScreenConfig,
    { family, keys }: { readonly family: RuntimeFamily; readonly keys: boolean },
    sizes: AsyncGenerator<InputScreenConfig>,
  ) {
    this.#keys = keys;
    this.#family = family;
    this.#config = this.#withKeys(size);
    void this.#follow(sizes);
    void child.exited.then((exit) => {
      this.#fail(new Error(`The input helper ${describeExit(exit)}`));
    });
    this.#options = options;
    this.#udid = udid;
    this.#child = child;
  }

  #withKeys(size: InputScreenConfig): InputScreenConfig {
    return this.#keys ? size : { ...size, keyboardUnavailable: true };
  }

  // why: a foldable's helper sends a size again when the panel in use changes; a size equal to the
  // one held is no change, and the listeners hear only changes.
  async #follow(sizes: AsyncGenerator<InputScreenConfig>): Promise<void> {
    for await (const size of sizes) {
      if (size.width === this.#config.width && size.height === this.#config.height) continue;
      this.#config = this.#withKeys(size);
      for (const listener of this.#configListeners) listener(this.#config);
    }
  }

  send(message: InputMessage): Promise<void> {
    if (message.kind === "button") {
      if (message.button === "home") this.#home();
      if (message.button === "back" && this.#family === "tvOS") return this.#menu();
      return Promise.resolve();
    }
    // why: an Apple TV has no touch surface and does not rotate; a tap reaches its guest as a press
    // that leaves the app on screen, so only keys go to it.
    if (this.#family === "tvOS" && message.kind !== "key") return Promise.resolve();
    if (message.kind === "key" && !this.#keys) return Promise.resolve();
    return this.#write(frameOfMessage(message));
  }

  async #menu(): Promise<void> {
    await this.#write(frameOf(INPUT_TAG.key, { type: "down", usage: TV_MENU_USAGE }));
    await this.#write(frameOf(INPUT_TAG.key, { type: "up", usage: TV_MENU_USAGE }));
  }

  #write(frame: Uint8Array): Promise<void> {
    return this.#child.writeStdin(frame).catch((error: unknown) => {
      const failure = new Error(
        `The input helper stopped taking input: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.#fail(failure);
      throw failure;
    });
  }

  // why: Xcode 26 and later silently drop the HID home-button press, so Home brings the home app
  // forward the way serve-sim does; the app switcher and Lock have no such way and are dropped.
  #home(): void {
    const { deviceSet, logger, processRunner } = this.#options;
    const args = [
      "simctl",
      ...(deviceSet === undefined ? [] : ["--set", deviceSet]),
      "launch",
      this.#udid,
      HOME_APPS[this.#family],
    ];
    void processRunner.run("xcrun", args, { timeoutMs: HOME_TIMEOUT_MS }).then(
      (result) => {
        if (result.code !== 0)
          logger?.warn("Home did nothing", { stderr: result.stderr, udid: this.#udid });
      },
      (error: unknown) => {
        logger?.warn("Home did nothing", { reason: String(error), udid: this.#udid });
      },
    );
  }

  onConfig(listener: (config: InputScreenConfig) => void): () => void {
    listener(this.#config);
    this.#configListeners.add(listener);
    return () => this.#configListeners.delete(listener);
  }

  // why: a helper that is closing, or already failed, has told its listeners; a second word would
  // close a socket that is already closed.
  #fail(error: Error): void {
    if (this.#closing !== undefined) return;
    void this.close();
    for (const listener of this.#failedListeners) listener(error);
  }

  onFailed(listener: (error: Error) => void): () => void {
    this.#failedListeners.add(listener);
    return () => this.#failedListeners.delete(listener);
  }

  close(): Promise<void> {
    this.#closing ??= stopProgram(this.#child, this.#options.clock);
    return this.#closing;
  }
}
