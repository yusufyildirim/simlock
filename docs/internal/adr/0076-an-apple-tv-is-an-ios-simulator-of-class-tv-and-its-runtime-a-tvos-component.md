# 0076. An Apple TV is an iOS simulator of class tv, and its runtime is a `tvOS-` component

- **Status:** Accepted
- **Date:** 2026-11-15
- **Narrows:** [ADR 0010](0010-components-have-one-owner-in-the-core.md) §1
  ("the version is the string the catalog lists under `runtimes`"), for a
  tvOS runtime (§2 below).
- **Evidence:** Xcode 27.2 with the iOS 27.0 and tvOS 27.0 runtimes; an
  Android TV image (`android-34/android-tv/arm64-v8a`) with emulator 36.

## Context

[ADR 0015](0015-a-lease-request-is-a-set-of-constraints.md) already has a
`tv` class, and the iOS catalog already classes an `Apple TV` device type
as `tv`. On Android,
[ADR 0025](0025-simlock-ships-android-profiles-and-a-model-pairs-only-with-images-that-fit.md)
ships the `Television (1080p)` and `Television (4K)` profiles and pairs them
only with `android-tv` and `google-tv` images. An Android TV emulator boots,
reaches ready and streams through scrcpy like any other emulator, and its
input already maps arrows, Enter and Back to D-pad and key events.

An Apple TV could not be leased: the iOS driver read only runtimes whose
name starts with `iOS`, so a tvOS runtime was never listed and an Apple TV
paired with nothing. Probed on Xcode 27.2:

- `simctl create`, `boot`, `bootstatus -b` and `listapps` work on an Apple
  TV as on an iPhone.
- `simlock-screen-capture` streams both the 1080p and the 4K Apple TV, and
  its `--input` mode reports the screen size.
- Keyboard HID usages reach the guest: arrows move the focus, Return
  selects, Escape is the remote's Menu (back).
- A touch reaches the guest as a press that sends the front app to the
  home screen. The Apple TV has no touch surface and does not rotate.
- `simctl launch <udid> com.apple.springboard` fails on tvOS; the home
  screen is `com.apple.HeadBoard`.
- `xcodebuild -downloadPlatform tvOS [-buildVersion <v>]` downloads a
  tvOS runtime, and its asset bundles live under
  `com_apple_MobileAsset_appleTVOSSimulatorRuntime`.

iOS and tvOS ship with the same version numbers: iOS 27.0 and tvOS 27.0
are two runtimes. The registry keys a component by platform and version.

## Decision

### 1. An Apple TV is a simulator of the `ios` platform, class `tv`

No new platform. The iOS simctl driver serves two simulator families, iOS
and tvOS, and each fact names its family in one place:

| Of          | Read from                                                    |
| ----------- | ------------------------------------------------------------ |
| a model     | its name: `Apple TV …` is tvOS, anything else iOS            |
| a runtime   | simctl's `platform` field, or the first word of its name     |
| an image    | its `platformIdentifier` (`appletvsimulator`)                |
| a component | its name (§2)                                                |
| a device    | the runtime identifier in its driver data (`…SimRuntime.tvOS-…`) |

A model pairs only with runtimes of its family. A runtime of any other
family (watchOS, visionOS) is not listed at all. `osVersion` stays a bare
version (`27.0`), so the OS grammar, `--os` and the catalog's `runtimes`
do not change; `runtimes` lists every installed version of both families, each once,
and `defaultRuntime` is the newest iOS one.

The model is read from its name because core asks a device's component
synchronously with only its spec (§3), and the contract's rotation rule
already reads the same prefix.

### 2. A tvOS component is named `tvOS-<version>`

`tvOS-27.0`, `tvOS-27`, `tvOS-latest`. An iOS component keeps its bare
version, so a record written before tvOS existed still matches. The name
passes `componentVersionSchema` unchanged, so the contract does not change.
`findComponent`, `installComponent`, `listComponents`, `removeComponent`
and every `RuntimeMissingError.component` use that name. An install runs
`xcodebuild -downloadPlatform tvOS`.

### 3. A device's component is the driver's answer

`Driver.componentOf(spec)` names the component a device runs on, as
`listComponents` names it. `ComponentInstaller` counts a component's
devices and checks `claimProvision` by it, so a TV on 27.0 holds
`tvOS-27.0` and not `27.0`. The Android driver and the fakes answer the
bare version.

### 4. tvOS is never slimmed

The slim labels (ADR 0060) are iOS's. A tvOS runtime is never slimmed and
gets no slim advisory; a slim request on an Apple TV gets `full`.

### 5. An Apple TV takes keys, and its buttons map to its remote

| Input           | iOS simulator                         | Apple TV simulator              |
| --------------- | ------------------------------------- | ------------------------------- |
| key             | below iOS 27 only                     | always                          |
| touch, scroll   | yes                                   | dropped                         |
| orientation     | yes                                   | dropped                         |
| `home`          | `simctl launch … com.apple.springboard` | `simctl launch … com.apple.HeadBoard` |
| `back`          | dropped                               | Escape (usage 0x29), the Menu button |

A touch is dropped because it reaches the guest as a press that leaves
the app.

## Consequences

- Leasing, streaming, input, downloads, removal and baselines work for an
  Apple TV as for an iPhone, through the same commands.
- An Android TV image is not downloaded by `--allow-download` or
  `component install`: an Android component is an API level and installs
  its `google_apis` image (ADR 0025). The operator installs
  `system-images;android-<N>;android-tv;<abi>` with `sdkmanager`.
- An Android level with only a TV image counts as installed (ADR 0025), so
  a phone lease at that level is not downloadable.
- `lock` on an Android TV sends POWER, which puts it to sleep; a second
  `lock` wakes it.
- The Apple TV has no play/pause button in the input set, and the volume
  step's effect on tvOS is not verified.
