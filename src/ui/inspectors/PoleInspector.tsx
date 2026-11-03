import type { FeatureRef, NetworkNode, PoleSpan, Project } from "../../domain/types";
import {
  AdvancedProvenanceDetails,
  ConnectedDevicesList,
  InspectorSection,
} from "./InspectorShared";

interface Props {
  node: NetworkNode;
  project: Project;
  nodesById: Record<string, NetworkNode>;
  onRename: (ref: FeatureRef, name: string) => void;
  onSelect?: (ref: FeatureRef) => void;
  onPoleProperties?: (id: string, properties: NetworkNode["properties"]) => void;
  onDeletePoleSpan?: (id: string) => void;
  onPoleSpanStatus?: (id: string, status: PoleSpan["status"]) => void;
  onDisconnectConnection?: (connectionId: string) => void;
}

export function PoleInspector({
  node,
  project,
  nodesById,
  onRename,
  onSelect,
  onPoleProperties,
  onDeletePoleSpan,
  onPoleSpanStatus,
  onDisconnectConnection,
}: Props) {
  const location = node.location.coordinates;
  const linkedSpans = (project.poleSpans ?? []).filter((span) => span.fromPoleId === node.id || span.toPoleId === node.id);
  const connectedCableIds = new Set(linkedSpans.map((span) => span.cableSegmentId));
  const connectedCables = project.cableSegments.filter(
    (cable) => connectedCableIds.has(cable.id) || cable.startNodeId === node.id || cable.endNodeId === node.id,
  );

  return (
    <div className="dynamic-inspector-content" data-inspector-type="pole">
      {/* 1. GENERAL */}
      <InspectorSection title="1. GENERAL · POLE INFRASTRUCTURE" ariaLabel="Pole general information">
        <label className="field-label">
          Device name
          <input value={node.name} onChange={(event) => onRename({ kind: "node", id: node.id }, event.target.value)} />
        </label>
        <div className="property-row">
          <span>Device type</span>
          <strong>POLE</strong>
        </div>
        <div className="form-grid-2">
          <label className="field-label">
            Pole type
            <input
              aria-label="Pole type"
              value={String(node.properties.poleType ?? "")}
              placeholder="Unknown"
              onChange={(event) => onPoleProperties?.(node.id, { poleType: event.target.value || null })}
            />
          </label>
          <label className="field-label">
            Material
            <input
              aria-label="Pole material"
              value={String(node.properties.material ?? "")}
              placeholder="Unknown"
              onChange={(event) => onPoleProperties?.(node.id, { material: event.target.value || null })}
            />
          </label>
        </div>
        <div className="form-grid-2">
          <label className="field-label">
            Height (m)
            <input
              aria-label="Pole height metres"
              type="number"
              min="0"
              step="0.1"
              value={typeof node.properties.heightM === "number" ? node.properties.heightM : ""}
              placeholder="Unknown"
              onChange={(event) => {
                const value = event.target.value;
                onPoleProperties?.(node.id, { heightM: value === "" ? null : Number(value) });
              }}
            />
          </label>
          <label className="field-label">
            Status
            <select
              aria-label="Pole status"
              value={String(node.properties.status ?? "unverified")}
              onChange={(event) => onPoleProperties?.(node.id, { status: event.target.value })}
            >
              <option value="unverified">Unverified</option>
              <option value="existing">Existing</option>
              <option value="proposed">Proposed</option>
              <option value="shared">Shared</option>
            </select>
          </label>
        </div>
        <label className="field-label">
          Notes
          <textarea
            aria-label="Pole notes"
            value={String(node.properties.notes ?? "")}
            placeholder="Optional notes"
            onChange={(event) => onPoleProperties?.(node.id, { notes: event.target.value || null })}
          />
        </label>
        <p className="hint">Pole specifications remain unknown until entered. Pole status does not create an optical topology connection.</p>
      </InspectorSection>

      {/* 2. LOCATION */}
      <InspectorSection title="2. LOCATION · GEOGRAPHIC PLACEMENT" ariaLabel="Pole location">
        <div className="property-row">
          <span>Latitude, Longitude</span>
          <strong className="mono-value">
            {node.properties.geographicPositionSet === false ? "Place on map" : `${location[1].toFixed(5)}, ${location[0].toFixed(5)}`}
          </strong>
        </div>
        <div className="property-row">
          <span>Placement status</span>
          <strong>{node.properties.geographicPositionSet === false ? "LOGICAL ONLY" : "GEOGRAPHICALLY PLACED"}</strong>
        </div>
      </InspectorSection>

      {/* 3. CABLE SPAN */}
      <InspectorSection title="3. CABLE SPAN · PHYSICAL SPANS" ariaLabel="Pole cable spans">
        {linkedSpans.length === 0 ? (
          <p className="hint">No cable spans are linked to this pole yet. Select an aerial cable route to link pole spans.</p>
        ) : (
          <div className="connected-devices-list">
            {linkedSpans.map((span) => {
              const fromName = nodesById[span.fromPoleId]?.name ?? "Missing pole";
              const toName = nodesById[span.toPoleId]?.name ?? "Missing pole";
              return (
                <div className="connection-row" key={span.id}>
                  <span>
                    {fromName} → {toName}
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
              );
            })}
          </div>
        )}
      </InspectorSection>

      {/* 4. CONNECTED CABLES */}
      <InspectorSection title="4. CONNECTED CABLES" ariaLabel="Pole connected cables">
        {connectedCables.length === 0 ? (
          <ConnectedDevicesList
            node={node}
            project={project}
            nodesById={nodesById}
            onDisconnectConnection={onDisconnectConnection}
            emptyText="No cables attached to this pole."
          />
        ) : (
          <div className="connected-devices-list">
            {connectedCables.map((cable) => (
              <div key={cable.id} className="connected-device-card">
                <div className="connected-device-info">
                  <div className="connected-device-ports">
                    <strong className="connected-device-name" title={cable.name}>{cable.name}</strong>
                    <span className="connected-device-type">({cable.cableType || "Cable"})</span>
                  </div>
                  <small className="connected-device-cable">
                    {cable.lengthM != null ? `${cable.lengthM.toFixed(1)} m` : "Length uncalculated"} · {cable.fiberCount ?? "?"} cores
                  </small>
                </div>
                {onSelect && (
                  <button
                    type="button"
                    className="secondary-button btn-compact"
                    onClick={() => onSelect({ kind: "cable", id: cable.id })}
                  >
                    Inspect
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </InspectorSection>

      <AdvancedProvenanceDetails entityId={node.id} properties={node.properties} />
    </div>
  );
}
