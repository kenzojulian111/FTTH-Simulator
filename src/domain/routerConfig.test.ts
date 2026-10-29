import { describe, expect, it } from "vitest";
import { validateRouterConfiguration } from "./routerConfig";
import type { RouterConfiguration } from "./types";

const validConfig: RouterConfiguration = {
  hostname: "home-router", wanMode: "static-ipv4", wanIpv4Address: "203.0.113.10", wanPrefix: 24,
  defaultGateway: "203.0.113.1", lanIpv4Address: "192.168.10.1", lanPrefix: 24,
  dhcpServerEnabled: true, dhcpPoolStart: "192.168.10.20", dhcpPoolEnd: "192.168.10.200",
  dnsServers: ["1.1.1.1", "8.8.8.8"], natEnabled: true, vlanId: 100,
};

describe("router IP configuration validation", () => {
  it("accepts consistent static WAN, LAN, DHCP, DNS, NAT, and VLAN settings", () => {
    expect(validateRouterConfiguration(validConfig)).toEqual([]);
  });

  it("reports invalid IPv4 syntax, prefix, and gateway subnet consistency", () => {
    const invalid = validateRouterConfiguration({ ...validConfig, wanIpv4Address: "203.0.113.999", wanPrefix: 33 });
    const gateway = validateRouterConfiguration({ ...validConfig, defaultGateway: "198.51.100.1" });
    const issues = [...invalid, ...gateway];
    expect(issues.map((issue) => issue.field)).toEqual(expect.arrayContaining(["wanIpv4Address", "wanPrefix", "defaultGateway"]));
  });

  it("detects overlapping WAN/LAN subnets and conflicting DHCP pool boundaries", () => {
    const overlap = validateRouterConfiguration({ ...validConfig, wanIpv4Address: "192.168.10.99", wanPrefix: 24, defaultGateway: "192.168.10.1" });
    expect(overlap.find((issue) => issue.field === "lanIpv4Address")?.message).toContain("must not overlap");
    const pool = validateRouterConfiguration({ ...validConfig, dhcpPoolStart: "192.168.10.1", dhcpPoolEnd: "192.168.10.20" });
    expect(pool.some((issue) => issue.message.includes("exclude the router's LAN address"))).toBe(true);
    const reversed = validateRouterConfiguration({ ...validConfig, dhcpPoolStart: "192.168.10.20", dhcpPoolEnd: "192.168.10.10" });
    expect(reversed.find((issue) => issue.field === "dhcpPoolEnd")?.message).toContain("at or after");
  });

  it("validates DHCP subnet membership, DNS addresses, and VLAN range", () => {
    const issues = validateRouterConfiguration({ ...validConfig, dhcpPoolEnd: "192.168.11.50", dnsServers: ["bad-address"], vlanId: 4095 });
    expect(issues.some((issue) => issue.message.includes("within the LAN subnet"))).toBe(true);
    expect(issues.some((issue) => issue.field === "dnsServers")).toBe(true);
    expect(issues.some((issue) => issue.field === "vlanId")).toBe(true);
  });

  it("requires selected WAN mode and LAN addressing without inventing WAN values", () => {
    const issues = validateRouterConfiguration({});
    expect(issues.map((issue) => issue.field)).toEqual(expect.arrayContaining(["wanMode", "lanIpv4Address", "lanPrefix"]));
  });
});
