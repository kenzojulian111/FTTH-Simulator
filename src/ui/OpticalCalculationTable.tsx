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
}

const CATEGORY_LABELS: Record<string, string> = {
  fiber: "Fiber", connector: "Connectors", splice: "Splices",
  splitter: "Splitters", passive_component: "Other passive components",
};
const value = (number: number | null | undefined, unit: string) =>
  number == null || !Number.isFinite(number) ? "Unknown" : `${formatReportNumber(number)} ${unit}`;

export function OpticalCalculationTable({ rows, categoryLossesDb, physicalLossDb, designMarginDb, totalDesignAllowanceDb, powerLabel, powerDbm }: Props) {
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
  return <section className="detailed-optical-calculation" aria-label="Detailed Optical Link Budget Calculation">
    <h3>Detailed Optical Link Budget Calculation</h3>
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
        {Object.entries(categoryLossesDb ?? {}).map(([category, loss]) => <tr key={category}><th colSpan={4}>{CATEGORY_LABELS[category] ?? category} subtotal</th><td className="numeric">{value(loss, "dB")}</td><td colSpan={2} /></tr>)}
        <tr><th colSpan={4}>Physical attenuation subtotal (margin excluded)</th><td className="numeric">{value(physicalLossDb, "dB")}</td><td colSpan={2} /></tr>
        <tr><th colSpan={4}>Configured design margin (separate allowance)</th><td className="numeric">{value(designMarginDb, "dB")}</td><td colSpan={2} /></tr>
        <tr className="report-grand-total"><th colSpan={4}>Total design attenuation allowance</th><td className="numeric">{value(totalDesignAllowanceDb, "dB")}</td><td colSpan={2} /></tr>
      </tfoot>
    </table></div>
    <p className="component-loss-summary"><strong>{powerLabel}:</strong> {value(powerDbm, "dBm")}. Physical power uses transmitter power minus physical attenuation; configured design margin is not subtracted.</p>
  </section>;
}
