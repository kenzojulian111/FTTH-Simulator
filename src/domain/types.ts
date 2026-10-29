export type NodeType = "olt" | "odc" | "odp" | "ont" | "splitter" | "pole" | "router" | "customer";
export type Coordinate = [longitude: number, latitude: number];
export type PointGeometry = { type: "Point"; coordinates: Coordinate };
export type LineGeometry = { type: "LineString"; coordinates: Coordinate[] };
export type PropertyValue = string | number | boolean | null | PropertyValue[] | { [key: string]: PropertyValue };
export type FeatureProperties = Record<string, PropertyValue>;

export type RouterWanMode = "dhcp-client" | "static-ipv4" | "pppoe";
export interface RouterConfiguration {
  hostname?: string;
  wanMode?: RouterWanMode;
  wanIpv4Address?: string;
  wanPrefix?: number;
  defaultGateway?: string;
  lanIpv4Address?: string;
  lanPrefix?: number;
  dhcpServerEnabled?: boolean;
  dhcpPoolStart?: string;
  dhcpPoolEnd?: string;
  dnsServers?: string[];
  natEnabled?: boolean;
  vlanId?: number;
}
export interface NetworkNode {
  id: string; type: NodeType; name: string; location: PointGeometry;
  properties: FeatureProperties; createdAt: string; updatedAt: string;
}
export interface Customer {
  id: string; name: string; address: string; location: PointGeometry;
  status: "planned" | "connected" | "on_hold"; ontNodeId?: string | null; properties: FeatureProperties;
  createdAt: string; updatedAt: string;
}
export type CableCategory = "feeder" | "distribution" | "drop" | "indoor" | "custom";
export type DeploymentMethod = "aerial" | "underground" | "building_attached" | "other" | "unspecified";

export const DEPLOYMENT_METHOD_LABELS: Record<DeploymentMethod, string> = {
  aerial: "Aerial",
  underground: "Underground",
  building_attached: "Building-attached",
  other: "Other",
  unspecified: "Unspecified",
};

export function resolveDeploymentMethod(cable: Pick<CableSegment, "deploymentMethod" | "properties">): DeploymentMethod {
  const raw = cable.deploymentMethod ?? cable.properties?.deploymentMethod ?? cable.properties?.deployment_method;
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase().replace(/[-\s]+/g, "_");
    if (
      normalized === "aerial"
      || normalized === "underground"
      || normalized === "building_attached"
      || normalized === "other"
      || normalized === "unspecified"
    ) {
      return normalized;
    }
  }
  return "unspecified";
}

export const CABLE_CATEGORY_LABELS: Record<CableCategory, string> = {
  feeder: "Feeder",
  distribution: "Distribution",
  drop: "Drop",
  indoor: "Indoor",
  custom: "Custom",
};

export const CABLE_CATEGORY_COLORS: Record<CableCategory, string> = {
  feeder: "#0ea5e9",
  distribution: "#10b981",
  drop: "#a855f7",
  indoor: "#ec4899",
  custom: "#14b8a6",
};

export function resolveCableCategory(cable: Pick<CableSegment, "cableType" | "properties">): CableCategory | null {
  const explicit = cable.properties?.cableCategory;
  if (typeof explicit === "string") {
    const normalized = explicit.trim().toLowerCase();
    if (normalized === "feeder" || normalized === "distribution" || normalized === "drop" || normalized === "indoor" || normalized === "custom") {
      return normalized;
    }
  }
  const raw = (cable.cableType || "").trim().toLowerCase();
  for (const cat of ["feeder", "distribution", "drop", "indoor", "custom"] as const) {
    if (raw === cat || raw.startsWith(`${cat} `) || raw.endsWith(` ${cat}`)) {
      return cat;
    }
  }
  return null;
}

export interface CableSegment {
  id: string; name: string; cableType: string; fiberCount: number | null;
  deploymentMethod?: DeploymentMethod;
  geometry: LineGeometry; lengthM: number | null; startNodeId?: string | null; endNodeId?: string | null; properties: FeatureProperties;
  createdAt: string; updatedAt: string;
}
export interface PoleSpan { id: string; cableSegmentId: string; fromPoleId: string; toPoleId: string; geometry?: LineGeometry | null; coversEntireCableRoute: boolean; status: "existing" | "proposed" | "shared" | "unverified"; notes: string; lengthM: number | null; lengthSource?: "measured" | "geometry" | "legacy" | "unknown" }
export interface ProjectArea { id: string; name: string; geometry: { type: "Polygon"; coordinates: Coordinate[][] }; fillColor: string; fillOpacity: number; borderColor?: string; description?: string; classification?: "project_boundary" | "service_area" | "residential_block" | "custom" }
export interface OpticalComponent { id: string; kind: string; nodeId?: string | null; connectionId?: string | null; location?: string | null; configuredLossDb: number | null; configuredSource: "configured" | "unknown"; datasheetLossDb?: number | null; datasheetReference?: string | null; datasheetModel?: string | null; measuredLossDb?: number | null; measuredAt?: string | null; measurementMethod?: string | null; measurementReference?: string | null; procurementQuantity?: number | null; procurementUnit?: string | null; materialUnitCost?: number | null; installationUnitCost?: number | null; priceSource?: "configured" | "unknown"; priceReference?: string | null }
export interface TopologyConnection { id: string; fromNodeId: string; toNodeId: string; cableSegmentId: string }
export interface TopologyIssue {
  code: string; message: string; severity: "error" | "warning" | "info"; policyCode?: string | null;
  fromNodeId?: string | null; toNodeId?: string | null; cableSegmentId?: string | null; connectionId?: string | null;
  details?: Record<string, unknown> | null;
}
export interface TopologyValidationResult { valid: boolean; errors: TopologyIssue[]; warnings: TopologyIssue[]; summary: Record<string, unknown> }
export interface ConnectionValidationRequest {
  fromNodeId: string; toNodeId: string; cableSegmentId: string; connectionId?: string | null; project?: Project | null;
}
export interface Project {
  id: string; name: string; description: string; currency: string; nodes: NetworkNode[];
  customers: Customer[]; cableSegments: CableSegment[]; connections: TopologyConnection[];
  poleSpans?: PoleSpan[]; opticalComponents?: OpticalComponent[];
  areas?: ProjectArea[];
  settings: ProjectSettings; createdAt: string; updatedAt: string;
}
export interface OpticalBudgetConfig {
  txPowerDbm: number; fiberAttenuationDbPerKm: number; dropFiberAttenuationDbPerKm?: number | null;
  connectorLossDb: number; connectorsPerLink: number;
  spliceLossDb: number; splicesPerLink: number;
  pigtailSpliceLossDb?: number | null; pigtailSplicesPerLink?: number | null;
  safetyMarginDb: number; rxSensitivityDbm: number;
  rxOverloadDbm: number; minMarginDb: number; splitterLossTable: Record<string, number>;
  fiberType?: string | null; wavelengthNm?: number | null; profileId?: string | null; profileNote?: string | null;
  parameterSources?: Record<string, "configured" | "profile_default" | "legacy_fallback" | "unknown">;
  projectStandardLossDb?: number | null; projectStandardReference?: string | null;
}
export interface ConstructionCostConfig {
  currency: string; cableSlackPercent: number; cableUnitCostPerMeter: number; cableInstallationCostPerMeter: number;
  poleUnitCost: number; poleInstallationCost: number; oltUnitCost: number; oltInstallationCost: number;
  odcUnitCost: number; odcInstallationCost: number; odpUnitCost: number; odpInstallationCost: number;
  ontUnitCost: number; ontInstallationCost: number; splitterUnitCost: number; splitterInstallationCost: number;
  routerUnitCost?: number | null; routerInstallationCost?: number | null;
  ductUnitCostPerMeter?: number | null; trenchingCostPerMeter?: number | null; excavationCostPerMeter?: number | null;
  warningTapeCostPerMeter?: number | null; undergroundInstallationCostPerMeter?: number | null;
  buildingAttachmentCostPerMeter?: number | null; otherDeploymentCostPerMeter?: number | null;
  requireDeploymentMethodForCableCost?: boolean;
  rateSources?: Record<string, "configured" | "legacy_illustrative" | "unknown">; rateReferences?: Record<string, string>;
  poleCostPolicy?: Record<"existing" | "proposed" | "shared" | "unverified", "supply_and_install" | "installation_only" | "exclude" | "incomplete">;
}
export interface ProjectSettings {
  opticalBudget: OpticalBudgetConfig;
  constructionCost: ConstructionCostConfig;
  poleSpanPlanning?: {
    rules: Array<{ cableCategory: string; maxSpanM: number; placementPolicy?: "uniform_maximum_spacing" | null }>;
    defaultMaxSpanM?: number;
    maxOdpToHouseDistanceM?: number;
  };
}
export interface OpticalDiagnosticItem {
  code: string;
  severity: "error" | "warning" | "info";
  category: "connectivity" | "optical_budget" | "configuration" | "physical_deployment";
  message: string;
  affectedEntityType?: "ont" | "node" | "cable" | "connection" | "component" | "project" | null;
  affectedEntityId?: string | null;
  affectedEntityName?: string | null;
  actualValue?: number | string | null;
  expectedValue?: number | string | null;
  unit?: string | null;
  correctiveAction?: string | null;
  dataSource?: string | null;
}
export interface OpticalBudgetResult {
  projectId: string; calculatedAt: string;
  links: Array<{ connectionId: string; lengthM: number; lossDb: number; receivedPowerDbm: number | null; status: "pass" | "warning" | "fail" | "unknown"; marginDb?: number | null; details?: Record<string, unknown> | null }>;
  paths: Array<{
    ontNodeId: string; customerIds: string[]; nodeIds: string[]; connectionIds: string[];
    cableSegmentIds?: string[]; lengthM: number | null; lossDb: number | null;
    txPowerDbm?: number | null; receivedPowerDbm: number | null; rxSensitivityDbm?: number | null;
    rxOverloadDbm?: number | null; sensitivityMarginDb?: number | null; overloadMarginDb?: number | null; marginDb: number | null; minMarginDb?: number | null;
    status: "pass" | "warning" | "fail" | "unknown"; statusReason?: string | null;
    connectivityStatus?: "connected" | "disconnected" | "invalid_topology" | "ambiguous";
    opticalBudgetStatus?: "pass" | "fail" | "unknown";
    diagnostics?: OpticalDiagnosticItem[];
    calculationLimitations?: string[];
    parameterSources?: Record<string, "configured" | "profile_default" | "legacy_fallback" | "unknown">; profileId?: string | null;
    segments?: Array<{
      connectionId: string; cableSegmentId: string; cableName: string;
      fromNodeId: string; fromNodeName: string; fromNodeType: string;
      toNodeId: string; toNodeName: string; toNodeType: string;
      lengthM: number; routeLengthContributionM?: number | null; attenuationDbPerKm: number | null; fiberLossDb: number | null;
      fiberType?: string | null; wavelengthNm?: number | null;
      connectorsCount: number | null; connectorLossDb: number | null; splicesCount: number | null;
      spliceLossDb: number | null; totalSegmentLossDb: number | null;
    }>;
    splitters?: Array<{ nodeId: string; nodeName: string; nodeType: string; splitterRatio?: string | null; lossDb: number | null; idealLossDb?: number | null }>;
    details?: Record<string, unknown> | null;
    componentLosses?: Array<Record<string, unknown>>; standardLossDb?: number | null; standardVarianceDb?: number | null;
    datasheetReferences?: Array<Record<string, unknown>>; fieldMeasurements?: Array<Record<string, unknown>>;
    locationLossSummary?: Record<string, number | null>;
  }>;
  disconnectedCustomerIds: string[];
  summary?: Record<string, unknown> | null;
  diagnostics?: Array<Record<string, unknown>>;
}
export interface ConstructionCostResult {
  projectId: string; calculatedAt: string; currency: string; totalAmount: number;
  items: Array<{ code: string; description: string; quantity: number; unit: string; unitCost: number; amount: number; category?: "material" | "installation" | null; unitCostSource?: "configured" | "legacy_illustrative"; unitCostReference?: string | null }>;
  totalCapex?: number | null; costPerConnectedCustomer?: number | null; connectedCustomerCount?: number | null;
  materialSubtotal?: number | null; installationSubtotal?: number | null; grandTotal?: number | null;
  summary?: Record<string, unknown> | null;
  incompleteItems?: Array<Record<string, unknown>>; assumptions?: string[]; complete?: boolean;
}
export interface PoleSpanResult {
  projectId: string;
  calculatedAt: string;
  spans: Array<Record<string, unknown>>;
  diagnostics: Array<Record<string, unknown>>;
  estimatedAdditionalPoles: number | null;
  estimationMethod?: string | null;
  assumptions: string[];
  maxSpanLimitM?: number;
  maxOdpToHouseLimitM?: number;
  odpHouseDistances?: Array<{
    odpId: string;
    odpName: string;
    maxAllowedDistanceM: number;
    connectedHouseCount: number;
    farthestDistanceM: number | null;
    farthestTargetId?: string | null;
    farthestTargetName?: string | null;
    farthestTargetKind?: "customer" | "ont" | null;
    status: "pass" | "fail" | "unconnected" | "unknown";
    houses?: Array<Record<string, unknown>>;
  }>;
}
export type FeatureRef = { kind: "node" | "customer" | "cable" | "area"; id: string };
export type PlacementTool = NodeType | "customer" | "cable";

export const NODE_LABELS: Record<NodeType, string> = { olt: "OLT", odc: "ODC", odp: "ODP", ont: "ONT", splitter: "Splitter", pole: "Pole", router: "Router", customer: "Customer" };
export const FEATURE_LABELS: Record<PlacementTool, string> = { ...NODE_LABELS, customer: "Customer", cable: "Cable route" };
