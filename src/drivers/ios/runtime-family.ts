// why: ADR 0076: the iOS driver serves two simulator families, and a family is read in one place each:
// a model's from its name, a runtime's from its platform, a component's from its prefix.
export type RuntimeFamily = "iOS" | "tvOS";

const TV_MODEL_PREFIX = "apple tv";
// why: an iOS component keeps its bare version, so components recorded before tvOS existed still match.
const TV_COMPONENT_PREFIX = "tvOS-";

interface FamilyFacts {
  readonly simulatorPlatform: string;
  readonly assetRoot: string;
}

// why: where macOS's asset daemon keeps each family's downloaded runtimes, one `<uuid>.asset` bundle
// per build; Simlock only reads these folders (issue #79).
const FAMILY_FACTS: Readonly<Record<RuntimeFamily, FamilyFacts>> = {
  iOS: {
    assetRoot: "/System/Library/AssetsV2/com_apple_MobileAsset_iOSSimulatorRuntime",
    simulatorPlatform: "com.apple.platform.iphonesimulator",
  },
  tvOS: {
    assetRoot: "/System/Library/AssetsV2/com_apple_MobileAsset_appleTVOSSimulatorRuntime",
    simulatorPlatform: "com.apple.platform.appletvsimulator",
  },
};

export const RUNTIME_FAMILIES: readonly RuntimeFamily[] = ["iOS", "tvOS"];

// why: core asks a device's component synchronously, with only its spec, so the family is read from
// the model's name; every Apple TV device type Xcode ships is named `Apple TV …`.
export function familyOfModel(model: string): RuntimeFamily {
  return model.toLocaleLowerCase().startsWith(TV_MODEL_PREFIX) ? "tvOS" : "iOS";
}

/** why: `simctl list -j runtimes` names the family in `platform`; an older Xcode only in the name. */
export function familyOfRuntime(platform: unknown, name: string): RuntimeFamily | undefined {
  const label = typeof platform === "string" ? platform : name.split(" ")[0];
  return RUNTIME_FAMILIES.find((family) => family.toLowerCase() === label?.toLowerCase());
}

// why: a device's driver data names its runtime by identifier (`…SimRuntime.tvOS-27-0`), not its spec.
export function familyOfRuntimeId(runtimeId: string): RuntimeFamily | undefined {
  const label = /SimRuntime\.([A-Za-z]+)-\d/.exec(runtimeId)?.[1];
  return RUNTIME_FAMILIES.find((family) => family === label);
}

export function familyOfImagePlatform(
  platformIdentifier: string | undefined,
): RuntimeFamily | undefined {
  return RUNTIME_FAMILIES.find(
    (family) => FAMILY_FACTS[family].simulatorPlatform === platformIdentifier,
  );
}

export function assetRootOf(family: RuntimeFamily): string {
  return FAMILY_FACTS[family].assetRoot;
}

export function componentName(family: RuntimeFamily, version: string): string {
  return family === "tvOS" ? `${TV_COMPONENT_PREFIX}${version}` : version;
}

export function parseComponent(component: string): {
  readonly family: RuntimeFamily;
  readonly version: string;
} {
  const prefix = component.slice(0, TV_COMPONENT_PREFIX.length);
  return prefix.toLowerCase() === TV_COMPONENT_PREFIX.toLowerCase()
    ? { family: "tvOS", version: component.slice(TV_COMPONENT_PREFIX.length) }
    : { family: "iOS", version: component };
}
