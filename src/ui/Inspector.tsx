import { useState } from "react";
import type { CableCategory, CableSegment, Customer, DeploymentMethod, FeatureRef, NetworkNode, OpticalBudgetResult, OpticalComponent, PoleSpan, Project, ProjectArea } from "../domain/types";
import { CABLE_CATEGORY_LABELS, DEPLOYMENT_METHOD_LABELS, resolveCableCategory, resolveDeploymentMethod } from "../domain/types";
import { approximateLengthMeters, extractSubspanCoordinates } from "../domain/project";
import { RouterConfigurationPanel } from "./RouterConfigurationPanel";
import type { RouterConfiguration } from "../domain/types";
import { readRouterConfiguration } from "../domain/routerConfig";
import { cableCategoryWarning, recommendCableCategory } from "../domain/cableClassification";
import { OpticalCalculationTable } from "./OpticalCalculationTable";

interface Props { project: Project; selection: FeatureRef | null; opticalResult?: OpticalBudgetResult | null; onAreaChange?: (area: ProjectArea) => void; onRename: (ref: FeatureRef, name: string) => void; onCustomerAddress: (id: string, address: string) => void; onCustomerOnt: (id: string, ontNodeId: string | null) => void; onCustomerStatus: (id: string, status: "planned" | "connected" | "on_hold") => void; onCableAttributes: (id: string, cableType: string, fiberCount: number | null, properties?: CableSegment["properties"]) => void; onRouterConfiguration: (id: string, configuration: RouterConfiguration) => void; onPoleProperties?: (id: string, properties: NetworkNode["properties"]) => void; onOpticalComponentsChange?: (components: OpticalComponent[]) => void; onAddPoleSpan?: (span: PoleSpan) => void; onDeletePoleSpan?: (id: string) => void; onPoleSpanStatus?: (id: string, status: PoleSpan["status"]) => void; onSplitterOpticalConfig?: (id: string, ratio: string | null, insertionLossDb: number | null) => void; onInvalidFiberCount: () => void; onDelete: () => void }

type SelectedItem =
  | { kind: "node"; item: NetworkNode }
  | { kind: "customer"; item: Customer }
  | { kind: "cable"; item: CableSegment };

export function Inspector({ project, selection, opticalResult, onRename, onCustomerAddress, onCustomerOnt, onCustomerStatus, onCableAttributes, onRouterConfiguration, onPoleProperties, onOpticalComponentsChange, onAddPoleSpan, onDeletePoleSpan, onPoleSpanStatus, onSplitterOpticalConfig, onInvalidFiberCount, onDelete, onAreaChange }: Props) {
  const [spanFrom, setSpanFrom] = useState("");
  const [spanTo, setSpanTo] = useState("");
  if (selection?.kind === "area") {
    const area = (project.areas ?? []).find((item) => item.id === selection.id);
    if (!area) return null;
    const patchArea = (patch: Partial<ProjectArea>) => onAreaChange?.({ ...area, ...patch });
    return <section className="inspector"><div className="section-heading"><span>PROJECT AREA</span><button className="icon-button danger" onClick={onDelete} aria-label="Delete selected area">⌫</button></div><label className="field-label">Name<input value={area.name} onChange={(event) => patchArea({ name: event.target.value })} /></label><label className="field-label">Classification<select value={area.classification ?? "custom"} onChange={(event) => patchArea({ classification: event.target.value as ProjectArea["classification"] })}><option value="project_boundary">Project boundary</option><option value="service_area">Service area</option><option value="residential_block">Residential block</option><option value="custom">Custom</option></select></label><label className="field-label">Fill color<input type="color" value={area.fillColor} onChange={(event) => patchArea({ fillColor: event.target.value })} /></label><label className="field-label">Fill opacity<input type="number" min="0" max="1" step="0.05" value={area.fillOpacity} onChange={(event) => patchArea({ fillOpacity: Number(event.target.value) })} /></label><label className="field-label">Description<textarea value={area.description ?? ""} onChange={(event) => patchArea({ description: event.target.value })} /></label><p className="hint">Geographic annotation only; no serviceability is inferred.</p></section>;
  }
  if (!selection) return <section className="inspector empty-inspector"><div className="inspector-icon">⌖</div><h3>Nothing selected</h3><p>Select an object on the map to inspect its properties.</p></section>;
  let selected: SelectedItem | undefined;
  if (selection.kind === "node") {
    const node = project.nodes.find((x) => x.id === selection.id);
    if (node) selected = { kind: "node", item: node };
  } else if (selection.kind === "customer") {
    const customer = project.customers.find((x) => x.id === selection.id);
    if (customer) selected = { kind: "customer", item: customer };
  } else {
    const cable = project.cableSegments.find((x) => x.id === selection.id);
    if (cable) selected = { kind: "cable", item: cable };
  }
  if (!selected) return null;
  const item = selected.item;
  const location = selected.kind === "cable" ? null : selected.item.location.coordinates;
  const lengthM = selected.kind === "cable" ? selected.item.lengthM : null;
  const selectedConnectionIds = selected.kind === "cable" ? project.connections.filter((connection) => connection.cableSegmentId === selected.item.id).map((connection) => connection.id) : [];
  const opticalComponents = (project.opticalComponents ?? []).filter((component) => selected.kind === "node" ? component.nodeId === selected.item.id : selected.kind === "cable" ? Boolean(component.connectionId && selectedConnectionIds.includes(component.connectionId)) : false);
  const updateOpticalComponent = (id: string, patch: Partial<OpticalComponent>) => onOpticalComponentsChange?.((project.opticalComponents ?? []).map((component) => component.id === id ? { ...component, ...patch } : component));
  return <section className="inspector">
    <div className="section-heading"><span>SELECTED OBJECT</span><button className="icon-button danger" onClick={onDelete} aria-label="Delete selected object">⌫</button></div>
    <label className="field-label">Name<input value={item.name} onChange={(event) => onRename(selection, event.target.value)} /></label>
    <div className="property-row"><span>Type</span><strong>{selected.kind === "node" ? selected.item.type.toUpperCase() : selected.kind === "customer" ? "Customer" : selected.item.cableType || "Cable"}</strong></div>
    {selected.kind === "node" && (selected.item.type === "odc" || selected.item.type === "odp") && (() => {
      const intermediate = opticalResult?.intermediateNodes?.find((entry) => entry.nodeId === selected.item.id);
      const display = (value: number | null | undefined, unit: string) => value == null || !Number.isFinite(value) ? "Unknown" : `${value.toFixed(2)} ${unit}`;
      return <section className="splitter-config-panel" aria-label="Intermediate optical analysis">
        <div className="section-heading"><span>ESTIMATED PASSIVE-NODE POWER</span></div>
        {!opticalResult ? <p className="hint">Run Optical Analysis to calculate the directed OLT path.</p> : !intermediate ? <p className="hint">No intermediate result was returned for this node.</p> : <>
          <p className="hint">Estimated optical power at passive {selected.item.type.toUpperCase()} · not measured receiver power.</p>
          <div className="property-row"><span>Status</span><strong>{intermediate.status}</strong></div>
          <div className="property-row"><span>Path length</span><strong>{display(intermediate.lengthM, "m")}</strong></div>
          <div className="property-row"><span>Originating OLT</span><strong>{intermediate.sourceOltName ?? intermediate.sourceOltId ?? "Unknown"}{intermediate.transmitterPowerDbm == null ? " · launch power unknown" : ` · ${display(intermediate.transmitterPowerDbm, "dBm")}`}</strong></div>
          <div className="property-row"><span>Accumulated loss</span><strong>{display(intermediate.accumulatedLossDb, "dB")}</strong></div>
          <div className="property-row"><span>Estimated optical power</span><strong>{display(intermediate.estimatedPowerDbm, "dBm")}</strong></div>
          <p className="hint">Loss entries show individual component loss and cumulative physical loss from the OLT. Safety margin is separate and is not subtracted from this estimated power.</p>
          <OpticalCalculationTable rows={intermediate.lossBreakdown ?? []} categoryLossesDb={intermediate.categoryLossesDb}
            physicalLossDb={intermediate.accumulatedLossDb} designMarginDb={intermediate.designMarginDb}
            totalDesignAllowanceDb={intermediate.totalDesignAllowanceDb} powerLabel="Estimated optical power at passive node"
            powerDbm={intermediate.estimatedPowerDbm} profileId={intermediate.profileId} parameterSources={intermediate.parameterSources} />
          {Object.entries(intermediate.parameterSources ?? {}).length > 0 && <p className="hint">Input provenance: {Object.entries(intermediate.parameterSources ?? {}).map(([key, source]) => `${key} (${source.replace(/_/g, " ")})`).join(" · ")}</p>}
          {intermediate.diagnostics?.map((message, index) => <p className="hint" role="status" key={index}>{message}</p>)}
        </>}
      </section>;
    })()}
    {selected.kind === "node" && selected.item.type === "ont" && (() => {
      const path = opticalResult?.paths.find((entry) => entry.ontNodeId === selected.item.id);
      if (!path) return null;
      const details = path.details ?? {};
      const safetyMargin = typeof details.safetyMarginDb === "number" ? details.safetyMarginDb : path.designMarginDb;
      const designAllowance = typeof details.totalLossDb === "number" ? details.totalLossDb : path.totalDesignAllowanceDb;
      return <OpticalCalculationTable rows={path.lossBreakdown ?? []} categoryLossesDb={path.categoryLossesDb}
        physicalLossDb={path.lossDb} designMarginDb={safetyMargin} totalDesignAllowanceDb={designAllowance}
        powerLabel="Received optical power" powerDbm={path.receivedPowerDbm} profileId={path.profileId} parameterSources={path.parameterSources} />;
    })()}
    {location && <div className="property-row"><span>Coordinates</span><strong>{item.properties.geographicPositionSet === false ? "Place on map" : `${location[1].toFixed(5)}, ${location[0].toFixed(5)}`}</strong></div>}
    {selected.kind === "cable" && <><div className="property-row"><span>Endpoints</span><strong>{(() => { const connection = project.connections.find((entry) => entry.cableSegmentId === selected.item.id); const startId = connection?.fromNodeId ?? selected.item.startNodeId; const endId = connection?.toNodeId ?? selected.item.endNodeId; return `${project.nodes.find((node) => node.id === startId)?.name ?? "Unassigned"} → ${project.nodes.find((node) => node.id === endId)?.name ?? "Unassigned"}`; })()}</strong></div><div className="property-row"><span>Fiber cores</span><strong>{selected.item.fiberCount ?? "Unspecified"}</strong></div><div className="property-row"><span>Vertices</span><strong>{selected.item.geometry.coordinates.length}</strong></div><div className="property-row"><span>Calculated length</span><strong>{lengthM === null ? "Not calculated" : `${lengthM.toLocaleString()} m`}</strong></div><p className="hint">Drag the white handles to edit route geometry.</p></>}
    {selected.kind === "cable" && <><label className="field-label address-field">Cable category<select aria-label="Cable category" value={resolveCableCategory(selected.item) ?? ""} onChange={(event) => { const cat = event.target.value as CableCategory | ""; const nextType = cat && (!selected.item.cableType || ["feeder", "distribution", "drop", "indoor", "custom"].includes(selected.item.cableType.toLowerCase())) ? cat : selected.item.cableType; onCableAttributes(selection.id, nextType, selected.item.fiberCount, { cableCategory: cat || null, cableCategorySource: cat ? "manual" : "automatic" }); }}><option value="">Unspecified</option>{(Object.keys(CABLE_CATEGORY_LABELS) as CableCategory[]).map((cat) => <option key={cat} value={cat}>{CABLE_CATEGORY_LABELS[cat]}</option>)}</select></label><p className="hint">Recommendation: <strong>{recommendCableCategory(project, selected.item).category}</strong> · {recommendCableCategory(project, selected.item).explanation}</p><button className="secondary-button" onClick={() => { const cat = recommendCableCategory(project, selected.item).category; onCableAttributes(selection.id, selected.item.cableType, selected.item.fiberCount, { cableCategory: cat, cableCategorySource: "automatic" }); }}>Use recommendation</button>{cableCategoryWarning(project, selected.item) && <p role="status" className="hint">{cableCategoryWarning(project, selected.item)}</p>}<label className="field-label address-field">Deployment method<select aria-label="Deployment method" value={resolveDeploymentMethod(selected.item)} onChange={(event) => { const method = event.target.value as DeploymentMethod; onCableAttributes(selection.id, selected.item.cableType, selected.item.fiberCount, { deploymentMethod: method }); }}>{(["unspecified", "aerial", "underground", "building_attached", "other"] as DeploymentMethod[]).map((method) => <option key={method} value={method}>{DEPLOYMENT_METHOD_LABELS[method]}</option>)}</select></label><label className="field-label address-field">Cable type<input value={selected.item.cableType} placeholder="e.g. Aerial SM G.652.D" onChange={(event) => onCableAttributes(selection.id, event.target.value, selected.item.fiberCount)} /></label><label className="field-label address-field">Fiber count<input type="number" min="1" step="1" value={selected.item.fiberCount ?? ""} placeholder="Not specified" onChange={(event) => { const raw = event.target.value; const count = raw === "" ? null : Number(raw); if (count === null || (Number.isInteger(count) && count > 0)) onCableAttributes(selection.id, selected.item.cableType, count); else onInvalidFiberCount(); }} /></label><label className="field-label address-field">Pigtail splices<input aria-label="Cable pigtail splices" type="number" min="0" step="1" value={typeof selected.item.properties.pigtailSplicesCount === "number" ? selected.item.properties.pigtailSplicesCount : ""} placeholder="Default (0)" onChange={(event) => { const raw = event.target.value; const count = raw === "" ? null : Number(raw); if (count === null || (Number.isInteger(count) && count >= 0)) onCableAttributes(selection.id, selected.item.cableType, selected.item.fiberCount, { pigtailSplicesCount: count }); }} /></label></>}
    {selected.kind === "cable" && (() => {
      const deploymentMethod = resolveDeploymentMethod(selected.item);
      const cableSpans = (project.poleSpans ?? []).filter((span) => span.cableSegmentId === selected.item.id);
      const isNonAerial = deploymentMethod === "underground" || deploymentMethod === "building_attached" || deploymentMethod === "other";
      return <section className="splitter-config-panel"><div className="section-heading"><span>POLE SPAN LINKS</span></div>
        {isNonAerial ? (
          <p className="hint" role="note">Deployment method is set to {DEPLOYMENT_METHOD_LABELS[deploymentMethod]}. Poles and pole-span constraints are not required for this cable.{cableSpans.length > 0 ? " Existing linked pole spans are preserved below." : ""}</p>
        ) : (
          <>
            <p className="hint">Add an explicit link between poles (optional). When a cable has multiple spans, each sub-span length is resolved from matching route vertices or reported as Unknown.</p>
            <label className="field-label">Start pole<select aria-label="Span start pole" value={spanFrom} onChange={(event) => setSpanFrom(event.target.value)}><option value="">Select pole</option>{project.nodes.filter((node) => node.type === "pole").map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
            <label className="field-label">End pole<select aria-label="Span end pole" value={spanTo} onChange={(event) => setSpanTo(event.target.value)}><option value="">Select pole</option>{project.nodes.filter((node) => node.type === "pole").map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
            <button className="secondary-button" disabled={!onAddPoleSpan || !spanFrom || !spanTo || spanFrom === spanTo} onClick={() => {
              if (selected.kind !== "cable" || !spanFrom || !spanTo || spanFrom === spanTo) return;
              const cable = selected.item;
              const existingSpansForCable = (project.poleSpans ?? []).filter((s) => s.cableSegmentId === cable.id);
              const fromPole = project.nodes.find((n) => n.id === spanFrom);
              const toPole = project.nodes.find((n) => n.id === spanTo);
              const subCoords = extractSubspanCoordinates(cable.geometry.coordinates, fromPole, toPole);
              const coversEntire = existingSpansForCable.length === 0 && subCoords !== null && subCoords.length === cable.geometry.coordinates.length;
              const resolvedLengthM = subCoords ? Number(approximateLengthMeters(subCoords).toFixed(2)) : (existingSpansForCable.length === 0 ? cable.lengthM : null);
              const shouldCoverEntire = existingSpansForCable.length === 0 && (coversEntire || subCoords === null);
              onAddPoleSpan?.({
                id: crypto.randomUUID(),
                cableSegmentId: cable.id,
                fromPoleId: spanFrom,
                toPoleId: spanTo,
                geometry: subCoords && !shouldCoverEntire ? { type: "LineString", coordinates: subCoords } : null,
                coversEntireCableRoute: shouldCoverEntire,
                status: "unverified",
                notes: "",
                lengthM: resolvedLengthM,
                lengthSource: resolvedLengthM === null ? "unknown" : "geometry",
              });
              setSpanFrom("");
              setSpanTo("");
            }}>Link poles to this route</button>
          </>
        )}
        {cableSpans.map((span) => <div className="connection-row" key={span.id}><span>{project.nodes.find((node) => node.id === span.fromPoleId)?.name ?? "Missing pole"} → {project.nodes.find((node) => node.id === span.toPoleId)?.name ?? "Missing pole"}<small>{span.lengthM == null ? "Unknown" : `${span.lengthM.toLocaleString()} m`}</small><select aria-label={`Span ${span.id} verification status`} value={span.status} onChange={(event) => { const status = event.target.value; if (["existing", "proposed", "shared", "unverified"].includes(status)) onPoleSpanStatus?.(span.id, status as PoleSpan["status"]); }}><option value="unverified">Unverified</option><option value="existing">Existing</option><option value="proposed">Proposed</option><option value="shared">Shared</option></select></span><button aria-label={`Remove pole span ${span.id}`} onClick={() => onDeletePoleSpan?.(span.id)}>×</button></div>)}
      </section>;
    })()}
    {selected.kind === "customer" && <label className="field-label address-field">Status<select value={selected.item.status} onChange={(event) => { const status = event.target.value; if (status === "planned" || status === "connected" || status === "on_hold") onCustomerStatus(selection.id, status); }}><option value="planned">Planned</option><option value="connected">Connected</option><option value="on_hold">On hold</option></select></label>}
    {selected.kind === "customer" && <label className="field-label address-field">Address<input value={selected.item.address} placeholder="Add service address" onChange={(event) => onCustomerAddress(selection.id, event.target.value)} /></label>}
    {selected.kind === "customer" && <label className="field-label address-field">Associated ONT<select value={selected.item.ontNodeId ?? ""} onChange={(event) => onCustomerOnt(selection.id, event.target.value || null)}><option value="">No ONT assigned</option>{project.nodes.filter((node) => node.type === "ont").map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>}
    {selected.kind === "node" && selected.item.type === "router" && <RouterConfigurationPanel configuration={readRouterConfiguration(selected.item.properties.routerConfiguration)} onChange={(configuration) => onRouterConfiguration(selected.item.id, configuration)} />}
    {selected.kind === "node" && selected.item.type === "pole" && <section className="splitter-config-panel">
      <div className="section-heading"><span>POLE INFRASTRUCTURE</span></div>
      <label className="field-label">Pole type<input aria-label="Pole type" value={String(selected.item.properties.poleType ?? "")} placeholder="Unknown" onChange={(event) => onPoleProperties?.(selected.item.id, { poleType: event.target.value || null })} /></label>
      <label className="field-label">Material<input aria-label="Pole material" value={String(selected.item.properties.material ?? "")} placeholder="Unknown" onChange={(event) => onPoleProperties?.(selected.item.id, { material: event.target.value || null })} /></label>
      <label className="field-label">Height (m)<input aria-label="Pole height metres" type="number" min="0" step="0.1" value={typeof selected.item.properties.heightM === "number" ? selected.item.properties.heightM : ""} placeholder="Unknown" onChange={(event) => { const value = event.target.value; onPoleProperties?.(selected.item.id, { heightM: value === "" ? null : Number(value) }); }} /></label>
      <label className="field-label">Status<select aria-label="Pole status" value={String(selected.item.properties.status ?? "unverified")} onChange={(event) => onPoleProperties?.(selected.item.id, { status: event.target.value })}><option value="unverified">Unverified</option><option value="existing">Existing</option><option value="proposed">Proposed</option><option value="shared">Shared</option></select></label>
      <label className="field-label">Notes<textarea aria-label="Pole notes" value={String(selected.item.properties.notes ?? "")} placeholder="Optional notes" onChange={(event) => onPoleProperties?.(selected.item.id, { notes: event.target.value || null })} /></label>
      <p className="hint">Pole specifications remain unknown until entered. Pole status does not create an optical topology connection.</p>
    </section>}
    {selected.kind === "node" && (selected.item.type === "splitter" || selected.item.properties.splitterRatio !== undefined || selected.item.properties.splitterLossDb !== undefined) && <section className="splitter-config-panel">
      <div className="section-heading"><span>SPLITTER OPTICAL DATA</span></div>
      <label className="field-label">Physical ratio<select aria-label="Splitter ratio" value={typeof selected.item.properties.splitterRatio === "string" ? selected.item.properties.splitterRatio : ""} onChange={(event) => onSplitterOpticalConfig?.(selected.item.id, event.target.value || null, typeof selected.item.properties.splitterLossDb === "number" ? selected.item.properties.splitterLossDb : null)}><option value="">Unknown / unconfigured</option>{Object.keys(project.settings.opticalBudget.splitterLossTable).map((ratio) => <option value={ratio} key={ratio}>{ratio}</option>)}</select></label>
      <label className="field-label address-field">Actual insertion loss<input aria-label="Actual splitter insertion loss dB" type="number" min="0" step="0.1" value={typeof selected.item.properties.splitterLossDb === "number" ? selected.item.properties.splitterLossDb : ""} placeholder="Unknown · enter from equipment data" onChange={(event) => { const raw = event.target.value; if (raw.trim() === "") onSplitterOpticalConfig?.(selected.item.id, typeof selected.item.properties.splitterRatio === "string" ? selected.item.properties.splitterRatio : null, null); else { const loss = Number(raw); if (Number.isFinite(loss) && loss >= 0) onSplitterOpticalConfig?.(selected.item.id, typeof selected.item.properties.splitterRatio === "string" ? selected.item.properties.splitterRatio : null, loss); } }} /></label>
      <p className="hint">Use the actual device loss from its documentation. Theoretical 1:N split loss is informational and is not substituted.</p>
    </section>}
    {(selected.kind === "node" || selected.kind === "cable") && <details className="optical-settings-panel"><summary>Physical optical components &amp; provenance</summary>
      <p className="optical-profile-note">Configured loss drives the calculation. Datasheet and field values remain separate references. Missing configured values stay unknown.</p>
      {opticalComponents.map((component) => <section className="splitter-config-panel" key={component.id}>
        <strong>{component.kind} · {component.id}</strong>
        <button className="icon-button danger" aria-label={`Remove optical component ${component.id}`} onClick={() => onOpticalComponentsChange?.((project.opticalComponents ?? []).filter((item) => item.id !== component.id))}>Remove component</button>
        <label className="field-label">Component kind<input aria-label={`${component.id} kind`} value={component.kind} onChange={(event) => updateOpticalComponent(component.id, { kind: event.target.value })} /></label>
        <label className="field-label">Configured loss (dB)<input aria-label={`${component.id} configured loss`} type="number" min="0" step="0.01" value={component.configuredLossDb ?? ""} placeholder="Unknown" onChange={(event) => { const raw = event.target.value; updateOpticalComponent(component.id, { configuredLossDb: raw === "" ? null : Number(raw), configuredSource: raw === "" ? "unknown" : "configured" }); }} /></label>
        <label className="field-label">Location<input aria-label={`${component.id} location`} value={component.location ?? ""} placeholder="Unknown location" onChange={(event) => updateOpticalComponent(component.id, { location: event.target.value || null })} /></label>
        <label className="field-label">Datasheet loss (dB)<input aria-label={`${component.id} datasheet loss`} type="number" min="0" step="0.01" value={component.datasheetLossDb ?? ""} onChange={(event) => updateOpticalComponent(component.id, { datasheetLossDb: event.target.value === "" ? null : Number(event.target.value) })} /></label>
        <label className="field-label">Datasheet reference<input aria-label={`${component.id} datasheet reference`} value={component.datasheetReference ?? ""} onChange={(event) => updateOpticalComponent(component.id, { datasheetReference: event.target.value || null })} /></label>
        <label className="field-label">Datasheet model<input aria-label={`${component.id} datasheet model`} value={component.datasheetModel ?? ""} onChange={(event) => updateOpticalComponent(component.id, { datasheetModel: event.target.value || null })} /></label>
        <label className="field-label">Measured loss (dB)<input aria-label={`${component.id} measured loss`} type="number" min="0" step="0.01" value={component.measuredLossDb ?? ""} onChange={(event) => updateOpticalComponent(component.id, { measuredLossDb: event.target.value === "" ? null : Number(event.target.value) })} /></label>
        <label className="field-label">Measurement date<input aria-label={`${component.id} measurement date`} type="datetime-local" value={component.measuredAt?.slice(0, 16) ?? ""} onChange={(event) => updateOpticalComponent(component.id, { measuredAt: event.target.value ? new Date(event.target.value).toISOString() : null })} /></label>
        <label className="field-label">Measurement method<input aria-label={`${component.id} measurement method`} value={component.measurementMethod ?? ""} onChange={(event) => updateOpticalComponent(component.id, { measurementMethod: event.target.value || null })} /></label>
        <label className="field-label">Measurement reference<input aria-label={`${component.id} measurement reference`} value={component.measurementReference ?? ""} onChange={(event) => updateOpticalComponent(component.id, { measurementReference: event.target.value || null })} /></label>
        <label className="field-label">Procurement quantity<input aria-label={`${component.id} procurement quantity`} type="number" min="0" step="0.01" value={component.procurementQuantity ?? ""} onChange={(event) => updateOpticalComponent(component.id, { procurementQuantity: event.target.value === "" ? null : Number(event.target.value) })} /></label>
        <label className="field-label">Procurement unit<input aria-label={`${component.id} procurement unit`} value={component.procurementUnit ?? ""} placeholder="unit / pair / splice" onChange={(event) => updateOpticalComponent(component.id, { procurementUnit: event.target.value || null })} /></label>
        <label className="field-label">Material unit rate<input aria-label={`${component.id} material unit rate`} type="number" min="0" step="0.01" value={component.materialUnitCost ?? ""} onChange={(event) => updateOpticalComponent(component.id, { materialUnitCost: event.target.value === "" ? null : Number(event.target.value), priceSource: event.target.value ? "configured" : "unknown" })} /></label>
        <label className="field-label">Installation unit rate<input aria-label={`${component.id} installation unit rate`} type="number" min="0" step="0.01" value={component.installationUnitCost ?? ""} onChange={(event) => updateOpticalComponent(component.id, { installationUnitCost: event.target.value === "" ? null : Number(event.target.value), priceSource: event.target.value ? "configured" : "unknown" })} /></label>
        <label className="field-label">Price reference<input aria-label={`${component.id} price reference`} value={component.priceReference ?? ""} onChange={(event) => updateOpticalComponent(component.id, { priceReference: event.target.value || null })} /></label>
      </section>)}
      <button className="secondary-button" disabled={!onOpticalComponentsChange || (selected.kind === "cable" && !selectedConnectionIds.length)} onClick={() => {
        const component: OpticalComponent = { id: crypto.randomUUID(), kind: "other", ...(selected.kind === "node" ? { nodeId: selected.item.id } : { connectionId: selectedConnectionIds[0] }), location: null, configuredLossDb: null, configuredSource: "unknown" };
        onOpticalComponentsChange?.([...(project.opticalComponents ?? []), component]);
      }}>Add optical component</button>
    </details>}
    {Object.entries(item.properties).filter(([key]) => key !== "routerConfiguration").map(([key, value]) => <div className="property-row" key={key}><span>{key}</span><strong>{value === null ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value)}</strong></div>)}
  </section>;
}
