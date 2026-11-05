import { useState } from "react";
import type {
  CableCategory,
  CableSegment,
  Customer,
  DeploymentMethod,
  FeatureRef,
  NetworkNode,
  OpticalBudgetConfig,
  OpticalBudgetResult,
  OpticalComponent,
  PoleSpan,
  Project,
  ProjectArea,
  RouterConfiguration,
} from "../domain/types";
import { CABLE_CATEGORY_LABELS, DEPLOYMENT_METHOD_LABELS, resolveCableCategory, resolveDeploymentMethod } from "../domain/types";
import { approximateLengthMeters, extractSubspanCoordinates } from "../domain/project";
import { RouterConfigurationPanel } from "./RouterConfigurationPanel";
import { readRouterConfiguration } from "../domain/routerConfig";
import { cableCategoryWarning, recommendCableCategory } from "../domain/cableClassification";
import { OLTInspector } from "./inspectors/OLTInspector";
import { ODCInspector } from "./inspectors/ODCInspector";
import { ODPInspector } from "./inspectors/ODPInspector";
import { SplitterInspector } from "./inspectors/SplitterInspector";
import { ONTInspector } from "./inspectors/ONTInspector";
import { PoleInspector } from "./inspectors/PoleInspector";
import { CustomerInspector } from "./inspectors/CustomerInspector";
import {
  AdvancedProvenanceDetails,
  ConnectedDevicesList,
  InspectorSection,
  PhysicalOpticalComponentsPanel,
  ProjectOpticalBudgetParametersDetails,
} from "./inspectors/InspectorShared";

interface Props {
  project: Project;
  selection: FeatureRef | null;
  opticalResult?: OpticalBudgetResult | null;
  onAreaChange?: (area: ProjectArea) => void;
  onRename: (ref: FeatureRef, name: string) => void;
  onSelect?: (ref: FeatureRef) => void;
  onCustomerAddress: (id: string, address: string) => void;
  onCustomerOnt: (id: string, ontNodeId: string | null) => void;
  onCustomerStatus: (id: string, status: "planned" | "connected" | "on_hold") => void;
  onCableAttributes: (id: string, cableType: string, fiberCount: number | null, properties?: CableSegment["properties"]) => void;
  onRouterConfiguration: (id: string, configuration: RouterConfiguration) => void;
  onPoleProperties?: (id: string, properties: NetworkNode["properties"]) => void;
  onOpticalComponentsChange?: (components: OpticalComponent[]) => void;
  onAddPoleSpan?: (span: PoleSpan) => void;
  onDeletePoleSpan?: (id: string) => void;
  onPoleSpanStatus?: (id: string, status: PoleSpan["status"]) => void;
  onSplitterOpticalConfig?: (id: string, ratio: string | null, insertionLossDb: number | null) => void;
  onInvalidFiberCount: () => void;
  onDelete: () => void;
  onNodeProperties?: (id: string, properties: Partial<NetworkNode["properties"]>) => void;
  onAddInternalSplitter?: (hostNodeId: string, splitter: NetworkNode) => void;
  onRemoveInternalSplitter?: (splitterId: string) => void;
  onDisconnectConnection?: (connectionId: string) => void;
  onRecalculate?: () => void;
  onOpticalBudgetConfig?: (config: OpticalBudgetConfig) => void;
}

type SelectedItem =
  | { kind: "node"; item: NetworkNode }
  | { kind: "customer"; item: Customer }
  | { kind: "cable"; item: CableSegment };

export function Inspector({
  project,
  selection,
  opticalResult,
  onRename,
  onSelect,
  onCustomerAddress,
  onCustomerOnt,
  onCustomerStatus,
  onCableAttributes,
  onRouterConfiguration,
  onPoleProperties,
  onOpticalComponentsChange,
  onAddPoleSpan,
  onDeletePoleSpan,
  onPoleSpanStatus,
  onSplitterOpticalConfig,
  onInvalidFiberCount,
  onDelete,
  onAreaChange,
  onNodeProperties,
  onAddInternalSplitter,
  onRemoveInternalSplitter,
  onDisconnectConnection,
  onRecalculate,
  onOpticalBudgetConfig,
}: Props) {
  const [spanFrom, setSpanFrom] = useState("");
  const [spanTo, setSpanTo] = useState("");

  if (selection?.kind === "area") {
    const area = (project.areas ?? []).find((item) => item.id === selection.id);
    if (!area) return null;
    const patchArea = (patch: Partial<ProjectArea>) => onAreaChange?.({ ...area, ...patch });
    return (
      <section className="inspector inspector-fade-in" key={`area-${area.id}`}>
        <div className="section-heading">
          <span>PROJECT AREA</span>
          <button className="icon-button danger" onClick={onDelete} aria-label="Delete selected area">⌫</button>
        </div>
        <label className="field-label">Name<input value={area.name} onChange={(event) => patchArea({ name: event.target.value })} /></label>
        <label className="field-label">Classification
          <select value={area.classification ?? "custom"} onChange={(event) => patchArea({ classification: event.target.value as ProjectArea["classification"] })}>
            <option value="project_boundary">Project boundary</option>
            <option value="service_area">Service area</option>
            <option value="residential_block">Residential block</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label className="field-label">Fill color<input type="color" value={area.fillColor} onChange={(event) => patchArea({ fillColor: event.target.value })} /></label>
        <label className="field-label">Fill opacity<input type="number" min="0" max="1" step="0.05" value={area.fillOpacity} onChange={(event) => patchArea({ fillOpacity: Number(event.target.value) })} /></label>
        <label className="field-label">Description<textarea value={area.description ?? ""} onChange={(event) => patchArea({ description: event.target.value })} /></label>
        <p className="hint">Geographic annotation only; no serviceability is inferred.</p>
      </section>
    );
  }

  if (!selection) {
    return (
      <section className="inspector empty-inspector inspector-fade-in">
        <div className="inspector-icon">⌖</div>
        <h3>Nothing selected</h3>
        <p>Select an object on the map or logical canvas to inspect its contextual configuration.</p>
      </section>
    );
  }

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

  const nodesById = Object.fromEntries(project.nodes.map((n) => [n.id, n]));

  return (
    <section className="inspector inspector-fade-in" key={`${selected.kind}-${selected.item.id}`}>
      <div className="section-heading">
        <span>SELECTED OBJECT · {selected.kind === "node" ? selected.item.type.toUpperCase() : selected.kind.toUpperCase()}</span>
        <button className="icon-button danger" onClick={onDelete} aria-label="Delete selected object">⌫</button>
      </div>

      {/* DYNAMIC NODE-TYPE INSPECTORS */}
      {selected.kind === "node" && selected.item.type === "olt" && (
        <OLTInspector
          node={selected.item}
          project={project}
          nodesById={nodesById}
          onRename={onRename}
          onNodeProperties={onNodeProperties}
          onDisconnectConnection={onDisconnectConnection}
          onOpticalComponentsChange={onOpticalComponentsChange}
          onRecalculate={onRecalculate}
          onOpticalBudgetConfig={onOpticalBudgetConfig}
        />
      )}

      {selected.kind === "node" && selected.item.type === "odc" && (
        <ODCInspector
          node={selected.item}
          project={project}
          nodesById={nodesById}
          opticalResult={opticalResult}
          onRename={onRename}
          onSelect={onSelect}
          onNodeProperties={onNodeProperties}
          onAddInternalSplitter={onAddInternalSplitter}
          onRemoveInternalSplitter={onRemoveInternalSplitter}
          onDisconnectConnection={onDisconnectConnection}
          onOpticalComponentsChange={onOpticalComponentsChange}
          onRecalculate={onRecalculate}
          onOpticalBudgetConfig={onOpticalBudgetConfig}
        />
      )}

      {selected.kind === "node" && selected.item.type === "odp" && (
        <ODPInspector
          node={selected.item}
          project={project}
          nodesById={nodesById}
          opticalResult={opticalResult}
          onRename={onRename}
          onSelect={onSelect}
          onNodeProperties={onNodeProperties}
          onAddInternalSplitter={onAddInternalSplitter}
          onRemoveInternalSplitter={onRemoveInternalSplitter}
          onDisconnectConnection={onDisconnectConnection}
          onOpticalComponentsChange={onOpticalComponentsChange}
          onRecalculate={onRecalculate}
          onOpticalBudgetConfig={onOpticalBudgetConfig}
        />
      )}

      {selected.kind === "node" && selected.item.type === "splitter" && (
        <SplitterInspector
          node={selected.item}
          project={project}
          nodesById={nodesById}
          onRename={onRename}
          onNodeProperties={onNodeProperties}
          onSplitterOpticalConfig={onSplitterOpticalConfig}
          onDisconnectConnection={onDisconnectConnection}
          onOpticalComponentsChange={onOpticalComponentsChange}
          onRecalculate={onRecalculate}
          onOpticalBudgetConfig={onOpticalBudgetConfig}
        />
      )}

      {selected.kind === "node" && selected.item.type === "ont" && (
        <ONTInspector
          node={selected.item}
          project={project}
          nodesById={nodesById}
          opticalResult={opticalResult}
          onRename={onRename}
          onNodeProperties={onNodeProperties}
          onDisconnectConnection={onDisconnectConnection}
          onOpticalComponentsChange={onOpticalComponentsChange}
          onRecalculate={onRecalculate}
          onOpticalBudgetConfig={onOpticalBudgetConfig}
        />
      )}

      {selected.kind === "node" && selected.item.type === "pole" && (
        <PoleInspector
          node={selected.item}
          project={project}
          nodesById={nodesById}
          onRename={onRename}
          onSelect={onSelect}
          onPoleProperties={onPoleProperties}
          onDeletePoleSpan={onDeletePoleSpan}
          onPoleSpanStatus={onPoleSpanStatus}
          onDisconnectConnection={onDisconnectConnection}
        />
      )}

      {selected.kind === "node" && selected.item.type === "router" && (() => {
        const node = selected.item;
        const location = node.location.coordinates;
        return (
          <div className="dynamic-inspector-content" data-inspector-type="router">
            <InspectorSection title="1. GENERAL · DEVICE INFORMATION" ariaLabel="Router general information">
              <label className="field-label">
                Device name
                <input value={node.name} onChange={(event) => onRename(selection, event.target.value)} />
              </label>
              <div className="property-row">
                <span>Device type</span>
                <strong>ROUTER</strong>
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
                    placeholder="e.g. MikroTik, Cisco"
                    value={String(node.properties.vendor ?? "")}
                    onChange={(e) => onNodeProperties?.(node.id, { vendor: e.target.value || null })}
                  />
                </label>
                <label className="field-label">
                  Model
                  <input
                    placeholder="e.g. RB4011"
                    value={String(node.properties.model ?? "")}
                    onChange={(e) => onNodeProperties?.(node.id, { model: e.target.value || null })}
                  />
                </label>
              </div>
              <div className="property-row">
                <span>Status</span>
                <strong>{String(node.properties.status ?? "Active").toUpperCase()}</strong>
              </div>
            </InspectorSection>

            <RouterConfigurationPanel
              configuration={readRouterConfiguration(node.properties.routerConfiguration)}
              onChange={(configuration) => onRouterConfiguration(node.id, configuration)}
            />

            <InspectorSection title="CONNECTED DEVICES" ariaLabel="Connected devices">
              <ConnectedDevicesList node={node} project={project} nodesById={nodesById} onDisconnectConnection={onDisconnectConnection} />
            </InspectorSection>

            <AdvancedProvenanceDetails entityId={node.id} properties={node.properties} />
          </div>
        );
      })()}

      {selected.kind === "customer" && (
        <CustomerInspector
          customer={selected.item}
          project={project}
          nodesById={nodesById}
          onRename={onRename}
          onSelect={onSelect}
          onCustomerAddress={onCustomerAddress}
          onCustomerOnt={onCustomerOnt}
          onCustomerStatus={onCustomerStatus}
        />
      )}

      {/* CABLE INSPECTOR */}
      {selected.kind === "cable" && (() => {
        const cable = selected.item;
        const lengthM = cable.lengthM;
        const selectedConnectionIds = project.connections
          .filter((connection) => connection.cableSegmentId === cable.id)
          .map((connection) => connection.id);
        const deploymentMethod = resolveDeploymentMethod(cable);
        const cableSpans = (project.poleSpans ?? []).filter((span) => span.cableSegmentId === cable.id);
        const isNonAerial =
          deploymentMethod === "underground" ||
          deploymentMethod === "building_attached" ||
          deploymentMethod === "other";

        return (
          <div className="dynamic-inspector-content" data-inspector-type="cable">
            <InspectorSection title="1. GENERAL · CABLE ROUTE" ariaLabel="Cable general information">
              <label className="field-label">
                Name
                <input value={cable.name} onChange={(event) => onRename(selection, event.target.value)} />
              </label>
              <div className="property-row">
                <span>Type</span>
                <strong>{cable.cableType || "Cable"}</strong>
              </div>
              <div className="property-row">
                <span>Endpoints</span>
                <strong>
                  {(() => {
                    const connection = project.connections.find((entry) => entry.cableSegmentId === cable.id);
                    const startId = connection?.fromNodeId ?? cable.startNodeId;
                    const endId = connection?.toNodeId ?? cable.endNodeId;
                    return `${project.nodes.find((node) => node.id === startId)?.name ?? "Unassigned"} → ${project.nodes.find((node) => node.id === endId)?.name ?? "Unassigned"}`;
                  })()}
                </strong>
              </div>
              <div className="property-row"><span>Fiber cores</span><strong>{cable.fiberCount ?? "Unspecified"}</strong></div>
              <div className="property-row"><span>Vertices</span><strong>{cable.geometry.coordinates.length}</strong></div>
              <div className="property-row"><span>Calculated length</span><strong>{lengthM === null ? "Not calculated" : `${lengthM.toLocaleString()} m`}</strong></div>
              {cable.properties.routeStatus === "manual_required" ? (
                cable.properties.connectionKind === "internal_optical_jumper" ? (
                  <p className="hint">Internal jumper length is not recorded. Coincident node coordinates do not establish physical fiber length.</p>
                ) : (
                  <p className="hint">Manual route planning required. No path geometry or cable length is verified.</p>
                )
              ) : cable.properties.routeStatus === "map_candidate_unverified" || cable.properties.routeStatus === "existing_geometry_unverified" ? (
                <p className="hint">Mapped route candidate · field verification required. This geometry is not a surveyed or approved fiber route.</p>
              ) : (
                <p className="hint">Drag the white handles to edit route geometry.</p>
              )}

              <label className="field-label address-field">
                Cable category
                <select
                  aria-label="Cable category"
                  value={resolveCableCategory(cable) ?? ""}
                  onChange={(event) => {
                    const cat = event.target.value as CableCategory | "";
                    const nextType =
                      cat && (!cable.cableType || ["feeder", "distribution", "drop", "indoor", "custom"].includes(cable.cableType.toLowerCase()))
                        ? cat
                        : cable.cableType;
                    onCableAttributes(selection.id, nextType, cable.fiberCount, {
                      cableCategory: cat || null,
                      cableCategorySource: cat ? "manual" : "automatic",
                    });
                  }}
                >
                  <option value="">Unspecified</option>
                  {(Object.keys(CABLE_CATEGORY_LABELS) as CableCategory[]).map((cat) => (
                    <option key={cat} value={cat}>{CABLE_CATEGORY_LABELS[cat]}</option>
                  ))}
                </select>
              </label>
              <p className="hint">
                Recommendation: <strong>{recommendCableCategory(project, cable).category}</strong> · {recommendCableCategory(project, cable).explanation}
              </p>
              <button
                className="secondary-button"
                onClick={() => {
                  const cat = recommendCableCategory(project, cable).category;
                  onCableAttributes(selection.id, cable.cableType, cable.fiberCount, {
                    cableCategory: cat,
                    cableCategorySource: "automatic",
                  });
                }}
              >
                Use recommendation
              </button>
              {cableCategoryWarning(project, cable) && <p role="status" className="hint">{cableCategoryWarning(project, cable)}</p>}

              <label className="field-label address-field">
                Deployment method
                <select
                  aria-label="Deployment method"
                  value={resolveDeploymentMethod(cable)}
                  onChange={(event) => {
                    const method = event.target.value as DeploymentMethod;
                    onCableAttributes(selection.id, cable.cableType, cable.fiberCount, { deploymentMethod: method });
                  }}
                >
                  {(["unspecified", "aerial", "underground", "building_attached", "other"] as DeploymentMethod[]).map((method) => (
                    <option key={method} value={method}>{DEPLOYMENT_METHOD_LABELS[method]}</option>
                  ))}
                </select>
              </label>
              <label className="field-label address-field">
                Cable type
                <input
                  value={cable.cableType}
                  placeholder="e.g. Aerial SM G.652.D"
                  onChange={(event) => onCableAttributes(selection.id, event.target.value, cable.fiberCount)}
                />
              </label>
              <div className="form-grid-2">
                <label className="field-label address-field">
                  Fiber count
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={cable.fiberCount ?? ""}
                    placeholder="Not specified"
                    onChange={(event) => {
                      const raw = event.target.value;
                      const count = raw === "" ? null : Number(raw);
                      if (count === null || (Number.isInteger(count) && count > 0)) {
                        onCableAttributes(selection.id, cable.cableType, count);
                      } else {
                        onInvalidFiberCount();
                      }
                    }}
                  />
                </label>
                <label className="field-label address-field">
                  Pigtail splices
                  <input
                    aria-label="Cable pigtail splices"
                    type="number"
                    min="0"
                    step="1"
                    value={typeof cable.properties.pigtailSplicesCount === "number" ? cable.properties.pigtailSplicesCount : ""}
                    placeholder="Default (0)"
                    onChange={(event) => {
                      const raw = event.target.value;
                      const count = raw === "" ? null : Number(raw);
                      if (count === null || (Number.isInteger(count) && count >= 0)) {
                        onCableAttributes(selection.id, cable.cableType, cable.fiberCount, { pigtailSplicesCount: count });
                      }
                    }}
                  />
                </label>
              </div>
            </InspectorSection>

            <InspectorSection title="OPTICAL ATTENUATION PARAMETERS" ariaLabel="Cable optical attenuation parameters">
              <label className="field-label address-field">
                Fiber attenuation (dB/km)
                <input
                  aria-label="Cable fiber attenuation dB per km"
                  type="number"
                  step="0.01"
                  min="0"
                  value={typeof cable.properties.fiberAttenuationDbPerKm === "number" ? cable.properties.fiberAttenuationDbPerKm : ""}
                  placeholder={`${project.settings.opticalBudget.fiberAttenuationDbPerKm.toFixed(2)} dB/km (default)`}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const val = raw.trim() === "" ? null : Number(raw);
                    onCableAttributes(cable.id, cable.cableType, cable.fiberCount, {
                      fiberAttenuationDbPerKm: val,
                    });
                  }}
                />
              </label>
              <div className="property-row">
                <span>Attenuation status</span>
                {typeof cable.properties.fiberAttenuationDbPerKm === "number" ? (
                  <div className="param-status-group">
                    <strong className="param-status-custom">[Custom: {Number(cable.properties.fiberAttenuationDbPerKm).toFixed(2)} dB/km]</strong>
                    <button
                      type="button"
                      className="secondary-button btn-compact"
                      onClick={() => onCableAttributes(cable.id, cable.cableType, cable.fiberCount, { fiberAttenuationDbPerKm: null })}
                    >
                      Reset
                    </button>
                  </div>
                ) : (
                  <strong className="param-status-default">[Default: {project.settings.opticalBudget.fiberAttenuationDbPerKm.toFixed(2)} dB/km]</strong>
                )}
              </div>

              <div className="form-grid-2">
                <label className="field-label address-field">
                  Connector loss (dB/if)
                  <input
                    aria-label="Cable connector loss dB"
                    type="number"
                    step="0.01"
                    min="0"
                    value={typeof cable.properties.connectorLossDb === "number" ? cable.properties.connectorLossDb : ""}
                    placeholder={`${project.settings.opticalBudget.connectorLossDb.toFixed(2)} dB`}
                    onChange={(e) => {
                      const raw = e.target.value;
                      onCableAttributes(cable.id, cable.cableType, cable.fiberCount, {
                        connectorLossDb: raw.trim() === "" ? null : Number(raw),
                      });
                    }}
                  />
                </label>
                <label className="field-label address-field">
                  Connectors count
                  <input
                    aria-label="Cable connectors count"
                    type="number"
                    step="1"
                    min="0"
                    value={typeof cable.properties.connectorsCount === "number" ? cable.properties.connectorsCount : ""}
                    placeholder={`${project.settings.opticalBudget.connectorsPerLink} default`}
                    onChange={(e) => {
                      const raw = e.target.value;
                      onCableAttributes(cable.id, cable.cableType, cable.fiberCount, {
                        connectorsCount: raw.trim() === "" ? null : Number(raw),
                      });
                    }}
                  />
                </label>
              </div>

              <div className="form-grid-2">
                <label className="field-label address-field">
                  Splice loss (dB/sp)
                  <input
                    aria-label="Cable fusion splice loss dB"
                    type="number"
                    step="0.01"
                    min="0"
                    value={typeof cable.properties.spliceLossDb === "number" ? cable.properties.spliceLossDb : ""}
                    placeholder={`${project.settings.opticalBudget.spliceLossDb.toFixed(2)} dB`}
                    onChange={(e) => {
                      const raw = e.target.value;
                      onCableAttributes(cable.id, cable.cableType, cable.fiberCount, {
                        spliceLossDb: raw.trim() === "" ? null : Number(raw),
                      });
                    }}
                  />
                </label>
                <label className="field-label address-field">
                  Fusion splices count
                  <input
                    aria-label="Cable fusion splices count"
                    type="number"
                    step="1"
                    min="0"
                    value={typeof cable.properties.splicesCount === "number" ? cable.properties.splicesCount : ""}
                    placeholder={`${project.settings.opticalBudget.splicesPerLink} default`}
                    onChange={(e) => {
                      const raw = e.target.value;
                      onCableAttributes(cable.id, cable.cableType, cable.fiberCount, {
                        splicesCount: raw.trim() === "" ? null : Number(raw),
                      });
                    }}
                  />
                </label>
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

            <InspectorSection title="POLE SPAN LINKS" ariaLabel="Cable pole span links">
              {isNonAerial ? (
                <p className="hint" role="note">
                  Deployment method is set to {DEPLOYMENT_METHOD_LABELS[deploymentMethod]}. Poles and pole-span constraints are not required for this cable.
                  {cableSpans.length > 0 ? " Existing linked pole spans are preserved below." : ""}
                </p>
              ) : (
                <>
                  <p className="hint">
                    Add an explicit link between poles (optional). When a cable has multiple spans, each sub-span length is resolved from matching route vertices or reported as Unknown.
                  </p>
                  <div className="form-grid-2">
                    <label className="field-label">
                      Start pole
                      <select aria-label="Span start pole" value={spanFrom} onChange={(event) => setSpanFrom(event.target.value)}>
                        <option value="">Select pole</option>
                        {project.nodes
                          .filter((node) => node.type === "pole")
                          .map((node) => (
                            <option key={node.id} value={node.id}>{node.name}</option>
                          ))}
                      </select>
                    </label>
                    <label className="field-label">
                      End pole
                      <select aria-label="Span end pole" value={spanTo} onChange={(event) => setSpanTo(event.target.value)}>
                        <option value="">Select pole</option>
                        {project.nodes
                          .filter((node) => node.type === "pole")
                          .map((node) => (
                            <option key={node.id} value={node.id}>{node.name}</option>
                          ))}
                      </select>
                    </label>
                  </div>
                  <button
                    className="secondary-button full-width-btn"
                    disabled={!onAddPoleSpan || !spanFrom || !spanTo || spanFrom === spanTo}
                    onClick={() => {
                      if (!spanFrom || !spanTo || spanFrom === spanTo) return;
                      const existingSpansForCable = (project.poleSpans ?? []).filter((s) => s.cableSegmentId === cable.id);
                      const fromPole = project.nodes.find((n) => n.id === spanFrom);
                      const toPole = project.nodes.find((n) => n.id === spanTo);
                      const subCoords = extractSubspanCoordinates(cable.geometry.coordinates, fromPole, toPole);
                      const coversEntire =
                        existingSpansForCable.length === 0 &&
                        subCoords !== null &&
                        subCoords.length === cable.geometry.coordinates.length;
                      const resolvedLengthM = subCoords
                        ? Number(approximateLengthMeters(subCoords).toFixed(2))
                        : existingSpansForCable.length === 0
                          ? cable.lengthM
                          : null;
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
                    }}
                  >
                    Link poles to this route
                  </button>
                </>
              )}
              {cableSpans.map((span) => (
                <div className="connection-row" key={span.id}>
                  <span>
                    {project.nodes.find((node) => node.id === span.fromPoleId)?.name ?? "Missing pole"} →{" "}
                    {project.nodes.find((node) => node.id === span.toPoleId)?.name ?? "Missing pole"}
                    <small>{span.lengthM == null ? "Unknown" : `${span.lengthM.toLocaleString()} m`}</small>
                    <select
                      aria-label={`Span ${span.id} verification status`}
                      value={span.status}
                      onChange={(event) => {
                        const status = event.target.value;
                        if (["existing", "proposed", "shared", "unverified"].includes(status)) {
                          onPoleSpanStatus?.(span.id, status as PoleSpan["status"]);
                        }
                      }}
                    >
                      <option value="unverified">Unverified</option>
                      <option value="existing">Existing</option>
                      <option value="proposed">Proposed</option>
                      <option value="shared">Shared</option>
                    </select>
                  </span>
                  <button aria-label={`Remove pole span ${span.id}`} onClick={() => onDeletePoleSpan?.(span.id)}>×</button>
                </div>
              ))}
            </InspectorSection>

            <PhysicalOpticalComponentsPanel
              project={project}
              entityKind="cable"
              entityId={cable.id}
              selectedConnectionIds={selectedConnectionIds}
              onOpticalComponentsChange={onOpticalComponentsChange}
            />
            <AdvancedProvenanceDetails entityId={cable.id} properties={cable.properties} />
            <ProjectOpticalBudgetParametersDetails project={project} onOpticalBudgetConfig={onOpticalBudgetConfig} onRecalculate={onRecalculate} />
          </div>
        );
      })()}
    </section>
  );
}
