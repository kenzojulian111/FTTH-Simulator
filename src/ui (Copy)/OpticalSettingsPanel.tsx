import type { OpticalBudgetConfig } from "../domain/types";
import { applyOpticalProfilePreservingConfigured, ILLUSTRATIVE_OPTICAL_CONFIG, LECTURE_OPTICAL_CONFIG, LECTURE_OPTICAL_PROFILE_ID, LECTURE_OPTICAL_PROFILE_NOTE } from "../domain/opticalProfiles";

interface Props { config: OpticalBudgetConfig; onChange: (config: OpticalBudgetConfig) => void }
type NumericKey = "txPowerDbm" | "fiberAttenuationDbPerKm" | "dropFiberAttenuationDbPerKm" | "wavelengthNm" | "connectorLossDb" | "connectorsPerLink" | "spliceLossDb" | "splicesPerLink" | "pigtailSpliceLossDb" | "pigtailSplicesPerLink" | "safetyMarginDb" | "rxSensitivityDbm" | "rxOverloadDbm" | "minMarginDb";

const numericFields: Array<{ key: NumericKey; label: string; unit: string; step?: string }> = [
  { key: "txPowerDbm", label: "OLT transmit power", unit: "dBm", step: "0.1" },
  { key: "fiberAttenuationDbPerKm", label: "Fiber attenuation", unit: "dB/km", step: "0.01" },
  { key: "dropFiberAttenuationDbPerKm", label: "Legacy drop coefficient (not category-applied)", unit: "dB/km", step: "0.01" },
  { key: "wavelengthNm", label: "Wavelength", unit: "nm", step: "1" },
  { key: "connectorLossDb", label: "Connector interface loss", unit: "dB/interface", step: "0.01" },
  { key: "connectorsPerLink", label: "Connector interfaces per cable", unit: "interfaces", step: "1" },
  { key: "spliceLossDb", label: "Fusion splice loss", unit: "dB/splice", step: "0.01" },
  { key: "splicesPerLink", label: "Fusion splices per cable", unit: "splices", step: "1" },
  { key: "pigtailSpliceLossDb", label: "Fiber pigtail splice loss", unit: "dB/splice", step: "0.01" },
  { key: "pigtailSplicesPerLink", label: "Pigtail splices per cable", unit: "splices", step: "1" },
  { key: "safetyMarginDb", label: "Design reserve", unit: "dB", step: "0.1" },
  { key: "rxSensitivityDbm", label: "ONT receiver sensitivity", unit: "dBm", step: "0.1" },
  { key: "rxOverloadDbm", label: "ONT receiver overload", unit: "dBm", step: "0.1" },
  { key: "minMarginDb", label: "Minimum design margin", unit: "dB", step: "0.1" },
];

export function OpticalSettingsPanel({ config, onChange }: Props) {
  const sources = config.parameterSources ?? {};
  const setSource = (key: string, source: "configured" | "profile_default" | "unknown") => onChange({
    ...config,
    parameterSources: { ...sources, [key]: source },
  });
  const setNumber = (key: NumericKey, raw: string) => {
    if (raw.trim() === "") return;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    onChange({ ...config, [key]: value, parameterSources: { ...sources, [key]: "configured" } });
  };
  const sourceControl = (key: string) => <select aria-label={`${key} parameter source`} value={sources[key] ?? "unknown"} onChange={(event) => {
    const source = event.target.value;
    if (source === "configured" || source === "profile_default" || source === "unknown") setSource(key, source);
  }}><option value="configured">Configured</option><option value="profile_default">Illustrative profile</option><option value="unknown">Unknown</option>{sources[key] === "legacy_fallback" && <option value="legacy_fallback">Legacy fallback</option>}</select>;

  return <details className="optical-settings-panel">
    <summary>Optical parameters &amp; provenance</summary>
    <p className="optical-profile-note">Inherited values from an old project remain marked legacy until reviewed. The illustrative GPON profile is a planning assumption, not a manufacturer specification. Cable category does not select attenuation; use the shared fiber coefficient or an explicit physical attenuation value on a cable.</p>
    {config.profileId === LECTURE_OPTICAL_PROFILE_ID && <p className="optical-profile-note" role="note">{config.profileNote ?? LECTURE_OPTICAL_PROFILE_NOTE}</p>}
    <div className="draw-actions">
      <button type="button" className="optical-profile-button" onClick={() => onChange(applyOpticalProfilePreservingConfigured(config, ILLUSTRATIVE_OPTICAL_CONFIG))}>Apply documented illustrative profile</button>
      <button type="button" className="optical-profile-button" onClick={() => onChange(applyOpticalProfilePreservingConfigured(config, LECTURE_OPTICAL_CONFIG))}>Apply lecture reference profile (Materi Kuliah)</button>
    </div>
    <label className="optical-setting-row"><span>Project/operator path standard <small>dB</small></span><input aria-label="Project standard path loss dB" type="number" min="0" step="0.1" value={config.projectStandardLossDb ?? ""} placeholder="Unknown" onChange={(event) => { const raw = event.target.value; onChange({ ...config, projectStandardLossDb: raw === "" ? null : Number(raw) }); }} /></label>
    <label className="optical-setting-row"><span>Standard reference</span><input aria-label="Project standard reference" value={config.projectStandardReference ?? ""} placeholder="Operator or project specification" onChange={(event) => onChange({ ...config, projectStandardReference: event.target.value || null })} /></label>
    <label className="optical-setting-row"><span>Fiber type</span><input aria-label="Fiber type" value={config.fiberType ?? ""} onChange={(event) => onChange({ ...config, fiberType: event.target.value || null, parameterSources: { ...sources, fiberType: event.target.value ? "configured" : "unknown" } })} />{sourceControl("fiberType")}</label>
    {numericFields.map(({ key, label, unit, step }) => <label className="optical-setting-row" key={key}>
      <span>{label} <small>{unit}</small></span>
      <input aria-label={label} type="number" step={step} value={config[key] ?? ""} onChange={(event) => setNumber(key, event.target.value)} />
      {sourceControl(key)}
    </label>)}
    <fieldset className="splitter-loss-settings"><legend>Illustrative / configured splitter loss table · dB</legend>
      {Object.entries(config.splitterLossTable).map(([ratio, loss]) => <label className="optical-setting-row" key={ratio}>
        <span>{ratio}</span><input aria-label={`${ratio} splitter loss dB`} type="number" min="0" step="0.1" value={loss} onChange={(event) => {
          if (event.target.value.trim() === "") return;
          const value = Number(event.target.value);
          if (!Number.isFinite(value) || value < 0) return;
          onChange({ ...config, splitterLossTable: { ...config.splitterLossTable, [ratio]: value }, parameterSources: { ...sources, splitterLossTable: "configured" } });
        }} />{sourceControl("splitterLossTable")}
      </label>)}
    </fieldset>
    <p className="optical-settings-footnote">For each value, choose its actual source. Selecting “Configured” records a project input; do so only after checking equipment or design documentation.</p>
  </details>;
}
