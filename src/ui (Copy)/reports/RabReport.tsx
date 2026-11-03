import type { ConstructionCostResult } from "../../domain/types";
import { formatReportCurrency, formatReportDate, formatReportNumber } from "./reportFormat";
import { ReportToolbar } from "./ReportNavigation";

interface Props { projectName: string; result: ConstructionCostResult | null; loading: boolean; error: string | null; onBack: () => void; routerCount?: number }

function subtotal(result: ConstructionCostResult, category: "material" | "installation" | "other"): number {
  if (category === "material" && result.materialSubtotal != null) return result.materialSubtotal;
  if (category === "installation" && result.installationSubtotal != null) return result.installationSubtotal;
  return result.items.reduce((total, item) => {
    const isMaterial = item.category === "material" || (!item.category && item.code.endsWith("-SUPPLY"));
    const isInstallation = item.category === "installation" || (!item.category && item.code.endsWith("-INSTALL"));
    return (category === "material" && isMaterial) || (category === "installation" && isInstallation) || (category === "other" && !isMaterial && !isInstallation)
      ? total + item.amount
      : total;
  }, 0);
}

function categoryLabel(item: ConstructionCostResult["items"][number]): string {
  if (item.category === "material" || (!item.category && item.code.endsWith("-SUPPLY"))) return "Material";
  if (item.category === "installation" || (!item.category && item.code.endsWith("-INSTALL"))) return "Installation";
  return "Other";
}

export function RabReport({ projectName, result, loading, error, onBack, routerCount = 0 }: Props) {
  const cableAudit = Array.isArray(result?.summary?.cableQuantityAudit) ? result.summary.cableQuantityAudit as Array<Record<string, unknown>> : [];
  const deploymentAudit = Array.isArray(result?.summary?.deploymentMethodAudit) ? result.summary.deploymentMethodAudit as Array<Record<string, unknown>> : [];
  const poleStatusCounts = result?.summary?.poleStatusCounts && typeof result.summary.poleStatusCounts === "object" ? result.summary.poleStatusCounts as Record<string, unknown> : {};
  return <article className="engineering-report rab-report">
    <ReportToolbar onBack={onBack} />
    <header className="report-header"><div><p className="report-kicker">CONSTRUCTION COST · RENCANA ANGGARAN BIAYA</p><h1>RAB Report</h1><p className="report-project">{projectName}</p></div><div className="report-meta"><span>Report date</span><strong>{result ? formatReportDate(result.calculatedAt) : "—"}</strong><span>Currency</span><strong>{result?.currency ?? "—"}</strong></div></header>
    {loading && <p className="report-state" role="status">Calculating construction cost…</p>}
    {error && <p className="report-state error" role="alert">Construction-cost calculation failed: {error}</p>}
    {!result && !loading && <p className="report-state">No valid construction-cost result is available. Run the backend construction-cost calculation to generate this report.</p>}
    {result && routerCount > 0 && !result.items.some((item) => item.code.startsWith("RTR-")) && <p className="report-state" role="status">This project contains {routerCount} Router node(s), but the backend returned no separately priced Router RAB lines. Router equipment coverage and integrated ONT/router treatment require backend cost support; no Router cost has been added here.</p>}
    {result && <>
      <p className="report-note">Planning estimate based on configured project inputs. Unit prices are not verified market quotations.</p>
      <div className="report-table-wrap"><table className="report-table"><thead><tr><th>No.</th><th>Category</th><th>Work / material description</th><th>Quantity</th><th>Unit</th><th>Unit price</th><th>Rate source</th><th>Line total</th></tr></thead>
        <tbody>{result.items.length ? result.items.map((item, index) => <tr key={`${item.code}-${index}`}><td>{index + 1}</td><td>{categoryLabel(item)}</td><td><strong>{item.description}</strong><small>{item.code}</small></td><td className="numeric">{formatReportNumber(item.quantity, 3)}</td><td>{item.unit}</td><td className="numeric">{formatReportCurrency(item.unitCost, result.currency)}</td><td>{item.unitCostReference || (item.unitCostSource === "configured" ? "Configured · reference missing" : "Legacy illustrative")}</td><td className="numeric">{formatReportCurrency(item.amount, result.currency)}</td></tr>) : <tr><td colSpan={8} className="report-empty-row">The backend returned no cost line items.</td></tr>}</tbody>
        <tfoot>
          <tr><th colSpan={7}>Materials subtotal</th><td className="numeric">{formatReportCurrency(subtotal(result, "material"), result.currency)}</td></tr>
          <tr><th colSpan={7}>Installation subtotal</th><td className="numeric">{formatReportCurrency(subtotal(result, "installation"), result.currency)}</td></tr>
          {result.items.some((item) => categoryLabel(item) === "Other") && <tr><th colSpan={7}>Other items subtotal</th><td className="numeric">{formatReportCurrency(subtotal(result, "other"), result.currency)}</td></tr>}
          <tr className="report-grand-total"><th colSpan={7}>Grand total · backend CAPEX</th><td className="numeric">{formatReportCurrency(result.grandTotal ?? result.totalCapex ?? result.totalAmount, result.currency)}</td></tr>
        </tfoot>
      </table></div>
      {cableAudit.length > 0 && <section className="splitter-summary"><h3>Cable quantity audit</h3>{cableAudit.map((row, index) => <p key={index}><strong>{String(row.category ?? "Unspecified")}</strong> · physical {formatReportNumber(typeof row.physicalLengthM === "number" ? row.physicalLengthM : null)} m · slack {String(row.slackPercent ?? "—")}% · billed {formatReportNumber(typeof row.billedLengthM === "number" ? row.billedLengthM : null)} m · cable IDs {Array.isArray(row.cableSegmentIds) ? row.cableSegmentIds.map(String).join(", ") : "—"}</p>)}</section>}
      {deploymentAudit.length > 0 && <section className="splitter-summary"><h3>Deployment method audit</h3>{deploymentAudit.map((row, index) => <p key={index}><strong>{String(row.deploymentMethod ?? "unspecified")}</strong> · physical {formatReportNumber(typeof row.physicalLengthM === "number" ? row.physicalLengthM : null)} m · cable IDs {Array.isArray(row.cableSegmentIds) ? row.cableSegmentIds.map(String).join(", ") : "—"}</p>)}</section>}
      <section className="report-summary"><div><span>Connected customers</span><strong>{result.connectedCustomerCount ?? "—"}</strong></div><div><span>Cost per connected customer</span><strong>{result.costPerConnectedCustomer == null ? "—" : formatReportCurrency(result.costPerConnectedCustomer, result.currency)}</strong></div></section>
      {Object.keys(poleStatusCounts).length > 0 && <p className="report-note">Pole count once per ID · existing {String(poleStatusCounts.existing ?? 0)} · proposed {String(poleStatusCounts.proposed ?? 0)} · shared {String(poleStatusCounts.shared ?? 0)} · unverified {String(poleStatusCounts.unverified ?? 0)}.</p>}
      {!result.complete && <section className="report-state" role="status"><strong>Incomplete estimate</strong>{(result.incompleteItems ?? []).map((item, index) => <p key={index}>{String(item.code ?? "Item")}: {String(item.reason ?? "Required rate is unknown")}</p>)}</section>}
      {(result.assumptions ?? []).length > 0 && <ul className="report-note">{result.assumptions?.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul>}
      <p className="report-source-note">Line items, unit rates, quantities, subtotals, and grand total are backend calculation values. Where the backend omits a subtotal, it is grouped from the returned line totals.</p>
    </>}
  </article>;
}
