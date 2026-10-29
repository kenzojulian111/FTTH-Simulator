import type { ConstructionCostConfig } from "../domain/types";

interface Props { config: ConstructionCostConfig; onChange: (config: ConstructionCostConfig) => void }
type RateKey =
  | "cableUnitCostPerMeter"
  | "cableInstallationCostPerMeter"
  | "poleUnitCost"
  | "poleInstallationCost"
  | "oltUnitCost"
  | "oltInstallationCost"
  | "odcUnitCost"
  | "odcInstallationCost"
  | "odpUnitCost"
  | "odpInstallationCost"
  | "ontUnitCost"
  | "ontInstallationCost"
  | "splitterUnitCost"
  | "splitterInstallationCost"
  | "routerUnitCost"
  | "routerInstallationCost"
  | "ductUnitCostPerMeter"
  | "trenchingCostPerMeter"
  | "excavationCostPerMeter"
  | "warningTapeCostPerMeter"
  | "undergroundInstallationCostPerMeter"
  | "buildingAttachmentCostPerMeter"
  | "otherDeploymentCostPerMeter";

const rateRows: Array<{ key: RateKey; label: string; unit: string; optional?: boolean }> = [
  { key: "cableUnitCostPerMeter", label: "Cable supply", unit: "per m" }, { key: "cableInstallationCostPerMeter", label: "Cable installation", unit: "per m" },
  { key: "poleUnitCost", label: "Pole supply", unit: "per pole" }, { key: "poleInstallationCost", label: "Pole installation", unit: "per pole" },
  { key: "oltUnitCost", label: "OLT supply", unit: "per unit" }, { key: "oltInstallationCost", label: "OLT installation", unit: "per unit" },
  { key: "odcUnitCost", label: "ODC supply", unit: "per unit" }, { key: "odcInstallationCost", label: "ODC installation", unit: "per unit" },
  { key: "odpUnitCost", label: "ODP supply", unit: "per unit" }, { key: "odpInstallationCost", label: "ODP installation", unit: "per unit" },
  { key: "ontUnitCost", label: "ONT supply", unit: "per unit" }, { key: "ontInstallationCost", label: "ONT installation", unit: "per unit" },
  { key: "splitterUnitCost", label: "Splitter supply", unit: "per unit" }, { key: "splitterInstallationCost", label: "Splitter installation", unit: "per unit" },
  { key: "routerUnitCost", label: "Router supply", unit: "per unit", optional: true }, { key: "routerInstallationCost", label: "Router installation", unit: "per unit", optional: true },
  { key: "ductUnitCostPerMeter", label: "Underground duct supply", unit: "per m", optional: true },
  { key: "trenchingCostPerMeter", label: "Underground trenching", unit: "per m", optional: true },
  { key: "excavationCostPerMeter", label: "Underground excavation", unit: "per m", optional: true },
  { key: "warningTapeCostPerMeter", label: "Underground warning tape", unit: "per m", optional: true },
  { key: "undergroundInstallationCostPerMeter", label: "Underground installation", unit: "per m", optional: true },
  { key: "buildingAttachmentCostPerMeter", label: "Building-attached installation", unit: "per m", optional: true },
  { key: "otherDeploymentCostPerMeter", label: "Other deployment installation", unit: "per m", optional: true },
];

export function ConstructionCostSettingsPanel({ config, onChange }: Props) {
  const sources = config.rateSources ?? {};
  const updateSource = (key: RateKey, source: "configured" | "legacy_illustrative" | "unknown") => onChange({ ...config, rateSources: { ...sources, [key]: source } });
  return <details className="optical-settings-panel"><summary>RAB rates &amp; provenance</summary>
    <p className="optical-profile-note">Legacy values are illustrative assumptions. Mark a rate configured only after adding its verified project value and reference.</p>
    {rateRows.map(({ key, label, unit, optional }) => {
      const value = config[key]; const source = sources[key] ?? (optional && value == null ? "unknown" : "legacy_illustrative");
      return <div className="optical-setting-row" key={key}><span>{label} <small>{unit}</small></span>
        <input aria-label={`${label} rate`} type="number" min="0" step="0.01" value={source === "unknown" ? "" : value ?? ""} placeholder="Unknown" onChange={(event) => { const raw = event.target.value; if (!raw) { updateSource(key, "unknown"); return; } const amount = Number(raw); if (Number.isFinite(amount) && amount >= 0) onChange({ ...config, [key]: amount, rateSources: { ...sources, [key]: "configured" } }); }} />
        <select aria-label={`${label} rate source`} value={source} onChange={(event) => { const next = event.target.value; if (next === "configured" && value == null) return; if (next === "configured" || next === "legacy_illustrative" || next === "unknown") updateSource(key, next); }}><option value="configured">Configured</option><option value="legacy_illustrative">Legacy illustrative</option><option value="unknown">Unknown</option></select>
        <input aria-label={`${label} price reference`} placeholder="Quote / source reference" value={config.rateReferences?.[key] ?? ""} onChange={(event) => onChange({ ...config, rateReferences: { ...config.rateReferences, [key]: event.target.value } })} />
      </div>;
    })}
    <label className="field-label"><input type="checkbox" aria-label="Require explicit deployment method for cable cost" checked={Boolean(config.requireDeploymentMethodForCableCost)} onChange={(event) => onChange({ ...config, requireDeploymentMethodForCableCost: event.target.checked })} /> Require explicit cable deployment method for complete RAB estimate</label>
    <label className="field-label">Pole existing cost policy<select aria-label="Existing pole cost policy" value={config.poleCostPolicy?.existing ?? "exclude"} onChange={(event) => onChange({ ...config, poleCostPolicy: { existing: event.target.value as NonNullable<ConstructionCostConfig["poleCostPolicy"]>["existing"], proposed: config.poleCostPolicy?.proposed ?? "supply_and_install", shared: config.poleCostPolicy?.shared ?? "exclude", unverified: config.poleCostPolicy?.unverified ?? "incomplete" } })}><option value="exclude">Exclude</option><option value="installation_only">Installation only</option><option value="supply_and_install">Supply and installation</option><option value="incomplete">Mark incomplete</option></select></label>
    <label className="field-label">Pole proposed cost policy<select aria-label="Proposed pole cost policy" value={config.poleCostPolicy?.proposed ?? "supply_and_install"} onChange={(event) => onChange({ ...config, poleCostPolicy: { existing: config.poleCostPolicy?.existing ?? "exclude", proposed: event.target.value as NonNullable<ConstructionCostConfig["poleCostPolicy"]>["proposed"], shared: config.poleCostPolicy?.shared ?? "exclude", unverified: config.poleCostPolicy?.unverified ?? "incomplete" } })}><option value="supply_and_install">Supply and installation</option><option value="installation_only">Installation only</option><option value="exclude">Exclude</option><option value="incomplete">Mark incomplete</option></select></label>
    <label className="field-label">Pole shared cost policy<select aria-label="Shared pole cost policy" value={config.poleCostPolicy?.shared ?? "exclude"} onChange={(event) => onChange({ ...config, poleCostPolicy: { existing: config.poleCostPolicy?.existing ?? "exclude", proposed: config.poleCostPolicy?.proposed ?? "supply_and_install", shared: event.target.value as NonNullable<ConstructionCostConfig["poleCostPolicy"]>["shared"], unverified: config.poleCostPolicy?.unverified ?? "incomplete" } })}><option value="exclude">Exclude</option><option value="installation_only">Installation only</option><option value="supply_and_install">Supply and installation</option><option value="incomplete">Mark incomplete</option></select></label>
    <label className="field-label">Pole unverified cost policy<select aria-label="Unverified pole cost policy" value={config.poleCostPolicy?.unverified ?? "incomplete"} onChange={(event) => onChange({ ...config, poleCostPolicy: { existing: config.poleCostPolicy?.existing ?? "exclude", proposed: config.poleCostPolicy?.proposed ?? "supply_and_install", shared: config.poleCostPolicy?.shared ?? "exclude", unverified: event.target.value as NonNullable<ConstructionCostConfig["poleCostPolicy"]>["unverified"] } })}><option value="incomplete">Mark incomplete</option><option value="exclude">Exclude</option><option value="installation_only">Installation only</option><option value="supply_and_install">Supply and installation</option></select></label>
    <p className="optical-settings-footnote">Existing and shared poles are excluded from new pole procurement by default unless an installation or supply policy is explicitly selected. Unverified pole costs stay incomplete by default. Shared poles are counted once by pole ID.</p>
  </details>;
}
