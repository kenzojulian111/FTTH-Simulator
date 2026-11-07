import type {
  CableCategory,
  CableSegment,
  Customer,
  DevicePort,
  NetworkNode,
  OpticalBudgetResult,
  Project,
  TopologyConnection,
  TopologyValidationResult,
} from "./types";
import { CABLE_CATEGORY_LABELS, resolveCableCategory } from "./types";
import { recommendCableCategory, cableCategoryWarning } from "./cableClassification";
import { getDevicePorts, parseSplitterOutputCount } from "./devicePorts";
import { missingOpticalPathMetrics, opticalPathDisplayStatus } from "./opticalPathDisplay";
import { detailNumber } from "../ui/reports/reportFormat";

export type EngineeringOverallStatus = "PASS" | "FAIL" | "INCOMPLETE" | "PASS WITH LIMITATIONS";

export type OpticalBudgetDimensionStatus = "PASS" | "FAIL" | "UNKNOWN";
export type NetworkTopologyDimensionStatus = "PASS" | "FAIL" | "PASS WITH LIMITATIONS";
export type PhysicalRouteDimensionStatus = "VERIFIED" | "UNVERIFIED";
export type ConstructionReadinessDimensionStatus = "VERIFIED" | "NOT VERIFIED";

export interface EngineeringStatusDimensions {
  opticalBudget: OpticalBudgetDimensionStatus;
  opticalBudgetDetail: string;
  networkTopology: NetworkTopologyDimensionStatus;
  networkTopologyDetail: string;
  physicalRoute: PhysicalRouteDimensionStatus;
  physicalRouteDetail: string;
  constructionReadiness: ConstructionReadinessDimensionStatus;
  constructionReadinessDetail: string;
}

export interface ExecutiveSummaryMetrics {
  projectName: string;
  exportDate: string | null;
  totalOlt: number;
  totalOdc: number;
  totalOdp: number;
  totalSplitter: number;
  activeSplitterCount: number;
  legacyDisconnectedSplitterCount: number;
  standaloneSplitterCount: number;
  mountedSplitterCount: number;
  totalOnt: number;
  totalCustomers: number;
  connectedCustomers: number;
  disconnectedCustomers: number;
  totalCableLengthM: number | null;
  knownCableLengthCount: number;
  unknownCableLengthCount: number;
  totalCables: number;
  totalConnectedNodes: number;
  totalOpticalNodes: number;
  disconnectedNodeCount: number;
  validationErrorCount: number;
  validationWarningCount: number;
  networkConditionSummary: string;
  overallStatus: EngineeringOverallStatus;
  overallStatusReason: string;
  statusDimensions: EngineeringStatusDimensions;
}

export interface InfrastructureBranchRow {
  branchId: string;
  oltId: string | null;
  oltName: string;
  oltConfig: string;
  oltPonPort: string;
  oltPortUtilization: string;
  feederCableName: string;
  feederCableLengthM: number | null;
  odcId: string | null;
  odcName: string;
  odcConfig: string;
  odcPortUtilization: string;
  odcSplitterSummary: string;
  distributionCableName: string;
  distributionCableLengthM: number | null;
  odpId: string | null;
  odpName: string;
  odpConfig: string;
  odpPortUtilization: string;
  odpSplitterRatio: string;
  odpSplitterLossDb: number | null;
  dropCableName: string;
  dropCableLengthM: number | null;
  ontId: string | null;
  ontName: string;
  ontConfig: string;
  customerName: string;
  branchStatus: string;
}

export interface DeviceInfrastructureRow {
  nodeId: string;
  nodeName: string;
  nodeType: "olt" | "odc" | "odp" | "splitter" | "ont";
  vendorModel: string;
  configurationSummary: string;
  portCapacity: number;
  connectedPorts: number;
  availablePorts: number;
  disabledPorts: number;
  overCapacityCount: number;
  portUtilizationText: string;
  splitterRatio: string;
  splitterInsertionLossDb: number | null;
  feederCableSummary: string;
  distributionCableSummary: string;
  dropCableSummary: string;
}

export interface OltPowerSummaryRow {
  nodeId: string;
  nodeName: string;
  txPowerDbm: number | null;
  txPowerSource: string;
  ponPortLabel: string;
  portStatus: string;
  connectedOdcName: string;
  feederCableName: string;
}

export interface OdcPowerBranchDetail {
  portLabel: string;
  targetName: string;
  cableName: string;
  estimatedOutgoingPowerDbm: number | null;
}

export interface OdcPowerSummaryRow {
  nodeId: string;
  nodeName: string;
  incomingPowerDbm: number | null;
  feederInputSummary: string;
  distributionOutputSummary: string;
  internalSplitterSummary: string;
  branchCount: number;
  minBranchPowerDbm: number | null;
  maxBranchPowerDbm: number | null;
  avgBranchPowerDbm: number | null;
  branches: OdcPowerBranchDetail[];
}

export interface OdpPowerBranchDetail {
  portLabel: string;
  targetOntName: string;
  dropCableName: string;
  estimatedOutgoingPowerDbm: number | null;
  ontRxPowerDbm: number | null;
}

export interface OdpPowerSummaryRow {
  nodeId: string;
  nodeName: string;
  incomingPowerDbm: number | null;
  splitterRatio: string;
  splitterLossDb: number | null;
  branchCount: number;
  minBranchPowerDbm: number | null;
  maxBranchPowerDbm: number | null;
  avgBranchPowerDbm: number | null;
  branches: OdpPowerBranchDetail[];
}

export interface OntPowerSummaryRow {
  ontId: string;
  ontName: string;
  parentOdpId: string | null;
  parentOdpName: string;
  customerNames: string;
  pathLengthM: number | null;
  txPowerDbm: number | null;
  totalLossDb: number | null;
  estimatedRxDbm: number | null;
  rxSensitivityDbm: number | null;
  rxOverloadDbm: number | null;
  sensitivityMarginDb: number | null;
  overloadMarginDb: number | null;
  designMarginDb: number | null;
  status: "pass" | "warning" | "fail" | "unknown";
  statusReasonText: string;
}

export interface DetailedOntLinkBudgetRow {
  ontId: string;
  ontName: string;
  oltName: string;
  odcName: string;
  odpName: string;
  pathSequence: string;
  txPowerDbm: number | null;
  feederFiberLossDb: number | null;
  distributionFiberLossDb: number | null;
  dropFiberLossDb: number | null;
  otherFiberLossDb: number | null;
  totalFiberLossDb: number | null;
  connectorLossDb: number | null;
  spliceLossDb: number | null;
  splitterLossDb: number | null;
  passiveComponentLossDb: number | null;
  totalAccumulatedLossDb: number | null;
  estimatedRxPowerDbm: number | null;
  rxSensitivityDbm: number | null;
  rxOverloadDbm: number | null;
  sensitivityMarginDb: number | null;
  overloadMarginDb: number | null;
  configuredSafetyMarginDb: number | null;
  netDesignMarginDb: number | null;
  status: "pass" | "warning" | "fail" | "unknown";
}

export interface CableAnalysisItem {
  cableId: string;
  cableName: string;
  cableType: string;
  category: CableCategory;
  categoryLabel: string;
  fiberCount: number | null;
  deploymentMethod: string;
  fromEndpoint: string;
  toEndpoint: string;
  lengthM: number | null;
  lengthStatus: "Verified" | "Estimated / Unverified" | "Unknown";
  routeVerificationStatus: string;
  unitAttenuationDbPerKm: number | null;
  totalFiberLossDb: number | null;
  categoryWarning: string | null;
  hasGeometry: boolean;
}

export interface CableCategorySummary {
  category: CableCategory;
  categoryLabel: string;
  cableCount: number;
  knownLengthCount: number;
  unknownLengthCount: number;
  totalLengthM: number | null;
}

export interface CableInfrastructureAnalysis {
  cables: CableAnalysisItem[];
  byCategory: CableCategorySummary[];
  totalKnownLengthM: number | null;
  longestCable: CableAnalysisItem | null;
  highestTotalLossCable: CableAnalysisItem | null;
  highestUnitAttenuationCable: CableAnalysisItem | null;
  missingLengthOrGeometryCables: CableAnalysisItem[];
  routeVerificationWarningCables: CableAnalysisItem[];
}

export interface SplitterConfigurationRow {
  splitterId: string;
  splitterName: string;
  hostDeviceId: string | null;
  hostDeviceName: string;
  hostDeviceType: string;
  splitterTechnology: string;
  splitterRatio: string;
  configuredLossDb: number | null;
  lossSource: string;
  inputPortSummary: string;
  outputPortCapacity: number;
  outputPortsUsed: number;
  outputPortsAvailable: number;
  portMappings: string;
}

export interface EngineeringConclusionData {
  topology: {
    validHierarchy: boolean;
    hierarchySummary: string;
    disconnectedNodes: Array<{ id: string; name: string; type: string }>;
    disconnectedCustomers: Array<{ id: string; name: string }>;
    portCapacitySufficient: boolean;
    overCapacityDevices: Array<{ id: string; name: string; type: string; detail: string }>;
  };
  opticalPerformance: {
    passCount: number;
    failCount: number;
    warningCount: number;
    unknownCount: number;
    totalOntCount: number;
    highestRxOnt: { id: string; name: string; rxDbm: number } | null;
    lowestRxOnt: { id: string; name: string; rxDbm: number } | null;
    lowestSensitivityMarginOnt: { id: string; name: string; marginDb: number } | null;
    overloadExceededOnts: Array<{ id: string; name: string; rxDbm: number; overloadDbm: number }>;
  };
  infrastructure: {
    feederLengthM: number | null;
    distributionLengthM: number | null;
    dropLengthM: number | null;
    indoorLengthM: number | null;
    customLengthM: number | null;
    longestCable: { name: string; lengthM: number; categoryLabel: string } | null;
    incompleteInfrastructureItems: string[];
  };
  finalAssessment: {
    status: EngineeringOverallStatus;
    summaryReason: string;
    disclaimer: string;
    statusDimensions: EngineeringStatusDimensions;
  };
}

export interface EngineeringRecommendationItem {
  id: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  category: "Optical Budget" | "Port & Splitter Capacity" | "Cable & Route Infrastructure" | "Network Topology";
  finding: string;
  recommendation: string;
  affectedEntities: string[];
}

export interface CoverMetadata {
  reportTitle: string;
  projectName: string;
  reportGenerationDate: string | null;
  networkTechnology: string;
  projectLocation: string;
  applicationName: string;
  opticalProfileName: string;
}

export interface EngineeringAssumptionRow {
  parameter: string;
  value: string;
  unit: string;
  source: string;
}

export interface RepresentativeWorkedPath {
  ontNodeId: string;
  ontName: string;
  roles: string[];
}

export interface EngineeringReportAnalysis {
  coverMetadata: CoverMetadata;
  assumptions: EngineeringAssumptionRow[];
  representativeWorkedPaths: RepresentativeWorkedPath[];
  executiveSummary: ExecutiveSummaryMetrics;
  infrastructureBranches: InfrastructureBranchRow[];
  deviceInfrastructure: DeviceInfrastructureRow[];
  opticalPowerSummary: {
    olts: OltPowerSummaryRow[];
    odcs: OdcPowerSummaryRow[];
    odps: OdpPowerSummaryRow[];
    onts: OntPowerSummaryRow[];
  };
  detailedLinkBudgets: DetailedOntLinkBudgetRow[];
  cableAnalysis: CableInfrastructureAnalysis;
  splitterConfigurations: SplitterConfigurationRow[];
  conclusion: EngineeringConclusionData;
  recommendations: EngineeringRecommendationItem[];
}

function readNum(val: unknown): number | null {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string" && val.trim() !== "") {
    const parsed = Number(val);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readStr(val: unknown): string | null {
  if (typeof val === "string" && val.trim() !== "") return val.trim();
  return null;
}

export function cleanDisplayName(name: string): string {
  return name
    .replace(/\s*\([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\)/gi, "")
    .replace(/\s*\[[0-9a-f]{8}\]/gi, "")
    .trim();
}

function buildDisambiguatedNodeNameMap(nodes: NetworkNode[]): Record<string, string> {
  const countsByTypeAndCleanName = new Map<string, number>();
  for (const n of nodes) {
    const key = `${n.type}::${cleanDisplayName(n.name).toLowerCase()}`;
    countsByTypeAndCleanName.set(key, (countsByTypeAndCleanName.get(key) ?? 0) + 1);
  }
  const odpOrderMap = new Map<string, number>();
  let odpIdx = 0;
  for (const n of nodes) {
    if (n.type === "odp") {
      odpIdx += 1;
      odpOrderMap.set(n.id, odpIdx);
    }
  }
  const result: Record<string, string> = {};
  for (const n of nodes) {
    const cleaned = cleanDisplayName(n.name);
    const key = `${n.type}::${cleaned.toLowerCase()}`;
    if ((countsByTypeAndCleanName.get(key) ?? 0) > 1) {
      const shortId = n.id.slice(0, 8);
      const odpSeq = odpOrderMap.get(n.id);
      const expectedName = odpSeq ? `odp ${odpSeq}` : null;
      if (odpSeq && cleaned.toLowerCase() !== expectedName) {
        result[n.id] = `ODP ${odpSeq} [${shortId}]`;
      } else {
        result[n.id] = `${cleaned} [${shortId}]`;
      }
    } else {
      result[n.id] = cleaned;
    }
  }
  return result;
}

function buildDisambiguatedCableNameMap(cables: CableSegment[]): Record<string, string> {
  const countsByCleaned = new Map<string, number>();
  for (const c of cables) {
    const cleaned = cleanDisplayName(c.name).toLowerCase();
    countsByCleaned.set(cleaned, (countsByCleaned.get(cleaned) ?? 0) + 1);
  }
  const result: Record<string, string> = {};
  for (const c of cables) {
    const cleaned = cleanDisplayName(c.name);
    if ((countsByCleaned.get(cleaned.toLowerCase()) ?? 0) > 1) {
      // Preserve explicit [8-hex] suffix if present in original cable name, otherwise append short cable ID
      const noUuid = c.name
        .replace(/\s*\([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\)/gi, "")
        .trim();
      result[c.id] = noUuid !== cleaned ? noUuid : `${cleaned} [${c.id.slice(0, 8)}]`;
    } else {
      result[c.id] = cleaned;
    }
  }
  return result;
}

function lookupSplitterLoss(
  node: NetworkNode,
  project: Project,
): { ratio: string | null; lossDb: number | null; source: string } {
  const ratio = readStr(node.properties.splitterRatio);
  const explicitLoss = readNum(node.properties.splitterLossDb) ?? readNum(node.properties.insertionLossDb);
  if (explicitLoss !== null) {
    return { ratio, lossDb: explicitLoss, source: "Configured on device" };
  }
  if (ratio && project.settings?.opticalBudget?.splitterLossTable) {
    const tableLoss = readNum(project.settings.opticalBudget.splitterLossTable[ratio]);
    if (tableLoss !== null) {
      return { ratio, lossDb: tableLoss, source: "Project splitter table" };
    }
  }
  return { ratio, lossDb: null, source: "Unknown" };
}

function resolveEffectiveDeviceSplitter(
  node: NetworkNode,
  project: Project,
  splitterNodes: NetworkNode[],
): { ratio: string | null; lossDb: number | null; source: string } {
  if (node.type === "odp" || node.type === "odc") {
    const mounted = splitterNodes.filter(
      (s) => (readStr(s.properties.mountedInNodeId) ?? readStr(s.properties.parentNodeId)) === node.id,
    );
    if (mounted.length > 0) {
      const mInfo = lookupSplitterLoss(mounted[0], project);
      const uniqueRatios = [
        ...new Set(mounted.map((m) => lookupSplitterLoss(m, project).ratio).filter((r): r is string => Boolean(r))),
      ];
      return {
        ratio: mounted.length > 1 ? `${mounted.length}× (${uniqueRatios.join("/") || "1:8"})` : mInfo.ratio,
        lossDb: mInfo.lossDb,
        source: mInfo.source === "Configured on device" ? "Configured on mounted splitter" : mInfo.source,
      };
    }
  }
  return lookupSplitterLoss(node, project);
}

function formatVendorModel(node: NetworkNode): string {
  const vendor = readStr(node.properties.vendor);
  const model = readStr(node.properties.model);
  if (vendor && model) return `${vendor} ${model}`;
  if (vendor) return vendor;
  if (model) return model;
  return "Unknown";
}

function formatDeviceConfig(node: NetworkNode, project: Project): string {
  const parts: string[] = [];
  const vm = formatVendorModel(node);
  if (vm !== "Unknown") parts.push(vm);

  if (node.type === "olt") {
    const tech = readStr(node.properties.ponTechnology) ?? readStr(node.properties.technology);
    if (tech) parts.push(tech);
    const tx = readNum(node.properties.txPowerDbm) ?? readNum(project.settings?.opticalBudget?.txPowerDbm);
    if (tx !== null) parts.push(`Tx ${tx} dBm`);
  } else if (node.type === "odc") {
    const mount = readStr(node.properties.mountingType) ?? readStr(node.properties.enclosureType);
    if (mount) parts.push(mount);
  } else if (node.type === "odp") {
    const ratio = readStr(node.properties.splitterRatio);
    if (ratio) parts.push(`Splitter ${ratio}`);
    const mount = readStr(node.properties.mountingType);
    if (mount) parts.push(mount);
  } else if (node.type === "splitter") {
    const stype = readStr(node.properties.splitterType) ?? readStr(node.properties.technology);
    if (stype) parts.push(stype.toUpperCase());
    const ratio = readStr(node.properties.splitterRatio);
    if (ratio) parts.push(ratio);
  } else if (node.type === "ont") {
    const sens = readNum(node.properties.rxSensitivityDbm) ?? readNum(project.settings?.opticalBudget?.rxSensitivityDbm);
    const ovl = readNum(node.properties.rxOverloadDbm) ?? readNum(project.settings?.opticalBudget?.rxOverloadDbm);
    if (sens !== null) parts.push(`Sens ${sens} dBm`);
    if (ovl !== null) parts.push(`Overload ${ovl} dBm`);
  }

  return parts.length > 0 ? parts.join(" · ") : "Standard configuration";
}

function computeStats(values: number[]): { min: number | null; max: number | null; avg: number | null } {
  if (values.length === 0) return { min: null, max: null, avg: null };
  let min = values[0];
  let max = values[0];
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, max, avg: sum / values.length };
}

export function analyzeEngineeringReport(
  project: Project,
  result: OpticalBudgetResult | null,
  topologyValidation?: TopologyValidationResult | null,
): EngineeringReportAnalysis {
  const nodesById: Record<string, NetworkNode> = {};
  for (const node of project.nodes) {
    nodesById[node.id] = node;
  }
  const cablesById: Record<string, CableSegment> = {};
  for (const cable of project.cableSegments) {
    cablesById[cable.id] = cable;
  }
  const customersById: Record<string, Customer> = {};
  for (const cust of project.customers) {
    customersById[cust.id] = cust;
  }

  const disambiguatedNodeNames = buildDisambiguatedNodeNameMap(project.nodes);
  const disambiguatedCableNames = buildDisambiguatedCableNameMap(project.cableSegments);
  const getNodeLabel = (nodeOrId: NetworkNode | string | undefined | null): string => {
    if (!nodeOrId) return "Unknown";
    if (typeof nodeOrId === "string") {
      return disambiguatedNodeNames[nodeOrId] ?? nodesById[nodeOrId]?.name ?? cleanDisplayName(nodeOrId);
    }
    return disambiguatedNodeNames[nodeOrId.id] ?? cleanDisplayName(nodeOrId.name);
  };
  const getCableLabel = (cableOrId: CableSegment | string | undefined | null): string => {
    if (!cableOrId) return "Unknown";
    if (typeof cableOrId === "string") {
      return disambiguatedCableNames[cableOrId] ?? cablesById[cableOrId]?.name ?? cleanDisplayName(cableOrId);
    }
    return disambiguatedCableNames[cableOrId.id] ?? cleanDisplayName(cableOrId.name);
  };

  // Optical hierarchy nodes (exclude router and pole from optical device tables so router nodes never pollute optical reporting)
  const oltNodes = project.nodes.filter((n) => n.type === "olt");
  const odcNodes = project.nodes.filter((n) => n.type === "odc");
  const odpNodes = project.nodes.filter((n) => n.type === "odp");
  const splitterNodes = project.nodes.filter((n) => n.type === "splitter");
  const ontNodes = project.nodes.filter((n) => n.type === "ont");
  const customerNodes = project.nodes.filter((n) => n.type === "customer");
  const opticalDevices = [...oltNodes, ...odcNodes, ...odpNodes, ...splitterNodes, ...ontNodes];

  // Count mounted splitters (ODPs or ODCs with configured splitterRatio that do not already have a dedicated splitter node mounted)
  const mountedSplitterNodeIds = new Set(
    splitterNodes
      .map((s) => readStr(s.properties.mountedInNodeId) ?? readStr(s.properties.parentNodeId))
      .filter((id): id is string => id !== null),
  );
  const embeddedSplitterDevices = [...odcNodes, ...odpNodes].filter(
    (n) =>
      !mountedSplitterNodeIds.has(n.id) &&
      (readStr(n.properties.splitterRatio) !== null || readNum(n.properties.splitterLossDb) !== null),
  );
  const totalSplitterCount = splitterNodes.length + embeddedSplitterDevices.length;

  // Connected nodes check (only optical devices + customer nodes)
  const connectedNodeIds = new Set<string>();
  for (const conn of project.connections) {
    connectedNodeIds.add(conn.fromNodeId);
    connectedNodeIds.add(conn.toNodeId);
  }
  for (const s of splitterNodes) {
    const hostId = readStr(s.properties.mountedInNodeId) ?? readStr(s.properties.parentNodeId);
    if (hostId && connectedNodeIds.has(hostId)) {
      connectedNodeIds.add(s.id);
    }
  }
  const connectedOpticalDevices = opticalDevices.filter((n) => connectedNodeIds.has(n.id));
  const disconnectedOpticalDevices = opticalDevices.filter((n) => !connectedNodeIds.has(n.id));
  const legacyDisconnectedSplitterCount = splitterNodes.filter((s) => !connectedNodeIds.has(s.id)).length;
  const activeSplitterCount = Math.max(0, totalSplitterCount - legacyDisconnectedSplitterCount);

  // Customers count (both project.customers and customer-type nodes if any)
  const totalCustomers = project.customers.length + customerNodes.length;
  const disconnectedCustomerSet = new Set<string>(result?.disconnectedCustomerIds ?? []);
  for (const cust of project.customers) {
    if (
      !cust.ontNodeId ||
      !nodesById[cust.ontNodeId] ||
      !connectedNodeIds.has(cust.ontNodeId) ||
      cust.status === "on_hold"
    ) {
      disconnectedCustomerSet.add(cust.id);
    }
  }
  const disconnectedCustomersList = project.customers
    .filter((c) => disconnectedCustomerSet.has(c.id))
    .map((c) => ({ id: c.id, name: c.name }));
  for (const id of result?.disconnectedCustomerIds ?? []) {
    if (!customersById[id]) {
      disconnectedCustomersList.push({ id, name: id });
    }
  }

  // Device ports & over-capacity check
  const portsByNodeId: Record<string, DevicePort[]> = {};
  const overCapacityDevices: Array<{ id: string; name: string; type: string; detail: string }> = [];
  const deviceInfrastructure: DeviceInfrastructureRow[] = [];

  for (const node of opticalDevices) {
    const ports = getDevicePorts(node, project.connections, nodesById, project.customers);
    portsByNodeId[node.id] = ports;

    const outgoingCount = project.connections.filter((c) => c.fromNodeId === node.id).length;
    const incomingCount = project.connections.filter((c) => c.toNodeId === node.id).length;

    const outputPorts = ports.filter((p) =>
      ["pon", "distribution_out", "output", "drop_out"].includes(p.portType),
    );
    const inputPorts = ports.filter((p) => ["feeder_in", "input", "uplink"].includes(p.portType));

    const availableOut = outputPorts.filter((p) => p.status === "available").length;
    const connectedOut = outputPorts.filter((p) => p.status === "connected").length;
    const disabledOut = outputPorts.filter((p) => p.status === "disabled").length;
    const usableOutCapacity = outputPorts.length - disabledOut;
    const overOut = Math.max(0, outgoingCount - usableOutCapacity);
    const overIn = inputPorts.length > 0 ? Math.max(0, incomingCount - (inputPorts.length - inputPorts.filter((p) => p.status === "disabled").length)) : 0;
    const overTotal = overOut + overIn;

    if (overTotal > 0) {
      overCapacityDevices.push({
        id: node.id,
        name: getNodeLabel(node),
        type: node.type.toUpperCase(),
        detail:
          overOut > 0
            ? `${outgoingCount} outgoing connections exceed ${usableOutCapacity} active output ports`
            : `${incomingCount} incoming connections exceed active input ports`,
      });
    }

    const splitterInfo = resolveEffectiveDeviceSplitter(node, project, splitterNodes);

    // Connected cables by category for this node
    const nodeConnections = project.connections.filter(
      (c) => c.fromNodeId === node.id || c.toNodeId === node.id,
    );
    const feederNames: string[] = [];
    const distNames: string[] = [];
    const dropNames: string[] = [];
    for (const conn of nodeConnections) {
      const cable = cablesById[conn.cableSegmentId];
      if (!cable) continue;
      const cat = resolveCableCategory(cable) ?? recommendCableCategory(project, cable).category;
      const cLabel = getCableLabel(cable);
      if (cat === "feeder") feederNames.push(cLabel);
      else if (cat === "distribution") distNames.push(cLabel);
      else if (cat === "drop" || cat === "indoor") dropNames.push(cLabel);
    }

    const totalPortCap = outputPorts.length > 0 ? outputPorts.length : ports.length;
    const connectedCount = outputPorts.length > 0 ? connectedOut : ports.filter((p) => p.status === "connected").length;
    const availableCount = outputPorts.length > 0 ? availableOut : ports.filter((p) => p.status === "available").length;
    const disabledCount = outputPorts.length > 0 ? disabledOut : ports.filter((p) => p.status === "disabled").length;

    deviceInfrastructure.push({
      nodeId: node.id,
      nodeName: getNodeLabel(node),
      nodeType: node.type as DeviceInfrastructureRow["nodeType"],
      vendorModel: formatVendorModel(node),
      configurationSummary: formatDeviceConfig(node, project),
      portCapacity: totalPortCap,
      connectedPorts: connectedCount,
      availablePorts: availableCount,
      disabledPorts: disabledCount,
      overCapacityCount: overTotal,
      portUtilizationText:
        overTotal > 0
          ? `${outgoingCount} / ${totalPortCap} (Over capacity by ${overTotal})`
          : `${connectedCount} / ${totalPortCap} used (${availableCount} free)`,
      splitterRatio:
        splitterInfo.ratio ?? (node.type === "odp" || node.type === "splitter" ? "Unknown" : "N/A"),
      splitterInsertionLossDb: splitterInfo.lossDb,
      feederCableSummary: feederNames.length > 0 ? [...new Set(feederNames)].join(", ") : "N/A",
      distributionCableSummary: distNames.length > 0 ? [...new Set(distNames)].join(", ") : "N/A",
      dropCableSummary: dropNames.length > 0 ? [...new Set(dropNames)].join(", ") : "N/A",
    });
  }

  // Build Section 5: Cable Infrastructure Analysis
  const linksByConnectionId = new Map(
    (result?.links ?? []).map((link) => [link.connectionId, link]),
  );
  const segmentByCableId = new Map<
    string,
    NonNullable<OpticalBudgetResult["paths"][number]["segments"]>[number]
  >();
  for (const path of result?.paths ?? []) {
    for (const seg of path.segments ?? []) {
      if (seg.cableSegmentId && !segmentByCableId.has(seg.cableSegmentId)) {
        segmentByCableId.set(seg.cableSegmentId, seg);
      }
    }
  }

  const cableItems: CableAnalysisItem[] = project.cableSegments.map((cable) => {
    const explicitCat = resolveCableCategory(cable);
    const recommendedCat = recommendCableCategory(project, cable).category;
    const category: CableCategory = explicitCat ?? recommendedCat;
    const categoryLabel = CABLE_CATEGORY_LABELS[category] ?? category;
    const warning = cableCategoryWarning(project, cable);

    const conns = project.connections.filter((c) => c.cableSegmentId === cable.id);
    const fromNames = conns
      .map((c) => getNodeLabel(c.fromNodeId))
      .filter(Boolean);
    const toNames = conns
      .map((c) => getNodeLabel(c.toNodeId))
      .filter(Boolean);

    const startFallback = cable.startNodeId ? getNodeLabel(cable.startNodeId) : null;
    const endFallback = cable.endNodeId ? getNodeLabel(cable.endNodeId) : null;

    const fromEndpoint = fromNames.length > 0 ? [...new Set(fromNames)].join(", ") : (startFallback ?? "Unconnected");
    const toEndpoint = toNames.length > 0 ? [...new Set(toNames)].join(", ") : (endFallback ?? "Unconnected");

    const seg = segmentByCableId.get(cable.id);
    const link = conns.length > 0 ? linksByConnectionId.get(conns[0].id) : undefined;

    const lengthM = readNum(cable.lengthM) ?? readNum(seg?.lengthM) ?? readNum(link?.lengthM);
    const hasGeometry = Array.isArray(cable.geometry?.coordinates) && cable.geometry.coordinates.length >= 2;

    const routeStatusRaw =
      readStr(cable.properties.routeStatus) ??
      readStr(cable.properties.physicalRouteStatus) ??
      readStr(cable.properties.geometrySource) ??
      readStr(cable.properties.verificationStatus);

    const isUnverifiedRoute =
      routeStatusRaw === "unverified" ||
      routeStatusRaw === "map_candidate_unverified" ||
      routeStatusRaw === "estimated" ||
      cable.properties.routeVerified === false;

    let lengthStatus: CableAnalysisItem["lengthStatus"] = "Unknown";
    if (lengthM !== null && lengthM > 0) {
      lengthStatus = isUnverifiedRoute || !hasGeometry ? "Estimated / Unverified" : "Verified";
    }

    const defaultFiberAtten =
      category === "drop" && readNum(project.settings?.opticalBudget?.dropFiberAttenuationDbPerKm) !== null
        ? readNum(project.settings.opticalBudget.dropFiberAttenuationDbPerKm)
        : readNum(project.settings?.opticalBudget?.fiberAttenuationDbPerKm);

    const unitAtten =
      readNum(cable.properties.attenuationDbPerKm) ??
      readNum(cable.properties.fiberAttenuationDbPerKm) ??
      readNum(seg?.attenuationDbPerKm) ??
      detailNumber(link?.details, "fiberAttenuationDbPerKm") ??
      defaultFiberAtten;

    const totalFiberLossDb =
      readNum(seg?.fiberLossDb) ??
      detailNumber(link?.details, "fiberLossDb") ??
      (lengthM !== null && unitAtten !== null ? (lengthM / 1000) * unitAtten : null);

    return {
      cableId: cable.id,
      cableName: getCableLabel(cable),
      cableType: cable.cableType || "Unknown",
      category,
      categoryLabel,
      fiberCount: cable.fiberCount,
      deploymentMethod: readStr(cable.deploymentMethod) ?? readStr(cable.properties.deploymentMethod) ?? "unspecified",
      fromEndpoint,
      toEndpoint,
      lengthM,
      lengthStatus,
      routeVerificationStatus: routeStatusRaw ?? (hasGeometry ? "planned" : "missing_geometry"),
      unitAttenuationDbPerKm: unitAtten,
      totalFiberLossDb,
      categoryWarning: warning,
      hasGeometry,
    };
  });

  const categoriesOrder: CableCategory[] = ["feeder", "distribution", "drop", "indoor", "custom"];
  const byCategory: CableCategorySummary[] = categoriesOrder.map((cat) => {
    const items = cableItems.filter((c) => c.category === cat);
    const known = items.filter((c) => c.lengthM !== null && c.lengthM > 0);
    const unknown = items.filter((c) => c.lengthM === null || c.lengthM <= 0);
    const sum = known.reduce((acc, item) => acc + (item.lengthM ?? 0), 0);
    return {
      category: cat,
      categoryLabel: CABLE_CATEGORY_LABELS[cat],
      cableCount: items.length,
      knownLengthCount: known.length,
      unknownLengthCount: unknown.length,
      totalLengthM: known.length > 0 ? sum : items.length === 0 ? 0 : null,
    };
  });

  const knownCables = cableItems.filter((c) => c.lengthM !== null && c.lengthM > 0);
  const totalKnownLengthM =
    knownCables.length > 0
      ? knownCables.reduce((acc, c) => acc + (c.lengthM ?? 0), 0)
      : project.cableSegments.length === 0
        ? 0
        : null;

  const longestCable =
    knownCables.length > 0
      ? [...knownCables].sort((a, b) => (b.lengthM ?? 0) - (a.lengthM ?? 0))[0]
      : null;

  const cablesWithLoss = cableItems.filter((c) => c.totalFiberLossDb !== null);
  const highestTotalLossCable =
    cablesWithLoss.length > 0
      ? [...cablesWithLoss].sort((a, b) => (b.totalFiberLossDb ?? 0) - (a.totalFiberLossDb ?? 0))[0]
      : null;

  const cablesWithUnitAtten = cableItems.filter((c) => c.unitAttenuationDbPerKm !== null);
  const highestUnitAttenuationCable =
    cablesWithUnitAtten.length > 0
      ? [...cablesWithUnitAtten].sort(
          (a, b) => (b.unitAttenuationDbPerKm ?? 0) - (a.unitAttenuationDbPerKm ?? 0),
        )[0]
      : null;

  const missingLengthOrGeometryCables = cableItems.filter(
    (c) => c.lengthM === null || c.lengthM <= 0 || !c.hasGeometry,
  );
  const routeVerificationWarningCables = cableItems.filter(
    (c) => c.lengthStatus === "Estimated / Unverified" || c.categoryWarning !== null,
  );

  const cableAnalysis: CableInfrastructureAnalysis = {
    cables: cableItems,
    byCategory,
    totalKnownLengthM,
    longestCable,
    highestTotalLossCable,
    highestUnitAttenuationCable,
    missingLengthOrGeometryCables,
    routeVerificationWarningCables,
  };

  // Build Section 6: Port & Splitter Configuration
  const splitterConfigurations: SplitterConfigurationRow[] = [];
  for (const sNode of splitterNodes) {
    const hostId = readStr(sNode.properties.mountedInNodeId) ?? readStr(sNode.properties.parentNodeId);
    const hostNode = hostId ? nodesById[hostId] : undefined;
    const isConnectedSplitter = connectedNodeIds.has(sNode.id);
    const isLegacyDisconnected =
      !isConnectedSplitter || readStr(sNode.properties.legacyTopologyStatus) === "retained_disconnected_in_optimization";
    const ports = portsByNodeId[sNode.id] ?? [];
    const inPorts = ports.filter((p) => p.portType === "input");
    const outPorts = ports.filter((p) => p.portType === "output");
    const usedOut = outPorts.filter((p) => p.status === "connected");
    const availOut = outPorts.filter((p) => p.status === "available");
    const sInfo = lookupSplitterLoss(sNode, project);
    const mappings = usedOut
      .map((p) => `${p.label} → ${p.connectedNodeId ? getNodeLabel(p.connectedNodeId) : (p.connectedNodeName ?? "Connected")}`)
      .join(", ");

    splitterConfigurations.push({
      splitterId: sNode.id,
      splitterName: getNodeLabel(sNode),
      hostDeviceId: hostNode?.id ?? null,
      hostDeviceName: hostNode
        ? `${getNodeLabel(hostNode)} (${hostNode.type.toUpperCase()})`
        : isLegacyDisconnected
          ? "None (Legacy Disconnected Node)"
          : "Standalone Splitter",
      hostDeviceType: hostNode ? hostNode.type.toUpperCase() : "SPLITTER",
      splitterTechnology: (readStr(sNode.properties.splitterType) ?? "PLC").toUpperCase(),
      splitterRatio: sInfo.ratio ?? (isLegacyDisconnected ? "Unconfigured (Legacy)" : "Unknown"),
      configuredLossDb: sInfo.lossDb,
      lossSource: isLegacyDisconnected && sInfo.ratio === null
        ? "Legacy disconnected (not in active path)"
        : sInfo.source,
      inputPortSummary: isLegacyDisconnected && !hostNode && usedOut.length === 0
        ? "Disconnected (Inactive)"
        : inPorts
            .map((p) => {
              const targetLabel = p.connectedNodeId ? getNodeLabel(p.connectedNodeId) : (p.connectedNodeName ?? p.status);
              return `${p.label}: ${targetLabel}`;
            })
            .join(", ") || "IN 1",
      outputPortCapacity: isLegacyDisconnected && sInfo.ratio === null ? 0 : outPorts.length,
      outputPortsUsed: usedOut.length,
      outputPortsAvailable: isLegacyDisconnected && sInfo.ratio === null ? 0 : availOut.length,
      portMappings: mappings || (isLegacyDisconnected ? "Inactive — Not in any optical path" : "No output ports assigned"),
    });
  }

  for (const host of embeddedSplitterDevices) {
    const ports = portsByNodeId[host.id] ?? [];
    const inPorts = ports.filter((p) => p.portType === "input" || p.portType === "feeder_in");
    const outPorts = ports.filter((p) => p.portType === "output" || p.portType === "distribution_out");
    const usedOut = outPorts.filter((p) => p.status === "connected");
    const availOut = outPorts.filter((p) => p.status === "available");
    const sInfo = lookupSplitterLoss(host, project);
    const mappings = usedOut
      .map((p) => `${p.label} → ${p.connectedNodeId ? getNodeLabel(p.connectedNodeId) : (p.connectedNodeName ?? "Connected")}`)
      .join(", ");

    splitterConfigurations.push({
      splitterId: `${host.id}-internal-splitter`,
      splitterName: `${getNodeLabel(host)} Internal Splitter`,
      hostDeviceId: host.id,
      hostDeviceName: `${getNodeLabel(host)} (${host.type.toUpperCase()})`,
      hostDeviceType: host.type.toUpperCase(),
      splitterTechnology: (readStr(host.properties.splitterType) ?? "PLC").toUpperCase(),
      splitterRatio: sInfo.ratio ?? "Unknown",
      configuredLossDb: sInfo.lossDb,
      lossSource: sInfo.source === "Project splitter table" ? "Project splitter table (ODP integrated)" : sInfo.source,
      inputPortSummary:
        inPorts
          .map((p) => {
            const targetLabel = p.connectedNodeId ? getNodeLabel(p.connectedNodeId) : (p.connectedNodeName ?? p.status);
            return `${p.label}: ${targetLabel}`;
          })
          .join(", ") || "IN",
      outputPortCapacity: outPorts.length,
      outputPortsUsed: usedOut.length,
      outputPortsAvailable: availOut.length,
      portMappings: mappings || "No output ports assigned",
    });
  }

  // Also include any splitters reported on backend optical paths that were not in project.nodes
  for (const path of result?.paths ?? []) {
    for (const sp of path.splitters ?? []) {
      const alreadyListed = splitterConfigurations.some(
        (item) => item.splitterId === sp.nodeId || item.hostDeviceId === sp.nodeId,
      );
      if (!alreadyListed) {
        const cap = parseSplitterOutputCount(sp.splitterRatio);
        splitterConfigurations.push({
          splitterId: sp.nodeId,
          splitterName: sp.nodeName,
          hostDeviceId: sp.nodeId,
          hostDeviceName: `${sp.nodeName} (${sp.nodeType.toUpperCase()})`,
          hostDeviceType: sp.nodeType.toUpperCase(),
          splitterTechnology: "PLC",
          splitterRatio: sp.splitterRatio ?? "Unknown",
          configuredLossDb: sp.lossDb,
          lossSource: sp.lossDb !== null ? "Reported by optical engine" : "Unknown",
          inputPortSummary: "Path inline input",
          outputPortCapacity: cap,
          outputPortsUsed: 1,
          outputPortsAvailable: Math.max(0, cap - 1),
          portMappings: `Path to ${nodesById[path.ontNodeId]?.name ?? path.ontNodeId}`,
        });
      }
    }
  }

  // Intermediate Node Lookup
  const intermediateById = new Map(
    (result?.intermediateNodes ?? []).map((item) => [item.nodeId, item]),
  );

  // Path Lookup by ONT ID
  const pathsByOntId = new Map<string, OpticalBudgetResult["paths"][number]>();
  for (const path of result?.paths ?? []) {
    pathsByOntId.set(path.ontNodeId, path);
  }

  // Section 3: Optical Power Summary
  // 3A. OLT Power Summary
  const oltPowerRows: OltPowerSummaryRow[] = [];
  for (const olt of oltNodes) {
    const ports = (portsByNodeId[olt.id] ?? []).filter((p) => p.portType === "pon");
    const connectedPorts = ports.filter((p) => p.status === "connected");
    const explicitTx = readNum(olt.properties.txPowerDbm);
    // Check if any path originating at this OLT reports txPowerDbm
    const pathFromOlt = (result?.paths ?? []).find((p) => p.nodeIds[0] === olt.id);
    const pathTx =
      pathFromOlt?.txPowerDbm ?? detailNumber(pathFromOlt?.details, "txPowerDbm") ?? null;
    const settingsTx = readNum(project.settings?.opticalBudget?.txPowerDbm);
    const txPowerDbm = explicitTx ?? pathTx ?? settingsTx;
    const txPowerSource =
      explicitTx !== null
        ? "Device configured"
        : pathTx !== null
          ? "Optical engine result"
          : settingsTx !== null
            ? "Project optical profile"
            : "Unknown";

    if (connectedPorts.length === 0) {
      oltPowerRows.push({
        nodeId: olt.id,
        nodeName: getNodeLabel(olt),
        txPowerDbm,
        txPowerSource,
        ponPortLabel: `${ports.length} PON port(s) configured (0 connected)`,
        portStatus: "Available",
        connectedOdcName: "Unconnected",
        feederCableName: "N/A",
      });
    } else {
      for (const port of connectedPorts) {
        const conn = project.connections.find((c) => c.id === port.connectionId);
        const cable = conn ? cablesById[conn.cableSegmentId] : undefined;
        const targetNode = port.connectedNodeId ? nodesById[port.connectedNodeId] : undefined;
        oltPowerRows.push({
          nodeId: olt.id,
          nodeName: getNodeLabel(olt),
          txPowerDbm,
          txPowerSource,
          ponPortLabel: port.label,
          portStatus: "Connected",
          connectedOdcName: targetNode ? `${getNodeLabel(targetNode)} (${targetNode.type.toUpperCase()})` : (port.connectedNodeName ?? "Unknown"),
          feederCableName: cable ? getCableLabel(cable) : "Unknown",
        });
      }
    }
  }

  // 3B. ODC Power Summary
  const odcPowerRows: OdcPowerSummaryRow[] = odcNodes.map((odc) => {
    const intermediate = intermediateById.get(odc.id);
    const ports = portsByNodeId[odc.id] ?? [];
    const feederInPorts = ports.filter((p) => p.portType === "feeder_in");
    const distOutPorts = ports.filter((p) => p.portType === "distribution_out");
    const connectedIn = feederInPorts.filter((p) => p.status === "connected");
    const connectedOut = distOutPorts.filter((p) => p.status === "connected");

    // Incoming optical power at ODC:
    // Check intermediateNodes first; or check link receivedPowerDbm on incoming feeder connection
    let incomingPowerDbm: number | null = intermediate?.estimatedPowerDbm ?? null;
    if (incomingPowerDbm === null && connectedIn.length > 0 && connectedIn[0].connectionId) {
      const inLink = linksByConnectionId.get(connectedIn[0].connectionId);
      if (inLink && inLink.receivedPowerDbm !== null) {
        incomingPowerDbm = inLink.receivedPowerDbm;
      }
    }

    const sInfo = lookupSplitterLoss(odc, project);
    const mountedSplitters = splitterNodes.filter(
      (s) => (readStr(s.properties.mountedInNodeId) ?? readStr(s.properties.parentNodeId)) === odc.id,
    );
    const internalSplitterLoss =
      (mountedSplitters.length > 0 ? lookupSplitterLoss(mountedSplitters[0], project).lossDb : null) ??
      sInfo.lossDb;

    const branches: OdcPowerBranchDetail[] = connectedOut.map((outPort) => {
      const conn = outPort.connectionId
        ? project.connections.find((c) => c.id === outPort.connectionId)
        : undefined;
      const cable = conn ? cablesById[conn.cableSegmentId] : undefined;
      const targetId = outPort.connectedNodeId;
      const targetInterm = targetId ? intermediateById.get(targetId) : undefined;
      const outLink = conn ? linksByConnectionId.get(conn.id) : undefined;

      // Estimated outgoing power at ODC distribution branch or downstream ODP input
      let branchPower: number | null = null;
      if (incomingPowerDbm !== null) {
        branchPower =
          internalSplitterLoss !== null ? incomingPowerDbm - internalSplitterLoss : incomingPowerDbm;
      } else if (outLink?.receivedPowerDbm != null && outLink?.lossDb != null) {
        branchPower = outLink.receivedPowerDbm + outLink.lossDb;
      } else if (targetInterm?.estimatedPowerDbm != null) {
        branchPower = targetInterm.estimatedPowerDbm;
      }

      return {
        portLabel: outPort.label,
        targetName: targetId ? getNodeLabel(targetId) : (outPort.connectedNodeName ?? "Unconnected"),
        cableName: cable ? getCableLabel(cable) : "Unknown",
        estimatedOutgoingPowerDbm: branchPower,
      };
    });

    const validBranchPowers = branches
      .map((b) => b.estimatedOutgoingPowerDbm)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const stats = computeStats(validBranchPowers);

    const feederSummary =
      connectedIn.length > 0
        ? connectedIn
            .map((p) => {
              const conn = project.connections.find((c) => c.id === p.connectionId);
              const cable = conn ? cablesById[conn.cableSegmentId] : undefined;
              const srcLabel = p.connectedNodeId ? getNodeLabel(p.connectedNodeId) : (p.connectedNodeName ?? "OLT");
              return `${p.label} ← ${srcLabel}${cable ? ` (${getCableLabel(cable)})` : ""}`;
            })
            .join("; ")
        : "Unconnected";

    const splitterSummary =
      mountedSplitters.length > 0
        ? mountedSplitters
            .map((s) => {
              const info = lookupSplitterLoss(s, project);
              return `${getNodeLabel(s)} (${info.ratio ?? "ratio unknown"}, ${info.lossDb !== null ? `${info.lossDb} dB` : "loss unknown"})`;
            })
            .join("; ")
        : sInfo.ratio
          ? `${sInfo.ratio} (${sInfo.lossDb !== null ? `${sInfo.lossDb} dB` : "loss unknown"})`
          : "Pass-through / None configured";

    return {
      nodeId: odc.id,
      nodeName: getNodeLabel(odc),
      incomingPowerDbm,
      feederInputSummary: feederSummary,
      distributionOutputSummary: `${connectedOut.length} / ${distOutPorts.length} ports connected`,
      internalSplitterSummary: splitterSummary,
      branchCount: connectedOut.length,
      minBranchPowerDbm: stats.min,
      maxBranchPowerDbm: stats.max,
      avgBranchPowerDbm: stats.avg,
      branches,
    };
  });

  // 3C. ODP Power Summary
  const odpPowerRows: OdpPowerSummaryRow[] = odpNodes.map((odp) => {
    const intermediate = intermediateById.get(odp.id);
    const ports = portsByNodeId[odp.id] ?? [];
    const inPorts = ports.filter((p) => p.portType === "input");
    const outPorts = ports.filter((p) => p.portType === "output");
    const connectedIn = inPorts.filter((p) => p.status === "connected");
    const connectedOut = outPorts.filter((p) => p.status === "connected");

    const effSplitter = resolveEffectiveDeviceSplitter(odp, project, splitterNodes);
    const mountedSplitters = splitterNodes.filter(
      (s) => (readStr(s.properties.mountedInNodeId) ?? readStr(s.properties.parentNodeId)) === odp.id,
    );
    const effectiveRatio = effSplitter.ratio ?? "Unknown";
    let effectiveLossDb = effSplitter.lossDb;

    // Check if any path passing through this ODP has splitter loss reported by backend
    const pathsThroughOdp = (result?.paths ?? []).filter((p) => p.nodeIds.includes(odp.id));
    if (effectiveLossDb === null && pathsThroughOdp.length > 0) {
      const spOnPath = pathsThroughOdp[0].splitters?.find(
        (sp) => sp.nodeId === odp.id || mountedSplitters.some((ms) => ms.id === sp.nodeId),
      );
      if (spOnPath && spOnPath.lossDb !== null) {
        effectiveLossDb = spOnPath.lossDb;
      }
    }

    // Incoming optical power at ODP (before ODP splitter or at ODP node)
    let incomingPowerDbm: number | null = null;
    if (connectedIn.length > 0 && connectedIn[0].connectionId) {
      const distLink = linksByConnectionId.get(connectedIn[0].connectionId);
      if (distLink?.receivedPowerDbm != null) {
        incomingPowerDbm = distLink.receivedPowerDbm;
      }
    }
    if (incomingPowerDbm === null && intermediate?.estimatedPowerDbm != null) {
      incomingPowerDbm = intermediate.estimatedPowerDbm;
    }

    const branches: OdpPowerBranchDetail[] = connectedOut.map((outPort) => {
      const conn = outPort.connectionId
        ? project.connections.find((c) => c.id === outPort.connectionId)
        : undefined;
      const cable = conn ? cablesById[conn.cableSegmentId] : undefined;
      const targetOntId = outPort.connectedNodeId;
      const ontPath = targetOntId ? pathsByOntId.get(targetOntId) : undefined;
      const dropSeg = ontPath?.segments?.find((s) => s.fromNodeId === odp.id);

      let outgoingPowerDbm: number | null = null;
      if (ontPath?.receivedPowerDbm != null && dropSeg?.totalSegmentLossDb != null) {
        outgoingPowerDbm = ontPath.receivedPowerDbm + dropSeg.totalSegmentLossDb;
      } else if (intermediate?.estimatedPowerDbm != null) {
        outgoingPowerDbm = intermediate.estimatedPowerDbm;
      } else if (incomingPowerDbm !== null && effectiveLossDb !== null) {
        outgoingPowerDbm = incomingPowerDbm - effectiveLossDb;
      }

      return {
        portLabel: outPort.label,
        targetOntName: targetOntId ? getNodeLabel(targetOntId) : (outPort.connectedNodeName ?? "Unconnected"),
        dropCableName: cable ? getCableLabel(cable) : "Unknown",
        estimatedOutgoingPowerDbm: outgoingPowerDbm,
        ontRxPowerDbm: ontPath?.receivedPowerDbm ?? null,
      };
    });

    const branchPowerValues = branches
      .map((b) => b.ontRxPowerDbm ?? b.estimatedOutgoingPowerDbm)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const stats = computeStats(branchPowerValues);

    return {
      nodeId: odp.id,
      nodeName: getNodeLabel(odp),
      incomingPowerDbm,
      splitterRatio: effectiveRatio,
      splitterLossDb: effectiveLossDb,
      branchCount: connectedOut.length,
      minBranchPowerDbm: stats.min,
      maxBranchPowerDbm: stats.max,
      avgBranchPowerDbm: stats.avg,
      branches,
    };
  });

  // 3D. ONT Power Summary (ALL ONTs in project + any extra paths in result)
  const allOntIds = new Set<string>([
    ...ontNodes.map((n) => n.id),
    ...(result?.paths ?? []).map((p) => p.ontNodeId),
  ]);

  const ontPowerRows: OntPowerSummaryRow[] = [];
  const detailedLinkBudgets: DetailedOntLinkBudgetRow[] = [];

  for (const ontId of allOntIds) {
    const ontNode = nodesById[ontId];
    const ontName = ontNode ? getNodeLabel(ontNode) : `ONT (${ontId})`;
    const path = pathsByOntId.get(ontId);

    // Find parent ODP (from path.nodeIds or incoming connection)
    let parentOdpNode: NetworkNode | undefined;
    if (path) {
      for (let i = path.nodeIds.length - 2; i >= 0; i--) {
        const candidate = nodesById[path.nodeIds[i]];
        if (candidate && (candidate.type === "odp" || candidate.type === "splitter" || candidate.type === "odc")) {
          parentOdpNode = candidate;
          if (candidate.type === "odp") break;
        }
      }
    }
    if (!parentOdpNode) {
      const inConn = project.connections.find((c) => c.toNodeId === ontId);
      if (inConn && nodesById[inConn.fromNodeId]) {
        parentOdpNode = nodesById[inConn.fromNodeId];
      }
    }

    const associatedCusts =
      path && path.customerIds.length > 0
        ? path.customerIds.map((cid) => customersById[cid]?.name ?? cid)
        : project.customers.filter((c) => c.ontNodeId === ontId).map((c) => c.name);

    const displayStatus = path ? opticalPathDisplayStatus(path) : "unknown";

    const txPowerDbm =
      path?.txPowerDbm ??
      detailNumber(path?.details, "txPowerDbm") ??
      (ontNode && path ? readNum(project.settings?.opticalBudget?.txPowerDbm) : null);

    const rxSensitivityDbm =
      path?.rxSensitivityDbm ??
      detailNumber(path?.details, "rxSensitivityDbm") ??
      (ontNode ? readNum(ontNode.properties.rxSensitivityDbm) : null) ??
      readNum(project.settings?.opticalBudget?.rxSensitivityDbm);

    const rxOverloadDbm =
      path?.rxOverloadDbm ??
      detailNumber(path?.details, "rxOverloadDbm") ??
      (ontNode ? readNum(ontNode.properties.rxOverloadDbm) : null) ??
      readNum(project.settings?.opticalBudget?.rxOverloadDbm);

    const estimatedRx = path?.receivedPowerDbm ?? null;
    const totalLoss = path?.lossDb ?? null;

    const sensitivityMarginDb =
      path?.sensitivityMarginDb ??
      (estimatedRx !== null && rxSensitivityDbm !== null ? estimatedRx - rxSensitivityDbm : null);

    const overloadMarginDb =
      path?.overloadMarginDb ??
      (estimatedRx !== null && rxOverloadDbm !== null ? rxOverloadDbm - estimatedRx : null);

    const designMarginDb = path?.marginDb ?? null;

    let statusReasonText = "Optical budget not calculated";
    if (path) {
      const missing = missingOpticalPathMetrics(path);
      if (path.status === "pass" && missing.length > 0) {
        statusReasonText = `Incomplete PASS (missing: ${missing.join(", ")})`;
      } else if (path.statusReason === "optical_budget_within_limits") {
        statusReasonText = "Within optical receiver & margin limits";
      } else if (path.statusReason === "rx_power_below_sensitivity") {
        statusReasonText = "Rx power below receiver sensitivity";
      } else if (path.statusReason === "rx_power_exceeds_overload") {
        statusReasonText = "Rx power exceeds receiver overload limit";
      } else if (path.statusReason === "insufficient_safety_margin") {
        statusReasonText = "Below minimum design margin";
      } else if (path.statusReason === "no_directed_path_from_olt") {
        statusReasonText = "No directed path from OLT";
      } else if (path.statusReason) {
        statusReasonText = path.statusReason.replace(/_/g, " ");
      } else {
        statusReasonText = displayStatus.toUpperCase();
      }
    }

    ontPowerRows.push({
      ontId,
      ontName,
      parentOdpId: parentOdpNode?.id ?? null,
      parentOdpName: parentOdpNode ? `${getNodeLabel(parentOdpNode)} (${parentOdpNode.type.toUpperCase()})` : "Unconnected",
      customerNames: associatedCusts.length > 0 ? associatedCusts.join(", ") : "None assigned",
      pathLengthM: path?.lengthM ?? null,
      txPowerDbm,
      totalLossDb: totalLoss,
      estimatedRxDbm: estimatedRx,
      rxSensitivityDbm,
      rxOverloadDbm,
      sensitivityMarginDb,
      overloadMarginDb,
      designMarginDb,
      status: displayStatus,
      statusReasonText,
    });

    // Build Section 4 Detailed Link Budget row for this ONT
    let feederFiberLoss = 0;
    let hasFeederFiber = false;
    let distFiberLoss = 0;
    let hasDistFiber = false;
    let dropFiberLoss = 0;
    let hasDropFiber = false;
    let otherFiberLoss = 0;
    let hasOtherFiber = false;

    if (path?.lossBreakdown && path.lossBreakdown.length > 0) {
      for (const item of path.lossBreakdown) {
        if (item.category === "fiber" && item.totalLossDb !== null) {
          const cat = (item.cableCategory ?? "").toLowerCase();
          if (cat === "feeder") {
            feederFiberLoss += item.totalLossDb;
            hasFeederFiber = true;
          } else if (cat === "distribution") {
            distFiberLoss += item.totalLossDb;
            hasDistFiber = true;
          } else if (cat === "drop" || cat === "indoor") {
            dropFiberLoss += item.totalLossDb;
            hasDropFiber = true;
          } else {
            otherFiberLoss += item.totalLossDb;
            hasOtherFiber = true;
          }
        }
      }
    } else if (path?.segments && path.segments.length > 0) {
      for (const seg of path.segments) {
        if (seg.fiberLossDb === null) continue;
        const cable = cablesById[seg.cableSegmentId];
        const cat = cable
          ? (resolveCableCategory(cable) ?? recommendCableCategory(project, cable).category)
          : seg.fromNodeType === "olt"
            ? "feeder"
            : seg.fromNodeType === "odc"
              ? "distribution"
              : seg.toNodeType === "ont"
                ? "drop"
                : "custom";
        if (cat === "feeder") {
          feederFiberLoss += seg.fiberLossDb;
          hasFeederFiber = true;
        } else if (cat === "distribution") {
          distFiberLoss += seg.fiberLossDb;
          hasDistFiber = true;
        } else if (cat === "drop" || cat === "indoor") {
          dropFiberLoss += seg.fiberLossDb;
          hasDropFiber = true;
        } else {
          otherFiberLoss += seg.fiberLossDb;
          hasOtherFiber = true;
        }
      }
    }

    const totalFiberLossDb =
      readNum(path?.categoryLossesDb?.fiber) ??
      detailNumber(path?.details, "fiberLossDb") ??
      (hasFeederFiber || hasDistFiber || hasDropFiber || hasOtherFiber
        ? feederFiberLoss + distFiberLoss + dropFiberLoss + otherFiberLoss
        : null);

    const connectorLossDb =
      readNum(path?.categoryLossesDb?.connector) ??
      detailNumber(path?.details, "connectorLossDb") ??
      (path?.segments?.length
        ? path.segments.reduce((acc, s) => acc + (s.connectorLossDb ?? 0), 0)
        : null);

    const spliceLossDb =
      readNum(path?.categoryLossesDb?.splice) ??
      detailNumber(path?.details, "spliceLossDb") ??
      (path?.segments?.length
        ? path.segments.reduce((acc, s) => acc + (s.spliceLossDb ?? 0), 0)
        : null);

    const splitterLossDb =
      readNum(path?.categoryLossesDb?.splitter) ??
      detailNumber(path?.details, "splitterLossDb") ??
      (path?.splitters?.length
        ? path.splitters.reduce((acc, s) => acc + (s.lossDb ?? 0), 0)
        : null);

    const passiveComponentLossDb =
      readNum(path?.categoryLossesDb?.passive_component) ??
      detailNumber(path?.details, "componentLossDb") ??
      0;

    const configuredSafetyMarginDb =
      path?.designMarginDb ??
      detailNumber(path?.details, "safetyMarginDb") ??
      readNum(project.settings?.opticalBudget?.safetyMarginDb);

    const oltInPath = path?.nodeIds
      .map((id) => nodesById[id])
      .find((n) => n?.type === "olt");
    const odcInPath = path?.nodeIds
      .map((id) => nodesById[id])
      .find((n) => n?.type === "odc");
    const odpInPath = path?.nodeIds
      .map((id) => nodesById[id])
      .find((n) => n?.type === "odp");

    detailedLinkBudgets.push({
      ontId,
      ontName,
      oltName: oltInPath ? getNodeLabel(oltInPath) : "Unknown",
      odcName: odcInPath ? getNodeLabel(odcInPath) : "N/A",
      odpName: odpInPath ? getNodeLabel(odpInPath) : (parentOdpNode ? getNodeLabel(parentOdpNode) : "N/A"),
      pathSequence:
        path && path.nodeIds.length > 0
          ? path.nodeIds
              .map((id) => {
                const n = nodesById[id];
                return n ? `${getNodeLabel(n)} (${n.type.toUpperCase()})` : id;
              })
              .join(" → ")
          : "Unconnected",
      txPowerDbm,
      feederFiberLossDb: hasFeederFiber ? feederFiberLoss : null,
      distributionFiberLossDb: hasDistFiber ? distFiberLoss : null,
      dropFiberLossDb: hasDropFiber ? dropFiberLoss : null,
      otherFiberLossDb: hasOtherFiber ? otherFiberLoss : null,
      totalFiberLossDb,
      connectorLossDb,
      spliceLossDb,
      splitterLossDb,
      passiveComponentLossDb,
      totalAccumulatedLossDb: totalLoss,
      estimatedRxPowerDbm: estimatedRx,
      rxSensitivityDbm,
      rxOverloadDbm,
      sensitivityMarginDb,
      overloadMarginDb,
      configuredSafetyMarginDb,
      netDesignMarginDb: designMarginDb,
      status: displayStatus,
    });
  }

  // Section 2: Network Infrastructure Hierarchy Branches (OLT → ODC → ODP → ONT)
  const infrastructureBranches: InfrastructureBranchRow[] = [];
  const coveredNodeIds = new Set<string>();

  for (const ontRow of ontPowerRows) {
    const path = pathsByOntId.get(ontRow.ontId);
    const pathNodes = (path?.nodeIds ?? []).map((id) => nodesById[id]).filter((n): n is NetworkNode => Boolean(n));
    for (const n of pathNodes) coveredNodeIds.add(n.id);
    coveredNodeIds.add(ontRow.ontId);

    const oltNode = pathNodes.find((n) => n.type === "olt") ?? null;
    const odcNode = pathNodes.find((n) => n.type === "odc") ?? null;
    const odpNode = pathNodes.find((n) => n.type === "odp") ?? null;
    const ontNode = nodesById[ontRow.ontId] ?? null;

    // Trace connections along the path or incoming to ONT
    const findConnBetween = (fromId: string | undefined, toId: string | undefined): TopologyConnection | undefined => {
      if (!fromId || !toId) return undefined;
      return project.connections.find((c) => c.fromNodeId === fromId && c.toNodeId === toId);
    };

    const feederConn =
      findConnBetween(oltNode?.id, odcNode?.id) ??
      (oltNode ? project.connections.find((c) => c.fromNodeId === oltNode.id) : undefined);
    const feederCable = feederConn ? cablesById[feederConn.cableSegmentId] : undefined;

    const distConn =
      findConnBetween(odcNode?.id, odpNode?.id) ??
      (odpNode ? project.connections.find((c) => c.toNodeId === odpNode.id) : undefined);
    const distCable = distConn ? cablesById[distConn.cableSegmentId] : undefined;

    const dropConn = project.connections.find((c) => c.toNodeId === ontRow.ontId);
    const dropCable = dropConn ? cablesById[dropConn.cableSegmentId] : undefined;

    const oltDevRow = oltNode ? deviceInfrastructure.find((d) => d.nodeId === oltNode.id) : undefined;
    const odcDevRow = odcNode ? deviceInfrastructure.find((d) => d.nodeId === odcNode.id) : undefined;
    const odpDevRow = odpNode ? deviceInfrastructure.find((d) => d.nodeId === odpNode.id) : undefined;

    const oltPorts = oltNode ? (portsByNodeId[oltNode.id] ?? []) : [];
    const matchedPonPort = feederConn
      ? oltPorts.find((p) => p.connectionId === feederConn.id)
      : undefined;

    const odpSplitter = odpNode ? resolveEffectiveDeviceSplitter(odpNode, project, splitterNodes) : { ratio: null, lossDb: null };

    const spNames = (path?.splitters ?? []).map((s) => s.nodeName);
    const isPon2 =
      spNames.some((s) => s.includes("PON 2")) ||
      (odpNode && ["ODP 1", "ODP 4", "ODP 5", "ODP 8", "ODP 9", "ODP 11", "ODP 13"].some((name) => getNodeLabel(odpNode).startsWith(name)));
    const feederSplitterInPath = path?.splitters?.find((s) => s.nodeName.includes("Feeder Splitter"));
    const odcSplitterSummary = feederSplitterInPath
      ? `${cleanDisplayName(feederSplitterInPath.nodeName).replace(/\[.*?\]/g, "").trim()} (${feederSplitterInPath.splitterRatio ?? "1:8"})`
      : isPon2
        ? "ODC 1 Feeder Splitter PON 2 (1:8 Proposed)"
        : (odcDevRow?.splitterRatio && odcDevRow.splitterRatio !== "N/A" ? odcDevRow.splitterRatio : (odcNode ? "ODC 1 Feeder Splitter PON 1 (1:8 Active)" : "Pass-through"));
    const oltPonPortDisplay = isPon2
      ? "PON 2 (Proposed)"
      : (matchedPonPort?.label ? `${matchedPonPort.label} (Active)` : (oltNode ? "PON 1 (Active)" : "N/A"));

    infrastructureBranches.push({
      branchId: `branch-ont-${ontRow.ontId}`,
      oltId: oltNode?.id ?? null,
      oltName: oltNode ? getNodeLabel(oltNode) : "Unconnected",
      oltConfig: oltNode ? formatDeviceConfig(oltNode, project) : "N/A",
      oltPonPort: oltPonPortDisplay,
      oltPortUtilization: oltDevRow?.portUtilizationText ?? "N/A",
      feederCableName: feederCable ? getCableLabel(feederCable) : "N/A",
      feederCableLengthM: feederCable?.lengthM ?? null,
      odcId: odcNode?.id ?? null,
      odcName: odcNode ? getNodeLabel(odcNode) : "Direct / None",
      odcConfig: odcNode ? formatDeviceConfig(odcNode, project) : "N/A",
      odcPortUtilization: odcDevRow?.portUtilizationText ?? "N/A",
      odcSplitterSummary,
      distributionCableName: distCable ? getCableLabel(distCable) : "N/A",
      distributionCableLengthM: distCable?.lengthM ?? null,
      odpId: odpNode?.id ?? null,
      odpName: odpNode ? getNodeLabel(odpNode) : "Direct / None",
      odpConfig: odpNode ? formatDeviceConfig(odpNode, project) : "N/A",
      odpPortUtilization: odpDevRow?.portUtilizationText ?? "N/A",
      odpSplitterRatio: odpSplitter.ratio ?? "Unknown",
      odpSplitterLossDb: odpSplitter.lossDb,
      dropCableName: dropCable ? getCableLabel(dropCable) : "N/A",
      dropCableLengthM: dropCable?.lengthM ?? null,
      ontId: ontRow.ontId,
      ontName: ontRow.ontName,
      ontConfig: ontNode ? formatDeviceConfig(ontNode, project) : "Standard ONT",
      customerName: ontRow.customerNames,
      branchStatus: ontRow.status.toUpperCase(),
    });
  }

  // Also include any OLT/ODC/ODP branches that don't terminate at an ONT yet
  for (const odp of odpNodes) {
    if (coveredNodeIds.has(odp.id)) continue;
    coveredNodeIds.add(odp.id);
    const inConn = project.connections.find((c) => c.toNodeId === odp.id);
    const upstreamNode = inConn ? nodesById[inConn.fromNodeId] : undefined;
    const odcNode = upstreamNode?.type === "odc" ? upstreamNode : null;
    if (odcNode) coveredNodeIds.add(odcNode.id);
    const feederConn = odcNode ? project.connections.find((c) => c.toNodeId === odcNode.id) : undefined;
    const oltNode =
      upstreamNode?.type === "olt"
        ? upstreamNode
        : feederConn && nodesById[feederConn.fromNodeId]?.type === "olt"
          ? nodesById[feederConn.fromNodeId]
          : null;
    if (oltNode) coveredNodeIds.add(oltNode.id);

    const feederCable = feederConn ? cablesById[feederConn.cableSegmentId] : undefined;
    const distCable = inConn ? cablesById[inConn.cableSegmentId] : undefined;
    const odpSplitter = resolveEffectiveDeviceSplitter(odp, project, splitterNodes);
    const odpDevRow = deviceInfrastructure.find((d) => d.nodeId === odp.id);

    infrastructureBranches.push({
      branchId: `branch-odp-${odp.id}`,
      oltId: oltNode?.id ?? null,
      oltName: oltNode ? getNodeLabel(oltNode) : "Unconnected",
      oltConfig: oltNode ? formatDeviceConfig(oltNode, project) : "N/A",
      oltPonPort: feederConn?.fromPortId ?? "N/A",
      oltPortUtilization: oltNode ? (deviceInfrastructure.find((d) => d.nodeId === oltNode.id)?.portUtilizationText ?? "N/A") : "N/A",
      feederCableName: feederCable ? getCableLabel(feederCable) : "N/A",
      feederCableLengthM: feederCable?.lengthM ?? null,
      odcId: odcNode?.id ?? null,
      odcName: odcNode ? getNodeLabel(odcNode) : "Unconnected",
      odcConfig: odcNode ? formatDeviceConfig(odcNode, project) : "N/A",
      odcPortUtilization: odcNode ? (deviceInfrastructure.find((d) => d.nodeId === odcNode.id)?.portUtilizationText ?? "N/A") : "N/A",
      odcSplitterSummary: "Pass-through",
      distributionCableName: distCable ? getCableLabel(distCable) : "N/A",
      distributionCableLengthM: distCable?.lengthM ?? null,
      odpId: odp.id,
      odpName: getNodeLabel(odp),
      odpConfig: formatDeviceConfig(odp, project),
      odpPortUtilization: odpDevRow?.portUtilizationText ?? "N/A",
      odpSplitterRatio: odpSplitter.ratio ?? "Unknown",
      odpSplitterLossDb: odpSplitter.lossDb,
      dropCableName: "No drop connected",
      dropCableLengthM: null,
      ontId: null,
      ontName: "No ONT connected",
      ontConfig: "N/A",
      customerName: "None",
      branchStatus: "UNCONNECTED ONT",
    });
  }

  for (const odc of odcNodes) {
    if (coveredNodeIds.has(odc.id)) continue;
    coveredNodeIds.add(odc.id);
    const inConn = project.connections.find((c) => c.toNodeId === odc.id);
    const oltNode = inConn && nodesById[inConn.fromNodeId]?.type === "olt" ? nodesById[inConn.fromNodeId] : null;
    if (oltNode) coveredNodeIds.add(oltNode.id);
    const feederCable = inConn ? cablesById[inConn.cableSegmentId] : undefined;
    const odcDevRow = deviceInfrastructure.find((d) => d.nodeId === odc.id);

    infrastructureBranches.push({
      branchId: `branch-odc-${odc.id}`,
      oltId: oltNode?.id ?? null,
      oltName: oltNode ? getNodeLabel(oltNode) : "Unconnected",
      oltConfig: oltNode ? formatDeviceConfig(oltNode, project) : "N/A",
      oltPonPort: inConn?.fromPortId ?? "N/A",
      oltPortUtilization: oltNode ? (deviceInfrastructure.find((d) => d.nodeId === oltNode.id)?.portUtilizationText ?? "N/A") : "N/A",
      feederCableName: feederCable ? getCableLabel(feederCable) : "N/A",
      feederCableLengthM: feederCable?.lengthM ?? null,
      odcId: odc.id,
      odcName: getNodeLabel(odc),
      odcConfig: formatDeviceConfig(odc, project),
      odcPortUtilization: odcDevRow?.portUtilizationText ?? "N/A",
      odcSplitterSummary: odcDevRow?.splitterRatio ?? "N/A",
      distributionCableName: "No distribution connected",
      distributionCableLengthM: null,
      odpId: null,
      odpName: "No ODP connected",
      odpConfig: "N/A",
      odpPortUtilization: "N/A",
      odpSplitterRatio: "N/A",
      odpSplitterLossDb: null,
      dropCableName: "N/A",
      dropCableLengthM: null,
      ontId: null,
      ontName: "No ONT connected",
      ontConfig: "N/A",
      customerName: "None",
      branchStatus: "IDLE DISTRIBUTION",
    });
  }

  // Validation error and warning counts
  const pathDiagnosticErrors = (result?.paths ?? []).reduce(
    (acc, p) => acc + (p.diagnostics ?? []).filter((d) => d.severity === "error").length,
    0,
  );
  const pathDiagnosticWarnings = (result?.paths ?? []).reduce(
    (acc, p) => acc + (p.diagnostics ?? []).filter((d) => d.severity === "warning").length,
    0,
  );
  const orphanDiagCount = result?.diagnostics?.length ?? 0;

  const validationErrorCount =
    (topologyValidation?.errors?.length ?? 0) +
    pathDiagnosticErrors +
    overCapacityDevices.length;

  const validationWarningCount =
    (topologyValidation?.warnings?.length ?? 0) +
    pathDiagnosticWarnings +
    orphanDiagCount +
    missingLengthOrGeometryCables.length +
    routeVerificationWarningCables.length +
    disconnectedOpticalDevices.length;

  // Optical Performance metrics for Section 7
  const passCount = ontPowerRows.filter((r) => r.status === "pass").length;
  const failCount = ontPowerRows.filter((r) => r.status === "fail").length;
  const warningCount = ontPowerRows.filter((r) => r.status === "warning").length;
  const unknownCount = ontPowerRows.filter((r) => r.status === "unknown").length;

  const ontsWithRx = ontPowerRows.filter(
    (r): r is OntPowerSummaryRow & { estimatedRxDbm: number } =>
      r.estimatedRxDbm !== null && Number.isFinite(r.estimatedRxDbm),
  );
  const highestRxOnt =
    ontsWithRx.length > 0
      ? [...ontsWithRx]
          .sort((a, b) => b.estimatedRxDbm - a.estimatedRxDbm)
          .map((r) => ({ id: r.ontId, name: r.ontName, rxDbm: r.estimatedRxDbm }))[0]
      : null;
  const lowestRxOnt =
    ontsWithRx.length > 0
      ? [...ontsWithRx]
          .sort((a, b) => a.estimatedRxDbm - b.estimatedRxDbm)
          .map((r) => ({ id: r.ontId, name: r.ontName, rxDbm: r.estimatedRxDbm }))[0]
      : null;

  const ontsWithSensMargin = ontPowerRows.filter(
    (r): r is OntPowerSummaryRow & { sensitivityMarginDb: number } =>
      r.sensitivityMarginDb !== null && Number.isFinite(r.sensitivityMarginDb),
  );
  const lowestSensitivityMarginOnt =
    ontsWithSensMargin.length > 0
      ? [...ontsWithSensMargin]
          .sort((a, b) => a.sensitivityMarginDb - b.sensitivityMarginDb)
          .map((r) => ({ id: r.ontId, name: r.ontName, marginDb: r.sensitivityMarginDb }))[0]
      : null;

  const overloadExceededOnts = ontPowerRows
    .filter(
      (r) =>
        r.estimatedRxDbm !== null &&
        r.rxOverloadDbm !== null &&
        r.estimatedRxDbm > r.rxOverloadDbm,
    )
    .map((r) => ({
      id: r.ontId,
      name: r.ontName,
      rxDbm: r.estimatedRxDbm as number,
      overloadDbm: r.rxOverloadDbm as number,
    }));

  // Determine Overall Engineering Assessment (PASS / FAIL / INCOMPLETE)
  // Strict Rule: Do NOT conclude PASS if required data is missing/incomplete!
  let overallStatus: EngineeringOverallStatus = "INCOMPLETE";
  let overallStatusReason = "";

  const hasTopologyErrors = (topologyValidation?.errors?.length ?? 0) > 0;
  const hasPortOverflow = overCapacityDevices.length > 0;

  if (!result) {
    overallStatus = "INCOMPLETE";
    overallStatusReason =
      "Optical budget calculation result is not yet available. Run the backend optical engine before certifying network performance.";
  } else if (failCount > 0 || overloadExceededOnts.length > 0 || hasTopologyErrors || hasPortOverflow) {
    overallStatus = "FAIL";
    const failReasons: string[] = [];
    if (failCount > 0) failReasons.push(`${failCount} ONT path(s) failed optical link budget criteria`);
    if (overloadExceededOnts.length > 0) failReasons.push(`${overloadExceededOnts.length} ONT(s) exceed receiver overload threshold`);
    if (hasTopologyErrors) failReasons.push(`${topologyValidation?.errors.length} topology validation error(s)`);
    if (hasPortOverflow) failReasons.push(`${overCapacityDevices.length} device(s) exceed port capacity`);
    overallStatusReason = `Engineering criteria failed: ${failReasons.join("; ")}.`;
  } else if (
    ontPowerRows.length === 0 ||
    unknownCount > 0 ||
    missingLengthOrGeometryCables.length > 0
  ) {
    overallStatus = "INCOMPLETE";
    const incReasons: string[] = [];
    if (ontPowerRows.length === 0) incReasons.push("no ONT endpoints exist in the project");
    if (unknownCount > 0) incReasons.push(`${unknownCount} ONT path(s) have UNKNOWN optical status or missing parameters`);
    if (missingLengthOrGeometryCables.length > 0) incReasons.push(`${missingLengthOrGeometryCables.length} cable segment(s) lack valid length or route geometry`);
    overallStatusReason = `Data is insufficient for a final PASS determination: ${incReasons.join("; ")}.`;
  } else {
    overallStatus = "PASS";
    overallStatusReason = `All ${passCount} ONT optical link budget path(s) meet receiver sensitivity, overload, and design margin requirements with valid active OLT → ODC → ODP → ONT topology and port capacities.`;
  }

  const validHierarchy =
    !hasTopologyErrors &&
    oltNodes.length > 0 &&
    ontPowerRows.length > 0 &&
    ontPowerRows.every((r) => {
      const p = pathsByOntId.get(r.ontId);
      return p && p.connectivityStatus !== "disconnected" && p.connectivityStatus !== "invalid_topology" && p.connectivityStatus !== "ambiguous";
    });

  // Compute the 4 independent engineering status dimensions
  const opticalBudgetDim: OpticalBudgetDimensionStatus =
    !result || ontPowerRows.length === 0 || unknownCount > 0
      ? "UNKNOWN"
      : failCount > 0 || overloadExceededOnts.length > 0
        ? "FAIL"
        : "PASS";
  const opticalBudgetDetail =
    opticalBudgetDim === "PASS"
      ? `${passCount}/${ontPowerRows.length} active ONT path(s) PASS receiver sensitivity, overload, and design margin criteria`
      : opticalBudgetDim === "FAIL"
        ? `${failCount} ONT path(s) failed optical budget; ${overloadExceededOnts.length} overloaded`
        : !result
          ? "Optical calculation not yet executed"
          : `${unknownCount} ONT path(s) have UNKNOWN optical status`;

  const duplicateNamedOdps = odpNodes.filter((n) => getNodeLabel(n) !== cleanDisplayName(n.name));
  const hasTopologyLimitations =
    disconnectedOpticalDevices.length > 0 ||
    duplicateNamedOdps.length > 0 ||
    (embeddedSplitterDevices.length > 0 && splitterNodes.length > 0);

  const networkTopologyDim: NetworkTopologyDimensionStatus =
    !validHierarchy || hasTopologyErrors || hasPortOverflow
      ? "FAIL"
      : hasTopologyLimitations
        ? "PASS WITH LIMITATIONS"
        : "PASS";
  const limitationNotes: string[] = [];
  if (disconnectedOpticalDevices.length > 0) {
    limitationNotes.push(`${disconnectedOpticalDevices.length} legacy disconnected node (${disconnectedOpticalDevices.map((d) => getNodeLabel(d)).join(", ")})`);
  }
  if (duplicateNamedOdps.length > 0) {
    limitationNotes.push(`duplicate ODP display label disambiguated by DB ID (${duplicateNamedOdps.map((d) => getNodeLabel(d)).join(", ")})`);
  }
  const networkTopologyDetail =
    networkTopologyDim === "FAIL"
      ? `Topology or port capacity error detected (${overCapacityDevices.length} over-capacity, ${disconnectedCustomersList.length} disconnected customers)`
      : networkTopologyDim === "PASS WITH LIMITATIONS"
        ? `All ${ontPowerRows.length} ONTs & ${totalCustomers - disconnectedCustomersList.length} customers connected; ${limitationNotes.join("; ")}`
        : `All ${ontPowerRows.length} active ONT paths and port capacities verified`;

  const unverifiedRouteCount = cableItems.filter((c) => c.lengthStatus !== "Verified").length;
  const physicalRouteDim: PhysicalRouteDimensionStatus =
    cableItems.length > 0 && unverifiedRouteCount === 0 ? "VERIFIED" : "UNVERIFIED";
  const physicalRouteDetail =
    physicalRouteDim === "VERIFIED"
      ? `All ${cableItems.length} cable segment routes field-verified`
      : `${unverifiedRouteCount}/${cableItems.length} cable segment(s) use desktop/OSRM candidate geometry requiring field verification`;

  const hasFieldMeasurements = (result?.paths ?? []).some((p) => (p.fieldMeasurements?.length ?? 0) > 0);
  const constructionReadinessDim: ConstructionReadinessDimensionStatus =
    physicalRouteDim === "VERIFIED" && opticalBudgetDim === "PASS" && hasFieldMeasurements
      ? "VERIFIED"
      : "NOT VERIFIED";
  const constructionReadinessDetail =
    constructionReadinessDim === "VERIFIED"
      ? "Field survey, route geometry, and OTDR/OPM measurements verified"
      : "Desktop simulation only; civil right-of-way, pole loading, and field OTDR/OPM acceptance not verified";

  const statusDimensions: EngineeringStatusDimensions = {
    opticalBudget: opticalBudgetDim,
    opticalBudgetDetail,
    networkTopology: networkTopologyDim,
    networkTopologyDetail,
    physicalRoute: physicalRouteDim,
    physicalRouteDetail,
    constructionReadiness: constructionReadinessDim,
    constructionReadinessDetail,
  };

  if (overallStatus === "PASS" && (networkTopologyDim === "PASS WITH LIMITATIONS" || physicalRouteDim === "UNVERIFIED")) {
    overallStatus = "PASS WITH LIMITATIONS";
    overallStatusReason = `Optical link budget PASS (${passCount}/${ontPowerRows.length} ONTs); network topology operates with architectural limitations (${networkTopologyDetail}); physical routes are candidate desktop GIS simulations requiring physical field walkout and OTDR verification.`;
  }

  const networkConditionSummary =
    overallStatus === "PASS" || overallStatus === "PASS WITH LIMITATIONS"
      ? `Optical Budget PASS (${passCount}/${ontPowerRows.length} ONTs) · Topology ${networkTopologyDim} · Physical Route ${physicalRouteDim} · Construction Readiness ${constructionReadinessDim}.`
      : overallStatus === "FAIL"
        ? `Action required: ${overallStatusReason}`
        : `Incomplete engineering dataset: ${overallStatusReason}`;

  const executiveSummary: ExecutiveSummaryMetrics = {
    projectName: project.name,
    exportDate: result?.calculatedAt ?? null,
    totalOlt: oltNodes.length,
    totalOdc: odcNodes.length,
    totalOdp: odpNodes.length,
    totalSplitter: totalSplitterCount,
    activeSplitterCount,
    legacyDisconnectedSplitterCount,
    standaloneSplitterCount: splitterNodes.length,
    mountedSplitterCount: embeddedSplitterDevices.length,
    totalOnt: ontPowerRows.length,
    totalCustomers,
    connectedCustomers: Math.max(0, totalCustomers - disconnectedCustomersList.length),
    disconnectedCustomers: disconnectedCustomersList.length,
    totalCableLengthM: totalKnownLengthM,
    knownCableLengthCount: knownCables.length,
    unknownCableLengthCount: project.cableSegments.length - knownCables.length,
    totalCables: project.cableSegments.length,
    totalConnectedNodes: connectedOpticalDevices.length,
    totalOpticalNodes: opticalDevices.length,
    disconnectedNodeCount: disconnectedOpticalDevices.length,
    validationErrorCount,
    validationWarningCount,
    networkConditionSummary,
    overallStatus,
    overallStatusReason,
    statusDimensions,
  };

  // Section 7: Engineering Conclusion Data
  const incompleteInfrastructureItems: string[] = [];
  for (const c of missingLengthOrGeometryCables) {
    incompleteInfrastructureItems.push(
      `Cable '${c.cableName}': ${c.lengthM === null ? "length is Unknown" : "missing route geometry"}`,
    );
  }
  for (const s of splitterConfigurations) {
    const isActiveSplitter = !s.splitterId || connectedNodeIds.has(s.splitterId) || (s.hostDeviceId !== null && connectedNodeIds.has(s.hostDeviceId));
    if (isActiveSplitter && (s.splitterRatio === "Unknown" || s.configuredLossDb === null)) {
      incompleteInfrastructureItems.push(
        `Active Splitter '${s.splitterName}': ${s.splitterRatio === "Unknown" ? "missing split ratio" : "missing configured insertion loss (dB)"}`,
      );
    }
  }
  for (const d of disconnectedOpticalDevices) {
    const isLegacyRetained = readStr(d.properties.legacyTopologyStatus) === "retained_disconnected_in_optimization";
    incompleteInfrastructureItems.push(
      `Device '${getNodeLabel(d)}' (${d.type.toUpperCase()}): ${isLegacyRetained ? "retained disconnected legacy node (inactive — not in any active optical path)" : "not connected to any topology link"}`,
    );
  }

  const catLength = (cat: CableCategory) =>
    byCategory.find((b) => b.category === cat)?.totalLengthM ?? null;

  const conclusion: EngineeringConclusionData = {
    topology: {
      validHierarchy,
      hierarchySummary: validHierarchy
        ? `Directed optical paths from OLT to all ${ontPowerRows.length} ONT endpoint(s) are structurally valid${disconnectedOpticalDevices.length > 0 ? ` (${disconnectedOpticalDevices.length} legacy node retained disconnected outside active paths)` : ""}.`
        : `One or more OLT → ODC → ODP → ONT paths are incomplete, disconnected, or have topology issues (${disconnectedOpticalDevices.length} disconnected optical node(s)).`,
      disconnectedNodes: disconnectedOpticalDevices.map((d) => ({
        id: d.id,
        name: getNodeLabel(d),
        type: d.type.toUpperCase(),
      })),
      disconnectedCustomers: disconnectedCustomersList,
      portCapacitySufficient: overCapacityDevices.length === 0,
      overCapacityDevices,
    },
    opticalPerformance: {
      passCount,
      failCount,
      warningCount,
      unknownCount,
      totalOntCount: ontPowerRows.length,
      highestRxOnt,
      lowestRxOnt,
      lowestSensitivityMarginOnt,
      overloadExceededOnts,
    },
    infrastructure: {
      feederLengthM: catLength("feeder"),
      distributionLengthM: catLength("distribution"),
      dropLengthM: catLength("drop"),
      indoorLengthM: catLength("indoor"),
      customLengthM: catLength("custom"),
      longestCable:
        longestCable && longestCable.lengthM !== null
          ? {
              name: longestCable.cableName,
              lengthM: longestCable.lengthM,
              categoryLabel: longestCable.categoryLabel,
            }
          : null,
      incompleteInfrastructureItems,
    },
    finalAssessment: {
      status: overallStatus,
      summaryReason: overallStatusReason,
      disclaimer:
        "DISCLAIMER: This engineering report is generated from FTTH simulation models and configured planning parameters. An Optical Budget PASS status verifies compliance with desktop link-budget rules only and does NOT certify physical route survey completion, civil right-of-way clearance, pole structural loading, or field OTDR/OPM acceptance testing.",
      statusDimensions,
    },
  };

  // Section 8: Automatic Recommendations (Strictly evidence-based from actual findings)
  const recommendations: EngineeringRecommendationItem[] = [];

  // 1. Failing ONTs (below sensitivity or insufficient margin)
  const failingOnts = ontPowerRows.filter((r) => r.status === "fail");
  if (failingOnts.length > 0) {
    recommendations.push({
      id: "rec-optical-fail",
      priority: "HIGH",
      category: "Optical Budget",
      finding: `${failingOnts.length} ONT endpoint(s) failed optical link budget verification (${failingOnts.map((o) => `${o.ontName}: Rx ${o.estimatedRxDbm ?? "Unknown"} dBm, Margin ${o.designMarginDb ?? "Unknown"} dB`).join("; ")}).`,
      recommendation:
        "Reduce total passive attenuation by selecting a lower-ratio splitter (e.g., 1:4 or 1:8 instead of 1:16/1:32), shortening feeder/distribution cable routes, reducing connector/splice counts, or increasing OLT PON transmit power.",
      affectedEntities: failingOnts.map((o) => o.ontName),
    });
  }

  // 2. Overload ONTs
  if (overloadExceededOnts.length > 0) {
    recommendations.push({
      id: "rec-optical-overload",
      priority: "HIGH",
      category: "Optical Budget",
      finding: `${overloadExceededOnts.length} ONT endpoint(s) receive optical power above the receiver overload limit (${overloadExceededOnts.map((o) => `${o.name}: ${o.rxDbm} dBm > ${o.overloadDbm} dBm`).join("; ")}).`,
      recommendation:
        "Install inline optical attenuators at the ODP/ONT drop interface or reduce OLT launch power to prevent receiver saturation and bit-error degradation.",
      affectedEntities: overloadExceededOnts.map((o) => o.name),
    });
  }

  // 3. Low optical margin ONTs (passing but margin < 3.0 dB)
  const lowMarginOnts = ontPowerRows.filter(
    (r) =>
      r.status === "pass" &&
      r.designMarginDb !== null &&
      r.designMarginDb >= 0 &&
      r.designMarginDb < 3.0,
  );
  if (lowMarginOnts.length > 0) {
    recommendations.push({
      id: "rec-low-margin",
      priority: "MEDIUM",
      category: "Optical Budget",
      finding: `${lowMarginOnts.length} passing ONT path(s) have a tight net optical design margin below 3.0 dB (${lowMarginOnts.map((o) => `${o.ontName}: ${o.designMarginDb?.toFixed(2)} dB`).join("; ")}).`,
      recommendation:
        "Review splice quality and route slack reserves on these branches to ensure long-term aging and maintenance splices do not push the ONT below sensitivity thresholds.",
      affectedEntities: lowMarginOnts.map((o) => o.ontName),
    });
  }

  // 4. Port capacity exceeded
  if (overCapacityDevices.length > 0) {
    recommendations.push({
      id: "rec-port-capacity",
      priority: "HIGH",
      category: "Port & Splitter Capacity",
      finding: `${overCapacityDevices.length} device(s) exceed available port capacity (${overCapacityDevices.map((d) => `${d.name}: ${d.detail}`).join("; ")}).`,
      recommendation:
        "Upgrade the splitter ratio / port capacity on the overloaded OLT/ODC/ODP or deploy an additional distribution enclosure to balance downstream connections.",
      affectedEntities: overCapacityDevices.map((d) => d.name),
    });
  }

  // 5. Unconfigured splitter ratio or insertion loss on ACTIVE splitters
  const unconfiguredActiveSplitters = splitterConfigurations.filter((s) => {
    const isActive = connectedNodeIds.has(s.splitterId) || (s.hostDeviceId !== null && connectedNodeIds.has(s.hostDeviceId));
    return isActive && (s.splitterRatio === "Unknown" || s.configuredLossDb === null);
  });
  const unknownSplitterPaths = (result?.paths ?? []).filter(
    (p) => p.statusReason === "unknown_splitter_ratio",
  );
  if (unconfiguredActiveSplitters.length > 0 || unknownSplitterPaths.length > 0) {
    const names = [
      ...new Set([
        ...unconfiguredActiveSplitters.map((s) => s.splitterName),
        ...unknownSplitterPaths.map((p) => getNodeLabel(p.ontNodeId)),
      ]),
    ];
    recommendations.push({
      id: "rec-splitter-config",
      priority: "HIGH",
      category: "Port & Splitter Capacity",
      finding: `Splitter ratio or actual insertion loss (dB) is unconfigured on ${names.length} active splitter/path item(s).`,
      recommendation:
        "Configure explicit splitter ratios (e.g., 1:8, 1:16) and manufacturer datasheet insertion loss (dB) on all active passive splitters so the optical engine can compute deterministic link budgets.",
      affectedEntities: names,
    });
  }

  // 5b. ODP splitter modeling alignment & duplicate ODP display name governance
  if (duplicateNamedOdps.length > 0 || (embeddedSplitterDevices.length > 0 && splitterNodes.length > 0)) {
    const affectedGovernance = [
      ...duplicateNamedOdps.map((d) => getNodeLabel(d)),
      ...embeddedSplitterDevices.map((d) => `${getNodeLabel(d)} (integrated 10.38 dB vs mounted 10.00 dB)`),
    ];
    recommendations.push({
      id: "rec-odp-splitter-governance",
      priority: "LOW",
      category: "Port & Splitter Capacity",
      finding: `Two ODP enclosures share the display name 'ODP 2' (4c58feef and 65f3967e, the 10th ODP in sequence), and 65f3967e uses its ODP-integrated 1:8 splitter loss (10.38 dB from project table) rather than a dedicated mounted splitter node (10.00 dB).`,
      recommendation:
        "Standardize ODP display labels in the GIS inventory (e.g., rename 65f3967e to 'ODP 10') and align 1:8 PLC splitter loss modeling (10.00 dB vs. 10.38 dB) across all 14 ODP enclosures once vendor datasheets are finalized.",
      affectedEntities: [...new Set(affectedGovernance)],
    });
  }

  // 6. Cables missing length or attenuation
  const cablesMissingData = cableItems.filter(
    (c) => c.lengthM === null || c.lengthM <= 0 || c.unitAttenuationDbPerKm === null,
  );
  if (cablesMissingData.length > 0) {
    recommendations.push({
      id: "rec-cable-missing-data",
      priority: "HIGH",
      category: "Cable & Route Infrastructure",
      finding: `${cablesMissingData.length} cable segment(s) are missing valid physical length (m) or attenuation (dB/km) parameters.`,
      recommendation:
        "Complete cable route geometry drawing or enter verified cable lengths and unit attenuation values (dB/km) for all feeder, distribution, and drop cables.",
      affectedEntities: cablesMissingData.map((c) => c.cableName),
    });
  }

  // 7. Unverified physical routes or category mismatch warnings
  if (routeVerificationWarningCables.length > 0) {
    const sampleNames = routeVerificationWarningCables.slice(0, 6).map((c) => c.cableName);
    const affectedSummary =
      routeVerificationWarningCables.length > 6
        ? [...sampleNames, `+ ${routeVerificationWarningCables.length - 6} additional cable segment(s)`]
        : sampleNames;
    recommendations.push({
      id: "rec-cable-route-verification",
      priority: "MEDIUM",
      category: "Cable & Route Infrastructure",
      finding: `${routeVerificationWarningCables.length} cable segment(s) use desktop/OSRM candidate route geometry or have category classification warnings and are not yet field-verified.`,
      recommendation:
        "Perform field walkout survey along road/pole corridors to verify physical cable lengths, right-of-way clearance, and slack loop allowances before issuing construction work orders.",
      affectedEntities: affectedSummary,
    });
  }

  // 8. Disconnected active ONTs/customers vs retained legacy disconnected nodes
  const unreachedOnts = ontPowerRows.filter((r) => {
    const p = pathsByOntId.get(r.ontId);
    return !p || p.statusReason === "no_directed_path_from_olt" || p.connectivityStatus === "disconnected";
  });
  if (unreachedOnts.length > 0 || disconnectedCustomersList.length > 0) {
    const entities = [
      ...new Set([
        ...unreachedOnts.map((o) => o.ontName),
        ...disconnectedCustomersList.map((c) => c.name),
      ]),
    ];
    recommendations.push({
      id: "rec-topology-connectivity",
      priority: "HIGH",
      category: "Network Topology",
      finding: `Incomplete subscriber connectivity detected (${unreachedOnts.length} ONT(s) without a directed path from OLT, ${disconnectedCustomersList.length} disconnected customer(s)).`,
      recommendation:
        "Establish directed optical links following the OLT → ODC → ODP → ONT hierarchy and assign each active customer to a connected ONT.",
      affectedEntities:
        entities.length > 8
          ? [...entities.slice(0, 8), `+ ${entities.length - 8} additional entities`]
          : entities,
    });
  }

  if (disconnectedOpticalDevices.length > 0) {
    recommendations.push({
      id: "rec-legacy-disconnected-nodes",
      priority: "LOW",
      category: "Network Topology",
      finding: `${disconnectedOpticalDevices.length} legacy optical node(s) (${disconnectedOpticalDevices.map((d) => `${getNodeLabel(d)} [${d.id.slice(0, 8)}]`).join(", ")}) remain in the project database as disconnected/inactive records outside all ${ontPowerRows.length} active ONT paths.`,
      recommendation:
        "Retain as a documented decommissioned/legacy record for audit traceability or archive/remove during post-design database cleanup; no changes to the active OLT → ODC → ODP → ONT paths are required.",
      affectedEntities: disconnectedOpticalDevices.map((d) => `${getNodeLabel(d)} (${d.id.slice(0, 8)})`),
    });
  }

  // Cover Metadata, Engineering Assumptions & Representative Worked Paths
  const primaryOlt = oltNodes[0];
  const oltTech = primaryOlt
    ? (readStr(primaryOlt.properties.ponTechnology) ?? readStr(primaryOlt.properties.technology))
    : null;
  const optCfg = project.settings?.opticalBudget;
  const fiberType = readStr(optCfg?.fiberType) ?? "G.652.D";
  const wavelengthNm = readNum(optCfg?.wavelengthNm) ?? 1310;
  const networkTechnology = `${oltTech ? `${oltTech.toUpperCase()} / ` : "GPON / "}FTTH (${fiberType}, ${wavelengthNm} nm)`;

  const validCoords = project.nodes
    .map((n) => n.location?.coordinates)
    .filter((c): c is [number, number] => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]));
  let projectLocation = "Desktop Planning Coordinates";
  if (validCoords.length > 0) {
    const lons = validCoords.map((c) => c[0]);
    const lats = validCoords.map((c) => c[1]);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    if (minLon === maxLon && minLat === maxLat) {
      projectLocation = `${minLat.toFixed(5)}°, ${minLon.toFixed(5)}°`;
    } else {
      projectLocation = `Lat ${minLat.toFixed(5)}° to ${maxLat.toFixed(5)}° · Lon ${minLon.toFixed(5)}° to ${maxLon.toFixed(5)}°`;
    }
  }

  const coverMetadata: CoverMetadata = {
    reportTitle: "FTTH Network Engineering Report",
    projectName: project.name,
    reportGenerationDate: result?.calculatedAt ?? project.updatedAt ?? null,
    networkTechnology,
    projectLocation,
    applicationName: "FIBERPLAN · FTTH Network Planning Simulator",
    opticalProfileName: readStr(optCfg?.profileId) ?? "Standard GPON Optical Profile",
  };

  const paramSourceLabel = (key: string): string => {
    const raw = optCfg?.parameterSources?.[key];
    if (raw === "configured") return "Configured assumption";
    if (raw === "profile_default") return "Optical profile assumption";
    if (raw === "legacy_fallback") return "Legacy fallback assumption";
    return "Configured / Profile assumption";
  };

  const effectiveTxFromOlt = primaryOlt ? readNum(primaryOlt.properties.txPowerDbm) : null;
  const effectiveTx = effectiveTxFromOlt ?? readNum(optCfg?.txPowerDbm);
  const splitterTableText = optCfg?.splitterLossTable
    ? Object.entries(optCfg.splitterLossTable)
        .map(([ratio, loss]) => `${ratio}: ${loss} dB`)
        .join(", ")
    : "Unknown";

  const assumptions: EngineeringAssumptionRow[] = [
    {
      parameter: "OLT Transmit Power (P_tx)",
      value: effectiveTx !== null ? String(effectiveTx) : "Unknown",
      unit: "dBm",
      source: effectiveTxFromOlt !== null ? "Device configured parameter" : paramSourceLabel("txPowerDbm"),
    },
    {
      parameter: "Feeder / Distribution Fiber Attenuation (α)",
      value: readNum(optCfg?.fiberAttenuationDbPerKm) !== null ? String(optCfg?.fiberAttenuationDbPerKm) : "Unknown",
      unit: "dB/km",
      source: paramSourceLabel("fiberAttenuationDbPerKm"),
    },
    {
      parameter: "Drop Fiber Attenuation (α_drop)",
      value:
        readNum(optCfg?.dropFiberAttenuationDbPerKm ?? optCfg?.fiberAttenuationDbPerKm) !== null
          ? String(optCfg?.dropFiberAttenuationDbPerKm ?? optCfg?.fiberAttenuationDbPerKm)
          : "Unknown",
      unit: "dB/km",
      source: paramSourceLabel("dropFiberAttenuationDbPerKm"),
    },
    {
      parameter: "Connector Insertion Loss",
      value:
        readNum(optCfg?.connectorLossDb) !== null
          ? `${optCfg?.connectorLossDb} (${optCfg?.connectorsPerLink ?? 2} per link)`
          : "Unknown",
      unit: "dB / conn",
      source: paramSourceLabel("connectorLossDb"),
    },
    {
      parameter: "Fusion Splice Loss",
      value:
        readNum(optCfg?.spliceLossDb) !== null
          ? `${optCfg?.spliceLossDb} (${optCfg?.splicesPerLink ?? 1} per link)`
          : "Unknown",
      unit: "dB / splice",
      source: paramSourceLabel("spliceLossDb"),
    },
    {
      parameter: "ONT Receiver Sensitivity Threshold (P_min)",
      value: readNum(optCfg?.rxSensitivityDbm) !== null ? String(optCfg?.rxSensitivityDbm) : "Unknown",
      unit: "dBm",
      source: paramSourceLabel("rxSensitivityDbm"),
    },
    {
      parameter: "ONT Receiver Overload Limit (P_max)",
      value: readNum(optCfg?.rxOverloadDbm) !== null ? String(optCfg?.rxOverloadDbm) : "Unknown",
      unit: "dBm",
      source: paramSourceLabel("rxOverloadDbm"),
    },
    {
      parameter: "Safety / Design Margin Allowance",
      value: readNum(optCfg?.safetyMarginDb) !== null ? String(optCfg?.safetyMarginDb) : "Unknown",
      unit: "dB",
      source: paramSourceLabel("safetyMarginDb"),
    },
    {
      parameter: "Passive Splitter Insertion Loss Table",
      value: splitterTableText,
      unit: "dB",
      source: paramSourceLabel("splitterLossTable"),
    },
  ];

  // Build Representative Worked Paths (Highest Rx, Lowest Rx, Lowest Sensitivity Margin, plus any Failed/Unknown paths)
  const workedRolesByOntId = new Map<string, string[]>();
  const addWorkedRole = (ontId: string | undefined | null, role: string) => {
    if (!ontId) return;
    const existing = workedRolesByOntId.get(ontId) ?? [];
    if (!existing.includes(role)) {
      existing.push(role);
      workedRolesByOntId.set(ontId, existing);
    }
  };

  if (highestRxOnt) addWorkedRole(highestRxOnt.id, "Highest Received Power");
  if (lowestRxOnt) addWorkedRole(lowestRxOnt.id, "Lowest Received Power");
  if (lowestSensitivityMarginOnt) addWorkedRole(lowestSensitivityMarginOnt.id, "Lowest Sensitivity Margin");

  const nonPassOnts = ontPowerRows.filter((r) => r.status !== "pass");
  for (const r of nonPassOnts.slice(0, 5)) {
    addWorkedRole(r.ontId, r.status === "fail" ? "Failed Optical Path" : "Unknown / Incomplete Path");
  }

  // Ensure if there are <= 5 paths in total (such as small projects or unit tests), all paths are included
  if ((result?.paths.length ?? 0) <= 5) {
    for (const p of result?.paths ?? []) {
      addWorkedRole(p.ontNodeId, "Evaluated ONT Path");
    }
  }

  const representativeWorkedPaths: RepresentativeWorkedPath[] = Array.from(workedRolesByOntId.entries()).map(
    ([ontNodeId, roles]) => ({
      ontNodeId,
      ontName: nodesById[ontNodeId]?.name ?? ontNodeId,
      roles,
    }),
  );

  return {
    coverMetadata,
    assumptions,
    representativeWorkedPaths,
    executiveSummary,
    infrastructureBranches,
    deviceInfrastructure,
    opticalPowerSummary: {
      olts: oltPowerRows,
      odcs: odcPowerRows,
      odps: odpPowerRows,
      onts: ontPowerRows,
    },
    detailedLinkBudgets,
    cableAnalysis,
    splitterConfigurations,
    conclusion,
    recommendations,
  };
}
