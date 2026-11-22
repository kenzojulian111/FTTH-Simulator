use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub fn current_utc_timestamp() -> String {
    Utc::now().to_rfc3339()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeType {
    Olt,
    Odc,
    Odp,
    Ont,
    Pole,
    Manhole,
    Handhole,
    Annotation,
    Splitter,
    Router,
    Customer,
    #[serde(other)]
    Unknown,
}

impl NodeType {
    pub fn as_str(&self) -> &str {
        match self {
            NodeType::Olt => "olt",
            NodeType::Odc => "odc",
            NodeType::Odp => "odp",
            NodeType::Ont => "ont",
            NodeType::Pole => "pole",
            NodeType::Manhole => "manhole",
            NodeType::Handhole => "handhole",
            NodeType::Annotation => "annotation",
            NodeType::Splitter => "splitter",
            NodeType::Router => "router",
            NodeType::Customer => "customer",
            NodeType::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CustomerStatus {
    Planned,
    Connected,
    OnHold,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum WanMode {
    #[serde(rename = "dhcp-client", alias = "dhcp", alias = "dhcp_client")]
    Dhcp,
    #[serde(rename = "static-ipv4", alias = "static", alias = "static_ipv4")]
    Static,
    #[serde(rename = "pppoe")]
    Pppoe,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RouterConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hostname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wan_mode: Option<WanMode>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "wan_ipv4_address", alias = "wanIp", alias = "wan_ip")]
    pub wan_ipv4_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "wan_prefix", alias = "wanCidr", alias = "wan_cidr")]
    pub wan_prefix: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "default_gateway", alias = "gateway")]
    pub default_gateway: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "lan_ipv4_address", alias = "lanIp", alias = "lan_ip")]
    pub lan_ipv4_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "lan_prefix", alias = "lanCidr", alias = "lan_cidr")]
    pub lan_prefix: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "dhcp_server_enabled", alias = "dhcpEnabled", alias = "dhcp_enabled")]
    pub dhcp_server_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "dhcp_pool_start")]
    pub dhcp_pool_start: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "dhcp_pool_end")]
    pub dhcp_pool_end: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "dns_servers", alias = "dns")]
    pub dns_servers: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "nat_enabled")]
    pub nat_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "vlan_id")]
    pub vlan_id: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "pppoe_username")]
    pub pppoe_username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "pppoe_password")]
    pub pppoe_password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointGeometry {
    #[serde(default = "default_point_type")]
    pub r#type: String,
    pub coordinates: (f64, f64),
}

fn default_point_type() -> String {
    "Point".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LineGeometry {
    #[serde(default = "default_linestring_type")]
    pub r#type: String,
    pub coordinates: Vec<(f64, f64)>,
}

fn default_linestring_type() -> String {
    "LineString".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkNode {
    pub id: String,
    pub r#type: NodeType,
    pub name: String,
    pub location: PointGeometry,
    #[serde(default)]
    pub properties: serde_json::Map<String, serde_json::Value>,
    #[serde(default = "current_utc_timestamp")]
    pub created_at: String,
    #[serde(default = "current_utc_timestamp")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Customer {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub address: String,
    pub location: PointGeometry,
    #[serde(default = "default_customer_status")]
    pub status: CustomerStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ont_node_id: Option<String>,
    #[serde(default)]
    pub properties: serde_json::Map<String, serde_json::Value>,
    #[serde(default = "current_utc_timestamp")]
    pub created_at: String,
    #[serde(default = "current_utc_timestamp")]
    pub updated_at: String,
}

fn default_customer_status() -> CustomerStatus {
    CustomerStatus::Planned
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CableSegment {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub cable_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fiber_count: Option<u32>,
    #[serde(default = "default_deployment_method")]
    pub deployment_method: String,
    pub geometry: LineGeometry,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub length_m: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_node_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_node_id: Option<String>,
    #[serde(default = "default_medium")]
    pub medium: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_type: Option<String>,
    #[serde(default)]
    pub properties: serde_json::Map<String, serde_json::Value>,
    #[serde(default = "current_utc_timestamp")]
    pub created_at: String,
    #[serde(default = "current_utc_timestamp")]
    pub updated_at: String,
}

fn default_deployment_method() -> String {
    "unspecified".to_string()
}

fn default_medium() -> Option<String> {
    Some("fiber".to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoleSpan {
    pub id: String,
    pub cable_segment_id: String,
    pub from_pole_id: String,
    pub to_pole_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub geometry: Option<LineGeometry>,
    #[serde(default)]
    pub covers_entire_cable_route: bool,
    #[serde(default = "default_pole_span_status")]
    pub status: String,
    #[serde(default)]
    pub notes: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub length_m: Option<f64>,
    #[serde(default = "default_length_source")]
    pub length_source: String,
}

fn default_pole_span_status() -> String {
    "unverified".to_string()
}

fn default_length_source() -> String {
    "unknown".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoleSpanRule {
    pub cable_category: String,
    pub max_span_m: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub placement_policy: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoleSpanPlanningConfig {
    #[serde(default)]
    pub rules: Vec<PoleSpanRule>,
    #[serde(default = "default_max_span")]
    pub default_max_span_m: f64,
    #[serde(default = "default_max_span")]
    pub max_odp_to_house_distance_m: f64,
}

fn default_max_span() -> f64 {
    300.0
}

impl Default for PoleSpanPlanningConfig {
    fn default() -> Self {
        Self {
            rules: Vec::new(),
            default_max_span_m: 300.0,
            max_odp_to_house_distance_m: 300.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpticalComponent {
    pub id: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub configured_loss_db: Option<f64>,
    #[serde(default = "default_source_unknown")]
    pub configured_source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub datasheet_loss_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub datasheet_reference: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub datasheet_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub measured_loss_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub measured_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub measurement_method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub measurement_reference: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub procurement_quantity: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub procurement_unit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub material_unit_cost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installation_unit_cost: Option<f64>,
    #[serde(default = "default_source_unknown")]
    pub price_source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price_reference: Option<String>,
}

fn default_source_unknown() -> String {
    "unknown".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopologyConnection {
    pub id: String,
    pub from_node_id: String,
    pub to_node_id: String,
    pub cable_segment_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub medium: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_port_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_port_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpticalBudgetConfig {
    #[serde(default = "default_tx_power")]
    pub tx_power_dbm: f64,
    #[serde(default = "default_attenuation")]
    pub fiber_attenuation_db_per_km: f64,
    #[serde(default = "default_attenuation")]
    pub drop_fiber_attenuation_db_per_km: f64,
    #[serde(default = "default_fiber_type")]
    pub fiber_type: Option<String>,
    #[serde(default = "default_wavelength")]
    pub wavelength_nm: Option<u32>,
    #[serde(default = "default_connector_loss")]
    pub connector_loss_db: f64,
    #[serde(default = "default_connectors_per_link")]
    pub connectors_per_link: u32,
    #[serde(default = "default_splice_loss")]
    pub splice_loss_db: f64,
    #[serde(default = "default_splices_per_link")]
    pub splices_per_link: u32,
    #[serde(default = "default_splice_loss")]
    pub pigtail_splice_loss_db: f64,
    #[serde(default)]
    pub pigtail_splices_per_link: u32,
    #[serde(default = "default_safety_margin")]
    pub safety_margin_db: f64,
    #[serde(default = "default_rx_sensitivity")]
    pub rx_sensitivity_dbm: f64,
    #[serde(default = "default_rx_overload")]
    pub rx_overload_dbm: f64,
    #[serde(default)]
    pub min_margin_db: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_standard_loss_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_standard_reference: Option<String>,
    #[serde(default)]
    pub parameter_sources: HashMap<String, String>,
    #[serde(default = "default_splitter_loss_table")]
    pub splitter_loss_table: HashMap<String, f64>,
}

fn default_tx_power() -> f64 { 2.5 }
fn default_attenuation() -> f64 { 0.35 }
fn default_fiber_type() -> Option<String> { Some("G.652.D".to_string()) }
fn default_wavelength() -> Option<u32> { Some(1310) }
fn default_connector_loss() -> f64 { 0.50 }
fn default_connectors_per_link() -> u32 { 2 }
fn default_splice_loss() -> f64 { 0.10 }
fn default_splices_per_link() -> u32 { 1 }
fn default_safety_margin() -> f64 { 3.0 }
fn default_rx_sensitivity() -> f64 { -27.0 }
fn default_rx_overload() -> f64 { -8.0 }

fn default_splitter_loss_table() -> HashMap<String, f64> {
    let mut map = HashMap::new();
    map.insert("1:2".to_string(), 3.5);
    map.insert("1:4".to_string(), 7.2);
    map.insert("1:8".to_string(), 10.5);
    map.insert("1:16".to_string(), 13.8);
    map.insert("1:32".to_string(), 17.1);
    map.insert("1:64".to_string(), 20.5);
    map
}

impl Default for OpticalBudgetConfig {
    fn default() -> Self {
        Self {
            tx_power_dbm: 2.5,
            fiber_attenuation_db_per_km: 0.35,
            drop_fiber_attenuation_db_per_km: 0.35,
            fiber_type: Some("G.652.D".to_string()),
            wavelength_nm: Some(1310),
            connector_loss_db: 0.50,
            connectors_per_link: 2,
            splice_loss_db: 0.10,
            splices_per_link: 1,
            pigtail_splice_loss_db: 0.10,
            pigtail_splices_per_link: 0,
            safety_margin_db: 3.0,
            rx_sensitivity_dbm: -27.0,
            rx_overload_dbm: -8.0,
            min_margin_db: 0.0,
            profile_id: Some("illustrative_gpon_planning_v1".to_string()),
            profile_note: None,
            project_standard_loss_db: None,
            project_standard_reference: None,
            parameter_sources: HashMap::new(),
            splitter_loss_table: default_splitter_loss_table(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConstructionCostConfig {
    #[serde(default = "default_currency")]
    pub currency: String,
    #[serde(default = "default_slack")]
    pub cable_slack_percent: f64,
    #[serde(default = "default_cable_mat_cost")]
    pub cable_unit_cost_per_meter: f64,
    #[serde(default = "default_cable_inst_cost")]
    pub cable_installation_cost_per_meter: f64,
    #[serde(default = "default_pole_mat_cost")]
    pub pole_unit_cost: f64,
    #[serde(default = "default_pole_inst_cost")]
    pub pole_installation_cost: f64,
    #[serde(default = "default_olt_mat_cost")]
    pub olt_unit_cost: f64,
    #[serde(default = "default_olt_inst_cost")]
    pub olt_installation_cost: f64,
    #[serde(default = "default_odc_mat_cost")]
    pub odc_unit_cost: f64,
    #[serde(default = "default_odc_inst_cost")]
    pub odc_installation_cost: f64,
    #[serde(default = "default_odp_mat_cost")]
    pub odp_unit_cost: f64,
    #[serde(default = "default_odp_inst_cost")]
    pub odp_installation_cost: f64,
    #[serde(default = "default_ont_mat_cost")]
    pub ont_unit_cost: f64,
    #[serde(default = "default_ont_inst_cost")]
    pub ont_installation_cost: f64,
    #[serde(default = "default_splitter_mat_cost")]
    pub splitter_unit_cost: f64,
    #[serde(default = "default_splitter_inst_cost")]
    pub splitter_installation_cost: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub router_unit_cost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub router_installation_cost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duct_unit_cost_per_meter: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trenching_cost_per_meter: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub excavation_cost_per_meter: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning_tape_cost_per_meter: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub underground_installation_cost_per_meter: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub building_attachment_cost_per_meter: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub other_deployment_cost_per_meter: Option<f64>,
    #[serde(default)]
    pub require_deployment_method_for_cable_cost: bool,
    #[serde(default)]
    pub rate_sources: HashMap<String, String>,
    #[serde(default)]
    pub rate_references: HashMap<String, String>,
    #[serde(default = "default_pole_cost_policy")]
    pub pole_cost_policy: HashMap<String, String>,
}

fn default_currency() -> String { "IDR".to_string() }
fn default_slack() -> f64 { 10.0 }
fn default_cable_mat_cost() -> f64 { 5000.0 }
fn default_cable_inst_cost() -> f64 { 7500.0 }
fn default_pole_mat_cost() -> f64 { 850000.0 }
fn default_pole_inst_cost() -> f64 { 350000.0 }
fn default_olt_mat_cost() -> f64 { 25000000.0 }
fn default_olt_inst_cost() -> f64 { 3000000.0 }
fn default_odc_mat_cost() -> f64 { 4500000.0 }
fn default_odc_inst_cost() -> f64 { 1200000.0 }
fn default_odp_mat_cost() -> f64 { 350000.0 }
fn default_odp_inst_cost() -> f64 { 150000.0 }
fn default_ont_mat_cost() -> f64 { 250000.0 }
fn default_ont_inst_cost() -> f64 { 100000.0 }
fn default_splitter_mat_cost() -> f64 { 120000.0 }
fn default_splitter_inst_cost() -> f64 { 50000.0 }

fn default_pole_cost_policy() -> HashMap<String, String> {
    let mut map = HashMap::new();
    map.insert("existing".to_string(), "exclude".to_string());
    map.insert("proposed".to_string(), "supply_and_install".to_string());
    map.insert("shared".to_string(), "exclude".to_string());
    map.insert("unverified".to_string(), "incomplete".to_string());
    map
}

impl Default for ConstructionCostConfig {
    fn default() -> Self {
        Self {
            currency: "IDR".to_string(),
            cable_slack_percent: 10.0,
            cable_unit_cost_per_meter: 5000.0,
            cable_installation_cost_per_meter: 7500.0,
            pole_unit_cost: 850000.0,
            pole_installation_cost: 350000.0,
            olt_unit_cost: 25000000.0,
            olt_installation_cost: 3000000.0,
            odc_unit_cost: 4500000.0,
            odc_installation_cost: 1200000.0,
            odp_unit_cost: 350000.0,
            odp_installation_cost: 150000.0,
            ont_unit_cost: 250000.0,
            ont_installation_cost: 100000.0,
            splitter_unit_cost: 120000.0,
            splitter_installation_cost: 50000.0,
            router_unit_cost: None,
            router_installation_cost: None,
            duct_unit_cost_per_meter: None,
            trenching_cost_per_meter: None,
            excavation_cost_per_meter: None,
            warning_tape_cost_per_meter: None,
            underground_installation_cost_per_meter: None,
            building_attachment_cost_per_meter: None,
            other_deployment_cost_per_meter: None,
            require_deployment_method_for_cable_cost: false,
            rate_sources: HashMap::new(),
            rate_references: HashMap::new(),
            pole_cost_policy: default_pole_cost_policy(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSettings {
    #[serde(default)]
    pub optical_budget: OpticalBudgetConfig,
    #[serde(default)]
    pub construction_cost: ConstructionCostConfig,
    #[serde(default)]
    pub pole_span_planning: PoleSpanPlanningConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectArea {
    pub id: String,
    pub name: String,
    pub geometry: serde_json::Value,
    #[serde(default = "default_fill_color")]
    pub fill_color: String,
    #[serde(default = "default_fill_opacity")]
    pub fill_opacity: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub classification: Option<String>,
}

fn default_fill_color() -> String { "#22c55e".to_string() }
fn default_fill_opacity() -> f64 { 0.2 }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_currency")]
    pub currency: String,
    #[serde(default)]
    pub nodes: Vec<NetworkNode>,
    #[serde(default)]
    pub customers: Vec<Customer>,
    #[serde(default)]
    pub cable_segments: Vec<CableSegment>,
    #[serde(default)]
    pub connections: Vec<TopologyConnection>,
    #[serde(default)]
    pub pole_spans: Vec<PoleSpan>,
    #[serde(default)]
    pub optical_components: Vec<OpticalComponent>,
    #[serde(default)]
    pub areas: Vec<ProjectArea>,
    #[serde(default)]
    pub settings: ProjectSettings,
    #[serde(default = "current_utc_timestamp")]
    pub created_at: String,
    #[serde(default = "current_utc_timestamp")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_currency")]
    pub currency: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    pub updated_at: String,
    pub node_count: usize,
    pub customer_count: usize,
    pub cable_segment_count: usize,
    pub connection_count: usize,
    #[serde(default)]
    pub device_counts: HashMap<String, usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectListResponse {
    pub projects: Vec<ProjectSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostItem {
    pub code: String,
    pub description: String,
    pub quantity: f64,
    pub unit: String,
    pub unit_cost: f64,
    pub amount: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default = "default_rate_source")]
    pub unit_cost_source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit_cost_reference: Option<String>,
    #[serde(default = "default_rate_status")]
    pub rate_status: Option<String>,
}

fn default_rate_source() -> String { "legacy_illustrative".to_string() }
fn default_rate_status() -> Option<String> { Some("Planning Estimate".to_string()) }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConstructionCostResult {
    pub project_id: String,
    pub calculated_at: String,
    pub currency: String,
    pub total_amount: f64,
    pub items: Vec<CostItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_capex: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_per_connected_customer: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connected_customer_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub planned_customer_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assigned_ont_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_per_planned_customer: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub material_subtotal: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installation_subtotal: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grand_total: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<serde_json::Value>,
    #[serde(default)]
    pub incomplete_items: Vec<serde_json::Value>,
    #[serde(default)]
    pub assumptions: Vec<String>,
    pub complete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpticalPathSegment {
    pub connection_id: String,
    pub cable_segment_id: String,
    pub cable_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cable_category: Option<String>,
    pub from_node_id: String,
    pub from_node_name: String,
    pub from_node_type: String,
    pub to_node_id: String,
    pub to_node_name: String,
    pub to_node_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub length_m: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub route_length_contribution_m: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attenuation_db_per_km: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fiber_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wavelength_nm: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fiber_loss_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connectors_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connector_unit_loss_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connector_loss_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub splices_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub splice_unit_loss_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub splice_loss_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pigtail_splices_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pigtail_splice_unit_loss_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pigtail_splice_loss_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_segment_loss_db: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpticalSplitterInfo {
    pub node_id: String,
    pub node_name: String,
    pub node_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub splitter_ratio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loss_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ideal_loss_db: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpticalDiagnostic {
    pub code: String,
    pub severity: String,
    pub category: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub affected_entity_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub affected_entity_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub affected_entity_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_value: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_value: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub corrective_action: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntermediateOpticalLossItem {
    pub component_id: String,
    pub component: String,
    pub category: String,
    pub position: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quantity: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quantity_unit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calculation_quantity: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calculation_quantity_unit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit_loss_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit_loss_unit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_loss_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cumulative_loss_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cable_segment_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cable_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cable_category: Option<String>,
    pub path_position: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntermediateOpticalResult {
    pub node_id: String,
    pub node_name: String,
    pub node_type: String,
    pub status: String,
    #[serde(default = "default_route_status")]
    pub physical_route_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_olt_id: Option<String>,
    #[serde(default)]
    pub node_ids: Vec<String>,
    #[serde(default)]
    pub connection_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub length_m: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accumulated_loss_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_power_dbm: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transmitter_power_dbm: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub design_margin_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_design_allowance_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_olt_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    #[serde(default)]
    pub loss_breakdown: Vec<IntermediateOpticalLossItem>,
    #[serde(default)]
    pub category_losses_db: HashMap<String, Option<f64>>,
    #[serde(default)]
    pub parameter_sources: HashMap<String, String>,
    #[serde(default)]
    pub diagnostics: Vec<String>,
}

fn default_route_status() -> String { "planned".to_string() }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpticalPathResult {
    pub ont_node_id: String,
    #[serde(default)]
    pub customer_ids: Vec<String>,
    #[serde(default)]
    pub node_ids: Vec<String>,
    #[serde(default)]
    pub connection_ids: Vec<String>,
    #[serde(default)]
    pub cable_segment_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub length_m: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loss_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx_power_dbm: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub received_power_dbm: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rx_sensitivity_dbm: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rx_overload_dbm: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sensitivity_margin_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overload_margin_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub margin_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_margin_db: Option<f64>,
    pub status: String,
    #[serde(default = "default_conn_status")]
    pub connectivity_status: String,
    #[serde(default = "default_budget_status")]
    pub optical_budget_status: String,
    #[serde(default = "default_route_status")]
    pub physical_route_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_reason: Option<String>,
    #[serde(default)]
    pub diagnostics: Vec<OpticalDiagnostic>,
    #[serde(default)]
    pub calculation_limitations: Vec<String>,
    #[serde(default)]
    pub parameter_sources: HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    #[serde(default)]
    pub segments: Vec<OpticalPathSegment>,
    #[serde(default)]
    pub splitters: Vec<OpticalSplitterInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
    #[serde(default)]
    pub component_losses: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub standard_loss_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub standard_variance_db: Option<f64>,
    #[serde(default)]
    pub datasheet_references: Vec<serde_json::Value>,
    #[serde(default)]
    pub field_measurements: Vec<serde_json::Value>,
    #[serde(default)]
    pub location_loss_summary: HashMap<String, Option<f64>>,
    #[serde(default)]
    pub loss_breakdown: Vec<IntermediateOpticalLossItem>,
    #[serde(default)]
    pub category_losses_db: HashMap<String, Option<f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub design_margin_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_design_allowance_db: Option<f64>,
}

fn default_conn_status() -> String { "connected".to_string() }
fn default_budget_status() -> String { "unknown".to_string() }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpticalLinkResult {
    pub connection_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub length_m: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loss_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub received_power_dbm: Option<f64>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub margin_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpticalBudgetResult {
    pub project_id: String,
    pub calculated_at: String,
    pub links: Vec<OpticalLinkResult>,
    #[serde(default)]
    pub paths: Vec<OpticalPathResult>,
    #[serde(default)]
    pub intermediate_nodes: Vec<IntermediateOpticalResult>,
    #[serde(default)]
    pub disconnected_customer_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<serde_json::Value>,
    #[serde(default)]
    pub diagnostics: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoleSpanResult {
    pub project_id: String,
    pub calculated_at: String,
    #[serde(default)]
    pub spans: Vec<serde_json::Value>,
    #[serde(default)]
    pub diagnostics: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_additional_poles: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimation_method: Option<String>,
    #[serde(default)]
    pub assumptions: Vec<String>,
    pub max_span_limit_m: f64,
    pub max_odp_to_house_limit_m: f64,
    #[serde(default)]
    pub odp_house_distances: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopologyIssue {
    pub code: String,
    pub message: String,
    #[serde(default = "default_severity_error")]
    pub severity: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub policy_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_node_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_node_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cable_segment_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

fn default_severity_error() -> String { "error".to_string() }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopologyValidationResult {
    pub valid: bool,
    #[serde(default)]
    pub errors: Vec<TopologyIssue>,
    #[serde(default)]
    pub warnings: Vec<TopologyIssue>,
    #[serde(default)]
    pub summary: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionValidationRequest {
    pub from_node_id: String,
    pub to_node_id: String,
    pub cable_segment_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub medium: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_port_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_port_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project: Option<Project>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouterConfigIssue {
    pub field: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(default = "default_severity_error")]
    pub severity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouterValidationResponse {
    pub valid: bool,
    #[serde(default)]
    pub issues: Vec<RouterConfigIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorDetail {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorBody {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Vec<ErrorDetail>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorEnvelope {
    pub error: ErrorBody,
}

#[cfg(test)]
mod node_type_tests {
    use super::NodeType;

    #[test]
    fn physical_access_nodes_round_trip_without_becoming_unknown() {
        for (wire, expected) in [
            ("\"manhole\"", NodeType::Manhole),
            ("\"handhole\"", NodeType::Handhole),
            ("\"annotation\"", NodeType::Annotation),
        ] {
            let parsed: NodeType = serde_json::from_str(wire).expect("known physical node type");
            assert_eq!(parsed, expected);
            assert_eq!(serde_json::to_string(&parsed).unwrap(), wire);
            assert_eq!(parsed.as_str(), wire.trim_matches('"'));
        }
    }
}
