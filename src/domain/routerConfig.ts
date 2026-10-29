import type { PropertyValue, RouterConfiguration, RouterWanMode } from "./types";

export interface RouterConfigIssue { field: keyof RouterConfiguration; message: string }

export function serializeRouterConfiguration(config: RouterConfiguration): { [key: string]: PropertyValue } {
  const serialized: { [key: string]: PropertyValue } = {};
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined && (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null)) {
      serialized[key] = value;
    } else if (Array.isArray(value) && value.every((item: unknown): item is string => typeof item === "string")) serialized[key] = value;
  }
  return serialized;
}

export function readRouterConfiguration(value: PropertyValue | undefined): RouterConfiguration {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const stringValue = (key: string) => { const candidate = value[key]; return typeof candidate === "string" ? candidate : undefined; };
  const numberValue = (key: string) => { const candidate = value[key]; return typeof candidate === "number" ? candidate : undefined; };
  const booleanValue = (key: string) => { const candidate = value[key]; return typeof candidate === "boolean" ? candidate : undefined; };
  const rawMode = stringValue("wanMode");
  const wanMode: RouterWanMode | undefined = rawMode === "dhcp-client" || rawMode === "static-ipv4" || rawMode === "pppoe" ? rawMode : undefined;
  const rawDns = value.dnsServers;
  return {
    hostname: stringValue("hostname"), wanMode,
    wanIpv4Address: stringValue("wanIpv4Address"), wanPrefix: numberValue("wanPrefix"), defaultGateway: stringValue("defaultGateway"),
    lanIpv4Address: stringValue("lanIpv4Address"), lanPrefix: numberValue("lanPrefix"),
    dhcpServerEnabled: booleanValue("dhcpServerEnabled"), dhcpPoolStart: stringValue("dhcpPoolStart"), dhcpPoolEnd: stringValue("dhcpPoolEnd"),
    dnsServers: Array.isArray(rawDns) ? rawDns.filter((server): server is string => typeof server === "string") : undefined,
    natEnabled: booleanValue("natEnabled"), vlanId: numberValue("vlanId"),
  };
}

function parseIpv4(value: string | undefined): number | null {
  if (!value || !/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) return null;
  const octets = value.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
  return octets.reduce((address, octet) => ((address << 8) | octet) >>> 0, 0);
}

function validPrefix(value: number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 32;
}

function addressRange(address: number, prefix: number): { first: number; last: number } {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const first = (address & mask) >>> 0;
  return { first, last: (first | (~mask >>> 0)) >>> 0 };
}

function sameSubnet(first: number, second: number, prefix: number): boolean {
  return addressRange(first, prefix).first === addressRange(second, prefix).first;
}

export function validateRouterConfiguration(config: RouterConfiguration): RouterConfigIssue[] {
  const issues: RouterConfigIssue[] = [];
  const add = (field: keyof RouterConfiguration, message: string) => issues.push({ field, message });

  if (!config.wanMode) add("wanMode", "Choose a WAN addressing mode.");
  if (config.wanMode === "static-ipv4") {
    const address = parseIpv4(config.wanIpv4Address);
    if (address === null) add("wanIpv4Address", "Enter a valid static WAN IPv4 address.");
    if (!validPrefix(config.wanPrefix)) add("wanPrefix", "Enter a prefix from 0 to 32.");
    const gateway = parseIpv4(config.defaultGateway);
    if (gateway === null) add("defaultGateway", "Enter a valid IPv4 default gateway.");
    if (address !== null && gateway !== null && validPrefix(config.wanPrefix)) {
      if (address === gateway) add("defaultGateway", "The gateway cannot be the router's WAN address.");
      else if (!sameSubnet(address, gateway, config.wanPrefix)) add("defaultGateway", "The gateway must be in the WAN address subnet.");
    }
  }

  const lan = parseIpv4(config.lanIpv4Address);
  if (lan === null) add("lanIpv4Address", "Enter a valid LAN IPv4 address.");
  if (!validPrefix(config.lanPrefix)) add("lanPrefix", "Enter a LAN prefix from 0 to 32.");

  if (config.wanMode === "static-ipv4") {
    const wan = parseIpv4(config.wanIpv4Address);
    if (wan !== null && lan !== null && wan === lan) add("lanIpv4Address", "LAN and WAN addresses must be different.");
    if (wan !== null && lan !== null && validPrefix(config.wanPrefix) && validPrefix(config.lanPrefix)) {
      const wanRange = addressRange(wan, config.wanPrefix);
      const lanRange = addressRange(lan, config.lanPrefix);
      if (wanRange.first <= lanRange.last && lanRange.first <= wanRange.last) add("lanIpv4Address", "LAN and WAN subnets must not overlap.");
    }
  }

  if (config.dhcpServerEnabled) {
    const start = parseIpv4(config.dhcpPoolStart);
    const end = parseIpv4(config.dhcpPoolEnd);
    if (start === null) add("dhcpPoolStart", "Enter a valid DHCP pool start IPv4 address.");
    if (end === null) add("dhcpPoolEnd", "Enter a valid DHCP pool end IPv4 address.");
    if (start !== null && end !== null && start > end) add("dhcpPoolEnd", "The DHCP pool end must be at or after its start.");
    if (start !== null && end !== null && lan !== null && validPrefix(config.lanPrefix)) {
      if (!sameSubnet(start, lan, config.lanPrefix)) add("dhcpPoolStart", "The DHCP pool must be within the LAN subnet.");
      if (!sameSubnet(end, lan, config.lanPrefix)) add("dhcpPoolEnd", "The DHCP pool must be within the LAN subnet.");
      if (lan >= start && lan <= end) add("dhcpPoolStart", "The DHCP pool must exclude the router's LAN address.");
      const lanRange = addressRange(lan, config.lanPrefix);
      if (config.lanPrefix <= 30 && (start <= lanRange.first || end >= lanRange.last)) {
        add("dhcpPoolStart", "The DHCP pool must exclude the LAN network and broadcast addresses.");
      }
    }
  }

  (config.dnsServers ?? []).forEach((server, index) => {
    if (server.trim() && parseIpv4(server.trim()) === null) add("dnsServers", `DNS server ${index + 1} is not a valid IPv4 address.`);
  });
  if (config.vlanId !== undefined && (!Number.isInteger(config.vlanId) || config.vlanId < 1 || config.vlanId > 4094)) {
    add("vlanId", "VLAN ID must be between 1 and 4094.");
  }
  return issues;
}
