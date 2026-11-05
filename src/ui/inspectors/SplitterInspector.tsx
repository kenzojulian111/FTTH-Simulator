import type {
  FeatureRef,
  NetworkNode,
  OpticalBudgetConfig,
  OpticalComponent,
  Project,
} from "../../domain/types";
import { getDevicePorts, parseSplitterOutputCount } from "../../domain/devicePorts";
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
  onSplitterOpticalConfig?: (id: string, ratio: string | null, insertionLossDb: number | null) => void;
  onDisconnectConnection?: (connectionId: string) => void;
  onOpticalComponentsChange?: (components: OpticalComponent[]) => void;
  onRecalculate?: () => void;
  onOpticalBudgetConfig?: (config: OpticalBudgetConfig) => void;
}

export function SplitterInspector({
  node,
  project,
  nodesById,
  onRename,
  onNodeProperties,
  onSplitterOpticalConfig,
  onDisconnectConnection,
  onOpticalComponentsChange,
  onRecalculate,
  onOpticalBudgetConfig,
}: Props) {
  const mounted = typeof node.properties.mountedInNodeId === "string";
  const hostCabinet = mounted ? nodesById[String(node.properties.mountedInNodeId)] : null;
  const location = mounted ? null : node.location.coordinates;

  const currentRatio = typeof node.properties.splitterRatio === "string" ? node.properties.splitterRatio : "1:8";
  const isStandardRatio = ["1:2", "1:4", "1:8", "1:16", "1:32"].includes(currentRatio);
  const customLoss = typeof node.properties.splitterLossDb === "number" ? node.properties.splitterLossDb : null;
  const profileLoss = currentRatio ? project.settings.opticalBudget.splitterLossTable[currentRatio] : undefined;
  const effectiveLoss = customLoss ?? profileLoss;
  const lossSource = customLoss != null ? "Configured" : typeof profileLoss === "number" ? "Planning Default" : "Unknown";

  const currentCap =
    typeof node.properties.outputPorts === "number"
      ? node.properties.outputPorts
      : typeof node.properties.portCapacity === "number"
        ? node.properties.portCapacity
        : typeof node.properties.capacity === "number"
          ? node.properties.capacity
          : parseSplitterOutputCount(currentRatio);

  const assignments = Array.isArray(node.properties.outputPortAssignments)
    ? (node.properties.outputPortAssignments as Array<{ portId?: string; connectedNodeId?: string }>)
    : [];
  const outgoingConns = project.connections.filter((conn) => conn.fromNodeId === node.id).length;
  const incomingConns = project.connections.filter((conn) => conn.toNodeId === node.id).length;
  const usedInputs = mounted ? (node.properties.inputPortId ? 1 : 0) : incomingConns;
  const usedOutputs = mounted ? assignments.length : outgoingConns;

  const ports = getDevicePorts(node, project.connections, nodesById, project.customers);

  return (
    <div className="dynamic-inspector-content" data-inspector-type="splitter">
      {/* 1. GENERAL */}
      <InspectorSection title="1. GENERAL · DEVICE INFORMATION" ariaLabel="General device information">
        <label className="field-label">
          Device name
          <input value={node.name} onChange={(event) => onRename({ kind: "node", id: node.id }, event.target.value)} />
        </label>
        <div className="property-row">
          <span>Device type</span>
          <strong>SPLITTER</strong>
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
            <strong className="mono-value">
              {node.properties.geographicPositionSet === false ? "Place on map" : `${location[1].toFixed(5)}, ${location[0].toFixed(5)}`}
            </strong>
          </div>
        )}
        <div className="form-grid-2">
          <label className="field-label">
            Vendor
            <input
              placeholder="e.g. Huawei, ZTE"
              value={String(node.properties.vendor ?? "")}
              onChange={(e) => onNodeProperties?.(node.id, { vendor: e.target.value || null })}
            />
          </label>
          <label className="field-label">
            Model
            <input
              placeholder="e.g. PLC-1x8-SC"
              value={String(node.properties.model ?? "")}
              onChange={(e) => onNodeProperties?.(node.id, { model: e.target.value || null })}
            />
          </label>
        </div>
        <div className="property-row">
          <span>Status</span>
          <strong>{String(node.properties.status ?? "Active").toUpperCase()}</strong>
        </div>
      </InspectorSection>

      {/* 2. SPLITTER CONFIGURATION */}
      <InspectorSection title="2. SPLITTER CONFIGURATION" ariaLabel="Splitter configuration">
        <div className="property-row"><span>Splitter ratio</span><strong>{currentRatio || "Unconfigured"}</strong></div>
        <div className="property-row"><span>Insertion loss</span><strong>{effectiveLoss != null ? `${effectiveLoss.toFixed(2)} dB (${lossSource})` : "Unknown"}</strong></div>
        <div className="property-row"><span>Used inputs / outputs</span><strong>{usedInputs} input · {usedOutputs}{currentCap ? ` / ${currentCap}` : ""} outputs</strong></div>

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
          Physical ratio
          <select
            aria-label="Splitter ratio"
            value={isStandardRatio ? currentRatio : currentRatio ? "custom" : ""}
            onChange={(event) => {
              const val = event.target.value;
              if (val !== "custom") {
                const nextCap = val ? parseSplitterOutputCount(val) : null;
                onSplitterOpticalConfig?.(node.id, val || null, customLoss);
                if (nextCap) onNodeProperties?.(node.id, { splitterRatio: val, capacity: nextCap, outputPorts: nextCap });
              }
            }}
          >
            <option value="">Unknown / unconfigured</option>
            {Object.keys(project.settings.opticalBudget.splitterLossTable).map((r) => (
              <option value={r} key={r}>{r}</option>
            ))}
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
                onSplitterOpticalConfig?.(node.id, ratio || null, customLoss);
                onNodeProperties?.(node.id, { splitterRatio: ratio, capacity: cap, outputPorts: cap });
              }}
            />
          </label>
        )}
        <div className="form-grid-2">
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
          <label className="field-label address-field">
            Actual insertion loss (dB)
            <input
              aria-label="Actual splitter insertion loss dB"
              type="number"
              min="0"
              step="0.01"
              value={customLoss != null ? customLoss : ""}
              placeholder={profileLoss != null ? `${profileLoss.toFixed(2)} dB (default)` : "Custom loss"}
              onChange={(event) => {
                const raw = event.target.value;
                if (raw.trim() === "") {
                  onSplitterOpticalConfig?.(node.id, currentRatio || null, null);
                  onNodeProperties?.(node.id, { splitterLossDb: null });
                } else {
                  const loss = Number(raw);
                  if (Number.isFinite(loss) && loss >= 0) {
                    onSplitterOpticalConfig?.(node.id, currentRatio || null, loss);
                    onNodeProperties?.(node.id, { splitterLossDb: loss });
                  }
                }
              }}
            />
          </label>
        </div>
        <div className="property-row">
          <span>Loss parameter status</span>
          {customLoss != null ? (
            <div className="param-status-group">
              <strong className="param-status-custom">[Custom: {customLoss.toFixed(2)} dB]</strong>
              <button
                type="button"
                className="secondary-button btn-compact"
                onClick={() => {
                  onSplitterOpticalConfig?.(node.id, currentRatio || null, null);
                  onNodeProperties?.(node.id, { splitterLossDb: null });
                }}
              >
                Reset to default
              </button>
            </div>
          ) : (
            <strong className="param-status-default">[Default: {effectiveLoss != null ? `${effectiveLoss.toFixed(2)} dB` : "Unknown"}]</strong>
          )}
        </div>
        {onRecalculate && (
          <button
            type="button"
            className="secondary-button full-width-btn"
            onClick={onRecalculate}
          >
            Recalculate Optical Budget
          </button>
        )}
        <p className="hint">Leave blank to use the optical profile planning default for the selected ratio, or enter a custom insertion loss (dB).</p>
      </InspectorSection>

      {/* 3. PORT MAPPING */}
      <InspectorSection title="3. PORT MAPPING · LOGICAL PORTS" ariaLabel="Splitter port mapping">
        {mounted && (
          <>
            <div className="property-row"><span>Installation host</span><strong>{hostCabinet?.name ?? "Invalid cabinet reference"}</strong></div>
            <div className="property-row">
              <span>Optical ports</span>
              <strong>
                {String(node.properties.inputPortId ?? "unknown")} →{" "}
                {Array.isArray(node.properties.outputPortAssignments)
                  ? `${(node.properties.outputPortAssignments as Array<{ portId?: string }>).map((assignment) => assignment.portId).join(", ")} (logical mapping)`
                  : "Unmapped"}
              </strong>
            </div>
            <p className="hint">Internal passive component · no geographic jumper cable.</p>
          </>
        )}
        <PortTableSection node={node} ports={ports} onNodeProperties={onNodeProperties} summaryLabel="Splitter Port Summary" />
        <div className="inspector-subsection-divider">
          <span className="subsection-label">Connected Links</span>
          <ConnectedDevicesList node={node} project={project} nodesById={nodesById} onDisconnectConnection={onDisconnectConnection} />
        </div>
      </InspectorSection>

      <PhysicalOpticalComponentsPanel project={project} entityKind="node" entityId={node.id} onOpticalComponentsChange={onOpticalComponentsChange} />
      <AdvancedProvenanceDetails entityId={node.id} properties={node.properties} />
      <ProjectOpticalBudgetParametersDetails project={project} onOpticalBudgetConfig={onOpticalBudgetConfig} onRecalculate={onRecalculate} />
    </div>
  );
}
