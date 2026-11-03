import { useState } from "react";
import type { ProjectSettings } from "../domain/types";

interface Props { settings: ProjectSettings["poleSpanPlanning"]; onChange: (next: NonNullable<ProjectSettings["poleSpanPlanning"]>) => void }

export function PoleSpanSettingsPanel({ settings, onChange }: Props) {
  const rules = settings?.rules ?? [];
  const defaultMaxSpanM = settings?.defaultMaxSpanM ?? 300;
  const maxOdpToHouseDistanceM = settings?.maxOdpToHouseDistanceM ?? 300;
  const [category, setCategory] = useState("");
  const [maximum, setMaximum] = useState("");
  return <details className="optical-settings-panel"><summary>Pole span rules</summary>
    <p className="optical-profile-note">Rules are project assumptions. Maximum allowed pole span is {defaultMaxSpanM} m and maximum ODP-to-farthest-house distance is {maxOdpToHouseDistanceM} m.</p>
    <button type="button" className="secondary-button" onClick={() => onChange({ ...settings, defaultMaxSpanM: 300, maxOdpToHouseDistanceM: 300, rules: [{ cableCategory: "feeder", maxSpanM: 300, placementPolicy: "uniform_maximum_spacing" }, { cableCategory: "distribution", maxSpanM: 300, placementPolicy: "uniform_maximum_spacing" }, { cableCategory: "drop", maxSpanM: 300, placementPolicy: "uniform_maximum_spacing" }] })}>Apply 300 m standard category rules</button>
    {rules.map((rule) => <div className="connection-row" key={rule.cableCategory}><span>{rule.cableCategory}<small>Maximum interval {rule.maxSpanM} m · {rule.placementPolicy ?? "placement policy unspecified"}</small></span><button aria-label={`Remove ${rule.cableCategory} span rule`} onClick={() => onChange({ ...settings, rules: rules.filter((item) => item.cableCategory !== rule.cableCategory) })}>×</button></div>)}
    <label className="field-label">Cable category<input aria-label="Span cable category" value={category} placeholder="Match cable type" onChange={(event) => setCategory(event.target.value)} /></label>
    <label className="field-label">Maximum span (m, max 300)<input aria-label="Maximum span metres" type="number" min="0.1" max="300" step="0.1" value={maximum} onChange={(event) => setMaximum(event.target.value)} /></label>
    <div className="property-row"><span>Placement policy</span><strong>Uniform maximum spacing</strong></div>
    <button className="secondary-button" disabled={!category.trim() || !maximum || Number(maximum) <= 0 || Number(maximum) > 300} onClick={() => { const maxSpanM = Number(maximum); if (!Number.isFinite(maxSpanM) || maxSpanM <= 0 || maxSpanM > 300) return; onChange({ ...settings, rules: [...rules.filter((rule) => rule.cableCategory !== category.trim()), { cableCategory: category.trim(), maxSpanM, placementPolicy: "uniform_maximum_spacing" }] }); setCategory(""); setMaximum(""); }}>Save interval rule</button>
  </details>;
}
