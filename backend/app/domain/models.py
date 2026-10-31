"""Domain models and Pydantic schemas for the FTTH Network Planning Simulator.

Conforms to docs/PROJECT_SPEC.md and docs/API_CONTRACT.md.
All wire formats use camelCase serialization, RFC 7946 GeoJSON [longitude, latitude],
and RFC 3339 UTC timestamps.
"""

from datetime import datetime, timezone
from enum import Enum
import math
from typing import Any, Dict, List, Literal, Optional, Tuple
import uuid
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator, AliasChoices
from pydantic.alias_generators import to_camel


def current_utc_timestamp() -> str:
    """Return ISO 8601 / RFC 3339 UTC timestamp."""
    return datetime.now(timezone.utc).isoformat()


class CamelModel(BaseModel):
    """Base Pydantic model configuring camelCase serialization and population by field name."""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


class NodeType(str, Enum):
    """Supported network node types."""
    OLT = "olt"
    ODC = "odc"
    ODP = "odp"
    ONT = "ont"
    POLE = "pole"
    SPLITTER = "splitter"
    ROUTER = "router"
    CUSTOMER = "customer"


class CustomerStatus(str, Enum):
    """Customer subscription / planning status."""
    PLANNED = "planned"
    CONNECTED = "connected"
    ON_HOLD = "on_hold"


class WanMode(str, Enum):
    """Router WAN addressing mode."""
    DHCP = "dhcp-client"
    STATIC = "static-ipv4"
    PPPOE = "pppoe"


class RouterConfig(CamelModel):
    """Customer-premises router configuration."""
    hostname: Optional[str] = None
    wan_mode: Optional[WanMode] = Field(
        default=None,
        validation_alias=AliasChoices("wanMode", "wan_mode"),
    )
    wan_ipv4_address: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("wanIpv4Address", "wan_ipv4_address", "wanIp", "wan_ip"),
    )
    wan_prefix: Optional[int] = Field(
        default=None,
        validation_alias=AliasChoices("wanPrefix", "wan_prefix", "wanCidr", "wan_cidr"),
    )
    default_gateway: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("defaultGateway", "default_gateway", "gateway"),
    )
    lan_ipv4_address: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("lanIpv4Address", "lan_ipv4_address", "lanIp", "lan_ip"),
    )
    lan_prefix: Optional[int] = Field(
        default=None,
        validation_alias=AliasChoices("lanPrefix", "lan_prefix", "lanCidr", "lan_cidr"),
    )
    dhcp_server_enabled: Optional[bool] = Field(
        default=None,
        validation_alias=AliasChoices("dhcpServerEnabled", "dhcp_server_enabled", "dhcpEnabled", "dhcp_enabled"),
    )
    dhcp_pool_start: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("dhcpPoolStart", "dhcp_pool_start"),
    )
    dhcp_pool_end: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("dhcpPoolEnd", "dhcp_pool_end"),
    )
    dns_servers: Optional[List[str]] = Field(
        default=None,
        validation_alias=AliasChoices("dnsServers", "dns_servers", "dns"),
    )
    nat_enabled: Optional[bool] = Field(
        default=None,
        validation_alias=AliasChoices("natEnabled", "nat_enabled"),
    )
    vlan_id: Optional[int] = Field(
        default=None,
        validation_alias=AliasChoices("vlanId", "vlan_id"),
    )
    pppoe_username: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("pppoeUsername", "pppoe_username"),
    )
    pppoe_password: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("pppoePassword", "pppoe_password"),
    )

    @field_validator("wan_mode", mode="before")
    @classmethod
    def normalize_wan_mode(cls, v: Any) -> Optional[WanMode]:
        if v is None:
            return None
        if isinstance(v, WanMode):
            return v
        if isinstance(v, str):
            v_str = v.strip().lower()
            if v_str in ("dhcp", "dhcp-client", "dhcp_client"):
                return WanMode.DHCP
            if v_str in ("static", "static-ipv4", "static_ipv4"):
                return WanMode.STATIC
            if v_str == "pppoe":
                return WanMode.PPPOE
            try:
                return WanMode(v_str)
            except ValueError:
                return v
        return v

    def __repr__(self) -> str:
        data = self.model_dump(by_alias=True)
        if data.get("pppoePassword") is not None:
            data["pppoePassword"] = "******"
        return f"RouterConfig({data})"

    def __str__(self) -> str:
        return self.__repr__()


class PointGeometry(CamelModel):
    """GeoJSON Point geometry [longitude, latitude]."""
    type: Literal["Point"] = "Point"
    coordinates: Tuple[float, float]

    @field_validator("coordinates")
    @classmethod
    def validate_coordinates(cls, coords: Tuple[float, float]) -> Tuple[float, float]:
        if len(coords) != 2:
            raise ValueError("Point coordinates must have exactly two values [longitude, latitude]")
        lon, lat = coords
        if not math.isfinite(lon) or not math.isfinite(lat):
            raise ValueError(f"Point coordinates ({lon}, {lat}) must be finite numbers")
        if not (-180.0 <= lon <= 180.0):
            raise ValueError(f"Longitude {lon} must be between -180 and 180 degrees")
        if not (-90.0 <= lat <= 90.0):
            raise ValueError(f"Latitude {lat} must be between -90 and 90 degrees")
        return coords


class LineGeometry(CamelModel):
    """GeoJSON LineString geometry [[lon, lat], ...]."""
    type: Literal["LineString"] = "LineString"
    coordinates: List[Tuple[float, float]]

    @field_validator("coordinates")
    @classmethod
    def validate_coordinates(cls, coords: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
        if len(coords) < 2:
            raise ValueError("A cable LineString must have at least two coordinates")
        for idx, pt in enumerate(coords):
            if len(pt) != 2:
                raise ValueError(f"Coordinate #{idx} must have exactly two values [longitude, latitude]")
            lon, lat = pt
            if not math.isfinite(lon) or not math.isfinite(lat):
                raise ValueError(f"Coordinate #{idx} must contain finite numeric values")
            if not (-180.0 <= lon <= 180.0):
                raise ValueError(f"Coordinate #{idx} longitude {lon} out of bounds [-180, 180]")
            if not (-90.0 <= lat <= 90.0):
                raise ValueError(f"Coordinate #{idx} latitude {lat} out of bounds [-90, 90]")
        return coords


class NetworkNode(CamelModel):
    """Network node entity (OLT, ODC, ODP, ONT, Pole, Splitter)."""
    id: str
    type: NodeType
    name: str
    location: PointGeometry
    properties: Dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(default_factory=current_utc_timestamp)
    updated_at: str = Field(default_factory=current_utc_timestamp)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Node name must not be empty after trimming")
        return trimmed

    @field_validator("type", mode="before")
    @classmethod
    def normalize_type(cls, value: Any) -> NodeType:
        if isinstance(value, str):
            value = value.strip().lower()
        return NodeType(value)


class Customer(CamelModel):
    """Customer service endpoint."""
    id: str
    name: str
    address: str = ""
    location: PointGeometry
    status: CustomerStatus = CustomerStatus.PLANNED
    ont_node_id: Optional[str] = None
    properties: Dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(default_factory=current_utc_timestamp)
    updated_at: str = Field(default_factory=current_utc_timestamp)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Customer name must not be empty after trimming")
        return trimmed

    @field_validator("status", mode="before")
    @classmethod
    def normalize_status(cls, value: Any) -> CustomerStatus:
        if isinstance(value, str):
            value = value.strip().lower()
        return CustomerStatus(value)


DEPLOYMENT_METHODS = ("aerial", "underground", "building_attached", "other", "unspecified")
DeploymentMethodType = Literal["aerial", "underground", "building_attached", "other", "unspecified"]


def normalize_deployment_method(raw: Any) -> Tuple[DeploymentMethodType, bool]:
    """Normalize a raw deployment method value into (normalized_method, is_malformed)."""
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return "unspecified", False
    if not isinstance(raw, str):
        return "unspecified", True
    cleaned = raw.strip().lower().replace("-", "_").replace(" ", "_")
    if cleaned in DEPLOYMENT_METHODS:
        return cleaned, False  # type: ignore[return-value]
    return "unspecified", True


class CableSegment(CamelModel):
    """Cable route segment with geographic geometry and engineering properties."""
    id: str
    name: str
    cable_type: str = ""
    fiber_count: Optional[int] = None
    deployment_method: DeploymentMethodType = "unspecified"
    geometry: LineGeometry
    length_m: Optional[float] = None
    start_node_id: Optional[str] = None
    end_node_id: Optional[str] = None
    medium: Optional[Literal["fiber", "copper", "wireless"]] = "fiber"
    connection_type: Optional[Literal["optical", "ethernet"]] = None
    properties: Dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(default_factory=current_utc_timestamp)
    updated_at: str = Field(default_factory=current_utc_timestamp)

    @model_validator(mode="before")
    @classmethod
    def sync_deployment_method(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        data = dict(value)
        props = dict(data.get("properties") or {})
        raw_top = data.get("deploymentMethod", data.get("deployment_method"))
        raw_prop = props.get("deploymentMethod", props.get("deployment_method"))
        raw = raw_top if raw_top is not None else raw_prop
        norm, malformed = normalize_deployment_method(raw)
        data["deploymentMethod"] = norm
        if malformed:
            props["rawDeploymentMethod"] = raw
            props["deploymentMethodMalformed"] = True
        elif raw is not None or "deploymentMethod" in props:
            props["deploymentMethod"] = norm
            props.pop("deploymentMethodMalformed", None)
        data["properties"] = props
        return data

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Cable segment name must not be empty after trimming")
        return trimmed

    @field_validator("fiber_count")
    @classmethod
    def validate_fiber_count(cls, value: Optional[int]) -> Optional[int]:
        if value is not None and value <= 0:
            raise ValueError("fiberCount must be a positive integer")
        return value


class PoleSpan(CamelModel):
    """Explicit physical cable-to-pole span; never inferred from proximity."""
    id: str
    cable_segment_id: str
    from_pole_id: str
    to_pole_id: str
    geometry: Optional[LineGeometry] = None
    covers_entire_cable_route: bool = False
    status: Literal["existing", "proposed", "shared", "unverified"] = "unverified"
    notes: str = ""
    length_m: Optional[float] = None
    length_source: Literal["measured", "geometry", "legacy", "unknown"] = "unknown"

    @model_validator(mode="before")
    @classmethod
    def preserve_legacy_length_provenance(cls, value: Any) -> Any:
        """Keep old stored lengths marked ambiguous instead of calling them measurements."""
        if not isinstance(value, dict):
            return value
        data = dict(value)
        if "lengthSource" not in data and "length_source" not in data:
            data["lengthSource"] = "legacy" if data.get("lengthM", data.get("length_m")) is not None else "unknown"
        return data


class PoleSpanRule(CamelModel):
    cable_category: str
    max_span_m: float
    placement_policy: Optional[Literal["uniform_maximum_spacing"]] = None

    @field_validator("max_span_m")
    @classmethod
    def validate_max_span(cls, value: float) -> float:
        if not math.isfinite(value) or value <= 0 or value > 300.0:
            raise ValueError("maxSpanM must be a finite positive value up to 300 m")
        return value


class PoleSpanPlanningConfig(CamelModel):
    rules: List[PoleSpanRule] = Field(default_factory=list)
    default_max_span_m: float = 300.0
    max_odp_to_house_distance_m: float = 300.0

    @field_validator("default_max_span_m", "max_odp_to_house_distance_m")
    @classmethod
    def validate_positive_limits(cls, value: float) -> float:
        if not math.isfinite(value) or value <= 0 or value > 300.0:
            raise ValueError("Maximum span and ODP-to-house limits must be finite positive values up to 300 m")
        return value


class OpticalComponent(CamelModel):
    """Physical optical component with separate configured, datasheet and measured values."""
    id: str
    kind: str
    node_id: Optional[str] = None
    connection_id: Optional[str] = None
    location: Optional[str] = None
    configured_loss_db: Optional[float] = None
    configured_source: Literal["configured", "unknown"] = "unknown"
    datasheet_loss_db: Optional[float] = None
    datasheet_reference: Optional[str] = None
    datasheet_model: Optional[str] = None
    measured_loss_db: Optional[float] = None
    measured_at: Optional[str] = None
    measurement_method: Optional[str] = None
    measurement_reference: Optional[str] = None
    procurement_quantity: Optional[float] = None
    procurement_unit: Optional[str] = None
    material_unit_cost: Optional[float] = None
    installation_unit_cost: Optional[float] = None
    price_source: Literal["configured", "unknown"] = "unknown"
    price_reference: Optional[str] = None

    @model_validator(mode="after")
    def validate_sources(self):
        if self.configured_source == "configured" and self.configured_loss_db is None:
            raise ValueError("configuredLossDb is required when configuredSource is configured")
        for field_name in ("configured_loss_db", "datasheet_loss_db", "measured_loss_db", "procurement_quantity", "material_unit_cost", "installation_unit_cost"):
            value = getattr(self, field_name)
            if value is not None and (not math.isfinite(value) or value < 0):
                raise ValueError(f"{field_name} must be finite and non-negative")
        if self.procurement_quantity is not None and self.procurement_quantity == 0:
            raise ValueError("procurementQuantity must be positive when supplied")
        return self


class TopologyConnection(CamelModel):
    """Logical connection linking two network nodes across a cable segment."""
    id: str
    from_node_id: str
    to_node_id: str
    cable_segment_id: str
    medium: Optional[Literal["fiber", "copper", "wireless"]] = None
    connection_type: Optional[Literal["optical", "ethernet"]] = None

    @field_validator("to_node_id")
    @classmethod
    def validate_not_self_loop(cls, to_id: str, info) -> str:
        from_id = info.data.get("from_node_id")
        if from_id is not None and from_id == to_id:
            raise ValueError("A topology connection must join two different nodes (self-link is invalid)")
        return to_id


# --- Engineering Configuration Models ---

LECTURE_OPTICAL_PROFILE_ID = "lecture_material_gpon_v1"
LECTURE_OPTICAL_PROFILE_NOTE = (
    "Nilai awal berasal dari materi kuliah yang diberikan pengguna, bukan standar universal yang sudah diverifikasi."
)
LECTURE_SPLITTER_LOSS_TABLE: Dict[str, float] = {
    "1:2": 3.5,
    "1:4": 7.25,
    "1:8": 10.38,
    "1:16": 15.0,
    "1:32": 18.6,
    "1:64": 22.8,
}

OPTICAL_PARAMETER_SOURCE_KEYS = (
    "txPowerDbm",
    "fiberAttenuationDbPerKm",
    "dropFiberAttenuationDbPerKm",
    "fiberType",
    "wavelengthNm",
    "connectorLossDb",
    "connectorsPerLink",
    "spliceLossDb",
    "splicesPerLink",
    "pigtailSpliceLossDb",
    "pigtailSplicesPerLink",
    "safetyMarginDb",
    "rxSensitivityDbm",
    "rxOverloadDbm",
    "minMarginDb",
    "splitterLossTable",
)
OPTICAL_PARAMETER_VALUE_KEYS = {
    "txPowerDbm": ("txPowerDbm", "tx_power_dbm"),
    "fiberAttenuationDbPerKm": ("fiberAttenuationDbPerKm", "fiber_attenuation_db_per_km"),
    "dropFiberAttenuationDbPerKm": ("dropFiberAttenuationDbPerKm", "drop_fiber_attenuation_db_per_km"),
    "fiberType": ("fiberType", "fiber_type"),
    "wavelengthNm": ("wavelengthNm", "wavelength_nm"),
    "connectorLossDb": ("connectorLossDb", "connector_loss_db"),
    "connectorsPerLink": ("connectorsPerLink", "connectors_per_link"),
    "spliceLossDb": ("spliceLossDb", "splice_loss_db"),
    "splicesPerLink": ("splicesPerLink", "splices_per_link"),
    "pigtailSpliceLossDb": ("pigtailSpliceLossDb", "pigtail_splice_loss_db"),
    "pigtailSplicesPerLink": ("pigtailSplicesPerLink", "pigtail_splices_per_link"),
    "safetyMarginDb": ("safetyMarginDb", "safety_margin_db"),
    "rxSensitivityDbm": ("rxSensitivityDbm", "rx_sensitivity_dbm"),
    "rxOverloadDbm": ("rxOverloadDbm", "rx_overload_dbm"),
    "minMarginDb": ("minMarginDb", "min_margin_db"),
    "splitterLossTable": ("splitterLossTable", "splitter_loss_table"),
}

class OpticalBudgetConfig(CamelModel):
    """Configurable parameters for optical power budget calculations."""
    tx_power_dbm: float = 2.5
    fiber_attenuation_db_per_km: float = 0.35
    drop_fiber_attenuation_db_per_km: float = 0.35
    fiber_type: Optional[str] = "G.652.D"
    wavelength_nm: Optional[int] = 1310
    connector_loss_db: float = 0.50
    connectors_per_link: int = 2
    splice_loss_db: float = 0.10
    splices_per_link: int = 1
    pigtail_splice_loss_db: float = 0.10
    pigtail_splices_per_link: int = 0
    safety_margin_db: float = 3.0
    rx_sensitivity_dbm: float = -27.0
    rx_overload_dbm: float = -8.0
    min_margin_db: float = 0.0
    profile_id: Optional[str] = None
    profile_note: Optional[str] = None
    project_standard_loss_db: Optional[float] = None
    project_standard_reference: Optional[str] = None
    parameter_sources: Dict[str, Literal["configured", "profile_default", "legacy_fallback", "unknown"]] = Field(default_factory=dict)
    splitter_loss_table: Dict[str, float] = Field(
        default_factory=lambda: {
            "1:2": 3.5,
            "1:4": 7.2,
            "1:8": 10.5,
            "1:16": 13.8,
            "1:32": 17.1,
            "1:64": 20.5,
        }
    )

    @model_validator(mode="before")
    @classmethod
    def assign_legacy_parameter_provenance(cls, value: Any) -> Any:
        """Tag implicit defaults and old serialized configs without changing their values.

        An empty config uses the documented illustrative profile. Config objects
        containing legacy fields but no provenance came from the pre-provenance
        contract and are conservatively classified as legacy fallbacks.
        When profileId is 'lecture_material_gpon_v1', lecture reference defaults
        are applied for any field not explicitly overridden.
        """
        if not isinstance(value, dict):
            return value
        data = dict(value)
        requested_profile = data.get("profileId", data.get("profile_id"))
        if requested_profile == LECTURE_OPTICAL_PROFILE_ID:
            if "fiberAttenuationDbPerKm" not in data and "fiber_attenuation_db_per_km" not in data:
                data["fiberAttenuationDbPerKm"] = 0.35
            if "dropFiberAttenuationDbPerKm" not in data and "drop_fiber_attenuation_db_per_km" not in data:
                data["dropFiberAttenuationDbPerKm"] = 0.35
            if "connectorLossDb" not in data and "connector_loss_db" not in data:
                data["connectorLossDb"] = 0.25
            if "spliceLossDb" not in data and "splice_loss_db" not in data:
                data["spliceLossDb"] = 0.10
            if "pigtailSpliceLossDb" not in data and "pigtail_splice_loss_db" not in data:
                data["pigtailSpliceLossDb"] = 0.10
            if "splitterLossTable" not in data and "splitter_loss_table" not in data:
                data["splitterLossTable"] = dict(LECTURE_SPLITTER_LOSS_TABLE)
            if "profileNote" not in data and "profile_note" not in data:
                data["profileNote"] = LECTURE_OPTICAL_PROFILE_NOTE
        source_key = "parameterSources" if "parameterSources" in data else "parameter_sources"
        has_sources = source_key in data
        has_legacy_values = any(
            key in data
            for key in (
                "txPowerDbm", "tx_power_dbm", "fiberAttenuationDbPerKm", "fiber_attenuation_db_per_km",
                "dropFiberAttenuationDbPerKm", "drop_fiber_attenuation_db_per_km",
                "fiberType", "fiber_type", "wavelengthNm", "wavelength_nm",
                "connectorLossDb", "connector_loss_db", "connectorsPerLink", "connectors_per_link",
                "spliceLossDb", "splice_loss_db", "splicesPerLink", "splices_per_link",
                "pigtailSpliceLossDb", "pigtail_splice_loss_db", "pigtailSplicesPerLink", "pigtail_splices_per_link",
                "safetyMarginDb", "safety_margin_db", "rxSensitivityDbm", "rx_sensitivity_dbm",
                "rxOverloadDbm", "rx_overload_dbm", "minMarginDb", "min_margin_db",
                "splitterLossTable", "splitter_loss_table",
            )
        )
        if has_sources:
            sources = dict(data[source_key] or {})
            default_source = "legacy_fallback"
        elif requested_profile == LECTURE_OPTICAL_PROFILE_ID:
            sources = {}
            default_source = "profile_default"
            data["profileId"] = LECTURE_OPTICAL_PROFILE_ID
        elif has_legacy_values:
            sources = {}
            default_source = "legacy_fallback"
            data["profileId"] = data.get("profileId", data.get("profile_id", "legacy_unclassified"))
        else:
            sources = {}
            default_source = "profile_default"
            data["profileId"] = data.get("profileId", data.get("profile_id", "illustrative_gpon_planning_v1"))
        optional_profile_keys = {
            "dropFiberAttenuationDbPerKm",
            "pigtailSpliceLossDb",
            "pigtailSplicesPerLink",
        }
        for key in OPTICAL_PARAMETER_SOURCE_KEYS:
            if key in sources:
                if sources[key] == "configured" and not any(
                    alias in data for alias in OPTICAL_PARAMETER_VALUE_KEYS[key]
                ):
                    if key not in optional_profile_keys:
                        raise ValueError(f"Configured optical parameter '{key}' must include its value")
                    # Older clients commonly marked the whole parameter map as
                    # configured while omitting optional fields. Keep those
                    # serialized projects loadable, but disclose that the value
                    # came from a legacy default rather than claiming explicit
                    # configuration.
                    sources[key] = "legacy_fallback"
                continue
            if has_sources:
                has_value = any(alias in data for alias in OPTICAL_PARAMETER_VALUE_KEYS[key])
                if key in optional_profile_keys and not has_value:
                    sources[key] = "profile_default"
                else:
                    sources[key] = "legacy_fallback" if has_value else "unknown"
            else:
                sources[key] = default_source
        data[source_key] = sources
        return data


class ConstructionCostConfig(CamelModel):
    """Configurable unit rates and allowances for Bill of Quantities (BoQ)."""
    currency: str = "IDR"
    cable_slack_percent: float = 10.0
    cable_unit_cost_per_meter: float = 5000.0
    cable_installation_cost_per_meter: float = 7500.0
    pole_unit_cost: float = 850000.0
    pole_installation_cost: float = 350000.0
    olt_unit_cost: float = 25000000.0
    olt_installation_cost: float = 3000000.0
    odc_unit_cost: float = 4500000.0
    odc_installation_cost: float = 1200000.0
    odp_unit_cost: float = 350000.0
    odp_installation_cost: float = 150000.0
    ont_unit_cost: float = 250000.0
    ont_installation_cost: float = 100000.0
    splitter_unit_cost: float = 120000.0
    splitter_installation_cost: float = 50000.0
    router_unit_cost: Optional[float] = None
    router_installation_cost: Optional[float] = None
    duct_unit_cost_per_meter: Optional[float] = None
    trenching_cost_per_meter: Optional[float] = None
    excavation_cost_per_meter: Optional[float] = None
    warning_tape_cost_per_meter: Optional[float] = None
    underground_installation_cost_per_meter: Optional[float] = None
    building_attachment_cost_per_meter: Optional[float] = None
    other_deployment_cost_per_meter: Optional[float] = None
    require_deployment_method_for_cable_cost: bool = False
    rate_sources: Dict[str, Literal["configured", "legacy_illustrative", "unknown"]] = Field(default_factory=dict)
    rate_references: Dict[str, str] = Field(default_factory=dict)
    pole_cost_policy: Dict[str, Literal["supply_and_install", "installation_only", "exclude", "incomplete"]] = Field(
        default_factory=lambda: {"existing": "exclude", "proposed": "supply_and_install", "shared": "exclude", "unverified": "incomplete"}
    )

    @model_validator(mode="before")
    @classmethod
    def assign_rate_provenance(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        data = dict(value)
        key = "rateSources" if "rateSources" in data else "rate_sources"
        sources = dict(data.get(key) or {})
        rate_keys = (
            "cableUnitCostPerMeter", "cableInstallationCostPerMeter", "poleUnitCost", "poleInstallationCost",
            "oltUnitCost", "oltInstallationCost", "odcUnitCost", "odcInstallationCost", "odpUnitCost",
            "odpInstallationCost", "ontUnitCost", "ontInstallationCost", "splitterUnitCost",
            "splitterInstallationCost", "routerUnitCost", "routerInstallationCost",
            "ductUnitCostPerMeter", "trenchingCostPerMeter", "excavationCostPerMeter",
            "warningTapeCostPerMeter", "undergroundInstallationCostPerMeter",
            "buildingAttachmentCostPerMeter", "otherDeploymentCostPerMeter",
        )
        snake = {
            "cableUnitCostPerMeter": "cable_unit_cost_per_meter", "cableInstallationCostPerMeter": "cable_installation_cost_per_meter",
            "poleUnitCost": "pole_unit_cost", "poleInstallationCost": "pole_installation_cost", "oltUnitCost": "olt_unit_cost",
            "oltInstallationCost": "olt_installation_cost", "odcUnitCost": "odc_unit_cost", "odcInstallationCost": "odc_installation_cost",
            "odpUnitCost": "odp_unit_cost", "odpInstallationCost": "odp_installation_cost", "ontUnitCost": "ont_unit_cost",
            "ontInstallationCost": "ont_installation_cost", "splitterUnitCost": "splitter_unit_cost",
            "splitterInstallationCost": "splitter_installation_cost", "routerUnitCost": "router_unit_cost",
            "routerInstallationCost": "router_installation_cost",
            "ductUnitCostPerMeter": "duct_unit_cost_per_meter",
            "trenchingCostPerMeter": "trenching_cost_per_meter",
            "excavationCostPerMeter": "excavation_cost_per_meter",
            "warningTapeCostPerMeter": "warning_tape_cost_per_meter",
            "undergroundInstallationCostPerMeter": "underground_installation_cost_per_meter",
            "buildingAttachmentCostPerMeter": "building_attachment_cost_per_meter",
            "otherDeploymentCostPerMeter": "other_deployment_cost_per_meter",
        }
        optional_configured_keys = {
            "routerUnitCost", "routerInstallationCost",
            "ductUnitCostPerMeter", "trenchingCostPerMeter", "excavationCostPerMeter",
            "warningTapeCostPerMeter", "undergroundInstallationCostPerMeter",
            "buildingAttachmentCostPerMeter", "otherDeploymentCostPerMeter",
        }
        for wire_key in rate_keys:
            if wire_key in sources:
                if sources[wire_key] == "configured" and data.get(wire_key, data.get(snake[wire_key])) is None:
                    raise ValueError(f"Configured cost rate '{wire_key}' must include its value")
            elif wire_key in optional_configured_keys:
                if data.get(wire_key, data.get(snake[wire_key])) is not None:
                    sources[wire_key] = "configured"
            else:
                sources[wire_key] = "legacy_illustrative"
        data[key] = sources
        return data


class ProjectSettings(CamelModel):
    """Configurable project engineering and costing settings."""
    optical_budget: OpticalBudgetConfig = Field(default_factory=OpticalBudgetConfig)
    construction_cost: ConstructionCostConfig = Field(default_factory=ConstructionCostConfig)
    pole_span_planning: PoleSpanPlanningConfig = Field(default_factory=PoleSpanPlanningConfig)


class ProjectArea(CamelModel):
    """Geographic annotation polygon; it does not imply serviceability."""
    id: str
    name: str
    geometry: Dict[str, Any]
    fill_color: str = "#22c55e"
    fill_opacity: float = 0.2
    border_color: Optional[str] = None
    description: Optional[str] = None
    classification: Optional[Literal["project_boundary", "service_area", "residential_block", "custom"]] = None

    @staticmethod
    def _segments_intersect(a, b, c, d) -> bool:
        def orient(p, q, r):
            return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])

        def on_segment(p, q, r):
            return min(p[0], r[0]) <= q[0] <= max(p[0], r[0]) and min(p[1], r[1]) <= q[1] <= max(p[1], r[1])

        o1, o2, o3, o4 = orient(a, b, c), orient(a, b, d), orient(c, d, a), orient(c, d, b)
        if ((o1 > 0 > o2) or (o2 > 0 > o1)) and ((o3 > 0 > o4) or (o4 > 0 > o3)):
            return True
        return (
            (o1 == 0 and on_segment(a, c, b))
            or (o2 == 0 and on_segment(a, d, b))
            or (o3 == 0 and on_segment(c, a, d))
            or (o4 == 0 and on_segment(c, b, d))
        )

    @field_validator("geometry")
    @classmethod
    def validate_polygon_geometry(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        coordinates = value.get("coordinates") if value.get("type") == "Polygon" else None
        if not isinstance(coordinates, list) or not coordinates:
            raise ValueError("Polygon needs at least three vertices and a closing coordinate")
        for ring in coordinates:
            if not isinstance(ring, list) or len(ring) < 4:
                raise ValueError("Polygon needs at least three vertices and a closing coordinate")
            for point in ring:
                if not isinstance(point, (list, tuple)) or len(point) < 2:
                    raise ValueError("Polygon coordinates must contain longitude and latitude")
                lon, lat = point[:2]
                if not isinstance(lon, (int, float)) or not isinstance(lat, (int, float)) or not math.isfinite(lon) or not math.isfinite(lat) or not -180 <= lon <= 180 or not -90 <= lat <= 90:
                    raise ValueError("Polygon coordinates must use valid longitude/latitude values")
            if ring[0][:2] != ring[-1][:2]:
                raise ValueError("Polygon ring must be closed (first and last coordinates must match)")
            vertices = [tuple(point[:2]) for point in ring[:-1]]
            if any(vertices[index] == vertices[(index + 1) % len(vertices)] for index in range(len(vertices))):
                raise ValueError("Polygon ring must not contain duplicate adjacent vertices")
            if len(set(vertices)) < 3:
                raise ValueError("Polygon ring must contain at least three distinct vertices")
            doubled_area = sum(
                vertices[index][0] * vertices[(index + 1) % len(vertices)][1]
                - vertices[(index + 1) % len(vertices)][0] * vertices[index][1]
                for index in range(len(vertices))
            )
            if abs(doubled_area) <= 1e-15:
                raise ValueError("Polygon must enclose a non-zero area")
            edge_count = len(vertices)
            for first in range(edge_count):
                a, b = vertices[first], vertices[(first + 1) % edge_count]
                for second in range(first + 1, edge_count):
                    if second == first + 1 or (first == 0 and second == edge_count - 1):
                        continue
                    c, d = vertices[second], vertices[(second + 1) % edge_count]
                    if ProjectArea._segments_intersect(a, b, c, d):
                        raise ValueError("Polygon boundary must not self-intersect")
        return value

    @field_validator("fill_opacity")
    @classmethod
    def validate_fill_opacity(cls, value: float) -> float:
        if not 0 <= value <= 1:
            raise ValueError("Polygon fill opacity must be between 0 and 1")
        return value


# --- Aggregate and Result Models ---

class Project(CamelModel):
    """Full project domain aggregate."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: str = ""
    currency: str = "IDR"
    nodes: List[NetworkNode] = Field(default_factory=list)
    customers: List[Customer] = Field(default_factory=list)
    cable_segments: List[CableSegment] = Field(default_factory=list)
    connections: List[TopologyConnection] = Field(default_factory=list)
    pole_spans: List[PoleSpan] = Field(default_factory=list)
    optical_components: List[OpticalComponent] = Field(default_factory=list)
    areas: List[ProjectArea] = Field(default_factory=list)
    settings: ProjectSettings = Field(default_factory=ProjectSettings)
    created_at: str = Field(default_factory=current_utc_timestamp)
    updated_at: str = Field(default_factory=current_utc_timestamp)

    @field_validator("id", mode="before")
    @classmethod
    def validate_or_generate_id(cls, value: Any) -> str:
        if value is None or not str(value).strip():
            return str(uuid.uuid4())
        return str(value).strip()

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Project name must not be empty after trimming")
        return trimmed


class ProjectSummary(CamelModel):
    """Project summary for list views and library selection."""
    id: str
    name: str
    description: str = ""
    currency: str = "IDR"
    created_at: Optional[str] = None
    updated_at: str
    node_count: int = 0
    customer_count: int = 0
    cable_segment_count: int = 0
    connection_count: int = 0
    device_counts: Dict[str, int] = Field(default_factory=dict)


class ProjectListResponse(CamelModel):
    """Response envelope for GET /projects."""
    projects: List[ProjectSummary]


class OpticalLinkResult(CamelModel):
    """Per-link optical budget evaluation result."""
    connection_id: str
    length_m: float
    loss_db: float
    # Per-link power is only known when the link starts at a transmitter.
    # Passive links are diagnostic loss records, not independent power budgets.
    received_power_dbm: Optional[float] = None
    status: Literal["pass", "fail", "unknown"]
    margin_db: Optional[float] = None
    details: Optional[Dict[str, Any]] = None


class OpticalBudgetResult(CamelModel):
    """Optical power budget calculation output."""
    project_id: str
    calculated_at: str
    links: List[OpticalLinkResult]
    paths: List["OpticalPathResult"] = Field(default_factory=list)
    intermediate_nodes: List["IntermediateOpticalResult"] = Field(default_factory=list)
    disconnected_customer_ids: List[str] = Field(default_factory=list)
    summary: Optional[Dict[str, Any]] = None
    diagnostics: List[Dict[str, Any]] = Field(default_factory=list)


class OpticalPathSegment(CamelModel):
    """Single hop segment along an optical path."""
    connection_id: str
    cable_segment_id: str
    cable_name: str
    cable_category: Optional[str] = None
    from_node_id: str
    from_node_name: str
    from_node_type: str
    to_node_id: str
    to_node_name: str
    to_node_type: str
    length_m: float
    route_length_contribution_m: Optional[float] = None
    attenuation_db_per_km: Optional[float] = None
    fiber_type: Optional[str] = None
    wavelength_nm: Optional[int] = None
    fiber_loss_db: Optional[float] = None
    connectors_count: Optional[int] = None
    connector_unit_loss_db: Optional[float] = None
    connector_loss_db: Optional[float] = None
    splices_count: Optional[int] = None
    splice_unit_loss_db: Optional[float] = None
    splice_loss_db: Optional[float] = None
    pigtail_splices_count: Optional[int] = None
    pigtail_splice_unit_loss_db: Optional[float] = None
    pigtail_splice_loss_db: Optional[float] = None
    total_segment_loss_db: Optional[float] = None


class IntermediateOpticalResult(CamelModel):
    """Estimated optical power at a passive ODC/ODP along a directed OLT path."""
    node_id: str
    node_name: str
    node_type: Literal["odc", "odp"]
    status: Literal["estimated", "unknown", "ambiguous", "unreachable"]
    source_olt_id: Optional[str] = None
    node_ids: List[str] = Field(default_factory=list)
    connection_ids: List[str] = Field(default_factory=list)
    length_m: Optional[float] = None
    accumulated_loss_db: Optional[float] = None
    estimated_power_dbm: Optional[float] = None
    transmitter_power_dbm: Optional[float] = None
    design_margin_db: Optional[float] = None
    total_design_allowance_db: Optional[float] = None
    source_olt_name: Optional[str] = None
    profile_id: Optional[str] = None
    loss_breakdown: List["IntermediateOpticalLossItem"] = Field(default_factory=list)
    category_losses_db: Dict[str, Optional[float]] = Field(default_factory=dict)
    parameter_sources: Dict[str, Literal["configured", "profile_default", "legacy_fallback", "unknown"]] = Field(default_factory=dict)
    diagnostics: List[str] = Field(default_factory=list)


class IntermediateOpticalLossItem(CamelModel):
    """One loss-bearing item in path order; loss values come from the optical evaluator."""
    component_id: str
    component: str
    category: Literal["fiber", "connector", "splice", "splitter", "passive_component"]
    position: str
    quantity: Optional[float] = None
    quantity_unit: Optional[str] = None
    calculation_quantity: Optional[float] = None
    calculation_quantity_unit: Optional[str] = None
    unit_loss_db: Optional[float] = None
    unit_loss_unit: Optional[str] = None
    total_loss_db: Optional[float] = None
    cumulative_loss_db: Optional[float] = None
    source: Optional[str] = None
    node_id: Optional[str] = None
    connection_id: Optional[str] = None
    cable_segment_id: Optional[str] = None
    cable_name: Optional[str] = None
    cable_category: Optional[str] = None
    path_position: int


class OpticalDiagnostic(CamelModel):
    """Structured explainable diagnostic for an optical path or project calculation."""
    code: str
    severity: Literal["error", "warning", "info"]
    category: Literal["connectivity", "optical_budget", "configuration", "physical_deployment"]
    message: str
    affected_entity_type: Optional[Literal["ont", "node", "cable", "connection", "component", "project"]] = None
    affected_entity_id: Optional[str] = None
    affected_entity_name: Optional[str] = None
    actual_value: Optional[float | str] = None
    expected_value: Optional[float | str] = None
    unit: Optional[str] = None
    corrective_action: Optional[str] = None
    data_source: Optional[str] = None


class OpticalSplitterInfo(CamelModel):
    """Information about an optical splitter traversed along a path."""
    node_id: str
    node_name: str
    node_type: str
    splitter_ratio: Optional[str] = None
    loss_db: Optional[float] = None
    ideal_loss_db: Optional[float] = None


class OpticalPathResult(CamelModel):
    """End-to-end optical budget from an OLT to one ONT."""
    ont_node_id: str
    customer_ids: List[str] = Field(default_factory=list)
    node_ids: List[str] = Field(default_factory=list)
    connection_ids: List[str] = Field(default_factory=list)
    cable_segment_ids: List[str] = Field(default_factory=list)
    length_m: Optional[float] = None
    loss_db: Optional[float] = None
    tx_power_dbm: Optional[float] = None
    received_power_dbm: Optional[float] = None
    rx_sensitivity_dbm: Optional[float] = None
    rx_overload_dbm: Optional[float] = None
    # Physical headroom at the receiver limits. Positive values are within
    # the corresponding limit; zero is exactly on its boundary.
    sensitivity_margin_db: Optional[float] = None
    overload_margin_db: Optional[float] = None
    margin_db: Optional[float] = None
    min_margin_db: Optional[float] = None
    status: Literal["pass", "fail", "unknown"]
    connectivity_status: Literal["connected", "disconnected", "invalid_topology", "ambiguous"] = "connected"
    optical_budget_status: Literal["pass", "fail", "unknown"] = "unknown"
    status_reason: Optional[str] = None
    diagnostics: List[OpticalDiagnostic] = Field(default_factory=list)
    calculation_limitations: List[str] = Field(default_factory=list)
    parameter_sources: Dict[str, Literal["configured", "profile_default", "legacy_fallback", "unknown"]] = Field(default_factory=dict)
    profile_id: Optional[str] = None
    segments: List[OpticalPathSegment] = Field(default_factory=list)
    splitters: List[OpticalSplitterInfo] = Field(default_factory=list)
    details: Optional[Dict[str, Any]] = None
    component_losses: List[Dict[str, Any]] = Field(default_factory=list)
    standard_loss_db: Optional[float] = None
    standard_variance_db: Optional[float] = None
    datasheet_references: List[Dict[str, Any]] = Field(default_factory=list)
    field_measurements: List[Dict[str, Any]] = Field(default_factory=list)
    location_loss_summary: Dict[str, Optional[float]] = Field(default_factory=dict)
    loss_breakdown: List[IntermediateOpticalLossItem] = Field(default_factory=list)
    category_losses_db: Dict[str, Optional[float]] = Field(default_factory=dict)
    design_margin_db: Optional[float] = None
    total_design_allowance_db: Optional[float] = None


OpticalBudgetResult.model_rebuild()


class CostItem(CamelModel):
    """Individual item in the construction Bill of Quantities / RAB."""
    code: str
    description: str
    quantity: float
    unit: str
    unit_cost: float
    amount: float
    category: Optional[Literal["material", "installation"]] = None
    unit_cost_source: Literal["configured", "legacy_illustrative"] = "legacy_illustrative"
    unit_cost_reference: Optional[str] = None


class ConstructionCostResult(CamelModel):
    """Construction cost and CAPEX estimation output (formal RAB)."""
    project_id: str
    calculated_at: str
    currency: str
    total_amount: float
    items: List[CostItem]
    total_capex: Optional[float] = None
    cost_per_connected_customer: Optional[float] = None
    connected_customer_count: Optional[int] = None
    material_subtotal: Optional[float] = None
    installation_subtotal: Optional[float] = None
    grand_total: Optional[float] = None
    summary: Optional[Dict[str, Any]] = None
    incomplete_items: List[Dict[str, Any]] = Field(default_factory=list)
    assumptions: List[str] = Field(default_factory=list)
    complete: bool = True


class PoleSpanResult(CamelModel):
    project_id: str
    calculated_at: str
    spans: List[Dict[str, Any]] = Field(default_factory=list)
    diagnostics: List[Dict[str, Any]] = Field(default_factory=list)
    estimated_additional_poles: Optional[int] = None
    estimation_method: Optional[str] = None
    assumptions: List[str] = Field(default_factory=list)
    max_span_limit_m: float = 300.0
    max_odp_to_house_limit_m: float = 300.0
    odp_house_distances: List[Dict[str, Any]] = Field(default_factory=list)



# --- Topology Validation Models ---

class TopologyIssue(CamelModel):
    """Specific topology validation issue with stable error code and device references."""
    code: str
    message: str
    severity: Literal["error", "warning", "info"] = "error"
    policy_code: Optional[str] = None
    from_node_id: Optional[str] = None
    to_node_id: Optional[str] = None
    cable_segment_id: Optional[str] = None
    connection_id: Optional[str] = None
    details: Optional[Dict[str, Any]] = None


class TopologyValidationResult(CamelModel):
    """Result of comprehensive topology validation."""
    valid: bool
    errors: List[TopologyIssue] = Field(default_factory=list)
    warnings: List[TopologyIssue] = Field(default_factory=list)
    summary: Dict[str, Any] = Field(default_factory=dict)


class ConnectionValidationRequest(CamelModel):
    """Request payload to validate a proposed connection before creation."""
    from_node_id: str
    to_node_id: str
    cable_segment_id: str
    connection_id: Optional[str] = None
    medium: Optional[Literal["fiber", "copper", "wireless"]] = None
    connection_type: Optional[Literal["optical", "ethernet"]] = None
    project: Optional[Project] = None


class RouterConfigIssue(CamelModel):
    """Validation issue for router IP configuration."""
    field: str
    message: str
    code: Optional[str] = None
    severity: Literal["error", "warning", "info"] = "error"


class RouterValidationResponse(CamelModel):
    """Response envelope for router configuration validation."""
    valid: bool
    issues: List[RouterConfigIssue] = Field(default_factory=list)


# --- Error Envelopes conforming to docs/API_CONTRACT.md ---

class ErrorDetail(CamelModel):
    field: Optional[str] = None
    message: str


class ErrorBody(CamelModel):
    code: str
    message: str
    details: Optional[List[ErrorDetail]] = None


class ErrorEnvelope(CamelModel):
    error: ErrorBody
