import { useState, useRef, type DragEvent, type ChangeEvent } from "react";
import type { Project } from "../domain/types";

interface ImportKmzDialogProps {
  onImport: (file: File, name?: string) => Promise<Project>;
  onSuccess: (project: Project) => void;
  onClose: () => void;
}

export function ImportKmzDialog({ onImport, onSuccess, onClose }: ImportKmzDialogProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [projectName, setProjectName] = useState<string>("");
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileSelected(file: File) {
    const ext = file.name.toLowerCase();
    if (!ext.endsWith(".kmz") && !ext.endsWith(".kml")) {
      setError("Please select a valid Google Earth .kmz or .kml file.");
      return;
    }
    setError(null);
    setSelectedFile(file);
    const cleanName = file.name.replace(/\.(kmz|kml)$/i, "");
    setProjectName(cleanName);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelected(e.target.files[0]);
    }
  }

  async function handleSubmit() {
    if (!selectedFile) {
      setError("Please select a KMZ or KML file first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const project = await onImport(selectedFile, projectName.trim() || undefined);
      onSuccess(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import KMZ file. Check the server connection.");
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
            <h2 id="kmz-dialog-title">Import KMZ / KML Project</h2>
            <p className="project-library-subtitle">
              Convert geographic survey placemarks (OLT, ODC, ODP, Poles, and cable routes) into a fully simulated FTTH design.
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
            accept=".kmz,.kml,application/vnd.google-earth.kmz,application/vnd.google-earth.kml+xml"
            onChange={handleInputChange}
          />

          <div
            className={`kmz-dropzone ${isDragging ? "dragging" : ""} ${selectedFile ? "has-file" : ""}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => !loading && fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
          >
            <div className="kmz-dropzone-icon">
              {selectedFile ? "🗺️" : "📁"}
            </div>
            {selectedFile ? (
              <div className="kmz-file-info">
                <strong>{selectedFile.name}</strong>
                <span>{(selectedFile.size / 1024).toFixed(1)} KB · Ready to import</span>
                <span className="kmz-change-file-link">Click or drag another file to replace</span>
              </div>
            ) : (
              <div className="kmz-dropzone-prompt">
                <strong>Drag &amp; drop your .kmz or .kml file here</strong>
                <span>or click to browse your computer</span>
                <small className="kmz-support-hint">Supports Google Earth Pro, Google Earth Web &amp; My Maps exports</small>
              </div>
            )}
          </div>

          {selectedFile && (
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
            <ul>
              <li><strong>Placemark Recognition:</strong> Auto-classifies OLT, ODC, ODP, Poles, and Customers by name/folder.</li>
              <li><strong>Cable Route Snapping:</strong> Geodesic distance calculation and automatic node endpoint connectivity.</li>
              <li><strong>Optical Splitters:</strong> Auto-provisions integrated 1:8 splitters for immediate budget calculations.</li>
            </ul>
          </div>

          {error && (
            <div className="project-library-error" role="alert" style={{ marginTop: "12px" }}>
              {error}
            </div>
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
            disabled={!selectedFile || loading}
          >
            {loading ? "Importing & Converting…" : "Import & Open Project"}
          </button>
        </footer>
      </section>
    </div>
  );
}
