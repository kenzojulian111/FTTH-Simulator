import { useEffect, useMemo, useState } from "react";
import { createValidatedConnection, validateConnection } from "../domain/connectionValidation";
import type { ConnectionValidationRequest } from "../domain/types";
import type { Project, TopologyConnection, TopologyValidationResult } from "../domain/types";

interface Props {
  project: Project;
  initialSourceId?: string;
  initialDestinationId?: string;
  initialCableId?: string;
  validateWithBackend: (projectId: string, request: ConnectionValidationRequest) => Promise<TopologyValidationResult>;
  onClose: () => void;
  onConnect: (connection: TopologyConnection) => void;
  onRejected?: (cableSegmentId: string) => void;
}

interface CandidateCheck { result?: TopologyValidationResult; error?: string }
interface CandidateChecks { key: string; loading: boolean; byDestination: Record<string, CandidateCheck> }

export function ConnectionDialog({ project, initialSourceId = "", initialDestinationId = "", initialCableId = "", validateWithBackend, onClose, onConnect, onRejected }: Props) {
  const [fromNodeId, setFromNodeId] = useState(initialSourceId);
  const [toNodeId, setToNodeId] = useState(initialDestinationId);
  const [cableSegmentId, setCableSegmentId] = useState(initialCableId);
  const draft = { fromNodeId, toNodeId, cableSegmentId };
  const localValidation = useMemo(() => validateConnection(project, draft), [project, fromNodeId, toNodeId, cableSegmentId]);
  const checkKey = `${project.id}|${project.updatedAt}|${fromNodeId}|${cableSegmentId}`;
  const [candidateChecks, setCandidateChecks] = useState<CandidateChecks>({ key: "", loading: false, byDestination: {} });
  const otherNodes = project.nodes.filter((node) => node.id !== fromNodeId);
  const canCheckCandidates = Boolean(fromNodeId && project.nodes.some((node) => node.id === fromNodeId) && cableSegmentId && project.cableSegments.some((cable) => cable.id === cableSegmentId));

  useEffect(() => {
    if (!canCheckCandidates) {
      setCandidateChecks({ key: checkKey, loading: false, byDestination: {} });
      return;
    }
    let active = true;
    setCandidateChecks({ key: checkKey, loading: true, byDestination: {} });
    const checks = otherNodes.map(async (node): Promise<[string, CandidateCheck]> => {
      const request: ConnectionValidationRequest = { fromNodeId, toNodeId: node.id, cableSegmentId, project };
      try {
        return [node.id, { result: await validateWithBackend(project.id, request) }];
      } catch (error) {
        return [node.id, { error: error instanceof Error ? error.message : "Backend topology validation failed." }];
      }
    });
    void Promise.all(checks).then((results) => {
      if (active) setCandidateChecks({ key: checkKey, loading: false, byDestination: Object.fromEntries(results) });
    });
    return () => { active = false; };
  }, [canCheckCandidates, checkKey, fromNodeId, cableSegmentId, project, validateWithBackend]);

  const currentChecks = candidateChecks.key === checkKey ? candidateChecks : null;
  const selectedCheck = toNodeId ? currentChecks?.byDestination[toNodeId] : undefined;
  const backendMessage = selectedCheck?.error ?? (selectedCheck?.result && !selectedCheck.result.valid
    ? selectedCheck.result.errors.map((issue) => `${issue.policyCode ?? issue.code}: ${issue.message}`).join(" ") || "Backend rejected this connection."
    : selectedCheck?.result?.warnings.map((issue) => issue.message).join(" "));
  const validationMessage = !localValidation.valid
    ? localValidation.message
    : !canCheckCandidates
      ? "Select a valid source device and cable to run backend FTTH validation."
      : !toNodeId
        ? currentChecks?.loading ? "Checking allowed destinations with the backend…" : "Choose a destination device."
        : !currentChecks || currentChecks.loading
          ? "Checking this connection with the backend…"
          : selectedCheck?.error ?? (!selectedCheck?.result ? "Backend validation is unavailable; connection creation is blocked." : backendMessage || (selectedCheck.result.valid ? "Backend approved this connection." : "Backend rejected this connection."));
  const validationPassed = Boolean(localValidation.valid && selectedCheck?.result?.valid && currentChecks && !currentChecks.loading && !selectedCheck.error);

  useEffect(() => {
    if (selectedCheck?.error || selectedCheck?.result && !selectedCheck.result.valid) onRejected?.(cableSegmentId);
  }, [cableSegmentId, onRejected, selectedCheck]);

  function connect() {
    if (!validationPassed) return;
    const result = createValidatedConnection(project, draft, crypto.randomUUID());
    if (result.ok) onConnect(result.connection);
  }

  return <div className="connection-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="connection-dialog" role="dialog" aria-modal="true" aria-labelledby="connection-dialog-title">
      <header className="connection-dialog-heading"><div><small>TOPOLOGY EDITOR</small><h2 id="connection-dialog-title">Create Connection</h2></div><button type="button" aria-label="Close connection dialog" onClick={onClose}>×</button></header>
      <label className="connection-field">Source device
        <select value={fromNodeId} onChange={(event) => setFromNodeId(event.target.value)}>
          <option value="">Select source…</option>
          {project.nodes.map((node) => <option key={node.id} value={node.id}>{node.name} · {node.type.toUpperCase()}</option>)}
        </select>
      </label>
      <label className="connection-field">Destination device
        <select value={toNodeId} onChange={(event) => setToNodeId(event.target.value)}>
          <option value="">Select destination…</option>
          {otherNodes.map((node) => {
            const check = currentChecks?.byDestination[node.id];
            const allowed = check?.result?.valid === true && !check.error;
            const reason = check?.error ?? check?.result?.errors.map((issue) => issue.message).join(" ");
            return <option key={node.id} value={node.id} disabled={!allowed}>{node.name} · {node.type.toUpperCase()}{currentChecks?.loading ? " · checking" : !currentChecks ? " · not checked" : !allowed ? ` · ${reason || "not allowed"}` : ""}</option>;
          })}
        </select>
        {fromNodeId && !otherNodes.length && <small className="connection-field-hint">No other network device is available.</small>}
      </label>
      <label className="connection-field">Cable segment
        <select value={cableSegmentId} onChange={(event) => setCableSegmentId(event.target.value)}>
          <option value="">Select cable…</option>
          {project.cableSegments.map((cable) => <option key={cable.id} value={cable.id}>{cable.name}{cable.cableType ? ` · ${cable.cableType}` : ""}</option>)}
        </select>
      </label>
      <div className={`connection-validation ${validationPassed ? "valid" : "invalid"}`} role="status" aria-live="polite">
        <strong>{validationPassed ? "Backend approved" : "Connection needs attention"}</strong>
        <span>{validationMessage}</span>
      </div>
      {selectedCheck?.result?.warnings.map((warning, index) => <p className="connection-policy-note" key={`${warning.code}-${index}`}>Warning: {warning.message}</p>)}
      <p className="connection-schema-note">Connection type is not stored by the current project schema.</p>
      <footer className="connection-dialog-actions"><button type="button" className="load-button" onClick={onClose}>Cancel</button><button type="button" className="primary-button" onClick={connect} disabled={!validationPassed}>Connect <span>↗</span></button></footer>
    </section>
  </div>;
}
