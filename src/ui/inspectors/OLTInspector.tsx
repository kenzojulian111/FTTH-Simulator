import type { FeatureRef, NetworkNode, OpticalBudgetConfig, OpticalComponent, Project } from "../../domain/types";
import { getDevicePorts } from "../../domain/devicePorts";
import {
  AdvancedProvenanceDetails,
  ConnectedDevicesList,
  InspectorSection,
  PhysicalOpticalComponentsPanel,
  PortTableSection,
  ProjectOpticalBudgetParametersDetails,
} from "./InspectorShared";

interface Props {
  node: NetworkNode;
  project: Project;
  nodesById: Record<string, NetworkNode>;
  onRename: (ref: FeatureRef, name: string) => void;
  onNodeProperties?: (id: string, properties: Partial<NetworkNode["properties"]>) => void;
  onDisconnectConnection?: (connectionId: string) => void;
  onOpticalComponentsChange?: (components: OpticalComponent[]) => void;
  onRecalculate?: () => void;
  onOpticalBudgetConfig?: (config: OpticalBudgetConfig) => void;
}

export function OLTInspector({
  node,
  project,
  nodesById,
  onRename,
  onNodeProperties,
  onDisconnectConnection,
  onOpticalComponentsChange,
  onRecalculate,
  onOpticalBudgetConfig,
}: Props) {
  const location = node.location.coordinates;
  const currentPon = String(node.properties.ponTechnology ?? "GPON");
  const isStandardPon = ["GPON", "XG-PON", "XGS-PON"].includes(currentPon);

  const ponCapacity =
    typeof node.properties.ponPortCapacity === "number"
      ? node.properties.ponPortCapacity
      : typeof node.properties.ponPorts === "number"
        ? node.properties.ponPorts
        : 4;
  const ponSource = node.properties.capacitySource === "configured" ? "Configured" : "Planning Default";

  const activePonPorts = new Set<string>();
  for (const n of project.nodes) {
    if (typeof n.properties.sourcePonPortId === "string" && n.properties.sourcePonPortId) activePonPorts.add(n.properties.sourcePonPortId);
    if (typeof n.properties.ponPortId === "string" && n.properties.ponPortId) activePonPorts.add(n.properties.ponPortId);
  }
  const outgoingCount = project.connections.filter((conn) => conn.fromNodeId === node.id).length;
  const usedPonPorts =
    activePonPorts.size > 0
      ? activePonPorts.size
      : typeof node.properties.requiredPonPorts === "number"
        ? node.properties.requiredPonPorts
        : outgoingCount;

  const customTx = typeof node.properties.txPowerDbm === "number" ? node.properties.txPowerDbm : null;
  const defaultTx = project.settings.opticalBudget.txPowerDbm;
  const txPower = customTx ?? defaultTx;
  const txSource = customTx != null ? "Configured" : "Planning Default";

  const ports = getDevicePorts(node, project.connections, nodesById, project.customers);

  return (
    <div className="dynamic-inspector-content" data-inspector-type="olt">
      {/* 1. GENERAL */}
      <InspectorSection title="1. DEVICE INFORMATION · GENERAL" ariaLabel="General device information">
        <label className="field-label">
          Device name
          <input value={node.name} onChange={(event) => onRename({ kind: "node", id: node.id }, event.target.value)} />
        </label>
        <div className="property-row">
          <span>Device type</span>
          <strong>OLT</strong>
        </div>
        <div className="property-row">
          <span>Coordinates</span>
          <strong className="mono-value">
            {node.properties.geographicPositionSet === false ? "Place on map" : `${location[1].toFixed(5)}, ${location[0].toFixed(5)}`}
          </strong>
        </div>
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
          <strong className="mono-value">{project.settings.opticalBudget.profileId}</strong>
        </div>
        <div className="property-row">
          <span>Status</span>
          <strong>{String(node.properties.status ?? "Active").toUpperCase()}</strong>
        </div>

        <div className="inspector-summary-subbox" aria-label="OLT summary">
          <div className="subsection-label">OLT SUMMARY</div>
          <div className="property-row"><span>PON port capacity</span><strong>{ponCapacity} ports ({ponSource})</strong></div>
          <div className="property-row"><span>Used PON ports</span><strong>{usedPonPorts} / {ponCapacity}</strong></div>
          <div className="property-row"><span>Transmit power</span><strong>{txPower.toFixed(2)} dBm ({txSource})</strong></div>
        </div>
      </InspectorSection>

      {/* 2. PON PORTS */}
      <InspectorSection title="2. PORT CONFIGURATION · PON PORTS" ariaLabel="PON port configuration">
        <div className="form-grid-2">
          <label className="field-label">
            PON ports capacity
            <input
              type="number"
              min="1"
              max="64"
              value={ponCapacity}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (val > 0) onNodeProperties?.(node.id, { ponPortCapacity: val, ponPorts: val, capacitySource: "configured" });
              }}
            />
          </label>
          <label className="field-label">
            Max customers / port
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
        </div>
        <PortTableSection node={node} ports={ports} onNodeProperties={onNodeProperties} summaryLabel="PON Port Summary" />
      </InspectorSection>

      {/* 3. OPTICAL PARAMETERS */}
      <InspectorSection title="5. OPTICAL PARAMETERS" ariaLabel="OLT optical parameters">
        <label className="field-label">
          Optical transmit power (dBm)
          <input
            type="number"
            step="0.01"
            value={customTx != null ? customTx : ""}
            placeholder={`${defaultTx >= 0 ? "+" : ""}${defaultTx.toFixed(2)} dBm (planning default)`}
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
          {customTx != null ? (
            <div className="param-status-group">
              <strong className="param-status-custom">[Custom: {customTx >= 0 ? "+" : ""}{customTx.toFixed(2)} dBm]</strong>
              <button
                type="button"
                className="secondary-button btn-compact"
                onClick={() => onNodeProperties?.(node.id, { txPowerDbm: null })}
              >
                Reset to default
              </button>
            </div>
          ) : (
            <strong className="param-status-default">[Default: {defaultTx >= 0 ? "+" : ""}{defaultTx.toFixed(2)} dBm]</strong>
          )}
        </div>
        <div className="property-row">
          <span>Transmit power</span>
          <strong className={customTx != null ? "param-status-custom" : "param-status-default"}>
            {txPower >= 0 ? "+" : ""}{txPower.toFixed(2)} dBm ({txSource})
          </strong>
        </div>
        <div className="property-row"><span>PON port capacity</span><strong>{ponCapacity} ports ({ponSource})</strong></div>
        <div className="property-row"><span>Used PON ports</span><strong>{outgoingCount} / {ponCapacity}</strong></div>
        <div className="property-row"><span>Max subscribers / port</span><strong>{typeof node.properties.maxCustomersPerPort === "number" ? node.properties.maxCustomersPerPort : 64}</strong></div>
        {onRecalculate && (
          <button
            type="button"
            className="secondary-button full-width-btn"
            onClick={onRecalculate}
          >
            ⚡ Recalculate Optical Budget
          </button>
        )}
      </InspectorSection>

      {/* 4. CONNECTED DEVICES */}
      <InspectorSection title="4. CONNECTED DEVICES" ariaLabel="Connected devices">
        <ConnectedDevicesList node={node} project={project} nodesById={nodesById} onDisconnectConnection={onDisconnectConnection} />
      </InspectorSection>

      <PhysicalOpticalComponentsPanel project={project} entityKind="node" entityId={node.id} onOpticalComponentsChange={onOpticalComponentsChange} />
      <AdvancedProvenanceDetails entityId={node.id} properties={node.properties} />
      <ProjectOpticalBudgetParametersDetails project={project} onOpticalBudgetConfig={onOpticalBudgetConfig} onRecalculate={onRecalculate} />
    </div>
  );
}
