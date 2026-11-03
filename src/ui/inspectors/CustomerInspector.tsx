import type { Customer, FeatureRef, NetworkNode, Project } from "../../domain/types";
import {
  AdvancedProvenanceDetails,
  InspectorSection,
} from "./InspectorShared";

interface Props {
  customer: Customer;
  project: Project;
  nodesById: Record<string, NetworkNode>;
  onRename: (ref: FeatureRef, name: string) => void;
  onSelect?: (ref: FeatureRef) => void;
  onCustomerAddress: (id: string, address: string) => void;
  onCustomerOnt: (id: string, ontNodeId: string | null) => void;
  onCustomerStatus: (id: string, status: "planned" | "connected" | "on_hold") => void;
}

export function CustomerInspector({
  customer,
  project,
  nodesById,
  onRename,
  onSelect,
  onCustomerAddress,
  onCustomerOnt,
  onCustomerStatus,
}: Props) {
  const location = customer.location.coordinates;
  const assignedOnt = customer.ontNodeId ? nodesById[customer.ontNodeId] : undefined;
  const upstreamConn = assignedOnt ? project.connections.find((conn) => conn.toNodeId === assignedOnt.id) : undefined;
  const dropCable = upstreamConn ? project.cableSegments.find((cable) => cable.id === upstreamConn.cableSegmentId) : undefined;
  const upstreamNode = upstreamConn ? nodesById[upstreamConn.fromNodeId] : undefined;

  return (
    <div className="dynamic-inspector-content" data-inspector-type="customer">
      {/* 1. GENERAL */}
      <InspectorSection title="1. GENERAL · SUBSCRIBER OVERVIEW" ariaLabel="Customer general information">
        <label className="field-label">
          Name
          <input value={customer.name} onChange={(event) => onRename({ kind: "customer", id: customer.id }, event.target.value)} />
        </label>
        <div className="property-row">
          <span>Type</span>
          <strong>Customer</strong>
        </div>
        <div className="property-row">
          <span>Coordinates</span>
          <strong className="mono-value">
            {customer.properties.geographicPositionSet === false ? "Place on map" : `${location[1].toFixed(5)}, ${location[0].toFixed(5)}`}
          </strong>
        </div>
      </InspectorSection>

      {/* 2. CUSTOMER INFORMATION */}
      <InspectorSection title="2. CUSTOMER INFORMATION" ariaLabel="Customer service details">
        <label className="field-label address-field">
          Status
          <select
            value={customer.status}
            onChange={(event) => {
              const status = event.target.value;
              if (status === "planned" || status === "connected" || status === "on_hold") {
                onCustomerStatus(customer.id, status);
              }
            }}
          >
            <option value="planned">Planned</option>
            <option value="connected">Connected</option>
            <option value="on_hold">On hold</option>
          </select>
        </label>
        <label className="field-label address-field">
          Address
          <input
            value={customer.address}
            placeholder="Add service address"
            onChange={(event) => onCustomerAddress(customer.id, event.target.value)}
          />
        </label>
      </InspectorSection>

      {/* 3. ASSIGNED ONT */}
      <InspectorSection title="3. ASSIGNED ONT" ariaLabel="Assigned ONT configuration">
        <label className="field-label address-field">
          Associated ONT
          <select value={customer.ontNodeId ?? ""} onChange={(event) => onCustomerOnt(customer.id, event.target.value || null)}>
            <option value="">No ONT assigned</option>
            {project.nodes
              .filter((node) => node.type === "ont")
              .map((node) => (
                <option key={node.id} value={node.id}>{node.name}</option>
              ))}
          </select>
        </label>
        {assignedOnt && (
          <div className="property-row">
            <span>ONT device</span>
            <div className="param-status-group">
              <strong>{assignedOnt.name}</strong>
              {onSelect && (
                <button
                  type="button"
                  className="secondary-button btn-compact"
                  onClick={() => onSelect({ kind: "node", id: assignedOnt.id })}
                >
                  Inspect ONT
                </button>
              )}
            </div>
          </div>
        )}
      </InspectorSection>

      {/* 4. DROP CABLE */}
      <InspectorSection title="4. DROP CABLE · ACCESS LINK" ariaLabel="Customer drop cable">
        {!assignedOnt ? (
          <p className="hint">Assign an ONT to view its upstream drop cable connection.</p>
        ) : !dropCable ? (
          <p className="hint">Assigned ONT has no drop cable connection to an ODP yet.</p>
        ) : (
          <>
            <div className="property-row">
              <span>Drop cable</span>
              <strong>{dropCable.name}</strong>
            </div>
            <div className="property-row">
              <span>Upstream ODP</span>
              <strong>{upstreamNode?.name ?? "Unknown"}</strong>
            </div>
            <div className="property-row">
              <span>Cable length</span>
              <strong className="mono-value">{dropCable.lengthM != null ? `${dropCable.lengthM.toFixed(2)} m` : "Not calculated"}</strong>
            </div>
            {onSelect && (
              <button
                type="button"
                className="secondary-button full-width-btn"
                onClick={() => onSelect({ kind: "cable", id: dropCable.id })}
              >
                Inspect drop cable
              </button>
            )}
          </>
        )}
      </InspectorSection>

      <AdvancedProvenanceDetails entityId={customer.id} properties={customer.properties} />
    </div>
  );
}
