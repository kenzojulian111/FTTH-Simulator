import { useState } from "react";
import type { CableCategory, CableSegment, Customer, DeploymentMethod, FeatureRef, NetworkNode, OpticalBudgetConfig, OpticalBudgetResult, OpticalComponent, PoleSpan, Project, ProjectArea, PropertyValue } from "../domain/types";
import { CABLE_CATEGORY_LABELS, DEPLOYMENT_METHOD_LABELS, resolveCableCategory, resolveDeploymentMethod } from "../domain/types";
import { approximateLengthMeters, extractSubspanCoordinates } from "../domain/project";
import { RouterConfigurationPanel } from "./RouterConfigurationPanel";
import type { RouterConfiguration } from "../domain/types";
import { readRouterConfiguration } from "../domain/routerConfig";
import { cableCategoryWarning, recommendCableCategory } from "../domain/cableClassification";
import { OpticalCalculationTable } from "./OpticalCalculationTable";
import { getDevicePorts, parseSplitterOutputCount, type ConfiguredPortItem } from "../domain/devicePorts";

interface Props {
  project: Project;
  selection: FeatureRef | null;
  opticalResult?: OpticalBudgetResult | null;
  onAreaChange?: (area: ProjectArea) => void;
  onRename: (ref: FeatureRef, name: string) => void;
  onSelect?: (ref: FeatureRef) => void;
  onCustomerAddress: (id: string, address: string) => void;
  onCustomerOnt: (id: string, ontNodeId: string | null) => void;
  onCustomerStatus: (id: string, status: "planned" | "connected" | "on_hold") => void;
  onCableAttributes: (id: string, cableType: string, fiberCount: number | null, properties?: CableSegment["properties"]) => void;
  onRouterConfiguration: (id: string, configuration: RouterConfiguration) => void;
  onPoleProperties?: (id: string, properties: NetworkNode["properties"]) => void;
  onOpticalComponentsChange?: (components: OpticalComponent[]) => void;
  onAddPoleSpan?: (span: PoleSpan) => void;
  onDeletePoleSpan?: (id: string) => void;
  onPoleSpanStatus?: (id: string, status: PoleSpan["status"]) => void;
  onSplitterOpticalConfig?: (id: string, ratio: string | null, insertionLossDb: number | null) => void;
  onInvalidFiberCount: () => void;
  onDelete: () => void;
  onNodeProperties?: (id: string, properties: Partial<NetworkNode["properties"]>) => void;
  onAddInternalSplitter?: (hostNodeId: string, splitter: NetworkNode) => void;
  onRemoveInternalSplitter?: (splitterId: string) => void;
  onDisconnectConnection?: (connectionId: string) => void;
  onRecalculate?: () => void;
  onOpticalBudgetConfig?: (config: OpticalBudgetConfig) => void;
}

type SelectedItem =
  | { kind: "node"; item: NetworkNode }
  | { kind: "customer"; item: Customer }
  | { kind: "cable"; item: CableSegment };

const HIDDEN_INTERNAL_KEYS = new Set([
  "routerConfiguration",
  "ponPortArchitectureStatus",
  "portCapacityReviewRequired",
  "opticalEquipmentStatus",
  "ponPortCapacityStatus",
  "geographicPositionSet",
  "mountedInNodeId",
  "outputPortAssignments",
  "inputPortId",
  "distributionFanoutCapacityStatus",
  "distributionFanoutPortsRequired",
  "capacityReviewRequired",
  "splitterSpecificationStatus",
  "splitterSpecificationSource",
  "locationProvenance",
  "portRelationshipProvenance",
  "routeAndSiteSurveyRequired",
  "physicalLengthStatus",
  "connectionKind",
  "configuredPorts",
  "vendor",
  "model",
  "ponTechnology",
  "txPowerDbm",
  "rxSensitivityDbm",
  "rxOverloadDbm",
  "ponPortCapacity",
  "maxCustomersPerPort",
  "feederPortCapacity",
  "distributionPortCapacity",
  "distributionFanoutCapacity",
  "splitterRatio",
  "splitterLossDb",
  "splitterType",
  "capacity",
  "portCapacity",
  "outputPorts",
  "fiberAttenuationDbPerKm",
  "connectorLossDb",
  "spliceLossDb",
  "connectorsCount",
  "splicesCount",
]);

function formatPropertyLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function Inspector({
  project,
  selection,
  opticalResult,
  onRename,
  onSelect,
  onCustomerAddress,
  onCustomerOnt,
  onCustomerStatus,
  onCableAttributes,
  onRouterConfiguration,
  onPoleProperties,
  onOpticalComponentsChange,
  onAddPoleSpan,
  onDeletePoleSpan,
  onPoleSpanStatus,
  onSplitterOpticalConfig,
  onInvalidFiberCount,
  onDelete,
  onAreaChange,
  onNodeProperties,
  onAddInternalSplitter,
  onRemoveInternalSplitter,
  onDisconnectConnection,
  onRecalculate,
  onOpticalBudgetConfig,
}: Props) {
  const [spanFrom, setSpanFrom] = useState("");
  const [spanTo, setSpanTo] = useState("");
  const [newSplitterRatio, setNewSplitterRatio] = useState("1:8");
  const [newSplitterCustomRatio, setNewSplitterCustomRatio] = useState("");
  const [newSplitterType, setNewSplitterType] = useState<"plc" | "fbt">("plc");
  const [newSplitterCustomLoss, setNewSplitterCustomLoss] = useState("");
  const [newSplitterCapacity, setNewSplitterCapacity] = useState("");

  if (selection?.kind === "area") {
    const area = (project.areas ?? []).find((item) => item.id === selection.id);
    if (!area) return null;
    const patchArea = (patch: Partial<ProjectArea>) => onAreaChange?.({ ...area, ...patch });
    return (
      <section className="inspector">
        <div className="section-heading">
          <span>PROJECT AREA</span>
          <button className="icon-button danger" onClick={onDelete} aria-label="Delete selected area">⌫</button>
        </div>
        <label className="field-label">Name<input value={area.name} onChange={(event) => patchArea({ name: event.target.value })} /></label>
        <label className="field-label">Classification
          <select value={area.classification ?? "custom"} onChange={(event) => patchArea({ classification: event.target.value as ProjectArea["classification"] })}>
            <option value="project_boundary">Project boundary</option>
            <option value="service_area">Service area</option>
            <option value="residential_block">Residential block</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label className="field-label">Fill color<input type="color" value={area.fillColor} onChange={(event) => patchArea({ fillColor: event.target.value })} /></label>
        <label className="field-label">Fill opacity<input type="number" min="0" max="1" step="0.05" value={area.fillOpacity} onChange={(event) => patchArea({ fillOpacity: Number(event.target.value) })} /></label>
        <label className="field-label">Description<textarea value={area.description ?? ""} onChange={(event) => patchArea({ description: event.target.value })} /></label>
        <p className="hint">Geographic annotation only; no serviceability is inferred.</p>
      </section>
    );
  }

  if (!selection) {
    return (
      <section className="inspector empty-inspector">
        <div className="inspector-icon">⌖</div>
        <h3>Nothing selected</h3>
        <p>Select an object on the map to inspect its properties.</p>
      </section>
    );
  }

  let selected: SelectedItem | undefined;
  if (selection.kind === "node") {
    const node = project.nodes.find((x) => x.id === selection.id);
    if (node) selected = { kind: "node", item: node };
  } else if (selection.kind === "customer") {
    const customer = project.customers.find((x) => x.id === selection.id);
    if (customer) selected = { kind: "customer", item: customer };
  } else {
    const cable = project.cableSegments.find((x) => x.id === selection.id);
    if (cable) selected = { kind: "cable", item: cable };
  }
  if (!selected) return null;

  const item = selected.item;
  const nodesById = Object.fromEntries(project.nodes.map((n) => [n.id, n]));
  const mounted = selected.kind === "node" && selected.item.type === "splitter" && typeof selected.item.properties.mountedInNodeId === "string";
  const location = selected.kind === "cable" || mounted ? null : selected.item.location.coordinates;
  const hostedSplitters = selected.kind === "node" && (selected.item.type === "odc" || selected.item.type === "odp")
    ? project.nodes.filter((node) => node.type === "splitter" && node.properties.mountedInNodeId === selected.item.id)
    : [];
  const lengthM = selected.kind === "cable" ? selected.item.lengthM : null;
  const selectedConnectionIds = selected.kind === "cable" ? project.connections.filter((connection) => connection.cableSegmentId === selected.item.id).map((connection) => connection.id) : [];
  const opticalComponents = (project.opticalComponents ?? []).filter((component) => selected.kind === "node" ? component.nodeId === selected.item.id : selected.kind === "cable" ? Boolean(component.connectionId && selectedConnectionIds.includes(component.connectionId)) : false);
  const updateOpticalComponent = (id: string, patch: Partial<OpticalComponent>) => onOpticalComponentsChange?.((project.opticalComponents ?? []).map((component) => component.id === id ? { ...component, ...patch } : component));

  // Helper to update a port's configured label or status
  const updatePortConfig = (node: NetworkNode, portId: string, patch: Partial<ConfiguredPortItem>) => {
    const configuredList: ConfiguredPortItem[] = Array.isArray(node.properties.configuredPorts)
      ? [...(node.properties.configuredPorts as unknown as ConfiguredPortItem[])]
      : [];
    const existingIndex = configuredList.findIndex((p) => p.id === portId);
    if (existingIndex >= 0) {
      configuredList[existingIndex] = { ...configuredList[existingIndex], ...patch };
    } else {
      configuredList.push({ id: portId, ...patch });
    }
    onNodeProperties?.(node.id, { configuredPorts: configuredList as unknown as PropertyValue });
  };

  return (
    <section className="inspector">
      <div className="section-heading">
        <span>SELECTED OBJECT</span>
        <button className="icon-button danger" onClick={onDelete} aria-label="Delete selected object">⌫</button>
      </div>

      {/* SECTION 1: DEVICE INFORMATION */}
      {selected.kind === "node" && (() => {
        const node = selected.item;
        const hostCabinet = mounted ? nodesById[String(node.properties.mountedInNodeId)] : null;
        return (
          <section className="splitter-config-panel" aria-label="Device information">
            <div className="section-heading"><span>1. DEVICE INFORMATION</span></div>
            <label className="field-label">
              Device name
              <input value={node.name} onChange={(event) => onRename(selection, event.target.value)} />
            </label>
            <div className="property-row">
              <span>Device type</span>
              <strong>{node.type.toUpperCase()}</strong>
            </div>
            {mounted && hostCabinet && (
              <div className="property-row">
                <span>Host cabinet</span>
                <strong>{hostCabinet.name} ({hostCabinet.type.toUpperCase()})</strong>
              </div>
            )}
            {location && (
              <div className="property-row">
                <span>Coordinates</span>
                <strong>{node.properties.geographicPositionSet === false ? "Place on map" : `${location[1].toFixed(5)}, ${location[0].toFixed(5)}`}</strong>
              </div>
            )}
            <label className="field-label">
              Vendor
              <input
                placeholder="e.g. Huawei, ZTE, FiberHome"
                value={String(node.properties.vendor ?? "")}
                onChange={(e) => onNodeProperties?.(node.id, { vendor: e.target.value || null })}
              />
            </label>
            <label className="field-label">
              Model
              <input
                placeholder="e.g. MA5800, C300, SmartAX"
                value={String(node.properties.model ?? "")}
                onChange={(e) => onNodeProperties?.(node.id, { model: e.target.value || null })}
              />
            </label>
            {node.type === "olt" && (() => {
              const currentPon = String(node.properties.ponTechnology ?? "GPON");
              const isStandardPon = ["GPON", "XG-PON", "XGS-PON"].includes(currentPon);
              return (
                <>
                  <label className="field-label">
                    PON technology
                    <select
                      value={isStandardPon ? currentPon : "custom"}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val !== "custom") {
                          onNodeProperties?.(node.id, { ponTechnology: val });
                        }
                      }}
                    >
                      <option value="GPON">GPON (2.5G / 1.25G)</option>
                      <option value="XG-PON">XG-PON (10G / 2.5G)</option>
                      <option value="XGS-PON">XGS-PON (10G / 10G)</option>
                      <option value="custom">Custom technology...</option>
                    </select>
                  </label>
                  {(!isStandardPon || currentPon === "custom") && (
                    <label className="field-label">
                      Custom PON technology
                      <input
                        placeholder="e.g. 25GS-PON, EPON, 50G-PON"
                        value={currentPon === "custom" ? "" : currentPon}
                        onChange={(e) => onNodeProperties?.(node.id, { ponTechnology: e.target.value || "custom" })}
                      />
                    </label>
                  )}
                  <div className="property-row">
                    <span>Optical profile</span>
                    <strong>{project.settings.opticalBudget.profileId}</strong>
                  </div>
                </>
              );
            })()}
            <div className="property-row">
              <span>Status</span>
              <strong>{String(node.properties.status ?? "Active").toUpperCase()}</strong>
            </div>
          </section>
        );
      })()}

      {/* DEVICE SUMMARY PANELS */}
      {selected.kind === "node" && selected.item.type === "olt" && (() => {
        const olt = selected.item;
        const ponCapacity = typeof olt.properties.ponPortCapacity === "number" ? olt.properties.ponPortCapacity : typeof olt.properties.ponPorts === "number" ? olt.properties.ponPorts : 4;
        const ponSource = olt.properties.capacitySource === "configured" ? "Configured" : "Planning Default";
        const activePonPorts = new Set<string>();
        for (const node of project.nodes) {
          if (typeof node.properties.sourcePonPortId === "string" && node.properties.sourcePonPortId) activePonPorts.add(node.properties.sourcePonPortId);
          if (typeof node.properties.ponPortId === "string" && node.properties.ponPortId) activePonPorts.add(node.properties.ponPortId);
        }
        const outgoingCount = project.connections.filter((conn) => conn.fromNodeId === olt.id).length;
        const usedPonPorts = activePonPorts.size > 0 ? activePonPorts.size : typeof olt.properties.requiredPonPorts === "number" ? olt.properties.requiredPonPorts : outgoingCount;
        const txPower = typeof olt.properties.txPowerDbm === "number" ? olt.properties.txPowerDbm : project.settings.opticalBudget.txPowerDbm;
        const txSource = typeof olt.properties.txPowerDbm === "number" ? "Configured" : "Planning Default";
        return (
          <section className="splitter-config-panel" aria-label="OLT summary">
            <div className="section-heading"><span>OLT SUMMARY</span></div>
            <div className="property-row"><span>PON port capacity</span><strong>{ponCapacity} ports ({ponSource})</strong></div>
            <div className="property-row"><span>Used PON ports</span><strong>{usedPonPorts} / {ponCapacity}</strong></div>
            <div className="property-row"><span>Transmit power</span><strong>{txPower.toFixed(2)} dBm ({txSource})</strong></div>
          </section>
        );
      })()}

      {selected.kind === "node" && selected.item.type === "odc" && (() => {
        const odc = selected.item;
        const feederInputs = project.connections.filter((conn) => conn.toNodeId === odc.id).length;
        const distOutputs = project.connections.filter((conn) => conn.fromNodeId === odc.id).length;
        const distCapacity = typeof odc.properties.distributionFanoutCapacity === "number" ? odc.properties.distributionFanoutCapacity : typeof odc.properties.distributionPortCapacity === "number" ? odc.properties.distributionPortCapacity : 16;
        const intermediate = opticalResult?.intermediateNodes?.find((entry) => entry.nodeId === odc.id);
        return (
          <section className="splitter-config-panel" aria-label="ODC summary">
            <div className="section-heading"><span>ODC SUMMARY</span></div>
            <div className="property-row"><span>Feeder inputs</span><strong>{feederInputs}</strong></div>
            <div className="property-row"><span>Distribution outputs</span><strong>{distOutputs} / {distCapacity} ports</strong></div>
            <div className="property-row"><span>Internal splitters</span><strong>{hostedSplitters.length}</strong></div>
            {intermediate && (
              <div className="property-row"><span>Physical route status</span><strong>{(intermediate.physicalRouteStatus ?? "planned").toUpperCase()}</strong></div>
            )}
          </section>
        );
      })()}

      {selected.kind === "node" && selected.item.type === "odp" && (() => {
        const odp = selected.item;
        const upstreamConn = project.connections.find((conn) => conn.toNodeId === odp.id);
        const upstreamNode = upstreamConn ? project.nodes.find((node) => node.id === upstreamConn.fromNodeId) : undefined;
        const hostedSplitter = hostedSplitters[0];
        const splitterRatio = typeof odp.properties.splitterRatio === "string"
          ? odp.properties.splitterRatio
          : typeof hostedSplitter?.properties.splitterRatio === "string"
            ? hostedSplitter.properties.splitterRatio
            : "1:8";
        const splitterCap = typeof odp.properties.portCapacity === "number"
          ? odp.properties.portCapacity
          : typeof odp.properties.capacity === "number"
            ? odp.properties.capacity
            : typeof hostedSplitter?.properties.capacity === "number"
              ? hostedSplitter.properties.capacity
              : Number(splitterRatio.split(":")[1]) || 8;
        const downstreamOntIds = new Set(
          project.connections
            .filter((conn) => conn.fromNodeId === odp.id || (hostedSplitter && conn.fromNodeId === hostedSplitter.id))
            .map((conn) => conn.toNodeId),
        );
        const connectedOntCount = downstreamOntIds.size;
        const customerCount = project.customers.filter(
          (cust) => (cust.ontNodeId && downstreamOntIds.has(cust.ontNodeId)) || cust.properties.plannedOdpNodeId === odp.id,
        ).length;
        return (
          <section className="splitter-config-panel" aria-label="ODP summary">
            <div className="section-heading"><span>ODP SUMMARY</span></div>
            <div className="property-row"><span>Upstream ODC</span><strong>{upstreamNode?.name ?? "Unconnected"}</strong></div>
            <div className="property-row"><span>Splitter capacity</span><strong>{splitterRatio} ({splitterCap} ports)</strong></div>
            <div className="property-row"><span>Customers</span><strong>{customerCount}</strong></div>
            <div className="property-row"><span>Connected ONTs</span><strong>{connectedOntCount} / {splitterCap}</strong></div>
          </section>
        );
      })()}

      {selected.kind === "node" && selected.item.type === "ont" && (() => {
        const ont = selected.item;
        const linkedCustomer = project.customers.find((cust) => cust.ontNodeId === ont.id) ?? (typeof ont.properties.customerId === "string" ? project.customers.find((cust) => cust.id === ont.properties.customerId) : undefined);
        const upstreamConn = project.connections.find((conn) => conn.toNodeId === ont.id);
        const upstreamNode = upstreamConn ? project.nodes.find((node) => node.id === upstreamConn.fromNodeId) : undefined;
        const upstreamHost = upstreamNode?.type === "splitter" && typeof upstreamNode.properties.mountedInNodeId === "string"
          ? project.nodes.find((node) => node.id === upstreamNode.properties.mountedInNodeId)
          : upstreamNode;
        const dropCable = upstreamConn ? project.cableSegments.find((cable) => cable.id === upstreamConn.cableSegmentId) : undefined;
        const path = opticalResult?.paths.find((entry) => entry.ontNodeId === ont.id);
        const dropLen = dropCable?.lengthM ?? path?.segments?.[path.segments.length - 1]?.lengthM ?? null;
        return (
          <section className="splitter-config-panel" aria-label="ONT summary">
            <div className="section-heading"><span>ONT SUMMARY</span></div>
            <div className="property-row"><span>Customer</span><strong>{linkedCustomer ? `${linkedCustomer.name} (${linkedCustomer.id.slice(0, 8)})` : "Unassigned"}</strong></div>
            <div className="property-row"><span>Upstream ODP</span><strong>{upstreamHost?.name ?? "Unconnected"}</strong></div>
            <div className="property-row"><span>Drop cable length</span><strong>{dropLen == null ? "Unknown" : `${dropLen.toFixed(2)} m`}</strong></div>
            <div className="property-row"><span>Estimated received power</span><strong>{path?.receivedPowerDbm == null ? "Unknown" : `${path.receivedPowerDbm.toFixed(2)} dBm`}</strong></div>
            <div className="property-row"><span>Optical status</span><strong>{path ? path.status.toUpperCase() : "NOT RUN"}</strong></div>
            {path && <div className="property-row"><span>Physical route status</span><strong>{(path.physicalRouteStatus ?? "unverified").toUpperCase()}</strong></div>}
          </section>
        );
      })()}

      {/* Non-node name and type display */}
      {selected.kind !== "node" && (
        <>
          <label className="field-label">Name<input value={item.name} onChange={(event) => onRename(selection, event.target.value)} /></label>
          <div className="property-row"><span>Type</span><strong>{selected.kind === "customer" ? "Customer" : selected.item.cableType || "Cable"}</strong></div>
        </>
      )}

      {/* SECTION 2: PORT CONFIGURATION (For OLT, ODC, ODP, Splitter) */}
      {selected.kind === "node" && (selected.item.type === "olt" || selected.item.type === "odc" || selected.item.type === "odp" || selected.item.type === "splitter") && (() => {
        const node = selected.item;
        const ports = getDevicePorts(node, project.connections, nodesById, project.customers);
        const connectedCount = ports.filter((p) => p.status === "connected").length;
        const availableCount = ports.filter((p) => p.status === "available").length;
        const disabledCount = ports.filter((p) => p.status === "disabled").length;

        return (
          <section className="splitter-config-panel" aria-label="Port configuration">
            <div className="section-heading"><span>2. PORT CONFIGURATION</span></div>

            {/* Capacity & Parameter Controls */}
            {node.type === "olt" && (
              <>
                <label className="field-label">
                  Optical transmit power (dBm)
                  <input
                    type="number"
                    step="0.01"
                    value={typeof node.properties.txPowerDbm === "number" ? node.properties.txPowerDbm : ""}
                    placeholder={`${project.settings.opticalBudget.txPowerDbm >= 0 ? "+" : ""}${project.settings.opticalBudget.txPowerDbm.toFixed(2)} dBm (default)`}
                    onChange={(e) => {
                      const raw = e.target.value;
                      onNodeProperties?.(node.id, {
                        txPowerDbm: raw.trim() === "" ? null : Number(raw),
                      });
                    }}
                  />
                </label>
                <div className="property-row">
                  <span>Tx power status</span>
                  {typeof node.properties.txPowerDbm === "number" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <strong style={{ color: "#F0B429" }}>[Custom: {node.properties.txPowerDbm >= 0 ? "+" : ""}{node.properties.txPowerDbm.toFixed(2)} dBm]</strong>
                      <button
                        type="button"
                        className="secondary-button"
                        style={{ padding: "1px 5px", fontSize: 9 }}
                        onClick={() => onNodeProperties?.(node.id, { txPowerDbm: null })}
                      >
                        Reset to default
                      </button>
                    </div>
                  ) : (
                    <strong style={{ color: "#91C4ED" }}>[Default: {project.settings.opticalBudget.txPowerDbm >= 0 ? "+" : ""}{project.settings.opticalBudget.txPowerDbm.toFixed(2)} dBm]</strong>
                  )}
                </div>
                <label className="field-label">
                  PON ports capacity
                  <input
                    type="number"
                    min="1"
                    max="64"
                    value={typeof node.properties.ponPortCapacity === "number" ? node.properties.ponPortCapacity : typeof node.properties.ponPorts === "number" ? node.properties.ponPorts : 4}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (val > 0) onNodeProperties?.(node.id, { ponPortCapacity: val, ponPorts: val, capacitySource: "configured" });
                    }}
                  />
                </label>
                <label className="field-label">
                  Max customers per PON port
                  <input
                    type="number"
                    min="1"
                    max="256"
                    value={typeof node.properties.maxCustomersPerPort === "number" ? node.properties.maxCustomersPerPort : 64}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (val > 0) onNodeProperties?.(node.id, { maxCustomersPerPort: val });
                    }}
                  />
                </label>
              </>
            )}

            {node.type === "odc" && (
              <>
                <label className="field-label">
                  Feeder input ports capacity
                  <input
                    type="number"
                    min="1"
                    max="32"
                    value={typeof node.properties.feederPortCapacity === "number" ? node.properties.feederPortCapacity : 4}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (val > 0) onNodeProperties?.(node.id, { feederPortCapacity: val });
                    }}
                  />
                </label>
                <label className="field-label">
                  Distribution output ports capacity
                  <input
                    type="number"
                    min="1"
                    max="96"
                    value={typeof node.properties.distributionPortCapacity === "number" ? node.properties.distributionPortCapacity : typeof node.properties.distributionFanoutCapacity === "number" ? node.properties.distributionFanoutCapacity : 16}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (val > 0) onNodeProperties?.(node.id, { distributionPortCapacity: val, distributionFanoutCapacity: val });
                    }}
                  />
                </label>
              </>
            )}

            {node.type === "odp" && (() => {
              const currentRatio = typeof node.properties.splitterRatio === "string" ? node.properties.splitterRatio : "1:8";
              const isStandardRatio = ["1:2", "1:4", "1:8", "1:16", "1:32"].includes(currentRatio);
              const customLoss = typeof node.properties.splitterLossDb === "number" ? node.properties.splitterLossDb : null;
              const defaultLoss = project.settings.opticalBudget.splitterLossTable[currentRatio] ?? null;
              const effectiveLoss = customLoss ?? defaultLoss;
              const currentCap = typeof node.properties.portCapacity === "number"
                ? node.properties.portCapacity
                : typeof node.properties.capacity === "number"
                  ? node.properties.capacity
                  : typeof node.properties.outputPorts === "number"
                    ? node.properties.outputPorts
                    : parseSplitterOutputCount(currentRatio);

              const hosted = hostedSplitters[0];

              const applyOdpSplitter = (patch: Record<string, PropertyValue>) => {
                onNodeProperties?.(node.id, patch);
                if (hosted) {
                  onNodeProperties?.(hosted.id, patch);
                }
              };

              return (
                <>
                  <label className="field-label">
                    Splitter type
                    <select
                      value={String(node.properties.splitterType ?? "plc").toLowerCase()}
                      onChange={(e) => applyOdpSplitter({ splitterType: e.target.value })}
                    >
                      <option value="plc">PLC (Planar Lightwave Circuit)</option>
                      <option value="fbt">FBT (Fused Biconical Taper)</option>
                      <option value="custom">Custom</option>
                    </select>
                  </label>
                  <label className="field-label">
                    Splitter ratio
                    <select
                      value={isStandardRatio ? currentRatio : "custom"}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val !== "custom") {
                          const cap = parseSplitterOutputCount(val);
                          applyOdpSplitter({ splitterRatio: val, portCapacity: cap, capacity: cap, outputPorts: cap });
                        }
                      }}
                    >
                      <option value="1:2">1:2 (2 output ports)</option>
                      <option value="1:4">1:4 (4 output ports)</option>
                      <option value="1:8">1:8 (8 output ports)</option>
                      <option value="1:16">1:16 (16 output ports)</option>
                      <option value="1:32">1:32 (32 output ports)</option>
                      <option value="custom">Custom ratio...</option>
                    </select>
                  </label>
                  {(!isStandardRatio || currentRatio === "custom") && (
                    <label className="field-label">
                      Custom ratio
                      <input
                        placeholder="e.g. 1:3, 1:12, 2:8"
                        value={currentRatio}
                        onChange={(e) => {
                          const ratio = e.target.value;
                          const cap = parseSplitterOutputCount(ratio);
                          applyOdpSplitter({ splitterRatio: ratio, portCapacity: cap, capacity: cap, outputPorts: cap });
                        }}
                      />
                    </label>
                  )}
                  <label className="field-label">
                    Output ports count
                    <input
                      type="number"
                      min="1"
                      value={currentCap}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (val > 0) applyOdpSplitter({ portCapacity: val, capacity: val, outputPorts: val });
                      }}
                    />
                  </label>
                  <label className="field-label">
                    Insertion loss (dB)
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={customLoss != null ? customLoss : ""}
                      placeholder={defaultLoss != null ? `${defaultLoss.toFixed(2)} dB (default)` : "e.g. 10.2 dB"}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const val = raw.trim() === "" ? null : Number(raw);
                        applyOdpSplitter({ splitterLossDb: val });
                      }}
                    />
                  </label>
                  <div className="property-row">
                    <span>Loss parameter status</span>
                    {customLoss != null ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <strong style={{ color: "#F0B429" }}>[Custom: {customLoss.toFixed(2)} dB]</strong>
                        <button
                          type="button"
                          className="secondary-button"
                          style={{ padding: "1px 5px", fontSize: 9 }}
                          onClick={() => applyOdpSplitter({ splitterLossDb: null })}
                        >
                          Reset to default
                        </button>
                      </div>
                    ) : (
                      <strong style={{ color: "#91C4ED" }}>[Default: {effectiveLoss != null ? `${effectiveLoss.toFixed(2)} dB` : "Unknown"}]</strong>
                    )}
                  </div>
                </>
              );
            })()}

            {node.type === "splitter" && (() => {
              const currentRatio = typeof node.properties.splitterRatio === "string" ? node.properties.splitterRatio : "1:8";
              const isStandardRatio = ["1:2", "1:4", "1:8", "1:16", "1:32"].includes(currentRatio);
              const customLoss = typeof node.properties.splitterLossDb === "number" ? node.properties.splitterLossDb : null;
              const defaultLoss = project.settings.opticalBudget.splitterLossTable[currentRatio] ?? null;
              const effectiveLoss = customLoss ?? defaultLoss;
              const currentCap = typeof node.properties.outputPorts === "number"
                ? node.properties.outputPorts
                : typeof node.properties.portCapacity === "number"
                  ? node.properties.portCapacity
                  : typeof node.properties.capacity === "number"
                    ? node.properties.capacity
                    : parseSplitterOutputCount(currentRatio);

              return (
                <>
                  <label className="field-label">
                    Splitter type
                    <select
                      value={String(node.properties.splitterType ?? "plc").toLowerCase()}
                      onChange={(e) => onNodeProperties?.(node.id, { splitterType: e.target.value })}
                    >
                      <option value="plc">PLC (Planar Lightwave Circuit)</option>
                      <option value="fbt">FBT (Fused Biconical Taper)</option>
                      <option value="custom">Custom</option>
                    </select>
                  </label>
                  <label className="field-label">
                    Splitter ratio
                    <select
                      value={isStandardRatio ? currentRatio : "custom"}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val !== "custom") {
                          const cap = parseSplitterOutputCount(val);
                          onSplitterOpticalConfig?.(node.id, val, customLoss);
                          onNodeProperties?.(node.id, { splitterRatio: val, capacity: cap, outputPorts: cap });
                        }
                      }}
                    >
                      <option value="1:2">1:2</option>
                      <option value="1:4">1:4</option>
                      <option value="1:8">1:8</option>
                      <option value="1:16">1:16</option>
                      <option value="1:32">1:32</option>
                      <option value="custom">Custom ratio...</option>
                    </select>
                  </label>
                  {(!isStandardRatio || currentRatio === "custom") && (
                    <label className="field-label">
                      Custom ratio
                      <input
                        placeholder="e.g. 1:3, 1:12, 2:8"
                        value={currentRatio}
                        onChange={(e) => {
                          const ratio = e.target.value;
                          const cap = parseSplitterOutputCount(ratio);
                          onSplitterOpticalConfig?.(node.id, ratio, customLoss);
                          onNodeProperties?.(node.id, { splitterRatio: ratio, capacity: cap, outputPorts: cap });
                        }}
                      />
                    </label>
                  )}
                  <label className="field-label">
                    Output ports count
                    <input
                      type="number"
                      min="1"
                      value={currentCap}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (val > 0) onNodeProperties?.(node.id, { capacity: val, outputPorts: val });
                      }}
                    />
                  </label>
                  <label className="field-label">
                    Insertion loss (dB)
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={customLoss != null ? customLoss : ""}
                      placeholder={defaultLoss != null ? `${defaultLoss.toFixed(2)} dB (default)` : "e.g. 10.2 dB"}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const val = raw.trim() === "" ? null : Number(raw);
                        onSplitterOpticalConfig?.(node.id, currentRatio, val);
                        onNodeProperties?.(node.id, { splitterLossDb: val });
                      }}
                    />
                  </label>
                  <div className="property-row">
                    <span>Loss parameter status</span>
                    {customLoss != null ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <strong style={{ color: "#F0B429" }}>[Custom: {customLoss.toFixed(2)} dB]</strong>
                        <button
                          type="button"
                          className="secondary-button"
                          style={{ padding: "1px 5px", fontSize: 9 }}
                          onClick={() => {
                            onSplitterOpticalConfig?.(node.id, currentRatio, null);
                            onNodeProperties?.(node.id, { splitterLossDb: null });
                          }}
                        >
                          Reset to default
                        </button>
                      </div>
                    ) : (
                      <strong style={{ color: "#91C4ED" }}>[Default: {effectiveLoss != null ? `${effectiveLoss.toFixed(2)} dB` : "Unknown"}]</strong>
                    )}
                  </div>
                </>
              );
            })()}

            <div className="property-row">
              <span>Port summary</span>
              <strong>{ports.length} total · {connectedCount} connected · {availableCount} avail · {disabledCount} dis</strong>
            </div>

            {/* Ports Table */}
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              {ports.map((port) => {
                const isConn = port.status === "connected";
                const isDis = port.status === "disabled";
                const statusColor = isConn ? "#91C4ED" : isDis ? "#888C94" : "#91EDB5";

                return (
                  <div
                    key={port.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 6,
                      padding: "4px 6px",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 4,
                      fontSize: 10,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 600, color: "#F0F1F3", minWidth: 55 }}>{port.id}</span>
                      <input
                        style={{
                          flex: 1,
                          minWidth: 60,
                          padding: "2px 4px",
                          background: "#1c1e23",
                          border: "1px solid rgba(255,255,255,0.15)",
                          borderRadius: 3,
                          color: "#F0F1F3",
                          fontSize: 10,
                        }}
                        value={port.label}
                        onChange={(e) => updatePortConfig(node, port.id, { label: e.target.value })}
                        placeholder="Port label"
                        aria-label={`Label for port ${port.id}`}
                      />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: statusColor, fontWeight: 600, textTransform: "capitalize" }}>
                        {port.status}
                      </span>
                      {port.connectedNodeName && (
                        <span style={{ color: "#C1C5CC", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          → {port.connectedNodeName}
                        </span>
                      )}
                      {!isConn && (
                        <button
                          type="button"
                          className="secondary-button"
                          style={{ padding: "2px 6px", fontSize: 9 }}
                          onClick={() => updatePortConfig(node, port.id, { status: isDis ? "available" : "disabled" })}
                        >
                          {isDis ? "Enable" : "Disable"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })()}

      {/* SECTION 3: INSTALLED PASSIVE COMPONENTS (For ODC, ODP, and Splitter) */}
      {selected.kind === "node" && (selected.item.type === "odc" || selected.item.type === "odp") && (
        <section className="splitter-config-panel" aria-label="Installed passive components">
          <div className="section-heading"><span>3. INSTALLED PASSIVE COMPONENTS</span></div>
          {hostedSplitters.length === 0 ? (
            <p className="hint">No splitter installation is associated with this cabinet.</p>
          ) : (
            hostedSplitters.map((splitter) => {
              const assignments = Array.isArray(splitter.properties.outputPortAssignments) ? splitter.properties.outputPortAssignments as Array<{ portId?: string; connectedNodeId?: string }> : [];
              const ratio = typeof splitter.properties.splitterRatio === "string" ? splitter.properties.splitterRatio : "Ratio unknown";
              const ratioCapacity = ratio.split(":")[1] ?? "?";
              const profileLoss = project.settings.opticalBudget.splitterLossTable[ratio];
              const lossDisplay = typeof splitter.properties.splitterLossDb === "number" ? `${splitter.properties.splitterLossDb} dB · configured` : typeof profileLoss === "number" ? `${profileLoss} dB · profile assumption` : "loss unknown";
              return (
                <div key={splitter.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, margin: "4px 0" }}>
                  <button type="button" className="connection-row installed-splitter-row" style={{ flex: 1, margin: 0 }} onClick={() => onSelect?.({ kind: "node", id: splitter.id })}>
                    <span>{splitter.name}<small>{ratio} · {lossDisplay} · {assignments.length}/{String(splitter.properties.capacity ?? ratioCapacity)} ports</small></span>
                    <small>Input {String(splitter.properties.inputPortId ?? "unknown")} · {assignments.map((assignment) => assignment.portId).filter(Boolean).join(", ") || "outputs unmapped"}</small>
                  </button>
                  <button
                    type="button"
                    className="icon-button danger"
                    aria-label={`Remove splitter ${splitter.name}`}
                    title="Remove internal splitter"
                    onClick={() => onRemoveInternalSplitter?.(splitter.id)}
                  >
                    ×
                  </button>
                </div>
              );
            })
          )}

          {/* Add Internal Splitter Form */}
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.1)", display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#91C4ED" }}>Add internal splitter</span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <label className="field-label" style={{ margin: 0 }}>
                Ratio
                <select
                  style={{ margin: 0, padding: "3px 5px", fontSize: 10 }}
                  value={newSplitterRatio}
                  onChange={(e) => setNewSplitterRatio(e.target.value)}
                  aria-label="New internal splitter ratio"
                >
                  <option value="1:2">1:2</option>
                  <option value="1:4">1:4</option>
                  <option value="1:8">1:8</option>
                  <option value="1:16">1:16</option>
                  <option value="1:32">1:32</option>
                  <option value="custom">Custom...</option>
                </select>
              </label>
              <label className="field-label" style={{ margin: 0 }}>
                Type
                <select
                  style={{ margin: 0, padding: "3px 5px", fontSize: 10 }}
                  value={newSplitterType}
                  onChange={(e) => setNewSplitterType(e.target.value as "plc" | "fbt")}
                >
                  <option value="plc">PLC</option>
                  <option value="fbt">FBT</option>
                </select>
              </label>
            </div>
            {newSplitterRatio === "custom" && (
              <label className="field-label" style={{ margin: 0 }}>
                Custom ratio
                <input
                  style={{ margin: 0, padding: "3px 5px", fontSize: 10 }}
                  placeholder="e.g. 1:3, 1:12, 2:8"
                  value={newSplitterCustomRatio}
                  onChange={(e) => setNewSplitterCustomRatio(e.target.value)}
                />
              </label>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <label className="field-label" style={{ margin: 0 }}>
                Custom loss (dB)
                <input
                  style={{ margin: 0, padding: "3px 5px", fontSize: 10 }}
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Default"
                  value={newSplitterCustomLoss}
                  onChange={(e) => setNewSplitterCustomLoss(e.target.value)}
                />
              </label>
              <label className="field-label" style={{ margin: 0 }}>
                Output ports
                <input
                  style={{ margin: 0, padding: "3px 5px", fontSize: 10 }}
                  type="number"
                  min="1"
                  placeholder={String(parseSplitterOutputCount(newSplitterRatio === "custom" ? newSplitterCustomRatio : newSplitterRatio))}
                  value={newSplitterCapacity}
                  onChange={(e) => setNewSplitterCapacity(e.target.value)}
                />
              </label>
            </div>
            <button
              type="button"
              className="secondary-button"
              style={{ whiteSpace: "nowrap", marginTop: 4 }}
              onClick={() => {
                const node = selected.item;
                const effectiveRatio = newSplitterRatio === "custom" ? (newSplitterCustomRatio || "1:8") : newSplitterRatio;
                const autoCap = parseSplitterOutputCount(effectiveRatio);
                const explicitCap = newSplitterCapacity ? parseInt(newSplitterCapacity, 10) : null;
                const cap = explicitCap && explicitCap > 0 ? explicitCap : autoCap;
                const profileLoss = project.settings.opticalBudget.splitterLossTable[effectiveRatio] ?? null;
                const customLossNum = newSplitterCustomLoss ? Number(newSplitterCustomLoss) : null;
                const effectiveLoss = customLossNum != null && Number.isFinite(customLossNum) ? customLossNum : profileLoss;

                const newSplitter: NetworkNode = {
                  id: crypto.randomUUID(),
                  name: `${node.name} Splitter ${effectiveRatio}`,
                  type: "splitter",
                  location: { ...node.location },
                  properties: {
                    mountedInNodeId: node.id,
                    splitterRatio: effectiveRatio,
                    capacity: cap,
                    outputPorts: cap,
                    portCapacity: cap,
                    splitterLossDb: effectiveLoss,
                    splitterType: newSplitterType,
                    inputPortId: "IN-1",
                    outputPortAssignments: [],
                  },
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                };
                onAddInternalSplitter?.(node.id, newSplitter);
                setNewSplitterCustomRatio("");
                setNewSplitterCustomLoss("");
                setNewSplitterCapacity("");
              }}
            >
              + Add internal splitter
            </button>
          </div>
          <p className="hint">Splitters are internal cabinet components. Port labels describe logical topology; hardware model and port mapping remain unverified.</p>
        </section>
      )}

      {/* For Splitter itself: Component configuration */}
      {selected.kind === "node" && (selected.item.type === "splitter" || selected.item.properties.splitterRatio !== undefined || selected.item.properties.splitterLossDb !== undefined) && (() => {
        const spl = selected.item;
        const currentRatio = typeof spl.properties.splitterRatio === "string" ? spl.properties.splitterRatio : "";
        const isStandardRatio = ["1:2", "1:4", "1:8", "1:16", "1:32"].includes(currentRatio);
        const cap = typeof spl.properties.capacity === "number" ? spl.properties.capacity : (currentRatio.includes(":") ? Number(currentRatio.split(":")[1]) || null : null);
        const assignments = Array.isArray(spl.properties.outputPortAssignments) ? spl.properties.outputPortAssignments as Array<{ portId?: string; connectedNodeId?: string }> : [];
        const outgoingConns = project.connections.filter((conn) => conn.fromNodeId === spl.id).length;
        const incomingConns = project.connections.filter((conn) => conn.toNodeId === spl.id).length;
        const usedInputs = mounted ? (spl.properties.inputPortId ? 1 : 0) : incomingConns;
        const usedOutputs = mounted ? assignments.length : outgoingConns;
        const profileLoss = currentRatio ? project.settings.opticalBudget.splitterLossTable[currentRatio] : undefined;
        const customLoss = typeof spl.properties.splitterLossDb === "number" ? spl.properties.splitterLossDb : null;
        const effectiveLoss = customLoss ?? profileLoss;
        const lossSource = customLoss != null ? "Configured" : typeof profileLoss === "number" ? "Planning Default" : "Unknown";

        return (
          <section className="splitter-config-panel">
            <div className="section-heading"><span>3. INSTALLED PASSIVE COMPONENTS</span></div>
            <label className="field-label">
              Splitter type
              <select
                value={String(spl.properties.splitterType ?? "plc").toLowerCase()}
                onChange={(e) => onNodeProperties?.(spl.id, { splitterType: e.target.value })}
              >
                <option value="plc">PLC (Planar Lightwave Circuit)</option>
                <option value="fbt">FBT (Fused Biconical Taper)</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <div className="property-row"><span>Splitter ratio</span><strong>{currentRatio || "Unconfigured"}</strong></div>
            <div className="property-row"><span>Insertion loss</span><strong>{effectiveLoss != null ? `${effectiveLoss.toFixed(2)} dB (${lossSource})` : "Unknown"}</strong></div>
            <div className="property-row"><span>Used inputs / outputs</span><strong>{usedInputs} input · {usedOutputs}{cap ? ` / ${cap}` : ""} outputs</strong></div>
            {mounted && (
              <>
                <div className="property-row"><span>Installation host</span><strong>{project.nodes.find((node) => node.id === selected.item.properties.mountedInNodeId)?.name ?? "Invalid cabinet reference"}</strong></div>
                <div className="property-row"><span>Optical ports</span><strong>{String(selected.item.properties.inputPortId ?? "unknown")} → {Array.isArray(selected.item.properties.outputPortAssignments) ? `${(selected.item.properties.outputPortAssignments as Array<{portId?: string}>).map((assignment) => assignment.portId).join(", ")} (logical mapping)` : "Unmapped"}</strong></div>
                <p className="hint">Internal passive component · no geographic jumper cable.</p>
              </>
            )}
            <label className="field-label">
              Physical ratio
              <select
                aria-label="Splitter ratio"
                value={isStandardRatio ? currentRatio : currentRatio ? "custom" : ""}
                onChange={(event) => {
                  const val = event.target.value;
                  if (val !== "custom") {
                    const nextCap = val ? parseSplitterOutputCount(val) : null;
                    onSplitterOpticalConfig?.(selected.item.id, val || null, customLoss);
                    if (nextCap) onNodeProperties?.(selected.item.id, { capacity: nextCap, outputPorts: nextCap });
                  }
                }}
              >
                <option value="">Unknown / unconfigured</option>
                {Object.keys(project.settings.opticalBudget.splitterLossTable).map((r) => <option value={r} key={r}>{r}</option>)}
                <option value="custom">Custom ratio...</option>
              </select>
            </label>
            {(!isStandardRatio && Boolean(currentRatio)) && (
              <label className="field-label">
                Custom ratio
                <input
                  placeholder="e.g. 1:3, 1:12, 2:8"
                  value={currentRatio}
                  onChange={(e) => {
                    const ratio = e.target.value;
                    const nextCap = parseSplitterOutputCount(ratio);
                    onSplitterOpticalConfig?.(selected.item.id, ratio || null, customLoss);
                    if (nextCap) onNodeProperties?.(selected.item.id, { capacity: nextCap, outputPorts: nextCap });
                  }}
                />
              </label>
            )}
            <label className="field-label">
              Output ports count
              <input
                type="number"
                min="1"
                value={typeof spl.properties.outputPorts === "number" ? spl.properties.outputPorts : typeof spl.properties.capacity === "number" ? spl.properties.capacity : cap ?? ""}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (val > 0) onNodeProperties?.(spl.id, { capacity: val, outputPorts: val });
                }}
              />
            </label>
            <label className="field-label address-field">
              Actual insertion loss (dB)
              <input
                aria-label="Actual splitter insertion loss dB"
                type="number"
                min="0"
                step="0.01"
                value={customLoss != null ? customLoss : ""}
                placeholder={profileLoss != null ? `${profileLoss.toFixed(2)} dB (planning default)` : "Custom loss"}
                onChange={(event) => {
                  const raw = event.target.value;
                  if (raw.trim() === "") {
                    onSplitterOpticalConfig?.(selected.item.id, currentRatio || null, null);
                    onNodeProperties?.(selected.item.id, { splitterLossDb: null });
                  } else {
                    const loss = Number(raw);
                    if (Number.isFinite(loss) && loss >= 0) {
                      onSplitterOpticalConfig?.(selected.item.id, currentRatio || null, loss);
                      onNodeProperties?.(selected.item.id, { splitterLossDb: loss });
                    }
                  }
                }}
              />
            </label>
            <div className="property-row">
              <span>Loss parameter status</span>
              {customLoss != null ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <strong style={{ color: "#F0B429" }}>[Custom: {customLoss.toFixed(2)} dB]</strong>
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ padding: "1px 5px", fontSize: 9 }}
                    onClick={() => {
                      onSplitterOpticalConfig?.(selected.item.id, currentRatio || null, null);
                      onNodeProperties?.(selected.item.id, { splitterLossDb: null });
                    }}
                  >
                    Reset to default
                  </button>
                </div>
              ) : (
                <strong style={{ color: "#91C4ED" }}>[Default: {effectiveLoss != null ? `${effectiveLoss.toFixed(2)} dB` : "Unknown"}]</strong>
              )}
            </div>
            {onRecalculate && (
              <button
                type="button"
                className="secondary-button"
                style={{ marginTop: 8, width: "100%" }}
                onClick={onRecalculate}
              >
                Recalculate Optical Budget
              </button>
            )}
            <p className="hint">Leave blank to use the optical profile planning default for the selected ratio, or enter a custom insertion loss (dB).</p>
          </section>
        );
      })()}

      {/* SECTION 4: CONNECTED DEVICES (For all nodes) */}
      {selected.kind === "node" && (() => {
        const node = selected.item;
        const nodeConnections = project.connections.filter((c) => c.fromNodeId === node.id || c.toNodeId === node.id);

        return (
          <section className="splitter-config-panel" aria-label="Connected devices">
            <div className="section-heading"><span>4. CONNECTED DEVICES</span></div>
            {nodeConnections.length === 0 ? (
              <p className="hint">No connected devices.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {nodeConnections.map((conn) => {
                  const isOutgoing = conn.fromNodeId === node.id;
                  const remoteNodeId = isOutgoing ? conn.toNodeId : conn.fromNodeId;
                  const remoteNode = nodesById[remoteNodeId];
                  const localPort = isOutgoing ? (conn.fromPortId || "Default Out") : (conn.toPortId || "Default In");
                  const remotePort = isOutgoing ? (conn.toPortId || "Default In") : (conn.fromPortId || "Default Out");
                  const cable = project.cableSegments.find((c) => c.id === conn.cableSegmentId);
                  const linkedCustomer = remoteNode?.type === "ont" ? project.customers.find((c) => c.ontNodeId === remoteNode.id) : null;

                  return (
                    <div
                      key={conn.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 6,
                        padding: "6px 8px",
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.07)",
                        borderRadius: 4,
                        fontSize: 10,
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontWeight: 600, color: "#F0F1F3" }}>[{localPort}]</span>
                          <span style={{ color: "#A1A6B0" }}>{isOutgoing ? "→" : "←"}</span>
                          <strong style={{ color: "#F0F1F3" }}>{remoteNode?.name ?? remoteNodeId}</strong>
                          <span style={{ color: "#A1A6B0" }}>({remoteNode?.type.toUpperCase() ?? "?"})</span>
                          <span style={{ color: "#91C4ED" }}>[{remotePort}]</span>
                        </div>
                        {linkedCustomer && (
                          <div style={{ color: "#D6D8DC" }}>
                            Pelanggan: <strong>{linkedCustomer.name}</strong> ({linkedCustomer.id.slice(0, 8)})
                          </div>
                        )}
                        {cable && (
                          <small style={{ color: "#8E94A0" }}>
                            Kabel: {cable.name} {cable.lengthM != null ? `(${cable.lengthM.toFixed(1)} m)` : ""}
                          </small>
                        )}
                      </div>
                      <button
                        type="button"
                        className="secondary-button"
                        style={{ padding: "3px 7px", fontSize: 9, color: "#FFAAA0", borderColor: "rgba(255,170,160,0.3)" }}
                        onClick={() => onDisconnectConnection?.(conn.id)}
                        aria-label={`Disconnect ${conn.id}`}
                      >
                        Disconnect
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })()}

      {/* SECTION 5: OPTICAL PARAMETERS */}
      {/* 5A. OLT Summary & Optical Parameters */}
      {selected.kind === "node" && selected.item.type === "olt" && (() => {
        const olt = selected.item;
        const ponCapacity = typeof olt.properties.ponPortCapacity === "number" ? olt.properties.ponPortCapacity : typeof olt.properties.ponPorts === "number" ? olt.properties.ponPorts : 4;
        const ponSource = olt.properties.capacitySource === "configured" ? "Configured" : "Planning Default";
        const outgoingCount = project.connections.filter((conn) => conn.fromNodeId === olt.id).length;
        const customTx = typeof olt.properties.txPowerDbm === "number" ? olt.properties.txPowerDbm : null;
        const defaultTx = project.settings.opticalBudget.txPowerDbm;
        const txPower = customTx ?? defaultTx;
        const txSource = customTx != null ? "Configured" : "Planning Default";
        return (
          <section className="splitter-config-panel" aria-label="OLT optical parameters">
            <div className="section-heading"><span>5. OPTICAL PARAMETERS</span></div>
            <label className="field-label">
              Optical transmit power (dBm)
              <input
                type="number"
                step="0.01"
                value={customTx != null ? customTx : ""}
                placeholder={`${defaultTx >= 0 ? "+" : ""}${defaultTx.toFixed(2)} dBm (planning default)`}
                onChange={(e) => {
                  const raw = e.target.value;
                  onNodeProperties?.(olt.id, {
                    txPowerDbm: raw.trim() === "" ? null : Number(raw),
                  });
                }}
              />
            </label>
            <div className="property-row">
              <span>Transmit power</span>
              {customTx != null ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <strong style={{ color: "#F0B429" }}>{customTx >= 0 ? "+" : ""}{customTx.toFixed(2)} dBm ({txSource})</strong>
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ padding: "1px 5px", fontSize: 9 }}
                    onClick={() => onNodeProperties?.(olt.id, { txPowerDbm: null })}
                  >
                    Reset
                  </button>
                </div>
              ) : (
                <strong style={{ color: "#91C4ED" }}>{txPower >= 0 ? "+" : ""}{txPower.toFixed(2)} dBm ({txSource})</strong>
              )}
            </div>
            <div className="property-row"><span>PON port capacity</span><strong>{ponCapacity} ports ({ponSource})</strong></div>
            <div className="property-row"><span>Used PON ports</span><strong>{outgoingCount} / {ponCapacity}</strong></div>
            <div className="property-row"><span>Max subscribers / port</span><strong>{typeof olt.properties.maxCustomersPerPort === "number" ? olt.properties.maxCustomersPerPort : 64}</strong></div>
            {onRecalculate && (
              <button
                type="button"
                className="secondary-button"
                style={{ marginTop: 8, width: "100%" }}
                onClick={onRecalculate}
              >
                Recalculate Optical Budget
              </button>
            )}
          </section>
        );
      })()}

      {/* 5B. Intermediate Optical Analysis for ODC & ODP */}
      {selected.kind === "node" && (selected.item.type === "odc" || selected.item.type === "odp") && (() => {
        const intermediate = opticalResult?.intermediateNodes?.find((entry) => entry.nodeId === selected.item.id);
        const display = (value: number | null | undefined, unit: string) => value == null || !Number.isFinite(value) ? "Unknown" : `${value.toFixed(2)} ${unit}`;
        return (
          <section className="splitter-config-panel" aria-label="Intermediate optical analysis">
            <div className="section-heading"><span>5. ESTIMATED PASSIVE-NODE POWER</span></div>
            {!opticalResult ? (
              <p className="hint">Run Optical Analysis to calculate the directed OLT path.</p>
            ) : !intermediate ? (
              <p className="hint">No intermediate result was returned for this node.</p>
            ) : (
              <>
                <p className="hint">Estimated optical power at passive {selected.item.type.toUpperCase()} · not measured receiver power.</p>
                <div className="property-row"><span>Status</span><strong>{intermediate.status}</strong></div>
                <div className="property-row"><span>Path length</span><strong>{display(intermediate.lengthM, "m")}</strong></div>
                <div className="property-row"><span>Originating OLT</span><strong>{intermediate.sourceOltName ?? intermediate.sourceOltId ?? "Unknown"}{intermediate.transmitterPowerDbm == null ? " · launch power unknown" : ` · ${display(intermediate.transmitterPowerDbm, "dBm")}`}</strong></div>
                <div className="property-row"><span>Accumulated loss</span><strong>{display(intermediate.accumulatedLossDb, "dB")}</strong></div>
                <div className="property-row"><span>Estimated optical power</span><strong>{display(intermediate.estimatedPowerDbm, "dBm")}</strong></div>
                <p className="hint">Loss entries show individual component loss and cumulative physical loss from the OLT. Safety margin is separate and is not subtracted from this estimated power.</p>
                <OpticalCalculationTable
                  rows={intermediate.lossBreakdown ?? []}
                  categoryLossesDb={intermediate.categoryLossesDb}
                  physicalLossDb={intermediate.accumulatedLossDb}
                  designMarginDb={intermediate.designMarginDb}
                  totalDesignAllowanceDb={intermediate.totalDesignAllowanceDb}
                  powerLabel="Estimated optical power at passive node"
                  powerDbm={intermediate.estimatedPowerDbm}
                  profileId={intermediate.profileId}
                  parameterSources={intermediate.parameterSources}
                />
                {Object.entries(intermediate.parameterSources ?? {}).length > 0 && (
                  <p className="hint">Input provenance: {Object.entries(intermediate.parameterSources ?? {}).map(([key, source]) => `${key} (${source.replace(/_/g, " ")})`).join(" · ")}</p>
                )}
                {intermediate.diagnostics?.map((message, index) => <p className="hint" role="status" key={index}>{message}</p>)}
              </>
            )}
            {onRecalculate && (
              <button
                type="button"
                className="secondary-button"
                style={{ marginTop: 8, width: "100%" }}
                onClick={onRecalculate}
              >
                Recalculate Optical Budget
              </button>
            )}
          </section>
        );
      })()}

      {/* 5C. ONT Optical Summary and Path Status */}
      {selected.kind === "node" && selected.item.type === "ont" && (() => {
        const ont = selected.item;
        const linkedCustomer = project.customers.find((cust) => cust.ontNodeId === ont.id) ?? (typeof ont.properties.customerId === "string" ? project.customers.find((cust) => cust.id === ont.properties.customerId) : undefined);
        const upstreamConn = project.connections.find((conn) => conn.toNodeId === ont.id);
        const upstreamNode = upstreamConn ? project.nodes.find((node) => node.id === upstreamConn.fromNodeId) : undefined;
        const upstreamHost = upstreamNode?.type === "splitter" && typeof upstreamNode.properties.mountedInNodeId === "string"
          ? project.nodes.find((node) => node.id === upstreamNode.properties.mountedInNodeId)
          : upstreamNode;
        const dropCable = upstreamConn ? project.cableSegments.find((cable) => cable.id === upstreamConn.cableSegmentId) : undefined;
        const path = opticalResult?.paths.find((entry) => entry.ontNodeId === ont.id);
        const dropLen = dropCable?.lengthM ?? path?.segments?.[path.segments.length - 1]?.lengthM ?? null;
        const details = path?.details ?? {};
        const safetyMargin = typeof details.safetyMarginDb === "number" ? details.safetyMarginDb : path?.designMarginDb;
        const designAllowance = typeof details.totalLossDb === "number" ? details.totalLossDb : path?.totalDesignAllowanceDb;

        const customSensitivity = typeof ont.properties.rxSensitivityDbm === "number" ? ont.properties.rxSensitivityDbm : null;
        const defaultSensitivity = project.settings.opticalBudget.rxSensitivityDbm;
        const customOverload = typeof ont.properties.rxOverloadDbm === "number" ? ont.properties.rxOverloadDbm : null;
        const defaultOverload = project.settings.opticalBudget.rxOverloadDbm;

        return (
          <section className="splitter-config-panel" aria-label="ONT optical parameters">
            <div className="section-heading"><span>5. OPTICAL PARAMETERS</span></div>
            <div className="property-row"><span>Customer</span><strong>{linkedCustomer ? `${linkedCustomer.name} (${linkedCustomer.id.slice(0, 8)})` : "Unassigned"}</strong></div>
            <div className="property-row"><span>Upstream ODP</span><strong>{upstreamHost?.name ?? "Unconnected"}{upstreamConn?.fromPortId ? ` (${upstreamConn.fromPortId})` : ""}</strong></div>
            <div className="property-row"><span>Drop cable length</span><strong>{dropLen == null ? "Unknown" : `${dropLen.toFixed(2)} m`}</strong></div>

            <label className="field-label">
              Receiver sensitivity (dBm)
              <input
                type="number"
                step="0.1"
                value={customSensitivity != null ? customSensitivity : ""}
                placeholder={`${defaultSensitivity.toFixed(2)} dBm (default)`}
                onChange={(e) => {
                  const raw = e.target.value;
                  onNodeProperties?.(ont.id, {
                    rxSensitivityDbm: raw.trim() === "" ? null : Number(raw),
                  });
                }}
              />
            </label>
            <div className="property-row">
              <span>Sensitivity status</span>
              {customSensitivity != null ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <strong style={{ color: "#F0B429" }}>[Custom: {customSensitivity.toFixed(2)} dBm]</strong>
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ padding: "1px 5px", fontSize: 9 }}
                    onClick={() => onNodeProperties?.(ont.id, { rxSensitivityDbm: null })}
                  >
                    Reset
                  </button>
                </div>
              ) : (
                <strong style={{ color: "#91C4ED" }}>[Default: {defaultSensitivity.toFixed(2)} dBm]</strong>
              )}
            </div>

            <label className="field-label">
              Receiver overload threshold (dBm)
              <input
                type="number"
                step="0.1"
                value={customOverload != null ? customOverload : ""}
                placeholder={`${defaultOverload.toFixed(2)} dBm (default)`}
                onChange={(e) => {
                  const raw = e.target.value;
                  onNodeProperties?.(ont.id, {
                    rxOverloadDbm: raw.trim() === "" ? null : Number(raw),
                  });
                }}
              />
            </label>
            <div className="property-row">
              <span>Overload status</span>
              {customOverload != null ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <strong style={{ color: "#F0B429" }}>[Custom: {customOverload.toFixed(2)} dBm]</strong>
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ padding: "1px 5px", fontSize: 9 }}
                    onClick={() => onNodeProperties?.(ont.id, { rxOverloadDbm: null })}
                  >
                    Reset
                  </button>
                </div>
              ) : (
                <strong style={{ color: "#91C4ED" }}>[Default: {defaultOverload.toFixed(2)} dBm]</strong>
              )}
            </div>

            <div className="property-row"><span>Estimated received power</span><strong>{path?.receivedPowerDbm == null ? "Unknown" : `${path.receivedPowerDbm.toFixed(2)} dBm`}</strong></div>
            <div className="property-row"><span>Optical status</span><strong>{path ? path.status.toUpperCase() : "NOT RUN"}</strong></div>
            <div className="property-row"><span>Physical route status</span><strong>{(path?.physicalRouteStatus ?? "unverified").toUpperCase()}</strong></div>
            {path && (
              <>
                <div className="property-row"><span>Topology reachability</span><strong>{path.connectivityStatus}</strong></div>
                {path.statusReason && <p className="hint" role="status">{path.statusReason.replace(/_/g, " ")}</p>}
                <OpticalCalculationTable
                  rows={path.lossBreakdown ?? []}
                  categoryLossesDb={path.categoryLossesDb}
                  physicalLossDb={path.lossDb}
                  designMarginDb={safetyMargin}
                  totalDesignAllowanceDb={designAllowance}
                  powerLabel="Received optical power"
                  powerDbm={path.receivedPowerDbm}
                  profileId={path.profileId}
                  parameterSources={path.parameterSources}
                />
                {path.diagnostics?.map((diagnostic, index) => <p className="hint" role="status" key={`${diagnostic.code}-${index}`}>{diagnostic.message}</p>)}
              </>
            )}
            {onRecalculate && (
              <button
                type="button"
                className="secondary-button"
                style={{ marginTop: 8, width: "100%" }}
                onClick={onRecalculate}
              >
                Recalculate Optical Budget
              </button>
            )}
          </section>
        );
      })()}

      {/* CABLE PROPERTIES */}
      {selected.kind === "cable" && (
        <>
          <div className="property-row">
            <span>Endpoints</span>
            <strong>
              {(() => {
                const connection = project.connections.find((entry) => entry.cableSegmentId === selected.item.id);
                const startId = connection?.fromNodeId ?? selected.item.startNodeId;
                const endId = connection?.toNodeId ?? selected.item.endNodeId;
                return `${project.nodes.find((node) => node.id === startId)?.name ?? "Unassigned"} → ${project.nodes.find((node) => node.id === endId)?.name ?? "Unassigned"}`;
              })()}
            </strong>
          </div>
          <div className="property-row"><span>Fiber cores</span><strong>{selected.item.fiberCount ?? "Unspecified"}</strong></div>
          <div className="property-row"><span>Vertices</span><strong>{selected.item.geometry.coordinates.length}</strong></div>
          <div className="property-row"><span>Calculated length</span><strong>{lengthM === null ? "Not calculated" : `${lengthM.toLocaleString()} m`}</strong></div>
          {selected.item.properties.routeStatus === "manual_required" ? (
            selected.item.properties.connectionKind === "internal_optical_jumper" ? (
              <p className="hint">Internal jumper length is not recorded. Coincident node coordinates do not establish physical fiber length.</p>
            ) : (
              <p className="hint">Manual route planning required. No path geometry or cable length is verified.</p>
            )
          ) : selected.item.properties.routeStatus === "map_candidate_unverified" || selected.item.properties.routeStatus === "existing_geometry_unverified" ? (
            <p className="hint">Mapped route candidate · field verification required. This geometry is not a surveyed or approved fiber route.</p>
          ) : (
            <p className="hint">Drag the white handles to edit route geometry.</p>
          )}

          <label className="field-label address-field">
            Cable category
            <select
              aria-label="Cable category"
              value={resolveCableCategory(selected.item) ?? ""}
              onChange={(event) => {
                const cat = event.target.value as CableCategory | "";
                const nextType = cat && (!selected.item.cableType || ["feeder", "distribution", "drop", "indoor", "custom"].includes(selected.item.cableType.toLowerCase())) ? cat : selected.item.cableType;
                onCableAttributes(selection.id, nextType, selected.item.fiberCount, { cableCategory: cat || null, cableCategorySource: cat ? "manual" : "automatic" });
              }}
            >
              <option value="">Unspecified</option>
              {(Object.keys(CABLE_CATEGORY_LABELS) as CableCategory[]).map((cat) => (
                <option key={cat} value={cat}>{CABLE_CATEGORY_LABELS[cat]}</option>
              ))}
            </select>
          </label>
          <p className="hint">Recommendation: <strong>{recommendCableCategory(project, selected.item).category}</strong> · {recommendCableCategory(project, selected.item).explanation}</p>
          <button
            className="secondary-button"
            onClick={() => {
              const cat = recommendCableCategory(project, selected.item).category;
              onCableAttributes(selection.id, selected.item.cableType, selected.item.fiberCount, { cableCategory: cat, cableCategorySource: "automatic" });
            }}
          >
            Use recommendation
          </button>
          {cableCategoryWarning(project, selected.item) && <p role="status" className="hint">{cableCategoryWarning(project, selected.item)}</p>}
          <label className="field-label address-field">
            Deployment method
            <select
              aria-label="Deployment method"
              value={resolveDeploymentMethod(selected.item)}
              onChange={(event) => {
                const method = event.target.value as DeploymentMethod;
                onCableAttributes(selection.id, selected.item.cableType, selected.item.fiberCount, { deploymentMethod: method });
              }}
            >
              {(["unspecified", "aerial", "underground", "building_attached", "other"] as DeploymentMethod[]).map((method) => (
                <option key={method} value={method}>{DEPLOYMENT_METHOD_LABELS[method]}</option>
              ))}
            </select>
          </label>
          <label className="field-label address-field">
            Cable type
            <input value={selected.item.cableType} placeholder="e.g. Aerial SM G.652.D" onChange={(event) => onCableAttributes(selection.id, event.target.value, selected.item.fiberCount)} />
          </label>
          <label className="field-label address-field">
            Fiber count
            <input
              type="number"
              min="1"
              step="1"
              value={selected.item.fiberCount ?? ""}
              placeholder="Not specified"
              onChange={(event) => {
                const raw = event.target.value;
                const count = raw === "" ? null : Number(raw);
                if (count === null || (Number.isInteger(count) && count > 0)) onCableAttributes(selection.id, selected.item.cableType, count);
                else onInvalidFiberCount();
              }}
            />
          </label>
          <label className="field-label address-field">
            Pigtail splices
            <input
              aria-label="Cable pigtail splices"
              type="number"
              min="0"
              step="1"
              value={typeof selected.item.properties.pigtailSplicesCount === "number" ? selected.item.properties.pigtailSplicesCount : ""}
              placeholder="Default (0)"
              onChange={(event) => {
                const raw = event.target.value;
                const count = raw === "" ? null : Number(raw);
                if (count === null || (Number.isInteger(count) && count >= 0)) onCableAttributes(selection.id, selected.item.cableType, selected.item.fiberCount, { pigtailSplicesCount: count });
              }}
            />
          </label>

          {/* CABLE OPTICAL ATTENUATION PARAMETERS */}
          <section className="splitter-config-panel" style={{ marginTop: 8 }}>
            <div className="section-heading"><span>OPTICAL ATTENUATION PARAMETERS</span></div>
            <label className="field-label address-field">
              Fiber attenuation (dB/km)
              <input
                aria-label="Cable fiber attenuation dB per km"
                type="number"
                step="0.01"
                min="0"
                value={typeof selected.item.properties.fiberAttenuationDbPerKm === "number" ? selected.item.properties.fiberAttenuationDbPerKm : ""}
                placeholder={`${project.settings.opticalBudget.fiberAttenuationDbPerKm.toFixed(2)} dB/km (default)`}
                onChange={(e) => {
                  const raw = e.target.value;
                  const val = raw.trim() === "" ? null : Number(raw);
                  onCableAttributes(selected.item.id, selected.item.cableType, selected.item.fiberCount, {
                    fiberAttenuationDbPerKm: val,
                  });
                }}
              />
            </label>
            <div className="property-row">
              <span>Attenuation status</span>
              {typeof selected.item.properties.fiberAttenuationDbPerKm === "number" ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <strong style={{ color: "#F0B429" }}>[Custom: {Number(selected.item.properties.fiberAttenuationDbPerKm).toFixed(2)} dB/km]</strong>
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ padding: "1px 5px", fontSize: 9 }}
                    onClick={() => onCableAttributes(selected.item.id, selected.item.cableType, selected.item.fiberCount, { fiberAttenuationDbPerKm: null })}
                  >
                    Reset
                  </button>
                </div>
              ) : (
                <strong style={{ color: "#91C4ED" }}>[Default: {project.settings.opticalBudget.fiberAttenuationDbPerKm.toFixed(2)} dB/km]</strong>
              )}
            </div>

            <label className="field-label address-field">
              Connector loss (dB/interface)
              <input
                aria-label="Cable connector loss dB"
                type="number"
                step="0.01"
                min="0"
                value={typeof selected.item.properties.connectorLossDb === "number" ? selected.item.properties.connectorLossDb : ""}
                placeholder={`${project.settings.opticalBudget.connectorLossDb.toFixed(2)} dB (default)`}
                onChange={(e) => {
                  const raw = e.target.value;
                  onCableAttributes(selected.item.id, selected.item.cableType, selected.item.fiberCount, {
                    connectorLossDb: raw.trim() === "" ? null : Number(raw),
                  });
                }}
              />
            </label>
            <label className="field-label address-field">
              Connectors count
              <input
                aria-label="Cable connectors count"
                type="number"
                step="1"
                min="0"
                value={typeof selected.item.properties.connectorsCount === "number" ? selected.item.properties.connectorsCount : ""}
                placeholder={`${project.settings.opticalBudget.connectorsPerLink} interfaces (default)`}
                onChange={(e) => {
                  const raw = e.target.value;
                  onCableAttributes(selected.item.id, selected.item.cableType, selected.item.fiberCount, {
                    connectorsCount: raw.trim() === "" ? null : Number(raw),
                  });
                }}
              />
            </label>

            <label className="field-label address-field">
              Fusion splice loss (dB/splice)
              <input
                aria-label="Cable fusion splice loss dB"
                type="number"
                step="0.01"
                min="0"
                value={typeof selected.item.properties.spliceLossDb === "number" ? selected.item.properties.spliceLossDb : ""}
                placeholder={`${project.settings.opticalBudget.spliceLossDb.toFixed(2)} dB (default)`}
                onChange={(e) => {
                  const raw = e.target.value;
                  onCableAttributes(selected.item.id, selected.item.cableType, selected.item.fiberCount, {
                    spliceLossDb: raw.trim() === "" ? null : Number(raw),
                  });
                }}
              />
            </label>
            <label className="field-label address-field">
              Fusion splices count
              <input
                aria-label="Cable fusion splices count"
                type="number"
                step="1"
                min="0"
                value={typeof selected.item.properties.splicesCount === "number" ? selected.item.properties.splicesCount : ""}
                placeholder={`${project.settings.opticalBudget.splicesPerLink} splices (default)`}
                onChange={(e) => {
                  const raw = e.target.value;
                  onCableAttributes(selected.item.id, selected.item.cableType, selected.item.fiberCount, {
                    splicesCount: raw.trim() === "" ? null : Number(raw),
                  });
                }}
              />
            </label>

            {onRecalculate && (
              <button
                type="button"
                className="secondary-button"
                style={{ marginTop: 8, width: "100%" }}
                onClick={onRecalculate}
              >
                Recalculate Optical Budget
              </button>
            )}
          </section>
        </>
      )}

      {/* CABLE POLE SPAN LINKS */}
      {selected.kind === "cable" && (() => {
        const deploymentMethod = resolveDeploymentMethod(selected.item);
        const cableSpans = (project.poleSpans ?? []).filter((span) => span.cableSegmentId === selected.item.id);
        const isNonAerial = deploymentMethod === "underground" || deploymentMethod === "building_attached" || deploymentMethod === "other";
        return (
          <section className="splitter-config-panel">
            <div className="section-heading"><span>POLE SPAN LINKS</span></div>
            {isNonAerial ? (
              <p className="hint" role="note">Deployment method is set to {DEPLOYMENT_METHOD_LABELS[deploymentMethod]}. Poles and pole-span constraints are not required for this cable.{cableSpans.length > 0 ? " Existing linked pole spans are preserved below." : ""}</p>
            ) : (
              <>
                <p className="hint">Add an explicit link between poles (optional). When a cable has multiple spans, each sub-span length is resolved from matching route vertices or reported as Unknown.</p>
                <label className="field-label">Start pole
                  <select aria-label="Span start pole" value={spanFrom} onChange={(event) => setSpanFrom(event.target.value)}>
                    <option value="">Select pole</option>
                    {project.nodes.filter((node) => node.type === "pole").map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
                  </select>
                </label>
                <label className="field-label">End pole
                  <select aria-label="Span end pole" value={spanTo} onChange={(event) => setSpanTo(event.target.value)}>
                    <option value="">Select pole</option>
                    {project.nodes.filter((node) => node.type === "pole").map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
                  </select>
                </label>
                <button
                  className="secondary-button"
                  disabled={!onAddPoleSpan || !spanFrom || !spanTo || spanFrom === spanTo}
                  onClick={() => {
                    if (selected.kind !== "cable" || !spanFrom || !spanTo || spanFrom === spanTo) return;
                    const cable = selected.item;
                    const existingSpansForCable = (project.poleSpans ?? []).filter((s) => s.cableSegmentId === cable.id);
                    const fromPole = project.nodes.find((n) => n.id === spanFrom);
                    const toPole = project.nodes.find((n) => n.id === spanTo);
                    const subCoords = extractSubspanCoordinates(cable.geometry.coordinates, fromPole, toPole);
                    const coversEntire = existingSpansForCable.length === 0 && subCoords !== null && subCoords.length === cable.geometry.coordinates.length;
                    const resolvedLengthM = subCoords ? Number(approximateLengthMeters(subCoords).toFixed(2)) : (existingSpansForCable.length === 0 ? cable.lengthM : null);
                    const shouldCoverEntire = existingSpansForCable.length === 0 && (coversEntire || subCoords === null);
                    onAddPoleSpan?.({
                      id: crypto.randomUUID(),
                      cableSegmentId: cable.id,
                      fromPoleId: spanFrom,
                      toPoleId: spanTo,
                      geometry: subCoords && !shouldCoverEntire ? { type: "LineString", coordinates: subCoords } : null,
                      coversEntireCableRoute: shouldCoverEntire,
                      status: "unverified",
                      notes: "",
                      lengthM: resolvedLengthM,
                      lengthSource: resolvedLengthM === null ? "unknown" : "geometry",
                    });
                    setSpanFrom("");
                    setSpanTo("");
                  }}
                >
                  Link poles to this route
                </button>
              </>
            )}
            {cableSpans.map((span) => (
              <div className="connection-row" key={span.id}>
                <span>
                  {project.nodes.find((node) => node.id === span.fromPoleId)?.name ?? "Missing pole"} → {project.nodes.find((node) => node.id === span.toPoleId)?.name ?? "Missing pole"}
                  <small>{span.lengthM == null ? "Unknown" : `${span.lengthM.toLocaleString()} m`}</small>
                  <select
                    aria-label={`Span ${span.id} verification status`}
                    value={span.status}
                    onChange={(event) => {
                      const status = event.target.value;
                      if (["existing", "proposed", "shared", "unverified"].includes(status)) onPoleSpanStatus?.(span.id, status as PoleSpan["status"]);
                    }}
                  >
                    <option value="unverified">Unverified</option>
                    <option value="existing">Existing</option>
                    <option value="proposed">Proposed</option>
                    <option value="shared">Shared</option>
                  </select>
                </span>
                <button aria-label={`Remove pole span ${span.id}`} onClick={() => onDeletePoleSpan?.(span.id)}>×</button>
              </div>
            ))}
          </section>
        );
      })()}

      {/* CUSTOMER INSPECTOR */}
      {selected.kind === "customer" && (
        <>
          <label className="field-label address-field">
            Status
            <select
              value={selected.item.status}
              onChange={(event) => {
                const status = event.target.value;
                if (status === "planned" || status === "connected" || status === "on_hold") onCustomerStatus(selection.id, status);
              }}
            >
              <option value="planned">Planned</option>
              <option value="connected">Connected</option>
              <option value="on_hold">On hold</option>
            </select>
          </label>
          <label className="field-label address-field">
            Address
            <input value={selected.item.address} placeholder="Add service address" onChange={(event) => onCustomerAddress(selection.id, event.target.value)} />
          </label>
          <label className="field-label address-field">
            Associated ONT
            <select value={selected.item.ontNodeId ?? ""} onChange={(event) => onCustomerOnt(selection.id, event.target.value || null)}>
              <option value="">No ONT assigned</option>
              {project.nodes.filter((node) => node.type === "ont").map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
            </select>
          </label>
        </>
      )}

      {/* ROUTER INSPECTOR */}
      {selected.kind === "node" && selected.item.type === "router" && (
        <RouterConfigurationPanel
          configuration={readRouterConfiguration(selected.item.properties.routerConfiguration)}
          onChange={(configuration) => onRouterConfiguration(selected.item.id, configuration)}
        />
      )}

      {/* POLE INSPECTOR */}
      {selected.kind === "node" && selected.item.type === "pole" && (
        <section className="splitter-config-panel">
          <div className="section-heading"><span>POLE INFRASTRUCTURE</span></div>
          <label className="field-label">Pole type<input aria-label="Pole type" value={String(selected.item.properties.poleType ?? "")} placeholder="Unknown" onChange={(event) => onPoleProperties?.(selected.item.id, { poleType: event.target.value || null })} /></label>
          <label className="field-label">Material<input aria-label="Pole material" value={String(selected.item.properties.material ?? "")} placeholder="Unknown" onChange={(event) => onPoleProperties?.(selected.item.id, { material: event.target.value || null })} /></label>
          <label className="field-label">Height (m)<input aria-label="Pole height metres" type="number" min="0" step="0.1" value={typeof selected.item.properties.heightM === "number" ? selected.item.properties.heightM : ""} placeholder="Unknown" onChange={(event) => { const value = event.target.value; onPoleProperties?.(selected.item.id, { heightM: value === "" ? null : Number(value) }); }} /></label>
          <label className="field-label">Status<select aria-label="Pole status" value={String(selected.item.properties.status ?? "unverified")} onChange={(event) => onPoleProperties?.(selected.item.id, { status: event.target.value })}><option value="unverified">Unverified</option><option value="existing">Existing</option><option value="proposed">Proposed</option><option value="shared">Shared</option></select></label>
          <label className="field-label">Notes<textarea aria-label="Pole notes" value={String(selected.item.properties.notes ?? "")} placeholder="Optional notes" onChange={(event) => onPoleProperties?.(selected.item.id, { notes: event.target.value || null })} /></label>
          <p className="hint">Pole specifications remain unknown until entered. Pole status does not create an optical topology connection.</p>
        </section>
      )}

      {/* OPTICAL COMPONENTS PANEL */}
      {(selected.kind === "node" || selected.kind === "cable") && (
        <details className="optical-settings-panel">
          <summary>Physical optical components &amp; provenance</summary>
          <p className="optical-profile-note">Configured loss drives the calculation. Datasheet and field values remain separate references. Missing configured values stay unknown.</p>
          {opticalComponents.map((component) => (
            <section className="splitter-config-panel" key={component.id}>
              <strong>{component.kind} · {component.id}</strong>
              <button className="icon-button danger" aria-label={`Remove optical component ${component.id}`} onClick={() => onOpticalComponentsChange?.((project.opticalComponents ?? []).filter((item) => item.id !== component.id))}>Remove component</button>
              <label className="field-label">Component kind<input aria-label={`${component.id} kind`} value={component.kind} onChange={(event) => updateOpticalComponent(component.id, { kind: event.target.value })} /></label>
              <label className="field-label">Configured loss (dB)<input aria-label={`${component.id} configured loss`} type="number" min="0" step="0.01" value={component.configuredLossDb ?? ""} placeholder="Unknown" onChange={(event) => { const raw = event.target.value; updateOpticalComponent(component.id, { configuredLossDb: raw === "" ? null : Number(raw), configuredSource: raw === "" ? "unknown" : "configured" }); }} /></label>
              <label className="field-label">Location<input aria-label={`${component.id} location`} value={component.location ?? ""} placeholder="Unknown location" onChange={(event) => updateOpticalComponent(component.id, { location: event.target.value || null })} /></label>
              <label className="field-label">Datasheet loss (dB)<input aria-label={`${component.id} datasheet loss`} type="number" min="0" step="0.01" value={component.datasheetLossDb ?? ""} onChange={(event) => updateOpticalComponent(component.id, { datasheetLossDb: event.target.value === "" ? null : Number(event.target.value) })} /></label>
              <label className="field-label">Datasheet reference<input aria-label={`${component.id} datasheet reference`} value={component.datasheetReference ?? ""} onChange={(event) => updateOpticalComponent(component.id, { datasheetReference: event.target.value || null })} /></label>
              <label className="field-label">Datasheet model<input aria-label={`${component.id} datasheet model`} value={component.datasheetModel ?? ""} onChange={(event) => updateOpticalComponent(component.id, { datasheetModel: event.target.value || null })} /></label>
              <label className="field-label">Measured loss (dB)<input aria-label={`${component.id} measured loss`} type="number" min="0" step="0.01" value={component.measuredLossDb ?? ""} onChange={(event) => updateOpticalComponent(component.id, { measuredLossDb: event.target.value === "" ? null : Number(event.target.value) })} /></label>
              <label className="field-label">Measurement date<input aria-label={`${component.id} measurement date`} type="datetime-local" value={component.measuredAt?.slice(0, 16) ?? ""} onChange={(event) => updateOpticalComponent(component.id, { measuredAt: event.target.value ? new Date(event.target.value).toISOString() : null })} /></label>
              <label className="field-label">Measurement method<input aria-label={`${component.id} measurement method`} value={component.measurementMethod ?? ""} onChange={(event) => updateOpticalComponent(component.id, { measurementMethod: event.target.value || null })} /></label>
              <label className="field-label">Measurement reference<input aria-label={`${component.id} measurement reference`} value={component.measurementReference ?? ""} onChange={(event) => updateOpticalComponent(component.id, { measurementReference: event.target.value || null })} /></label>
              <label className="field-label">Procurement quantity<input aria-label={`${component.id} procurement quantity`} type="number" min="0" step="0.01" value={component.procurementQuantity ?? ""} onChange={(event) => updateOpticalComponent(component.id, { procurementQuantity: event.target.value === "" ? null : Number(event.target.value) })} /></label>
              <label className="field-label">Procurement unit<input aria-label={`${component.id} procurement unit`} value={component.procurementUnit ?? ""} placeholder="unit / pair / splice" onChange={(event) => updateOpticalComponent(component.id, { procurementUnit: event.target.value || null })} /></label>
              <label className="field-label">Material unit rate<input aria-label={`${component.id} material unit rate`} type="number" min="0" step="0.01" value={component.materialUnitCost ?? ""} onChange={(event) => updateOpticalComponent(component.id, { materialUnitCost: event.target.value === "" ? null : Number(event.target.value), priceSource: event.target.value ? "configured" : "unknown" })} /></label>
              <label className="field-label">Installation unit rate<input aria-label={`${component.id} installation unit rate`} type="number" min="0" step="0.01" value={component.installationUnitCost ?? ""} onChange={(event) => updateOpticalComponent(component.id, { installationUnitCost: event.target.value === "" ? null : Number(event.target.value), priceSource: event.target.value ? "configured" : "unknown" })} /></label>
              <label className="field-label">Price reference<input aria-label={`${component.id} price reference`} value={component.priceReference ?? ""} onChange={(event) => updateOpticalComponent(component.id, { priceReference: event.target.value || null })} /></label>
            </section>
          ))}
          <button
            className="secondary-button"
            disabled={!onOpticalComponentsChange || (selected.kind === "cable" && !selectedConnectionIds.length)}
            onClick={() => {
              const component: OpticalComponent = { id: crypto.randomUUID(), kind: "other", ...(selected.kind === "node" ? { nodeId: selected.item.id } : { connectionId: selectedConnectionIds[0] }), location: null, configuredLossDb: null, configuredSource: "unknown" };
              onOpticalComponentsChange?.([...(project.opticalComponents ?? []), component]);
            }}
          >
            Add optical component
          </button>
        </details>
      )}

      {/* ADVANCED DETAILS */}
      {(() => {
        const visibleEntries = Object.entries(item.properties).filter(([key]) => !HIDDEN_INTERNAL_KEYS.has(key));
        if (visibleEntries.length === 0) return null;
        return (
          <details className="optical-settings-panel">
            <summary>Advanced details</summary>
            {visibleEntries.map(([key, value]) => (
              <div className="property-row" key={key}>
                <span>{formatPropertyLabel(key)}</span>
                <strong>{value === null ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value)}</strong>
              </div>
            ))}
          </details>
        );
      })()}

      {/* PROJECT OPTICAL BUDGET PARAMETERS */}
      <details className="optical-settings-panel" style={{ marginTop: 8 }}>
        <summary>Project optical budget parameters</summary>
        <p className="optical-profile-note">
          Baseline parameters used for all devices unless manually overridden on individual devices.
        </p>
        <label className="optical-setting-row">
          <span>OLT Transmit Power <small>dBm</small></span>
          <input
            type="number"
            step="0.01"
            value={project.settings.opticalBudget.txPowerDbm}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (Number.isFinite(val)) {
                onOpticalBudgetConfig?.({
                  ...project.settings.opticalBudget,
                  txPowerDbm: val,
                  parameterSources: { ...project.settings.opticalBudget.parameterSources, txPowerDbm: "configured" },
                });
              }
            }}
          />
        </label>
        <label className="optical-setting-row">
          <span>Fiber Attenuation <small>dB/km</small></span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={project.settings.opticalBudget.fiberAttenuationDbPerKm}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (Number.isFinite(val) && val >= 0) {
                onOpticalBudgetConfig?.({
                  ...project.settings.opticalBudget,
                  fiberAttenuationDbPerKm: val,
                  parameterSources: { ...project.settings.opticalBudget.parameterSources, fiberAttenuationDbPerKm: "configured" },
                });
              }
            }}
          />
        </label>
        <label className="optical-setting-row">
          <span>Connector Loss <small>dB/interface</small></span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={project.settings.opticalBudget.connectorLossDb}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (Number.isFinite(val) && val >= 0) {
                onOpticalBudgetConfig?.({
                  ...project.settings.opticalBudget,
                  connectorLossDb: val,
                  parameterSources: { ...project.settings.opticalBudget.parameterSources, connectorLossDb: "configured" },
                });
              }
            }}
          />
        </label>
        <label className="optical-setting-row">
          <span>Fusion Splice Loss <small>dB/splice</small></span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={project.settings.opticalBudget.spliceLossDb}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (Number.isFinite(val) && val >= 0) {
                onOpticalBudgetConfig?.({
                  ...project.settings.opticalBudget,
                  spliceLossDb: val,
                  parameterSources: { ...project.settings.opticalBudget.parameterSources, spliceLossDb: "configured" },
                });
              }
            }}
          />
        </label>
        <label className="optical-setting-row">
          <span>ONT Rx Sensitivity <small>dBm</small></span>
          <input
            type="number"
            step="0.1"
            value={project.settings.opticalBudget.rxSensitivityDbm}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (Number.isFinite(val)) {
                onOpticalBudgetConfig?.({
                  ...project.settings.opticalBudget,
                  rxSensitivityDbm: val,
                  parameterSources: { ...project.settings.opticalBudget.parameterSources, rxSensitivityDbm: "configured" },
                });
              }
            }}
          />
        </label>
        <label className="optical-setting-row">
          <span>ONT Rx Overload <small>dBm</small></span>
          <input
            type="number"
            step="0.1"
            value={project.settings.opticalBudget.rxOverloadDbm}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (Number.isFinite(val)) {
                onOpticalBudgetConfig?.({
                  ...project.settings.opticalBudget,
                  rxOverloadDbm: val,
                  parameterSources: { ...project.settings.opticalBudget.parameterSources, rxOverloadDbm: "configured" },
                });
              }
            }}
          />
        </label>
        <label className="optical-setting-row">
          <span>Design Reserve / Safety Margin <small>dB</small></span>
          <input
            type="number"
            step="0.1"
            min="0"
            value={project.settings.opticalBudget.safetyMarginDb}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (Number.isFinite(val) && val >= 0) {
                onOpticalBudgetConfig?.({
                  ...project.settings.opticalBudget,
                  safetyMarginDb: val,
                  parameterSources: { ...project.settings.opticalBudget.parameterSources, safetyMarginDb: "configured" },
                });
              }
            }}
          />
        </label>
        <fieldset className="splitter-loss-settings" style={{ marginTop: 8 }}>
          <legend>Splitter insertion loss table (dB)</legend>
          {Object.entries(project.settings.opticalBudget.splitterLossTable).map(([r, l]) => (
            <label className="optical-setting-row" key={r}>
              <span>{r}</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={l}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val) && val >= 0) {
                    onOpticalBudgetConfig?.({
                      ...project.settings.opticalBudget,
                      splitterLossTable: {
                        ...project.settings.opticalBudget.splitterLossTable,
                        [r]: val,
                      },
                      parameterSources: {
                        ...project.settings.opticalBudget.parameterSources,
                        splitterLossTable: "configured",
                      },
                    });
                  }
                }}
              />
            </label>
          ))}
        </fieldset>
        {onRecalculate && (
          <button
            type="button"
            className="secondary-button"
            style={{ marginTop: 8, width: "100%" }}
            onClick={onRecalculate}
          >
            Recalculate Optical Budget
          </button>
        )}
      </details>
    </section>
  );
}
