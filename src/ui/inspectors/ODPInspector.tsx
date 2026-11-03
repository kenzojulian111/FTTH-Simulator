import type {
  FeatureRef,
  NetworkNode,
  OpticalBudgetConfig,
  OpticalBudgetResult,
  OpticalComponent,
  Project,
  PropertyValue,
} from "../../domain/types";
import { getDevicePorts, parseSplitterOutputCount } from "../../domain/devicePorts";
import { OpticalCalculationTable } from "../OpticalCalculationTable";
import {
  AdvancedProvenanceDetails,
  ConnectedDevicesList,
  InspectorSection,
  InstalledSplittersManager,
  PhysicalOpticalComponentsPanel,
  PortTableSection,
  ProjectOpticalBudgetParametersDetails,
} from "./InspectorShared";

interface Props {
  node: NetworkNode;
  project: Project;
  nodesById: Record<string, NetworkNode>;
  opticalResult?: OpticalBudgetResult | null;
  onRename: (ref: FeatureRef, name: string) => void;
  onSelect?: (ref: FeatureRef) => void;
  onNodeProperties?: (id: string, properties: Partial<NetworkNode["properties"]>) => void;
  onAddInternalSplitter?: (hostNodeId: string, splitter: NetworkNode) => void;
  onRemoveInternalSplitter?: (splitterId: string) => void;
  onDisconnectConnection?: (connectionId: string) => void;
  onOpticalComponentsChange?: (components: OpticalComponent[]) => void;
  onRecalculate?: () => void;
  onOpticalBudgetConfig?: (config: OpticalBudgetConfig) => void;
}

export function ODPInspector({
  node,
  project,
  nodesById,
  opticalResult,
  onRename,
  onSelect,
  onNodeProperties,
  onAddInternalSplitter,
  onRemoveInternalSplitter,
  onDisconnectConnection,
  onOpticalComponentsChange,
  onRecalculate,
  onOpticalBudgetConfig,
}: Props) {
  const location = node.location.coordinates;
  const hostedSplitters = project.nodes.filter((n) => n.type === "splitter" && n.properties.mountedInNodeId === node.id);
  const hostedSplitter = hostedSplitters[0];

  const upstreamConn = project.connections.find((conn) => conn.toNodeId === node.id);
  const upstreamNode = upstreamConn ? project.nodes.find((n) => n.id === upstreamConn.fromNodeId) : undefined;

  const splitterRatio =
    typeof node.properties.splitterRatio === "string"
      ? node.properties.splitterRatio
      : typeof hostedSplitter?.properties.splitterRatio === "string"
        ? hostedSplitter.properties.splitterRatio
        : "1:8";
  const splitterCap =
    typeof node.properties.portCapacity === "number"
      ? node.properties.portCapacity
      : typeof node.properties.capacity === "number"
        ? node.properties.capacity
        : typeof hostedSplitter?.properties.capacity === "number"
          ? hostedSplitter.properties.capacity
          : Number(splitterRatio.split(":")[1]) || 8;

  const downstreamOntIds = new Set(
    project.connections
      .filter((conn) => conn.fromNodeId === node.id || (hostedSplitter && conn.fromNodeId === hostedSplitter.id))
      .map((conn) => conn.toNodeId),
  );
  const connectedOntCount = downstreamOntIds.size;
  const customerCount = project.customers.filter(
    (cust) => (cust.ontNodeId && downstreamOntIds.has(cust.ontNodeId)) || cust.properties.plannedOdpNodeId === node.id,
  ).length;

  const allPorts = getDevicePorts(node, project.connections, nodesById, project.customers);
  const inputPorts = allPorts.filter((p) => p.portType === "input");
  const outputPorts = allPorts.filter((p) => p.portType === "output");

  const currentRatio = typeof node.properties.splitterRatio === "string" ? node.properties.splitterRatio : "1:8";
  const isStandardRatio = ["1:2", "1:4", "1:8", "1:16", "1:32"].includes(currentRatio);
  const customLoss = typeof node.properties.splitterLossDb === "number" ? node.properties.splitterLossDb : null;
  const defaultLoss = project.settings.opticalBudget.splitterLossTable[currentRatio] ?? null;
  const effectiveLoss = customLoss ?? defaultLoss;
  const currentCap =
    typeof node.properties.portCapacity === "number"
      ? node.properties.portCapacity
      : typeof node.properties.capacity === "number"
        ? node.properties.capacity
        : typeof node.properties.outputPorts === "number"
          ? node.properties.outputPorts
          : parseSplitterOutputCount(currentRatio);

  const applyOdpSplitter = (patch: Record<string, PropertyValue>) => {
    onNodeProperties?.(node.id, patch);
    if (hostedSplitter) {
      onNodeProperties?.(hostedSplitter.id, patch);
    }
  };

  const intermediate = opticalResult?.intermediateNodes?.find((entry) => entry.nodeId === node.id);
  const display = (value: number | null | undefined, unit: string) =>
    value == null || !Number.isFinite(value) ? "Unknown" : `${value.toFixed(2)} ${unit}`;

  return (
    <div className="dynamic-inspector-content" data-inspector-type="odp">
      {/* 1. GENERAL */}
      <InspectorSection title="1. GENERAL · DEVICE INFORMATION" ariaLabel="General device information">
        <label className="field-label">
          Device name
          <input value={node.name} onChange={(event) => onRename({ kind: "node", id: node.id }, event.target.value)} />
        </label>
        <div className="property-row">
          <span>Device type</span>
          <strong>ODP</strong>
        </div>
        <div className="property-row">
          <span>Coordinates</span>
          <strong className="mono-value">
            {node.properties.geographicPositionSet === false ? "Place on map" : `${location[1].toFixed(5)}, ${location[0].toFixed(5)}`}
          </strong>
        </div>
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
              placeholder="e.g. FAT-8A"
              value={String(node.properties.model ?? "")}
              onChange={(e) => onNodeProperties?.(node.id, { model: e.target.value || null })}
            />
          </label>
        </div>
        <div className="property-row">
          <span>Status</span>
          <strong>{String(node.properties.status ?? "Active").toUpperCase()}</strong>
        </div>

        <div className="inspector-summary-subbox" aria-label="ODP summary">
          <div className="subsection-label">ODP SUMMARY</div>
          <div className="property-row"><span>Upstream ODC</span><strong>{upstreamNode?.name ?? "Unconnected"}</strong></div>
          <div className="property-row"><span>Splitter capacity</span><strong>{splitterRatio} ({splitterCap} ports)</strong></div>
          <div className="property-row"><span>Customers</span><strong>{customerCount}</strong></div>
          <div className="property-row"><span>Connected ONTs</span><strong>{connectedOntCount} / {splitterCap}</strong></div>
        </div>
      </InspectorSection>

      {/* 2. INPUT PORT */}
      <InspectorSection title="2. INPUT PORT · DISTRIBUTION IN" ariaLabel="ODP input port configuration">
        <PortTableSection
          node={node}
          ports={inputPorts}
          onNodeProperties={onNodeProperties}
          summaryLabel="Input Port Summary"
          ariaLabel="ODP input port table"
        />
      </InspectorSection>

      {/* 3. SPLITTER CONFIGURATION */}
      <InspectorSection title="3. SPLITTER CONFIGURATION" ariaLabel="ODP splitter configuration">
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
        <div className="form-grid-2">
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
        </div>
        <div className="property-row">
          <span>Loss parameter status</span>
          {customLoss != null ? (
            <div className="param-status-group">
              <strong className="param-status-custom">[Custom: {customLoss.toFixed(2)} dB]</strong>
              <button
                type="button"
                className="secondary-button btn-compact"
                onClick={() => applyOdpSplitter({ splitterLossDb: null })}
              >
                Reset to default
              </button>
            </div>
          ) : (
            <strong className="param-status-default">[Default: {effectiveLoss != null ? `${effectiveLoss.toFixed(2)} dB` : "Unknown"}]</strong>
          )}
        </div>

        <details className="inspector-expandable">
          <summary>Installed Passive Components ({hostedSplitters.length})</summary>
          <div className="inspector-expandable-body">
            <InstalledSplittersManager
              hostNode={node}
              hostedSplitters={hostedSplitters}
              project={project}
              onSelect={onSelect}
              onAddInternalSplitter={onAddInternalSplitter}
              onRemoveInternalSplitter={onRemoveInternalSplitter}
            />
          </div>
        </details>
      </InspectorSection>

      {/* 4. OUTPUT PORTS */}
      <InspectorSection title="4. OUTPUT PORTS · DROP PORTS" ariaLabel="ODP output ports configuration">
        <PortTableSection
          node={node}
          ports={outputPorts}
          onNodeProperties={onNodeProperties}
          summaryLabel="Output Ports Summary"
          ariaLabel="ODP output ports table"
        />
      </InspectorSection>

      {/* 5. CONNECTED ONTS & DEVICES */}
      <InspectorSection title="5. CONNECTED ONTS & LINKS" ariaLabel="Connected ONTs and devices">
        <ConnectedDevicesList
          node={node}
          project={project}
          nodesById={nodesById}
          onDisconnectConnection={onDisconnectConnection}
          emptyText="No ONTs or upstream links connected."
        />
      </InspectorSection>

      {/* ESTIMATED PASSIVE-NODE POWER */}
      <InspectorSection title="ESTIMATED PASSIVE-NODE POWER" ariaLabel="Intermediate optical analysis">
        {!opticalResult ? (
          <p className="hint">Run Optical Analysis to calculate the directed OLT path.</p>
        ) : !intermediate ? (
          <p className="hint">No intermediate result was returned for this node.</p>
        ) : (
          <>
            <p className="hint">Estimated optical power at passive ODP · not measured receiver power.</p>
            <div className="optical-metrics-grid">
              <div className="optical-metric-card primary">
                <span>Estimated optical power</span>
                <strong className="mono-value">{display(intermediate.estimatedPowerDbm, "dBm")}</strong>
              </div>
              <div className="optical-metric-card">
                <span>Accumulated loss</span>
                <strong className="mono-value">{display(intermediate.accumulatedLossDb, "dB")}</strong>
              </div>
              <div className="optical-metric-card">
                <span>Path length</span>
                <strong className="mono-value">{display(intermediate.lengthM, "m")}</strong>
              </div>
              <div className="optical-metric-card">
                <span>Calculation status</span>
                <strong className={`status-text status-${intermediate.status === "estimated" ? "pass" : intermediate.status === "unreachable" ? "fail" : "unknown"}`}>{intermediate.status}</strong>
              </div>
            </div>
            {intermediate.designMarginDb != null && (
              <div className="property-row">
                <span>Design margin</span>
                <strong className="mono-value">{display(intermediate.designMarginDb, "dB")}</strong>
              </div>
            )}
            <div className="property-row">
              <span>Originating OLT</span>
              <strong>{intermediate.sourceOltName ?? intermediate.sourceOltId ?? "Unknown"}{intermediate.transmitterPowerDbm == null ? " · launch power unknown" : ` · ${display(intermediate.transmitterPowerDbm, "dBm")}`}</strong>
            </div>
            <p className="hint">Loss entries show individual component loss and cumulative physical loss from the OLT. Safety margin is separate and is not subtracted from this estimated power.</p>
            <OpticalCalculationTable
              compact
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
              <details className="inspector-expandable">
                <summary>Input Provenance ({Object.entries(intermediate.parameterSources ?? {}).length} parameters)</summary>
                <div className="inspector-expandable-body">
                  <p className="hint">Input provenance: {Object.entries(intermediate.parameterSources ?? {}).map(([key, source]) => `${key} (${source.replace(/_/g, " ")})`).join(" · ")}</p>
                </div>
              </details>
            )}
            {intermediate.diagnostics?.map((message, index) => <p className="hint diagnostic-hint" role="status" key={index}>{message}</p>)}
          </>
        )}
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

      <PhysicalOpticalComponentsPanel project={project} entityKind="node" entityId={node.id} onOpticalComponentsChange={onOpticalComponentsChange} />
      <AdvancedProvenanceDetails entityId={node.id} properties={node.properties} />
      <ProjectOpticalBudgetParametersDetails project={project} onOpticalBudgetConfig={onOpticalBudgetConfig} onRecalculate={onRecalculate} />
    </div>
  );
}
