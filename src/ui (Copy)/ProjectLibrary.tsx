import type { ProjectSummary } from "../api/projectApi";

interface ProjectLibraryProps {
  projects: ProjectSummary[];
  loading: boolean;
  loadingProjectId: string | null;
  error: string | null;
  sessionOnly: boolean;
  onRefresh: () => void;
  onLoad: (project: ProjectSummary) => void;
  onClose: () => void;
}

export function ProjectLibrary({ projects, loading, loadingProjectId, error, sessionOnly, onRefresh, onLoad, onClose }: ProjectLibraryProps) {
  return <div className="project-library-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="project-library" role="dialog" aria-modal="true" aria-labelledby="project-library-title">
      <header><div><p className="project-library-kicker">WORKSPACE</p><h2 id="project-library-title">My Projects</h2><p className="project-library-subtitle">{sessionOnly ? "Session-only projects. They are cleared when this app reloads." : "Saved designs from the project server."}</p></div>
        <button type="button" className="icon-button" aria-label="Close projects" onClick={onClose}>×</button></header>
      <div className="project-library-actions"><span>{loading ? "Refreshing project list…" : `${projects.length} saved project${projects.length === 1 ? "" : "s"}`}</span><button type="button" onClick={onRefresh} disabled={loading}>Refresh</button></div>
      {error && <p className="project-library-error" role="alert">{error}</p>}
      {!loading && !error && projects.length === 0 && <div className="project-library-empty"><strong>No saved projects yet</strong><p>Save this design to make it available here.</p></div>}
      <div className="project-library-list" aria-busy={loading}>
        {projects.map((project) => <article className="project-library-row" key={project.id}>
          <div className="project-library-info"><strong>{project.name}</strong>{project.description && <p>{project.description}</p>}<small>{project.currency} · Updated {new Date(project.updatedAt).toLocaleString()}</small></div>
          <button type="button" className="primary-button" onClick={() => onLoad(project)} disabled={loading || loadingProjectId !== null}>{loadingProjectId === project.id ? "Loading…" : "Load"}</button>
        </article>)}
      </div>
    </section>
  </div>;
}
