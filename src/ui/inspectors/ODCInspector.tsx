import type {
  FeatureRef,
  NetworkNode,
  OpticalBudgetConfig,
  OpticalBudgetResult,
  OpticalComponent,
  Project,
} from "../../domain/types";
import { getDevicePorts } from "../../domain/devicePorts";
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

export function ODCInspector({
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

  const feederInputs = project.connections.filter((conn) => conn.toNodeId === node.id).length;
  const distOutputs = project.connections.filter((conn) => conn.fromNodeId === node.id).length;
  const feederCapacity = typeof node.properties.feederPortCapacity === "number" ? node.properties.feederPortCapacity : 4;
  const distCapacity =
    typeof node.properties.distributionFanoutCapacity === "number"
      ? node.properties.distributionFanoutCapacity
      : typeof node.properties.distributionPortCapacity === "number"
        ? node.properties.distributionPortCapacity
        : 16;

  const allPorts = getDevicePorts(node, project.connections, nodesById, project.customers);
  const feederPorts = allPorts.filter((p) => p.portType === "feeder_in");
  const distributionPorts = allPorts.filter((p) => p.portType === "distribution_out");

  const intermediate = opticalResult?.intermediateNodes?.find((entry) => entry.nodeId === node.id);
  const display = (value: number | null | undefined, unit: string) =>
    value == null || !Number.isFinite(value) ? "Unknown" : `${value.toFixed(2)} ${unit}`;

  return (
    <div className="dynamic-inspector-content" data-inspector-type="odc">
      {/* 1. GENERAL */}
      <InspectorSection title="1. GENERAL · DEVICE INFORMATION" ariaLabel="General device information">
        <label className="field-label">
          Device name
          <input value={node.name} onChange={(event) => onRename({ kind: "node", id: node.id }, event.target.value)} />
        </label>
        <div className="property-row">
          <span>Device type</span>
          <strong>ODC</strong>
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
              placeholder="e.g. FDT-288"
              value={String(node.properties.model ?? "")}
              onChange={(e) => onNodeProperties?.(node.id, { model: e.target.value || null })}
            />
          </label>
        </div>
        <div className="property-row">
          <span>Status</span>
          <strong>{String(node.properties.status ?? "Active").toUpperCase()}</strong>
        </div>

        <div className="inspector-summary-subbox" aria-label="ODC summary">
          <div className="subsection-label">ODC SUMMARY</div>
          <div className="property-row"><span>Feeder inputs</span><strong>{feederInputs} / {feederCapacity}</strong></div>
          <div className="property-row"><span>Distribution outputs</span><strong>{distOutputs} / {distCapacity} ports</strong></div>
          <div className="property-row"><span>Internal splitters</span><strong>{hostedSplitters.length}</strong></div>
          {intermediate && (
            <div className="property-row"><span>Physical route status</span><strong>{(intermediate.physicalRouteStatus ?? "planned").toUpperCase()}</strong></div>
          )}
        </div>
      </InspectorSection>

      {/* 2. FEEDER PORT */}
      <InspectorSection title="2. FEEDER PORT · UPSTREAM IN" ariaLabel="Feeder port configuration">
        <label className="field-label">
          Feeder input ports capacity
          <input
            type="number"
            min="1"
            max="32"
            value={feederCapacity}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (val > 0) onNodeProperties?.(node.id, { feederPortCapacity: val });
            }}
          />
        </label>
        <PortTableSection
          node={node}
          ports={feederPorts}
          onNodeProperties={onNodeProperties}
          summaryLabel="Feeder Ports Summary"
          ariaLabel="ODC feeder ports table"
        />
      </InspectorSection>

      {/* 3. DISTRIBUTION PORTS */}
      <InspectorSection title="2B. DISTRIBUTION PORTS · DOWNSTREAM OUT" ariaLabel="Distribution port configuration">
        <label className="field-label">
          Distribution output ports capacity
          <input
            type="number"
            min="1"
            max="96"
            value={distCapacity}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (val > 0) onNodeProperties?.(node.id, { distributionPortCapacity: val, distributionFanoutCapacity: val });
            }}
          />
        </label>
        <PortTableSection
          node={node}
          ports={distributionPorts}
          onNodeProperties={onNodeProperties}
          summaryLabel="Distribution Ports Summary"
          ariaLabel="ODC distribution ports table"
        />
      </InspectorSection>

      {/* 4. INSTALLED PASSIVE COMPONENTS */}
      <InspectorSection title="3. INSTALLED PASSIVE COMPONENTS" ariaLabel="Installed passive components">
        <InstalledSplittersManager
          hostNode={node}
          hostedSplitters={hostedSplitters}
          project={project}
          onSelect={onSelect}
          onAddInternalSplitter={onAddInternalSplitter}
          onRemoveInternalSplitter={onRemoveInternalSplitter}
        />
      </InspectorSection>

      {/* CONNECTED DEVICES */}
      <InspectorSection title="4. CONNECTED DEVICES" ariaLabel="Connected devices">
        <ConnectedDevicesList node={node} project={project} nodesById={nodesById} onDisconnectConnection={onDisconnectConnection} />
      </InspectorSection>

      {/* ESTIMATED PASSIVE-NODE POWER */}
      <InspectorSection title="5. ESTIMATED PASSIVE-NODE POWER" ariaLabel="Intermediate optical analysis">
        {!opticalResult ? (
          <p className="hint">Run Optical Analysis to calculate the directed OLT path.</p>
        ) : !intermediate ? (
          <p className="hint">No intermediate result was returned for this node.</p>
        ) : (
          <>
            <p className="hint">Estimated optical power at passive ODC · not measured receiver power.</p>
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
            Recalculate Optical Budget
          </button>
        )}
      </InspectorSection>

      <PhysicalOpticalComponentsPanel project={project} entityKind="node" entityId={node.id} onOpticalComponentsChange={onOpticalComponentsChange} />
      <AdvancedProvenanceDetails entityId={node.id} properties={node.properties} />
      <ProjectOpticalBudgetParametersDetails project={project} onOpticalBudgetConfig={onOpticalBudgetConfig} onRecalculate={onRecalculate} />
    </div>
  );
}
