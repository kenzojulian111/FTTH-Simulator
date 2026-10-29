import { useState } from "react";

interface SaveAsDialogProps {
  initialName: string;
  saving: boolean;
  error: string | null;
  onSave: (name: string) => void;
  onClose: () => void;
}

export function SaveAsDialog({ initialName, saving, error, onSave, onClose }: SaveAsDialogProps) {
  const [name, setName] = useState(initialName);
  return <div className="project-library-backdrop" role="presentation">
    <form className="save-as-dialog" role="dialog" aria-modal="true" aria-labelledby="save-as-title" onSubmit={(event) => { event.preventDefault(); onSave(name); }}>
      <h2 id="save-as-title">Save As</h2>
      <p>Create a separate saved project from the current design.</p>
      <label className="field-label">Project name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} aria-invalid={!name.trim()} /></label>
      {error && <p className="project-library-error" role="alert">{error}</p>}
      <div className="save-as-actions"><button type="button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving || !name.trim()}>{saving ? "Saving…" : "Create project"}</button></div>
    </form>
  </div>;
}
