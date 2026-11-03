import { useState, type ReactNode } from "react";
import type {
  Customer,
  DevicePort,
  FeatureProperties,
  FeatureRef,
  NetworkNode,
  OpticalBudgetConfig,
  OpticalComponent,
  Project,
  PropertyValue,
  TopologyConnection,
} from "../../domain/types";
import type { ConfiguredPortItem } from "../../domain/devicePorts";
import { parseSplitterOutputCount } from "../../domain/devicePorts";

export const HIDDEN_INTERNAL_KEYS = new Set([
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

export function formatPropertyLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function updateNodePortConfig(
  node: NetworkNode,
  portId: string,
  patch: Partial<ConfiguredPortItem>,
  onNodeProperties?: (id: string, properties: Partial<NetworkNode["properties"]>) => void,
) {
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
}

export function InspectorSection({
  title,
  ariaLabel,
  badge,
  children,
}: {
  title: string;
  ariaLabel?: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="splitter-config-panel inspector-section-card" aria-label={ariaLabel ?? title}>
      <div className="section-heading">
        <span>{title}</span>
        {badge}
      </div>
      {children}
    </section>
  );
}

export function PortTableSection({
  node,
  ports,
  onNodeProperties,
  summaryLabel = "Port Summary",
  ariaLabel = "Device port table",
}: {
  node: NetworkNode;
  ports: DevicePort[];
  onNodeProperties?: (id: string, properties: Partial<NetworkNode["properties"]>) => void;
  summaryLabel?: string;
  ariaLabel?: string;
}) {
  const connectedCount = ports.filter((p) => p.status === "connected").length;
  const availableCount = ports.filter((p) => p.status === "available").length;
  const disabledCount = ports.filter((p) => p.status === "disabled").length;

  return (
    <>
      <div className="port-summary-bar">
        <span className="port-summary-label">{summaryLabel}</span>
        <div className="port-summary-counts">
          <span className="port-count-item"><strong>{ports.length}</strong> total</span>
          <span className="port-count-sep">·</span>
          <span className="port-count-item connected"><strong>{connectedCount}</strong> connected</span>
          <span className="port-count-sep">·</span>
          <span className="port-count-item available"><strong>{availableCount}</strong> avail</span>
          <span className="port-count-sep">·</span>
          <span className="port-count-item disabled"><strong>{disabledCount}</strong> dis</span>
        </div>
      </div>

      <div className="port-table" role="region" aria-label={ariaLabel}>
        <div className="port-table-header">
          <span>Port Label</span>
          <span>Status</span>
          <span>Connected Device</span>
        </div>
        <div className="port-table-body">
          {ports.map((port) => {
            const isConn = port.status === "connected";
            const isDis = port.status === "disabled";

            return (
              <div key={port.id} className={`port-row port-row-${port.status}`}>
                <div className="port-col-label">
                  <span className="port-id-badge">{port.id}</span>
                  <input
                    className="port-label-input"
                    value={port.label}
                    onChange={(e) => updateNodePortConfig(node, port.id, { label: e.target.value }, onNodeProperties)}
                    placeholder="Port label"
                    aria-label={`Label for port ${port.id}`}
                  />
                </div>
                <div className="port-col-status">
                  <span className={`port-status-badge status-${port.status}`}>
                    {port.status}
                  </span>
                </div>
                <div className="port-col-target">
                  {port.connectedNodeName ? (
                    <span className="port-target-name" title={port.connectedNodeName}>
                      → {port.connectedNodeName}
                    </span>
                  ) : (
                    <span className="port-target-empty">—</span>
                  )}
                  {!isConn && (
                    <button
                      type="button"
                      className="secondary-button btn-compact port-toggle-btn"
                      onClick={() => updateNodePortConfig(node, port.id, { status: isDis ? "available" : "disabled" }, onNodeProperties)}
                    >
                      {isDis ? "Enable" : "Disable"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

export function ConnectedDevicesList({
  node,
  project,
  nodesById,
  connections,
  onDisconnectConnection,
  emptyText = "No connected devices.",
}: {
  node: NetworkNode;
  project: Project;
  nodesById: Record<string, NetworkNode>;
  connections?: TopologyConnection[];
  onDisconnectConnection?: (connectionId: string) => void;
  emptyText?: string;
}) {
  const nodeConnections = connections ?? project.connections.filter((c) => c.fromNodeId === node.id || c.toNodeId === node.id);

  if (nodeConnections.length === 0) {
    return <p className="hint">{emptyText}</p>;
  }

  return (
    <div className="connected-devices-list">
      {nodeConnections.map((conn) => {
        const isOutgoing = conn.fromNodeId === node.id;
        const remoteNodeId = isOutgoing ? conn.toNodeId : conn.fromNodeId;
        const remoteNode = nodesById[remoteNodeId];
        const localPort = isOutgoing ? (conn.fromPortId || "Default Out") : (conn.toPortId || "Default In");
        const remotePort = isOutgoing ? (conn.toPortId || "Default In") : (conn.fromPortId || "Default Out");
        const cable = project.cableSegments.find((c) => c.id === conn.cableSegmentId);
        const linkedCustomer: Customer | undefined = remoteNode?.type === "ont" ? project.customers.find((c) => c.ontNodeId === remoteNode.id) : undefined;

        return (
          <div key={conn.id} className="connected-device-card">
            <div className="connected-device-info">
              <div className="connected-device-ports">
                <span className="port-id-badge">[{localPort}]</span>
                <span className="connection-dir-arrow">{isOutgoing ? "→" : "←"}</span>
                <strong className="connected-device-name" title={remoteNode?.name ?? remoteNodeId}>{remoteNode?.name ?? remoteNodeId}</strong>
                <span className="connected-device-type">({remoteNode?.type.toUpperCase() ?? "?"})</span>
                <span className="port-id-badge remote">[{remotePort}]</span>
              </div>
              {linkedCustomer && (
                <div className="connected-device-customer">
                  Pelanggan: <strong>{linkedCustomer.name}</strong> <span className="mono-value">({linkedCustomer.id.slice(0, 8)})</span>
                </div>
              )}
              {cable && (
                <small className="connected-device-cable">
                  Kabel: {cable.name} {cable.lengthM != null ? `(${cable.lengthM.toFixed(1)} m)` : ""}
                </small>
              )}
            </div>
            <button
              type="button"
              className="secondary-button btn-compact danger-outline"
              onClick={() => onDisconnectConnection?.(conn.id)}
              aria-label={`Disconnect ${conn.id}`}
            >
              Disconnect
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function InstalledSplittersManager({
  hostNode,
  hostedSplitters,
  project,
  onSelect,
  onAddInternalSplitter,
  onRemoveInternalSplitter,
}: {
  hostNode: NetworkNode;
  hostedSplitters: NetworkNode[];
  project: Project;
  onSelect?: (ref: FeatureRef) => void;
  onAddInternalSplitter?: (hostNodeId: string, splitter: NetworkNode) => void;
  onRemoveInternalSplitter?: (splitterId: string) => void;
}) {
  const [newSplitterRatio, setNewSplitterRatio] = useState("1:8");
  const [newSplitterCustomRatio, setNewSplitterCustomRatio] = useState("");
  const [newSplitterType, setNewSplitterType] = useState<"plc" | "fbt">("plc");
  const [newSplitterCustomLoss, setNewSplitterCustomLoss] = useState("");
  const [newSplitterCapacity, setNewSplitterCapacity] = useState("");

  return (
    <>
      {hostedSplitters.length === 0 ? (
        <p className="hint">No splitter installation is associated with this cabinet.</p>
      ) : (
        <div className="installed-components-list">
          {hostedSplitters.map((splitter) => {
            const assignments = Array.isArray(splitter.properties.outputPortAssignments)
              ? (splitter.properties.outputPortAssignments as Array<{ portId?: string; connectedNodeId?: string }>)
              : [];
            const ratio = typeof splitter.properties.splitterRatio === "string" ? splitter.properties.splitterRatio : "Ratio unknown";
            const ratioCapacity = ratio.split(":")[1] ?? "?";
            const splitterTypeStr = typeof splitter.properties.splitterType === "string" ? splitter.properties.splitterType.toUpperCase() : "PLC";
            const profileLoss = project.settings.opticalBudget.splitterLossTable[ratio];
            const lossDisplay = typeof splitter.properties.splitterLossDb === "number"
              ? `${splitter.properties.splitterLossDb} dB · configured`
              : typeof profileLoss === "number"
                ? `${profileLoss} dB · profile assumption`
                : "loss unknown";
            return (
              <div key={splitter.id} className="installed-component-card">
                <button type="button" className="connection-row installed-splitter-row" onClick={() => onSelect?.({ kind: "node", id: splitter.id })}>
                  <span className="installed-splitter-main">
                    <span className="installed-splitter-title">
                      <strong>{splitter.name}</strong>
                      <span className="component-kind-tag">{splitterTypeStr}</span>
                    </span>
                    <small className="installed-splitter-specs">{ratio} · {lossDisplay} · {assignments.length}/{String(splitter.properties.capacity ?? ratioCapacity)} ports</small>
                  </span>
                  <small className="installed-splitter-mapping">Input {String(splitter.properties.inputPortId ?? "unknown")} · {assignments.map((assignment) => assignment.portId).filter(Boolean).join(", ") || "outputs unmapped"}</small>
                </button>
                <button
                  type="button"
                  className="icon-button danger component-remove-btn"
                  aria-label={`Remove splitter ${splitter.name}`}
                  title="Remove internal splitter"
                  onClick={() => onRemoveInternalSplitter?.(splitter.id)}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="add-splitter-form">
        <span className="subsection-label">Add internal splitter</span>
        <div className="form-grid-2">
          <label className="field-label">
            Ratio
            <select
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
          <label className="field-label">
            Type
            <select
              value={newSplitterType}
              onChange={(e) => setNewSplitterType(e.target.value as "plc" | "fbt")}
            >
              <option value="plc">PLC</option>
              <option value="fbt">FBT</option>
            </select>
          </label>
        </div>
        {newSplitterRatio === "custom" && (
          <label className="field-label">
            Custom ratio
            <input
              placeholder="e.g. 1:3, 1:12, 2:8"
              value={newSplitterCustomRatio}
              onChange={(e) => setNewSplitterCustomRatio(e.target.value)}
            />
          </label>
        )}
        <div className="form-grid-2">
          <label className="field-label">
            Custom loss (dB)
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="Default"
              value={newSplitterCustomLoss}
              onChange={(e) => setNewSplitterCustomLoss(e.target.value)}
            />
          </label>
          <label className="field-label">
            Output ports
            <input
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
          className="secondary-button full-width-btn"
          onClick={() => {
            const effectiveRatio = newSplitterRatio === "custom" ? (newSplitterCustomRatio || "1:8") : newSplitterRatio;
            const autoCap = parseSplitterOutputCount(effectiveRatio);
            const explicitCap = newSplitterCapacity ? parseInt(newSplitterCapacity, 10) : null;
            const cap = explicitCap && explicitCap > 0 ? explicitCap : autoCap;
            const profileLoss = project.settings.opticalBudget.splitterLossTable[effectiveRatio] ?? null;
            const customLossNum = newSplitterCustomLoss ? Number(newSplitterCustomLoss) : null;
            const effectiveLoss = customLossNum != null && Number.isFinite(customLossNum) ? customLossNum : profileLoss;

            const newSplitter: NetworkNode = {
              id: crypto.randomUUID(),
              name: `${hostNode.name} Splitter ${effectiveRatio}`,
              type: "splitter",
              location: { ...hostNode.location },
              properties: {
                mountedInNodeId: hostNode.id,
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
            onAddInternalSplitter?.(hostNode.id, newSplitter);
            setNewSplitterCustomRatio("");
            setNewSplitterCustomLoss("");
            setNewSplitterCapacity("");
          }}
        >
          + Add internal splitter
        </button>
      </div>
      <p className="hint">Splitters are internal cabinet components. Port labels describe logical topology; hardware model and port mapping remain unverified.</p>
    </>
  );
}

export function PhysicalOpticalComponentsPanel({
  project,
  entityKind,
  entityId,
  selectedConnectionIds = [],
  onOpticalComponentsChange,
}: {
  project: Project;
  entityKind: "node" | "cable";
  entityId: string;
  selectedConnectionIds?: string[];
  onOpticalComponentsChange?: (components: OpticalComponent[]) => void;
}) {
  const opticalComponents = (project.opticalComponents ?? []).filter((component) =>
    entityKind === "node"
      ? component.nodeId === entityId
      : Boolean(component.connectionId && selectedConnectionIds.includes(component.connectionId)),
  );
  const updateOpticalComponent = (id: string, patch: Partial<OpticalComponent>) =>
    onOpticalComponentsChange?.((project.opticalComponents ?? []).map((component) => (component.id === id ? { ...component, ...patch } : component)));

  return (
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
        disabled={!onOpticalComponentsChange || (entityKind === "cable" && !selectedConnectionIds.length)}
        onClick={() => {
          const component: OpticalComponent = {
            id: crypto.randomUUID(),
            kind: "other",
            ...(entityKind === "node" ? { nodeId: entityId } : { connectionId: selectedConnectionIds[0] }),
            location: null,
            configuredLossDb: null,
            configuredSource: "unknown",
          };
          onOpticalComponentsChange?.([...(project.opticalComponents ?? []), component]);
        }}
      >
        Add optical component
      </button>
    </details>
  );
}

export function AdvancedProvenanceDetails({
  entityId,
  properties,
}: {
  entityId: string;
  properties: FeatureProperties;
}) {
  const visibleEntries = Object.entries(properties).filter(([key]) => !HIDDEN_INTERNAL_KEYS.has(key));
  return (
    <details className="optical-settings-panel">
      <summary>Advanced details &amp; provenance</summary>
      <div className="property-row">
        <span>Entity UUID</span>
        <strong className="mono-value" title={entityId}>{entityId}</strong>
      </div>
      {visibleEntries.map(([key, value]) => (
        <div className="property-row" key={key}>
          <span>{formatPropertyLabel(key)}</span>
          <strong>{value === null ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value)}</strong>
        </div>
      ))}
    </details>
  );
}

export function ProjectOpticalBudgetParametersDetails({
  project,
  onOpticalBudgetConfig,
  onRecalculate,
}: {
  project: Project;
  onOpticalBudgetConfig?: (config: OpticalBudgetConfig) => void;
  onRecalculate?: () => void;
}) {
  return (
    <details className="optical-settings-panel">
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
      <fieldset className="splitter-loss-settings">
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
          className="secondary-button full-width-btn"
          onClick={onRecalculate}
        >
          ⚡ Recalculate Optical Budget
        </button>
      )}
    </details>
  );
}
