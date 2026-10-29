import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { CableSegment, ConstructionCostResult, Coordinate, FeatureRef, NodeType, OpticalBudgetResult, PlacementTool, PoleSpanResult, Project, ProjectArea, TopologyConnection, TopologyValidationResult } from "../domain/types";
import { FEATURE_LABELS, NODE_LABELS } from "../domain/types";
import { validateProjectArea } from "../domain/cableClassification";
import { createValidatedConnection } from "../domain/connectionValidation";
import { approximateLengthMeters, createEmptyProject } from "../domain/project";
import { addCableWaypoint, beginCableDrawing, beginCableRouteEdit, cableDraftSaveBlockReason, createCableSegmentFromDrawing, finishCableRoute as finishCableRouteDraft, handleCableDrawingEscape, selectCableEndpoint, undoCableDrawingPoint } from "../domain/cableDrawing";
import type { CableDrawingSession } from "../domain/cableDrawing";
import { createProjectApi, saveThenCalculate } from "../api/projectApi";
import type { GeocodingResult } from "../api/geocodingApi";
import { DebouncedSaveQueue, makeAutosaveSnapshot } from "../api/debouncedSave";
import type { ProjectSummary } from "../api/projectApi";
import { editorReducer } from "../state/editorReducer";
import { describeOpticalPath, opticalPathDisplayIssue, opticalPathDisplayStatus } from "../domain/opticalPathDisplay";
import { resolveBasemapConfig, type BasemapMode } from "../domain/basemap";
import { NetworkMap } from "./NetworkMap";
import { LocationSearch } from "./LocationSearch";
import { Inspector } from "./Inspector";
import { IntermediateOpticalResults } from "./IntermediateOpticalResults";
import { OpticalSettingsPanel } from "./OpticalSettingsPanel";
import { TopologyCanvas } from "./TopologyCanvas";
import { ConnectionDialog } from "./ConnectionDialog";
import { RabReport } from "./reports/RabReport";
import { OpticalEngineeringReport } from "./reports/OpticalEngineeringReport";
import { PoleSpanReport } from "./reports/PoleSpanReport";
import { PoleSpanSettingsPanel } from "./PoleSpanSettingsPanel";
import { ConstructionCostSettingsPanel } from "./ConstructionCostSettingsPanel";
import { EngineeringReportLinks } from "./reports/ReportNavigation";
import type { CanvasPosition, ConnectionEndpoint, PaletteDevice } from "./TopologyCanvas";
import { setLogicalPosition } from "../domain/layout";
import { ProjectLibrary } from "./ProjectLibrary";
import { SaveAsDialog } from "./SaveAsDialog";
import { createNamedProjectCopy, forgetActiveProjectId, readActiveProjectId, rememberActiveProjectId, restoreActiveProject } from "./projectSession";

const makeId = () => crypto.randomUUID();
const timestamp = () => new Date().toISOString();
const LOGICAL_MAP_ORIGIN: Coordinate = [115.22, -8.65];
const LOGICAL_DEVICE_TYPES: PaletteDevice[] = ["olt", "odc", "odp", "ont", "splitter", "pole", "router", "customer"];
const MAP_PLACEMENT_TYPES: PlacementTool[] = ["olt", "odc", "odp", "ont", "splitter", "pole", "router", "customer", "cable"];

function isNodePlacementTool(tool: PlacementTool): tool is Exclude<NodeType, "customer"> {
  return tool !== "customer" && tool !== "cable";
}

export function App() {
  const api = useMemo(() => createProjectApi(), []);
  const [state, dispatch] = useReducer(editorReducer, undefined, () => ({ project: createEmptyProject(), selection: null, dirty: false, revision: 0, generation: 0 }));
  const latestEditorStateRef = useRef(state);
  latestEditorStateRef.current = state;
  const projectEpochRef = useRef(state.generation ?? 0);
  const projectTimestamp = useRef(state.project.updatedAt);
  projectTimestamp.current = state.project.updatedAt;
  const [tool, setTool] = useState<PlacementTool | null>(null);
  const [areaDrawing, setAreaDrawing] = useState(false);
  const [areaPoints, setAreaPoints] = useState<Coordinate[]>([]);
  const [workspaceMode, setWorkspaceMode] = useState<"topology" | "geographic">("topology");
  const [basemapMode, setBasemapMode] = useState<BasemapMode>("normal");
  const [searchResult, setSearchResult] = useState<GeocodingResult | null>(null);
  const [tileErrorMessage, setTileErrorMessage] = useState<string | null>(null);
  const basemapConfig = useMemo(() => resolveBasemapConfig(basemapMode), [basemapMode]);
  const [cableDrawing, setCableDrawing] = useState<CableDrawingSession | null>(null);
  const cableDrawingRef = useRef(cableDrawing);
  cableDrawingRef.current = cableDrawing;
  const [previewPoint, setPreviewPoint] = useState<Coordinate | null>(null);
  const [pendingCable, setPendingCable] = useState<CableSegment | null>(null);
  const [failedCableId, setFailedCableId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const activeProjectIdRef = useRef(activeProjectId);
  activeProjectIdRef.current = activeProjectId;
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSuccessfulSaveAt, setLastSuccessfulSaveAt] = useState<string | null>(null);
  const [switchingProject, setSwitchingProject] = useState(false);
  const switchingProjectRef = useRef(false);
  const [autosaveWake, setAutosaveWake] = useState(0);
  const [projectLibraryOpen, setProjectLibraryOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsSaving, setSaveAsSaving] = useState(false);
  const [saveAsError, setSaveAsError] = useState<string | null>(null);
  const restoreStarted = useRef(false);
  const [connectionDialog, setConnectionDialog] = useState<{ fromNodeId?: string; toNodeId?: string; cableSegmentId?: string } | null>(null);
  const [opticalResult, setOpticalResult] = useState<OpticalBudgetResult | null>(null);
  const [costResult, setCostResult] = useState<ConstructionCostResult | null>(null);
  const [opticalError, setOpticalError] = useState<string | null>(null);
  const [topologyValidation, setTopologyValidation] = useState<TopologyValidationResult | null>(null);
  const [topologyValidationError, setTopologyValidationError] = useState<string | null>(null);
  const [costError, setCostError] = useState<string | null>(null);
  const [reportView, setReportView] = useState<"rab" | "optical" | "poles" | null>(null);
  const [calculating, setCalculating] = useState<"optical" | "cost" | "poles" | null>(null);
  const [poleSpanResult, setPoleSpanResult] = useState<PoleSpanResult | null>(null);
  const [poleSpanError, setPoleSpanError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const saveQueue = useMemo(() => new DebouncedSaveQueue<Project, Project>({
    delayMs: 2000,
    save: (snapshot) => api.saveProject(snapshot.value),
    isCurrentProject: (snapshot) => {
      const latest = latestEditorStateRef.current;
      return mountedRef.current && !switchingProjectRef.current
        && projectEpochRef.current === snapshot.generation
        && latest.generation === snapshot.generation
        && latest.project.id === snapshot.projectId;
    },
    isCurrentRevision: (snapshot) => latestEditorStateRef.current.revision === snapshot.revision,
    canSave: (snapshot, trigger) => {
      const latest = latestEditorStateRef.current;
      const activeIdMatches = activeProjectIdRef.current === snapshot.projectId;
      return !cableDraftSaveBlockReason(cableDrawingRef.current)
        && Boolean(snapshot.value.name.trim())
        && (trigger === "manual" || (activeIdMatches && latest.dirty));
    },
    onSaving: (_snapshot, trigger) => { setSaving(true); setSaveStatus("saving"); setSaveError(null); if (trigger === "manual") setNotice(""); },
    onSaved: (savedProject, snapshot, isLatestRevision, trigger) => {
      setSaving(false);
      setLastSuccessfulSaveAt(new Date().toISOString());
      setActiveProjectId(savedProject.id);
      if (api.mode === "http") rememberActiveProjectId(window.sessionStorage, savedProject.id);
      if (!isLatestRevision) { setSaveStatus("idle"); return; }
      dispatch({ type: "saved", project: savedProject, expectedRevision: snapshot.revision, expectedGeneration: snapshot.generation });
      setSaveStatus("saved");
      setSaveError(null);
      if (trigger === "manual") setNotice(api.mode === "memory" ? "Saved in this session only. Configure VITE_API_BASE_URL for backend persistence." : "Project saved.");
    },
    onFailed: (error, _snapshot, _isLatestRevision, trigger) => {
      setSaving(false);
      const message = error instanceof Error ? error.message : "Project save failed. Check the server and retry.";
      setSaveStatus("failed");
      setSaveError(message);
      setNotice(`${trigger === "autosave" ? "Autosave failed" : "Save failed"}: ${message}`);
    },
  }), [api]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; saveQueue.cancelPending(); };
  }, [saveQueue]);

  useEffect(() => {
    const candidate = makeAutosaveSnapshot({
      value: state.project,
      projectId: state.project.id,
      activeProjectId,
      revision: state.revision ?? 0,
      generation: state.generation ?? 0,
      dirty: state.dirty,
      hasIncompleteDraft: Boolean(cableDraftSaveBlockReason(cableDrawing)),
      switchingProject,
      blocked: calculating !== null,
    });
    const snapshot = candidate ? { ...candidate, value: structuredClone(candidate.value) } : null;
    saveQueue.schedule(snapshot);
    return () => saveQueue.cancelPending();
  }, [saveQueue, state.project, state.revision, state.generation, state.dirty, activeProjectId, cableDrawing, switchingProject, calculating, autosaveWake]);

  useEffect(() => { setOpticalResult(null); setCostResult(null); setPoleSpanResult(null); setOpticalError(null); setCostError(null); setPoleSpanError(null); setTopologyValidation(null); setTopologyValidationError(null); }, [state.revision, state.generation]);

  useEffect(() => {
    if (tool !== "cable" || !cableDrawing) return;
    const escape = (event: KeyboardEvent) => {
      handleCableDrawingEscape(event.key, () => {
        cancelCableDrawing();
      });
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [tool, cableDrawing]);

  useEffect(() => {
    if (restoreStarted.current) return;
    restoreStarted.current = true;
    if (api.mode !== "http") return;
    const id = readActiveProjectId(window.sessionStorage);
    if (!id) return;
    const startingTimestamp = projectTimestamp.current;
    void restoreActiveProject(api, window.sessionStorage).then((project) => {
      if (!project) return;
      if (projectTimestamp.current !== startingTimestamp) return;
      projectEpochRef.current += 1;
      dispatch({ type: "load", project });
      setActiveProjectId(project.id);
      setSaveStatus("saved"); setSaveError(null); setLastSuccessfulSaveAt(project.updatedAt);
      setNotice(`Restored “${project.name}” from the project server.`);
    }).catch((error: unknown) => {
      if (error && typeof error === "object" && "status" in error && error.status === 404) {
        forgetActiveProjectId(window.sessionStorage);
        setActiveProjectId(null);
        setNotice("The previously active project was deleted or is no longer available. Open My Projects to choose another.");
      } else {
        setNotice(error instanceof Error ? `Could not restore the active project: ${error.message}` : "Could not restore the active project. Open My Projects to retry.");
      }
    });
  }, [api]);

  function place(point: Coordinate) {
    if (areaDrawing) { setAreaPoints((points) => [...points, point]); return; }
    if (!tool) return;
    const now = timestamp();
    if (tool === "cable") {
      if (cableDrawing?.phase !== "route") {
        setNotice("The route is finished. Select its start and destination nodes on the map.");
        return;
      }
      const transition = addCableWaypoint(cableDrawing, point);
      setCableDrawing(transition.session); setPreviewPoint(null);
      setNotice(transition.message ?? (transition.session.coordinates.length === 1 ? "Route started. Click along the road to add waypoints, then finish the route." : "Route waypoint added."));
      return;
    }
    if (tool === "customer") {
      const customer = { id: makeId(), name: `Customer ${state.project.customers.length + 1}`, address: "", location: { type: "Point" as const, coordinates: point }, status: "planned" as const, properties: { geographicPositionSet: true }, createdAt: now, updatedAt: now };
      dispatch({ type: "add-customer", customer });
      setTool(null);
      return;
    }
    if (isNodePlacementTool(tool)) {
      const type = tool;
      const node = { id: makeId(), type, name: `${NODE_LABELS[type]} ${state.project.nodes.filter((x) => x.type === type).length + 1}`, location: { type: "Point" as const, coordinates: point }, properties: { geographicPositionSet: true, ...(type === "pole" ? { status: "unverified" } : {}) }, createdAt: now, updatedAt: now };
      dispatch({ type: "add-node", node });
    }
    setTool(null);
  }

  function addLogicalDevice(type: PaletteDevice, position: CanvasPosition) {
    const now = timestamp();
    if (type === "customer") {
      const customer = { id: makeId(), name: `Customer ${state.project.customers.length + 1}`, address: "", location: { type: "Point" as const, coordinates: LOGICAL_MAP_ORIGIN }, status: "planned" as const, properties: setLogicalPosition({ geographicPositionSet: false }, position), createdAt: now, updatedAt: now };
      dispatch({ type: "add-customer", customer });
      setNotice("Customer added to logical layout. Place it on the geographic map to set its coordinates.");
      return;
    }
    const nodeType: NodeType = type;
    const node = { id: makeId(), type: nodeType, name: `${NODE_LABELS[nodeType]} ${state.project.nodes.filter((x) => x.type === nodeType).length + 1}`, location: { type: "Point" as const, coordinates: LOGICAL_MAP_ORIGIN }, properties: setLogicalPosition({ geographicPositionSet: false, ...(nodeType === "pole" ? { status: "unverified" } : {}) }, position), createdAt: now, updatedAt: now };
    dispatch({ type: "add-node", node });
    setNotice(`${NODE_LABELS[nodeType]} added to logical layout. Place it on the geographic map to set its coordinates.`);
  }

  function onCableNodeClick(node: (typeof state.project.nodes)[number]) {
    if (node.properties.geographicPositionSet === false) {
      setNotice(`${node.name} has no geographic placement. Place it on the geographic map before assigning cable endpoints.`);
      return;
    }
    if (cableDrawing?.phase === "route") {
      setNotice("Add route points anywhere on the map first, then choose Finish route before assigning endpoints.");
      return;
    }
    const transition = selectCableEndpoint(cableDrawing, node.id, node.location.coordinates);
    setCableDrawing(transition.session); setPreviewPoint(null);
    setNotice(transition.message ?? "");
  }

  function cancelCableDrawing() {
    const hasCommittedCable = Boolean(cableDrawing?.committedCableId);
    setCableDrawing(null); setPreviewPoint(null); setTool(null); setPendingCable(null); setConnectionDialog(null);
    setNotice(hasCommittedCable
      ? "Endpoint assignment cancelled. The committed cable geometry remains in the project without a topology connection."
      : "Cable draft cancelled. No draft geometry or topology connection was committed.");
  }

  function finishCableRoute() {
    const transition = finishCableRouteDraft(cableDrawing);
    if (transition.session.phase !== "endpoints" || cableDrawing?.phase !== "route") {
      setCableDrawing(transition.session); setPreviewPoint(null); setNotice(transition.message ?? "");
      return;
    }
    const existingCable = cableDrawing.editingCableId
      ? state.project.cableSegments.find((item) => item.id === cableDrawing.editingCableId)
      : undefined;
    if (cableDrawing.editingCableId && !existingCable) {
      setNotice("The cable being edited no longer exists. Cancel this route and select the cable again.");
      return;
    }
    const connected = existingCable && state.project.connections.some((connection) => connection.cableSegmentId === existingCable.id);
    const cable = createCableSegmentFromDrawing(transition.session, existingCable?.id ?? makeId(), existingCable?.name ?? `Cable ${state.project.cableSegments.length + 1}`, timestamp());
    if (!cable) { setNotice(transition.message ?? "Add at least two route points before finishing."); return; }
    const committed = existingCable
      ? { ...existingCable, ...cable, properties: existingCable.properties, createdAt: existingCable.createdAt }
      : cable;
    if (!connected) {
      dispatch(existingCable
        ? { type: "replace-unconnected-cable", cable: committed }
        : { type: "add-cable", cable: committed });
    }
    setCableDrawing({ ...transition.session, committedCableId: connected ? undefined : committed.id });
    setPreviewPoint(null);
    setNotice(connected
      ? `${existingCable.name} route is ready for validation. The current committed geometry stays in place until the connection is approved.`
      : `${committed.name} geometry committed as an unconnected cable. It will autosave; assign endpoints to validate a topology connection.`);
  }

  function validateAndCreateCableConnection() {
    if (!cableDrawing?.startNodeId || !cableDrawing.endNodeId) {
      setNotice("Select both a start node and a destination node before validating the cable connection.");
      return;
    }
    const existingCable = cableDrawing.editingCableId
      ? state.project.cableSegments.find((item) => item.id === cableDrawing.editingCableId)
      : undefined;
    const committedCable = cableDrawing.committedCableId
      ? state.project.cableSegments.find((item) => item.id === cableDrawing.committedCableId)
      : undefined;
    const cable = committedCable
      ? { ...committedCable, startNodeId: cableDrawing.startNodeId, endNodeId: cableDrawing.endNodeId, updatedAt: timestamp() }
      : createCableSegmentFromDrawing(cableDrawing, cableDrawing.editingCableId ?? makeId(), existingCable?.name ?? `Cable ${state.project.cableSegments.length + 1}`, timestamp());
    if (!cable) {
      setNotice("The route draft is incomplete. Add a route point and select both endpoints.");
      return;
    }
    setFailedCableId(null);
    const isCommittedGeometry = cableDrawing.committedCableId === cable.id;
    setPendingCable(existingCable && !isCommittedGeometry ? { ...existingCable, ...cable, properties: existingCable.properties, createdAt: existingCable.createdAt } : null);
    setConnectionDialog({ fromNodeId: cableDrawing.startNodeId, toNodeId: cableDrawing.endNodeId, cableSegmentId: cable.id });
    setNotice("");
  }

  async function save() {
    const draftSaveBlockReason = cableDraftSaveBlockReason(cableDrawing);
    if (draftSaveBlockReason) {
      setNotice(draftSaveBlockReason);
      return;
    }
    if (!state.project.name.trim()) { setNotice("Add a project name before saving."); return; }
    await saveQueue.saveNow({
      value: structuredClone(state.project),
      projectId: state.project.id,
      revision: state.revision ?? 0,
      generation: state.generation ?? 0,
    });
  }

  async function refreshProjects() {
    setProjectsLoading(true); setProjectsError(null);
    try { setProjects(await api.listProjects()); }
    catch (error) { setProjectsError(error instanceof Error ? error.message : "Could not load saved projects. Check the backend and try again."); }
    finally { setProjectsLoading(false); }
  }

  function openProjectLibrary() {
    setProjectLibraryOpen(true);
    void refreshProjects();
  }

  async function loadProject(summary: ProjectSummary) {
    if ((state.dirty || cableDraftSaveBlockReason(cableDrawing)) && !window.confirm("Discard unsaved project changes and any unfinished cable route, then open another project?")) return;
    setLoadingProjectId(summary.id); setProjectsError(null);
    switchingProjectRef.current = true;
    setSwitchingProject(true);
    saveQueue.cancelPending();
    try {
      await saveQueue.waitForIdle();
      const project = await api.getProject(summary.id);
      projectEpochRef.current += 1;
      dispatch({ type: "load", project }); setTool(null); setCableDrawing(null); setPreviewPoint(null);
      setConnectionDialog(null);
      setActiveProjectId(project.id); if (api.mode === "http") rememberActiveProjectId(window.sessionStorage, project.id);
      setSaveStatus("saved"); setSaveError(null); setLastSuccessfulSaveAt(project.updatedAt);
      setProjectLibraryOpen(false);
      setNotice(api.mode === "memory" ? "Project loaded from this session." : `Loaded “${project.name}”.`);
    } catch (error) {
      const notFound = error && typeof error === "object" && "status" in error && error.status === 404;
      const message = notFound ? "This project was deleted or is no longer available. The list has been refreshed; choose another project." : error instanceof Error ? error.message : "Project could not be loaded.";
      if (notFound) await refreshProjects();
      setProjectsError(message);
    } finally { switchingProjectRef.current = false; setSwitchingProject(false); setLoadingProjectId(null); setAutosaveWake((value) => value + 1); }
  }

  async function saveAs(name: string) {
    const draftSaveBlockReason = cableDraftSaveBlockReason(cableDrawing);
    if (draftSaveBlockReason) {
      setSaveAsError(draftSaveBlockReason.replace("the project", "a project copy"));
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) { setSaveAsError("Enter a project name."); return; }
    const copy = createNamedProjectCopy(state.project, trimmedName, makeId(), timestamp());
    setSaveAsSaving(true); setSaveAsError(null);
    try {
      const saved = await api.saveProject(copy);
      projectEpochRef.current += 1;
      dispatch({ type: "load", project: saved });
      setActiveProjectId(saved.id); if (api.mode === "http") rememberActiveProjectId(window.sessionStorage, saved.id);
      setSaveStatus("saved"); setSaveError(null); setLastSuccessfulSaveAt(new Date().toISOString());
      setSaveAsOpen(false);
      setNotice(api.mode === "memory" ? "New copy saved in this session only. Configure VITE_API_BASE_URL for backend persistence." : "New project saved.");
      if (projectLibraryOpen) await refreshProjects();
    } catch (error) { setSaveAsError(error instanceof Error ? error.message : "Could not create this project."); }
    finally { setSaveAsSaving(false); }
  }

  async function calculate(kind: "optical" | "cost" | "poles") {
    if (cableDraftSaveBlockReason(cableDrawing)) {
      setNotice("This cable route is still a draft. Validate and connect it, or cancel it before saving for a calculation.");
      return;
    }
    setCalculating(kind); setNotice("");
    saveQueue.cancelPending();
    if (kind === "optical") { setOpticalResult(null); setOpticalError(null); }
    else if (kind === "cost") { setCostResult(null); setCostError(null); }
    else { setPoleSpanResult(null); setPoleSpanError(null); }
    try {
      await saveQueue.waitForIdle();
      const projectToCalculate = latestEditorStateRef.current.project;
      const requestedRevision = latestEditorStateRef.current.revision ?? 0;
      const requestedGeneration = latestEditorStateRef.current.generation ?? 0;
      let savedProjectForValidation = projectToCalculate;
      const commitCalculationSave = (savedProject: typeof projectToCalculate) => {
        const latest = latestEditorStateRef.current;
        if (latest.project.id !== projectToCalculate.id || latest.generation !== requestedGeneration || latest.revision !== requestedRevision) {
          setNotice("The project changed while saving. Run the calculation again to use the latest edits.");
          return false;
        }
        savedProjectForValidation = savedProject;
        dispatch({ type: "saved", project: savedProject, expectedRevision: requestedRevision, expectedGeneration: requestedGeneration });
        setActiveProjectId(savedProject.id); if (api.mode === "http") rememberActiveProjectId(window.sessionStorage, savedProject.id);
        setSaveStatus("saved"); setSaveError(null); setLastSuccessfulSaveAt(new Date().toISOString());
        return true;
      };
      if (kind === "optical") {
        setTopologyValidation(null); setTopologyValidationError(null);
        const outcome = await saveThenCalculate(api, projectToCalculate, commitCalculationSave, async (id) => {
          if (api.mode === "http") {
            try {
              const validation = await api.validateTopology(id, savedProjectForValidation);
              if (latestEditorStateRef.current.project.id === id && latestEditorStateRef.current.revision === requestedRevision && latestEditorStateRef.current.generation === requestedGeneration) setTopologyValidation(validation);
            } catch (validationError) {
              if (latestEditorStateRef.current.project.id === id && latestEditorStateRef.current.revision === requestedRevision && latestEditorStateRef.current.generation === requestedGeneration) setTopologyValidationError(validationError instanceof Error ? validationError.message : "Project topology validation failed.");
            }
          }
          return api.calculateOpticalBudget(id);
        });
        if (outcome && latestEditorStateRef.current.project.id === outcome.project.id && latestEditorStateRef.current.revision === requestedRevision && latestEditorStateRef.current.generation === requestedGeneration) setOpticalResult(outcome.result);
      } else if (kind === "cost") {
        const outcome = await saveThenCalculate(api, projectToCalculate, commitCalculationSave, (id) => api.calculateConstructionCost(id));
        if (outcome && latestEditorStateRef.current.project.id === outcome.project.id && latestEditorStateRef.current.revision === requestedRevision && latestEditorStateRef.current.generation === requestedGeneration) setCostResult(outcome.result);
      } else {
        const outcome = await saveThenCalculate(api, projectToCalculate, commitCalculationSave, (id) => api.calculatePoleSpans(id));
        if (outcome && latestEditorStateRef.current.project.id === outcome.project.id && latestEditorStateRef.current.revision === requestedRevision && latestEditorStateRef.current.generation === requestedGeneration) setPoleSpanResult(outcome.result);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Calculation failed.";
      if (kind === "optical") setOpticalError(message); else if (kind === "cost") setCostError(message); else setPoleSpanError(message);
      setNotice(message);
    }
    finally { setCalculating(null); }
  }

  function deleteSelected() {
    if (!state.selection) return;
    if (state.selection.kind === "node" && (cableDrawing?.startNodeId === state.selection.id || cableDrawing?.endNodeId === state.selection.id)) cancelCableDrawing();
    dispatch({ type: "delete", ref: state.selection });
  }

  function createConnection(connection: TopologyConnection) {
    const existingCable = pendingCable ? state.project.cableSegments.find((cable) => cable.id === pendingCable.id) : undefined;
    const previousConnection = existingCable ? state.project.connections.find((item) => item.cableSegmentId === existingCable.id) : undefined;
    const projectForConnection = pendingCable
      ? {
          ...state.project,
          cableSegments: existingCable
            ? state.project.cableSegments.map((cable) => cable.id === pendingCable.id ? pendingCable : cable)
            : [...state.project.cableSegments, pendingCable],
          connections: previousConnection
            ? state.project.connections.filter((item) => item.id !== previousConnection.id)
            : state.project.connections,
        }
      : state.project;
    const result = createValidatedConnection(projectForConnection, connection, connection.id);
    if (!result.ok) { setNotice(result.validation.message); return; }
    if (pendingCable) {
      if (existingCable) {
        dispatch({
          type: "replace-cable-connection",
          cable: pendingCable,
          connection: previousConnection ? { ...result.connection, id: previousConnection.id } : result.connection,
          previousConnectionId: previousConnection?.id,
        });
      } else {
        dispatch({ type: "add-cable-connection", cable: pendingCable, connection: result.connection });
      }
      setPendingCable(null); setCableDrawing(null); setPreviewPoint(null); setTool(null); setFailedCableId(null);
      setConnectionDialog(null);
      setNotice("Cable route and validated topology connection added. The route is saved with the project.");
      return;
    }
    dispatch({ type: "add-connection", connection: result.connection });
    if (cableDrawing?.committedCableId === connection.cableSegmentId) {
      setCableDrawing(null); setPreviewPoint(null); setTool(null); setFailedCableId(null);
    }
    setConnectionDialog(null);
    setNotice("Connection created for the committed cable.");
  }

  function connectCanvasItems(source: ConnectionEndpoint, target: ConnectionEndpoint) {
    const nodeEndpoint = source.kind === "node" ? source : target.kind === "node" ? target : null;
    const customerEndpoint = source.kind === "customer" ? source : target.kind === "customer" ? target : null;
    if (nodeEndpoint && customerEndpoint) {
      const node = state.project.nodes.find((item) => item.id === nodeEndpoint.id);
      if (node?.type !== "ont") { setNotice("Customers can only connect to an ONT. Drag from an ONT port."); return; }
      dispatch({ type: "customer-ont", id: customerEndpoint.id, ontNodeId: node.id });
      setNotice("Customer linked to ONT.");
      return;
    }
    if (source.kind !== "node" || target.kind !== "node") { setNotice("Connect a network node to another node, or an ONT to a customer."); return; }
    if (source.id === target.id) { setNotice("A topology connection must join two different devices."); return; }
    const availableCable = state.project.cableSegments.find((cable) => !state.project.connections.some((connection) => connection.cableSegmentId === cable.id));
    setConnectionDialog({ fromNodeId: source.id, toNodeId: target.id, cableSegmentId: availableCable?.id ?? "" });
    setNotice("");
  }

  const selected = state.selection;
  const cableDrafting = tool === "cable";
  const cableDraftBlockReason = cableDraftSaveBlockReason(cableDrawing);
  const hasCableDraft = cableDraftBlockReason !== null;
  const noticeIsError = ["could not", "error", "at least", "not found", "failed", "unavailable", "only connect", "draw a cable", "choose the cable", "no longer exists", "changed while saving", "release the connection", "no geographic", "select a geographically", "different node", "already selected"].some((phrase) => notice.toLowerCase().includes(phrase));
  const placeTool = (next: PlacementTool) => {
    if (cableDrafting) {
      const hasDraft = Boolean(cableDraftSaveBlockReason(cableDrawing));
      if (hasDraft && !window.confirm("Discard this unfinished cable route?")) return;
      setCableDrawing(null); setPreviewPoint(null); setPendingCable(null); setConnectionDialog(null);
      setTool(null);
      setNotice(hasDraft ? "Unfinished cable draft discarded." : "");
      return;
    }
    if (next === "cable") {
      const selectedCable = state.selection?.kind === "cable"
        ? state.project.cableSegments.find((cable) => cable.id === state.selection?.id)
        : undefined;
      if (selectedCable) {
        const firstPoint = selectedCable.geometry.coordinates[0];
        const lastPoint = selectedCable.geometry.coordinates[selectedCable.geometry.coordinates.length - 1];
        const startLocation = state.project.nodes.find((node) => node.id === selectedCable.startNodeId)?.location.coordinates ?? firstPoint;
        const endLocation = state.project.nodes.find((node) => node.id === selectedCable.endNodeId)?.location.coordinates ?? lastPoint;
        setCableDrawing(beginCableRouteEdit(selectedCable, startLocation, endLocation));
        setNotice(`Editing ${selectedCable.name}. Its current geometry is preserved until validation succeeds.`);
      } else {
        setCableDrawing(beginCableDrawing());
        setNotice("Cable drawing active. Click the map to place the first route point.");
      }
      setPreviewPoint(null); setPendingCable(null);
      setTool("cable");
      return;
    }
    setTool((current) => current === next ? null : next);
    setNotice("");
  };
  const undoCablePoint = () => { setCableDrawing((current) => undoCableDrawingPoint(current)); setPreviewPoint(null); };
  const onMapMove = (point: Coordinate | null) => {
    if (!cableDrafting || cableDrawing?.phase !== "route" || (!cableDrawing.startLocation && cableDrawing.coordinates.length === 0)) return;
    setPreviewPoint(point);
  };
  const previewCoordinates = cableDrawing ? [
    ...(cableDrawing.startLocation ? [cableDrawing.startLocation] : []),
    ...cableDrawing.coordinates,
    ...(cableDrawing.phase === "endpoints" && cableDrawing.endLocation ? [cableDrawing.endLocation] : cableDrawing.phase === "route" && previewPoint ? [previewPoint] : []),
  ] : [];
  const committedDrawingCable = cableDrawing?.committedCableId
    ? state.project.cableSegments.find((cable) => cable.id === cableDrawing.committedCableId)
    : undefined;
  const previewLength = committedDrawingCable?.lengthM ?? approximateLengthMeters(committedDrawingCable?.geometry.coordinates ?? previewCoordinates);
  const pendingExistingConnection = pendingCable
    ? state.project.connections.find((connection) => connection.cableSegmentId === pendingCable.id)
    : undefined;
  const connectionProject = pendingCable
    ? {
        ...state.project,
        cableSegments: state.project.cableSegments.some((cable) => cable.id === pendingCable.id)
          ? state.project.cableSegments.map((cable) => cable.id === pendingCable.id ? pendingCable : cable)
          : [...state.project.cableSegments, pendingCable],
        connections: pendingExistingConnection
          ? state.project.connections.filter((connection) => connection.id !== pendingExistingConnection.id)
          : state.project.connections,
      }
    : state.project;

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-mark"><span className="brand-glyph">⌁</span><div><strong>FIBER<span>PLAN</span></strong><small>NETWORK PLANNING STUDIO</small></div></div>
      <div className="project-title"><input aria-label="Project name" value={state.project.name} onChange={(event) => dispatch({ type: "project-name", name: event.target.value })} /><span className="saved-indicator" title={saveError ?? undefined}>{hasCableDraft ? state.dirty ? "Route draft · edits unsaved" : "Route draft · not saved" : saveStatus === "saving" ? "Saving..." : saveStatus === "failed" ? "Save failed" : state.dirty ? "Unsaved changes" : activeProjectId ? "Saved" : "Draft"}</span></div>
      <div className="workspace-tabs" role="tablist" aria-label="Editor mode"><button role="tab" aria-selected={workspaceMode === "topology"} className={workspaceMode === "topology" ? "active" : ""} onClick={() => setWorkspaceMode("topology")}>Logical topology</button><button role="tab" aria-selected={workspaceMode === "geographic"} className={workspaceMode === "geographic" ? "active" : ""} onClick={() => setWorkspaceMode("geographic")}>Geographic map</button></div>
      {cableDrafting && workspaceMode === "topology" && <span className="draw-paused-indicator">Cable drawing paused <button onClick={cancelCableDrawing}>Cancel</button></span>}
      <div className="top-actions"><span className={`api-status ${api.mode}`}>{api.mode === "memory" ? "LOCAL SESSION" : "API CONFIGURED"}</span>{lastSuccessfulSaveAt && <span className="last-saved-at">Last saved {new Date(lastSuccessfulSaveAt).toLocaleTimeString()}</span>}{saveStatus === "failed" && <span className="save-failed-label" role="status" title={saveError ?? undefined}>Save failed · retry</span>}{hasCableDraft && <span className="save-draft-hint" role="status">Confirm or cancel route to save</span>}<button className="load-button" onClick={openProjectLibrary}>My Projects</button><button className="load-button" onClick={() => { setSaveAsError(null); setSaveAsOpen(true); }} disabled={hasCableDraft || saving} title={cableDraftBlockReason ?? undefined}>Save As</button><button className="primary-button" onClick={save} disabled={saving || hasCableDraft || calculating !== null} title={cableDraftBlockReason ?? saveError ?? undefined}>{saving ? "Saving..." : hasCableDraft ? "Route incomplete" : saveStatus === "failed" ? "Retry Save" : state.dirty ? "Save changes" : "Save"}<span>↗</span></button></div>
    </header>
    <div className={`workspace ${reportView ? "report-mode" : ""}`}>
      {reportView ? <div className="report-workspace">{reportView === "rab"
        ? <RabReport projectName={state.project.name} result={costResult} loading={calculating === "cost"} error={costError} routerCount={state.project.nodes.filter((node) => node.type === "router").length} onBack={() => setReportView(null)} />
        : reportView === "optical" ? <OpticalEngineeringReport project={state.project} result={opticalResult} loading={calculating === "optical"} error={opticalError} onBack={() => setReportView(null)} onSelectNode={(id) => { setReportView(null); setWorkspaceMode("geographic"); dispatch({ type: "select", selection: { kind: "node", id } }); }} onSelectEntity={(selection) => { setReportView(null); setWorkspaceMode("geographic"); dispatch({ type: "select", selection }); }} />
          : <PoleSpanReport project={state.project} result={poleSpanResult} loading={calculating === "poles"} error={poleSpanError} onBack={() => setReportView(null)} onSelect={(kind, id) => { setReportView(null); setWorkspaceMode("geographic"); dispatch({ type: "select", selection: { kind, id } }); }} />}</div> : <>
      <aside className="left-rail">
        <div className="rail-heading"><span>{workspaceMode === "topology" ? "DEVICE PALETTE" : "BUILD NETWORK"}</span><span className="step-number">01</span></div>
        <p className="rail-description">{workspaceMode === "topology" ? "Drag a device onto the logical canvas." : "Choose an object, then click the map to place it."}</p>
        {workspaceMode === "geographic" && cableDrafting && <div className={`draw-card ${cableDrawing?.committedCableId ? "committed" : ""} ${failedCableId === (cableDrawing?.committedCableId ?? cableDrawing?.editingCableId) ? "validation-failed" : ""}`} role="region" aria-label="Cable drawing controls">
          <strong>{cableDrawing?.committedCableId ? "Committed cable · endpoint assignment" : "Fiber cable drawing · manual road tracing"}</strong>
          <span>{cableDrawing?.coordinates.length ?? 0} route point(s) · {committedDrawingCable?.lengthM != null ? `${Math.round(previewLength)} m saved` : `approx. ${Math.round(previewLength)} m`}</span>
          {cableDrawing?.phase !== "endpoints" ? <>
            <small>{cableDrawing?.coordinates.length ? "Click along the visible road centerline to add route waypoints." : "Drawing is active. Click any map location to start the route, then trace the road with more clicks."} Finish the route before selecting devices. Press Escape to cancel.</small>
            <div className="draw-actions"><button onClick={undoCablePoint} disabled={!cableDrawing?.coordinates.length}>Undo last point</button><button onClick={finishCableRoute} className="accent-button" disabled={(cableDrawing?.coordinates.length ?? 0) < 2 && !cableDrawing?.editingCableId}>Finish route</button><button onClick={cancelCableDrawing}>Cancel</button></div>
          </> : <>
            <small>{cableDrawing.committedCableId && <b>Committed unconnected cable. </b>}{!cableDrawing.startNodeId ? "Route geometry is saved independently. Select a start device, then a different destination when ready to connect it." : !cableDrawing.endNodeId ? `Start: ${state.project.nodes.find((node) => node.id === cableDrawing.startNodeId)?.name ?? "Selected"}. Now click a destination device.` : `Route endpoints: ${state.project.nodes.find((node) => node.id === cableDrawing.startNodeId)?.name ?? "Start"} → ${state.project.nodes.find((node) => node.id === cableDrawing.endNodeId)?.name ?? "Destination"}. The backend must approve the connection.`} Devices need geographic positions. Press Escape to cancel.</small>
            {failedCableId === (cableDrawing.committedCableId ?? cableDrawing.editingCableId) && <small role="status">Connection validation failed. The committed geometry is preserved; adjust the endpoints and retry.</small>}
            <div className="draw-actions"><button onClick={undoCablePoint} disabled={!cableDrawing.endNodeId && !cableDrawing.startNodeId}>Undo selection</button><button onClick={() => { setCableDrawing((current) => current ? { ...current, phase: "route", editingCableId: current.editingCableId ?? current.committedCableId, startNodeId: null, startLocation: null, endNodeId: null, endLocation: null } : current); setPreviewPoint(null); }} disabled={cableDrawing.coordinates.length === 0}>Edit route</button><button onClick={validateAndCreateCableConnection} className="accent-button" disabled={!cableDrawing.startNodeId || !cableDrawing.endNodeId}>{failedCableId === (cableDrawing.committedCableId ?? cableDrawing.editingCableId) ? "Retry validation" : "Validate & connect"}</button><button onClick={cancelCableDrawing}>Cancel</button></div>
          </>}
        </div>}
        {workspaceMode === "topology" ? <div className="tool-list">{LOGICAL_DEVICE_TYPES.map((type) => <button key={type} className="tool-button" draggable onDragStart={(event) => { event.dataTransfer.setData("application/x-ftth-device", type); event.dataTransfer.effectAllowed = "copy"; }} onClick={() => addLogicalDevice(type, { x: 460 + ((state.project.nodes.length + state.project.customers.length) % 3) * 30, y: 300 + ((state.project.nodes.length + state.project.customers.length) % 3) * 30 })}><span className={`tool-symbol symbol-${type}`}>{type === "customer" ? "⌂" : type === "pole" ? "P" : type === "splitter" ? "1:8" : type === "router" ? "R" : type.toUpperCase()}</span><span>{FEATURE_LABELS[type]}</span><span className="tool-plus">⠿</span></button>)}</div> : <div className="tool-list">
          <button className={`tool-button ${areaDrawing ? "active" : ""}`} onClick={() => { setTool(null); setCableDrawing(null); setAreaDrawing(true); setAreaPoints([]); }}>Draw Area</button>{MAP_PLACEMENT_TYPES.map((type) => <button key={type} className={`tool-button ${tool === type ? "active" : ""}`} onClick={() => placeTool(type)}><span className={`tool-symbol symbol-${type}`}>{type === "customer" ? "⌂" : type === "cable" ? "⌁" : type === "pole" ? "P" : type === "splitter" ? "1:8" : type === "router" ? "R" : type.toUpperCase()}</span><span>{FEATURE_LABELS[type]}</span><span className="tool-plus">+</span></button>)}
        </div>}
        {areaDrawing && <div className="draw-card" aria-label="Area drawing controls"><strong>Draw project area</strong><span>{areaPoints.length} vertices</span><div className="draw-actions"><button onClick={() => setAreaPoints((points) => points.slice(0, -1))} disabled={!areaPoints.length}>Undo</button><button className="accent-button" disabled={areaPoints.length < 3} onClick={() => { const ring = [...areaPoints, areaPoints[0]]; const area: ProjectArea = { id: makeId(), name: `Area ${(state.project.areas ?? []).length + 1}`, geometry: { type: "Polygon", coordinates: [ring] }, fillColor: "#22c55e", fillOpacity: 0.2, classification: "service_area" }; const error = validateProjectArea(area); if (error) { setNotice(error); return; } dispatch({ type: "add-area", area }); setAreaDrawing(false); setAreaPoints([]); }}>Finish area</button><button onClick={() => { setAreaDrawing(false); setAreaPoints([]); }}>Cancel</button></div></div>}
        <div className="network-summary"><div className="rail-heading"><span>PROJECT OBJECTS</span><span className="step-number">{state.project.nodes.length + state.project.customers.length + state.project.cableSegments.length}</span></div>
          {[...state.project.nodes.map((x) => ({ id: x.id, name: x.name, type: x.type.toUpperCase(), ref: { kind: "node" as const, id: x.id } })), ...state.project.customers.map((x) => ({ id: x.id, name: x.name, type: "CUSTOMER", ref: { kind: "customer" as const, id: x.id } })), ...state.project.cableSegments.map((x) => ({ id: x.id, name: x.name, type: "CABLE", ref: { kind: "cable" as const, id: x.id } }))].map((item) => <button className={`object-row ${selected?.id === item.id ? "selected" : ""}`} key={item.id} onClick={() => dispatch({ type: "select", selection: item.ref })}><i className={`mini-dot ${item.type.toLowerCase()}`} /><span>{item.name}</span><small>{item.type}</small></button>)}
          {!state.project.nodes.length && !state.project.customers.length && !state.project.cableSegments.length && <p className="empty-list">Your network objects will appear here.</p>}
        </div>
        <div className="api-note"><span className="note-icon">i</span><p>{api.mode === "memory" ? "Development mode · project data is held in memory only." : "Backend project API is configured."}</p></div>
      </aside>

      {workspaceMode === "topology" ? <TopologyCanvas project={state.project} selection={state.selection} onSelect={(selection) => dispatch({ type: "select", selection })} onAddDevice={addLogicalDevice} onMove={(ref, position) => dispatch({ type: "move-logical", ref, position })} onConnect={connectCanvasItems} onInvalidConnect={() => setNotice("Release the connection on a different network device or an ONT/customer pair.")} /> : <section className="map-stage">
        <div className="map-toolbar">
          <div className="map-label"><span className="live-dot" /> MAP CANVAS <small>{basemapConfig.badgeText}</small></div>
          <div className="basemap-switcher" role="group" aria-label="Basemap mode">
            <button type="button" className={basemapMode === "normal" ? "active" : ""} aria-pressed={basemapMode === "normal"} onClick={() => { setBasemapMode("normal"); setTileErrorMessage(null); }}>Normal</button>
            <button type="button" className={basemapMode === "earth" ? "active" : ""} aria-pressed={basemapMode === "earth"} onClick={() => { setBasemapMode("earth"); setTileErrorMessage(null); }}>Earth</button>
          </div>
          <LocationSearch onSelect={setSearchResult} />
          <div className="map-controls"><span>{tool === "cable" ? cableDrawing?.phase === "endpoints" ? !cableDrawing.startNodeId ? cableDrawing.committedCableId ? "Committed cable · choose start device" : "Route confirmed · choose start device" : !cableDrawing.endNodeId ? "Choose a different destination device" : "Validate topology connection" : "Cable drawing active · click anywhere to start the road route" : tool ? `Click to place ${FEATURE_LABELS[tool]}` : "Select or add network objects"}</span><button onClick={() => { if (cableDrafting) cancelCableDrawing(); else { setTool(null); dispatch({ type: "select", selection: null }); } }}>{cableDrafting ? "Cancel cable" : "Clear selection"}</button></div>
        </div>
        {(basemapConfig.setupWarning || tileErrorMessage) && (
          <div className="map-basemap-warning" role="status">
            <span>{basemapConfig.setupWarning ?? tileErrorMessage}</span>
            {basemapMode === "earth" && <button type="button" onClick={() => { setBasemapMode("normal"); setTileErrorMessage(null); }}>Use Normal Map</button>}
          </div>
        )}
        <NetworkMap project={state.project} tool={tool} selection={state.selection} cableDrawing={cableDrawing} previewPoint={previewPoint} failedCableIds={failedCableId ? [failedCableId] : []} basemapMode={basemapMode} onTileError={(msg) => setTileErrorMessage((current) => current ?? msg)} onMapClick={place} onMapMove={onMapMove} onCableNodeClick={onCableNodeClick} onSelect={(selection: FeatureRef) => { dispatch({ type: "select", selection }); setTool(null); }} onMove={(ref, location) => dispatch({ type: "move", ref, location })} onMoveVertex={(id, index, location) => dispatch({ type: "move-vertex", id, index, location })} areaDrawingPreview={areaPoints} searchResult={searchResult} onDismissSearchResult={() => setSearchResult(null)} onMoveAreaVertex={(id, index, location) => { const area = (state.project.areas ?? []).find((item) => item.id === id); if (!area) return; const ring = area.geometry.coordinates[0].map((point, pointIndex) => pointIndex === index ? location : point); ring[ring.length - 1] = ring[0]; dispatch({ type: "update-area", area: { ...area, geometry: { type: "Polygon", coordinates: [ring] } } }); }} />
        <div className="map-legend"><span><i className="legend-line feeder" /> Feeder</span><span><i className="legend-line distribution" /> Distribution</span><span><i className="legend-line drop" /> Drop</span><span><i className="legend-line indoor" /> Indoor</span><span><i className="legend-line custom" /> Custom</span><span><i className="legend-line connected" /> Connected</span><span><i className="legend-line unconnected" /> Unconnected cable</span><span><i className="legend-line rejected" /> Validation failed</span><span><i className="legend-handle" /> Selected vertex</span><span className="scale-note">Coordinates: longitude / latitude</span></div>
      </section>}

      <aside className="right-rail"><div className="rail-heading"><span>INSPECTOR</span><span className="step-number">02</span></div><Inspector project={state.project} selection={state.selection} opticalResult={opticalResult} onRename={(ref, name) => dispatch({ type: "rename", ref, name })} onAreaChange={(area) => dispatch({ type: "update-area", area })} onCustomerAddress={(id, address) => dispatch({ type: "customer-address", id, address })} onCustomerOnt={(id, ontNodeId) => dispatch({ type: "customer-ont", id, ontNodeId })} onCustomerStatus={(id, status) => dispatch({ type: "customer-status", id, status })} onCableAttributes={(id, cableType, fiberCount, properties) => dispatch({ type: "cable-attributes", id, cableType, fiberCount, properties })} onRouterConfiguration={(id, configuration) => dispatch({ type: "router-configuration", id, configuration })} onPoleProperties={(id, properties) => dispatch({ type: "pole-properties", id, properties })} onOpticalComponentsChange={(components) => dispatch({ type: "optical-components", components })} onAddPoleSpan={(span) => dispatch({ type: "add-pole-span", span })} onDeletePoleSpan={(id) => dispatch({ type: "delete-pole-span", id })} onPoleSpanStatus={(id, status) => dispatch({ type: "pole-span-status", id, status })} onSplitterOpticalConfig={(id, ratio, insertionLossDb) => dispatch({ type: "splitter-optical-config", id, ratio, insertionLossDb })} onInvalidFiberCount={() => setNotice("Fiber count must be a positive whole number.")} onDelete={deleteSelected} />
        <section className="topology-card"><div className="rail-heading"><span>TOPOLOGY LINKS</span><span className="step-number">{state.project.connections.length}</span></div>
          <p className="topology-help">Connect network nodes through a cable segment.</p>
          <button className="connect-button" onClick={() => setConnectionDialog({ fromNodeId: state.selection?.kind === "node" ? state.selection.id : "" })} disabled={!state.project.nodes.length}>Create connection</button>
          {state.project.connections.map((connection) => { const from = state.project.nodes.find((n) => n.id === connection.fromNodeId)?.name ?? "Missing node"; const to = state.project.nodes.find((n) => n.id === connection.toNodeId)?.name ?? "Missing node"; const cable = state.project.cableSegments.find((c) => c.id === connection.cableSegmentId)?.name ?? "Missing cable"; return <div className="connection-row" key={connection.id}><span>{from} → {to}<small>{cable}</small></span><button aria-label={`Remove connection ${from} to ${to}`} onClick={() => dispatch({ type: "delete-connection", id: connection.id })}>×</button></div>; })}
        </section>
        <section className="results-card"><div className="rail-heading"><span>ENGINEERING RESULTS</span><span className="lock-icon">⌑</span></div>
          <div className="result-item"><span className="result-glyph">⌁</span><div><strong>Optical power budget</strong><small>{opticalResult ? `Updated ${new Date(opticalResult.calculatedAt).toLocaleString()}` : "Backend analysis and project validation"}</small></div><button className="calculate-button" aria-label="Run Optical Analysis" title="Run Optical Analysis" onClick={() => calculate("optical")} disabled={calculating !== null}>{calculating === "optical" ? "Analyzing…" : "Analyze"}</button></div>
          {opticalResult && <p className="optical-result-summary">Per-ONT backend results: {(opticalResult.paths ?? []).filter((path) => opticalPathDisplayStatus(path) === "pass").length} pass · {(opticalResult.paths ?? []).filter((path) => opticalPathDisplayStatus(path) === "warning").length} warning · {(opticalResult.paths ?? []).filter((path) => opticalPathDisplayStatus(path) === "fail").length} fail · {(opticalResult.paths ?? []).filter((path) => opticalPathDisplayStatus(path) === "unknown").length} unknown</p>}
          {opticalResult && state.project.cableSegments.filter((cable) => !state.project.connections.some((connection) => connection.cableSegmentId === cable.id)).length > 0 && <div className="standalone-routes-note"><strong>Geographic route lengths · not optical paths</strong>{state.project.cableSegments.filter((cable) => !state.project.connections.some((connection) => connection.cableSegmentId === cable.id)).map((cable) => <span key={cable.id}>{cable.name}: {cable.lengthM == null ? "length unavailable" : `${cable.lengthM.toLocaleString()} m`}</span>)}<small>Standalone cable geometry is excluded from OLT-to-ONT calculations until a validated topology connection uses it.</small></div>}
          {opticalResult && (opticalResult.paths ?? []).map((path) => {
            const status = opticalPathDisplayStatus(path);
            const issue = opticalPathDisplayIssue(path);
            const diagnostic = describeOpticalPath(path, state.project);
            const metric = (value: number | null | undefined, unit: string) => value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)} ${unit}`;
            const routeLength = path.lengthM == null || !Number.isFinite(path.lengthM) ? "Route length unavailable" : `${path.lengthM.toLocaleString()} m`;
            return <div className="calculation-line path-line" key={path.ontNodeId}>
              <span><b>{state.project.nodes.find((node) => node.id === path.ontNodeId)?.name ?? path.ontNodeId}</b>
                <small>{routeLength} · Physical loss {metric(path.lossDb, "dB")} · Received {metric(path.receivedPowerDbm, "dBm")} · Sensitivity headroom {metric(path.sensitivityMarginDb, "dB")} · Overload headroom {metric(path.overloadMarginDb, "dB")} · Design margin {metric(path.marginDb, "dB")}</small>
                {issue && <small role="status">{issue}</small>}
                {status !== "pass" && <span className={`optical-diagnostic ${diagnostic.category === "topology" ? "topology" : "configuration"}`}>
                  <b>{diagnostic.category}: {diagnostic.summary}</b><small>{diagnostic.resolution}</small>
                  {diagnostic.parameters.length > 0 && <small>Inputs: {diagnostic.parameters.map((item) => `${item.name} (${item.unit}; ${item.source.replace(/_/g, " ")})`).join(" · ")}</small>}
                  {diagnostic.affectedNodeIds.map((id) => <button key={id} type="button" onClick={() => { setWorkspaceMode("geographic"); dispatch({ type: "select", selection: { kind: "node", id } }); }}>Select {state.project.nodes.find((node) => node.id === id)?.name ?? "affected device"}</button>)}
                </span>}
              </span><strong className={`status-${status}`}>{status}</strong>
            </div>;
          })}
          {opticalResult && <IntermediateOpticalResults intermediateNodes={opticalResult.intermediateNodes ?? []} />}
          {topologyValidation && <div className={`topology-validation-summary ${topologyValidation.valid ? "valid" : "invalid"}`} role="status">
            <strong>{topologyValidation.valid ? "Project topology valid" : `Project topology has ${topologyValidation.errors.length} issue${topologyValidation.errors.length === 1 ? "" : "s"}`}</strong>
            {topologyValidation.errors.map((item, index) => <div className="topology-validation-issue" key={`${item.code}-${index}`}><span>{item.message}</span>{(item.fromNodeId || item.toNodeId || item.cableSegmentId) && <button type="button" onClick={() => { const nodeId = item.fromNodeId ?? item.toNodeId; const selection = item.cableSegmentId ? { kind: "cable" as const, id: item.cableSegmentId } : nodeId ? { kind: "node" as const, id: nodeId } : null; if (selection) { setWorkspaceMode("geographic"); dispatch({ type: "select", selection }); } }}>Select affected object</button>}</div>)}
            {topologyValidation.warnings.map((item, index) => <p className="topology-validation-warning" key={`${item.code}-${index}`}>Warning: {item.message}</p>)}
          </div>}
          {topologyValidationError && <p className="notice error" role="alert">Topology validation could not complete: {topologyValidationError}</p>}
          <OpticalSettingsPanel config={state.project.settings.opticalBudget} onChange={(config) => dispatch({ type: "optical-budget-config", config })} />
          <PoleSpanSettingsPanel settings={state.project.settings.poleSpanPlanning} onChange={(settings) => dispatch({ type: "pole-span-settings", settings })} />
          <ConstructionCostSettingsPanel config={state.project.settings.constructionCost} onChange={(config) => dispatch({ type: "construction-cost-config", config })} />
          {opticalResult && opticalResult.disconnectedCustomerIds?.length > 0 && <p className="hint">{opticalResult.disconnectedCustomerIds.length} connected customer(s) have no complete OLT-to-ONT path.</p>}
          <div className="result-item"><span className="result-glyph cost">¤</span><div><strong>Construction cost</strong><small>{costResult ? `${costResult.currency} · Updated ${new Date(costResult.calculatedAt).toLocaleString()}` : `${state.project.currency} · Backend calculation`}</small></div><button className="calculate-button" onClick={() => calculate("cost")} disabled={calculating !== null}>{calculating === "cost" ? "…" : "Run"}</button></div>
          <div className="result-item"><span className="result-glyph">P</span><div><strong>Pole &amp; span planning</strong><small>{poleSpanResult ? `${poleSpanResult.spans.length} explicit spans · Updated ${new Date(poleSpanResult.calculatedAt).toLocaleString()}` : "Explicit physical links and configured interval rules"}</small></div><button className="calculate-button" onClick={() => { setReportView("poles"); void calculate("poles"); }} disabled={calculating !== null}>{calculating === "poles" ? "…" : "Plan"}</button></div>
          {costResult && <><div className="cost-total"><span>Total CAPEX</span><strong>{costResult.currency} {costResult.totalCapex?.toLocaleString() ?? costResult.totalAmount.toLocaleString()}</strong></div><div className="cost-total"><span>Cost per connected customer</span><strong>{costResult.costPerConnectedCustomer == null ? "—" : `${costResult.currency} ${costResult.costPerConnectedCustomer.toLocaleString()}`}</strong></div>{costResult.complete === false && <p className="notice error" role="status">Incomplete construction estimate: {(costResult.incompleteItems ?? []).map((item) => `${String(item.code ?? "Item")} (${String(item.reason ?? "missing rate")})`).join(" · ")}</p>}<div className="cost-items">{costResult.items.map((item) => <div className="cost-item" key={item.code}><span>{item.code}<small>{item.quantity.toLocaleString()} {item.unit} × {item.unitCost.toLocaleString()}</small></span><strong>{costResult.currency} {item.amount.toLocaleString()}</strong></div>)}</div></>}
          {!opticalResult && !costResult && <p className="hint">Results are returned by the backend. No frontend estimates are shown.</p>}
          <p className="hint">Configured estimates only; unit prices are not verified market quotes.</p>
          <EngineeringReportLinks onOpenRab={() => setReportView("rab")} onOpenOptical={() => setReportView("optical")} onOpenPoles={() => setReportView("poles")} />
        </section>
        <section className="customer-card"><div className="rail-heading"><span>CUSTOMERS</span><span className="step-number">{state.project.customers.length}</span></div><p>{state.project.customers.length ? `${state.project.customers.length} customer location${state.project.customers.length === 1 ? "" : "s"} in this project.` : "Customer records appear here when placed on the map."}</p></section>
        {notice && <div className={`notice ${noticeIsError ? "error" : ""}`} role="status">{notice}</div>}
      </aside>
      </>}
    </div>
    <footer className="statusbar"><span><i className="status-dot" /> EDITOR READY</span><span>FTTH PLANNER <b>·</b> MILESTONE 01</span></footer>
    {connectionDialog && <ConnectionDialog key={`${connectionDialog.fromNodeId ?? ""}-${connectionDialog.toNodeId ?? ""}-${connectionDialog.cableSegmentId ?? ""}`} project={connectionProject} initialSourceId={connectionDialog.fromNodeId} initialDestinationId={connectionDialog.toNodeId} initialCableId={connectionDialog.cableSegmentId} validateWithBackend={api.validateConnection} onRejected={(cableId) => setFailedCableId((current) => current === cableId ? current : cableId)} onClose={() => { setConnectionDialog(null); setPendingCable(null); }} onConnect={createConnection} />}
    {projectLibraryOpen && <ProjectLibrary projects={projects} loading={projectsLoading} loadingProjectId={loadingProjectId} error={projectsError} sessionOnly={api.mode === "memory"} onRefresh={() => void refreshProjects()} onLoad={(project) => void loadProject(project)} onClose={() => setProjectLibraryOpen(false)} />}
    {saveAsOpen && <SaveAsDialog initialName={`${state.project.name} copy`} saving={saveAsSaving} error={saveAsError} onSave={(name) => void saveAs(name)} onClose={() => setSaveAsOpen(false)} />}
  </main>;
}
