import type { CableCategory } from "../types";

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
