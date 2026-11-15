# iOS device input

Does: taps, scrolls, Home, keys and rotations on an iOS simulator, and keys, Home and Back on an Apple TV simulator, through `simlock-screen-capture <udid> --input`; a physical iPhone answers unavailable.
Flows: [iOS driver](../AGENTS.md), [input](../../../input/AGENTS.md).

## Rules

- The helper's HID client and the runtime rule for keys stay here; core and the input module name neither.
- Home is `xcrun simctl` here and nowhere in the helper (one owner). Xcode 26 and later silently drop the HID home-button press, so Home launches the family's home app: `com.apple.springboard` on iOS, `com.apple.HeadBoard` on tvOS (SpringBoard does not launch there). A failure is only logged. The app switcher and Lock are dropped, and Back on iOS.
- The family is read from the device's runtime identifier (`familyOfRuntimeId`, ADR 0076); one that cannot be read is iOS.
- Keys are dropped, and the config says `keyboardUnavailable: true`, when an iOS runtime is iOS 27 or later or cannot be read: the iOS 27 guest ignores injected keys. A tvOS runtime always takes keys.
- On tvOS (ADR 0076 §5) only keys reach the helper: a touch, a scroll and a rotation are dropped, since a touch reaches the guest as a press that leaves the app. Back is Escape (usage `0x29`) down then up: the remote's Menu button.
- The helper follows the driver's device-set rule: `SIMLOCK_IOS_DEVICE_SET` names the owned set under `simlock` and is absent under `default`. The daemon's own value never reaches it.
- The open waits for the helper's first size frame (`READY_DEADLINE_MS` in `device-input.ts`), which it writes once its HID client is set up. A missing program, an early exit or no frame rejects the open, and the helper is stopped.
- The config is always `portrait`, a rotation included: it is the size of the panel the taps land on. A foldable's helper sends the size again when the panel in use changes (ADR 0075 §4); a size equal to the held one is no change, and a frame that is not a size is warned about and kept out.
- The helper follows the panel in use the way the capture does, through the same `PanelFollower`: taps go to that panel's digitizer, the inner panel's turned upright.
- A rotation goes to the helper on every runtime. The helper sends it as a GSEvent to the simulator's `PurpleWorkspacePort` and logs one it could not send.
- A physical iPhone answers `{unavailable}` and starts nothing.

## Known gaps

- **No app switcher or Lock, and no keys on iOS 27 runtimes (#1024).**
- **An Apple TV has no play/pause or Siri Remote swipe**: only the keyboard's arrows, Return (Select) and Escape (Menu) reach it.
- **A screen that does not rotate ignores a rotation, and nothing tells the client** (the iPhone home screen, upside down on a Face ID iPhone). Rotation was checked on Xcode 26.4 (iOS 26.4 runtime) and Xcode 27.0 (iOS 26.4 and 27.0 runtimes) (#1080).
- **A one-panel device's input follows its native frame**, so after a rotation taps and picture stay in the same frame; a foldable's follow the upright picture.
- **Taps may vanish after a reboot under the lease.** After the health monitor reboots a crashed simulator the helper's HID client is bound to the old boot, until the lease's input reopens.
