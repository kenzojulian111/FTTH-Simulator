import { useState, useMemo } from "react";
import type { FeatureRef, Project, TopologyIssue, TopologyValidationResult } from "../domain/types";

interface Props {
  validation: TopologyValidationResult;
  project: Project;
  onSelectEntity?: (selection: FeatureRef) => void;
}

type CategoryId = "topology_errors" | "route_warnings" | "port_capacity" | "optical_config" | "other_warnings";

interface ValidationCategoryGroup {
  id: CategoryId;
  label: string;
  severity: "error" | "warning" | "info";
  issues: TopologyIssue[];
}

function classifyIssueCategory(issue: TopologyIssue): CategoryId {
  if (issue.severity === "error") return "topology_errors";
  const text = `${issue.code} ${issue.policyCode ?? ""} ${issue.message}`.toLowerCase();
  if (text.includes("route") || text.includes("geometry") || text.includes("length") || text.includes("cable") || text.includes("span") || text.includes("coordinate")) {
    return "route_warnings";
  }
  if (text.includes("port") || text.includes("capacity") || text.includes("fanout") || text.includes("subscriber") || text.includes("ratio")) {
    return "port_capacity";
  }
  if (text.includes("optical") || text.includes("loss") || text.includes("power") || text.includes("attenuation") || text.includes("sensitivity") || text.includes("overload") || text.includes("splitter")) {
    return "optical_config";
  }
  return "other_warnings";
}

const CATEGORY_META: Record<CategoryId, { label: string; defaultSeverity: "error" | "warning" | "info" }> = {
  topology_errors: { label: "Topology errors", defaultSeverity: "error" },
  route_warnings: { label: "Route warnings", defaultSeverity: "warning" },
  port_capacity: { label: "Port capacity warnings", defaultSeverity: "warning" },
  optical_config: { label: "Optical configuration warnings", defaultSeverity: "warning" },
  other_warnings: { label: "Other warnings", defaultSeverity: "warning" },
};

export function TopologyValidationPanel({ validation, project, onSelectEntity }: Props) {
  // Requirement 1: Default state MUST be COLLAPSED
  const [panelOpen, setPanelOpen] = useState(false);
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});
  const [openIssueKeys, setOpenIssueKeys] = useState<Record<string, boolean>>({});

  const allIssues = useMemo(() => {
    const errors = (validation.errors ?? []).map((item) => ({ ...item, severity: item.severity ?? ("error" as const) }));
    const warnings = (validation.warnings ?? []).map((item) => ({ ...item, severity: item.severity ?? ("warning" as const) }));
    return [...errors, ...warnings];
  }, [validation.errors, validation.warnings]);

  const errorCount = (validation.errors ?? []).length;
  const warningCount = (validation.warnings ?? []).filter((w) => w.severity !== "info").length;
  const infoCount = allIssues.filter((i) => i.severity === "info").length;

  const categories = useMemo<ValidationCategoryGroup[]>(() => {
    const buckets: Record<CategoryId, TopologyIssue[]> = {
      topology_errors: [],
      route_warnings: [],
      port_capacity: [],
      optical_config: [],
      other_warnings: [],
    };
    for (const issue of allIssues) {
      const cat = classifyIssueCategory(issue);
      buckets[cat].push(issue);
    }
    const order: CategoryId[] = ["topology_errors", "route_warnings", "port_capacity", "optical_config", "other_warnings"];
    return order
      .filter((id) => buckets[id].length > 0)
      .map((id) => {
        const issues = buckets[id];
        const hasError = issues.some((i) => i.severity === "error");
        const hasWarning = issues.some((i) => i.severity === "warning");
        const severity: "error" | "warning" | "info" = hasError ? "error" : hasWarning ? "warning" : "info";
        return {
          id,
          label: CATEGORY_META[id].label,
          severity,
          issues,
        };
      });
  }, [allIssues]);

  const expandAll = () => {
    const nextCats: Record<string, boolean> = {};
    for (const cat of categories) nextCats[cat.id] = true;
    setOpenCategories(nextCats);
  };

  const collapseAll = () => {
    setOpenCategories({});
    setOpenIssueKeys({});
  };

  const toggleCategory = (id: string) => {
    setOpenCategories((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleIssue = (key: string) => {
    setOpenIssueKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const nodesById = useMemo(() => Object.fromEntries(project.nodes.map((n) => [n.id, n])), [project.nodes]);
  const cablesById = useMemo(() => Object.fromEntries(project.cableSegments.map((c) => [c.id, c])), [project.cableSegments]);

  return (
    <div
      className={`topology-validation-summary validation-center ${validation.valid ? "valid" : "invalid"} ${panelOpen ? "is-open" : "is-collapsed"}`}
      role="status"
      aria-label="Project topology validation"
    >
      <div className="validation-header-bar">
        <button
          type="button"
          className="validation-summary-trigger"
          aria-expanded={panelOpen}
          onClick={() => setPanelOpen((prev) => !prev)}
        >
          <span className="validation-title-group">
            <span className={`validation-status-pill ${validation.valid ? "status-valid" : "status-invalid"}`}>
              {validation.valid ? "Valid" : "Invalid"}
            </span>
            <strong className="validation-headline">
              {validation.valid
                ? "Project topology valid"
                : `Project topology has ${errorCount} issue${errorCount === 1 ? "" : "s"}`}
            </strong>
          </span>
          <span className="validation-chevron" aria-hidden="true">{panelOpen ? "▾" : "▸"}</span>
        </button>

        <div className="validation-counters">
          <span className={`validation-counter counter-error ${errorCount > 0 ? "has-items" : ""}`}>
            <strong>{errorCount}</strong> error{errorCount === 1 ? "" : "s"}
          </span>
          <span className={`validation-counter counter-warning ${warningCount > 0 ? "has-items" : ""}`}>
            <strong>{warningCount}</strong> warning{warningCount === 1 ? "" : "s"}
          </span>
          {infoCount > 0 && (
            <span className="validation-counter counter-info has-items">
              <strong>{infoCount}</strong> info
            </span>
          )}
        </div>
      </div>

      {panelOpen && (
        <div className="validation-collapsible-body">
          {categories.length > 1 && (
            <div className="validation-bulk-actions">
              <button type="button" className="secondary-button btn-compact" onClick={expandAll}>
                Expand All
              </button>
              <button type="button" className="secondary-button btn-compact" onClick={collapseAll}>
                Collapse All
              </button>
            </div>
          )}

          {categories.length === 0 ? (
            <p className="validation-empty-note">All topology checks passed with zero errors or warnings.</p>
          ) : (
            <div className="validation-category-list">
              {categories.map((cat) => {
                const isCatOpen = Boolean(openCategories[cat.id]);
                return (
                  <div key={cat.id} className={`validation-category-card severity-${cat.severity} ${isCatOpen ? "open" : ""}`}>
                    <button
                      type="button"
                      className="validation-category-header"
                      aria-expanded={isCatOpen}
                      onClick={() => toggleCategory(cat.id)}
                    >
                      <span className="validation-category-title">
                        <i className={`severity-dot severity-${cat.severity}`} />
                        <strong>{cat.label}</strong>
                      </span>
                      <span className="validation-category-meta">
                        <span className={`category-count-badge severity-${cat.severity}`}>{cat.issues.length}</span>
                        <span className="validation-chevron" aria-hidden="true">{isCatOpen ? "▾" : "▸"}</span>
                      </span>
                    </button>

                    {isCatOpen && (
                      <div className="validation-category-body">
                        {cat.issues.map((issue, index) => {
                          const issueKey = `${cat.id}-${issue.code}-${index}`;
                          const isIssueOpen = Boolean(openIssueKeys[issueKey]);
                          const fromNode = issue.fromNodeId ? nodesById[issue.fromNodeId] : undefined;
                          const toNode = issue.toNodeId ? nodesById[issue.toNodeId] : undefined;
                          const cable = issue.cableSegmentId ? cablesById[issue.cableSegmentId] : undefined;
                          const hasTarget = Boolean(issue.fromNodeId || issue.toNodeId || issue.cableSegmentId);

                          return (
                            <div
                              key={issueKey}
                              className={`validation-issue-item severity-${issue.severity} ${issue.severity === "error" ? "topology-validation-issue" : "topology-validation-warning"}`}
                            >
                              <div className="validation-issue-main">
                                <button
                                  type="button"
                                  className="validation-issue-toggle"
                                  aria-expanded={isIssueOpen}
                                  onClick={() => toggleIssue(issueKey)}
                                >
                                  <span className={`issue-severity-tag severity-${issue.severity}`}>
                                    {issue.severity === "error" ? "Error" : issue.severity === "info" ? "Info" : "Warning"}
                                  </span>
                                  <span className="validation-issue-message">
                                    {issue.severity === "warning" ? `Warning: ${issue.message}` : issue.message}
                                  </span>
                                  <span className="validation-chevron" aria-hidden="true">{isIssueOpen ? "▾" : "▸"}</span>
                                </button>
                              </div>

                              {isIssueOpen && (
                                <div className="validation-issue-details">
                                  <div className="property-row">
                                    <span>Rule / Code</span>
                                    <strong className="mono-value">{issue.code}{issue.policyCode ? ` (${issue.policyCode})` : ""}</strong>
                                  </div>
                                  {cable && (
                                    <div className="property-row">
                                      <span>Cable segment</span>
                                      <strong>{cable.name}</strong>
                                    </div>
                                  )}
                                  {fromNode && (
                                    <div className="property-row">
                                      <span>Source node</span>
                                      <strong>{fromNode.name} ({fromNode.type.toUpperCase()})</strong>
                                    </div>
                                  )}
                                  {toNode && (
                                    <div className="property-row">
                                      <span>Target node</span>
                                      <strong>{toNode.name} ({toNode.type.toUpperCase()})</strong>
                                    </div>
                                  )}
                                  {issue.details && Object.keys(issue.details).length > 0 && (
                                    <div className="property-row">
                                      <span>Details</span>
                                      <strong className="mono-value">{JSON.stringify(issue.details)}</strong>
                                    </div>
                                  )}
                                </div>
                              )}

                              {hasTarget && onSelectEntity && (
                                <div className="validation-issue-actions">
                                  <button
                                    type="button"
                                    className="secondary-button btn-compact"
                                    onClick={() => {
                                      const nodeId = issue.fromNodeId ?? issue.toNodeId;
                                      const selection = issue.cableSegmentId
                                        ? { kind: "cable" as const, id: issue.cableSegmentId }
                                        : nodeId
                                          ? { kind: "node" as const, id: nodeId }
                                          : null;
                                      if (selection) onSelectEntity(selection);
                                    }}
                                  >
                                    Select affected object
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
