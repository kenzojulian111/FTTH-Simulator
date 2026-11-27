import { useState, useRef, type ChangeEvent } from "react";
import type { Project } from "../domain/types";

interface ImportKmzDialogProps {
  onImport: (files: File[], name?: string) => Promise<Project>;
  onSuccess: (project: Project) => void;
  onClose: () => void;
}

export function ImportKmzDialog({ onImport, onSuccess, onClose }: ImportKmzDialogProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [projectName, setProjectName] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [backendUnavailable, setBackendUnavailable] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFilesSelected(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    const invalid = files.find((file) => !/\.(kmz|kml)$/i.test(file.name));
    if (invalid) {
      setError(`“${invalid.name}” is not a valid .kmz or .kml file.`);
      return;
    }
    setError(null);
    setSelectedFiles(files);
    if (files.length === 1) setProjectName(files[0].name.replace(/\.(kmz|kml)$/i, ""));
    else if (!projectName.trim()) setProjectName("Combined KMZ Import");
  }

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    handleFilesSelected(e.target.files);
    e.target.value = "";
  }

  async function handleSubmit() {
    if (!selectedFiles.length) {
      setError("Please select at least one KMZ or KML file first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const project = await onImport(selectedFiles, projectName.trim() || undefined);
      onSuccess(project);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to import KMZ file. Check the server connection.";
      setError(message);
      if (message.includes("Could not reach the FastAPI server")) setBackendUnavailable(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="project-library-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <section className="project-library kmz-import-dialog" role="dialog" aria-modal="true" aria-labelledby="kmz-dialog-title">
        <header>
          <div>
            <p className="project-library-kicker">GOOGLE EARTH INTEGRATION</p>
            <h2 id="kmz-dialog-title">Import KMZ / KML Files</h2>
            <p className="project-library-subtitle">
              Select multiple survey files to combine their placemarks, homes, and cable routes into one FTTH project.
            </p>
          </div>
          <button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose} disabled={loading}>
            ×
          </button>
        </header>

        <div className="kmz-dialog-body">
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: "none" }}
            multiple
            accept=".kmz,.kml,application/vnd.google-earth.kmz,application/vnd.google-earth.kml+xml"
            onChange={handleInputChange}
          />

          <div className={`kmz-dropzone ${selectedFiles.length ? "has-file" : ""}`}>
            <div className="kmz-dropzone-icon">{selectedFiles.length ? "🗺️" : "📁"}</div>
            <div className="kmz-file-info">
              {selectedFiles.length ? <><strong>{selectedFiles.length} file{selectedFiles.length === 1 ? "" : "s"} selected</strong><span>{selectedFiles.map((file) => file.name).join(", ")}</span></> : <><strong>Select Google Earth files</strong><span>Choose one or more .kmz or .kml files from your device.</span></>}
              <button type="button" className="secondary-button" onClick={() => fileInputRef.current?.click()} disabled={loading}>
                {selectedFiles.length ? "Choose files" : "Browse files"}
              </button>
            </div>
          </div>

          {selectedFiles.length > 0 && (
            <div className="kmz-field-group">
              <label htmlFor="kmz-project-name">
                Project Name
              </label>
              <input
                id="kmz-project-name"
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Enter project name..."
                disabled={loading}
              />
            </div>
          )}

          <div className="kmz-feature-features-box">
            <h4>Automatic Capabilities:</h4>
            {!backendUnavailable && <p role="note" className="kmz-backend-note">KMZ import and project saving use the same FastAPI backend and SQLite database.</p>}
            <ul>
              <li><strong>Multi-file import:</strong> Select multiple KMZ/KML files at once and combine them into one project.</li>
              <li><strong>Placemark Recognition:</strong> Recognizes OLT, ODC, ODP, poles, manholes, handholes, ONTs, and customer locations from names and folders.</li>
              <li><strong>Cable Routes:</strong> Calculates route geometry length and only suggests optical endpoint links within the import snap tolerance.</li>
              <li><strong>Engineering Inputs:</strong> Missing cable specifications, attenuation, and device losses remain unknown; imported names do not invent equipment specs.</li>
            </ul>
          </div>

          {error && (
            backendUnavailable ? <div className="kmz-backend-error" role="alert">
              <strong>Backend is unavailable.</strong>
              <span>The FastAPI API is not responding. In the project directory, start the application stack:</span>
              <code>npm run dev:stack</code>
              <span>This starts FastAPI on port 8000 and Vite on port 5173.</span>
            </div> : <div className="project-library-error" role="alert" style={{ marginTop: "12px" }}>{error}</div>
          )}
        </div>

        <footer className="kmz-dialog-footer">
          <button type="button" onClick={onClose} disabled={loading} className="secondary-button">
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={handleSubmit}
            disabled={!selectedFiles.length || loading || backendUnavailable}
          >
            {loading ? "Importing & Saving…" : backendUnavailable ? "Start the application stack" : "Import & Open Project"}
          </button>
        </footer>
      </section>
    </div>
  );
}
