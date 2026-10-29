import type { OpticalBudgetResult, Project } from "./types";

type OpticalPath = OpticalBudgetResult["paths"][number];

const REQUIRED_METRICS: Array<[keyof OpticalPath, string]> = [
  ["lengthM", "route length"],
  ["lossDb", "total path loss"],
  ["receivedPowerDbm", "received power"],
  ["marginDb", "optical margin"],
];

export function missingOpticalPathMetrics(path: OpticalPath): string[] {
  return REQUIRED_METRICS.flatMap(([key, label]) => {
    const value = path[key];
    return typeof value === "number" && Number.isFinite(value) ? [] : [label];
  });
}

export function opticalPathDisplayStatus(path: OpticalPath): OpticalPath["status"] {
  if (path.status !== "pass") return path.status;
  return missingOpticalPathMetrics(path).length ? "unknown" : "pass";
}

export function opticalPathDisplayIssue(path: OpticalPath): string | null {
  const missing = missingOpticalPathMetrics(path);
  if (path.status !== "pass" || !missing.length) return null;
  return `Backend marked this path PASS but omitted required values: ${missing.join(", ")}.`;
}

const PARAMETER_LABELS: Record<string, { label: string; unit: string }> = {
  txPowerDbm: { label: "OLT transmit power", unit: "dBm" },
  fiberAttenuationDbPerKm: { label: "Fiber attenuation", unit: "dB/km" },
  fiberType: { label: "Fiber type", unit: "type" },
  wavelengthNm: { label: "Wavelength", unit: "nm" },
  connectorLossDb: { label: "Connector insertion loss", unit: "dB/interface" },
  connectorsPerLink: { label: "Connector interfaces per cable", unit: "interfaces" },
  spliceLossDb: { label: "Fusion splice loss", unit: "dB/splice" },
  splicesPerLink: { label: "Fusion splices per cable", unit: "splices" },
  safetyMarginDb: { label: "Design reserve", unit: "dB" },
  rxSensitivityDbm: { label: "ONT receiver sensitivity", unit: "dBm" },
  rxOverloadDbm: { label: "ONT receiver overload", unit: "dBm" },
  minMarginDb: { label: "Minimum design margin", unit: "dB" },
  splitterLossTable: { label: "Splitter insertion-loss profile", unit: "dB by ratio" },
  splitterRatio: { label: "Splitter ratio", unit: "1:N" },
  splitterLossDb: { label: "Actual splitter insertion loss", unit: "dB" },
};

export interface OpticalPathDiagnostic {
  category: "topology" | "optical configuration" | "engineering result";
  summary: string;
  resolution: string;
  parameters: Array<{ name: string; unit: string; source: string }>;
  affectedNodeIds: string[];
}

/** Turns backend reason codes and provenance into concise corrective guidance. */
export function describeOpticalPath(path: OpticalPath, project: Project): OpticalPathDiagnostic {
  const sources = path.parameterSources ?? {};
  const reason = path.statusReason ?? (typeof path.details?.reason === "string" ? path.details.reason : "");
  const parameterEntries = Object.entries(sources);
  const parameterForKey = (key: string, source: string) => {
    const [nodeId, field] = key.includes(".") ? [key.slice(0, key.lastIndexOf(".")), key.slice(key.lastIndexOf(".") + 1)] : ["", key];
    const spec = PARAMETER_LABELS[field];
    if (!spec) return null;
    const node = nodeId ? project.nodes.find((item) => item.id === nodeId) : undefined;
    return { name: node ? `${node.name}: ${spec.label}` : spec.label, unit: spec.unit, source };
  };
  const params = (sourceFilter: string) => parameterEntries
    .filter(([, source]) => source === sourceFilter)
    .map(([key, source]) => parameterForKey(key, source))
    .filter((item): item is { name: string; unit: string; source: string } => item !== null)
    .filter((item, index, all) => all.findIndex((other) => other.name === item.name && other.unit === item.unit) === index);
  const unknownParameters = params("unknown");
  const legacyParameters = params("legacy_fallback");
  const splitterNodeIds = [...new Set(parameterEntries
    .filter(([key, source]) => source === "unknown" && (key.endsWith(".splitterLossDb") || key.endsWith(".splitterRatio")))
    .map(([key]) => key.slice(0, key.lastIndexOf("."))))];

  if (reason === "invalid_topology_connection") {
    const issues = Array.isArray(path.details?.invalidConnections)
      ? path.details.invalidConnections.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      : [];
    const affectedConnections = issues.flatMap((issue) => typeof issue.connectionId === "string" ? [issue.connectionId] : []);
    const affectedNodeIds = project.connections
      .filter((connection) => affectedConnections.includes(connection.id))
      .flatMap((connection) => [connection.fromNodeId, connection.toNodeId]);
    const exactMessages = [...new Set(issues.flatMap((issue) => typeof issue.message === "string" ? [issue.message] : []))];
    return {
      category: "topology",
      summary: exactMessages.length ? exactMessages.join(" ") : "A connection needed for this ONT path failed topology validation.",
      resolution: "Review the project validation issues, select the affected devices or cable, and correct or remove the invalid connection before relying on optical results.",
      parameters: [],
      affectedNodeIds: [...new Set(affectedNodeIds.length ? affectedNodeIds : [path.ontNodeId])],
    };
  }

  if (reason === "no_directed_path_from_olt") return {
    category: "topology",
    summary: "No directed optical path from an OLT reaches this ONT.",
    resolution: "Connect the devices with validated directed links from OLT through the distribution network to this ONT. Geographic proximity or a standalone cable route does not create a topology connection.",
    parameters: [], affectedNodeIds: [path.ontNodeId],
  };
  if (reason === "multiple_directed_paths_from_olt") return {
    category: "topology",
    summary: "More than one OLT-to-ONT path reaches this ONT.",
    resolution: "Review upstream links and remove the unintended feed. The simulator does not merge multiple OLT sources into one passive path.",
    parameters: [], affectedNodeIds: [path.ontNodeId],
  };
  if (reason === "unknown_splitter_ratio" || splitterNodeIds.length > 0) return {
    category: "optical configuration",
    summary: "A splitter on this path has no usable configured ratio and insertion loss.",
    resolution: "Select the named splitter and configure its physical ratio and actual insertion loss from the device documentation. Theoretical split loss is not substituted for device insertion loss.",
    parameters: params("unknown").filter((item) => item.name.toLowerCase().includes("splitter")),
    affectedNodeIds: splitterNodeIds,
  };
  if (reason === "legacy_fallback_parameters" || legacyParameters.length > 0) return {
    category: "optical configuration",
    summary: "This saved project's optical values have no recorded source, so the engine withholds PASS/FAIL classification.",
    resolution: "Review the inherited planning assumptions against your equipment and project design, then explicitly apply the documented illustrative profile or configure the parameters from source documentation. Legacy values are retained for partial calculations and are not treated as verified specifications.",
    parameters: legacyParameters,
    affectedNodeIds: [path.ontNodeId],
  };
  if (reason === "missing_optical_parameter" || unknownParameters.length > 0) return {
    category: "optical configuration",
    summary: "One or more inputs needed for a defensible optical result are unknown.",
    resolution: "Configure each listed value with its stated unit and source. Route length and other independently known partial results remain available.",
    parameters: unknownParameters,
    affectedNodeIds: [path.ontNodeId],
  };
  const reasonText: Record<string, string> = {
    rx_power_below_sensitivity: "Physical received power is below the configured ONT sensitivity limit.",
    rx_power_exceeds_overload: "Physical received power exceeds the configured ONT overload limit.",
    insufficient_safety_margin: "The configured minimum design margin is not met after reserve.",
    optical_budget_within_limits: "All returned physical receiver limits and configured design-margin limits pass.",
  };
  if (path.status === "fail") return {
    category: "engineering result", summary: reasonText[reason] ?? "A mandatory optical constraint failed.",
    resolution: "Review the path loss and receiver values above, then adjust the design or correct equipment data. The simulator has not altered the calculation.",
    parameters: [], affectedNodeIds: [path.ontNodeId],
  };
  if (path.status === "warning") return {
    category: "engineering result", summary: "The backend classified this path as a warning.",
    resolution: reasonText[reason] ?? "Review the backend warning and the applicable engineering threshold before accepting this design.",
    parameters: [], affectedNodeIds: [path.ontNodeId],
  };
  return {
    category: "engineering result", summary: reasonText[reason] ?? (reason || "The backend did not return a complete optical determination."),
    resolution: "Review the path, its source parameters, and any project validation issues before relying on this result.",
    parameters: [], affectedNodeIds: [path.ontNodeId],
  };
}
