import type { FeatureRef, NetworkNode, OpticalBudgetResult, OpticalDiagnosticItem, Project } from "../../domain/types";
import { detailNumber, detailString, formatReportDate, formatReportNumber } from "./reportFormat";
import { ReportToolbar } from "./ReportNavigation";
import { describeOpticalPath, opticalPathDisplayIssue, opticalPathDisplayStatus } from "../../domain/opticalPathDisplay";
import { OpticalCalculationTable } from "../OpticalCalculationTable";

interface Props {
  project: Project;
  result: OpticalBudgetResult | null;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onSelectNode?: (nodeId: string) => void;
  onSelectEntity?: (ref: FeatureRef) => void;
}

function nodeName(project: Project, id: string): string {
  const node = project.nodes.find((item) => item.id === id);
  return node ? `${node.name} (${node.type.toUpperCase()})` : `Missing device (${id})`;
}

function configuredProperty(node: NetworkNode, key: string): string | null {
  const value = node.properties[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function pathReason(path: OpticalBudgetResult["paths"][number]): string {
  const reason = path.statusReason ?? detailString(path.details, "reason");
  if (reason === "rx_power_below_sensitivity") return "Received power is below the ONT receiver sensitivity.";
  if (reason === "rx_power_exceeds_overload") return "Received power exceeds the ONT receiver overload limit.";
  if (reason === "insufficient_safety_margin") return "Optical margin is below the configured minimum.";
  if (reason === "invalid_optical_configuration") return "Optical path configuration violates an engineering model constraint.";
  if (reason === "optical_budget_within_limits") return "Received power and optical margin are within configured limits.";
  if (reason === "no_directed_path_from_olt") return "No directed OLT-to-ONT path was returned by the backend.";
  if (reason === "multiple_directed_paths_from_olt") return "Ambiguous path: the backend found multiple directed OLT-to-ONT routes.";
  if (reason) return reason;
  if (path.status === "fail") return "The backend returned FAIL but did not include a specific failure reason.";
  if (path.status === "unknown") return "The backend could not determine a complete optical path.";
  return "The backend reported this path as passing.";
}

function formatDiagnosticThreshold(item: OpticalDiagnosticItem): string | null {
  const unitSuffix = item.unit ? ` ${item.unit}` : "";
  const hasActual = item.actualValue !== undefined && item.actualValue !== null;
  const hasExpected = item.expectedValue !== undefined && item.expectedValue !== null;
  const actualStr = typeof item.actualValue === "number" ? formatReportNumber(item.actualValue) : String(item.actualValue ?? "");
  const expectedStr = typeof item.expectedValue === "number" ? formatReportNumber(item.expectedValue) : String(item.expectedValue ?? "");
  if (hasActual && hasExpected) return `Actual: ${actualStr}${unitSuffix} · Threshold / Expected: ${expectedStr}${unitSuffix}`;
  if (hasActual) return `Actual: ${actualStr}${unitSuffix}`;
  if (hasExpected) return `Threshold / Expected: ${expectedStr}${unitSuffix}`;
  return null;
}

function resolveSelectableEntity(
  item: OpticalDiagnosticItem,
  project: Project,
): { ref: FeatureRef; label: string } | null {
  const id = item.affectedEntityId;
  if (!id) return null;
  if (item.affectedEntityType === "ont" || item.affectedEntityType === "node") {
    const node = project.nodes.find((n) => n.id === id);
    if (node) return { ref: { kind: "node", id: node.id }, label: node.name };
  }
  if (item.affectedEntityType === "cable") {
    const cable = project.cableSegments.find((c) => c.id === id);
    if (cable) return { ref: { kind: "cable", id: cable.id }, label: cable.name };
  }
  if (item.affectedEntityType === "connection") {
    const conn = project.connections.find((c) => c.id === id);
    if (conn) {
      const cable = project.cableSegments.find((c) => c.id === conn.cableSegmentId);
      if (cable) return { ref: { kind: "cable", id: cable.id }, label: cable.name };
      const fromNode = project.nodes.find((n) => n.id === conn.fromNodeId);
      if (fromNode) return { ref: { kind: "node", id: fromNode.id }, label: fromNode.name };
    }
  }
  if (item.affectedEntityType === "component") {
    const comp = project.opticalComponents?.find((c) => c.id === id);
    if (comp?.nodeId) {
      const node = project.nodes.find((n) => n.id === comp.nodeId);
      if (node) return { ref: { kind: "node", id: node.id }, label: node.name };
    }
  }
  return null;
}

const CATEGORY_LABELS: Record<OpticalDiagnosticItem["category"], string> = {
  connectivity: "Connectivity",
  optical_budget: "Optical Budget",
  configuration: "Configuration",
  physical_deployment: "Physical Deployment",
};

export function OpticalEngineeringReport({ project, result, loading, error, onBack, onSelectNode, onSelectEntity }: Props) {
  const customerName = (id: string) => project.customers.find((customer) => customer.id === id)?.name ?? id;
  const triggerSelect = (ref: FeatureRef) => {
    if (onSelectEntity) {
      onSelectEntity(ref);
    } else if (ref.kind === "node" && onSelectNode) {
      onSelectNode(ref.id);
    }
  };
  return <article className="engineering-report optical-report">
    <ReportToolbar onBack={onBack} />
    <header className="report-header"><div><p className="report-kicker">OPTICAL ENGINEERING · END-TO-END BUDGET</p><h1>Optical Engineering Report</h1><p className="report-project">{project.name}</p></div><div className="report-meta"><span>Report date</span><strong>{result ? formatReportDate(result.calculatedAt) : "—"}</strong><span>Units</span><strong>Length: m · Loss: dB · Power: dBm</strong></div></header>
    {loading && <p className="report-state" role="status">Calculating optical budget…</p>}
    {error && <p className="report-state error" role="alert">Optical-budget calculation failed: {error}</p>}
    {!result && !loading && <p className="report-state">No valid optical-budget result is available. Run the backend optical-budget calculation to generate this report.</p>}
    {result && <>
      {(result.diagnostics?.length ?? 0) > 0 && <section className="report-diagnostic configuration"><strong>Project component reference diagnostics</strong>{result.diagnostics?.map((diagnostic, index) => <p key={index}>{String(diagnostic.code)} · component {String(diagnostic.componentId)} · missing reference {String(diagnostic.nodeId ?? diagnostic.connectionId)}</p>)}</section>}
      {result.paths.length ? result.paths.map((path, index) => {
        const displayStatus = opticalPathDisplayStatus(path);
        const displayIssue = opticalPathDisplayIssue(path);
        const diagnostic = describeOpticalPath(path, project);
        const connectivityStatus = path.connectivityStatus ?? (
          path.statusReason === "no_directed_path_from_olt"
            ? "disconnected"
            : path.statusReason === "invalid_topology_connection"
              ? "invalid_topology"
              : path.statusReason === "multiple_directed_paths_from_olt"
                ? "ambiguous"
                : "connected"
        );
        const opticalBudgetStatus = path.opticalBudgetStatus ?? (displayStatus === "warning" ? "unknown" : displayStatus);
        const structuredDiagnostics = path.diagnostics ?? [];
        const pathConnections = path.connectionIds.map((id) => project.connections.find((connection) => connection.id === id)).filter((connection) => connection !== undefined);
        const splitters = path.nodeIds.map((id) => project.nodes.find((node) => node.id === id)).filter((node): node is NetworkNode => node !== undefined && (node.type === "splitter" || node.properties.splitterRatio !== undefined || node.properties.splitterLossDb !== undefined));
        return <section className="optical-path-card" key={`${path.ontNodeId}-${index}`}>
          <header className="optical-path-heading">
            <div><p className="report-kicker">END-TO-END PATH {index + 1}</p><h2>{nodeName(project, path.ontNodeId)}</h2></div>
            <div className="optical-status-badges">
              <span className="status-sub-badge">Connectivity: <strong>{connectivityStatus.replace(/_/g, " ")}</strong></span>
              <span className="status-sub-badge">Optical budget: <strong>{opticalBudgetStatus}</strong></span>
              <strong className={`report-status status-${displayStatus}`}>{displayStatus}</strong>
            </div>
          </header>
          <p className="path-device-order"><strong>Devices in order</strong><span>{path.nodeIds.length ? path.nodeIds.map((id) => nodeName(project, id)).join("  →  ") : "No complete device sequence returned"}</span></p>
          <p className="path-reason">{displayIssue ?? pathReason(path)}</p>
          {displayStatus !== "pass" && <div className={`report-diagnostic ${diagnostic.category === "topology" ? "topology" : "configuration"}`}>
            <strong>{diagnostic.category}: {diagnostic.summary}</strong><p>{diagnostic.resolution}</p>
            {diagnostic.parameters.length > 0 && <ul>{diagnostic.parameters.map((item) => <li key={`${item.name}-${item.unit}`}>{item.name} · {item.unit} · source: {item.source.replace(/_/g, " ")}</li>)}</ul>}
            {(onSelectNode || onSelectEntity) && diagnostic.affectedNodeIds.map((id) => <button type="button" key={id} onClick={() => triggerSelect({ kind: "node", id })}>Select {project.nodes.find((node) => node.id === id)?.name ?? "affected device"}</button>)}
          </div>}
          {structuredDiagnostics.length > 0 && <div className="structured-diagnostics-panel" aria-label="Explainable optical diagnostics">
            <h3>Structured Optical Diagnostics ({structuredDiagnostics.length})</h3>
            <ul className="structured-diagnostics-list">
              {structuredDiagnostics.map((item, diagIndex) => {
                const thresholdText = formatDiagnosticThreshold(item);
                const selectable = resolveSelectableEntity(item, project);
                return <li key={`${item.code}-${item.affectedEntityId ?? "path"}-${diagIndex}`} className={`structured-diagnostic-item severity-${item.severity}`}>
                  <div className="diagnostic-item-header">
                    <span className={`diagnostic-severity-badge badge-${item.severity}`}>{item.severity.toUpperCase()}</span>
                    <code className="diagnostic-code">{item.code}</code>
                    <span className="diagnostic-category">{CATEGORY_LABELS[item.category] ?? item.category}</span>
                    {item.dataSource && <span className="diagnostic-provenance">Source: {item.dataSource.replace(/_/g, " ")}</span>}
                  </div>
                  <p className="diagnostic-message">{item.message}</p>
                  <div className="diagnostic-meta-row">
                    {item.affectedEntityId && <span><strong>Affected {item.affectedEntityType ?? "entity"}:</strong> {item.affectedEntityName ? `${item.affectedEntityName} (${item.affectedEntityId})` : item.affectedEntityId}</span>}
                    {thresholdText && <span><strong>Values:</strong> {thresholdText}</span>}
                  </div>
                  {item.correctiveAction && <p className="diagnostic-corrective-action"><strong>Corrective action:</strong> {item.correctiveAction}</p>}
                  {(onSelectNode || onSelectEntity) && selectable && (
                    <button type="button" className="diagnostic-select-btn" onClick={() => triggerSelect(selectable.ref)}>
                      Inspect {selectable.label} ({selectable.ref.id})
                    </button>
                  )}
                </li>;
              })}
            </ul>
          </div>}
          {(path.calculationLimitations?.length ?? 0) > 0 && <div className="calculation-limitations-note" role="note">
            <strong>Calculation limitations:</strong>
            <ul>{path.calculationLimitations?.map((limitation, limIndex) => <li key={limIndex}>{limitation}</li>)}</ul>
          </div>}
          {path.customerIds.length > 0 && <p className="path-customers"><strong>Associated customers:</strong> {path.customerIds.map(customerName).join(", ")}</p>}
          {(path.segments?.length || pathConnections.length > 0) && <div className="report-table-wrap"><table className="report-table segment-table"><thead><tr><th>Connection</th><th>Cable segment</th><th>Geometry length (m)</th><th>Path contribution (m)</th><th>Attenuation (dB/km)</th><th>Fiber loss (dB)</th><th>Connectors / loss (dB)</th><th>Splices / loss (dB)</th><th>Total segment loss (dB)</th></tr></thead><tbody>
            {path.segments?.length ? path.segments.map((segment) => <tr key={segment.connectionId}><td>{segment.fromNodeName} → {segment.toNodeName}</td><td>{segment.cableName}</td><td className="numeric">{formatReportNumber(segment.lengthM)}</td><td className="numeric">{formatReportNumber(segment.routeLengthContributionM ?? segment.lengthM)}</td><td className="numeric">{formatReportNumber(segment.attenuationDbPerKm)}</td><td className="numeric">{formatReportNumber(segment.fiberLossDb)}</td><td className="numeric">{segment.connectorsCount} / {formatReportNumber(segment.connectorLossDb)}</td><td className="numeric">{segment.splicesCount} / {formatReportNumber(segment.spliceLossDb)}</td><td className="numeric">{formatReportNumber(segment.totalSegmentLossDb)}</td></tr>) : null}
            {pathConnections.map((connection) => {
              if (path.segments?.length) return null;
              const link = result.links.find((item) => item.connectionId === connection.id);
              const cable = project.cableSegments.find((item) => item.id === connection.cableSegmentId);
              return <tr key={connection.id}><td>{nodeName(project, connection.fromNodeId)} → {nodeName(project, connection.toNodeId)}</td><td>{cable?.name ?? `Missing cable (${connection.cableSegmentId})`}</td><td className="numeric">{link ? formatReportNumber(link.lengthM) : "—"}</td><td className="numeric">{formatReportNumber(detailNumber(link?.details, "fiberAttenuationDbPerKm"))}</td><td className="numeric">{formatReportNumber(detailNumber(link?.details, "fiberLossDb"))}</td><td className="numeric">{formatReportNumber(detailNumber(link?.details, "connectorsCount"))} / {formatReportNumber(detailNumber(link?.details, "connectorLossDb"))}</td><td className="numeric">{formatReportNumber(detailNumber(link?.details, "splicesCount"))} / {formatReportNumber(detailNumber(link?.details, "spliceLossDb"))}</td><td className="numeric">{link ? formatReportNumber(link.lossDb) : "—"}</td></tr>;
            })}
          </tbody></table></div>}
          {(path.splitters?.length || splitters.length) > 0 && <div className="splitter-summary"><h3>Splitters on path</h3>{path.splitters?.length ? path.splitters.map((splitter) => <p key={splitter.nodeId}><strong>{splitter.nodeName}</strong>{splitter.splitterRatio ? ` · ratio ${splitter.splitterRatio}` : ""} · actual insertion loss {formatReportNumber(splitter.lossDb)} dB · theoretical split {formatReportNumber(splitter.idealLossDb)} dB (reference only)</p>) : splitters.map((node) => {
            const ratio = configuredProperty(node, "splitterRatio");
            const configuredLoss = node.properties.splitterLossDb;
            return <p key={node.id}><strong>{node.name}</strong>{ratio ? ` · ratio ${ratio}` : ""}{typeof configuredLoss === "number" ? ` · configured loss ${formatReportNumber(configuredLoss)} dB` : " · individual loss not returned; included in aggregate splitter loss"}</p>;
          })}</div>}
          <OpticalCalculationTable rows={path.lossBreakdown ?? []} categoryLossesDb={path.categoryLossesDb}
            physicalLossDb={path.lossDb} designMarginDb={path.designMarginDb ?? detailNumber(path.details, "safetyMarginDb")}
            totalDesignAllowanceDb={path.totalDesignAllowanceDb ?? detailNumber(path.details, "totalLossDb")}
            powerLabel="Received optical power (physical; design margin excluded)" powerDbm={path.receivedPowerDbm} />
          <div className="path-budget-grid">
            <div><span>Total route length</span><strong>{path.lengthM === null ? "—" : `${formatReportNumber(path.lengthM)} m`}</strong></div>
            <div><span>Total path loss</span><strong>{path.lossDb === null ? "—" : `${formatReportNumber(path.lossDb)} dB`}</strong></div>
            <div><span>Transmit power</span><strong>{path.txPowerDbm == null && detailNumber(path.details, "txPowerDbm") === null ? "—" : `${formatReportNumber(path.txPowerDbm ?? detailNumber(path.details, "txPowerDbm"))} dBm`}</strong></div>
            <div><span>Received power</span><strong>{path.receivedPowerDbm === null ? "—" : `${formatReportNumber(path.receivedPowerDbm)} dBm`}</strong></div>
            <div><span>Receiver sensitivity</span><strong>{path.rxSensitivityDbm == null && detailNumber(path.details, "rxSensitivityDbm") === null ? "—" : `${formatReportNumber(path.rxSensitivityDbm ?? detailNumber(path.details, "rxSensitivityDbm"))} dBm`}</strong></div>
            <div><span>Overload limit</span><strong>{path.rxOverloadDbm == null && detailNumber(path.details, "rxOverloadDbm") === null ? "—" : `${formatReportNumber(path.rxOverloadDbm ?? detailNumber(path.details, "rxOverloadDbm"))} dBm`}</strong></div>
            <div><span>Sensitivity headroom</span><strong>{path.sensitivityMarginDb == null ? "—" : `${formatReportNumber(path.sensitivityMarginDb)} dB`}</strong></div>
            <div><span>Overload headroom</span><strong>{path.overloadMarginDb == null ? "—" : `${formatReportNumber(path.overloadMarginDb)} dB`}</strong></div>
            <div><span>Optical margin</span><strong>{path.marginDb === null ? "—" : `${formatReportNumber(path.marginDb)} dB`}</strong></div>
          </div>
          <section className="splitter-summary"><h3>Project standard comparison</h3><p>Configured physical total: {formatReportNumber(path.lossDb)} dB · project/operator standard: {formatReportNumber(path.standardLossDb)} dB · variance (actual − standard): {formatReportNumber(path.standardVarianceDb)} dB</p><p>Datasheet and field measurement values below are references; neither replaces the configured calculation.</p></section>
          {(path.componentLosses?.length ?? 0) > 0 && <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Component</th><th>Location</th><th>Configured loss</th><th>Source</th></tr></thead><tbody>{path.componentLosses?.map((component, componentIndex) => <tr key={`${String(component.componentId ?? "component")}-${componentIndex}`}><td>{String(component.kind ?? "Component")} · {String(component.componentId ?? "")}</td><td>{String(component.location ?? "Unknown")}</td><td>{formatReportNumber(typeof component.lossDb === "number" ? component.lossDb : null)} dB</td><td>{String(component.source ?? "unknown")}</td></tr>)}</tbody></table></div>}
          {(path.locationLossSummary && Object.keys(path.locationLossSummary).length > 0) && <p className="component-loss-summary"><strong>Location subsets:</strong> {Object.entries(path.locationLossSummary).map(([locationName, loss]) => `${locationName} ${formatReportNumber(loss)} dB`).join(" · ")}. These are subsets of the physical total.</p>}
          {(path.datasheetReferences?.length ?? 0) > 0 && <section className="splitter-summary"><h3>Datasheet references</h3>{path.datasheetReferences?.map((reference, refIndex) => <p key={refIndex}>{String(reference.componentId ?? "Component")} · {String(reference.model ?? "Model unknown")} · {formatReportNumber(typeof reference.lossDb === "number" ? reference.lossDb : null)} dB · {String(reference.reference ?? "Reference not supplied")}</p>)}</section>}
          {(path.fieldMeasurements?.length ?? 0) > 0 && <section className="splitter-summary"><h3>Field measurements</h3>{path.fieldMeasurements?.map((measurement, measurementIndex) => <p key={measurementIndex}>{String(measurement.componentId ?? "Component")} · {formatReportNumber(typeof measurement.lossDb === "number" ? measurement.lossDb : null)} dB · {String(measurement.measuredAt ?? "Date unknown")} · {String(measurement.method ?? "Method unknown")}</p>)}</section>}
        </section>;
      }) : <p className="report-state">The backend returned no per-ONT path records.</p>}
      {(result.intermediateNodes?.length ?? 0) > 0 && <section className="intermediate-report-section">
        <h2>ODC / ODP Optical Path Prefixes</h2>
        {result.intermediateNodes?.map((node) => <section className="optical-path-card intermediate-path-card" key={node.nodeId}>
          <header className="optical-path-heading"><div><p className="report-kicker">PASSIVE NODE PREFIX · {node.nodeType.toUpperCase()}</p><h2>{node.nodeName} ({node.nodeId})</h2></div><strong className={`report-status status-${node.status === "estimated" ? "pass" : "unknown"}`}>{node.status}</strong></header>
          <p className="path-device-order"><strong>Topology position</strong><span>{(node.nodeIds ?? []).map((id) => nodeName(project, id)).join(" → ") || "No directed OLT prefix returned"}</span></p>
          <p className="component-loss-summary"><strong>Originating OLT:</strong> {node.sourceOltName ?? node.sourceOltId ?? "Unknown"} · <strong>Launch power:</strong> {node.transmitterPowerDbm == null ? "Unknown" : `${formatReportNumber(node.transmitterPowerDbm)} dBm`} · <strong>Path length:</strong> {node.lengthM == null ? "Unknown" : `${formatReportNumber(node.lengthM)} m`}</p>
          <OpticalCalculationTable rows={node.lossBreakdown ?? []} categoryLossesDb={node.categoryLossesDb}
            physicalLossDb={node.accumulatedLossDb} designMarginDb={node.designMarginDb}
            totalDesignAllowanceDb={node.totalDesignAllowanceDb} powerLabel="Estimated optical power at passive node (not a receiver measurement)"
            powerDbm={node.estimatedPowerDbm} />
          {(node.parameterSources && Object.keys(node.parameterSources).length > 0) && <p className="report-source-note">Input provenance: {Object.entries(node.parameterSources).map(([key, source]) => `${key}: ${source.replace(/_/g, " ")}`).join(" · ")}</p>}
          {(node.diagnostics?.length ?? 0) > 0 && <div className="report-diagnostic configuration"><strong>Diagnostics</strong><ul>{node.diagnostics?.map((message, index) => <li key={index}>{message}</li>)}</ul></div>}
        </section>)}
      </section>}
      <section className="disconnected-section"><h2>Disconnected customers</h2>{result.disconnectedCustomerIds.length ? <ul>{result.disconnectedCustomerIds.map((id) => <li key={id}>{customerName(id)} <small>({id})</small></li>)}</ul> : <p>No disconnected customers were reported by the backend.</p>}</section>
      <p className="report-source-note">Engineering values and status are returned by the backend. Per-segment values are shown only when present in the corresponding backend link details; no missing loss values are estimated in this report.</p>
    </>}
  </article>;
}
