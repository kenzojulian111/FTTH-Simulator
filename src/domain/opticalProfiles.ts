import type { OpticalBudgetConfig } from "./types";

export const ILLUSTRATIVE_OPTICAL_PROFILE_ID = "illustrative_gpon_planning_v1";
export const LECTURE_OPTICAL_PROFILE_ID = "lecture_material_gpon_v1";
export const LECTURE_OPTICAL_PROFILE_NOTE =
  "Nilai awal berasal dari materi kuliah yang diberikan pengguna, bukan standar universal yang sudah diverifikasi.";

/** Documented starting assumptions only; these are not manufacturer specifications. */
export const ILLUSTRATIVE_OPTICAL_CONFIG: OpticalBudgetConfig = {
  profileId: ILLUSTRATIVE_OPTICAL_PROFILE_ID,
  fiberType: "G.652.D",
  wavelengthNm: 1310,
  parameterSources: {
    txPowerDbm: "profile_default", fiberAttenuationDbPerKm: "profile_default", dropFiberAttenuationDbPerKm: "profile_default",
    fiberType: "profile_default", wavelengthNm: "profile_default", connectorLossDb: "profile_default",
    connectorsPerLink: "profile_default", spliceLossDb: "profile_default", splicesPerLink: "profile_default",
    pigtailSpliceLossDb: "profile_default", pigtailSplicesPerLink: "profile_default", safetyMarginDb: "profile_default",
    rxSensitivityDbm: "profile_default", rxOverloadDbm: "profile_default", minMarginDb: "profile_default",
    splitterLossTable: "profile_default",
  },
  txPowerDbm: 2.5,
  fiberAttenuationDbPerKm: 0.35,
  dropFiberAttenuationDbPerKm: 0.35,
  connectorLossDb: 0.5,
  connectorsPerLink: 2,
  spliceLossDb: 0.1,
  splicesPerLink: 1,
  pigtailSpliceLossDb: 0.1,
  pigtailSplicesPerLink: 0,
  safetyMarginDb: 3,
  rxSensitivityDbm: -27,
  rxOverloadDbm: -8,
  minMarginDb: 0,
  splitterLossTable: { "1:2": 3.5, "1:4": 7.2, "1:8": 10.5, "1:16": 13.8, "1:32": 17.1, "1:64": 20.5 },
};

/**
 * Editable reference profile based on user's lecture material ("materi kuliah").
 * Not a verified universal standard.
 */
export const LECTURE_OPTICAL_CONFIG: OpticalBudgetConfig = {
  profileId: LECTURE_OPTICAL_PROFILE_ID,
  profileNote: LECTURE_OPTICAL_PROFILE_NOTE,
  fiberType: "G.652.D",
  wavelengthNm: 1310,
  parameterSources: {
    txPowerDbm: "profile_default", fiberAttenuationDbPerKm: "profile_default", dropFiberAttenuationDbPerKm: "profile_default",
    fiberType: "profile_default", wavelengthNm: "profile_default", connectorLossDb: "profile_default",
    connectorsPerLink: "profile_default", spliceLossDb: "profile_default", splicesPerLink: "profile_default",
    pigtailSpliceLossDb: "profile_default", pigtailSplicesPerLink: "profile_default", safetyMarginDb: "profile_default",
    rxSensitivityDbm: "profile_default", rxOverloadDbm: "profile_default", minMarginDb: "profile_default",
    splitterLossTable: "profile_default",
  },
  txPowerDbm: 2.5,
  fiberAttenuationDbPerKm: 0.35,
  dropFiberAttenuationDbPerKm: 0.35,
  connectorLossDb: 0.25,
  connectorsPerLink: 2,
  spliceLossDb: 0.1,
  splicesPerLink: 1,
  pigtailSpliceLossDb: 0.1,
  pigtailSplicesPerLink: 0,
  safetyMarginDb: 3,
  rxSensitivityDbm: -27,
  rxOverloadDbm: -8,
  minMarginDb: 0,
  splitterLossTable: { "1:2": 3.5, "1:4": 7.25, "1:8": 10.38, "1:16": 15, "1:32": 18.6, "1:64": 22.8 },
};

const OVERRIDABLE_PROFILE_KEYS = [
  "txPowerDbm",
  "fiberAttenuationDbPerKm",
  "dropFiberAttenuationDbPerKm",
  "fiberType",
  "wavelengthNm",
  "connectorLossDb",
  "connectorsPerLink",
  "spliceLossDb",
  "splicesPerLink",
  "pigtailSpliceLossDb",
  "pigtailSplicesPerLink",
  "safetyMarginDb",
  "rxSensitivityDbm",
  "rxOverloadDbm",
  "minMarginDb",
] as const;

export function applyOpticalProfilePreservingConfigured(
  current: OpticalBudgetConfig,
  targetProfile: OpticalBudgetConfig,
): OpticalBudgetConfig {
  const currentSources = current.parameterSources ?? {};
  const nextSources: NonNullable<OpticalBudgetConfig["parameterSources"]> = {
    ...(targetProfile.parameterSources ?? {}),
  };
  const next: OpticalBudgetConfig = {
    ...targetProfile,
    splitterLossTable: { ...targetProfile.splitterLossTable },
    parameterSources: nextSources,
    projectStandardLossDb: current.projectStandardLossDb ?? targetProfile.projectStandardLossDb ?? null,
    projectStandardReference: current.projectStandardReference ?? targetProfile.projectStandardReference ?? null,
  };

  for (const key of OVERRIDABLE_PROFILE_KEYS) {
    if (currentSources[key] === "configured" && current[key] !== undefined && current[key] !== null) {
      (next as unknown as Record<string, unknown>)[key] = current[key];
      nextSources[key] = "configured";
    }
  }

  if (currentSources.splitterLossTable === "configured" && current.splitterLossTable) {
    next.splitterLossTable = {
      ...targetProfile.splitterLossTable,
      ...current.splitterLossTable,
    };
    nextSources.splitterLossTable = "configured";
  }

  return next;
}
