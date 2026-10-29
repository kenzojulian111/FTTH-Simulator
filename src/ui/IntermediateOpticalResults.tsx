import type { OpticalBudgetResult } from "../domain/types";

type IntermediateNode = NonNullable<OpticalBudgetResult["intermediateNodes"]>[number];
type LossEntry = NonNullable<IntermediateNode["lossBreakdown"]>[number];

const categoryLabels: Record<LossEntry["category"], string> = {
  fiber: "Fiber",
  connector: "Connector",
  splice: "Splice",
  splitter: "Splitter insertion loss",
  passive_component: "Other passive component",
};

const statusLabels: Record<IntermediateNode["status"], string> = {
  estimated: "Estimated",
  unknown: "Unknown · incomplete or unverified",
  ambiguous: "Ambiguous path",
  unreachable: "Unreachable",
};

function metric(value: number | null | undefined, unit: string) {
  return value == null || !Number.isFinite(value) ? "Unknown" : `${value.toFixed(2)} ${unit}`;
}

function sourceLabel(source: string) {
  return source.replace(/_/g, " ");
}

function connectivityLabel(node: IntermediateNode) {
  if (node.status === "unreachable") return "Unreachable from an evaluated OLT path";
  if (node.status === "ambiguous") return "Multiple candidate paths";
  if (node.nodeIds?.length) return "Directed path found";
  return "Unknown · no single path confirmed";
}

export function IntermediateOpticalResults({ intermediateNodes }: { intermediateNodes: IntermediateNode[] }) {
  if (intermediateNodes.length === 0) return null;

  return <section className="intermediate-results" aria-label="ODC and ODP optical results">
    <p className="intermediate-results-heading">Intermediate passive-node results · backend values</p>
    {intermediateNodes.map((node) => {
      const lossBreakdown = node.lossBreakdown ?? [];
      const diagnostics = node.diagnostics ?? [];
      const parameterSources = Object.entries(node.parameterSources ?? {});
      const categoryLosses = Object.entries(node.categoryLossesDb ?? {});
      return <article className="intermediate-result" key={node.nodeId}>
        <header className="intermediate-result-header">
          <div><strong>{node.nodeName || node.nodeId}</strong><small>{node.nodeType.toUpperCase()} · {node.sourceOltName ?? "OLT source unknown"}</small></div>
          <strong className={`intermediate-result-status ${node.status === "estimated" ? "status-warning" : node.status === "unreachable" ? "status-fail" : "status-unknown"}`}>{statusLabels[node.status]}</strong>
        </header>
        <div className="intermediate-result-metrics">
          <div><span>Connectivity</span><strong>{connectivityLabel(node)}</strong></div>
          <div><span>Estimated optical power</span><strong>{metric(node.estimatedPowerDbm, "dBm")}</strong></div>
          <div><span>Accumulated path loss</span><strong>{metric(node.accumulatedLossDb, "dB")}</strong></div>
          <div><span>Path length from OLT</span><strong>{metric(node.lengthM, "m")}</strong></div>
        </div>
        <details className="intermediate-result-details">
          <summary>Loss breakdown · {lossBreakdown.length} component entries</summary>
          <p className="intermediate-result-note">Per-segment/component loss is shown separately from cumulative path loss. Values are returned by the optical analysis.</p>
          {lossBreakdown.length > 0 ? <div className="intermediate-loss-list">
            {lossBreakdown.map((entry) => <div className="intermediate-loss-entry" key={`${entry.componentId}-${entry.pathPosition}`}>
              <div className="intermediate-loss-title"><strong>{categoryLabels[entry.category]} · {entry.component}</strong><small>{entry.position}</small></div>
              <div className="intermediate-loss-values">
                <span>Per segment / component<strong>{metric(entry.totalLossDb, "dB")}</strong></span>
                <span>Cumulative path loss<strong>{metric(entry.cumulativeLossDb, "dB")}</strong></span>
              </div>
              <small className="intermediate-loss-source">
                {entry.quantity == null ? "Quantity unknown" : `${entry.quantity.toLocaleString()} ${entry.quantityUnit ?? ""}`}
                {entry.calculationQuantity != null && entry.calculationQuantity !== entry.quantity ? ` · calculation used ${entry.calculationQuantity.toLocaleString()} ${entry.calculationQuantityUnit ?? entry.quantityUnit ?? ""}` : ""}
                {entry.unitLossDb == null ? " · unit attenuation unknown" : ` · ${metric(entry.unitLossDb, entry.unitLossUnit ?? "dB")}`}
                {` · source: ${sourceLabel(entry.source ?? "unknown")}`}
              </small>
            </div>)}
          </div> : <p className="intermediate-result-note">No component-level loss breakdown was returned.</p>}
          {categoryLosses.length > 0 && <div className="intermediate-category-totals"><strong>Category totals</strong>{categoryLosses.map(([category, value]) => <span key={category}>{categoryLabels[category as LossEntry["category"]] ?? sourceLabel(category)}: {metric(value, "dB")}</span>)}</div>}
          {parameterSources.length > 0 && <div className="intermediate-provenance"><strong>Input provenance</strong>{parameterSources.map(([parameter, source]) => <span key={parameter}>{parameter}: {sourceLabel(source)}</span>)}</div>}
          {diagnostics.length > 0 && <ul className="intermediate-diagnostics" aria-label="Optical result diagnostics">{diagnostics.map((diagnostic, index) => <li key={`${index}-${diagnostic}`}>{diagnostic}</li>)}</ul>}
          {node.status === "unknown" && diagnostics.length === 0 && <p className="intermediate-result-note">The backend marked this result unknown; check input completeness and provenance.</p>}
        </details>
      </article>;
    })}
  </section>;
}
