import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "../domain/project";
import type { OpticalBudgetResult } from "../domain/types";
import { Inspector } from "./Inspector";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

describe("Inspector Device Configuration & Port Management", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = null;
    host?.remove();
    host = null;
  });

  it("renders 5 clean sections for OLT device and allows configuring vendor, model, and PON ports", () => {
    const project = createEmptyProject("OLT Config Test");
    const point = { type: "Point" as const, coordinates: [115.2, -8.65] as [number, number] };
    project.nodes = [
      {
        id: "olt-1",
        name: "OLT Central",
        type: "olt",
        location: point,
        properties: {
          vendor: "Huawei",
          model: "MA5800-X7",
          ponTechnology: "GPON",
          ponPortCapacity: 4,
          txPowerDbm: 2.5,
          maxCustomersPerPort: 64,
        },
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
    ];

    const onNodeProperties = vi.fn();
    const noop = vi.fn();

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() =>
      root?.render(
        <Inspector
          project={project}
          selection={{ kind: "node", id: "olt-1" }}
          onRename={noop}
          onCustomerAddress={noop}
          onCustomerOnt={noop}
          onCustomerStatus={noop}
          onCableAttributes={noop}
          onRouterConfiguration={noop}
          onInvalidFiberCount={noop}
          onDelete={noop}
          onNodeProperties={onNodeProperties}
        />,
      ),
    );

    // Verify 5 sections are present
    expect(host.textContent).toContain("1. DEVICE INFORMATION");
    expect(host.textContent).toContain("2. PORT CONFIGURATION");
    expect(host.textContent).toContain("4. CONNECTED DEVICES");
    expect(host.textContent).toContain("5. OPTICAL PARAMETERS");

    // Check vendor and model inputs
    const inputs = host.querySelectorAll("input");
    const vendorInput = Array.from(inputs).find((i) => i.value === "Huawei");
    expect(vendorInput).toBeDefined();

    // Check PON technology select
    const selects = host.querySelectorAll("select");
    const ponSelect = Array.from(selects).find((s) => s.value === "GPON");
    expect(ponSelect).toBeDefined();

    // Test changing PON technology to XGS-PON
    act(() => {
      if (ponSelect) {
        ponSelect.value = "XGS-PON";
        ponSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    expect(onNodeProperties).toHaveBeenCalledWith("olt-1", { ponTechnology: "XGS-PON" });

    // Verify 4 PON ports in the port configuration table
    expect(host.textContent).toContain("PON-1");
    expect(host.textContent).toContain("PON-2");
    expect(host.textContent).toContain("PON-3");
    expect(host.textContent).toContain("PON-4");
  });

  it("renders ODC with internal splitters, port management, and connected devices", () => {
    const project = createEmptyProject("ODC Config Test");
    const point = { type: "Point" as const, coordinates: [115.2, -8.65] as [number, number] };
    project.nodes = [
      {
        id: "odc-1",
        name: "ODC Cabinet 1",
        type: "odc",
        location: point,
        properties: {
          feederPortCapacity: 4,
          distributionPortCapacity: 16,
        },
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
      {
        id: "spl-1",
        name: "ODC 1 Splitter 1:8",
        type: "splitter",
        location: point,
        properties: {
          mountedInNodeId: "odc-1",
          splitterRatio: "1:8",
          splitterLossDb: 10.38,
          capacity: 8,
          inputPortId: "IN-1",
          outputPortAssignments: [],
        },
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
      {
        id: "odp-1",
        name: "ODP 1",
        type: "odp",
        location: point,
        properties: {},
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
    ];
    project.cableSegments = [
      {
        id: "c-dist-1",
        name: "Dist Cable 1",
        cableType: "distribution",
        fiberCount: 12,
        geometry: { type: "LineString", coordinates: [point.coordinates, point.coordinates] },
        lengthM: 100,
        startNodeId: "odc-1",
        endNodeId: "odp-1",
        properties: {},
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
    ];
    project.connections = [
      {
        id: "conn-dist-1",
        fromNodeId: "odc-1",
        toNodeId: "odp-1",
        cableSegmentId: "c-dist-1",
        fromPortId: "OUT-01",
        toPortId: "IN",
      },
    ];

    const onAddInternalSplitter = vi.fn();
    const onRemoveInternalSplitter = vi.fn();
    const onDisconnectConnection = vi.fn();
    const noop = vi.fn();

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() =>
      root?.render(
        <Inspector
          project={project}
          selection={{ kind: "node", id: "odc-1" }}
          onRename={noop}
          onCustomerAddress={noop}
          onCustomerOnt={noop}
          onCustomerStatus={noop}
          onCableAttributes={noop}
          onRouterConfiguration={noop}
          onInvalidFiberCount={noop}
          onDelete={noop}
          onAddInternalSplitter={onAddInternalSplitter}
          onRemoveInternalSplitter={onRemoveInternalSplitter}
          onDisconnectConnection={onDisconnectConnection}
        />,
      ),
    );

    // Section 3: Installed passive components
    expect(host.textContent).toContain("3. INSTALLED PASSIVE COMPONENTS");
    expect(host.textContent).toContain("ODC 1 Splitter 1:8");
    expect(host.textContent).toContain("10.38 dB");

    // Remove splitter button
    const removeBtn = Array.from(host.querySelectorAll("button")).find((b) => b.getAttribute("aria-label")?.includes("Remove splitter"));
    expect(removeBtn).toBeDefined();
    act(() => removeBtn?.click());
    expect(onRemoveInternalSplitter).toHaveBeenCalledWith("spl-1");

    // Add internal splitter button
    const addSplitterBtn = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Add internal splitter"));
    expect(addSplitterBtn).toBeDefined();
    act(() => addSplitterBtn?.click());
    expect(onAddInternalSplitter).toHaveBeenCalledWith("odc-1", expect.objectContaining({
      type: "splitter",
      properties: expect.objectContaining({ mountedInNodeId: "odc-1" }),
    }));

    // Section 4: Connected devices with Disconnect button
    expect(host.textContent).toContain("4. CONNECTED DEVICES");
    expect(host.textContent).toContain("ODP 1");
    expect(host.textContent).toContain("[OUT-01]");

    const disconnectBtn = Array.from(host.querySelectorAll("button")).find((b) => b.getAttribute("aria-label")?.includes("Disconnect conn-dist-1"));
    expect(disconnectBtn).toBeDefined();
    act(() => disconnectBtn?.click());
    expect(onDisconnectConnection).toHaveBeenCalledWith("conn-dist-1");
  });

  it("renders ONT optical parameters and displays PASS status with unverified physical route", () => {
    const project = createEmptyProject("ONT Optical Test");
    const point = { type: "Point" as const, coordinates: [115.2, -8.65] as [number, number] };
    project.nodes = [
      {
        id: "ont-1",
        name: "ONT 101",
        type: "ont",
        location: point,
        properties: {},
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
    ];
    project.customers = [
      {
        id: "cust-1",
        name: "Ibu Siti",
        address: "Jl. Merdeka No. 10",
        location: point,
        status: "connected",
        ontNodeId: "ont-1",
        properties: {},
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
    ];

    const opticalResult: OpticalBudgetResult = {
      projectId: project.id,
      calculatedAt: project.updatedAt,
      links: [],
      disconnectedCustomerIds: [],
      paths: [
        {
          ontNodeId: "ont-1",
          customerIds: ["cust-1"],
          nodeIds: ["olt-1", "odc-1", "odp-1", "ont-1"],
          connectionIds: ["c1", "c2", "c3"],
          lengthM: 350.0,
          lossDb: 22.4,
          receivedPowerDbm: -19.9,
          marginDb: 4.1,
          status: "pass",
          physicalRouteStatus: "unverified",
        },
      ],
    };

    const noop = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() =>
      root?.render(
        <Inspector
          project={project}
          selection={{ kind: "node", id: "ont-1" }}
          opticalResult={opticalResult}
          onRename={noop}
          onCustomerAddress={noop}
          onCustomerOnt={noop}
          onCustomerStatus={noop}
          onCableAttributes={noop}
          onRouterConfiguration={noop}
          onInvalidFiberCount={noop}
          onDelete={noop}
        />,
      ),
    );

    expect(host.textContent).toContain("Ibu Siti");
    expect(host.textContent).toContain("-19.90 dBm");
    expect(host.textContent).toContain("PASS");
    expect(host.textContent).toContain("UNVERIFIED");
  });

  function fireInputChange(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("supports manual OLT Tx Power decimal input, custom badges, and recalculation trigger", () => {
    const project = createEmptyProject("OLT Tx Power Custom Test");
    const point = { type: "Point" as const, coordinates: [115.2, -8.65] as [number, number] };
    project.nodes = [
      {
        id: "olt-1",
        name: "OLT Central",
        type: "olt",
        location: point,
        properties: {
          txPowerDbm: 6.0,
          ponTechnology: "GPON",
        },
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
    ];

    const onNodeProperties = vi.fn();
    const onRecalculate = vi.fn();
    const noop = vi.fn();

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() =>
      root?.render(
        <Inspector
          project={project}
          selection={{ kind: "node", id: "olt-1" }}
          onRename={noop}
          onCustomerAddress={noop}
          onCustomerOnt={noop}
          onCustomerStatus={noop}
          onCableAttributes={noop}
          onRouterConfiguration={noop}
          onInvalidFiberCount={noop}
          onDelete={noop}
          onNodeProperties={onNodeProperties}
          onRecalculate={onRecalculate}
        />,
      ),
    );

    // Verify custom badge is shown
    expect(host.textContent).toContain("[Custom: +6.00 dBm]");
    expect(host.textContent).toContain("illustrative_gpon_planning_v1");

    // Check Tx Power input
    const txInput = host.querySelector("input[step='0.01']") as HTMLInputElement;
    expect(txInput).toBeDefined();
    expect(txInput.value).toBe("6");

    // Edit Tx Power to +7.5 dBm
    act(() => {
      fireInputChange(txInput, "7.5");
    });
    expect(onNodeProperties).toHaveBeenCalledWith("olt-1", { txPowerDbm: 7.5 });

    // Test recalculate button click
    const recalcBtn = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Recalculate"));
    expect(recalcBtn).toBeDefined();
    act(() => {
      recalcBtn?.click();
    });
    expect(onRecalculate).toHaveBeenCalled();
  });

  it("supports custom Splitter ratio, custom insertion loss (dB), and decoupled output ports", () => {
    const project = createEmptyProject("Splitter Custom Test");
    const point = { type: "Point" as const, coordinates: [115.2, -8.65] as [number, number] };
    project.nodes = [
      {
        id: "spl-custom",
        name: "Splitter Special",
        type: "splitter",
        location: point,
        properties: {
          splitterRatio: "1:12",
          capacity: 12,
          outputPorts: 12,
          splitterLossDb: 11.2,
          splitterType: "plc",
        },
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
    ];

    const onNodeProperties = vi.fn();
    const onSplitterOpticalConfig = vi.fn();
    const noop = vi.fn();

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() =>
      root?.render(
        <Inspector
          project={project}
          selection={{ kind: "node", id: "spl-custom" }}
          onRename={noop}
          onCustomerAddress={noop}
          onCustomerOnt={noop}
          onCustomerStatus={noop}
          onCableAttributes={noop}
          onRouterConfiguration={noop}
          onInvalidFiberCount={noop}
          onDelete={noop}
          onNodeProperties={onNodeProperties}
          onSplitterOpticalConfig={onSplitterOpticalConfig}
        />,
      ),
    );

    // Verify custom ratio 1:12 and custom loss badge
    expect(host.textContent).toContain("1:12");
    expect(host.textContent).toContain("[Custom: 11.20 dB]");

    // Verify output ports count input shows 12
    const portInputs = Array.from(host.querySelectorAll("input[type='number']")) as HTMLInputElement[];
    const outPortInput = portInputs.find((i) => i.value === "12");
    expect(outPortInput).toBeDefined();

    // Change output ports independently to 14
    act(() => {
      if (outPortInput) {
        fireInputChange(outPortInput, "14");
      }
    });
    expect(onNodeProperties).toHaveBeenCalledWith("spl-custom", { capacity: 14, outputPorts: 14 });

    // Change custom insertion loss directly to 10.8 dB
    const lossInput = portInputs.find((i) => i.value === "11.2");
    expect(lossInput).toBeDefined();
    act(() => {
      if (lossInput) {
        fireInputChange(lossInput, "10.8");
      }
    });
    expect(onSplitterOpticalConfig).toHaveBeenCalledWith("spl-custom", "1:12", 10.8);
    expect(onNodeProperties).toHaveBeenCalledWith("spl-custom", { splitterLossDb: 10.8 });
  });

  it("supports manual ONT Rx Sensitivity and Overload threshold decimal inputs", () => {
    const project = createEmptyProject("ONT Custom Optical Test");
    const point = { type: "Point" as const, coordinates: [115.2, -8.65] as [number, number] };
    project.nodes = [
      {
        id: "ont-custom",
        name: "ONT Premium",
        type: "ont",
        location: point,
        properties: {
          rxSensitivityDbm: -28.5,
          rxOverloadDbm: -6.5,
        },
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
    ];

    const onNodeProperties = vi.fn();
    const noop = vi.fn();

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() =>
      root?.render(
        <Inspector
          project={project}
          selection={{ kind: "node", id: "ont-custom" }}
          onRename={noop}
          onCustomerAddress={noop}
          onCustomerOnt={noop}
          onCustomerStatus={noop}
          onCableAttributes={noop}
          onRouterConfiguration={noop}
          onInvalidFiberCount={noop}
          onDelete={noop}
          onNodeProperties={onNodeProperties}
        />,
      ),
    );

    // Verify custom sensitivity and overload badges
    expect(host.textContent).toContain("[Custom: -28.50 dBm]");
    expect(host.textContent).toContain("[Custom: -6.50 dBm]");

    // Change sensitivity to -29.0 dBm
    const numInputs = Array.from(host.querySelectorAll("input[type='number']")) as HTMLInputElement[];
    const sensInput = numInputs.find((i) => i.value === "-28.5");
    expect(sensInput).toBeDefined();
    act(() => {
      if (sensInput) {
        fireInputChange(sensInput, "-29.0");
      }
    });
    expect(onNodeProperties).toHaveBeenCalledWith("ont-custom", { rxSensitivityDbm: -29.0 });
  });

  it("supports manual Cable optical attenuation parameters", () => {
    const project = createEmptyProject("Cable Custom Optical Test");
    const point = { type: "Point" as const, coordinates: [115.2, -8.65] as [number, number] };
    project.cableSegments = [
      {
        id: "cable-opt-1",
        name: "Feeder 01",
        cableType: "feeder",
        fiberCount: 24,
        geometry: { type: "LineString", coordinates: [point.coordinates, point.coordinates] },
        lengthM: 200,
        properties: {
          fiberAttenuationDbPerKm: 0.25,
          connectorLossDb: 0.15,
          connectorsCount: 4,
          spliceLossDb: 0.05,
          splicesCount: 2,
        },
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
    ];

    const onCableAttributes = vi.fn();
    const noop = vi.fn();

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() =>
      root?.render(
        <Inspector
          project={project}
          selection={{ kind: "cable", id: "cable-opt-1" }}
          onRename={noop}
          onCustomerAddress={noop}
          onCustomerOnt={noop}
          onCustomerStatus={noop}
          onCableAttributes={onCableAttributes}
          onRouterConfiguration={noop}
          onInvalidFiberCount={noop}
          onDelete={noop}
        />,
      ),
    );

    expect(host.textContent).toContain("OPTICAL ATTENUATION PARAMETERS");
    expect(host.textContent).toContain("[Custom: 0.25 dB/km]");

    const numInputs = Array.from(host.querySelectorAll("input[type='number']")) as HTMLInputElement[];
    const alphaInput = numInputs.find((i) => i.value === "0.25");
    expect(alphaInput).toBeDefined();

    act(() => {
      if (alphaInput) {
        fireInputChange(alphaInput, "0.22");
      }
    });
    expect(onCableAttributes).toHaveBeenCalledWith("cable-opt-1", "feeder", 24, { fiberAttenuationDbPerKm: 0.22 });
  });
});
