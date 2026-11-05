import type {
  FeatureRef,
  NetworkNode,
  OpticalBudgetConfig,
  OpticalBudgetResult,
  OpticalComponent,
  Project,
} from "../../domain/types";
import { OpticalCalculationTable } from "../OpticalCalculationTable";
import {
  AdvancedProvenanceDetails,
  ConnectedDevicesList,
  InspectorSection,
  PhysicalOpticalComponentsPanel,
  ProjectOpticalBudgetParametersDetails,
} from "./InspectorShared";

interface Props {
  node: NetworkNode;
  project: Project;
  nodesById: Record<string, NetworkNode>;
  opticalResult?: OpticalBudgetResult | null;
  onRename: (ref: FeatureRef, name: string) => void;
  onNodeProperties?: (id: string, properties: Partial<NetworkNode["properties"]>) => void;
  onDisconnectConnection?: (connectionId: string) => void;
  onOpticalComponentsChange?: (components: OpticalComponent[]) => void;
  onRecalculate?: () => void;
  onOpticalBudgetConfig?: (config: OpticalBudgetConfig) => void;
}

export function ONTInspector({
  node,
  project,
  nodesById,
  opticalResult,
  onRename,
  onNodeProperties,
  onDisconnectConnection,
  onOpticalComponentsChange,
  onRecalculate,
  onOpticalBudgetConfig,
}: Props) {
  const location = node.location.coordinates;
  const linkedCustomer =
    project.customers.find((cust) => cust.ontNodeId === node.id) ??
    (typeof node.properties.customerId === "string"
      ? project.customers.find((cust) => cust.id === node.properties.customerId)
      : undefined);
  const upstreamConn = project.connections.find((conn) => conn.toNodeId === node.id);
  const upstreamNode = upstreamConn ? project.nodes.find((n) => n.id === upstreamConn.fromNodeId) : undefined;
  const upstreamHost =
    upstreamNode?.type === "splitter" && typeof upstreamNode.properties.mountedInNodeId === "string"
      ? project.nodes.find((n) => n.id === upstreamNode.properties.mountedInNodeId)
      : upstreamNode;
  const dropCable = upstreamConn ? project.cableSegments.find((cable) => cable.id === upstreamConn.cableSegmentId) : undefined;
  const path = opticalResult?.paths.find((entry) => entry.ontNodeId === node.id);
  const dropLen = dropCable?.lengthM ?? path?.segments?.[path.segments.length - 1]?.lengthM ?? null;

  const details = path?.details ?? {};
  const safetyMargin = typeof details.safetyMarginDb === "number" ? details.safetyMarginDb : path?.designMarginDb;
  const designAllowance = typeof details.totalLossDb === "number" ? details.totalLossDb : path?.totalDesignAllowanceDb;

  const customSensitivity = typeof node.properties.rxSensitivityDbm === "number" ? node.properties.rxSensitivityDbm : null;
  const defaultSensitivity = project.settings.opticalBudget.rxSensitivityDbm;
  const customOverload = typeof node.properties.rxOverloadDbm === "number" ? node.properties.rxOverloadDbm : null;
  const defaultOverload = project.settings.opticalBudget.rxOverloadDbm;

  return (
    <div className="dynamic-inspector-content" data-inspector-type="ont">
      {/* 1. GENERAL */}
      <InspectorSection title="1. GENERAL · DEVICE INFORMATION" ariaLabel="General device information">
        <label className="field-label">
          Device name
          <input value={node.name} onChange={(event) => onRename({ kind: "node", id: node.id }, event.target.value)} />
        </label>
        <div className="property-row">
          <span>Device type</span>
          <strong>ONT</strong>
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
              placeholder="e.g. EG8145V5"
              value={String(node.properties.model ?? "")}
              onChange={(e) => onNodeProperties?.(node.id, { model: e.target.value || null })}
            />
          </label>
        </div>
        <div className="property-row">
          <span>Status</span>
          <strong>{String(node.properties.status ?? "Active").toUpperCase()}</strong>
        </div>

        <div className="inspector-summary-subbox" aria-label="ONT summary">
          <div className="subsection-label">ONT SUMMARY</div>
          <div className="property-row"><span>Customer</span><strong>{linkedCustomer ? `${linkedCustomer.name} (${linkedCustomer.id.slice(0, 8)})` : "Unassigned"}</strong></div>
          <div className="property-row"><span>Upstream ODP</span><strong>{upstreamHost?.name ?? "Unconnected"}{upstreamConn?.fromPortId ? ` (${upstreamConn.fromPortId})` : ""}</strong></div>
          <div className="property-row"><span>Drop cable length</span><strong>{dropLen == null ? "Unknown" : `${dropLen.toFixed(2)} m`}</strong></div>
          <div className="property-row"><span>Estimated received power</span><strong>{path?.receivedPowerDbm == null ? "Unknown" : `${path.receivedPowerDbm.toFixed(2)} dBm`}</strong></div>
          <div className="property-row"><span>Optical status</span><strong>{path ? path.status.toUpperCase() : "NOT RUN"}</strong></div>
          {path && <div className="property-row"><span>Physical route status</span><strong>{(path.physicalRouteStatus ?? "unverified").toUpperCase()}</strong></div>}
        </div>
      </InspectorSection>

      {/* 2. CONNECTION */}
      <InspectorSection title="2. CONNECTION · UPSTREAM & CUSTOMER" ariaLabel="ONT connections">
        <ConnectedDevicesList node={node} project={project} nodesById={nodesById} onDisconnectConnection={onDisconnectConnection} />
      </InspectorSection>

      {/* 3. OPTICAL BUDGET */}
      <InspectorSection title="3. OPTICAL BUDGET · LINK EVALUATION" ariaLabel="ONT optical budget">
        <div className="optical-metrics-grid">
          <div className="optical-metric-card primary">
            <span>Estimated received power</span>
            <strong className="mono-value">{path?.receivedPowerDbm == null ? "Unknown" : `${path.receivedPowerDbm.toFixed(2)} dBm`}</strong>
          </div>
          <div className="optical-metric-card">
            <span>Total accumulated loss</span>
            <strong className="mono-value">{path?.lossDb == null ? "Unknown" : `${path.lossDb.toFixed(2)} dB`}</strong>
          </div>
          <div className="optical-metric-card">
            <span>Path length</span>
            <strong className="mono-value">{path?.lengthM == null ? "Unknown" : `${path.lengthM.toFixed(2)} m`}</strong>
          </div>
          <div className="optical-metric-card">
            <span>Optical status</span>
            <strong className={path ? `status-text status-${path.status}` : ""}>{path ? path.status.toUpperCase() : "NOT RUN"}</strong>
          </div>
        </div>
        {path?.marginDb != null && (
          <div className="property-row">
            <span>Design margin</span>
            <strong className="mono-value">{path.marginDb.toFixed(2)} dB</strong>
          </div>
        )}
        <div className="property-row"><span>Physical route status</span><strong>{(path?.physicalRouteStatus ?? "unverified").toUpperCase()}</strong></div>
        {path && (
          <>
            <div className="property-row"><span>Topology reachability</span><strong>{path.connectivityStatus}</strong></div>
            {path.statusReason && <p className="hint diagnostic-hint" role="status">{path.statusReason.replace(/_/g, " ")}</p>}
            <OpticalCalculationTable
              compact
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
            {path.diagnostics?.map((diagnostic, index) => (
              <p className="hint diagnostic-hint" role="status" key={`${diagnostic.code}-${index}`}>{diagnostic.message}</p>
            ))}
          </>
        )}
      </InspectorSection>

      {/* 4. SIGNAL PARAMETERS */}
      <InspectorSection title="4. SIGNAL PARAMETERS · RECEIVER THRESHOLDS" ariaLabel="ONT signal parameters">
        <label className="field-label">
          Receiver sensitivity (dBm)
          <input
            type="number"
            step="0.1"
            value={customSensitivity != null ? customSensitivity : ""}
            placeholder={`${defaultSensitivity.toFixed(2)} dBm (default)`}
            onChange={(e) => {
              const raw = e.target.value;
              onNodeProperties?.(node.id, {
                rxSensitivityDbm: raw.trim() === "" ? null : Number(raw),
              });
            }}
          />
        </label>
        <div className="property-row">
          <span>Sensitivity status</span>
          {customSensitivity != null ? (
            <div className="param-status-group">
              <strong className="param-status-custom">[Custom: {customSensitivity.toFixed(2)} dBm]</strong>
              <button
                type="button"
                className="secondary-button btn-compact"
                onClick={() => onNodeProperties?.(node.id, { rxSensitivityDbm: null })}
              >
                Reset
              </button>
            </div>
          ) : (
            <strong className="param-status-default">[Default: {defaultSensitivity.toFixed(2)} dBm]</strong>
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
              onNodeProperties?.(node.id, {
                rxOverloadDbm: raw.trim() === "" ? null : Number(raw),
              });
            }}
          />
        </label>
        <div className="property-row">
          <span>Overload status</span>
          {customOverload != null ? (
            <div className="param-status-group">
              <strong className="param-status-custom">[Custom: {customOverload.toFixed(2)} dBm]</strong>
              <button
                type="button"
                className="secondary-button btn-compact"
                onClick={() => onNodeProperties?.(node.id, { rxOverloadDbm: null })}
              >
                Reset
              </button>
            </div>
          ) : (
            <strong className="param-status-default">[Default: {defaultOverload.toFixed(2)} dBm]</strong>
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
      </InspectorSection>

      <PhysicalOpticalComponentsPanel project={project} entityKind="node" entityId={node.id} onOpticalComponentsChange={onOpticalComponentsChange} />
      <AdvancedProvenanceDetails entityId={node.id} properties={node.properties} />
      <ProjectOpticalBudgetParametersDetails project={project} onOpticalBudgetConfig={onOpticalBudgetConfig} onRecalculate={onRecalculate} />
    </div>
  );
}
