import type { RouterConfiguration, RouterWanMode } from "../domain/types";
import { validateRouterConfiguration } from "../domain/routerConfig";

interface Props { configuration: RouterConfiguration; onChange: (configuration: RouterConfiguration) => void }

export function RouterConfigurationPanel({ configuration, onChange }: Props) {
  const issues = validateRouterConfiguration(configuration);
  const errorFor = (field: keyof RouterConfiguration) => issues.find((issue) => issue.field === field)?.message;
  const update = <K extends keyof RouterConfiguration>(field: K, value: RouterConfiguration[K]) => onChange({ ...configuration, [field]: value });
  const changeWanMode = (value: string) => {
    const mode: RouterWanMode | undefined = value === "dhcp-client" || value === "static-ipv4" || value === "pppoe" ? value : undefined;
    update("wanMode", mode);
  };
  const textField = (label: string, field: "hostname" | "wanIpv4Address" | "defaultGateway" | "lanIpv4Address" | "dhcpPoolStart" | "dhcpPoolEnd", placeholder = "") => <label className="field-label router-field">{label}<input value={configuration[field] ?? ""} placeholder={placeholder} onChange={(event) => update(field, event.target.value || undefined)} aria-invalid={Boolean(errorFor(field))} />{errorFor(field) && <small className="router-field-error">{errorFor(field)}</small>}</label>;
  const prefixField = (label: string, field: "wanPrefix" | "lanPrefix") => <label className="field-label router-field">{label}<input type="number" min="0" max="32" step="1" value={configuration[field] ?? ""} placeholder="Prefix length" onChange={(event) => update(field, event.target.value === "" ? undefined : Number(event.target.value))} aria-invalid={Boolean(errorFor(field))} />{errorFor(field) && <small className="router-field-error">{errorFor(field)}</small>}</label>;

  return <section className="router-config-panel" aria-label="Router IP configuration">
    <div className="section-heading"><span>ROUTER IP CONFIGURATION</span></div>
    <p className="router-contract-warning" role="note">The current backend schema does not accept Router nodes or Router RAB inputs yet. Live save, ONT-to-Router approval, and Router cost rows require the coordinated backend contract documented with this feature.</p>
    <p className="router-config-note">This validates saved configuration only. WAN reachability, DHCP leases, and PPPoE session state are not simulated.</p>
    {textField("Hostname", "hostname", "e.g. home-router")}
    <label className="field-label router-field">WAN addressing mode<select value={configuration.wanMode ?? ""} onChange={(event) => changeWanMode(event.target.value)}>
      <option value="">Select mode…</option><option value="dhcp-client">DHCP client</option><option value="static-ipv4">Static IPv4</option><option value="pppoe">PPPoE</option>
    </select>{errorFor("wanMode") && <small className="router-field-error">{errorFor("wanMode")}</small>}</label>
    {configuration.wanMode === "static-ipv4" && <div className="router-field-group"><span className="router-group-title">Static WAN</span>{textField("IPv4 address", "wanIpv4Address", "192.0.2.10")}{prefixField("Prefix length", "wanPrefix")}{textField("Default gateway", "defaultGateway", "192.0.2.1")}</div>}
    {configuration.wanMode === "pppoe" && <p className="router-config-note">No PPPoE credentials are stored by this UI.</p>}
    <div className="router-field-group"><span className="router-group-title">LAN</span>{textField("LAN IPv4 address", "lanIpv4Address", "192.168.1.1")}{prefixField("LAN prefix length", "lanPrefix")}</div>
    <label className="router-toggle"><input type="checkbox" checked={configuration.dhcpServerEnabled ?? false} onChange={(event) => update("dhcpServerEnabled", event.target.checked)} /> Enable DHCP server</label>
    {configuration.dhcpServerEnabled && <div className="router-field-group">{textField("DHCP pool start", "dhcpPoolStart", "192.168.1.100")}{textField("DHCP pool end", "dhcpPoolEnd", "192.168.1.200")}</div>}
    <label className="field-label router-field">DNS server IPv4 addresses<textarea rows={2} value={(configuration.dnsServers ?? []).join("\n")} placeholder="One IPv4 address per line" onChange={(event) => { const servers = event.target.value.split(/[\n,]+/).map((server) => server.trim()).filter(Boolean); update("dnsServers", servers); }} aria-invalid={Boolean(errorFor("dnsServers"))} />{errorFor("dnsServers") && <small className="router-field-error">{errorFor("dnsServers")}</small>}</label>
    <label className="router-toggle"><input type="checkbox" checked={configuration.natEnabled ?? false} onChange={(event) => update("natEnabled", event.target.checked)} /> Enable NAT</label>
    <label className="field-label router-field">VLAN ID (optional)<input type="number" min="1" max="4094" step="1" value={configuration.vlanId ?? ""} placeholder="Not set" onChange={(event) => update("vlanId", event.target.value === "" ? undefined : Number(event.target.value))} aria-invalid={Boolean(errorFor("vlanId"))} />{errorFor("vlanId") && <small className="router-field-error">{errorFor("vlanId")}</small>}</label>
    <div className={`router-validation ${issues.length ? "invalid" : "valid"}`} role="status"><strong>Configuration {issues.length ? "needs attention" : "valid"}</strong>{issues.length ? <ul>{issues.map((issue, index) => <li key={`${issue.field}-${index}`}>{issue.message}</li>)}</ul> : <p>Address configuration is valid.</p>}</div>
  </section>;
}
