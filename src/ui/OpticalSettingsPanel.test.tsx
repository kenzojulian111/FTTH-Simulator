import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "../domain/project";
import { OpticalSettingsPanel } from "./OpticalSettingsPanel";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

describe("optical settings and provenance UI", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => { if (root) act(() => root?.unmount()); root = null; container?.remove(); container = null; vi.restoreAllMocks(); });

  function render(onChange: ReturnType<typeof vi.fn>) {
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    act(() => root?.render(<OpticalSettingsPanel config={createEmptyProject().settings.opticalBudget} onChange={onChange} />));
    return container;
  }

  it("marks an edited parameter as configured and preserves the other sources", () => {
    const onChange = vi.fn(); const view = render(onChange);
    const txPower = view.querySelector('[aria-label="OLT transmit power"]') as HTMLInputElement;
    act(() => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; setter?.call(txPower, "4"); txPower.dispatchEvent(new Event("input", { bubbles: true })); txPower.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls[onChange.mock.calls.length - 1]?.[0]).toMatchObject({ txPowerDbm: 4, parameterSources: { txPowerDbm: "configured", rxSensitivityDbm: "profile_default" } });
  });

  it("offers the documented profile as an explicit backward-compatible remediation", () => {
    const onChange = vi.fn(); const view = render(onChange);
    act(() => (view.querySelector(".optical-profile-button") as HTMLButtonElement).click());
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ profileId: "illustrative_gpon_planning_v1", parameterSources: expect.objectContaining({ txPowerDbm: "profile_default", splitterLossTable: "profile_default" }) }));
  });

  it("applies the user lecture reference profile with exact lecture material values and provenance note", () => {
    const onChange = vi.fn(); const view = render(onChange);
    const buttons = Array.from(view.querySelectorAll(".optical-profile-button")) as HTMLButtonElement[];
    const lectureBtn = buttons.find((btn) => btn.textContent?.includes("Materi Kuliah"));
    expect(lectureBtn).toBeDefined();
    act(() => lectureBtn?.click());
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      profileId: "lecture_material_gpon_v1",
      fiberAttenuationDbPerKm: 0.35,
      dropFiberAttenuationDbPerKm: 0.35,
      connectorLossDb: 0.25,
      spliceLossDb: 0.1,
      pigtailSpliceLossDb: 0.1,
      splitterLossTable: { "1:2": 3.5, "1:4": 7.25, "1:8": 10.38, "1:16": 15, "1:32": 18.6, "1:64": 22.8 },
    }));
  });

  it("preserves user-configured parameter overrides when re-applying a reference profile", () => {
    const onChange = vi.fn();
    const customConfig = {
      ...createEmptyProject().settings.opticalBudget,
      txPowerDbm: 4.2,
      connectorLossDb: 0.35,
      parameterSources: {
        ...createEmptyProject().settings.opticalBudget.parameterSources,
        txPowerDbm: "configured" as const,
        connectorLossDb: "configured" as const,
      },
    };
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    act(() => root?.render(<OpticalSettingsPanel config={customConfig} onChange={onChange} />));
    const buttons = Array.from(container.querySelectorAll(".optical-profile-button")) as HTMLButtonElement[];
    const lectureBtn = buttons.find((btn) => btn.textContent?.includes("Materi Kuliah"));
    act(() => lectureBtn?.click());
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      profileId: "lecture_material_gpon_v1",
      txPowerDbm: 4.2,
      connectorLossDb: 0.35,
      spliceLossDb: 0.1,
      pigtailSpliceLossDb: 0.1,
      parameterSources: expect.objectContaining({
        txPowerDbm: "configured",
        connectorLossDb: "configured",
        spliceLossDb: "profile_default",
      }),
    }));
  });
});
