import { useState } from "react";

interface NewProjectDialogProps {
  creating: boolean;
  error: string | null;
  onCreate: (name: string) => void;
  onClose: () => void;
}

export function NewProjectDialog({ creating, error, onCreate, onClose }: NewProjectDialogProps) {
  const [name, setName] = useState("");
  return <div className="project-library-backdrop" role="presentation">
    <form className="save-as-dialog" role="dialog" aria-modal="true" aria-labelledby="new-project-title" onSubmit={(event) => { event.preventDefault(); onCreate(name); }}>
      <h2 id="new-project-title">New project</h2>
      <p>Start with an empty FTTH design. You can add devices, routes, and project settings after creation.</p>
      <label className="field-label">Project name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} aria-invalid={!name.trim()} placeholder="e.g. FTTH North District" /></label>
      {error && <p className="project-library-error" role="alert">{error}</p>}
      <div className="save-as-actions"><button type="button" onClick={onClose} disabled={creating}>Cancel</button><button type="submit" className="primary-button" disabled={creating || !name.trim()}>{creating ? "Creating…" : "Create project"}</button></div>
    </form>
  </div>;
}
