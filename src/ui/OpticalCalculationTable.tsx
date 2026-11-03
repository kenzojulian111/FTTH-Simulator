import type { OpticalLossBreakdownItem } from "../domain/types";
import { formatReportNumber } from "./reports/reportFormat";

interface Props {
  rows: OpticalLossBreakdownItem[];
  categoryLossesDb?: Record<string, number | null>;
  physicalLossDb: number | null | undefined;
  designMarginDb: number | null | undefined;
  totalDesignAllowanceDb: number | null | undefined;
  powerLabel: string;
  powerDbm: number | null | undefined;
  profileId?: string | null;
  parameterSources?: Record<string, string>;
  compact?: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  fiber: "Fiber", connector: "Connectors", splice: "Splices",
  splitter: "Splitters", passive_component: "Other passive components",
};
const value = (number: number | null | undefined, unit: string) =>
  number == null || !Number.isFinite(number) ? "Unknown" : `${formatReportNumber(number)} ${unit}`;

function formatSourceKind(source: string): string {
  const s = source.toLowerCase();
  if (s === "configured") return "Custom";
  if (s === "profile_default") return "Default Profile";
  if (s === "legacy_fallback" || s === "legacy_illustrative") return "Legacy Fallback";
  return source.replace(/_/g, " ");
}

export function OpticalCalculationTable({ rows, categoryLossesDb, physicalLossDb, designMarginDb, totalDesignAllowanceDb, powerLabel, powerDbm, profileId, parameterSources, compact }: Props) {
  const equation = (row: OpticalLossBreakdownItem) => {
    const quantity = row.calculationQuantity ?? row.quantity;
    const unit = row.calculationQuantityUnit ?? row.quantityUnit;
    if (row.totalLossDb == null || row.unitLossDb == null || quantity == null) return "Calculation incomplete";
    if (row.category === "fiber") {
      const km = quantity / 1000;
      return `${formatReportNumber(km, 5)} km × ${formatReportNumber(row.unitLossDb)} dB/km = ${formatReportNumber(row.totalLossDb)} dB`;
    }
    return `${formatReportNumber(quantity)} ${unit ?? "unit"} × ${formatReportNumber(row.unitLossDb)} ${row.unitLossUnit ?? "dB/unit"} = ${formatReportNumber(row.totalLossDb)} dB`;
  };

  const categoryEntries = Object.entries(categoryLossesDb ?? {});
  const provenanceEntries = Object.entries(parameterSources ?? {});

  const tableContent = (
    <div className="report-table-wrap"><table className="report-table optical-calculation-table">
      <thead><tr><th>Component / path position</th><th>Quantity / length</th><th>Unit attenuation</th><th>Mathematical substitution</th><th>Component loss</th><th>Cumulative physical loss</th><th>Source</th></tr></thead>
      <tbody>{rows.length ? rows.map((row) => <tr key={`${row.componentId}-${row.pathPosition}`}>
        <td>{row.component}<small>{row.position}</small></td>
        <td className="numeric">{row.quantity == null ? "Unknown" : `${formatReportNumber(row.quantity)} ${row.quantityUnit ?? ""}`}{row.calculationQuantity != null && row.calculationQuantity !== row.quantity && <small>Loss uses {formatReportNumber(row.calculationQuantity)} {row.calculationQuantityUnit}</small>}</td>
        <td className="numeric">{value(row.unitLossDb, row.unitLossUnit ?? "dB")}</td>
        <td>{equation(row)}</td><td className="numeric">{value(row.totalLossDb, "dB")}</td><td className="numeric">{value(row.cumulativeLossDb, "dB")}</td>
        <td>{(row.source ?? "unknown").replace(/_/g, " ")}</td>
      </tr>) : <tr><td colSpan={7} className="report-empty-row">No component calculation rows were returned.</td></tr>}</tbody>
      <tfoot>
        {categoryEntries.map(([category, loss]) => <tr key={category}><th colSpan={4}>{CATEGORY_LABELS[category] ?? category} subtotal</th><td className="numeric">{value(loss, "dB")}</td><td colSpan={2} /></tr>)}
        <tr><th colSpan={4}>Physical attenuation subtotal (margin excluded)</th><td className="numeric">{value(physicalLossDb, "dB")}</td><td colSpan={2} /></tr>
        <tr><th colSpan={4}>Configured design margin (separate allowance)</th><td className="numeric">{value(designMarginDb, "dB")}</td><td colSpan={2} /></tr>
        <tr className="report-grand-total"><th colSpan={4}>Total design attenuation allowance</th><td className="numeric">{value(totalDesignAllowanceDb, "dB")}</td><td colSpan={2} /></tr>
      </tfoot>
    </table></div>
  );

  if (compact) {
    return (
      <section className="inspector-optical-budget" aria-label="Detailed Optical Link Budget Calculation">
        {categoryEntries.length > 0 && (
          <div className="optical-breakdown-list">
            <span className="subsection-label">Loss Breakdown by Category</span>
            {categoryEntries.map(([category, loss]) => (
              <div className="property-row" key={category}>
                <span>{CATEGORY_LABELS[category] ?? category}</span>
                <strong className="mono-value">{value(loss, "dB")}</strong>
              </div>
            ))}
            <div className="property-row property-row-total">
              <span>Physical attenuation subtotal (margin excluded)</span>
              <strong className="mono-value">{value(physicalLossDb, "dB")}</strong>
            </div>
            {designMarginDb != null && (
              <div className="property-row">
                <span>Configured design margin</span>
                <strong className="mono-value">{value(designMarginDb, "dB")}</strong>
              </div>
            )}
            {totalDesignAllowanceDb != null && (
              <div className="property-row property-row-total">
                <span>Total design attenuation allowance</span>
                <strong className="mono-value">{value(totalDesignAllowanceDb, "dB")}</strong>
              </div>
            )}
          </div>
        )}

        <details className="inspector-expandable">
          <summary>Detailed Optical Link Budget Calculation ({rows.length} rows)</summary>
          <div className="inspector-expandable-body">
            {tableContent}
            <p className="component-loss-summary"><strong>{powerLabel}:</strong> <span className="mono-value">{value(powerDbm, "dBm")}</span>. Physical power uses transmitter power minus physical attenuation; configured design margin is not subtracted.</p>
          </div>
        </details>

        {(profileId || provenanceEntries.length > 0) && (
          <div className="provenance-summary-box">
            <div className="property-row">
              <span>Parameter profile</span>
              <strong className="mono-value">{profileId ? (profileId.toLowerCase().includes("illustrative") ? "Default Profile (Illustrative)" : profileId) : "Default Profile"}</strong>
            </div>
            {provenanceEntries.length > 0 && (
              <details className="inspector-expandable provenance-details">
                <summary>Advanced Provenance &amp; Parameter Sources ({provenanceEntries.length})</summary>
                <div className="inspector-expandable-body">
                  <p className="report-source-note">
                    {profileId && <>Optical profile: {profileId}{profileId.toLowerCase().includes("illustrative") ? " (illustrative planning assumptions)" : ""}. </>}
                    Parameter provenance: {provenanceEntries.map(([name, source]) => `${name} (${source.replace(/_/g, " ")})`).join(" · ")}
                  </p>
                  <div className="provenance-list">
                    {provenanceEntries.map(([name, source]) => (
                      <div className="provenance-item" key={name}>
                        <span className="provenance-key" title={name}>{name}</span>
                        <span className={`source-badge source-${source}`}>{formatSourceKind(source)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            )}
          </div>
        )}
      </section>
    );
  }

  return <section className="detailed-optical-calculation" aria-label="Detailed Optical Link Budget Calculation">
    <h3>Detailed Optical Link Budget Calculation</h3>
    {tableContent}
    {(profileId || provenanceEntries.length > 0) && <p className="report-source-note">
      {profileId && <>Optical profile: {profileId}{profileId.toLowerCase().includes("illustrative") ? " (illustrative planning assumptions)" : ""}. </>}
      {provenanceEntries.length > 0 && <>Parameter provenance: {provenanceEntries.map(([name, source]) => `${name} (${source.replace(/_/g, " ")})`).join(" · ")}</>}
    </p>}
    <p className="component-loss-summary"><strong>{powerLabel}:</strong> {value(powerDbm, "dBm")}. Physical power uses transmitter power minus physical attenuation; configured design margin is not subtracted.</p>
  </section>;
}
