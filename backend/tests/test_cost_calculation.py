"""Unit tests for construction cost and BoQ estimation engine."""

import pytest
from backend.app.domain.models import (
    CableSegment,
    ConstructionCostConfig,
    Customer,
    CustomerStatus,
    LineGeometry,
    NetworkNode,
    NodeType,
    PointGeometry,
    Project,
)
from backend.app.engine.cost import calculate_construction_cost


def test_hand_computed_construction_cost_case():
    """Verify hand-computed construction cost against exact calculation.
    
    Inventory:
    - 1 OLT
    - 2 ODC
    - 4 ODP
    - 8 Poles
    - 10 Connected Customers
    - 1000.0 m cable route
    
    Config defaults (IDR):
    - Slack: 10% -> 1100.0 m billed cable
    - Cable supply: 1100.0 * 5,000 = 5,500,000
    - Cable install: 1100.0 * 7,500 = 8,250,000
    - Poles supply: 8 * 850,000 = 6,800,000
    - Poles install: 8 * 350,000 = 2,800,000
    - OLT supply: 1 * 25,000,000 = 25,000,000
    - OLT install: 1 * 3,000,000 = 3,000,000
    - ODC supply: 2 * 4,500,000 = 9,000,000
    - ODC install: 2 * 1,200,000 = 2,400,000
    - ODP supply: 4 * 350,000 = 1,400,000
    - ODP install: 4 * 150,000 = 600,000
    - ONT supply: 10 * 250,000 = 2,500,000
    - ONT install: 10 * 100,000 = 1,000,000
    -----------------------------------------------------
    Total CAPEX = 68,250,000 IDR
    Cost per connected customer = 68,250,000 / 10 = 6,825,000 IDR
    """
    nodes = []
    # 1 OLT
    nodes.append(NetworkNode(id="olt-1", type=NodeType.OLT, name="OLT", location=PointGeometry(coordinates=(115.0, -8.0))))
    # 2 ODC
    for i in range(2):
        nodes.append(NetworkNode(id=f"odc-{i}", type=NodeType.ODC, name=f"ODC {i}", location=PointGeometry(coordinates=(115.01, -8.01))))
    # 4 ODP
    for i in range(4):
        nodes.append(NetworkNode(id=f"odp-{i}", type=NodeType.ODP, name=f"ODP {i}", location=PointGeometry(coordinates=(115.02, -8.02))))
    # 8 Poles
    for i in range(8):
        nodes.append(NetworkNode(id=f"pole-{i}", type=NodeType.POLE, name=f"Pole {i}", location=PointGeometry(coordinates=(115.03, -8.03))))

    # 10 Connected Customers
    customers = [
        Customer(
            id=f"cust-{i}",
            name=f"Customer {i}",
            location=PointGeometry(coordinates=(115.04, -8.04)),
            status=CustomerStatus.CONNECTED,
        )
        for i in range(10)
    ]

    # Cable with length 1000.0 m
    cable = CableSegment(
        id="c1",
        name="Cable 1",
        geometry=LineGeometry(coordinates=[(115.0, -8.0), (115.01, -8.01)]),
        length_m=1000.0,
    )

    project = Project(
        id="proj-cost-test",
        name="Cost Test",
        currency="IDR",
        nodes=nodes,
        customers=customers,
        cable_segments=[cable],
    )

    result = calculate_construction_cost(project)

    assert result.currency == "IDR"
    assert pytest.approx(result.total_amount, abs=1.0) == 68250000.0
    assert result.connected_customer_count == 10
    assert pytest.approx(result.cost_per_connected_customer, abs=1.0) == 6825000.0

    # Verify individual BoQ items
    items_by_code = {item.code: item for item in result.items}
    assert items_by_code["CBL-SUPPLY"].quantity == 1100.0
    assert items_by_code["CBL-SUPPLY"].amount == 5500000.0
    assert items_by_code["CBL-INSTALL"].quantity == 1100.0
    assert items_by_code["CBL-INSTALL"].amount == 8250000.0
    assert items_by_code["POLE-SUPPLY"].quantity == 8.0
    assert items_by_code["POLE-INSTALL"].quantity == 8.0
    assert items_by_code["POLE-INSTALL"].amount == 2800000.0
    assert items_by_code["OLT-SUPPLY"].amount == 25000000.0
    assert items_by_code["OLT-INSTALL"].amount == 3000000.0
    assert items_by_code["ODC-INSTALL"].quantity == 2.0
    assert items_by_code["ODP-INSTALL"].quantity == 4.0
    assert items_by_code["ONT-SUPPLY"].quantity == 10.0
    assert items_by_code["ONT-INSTALL"].quantity == 10.0
    assert result.total_capex == result.total_amount
    assert result.cost_per_connected_customer == 6825000.0


def test_custom_cost_configuration():
    """Verify passing custom pricing override affects the calculated BoQ."""
    pole = NetworkNode(id="p1", type=NodeType.POLE, name="Pole 1", location=PointGeometry(coordinates=(115.0, -8.0)))
    project = Project(id="p-custom", name="Custom Cost", currency="USD", nodes=[pole])

    custom_config = ConstructionCostConfig(
        currency="USD",
        pole_unit_cost=150.0,
        pole_installation_cost=75.0,
    )

    result = calculate_construction_cost(project, config_override=custom_config)
    assert result.currency == "USD"
    assert result.total_amount == 225.0
    assert len(result.items) == 2


def test_cost_per_connected_customer_is_null_when_only_ont_devices_exist():
    ont = NetworkNode(id="ont-1", type=NodeType.ONT, name="ONT", location=PointGeometry(coordinates=(115.0, -8.0)))
    planned = Customer(id="c1", name="Planned", location=PointGeometry(coordinates=(115.0, -8.0)))
    project = Project(id="p-no-connected", name="No Connected Customers", nodes=[ont], customers=[planned])

    result = calculate_construction_cost(project)

    assert result.total_amount > 0
    assert result.connected_customer_count == 0
    assert result.cost_per_connected_customer is None


def test_rab_line_item_arithmetic_and_subtotals():
    """Verify RAB formal breakdown: every line amount = quantity * unit_cost, and subtotals sum to grand total."""
    olt = NetworkNode(id="olt-1", type=NodeType.OLT, name="OLT 1", location=PointGeometry(coordinates=(115.0, -8.0)))
    pole = NetworkNode(id="pole-1", type=NodeType.POLE, name="Pole 1", location=PointGeometry(coordinates=(115.01, -8.01)))
    cable = CableSegment(
        id="c1",
        name="Feeder",
        geometry=LineGeometry(coordinates=[(115.0, -8.0), (115.01, -8.01)]),
        length_m=500.0,
    )
    cust = Customer(id="cust-1", name="Subscriber 1", location=PointGeometry(coordinates=(115.01, -8.01)), status=CustomerStatus.CONNECTED)

    project = Project(
        id="proj-rab",
        name="RAB Project",
        currency="IDR",
        nodes=[olt, pole],
        customers=[cust],
        cable_segments=[cable],
    )

    result = calculate_construction_cost(project)

    # 1. Line-item arithmetic
    for item in result.items:
        expected_amount = round(item.quantity * item.unit_cost, 2)
        assert item.amount == expected_amount, f"Line item {item.code} arithmetic mismatch: {item.amount} != {expected_amount}"
        assert item.category in ("material", "installation"), f"Unknown category {item.category} on item {item.code}"

    # 2. Material and Installation subtotals
    expected_mat_subtotal = round(sum(i.amount for i in result.items if i.category == "material"), 2)
    expected_inst_subtotal = round(sum(i.amount for i in result.items if i.category == "installation"), 2)
    expected_grand_total = round(expected_mat_subtotal + expected_inst_subtotal, 2)

    assert result.material_subtotal == expected_mat_subtotal
    assert result.installation_subtotal == expected_inst_subtotal
    assert result.grand_total == expected_grand_total
    assert result.total_amount == expected_grand_total
    assert result.total_capex == expected_grand_total

    # 3. Summary block
    assert result.summary is not None
    assert result.summary["materialSubtotal"] == expected_mat_subtotal
    assert result.summary["installationSubtotal"] == expected_inst_subtotal
    assert result.summary["grandTotal"] == expected_grand_total
    assert result.summary["cableSlackPercent"] == 10.0
    assert result.summary["totalCableBilledMeters"] == 550.0  # 500m + 10% slack
    assert result.summary["connectedCustomerCount"] == 1
    assert result.summary["costPerConnectedCustomer"] == expected_grand_total


def test_rab_configured_versus_unavailable_values():
    """Verify that unconfigured items (taxes, markups, contingency) are not fabricated."""
    project = Project(
        id="proj-unconfigured",
        name="Unconfigured Test",
        currency="IDR",
        nodes=[],
        cable_segments=[],
        customers=[],
    )
    result = calculate_construction_cost(project)

    assert result.total_amount == 0.0
    assert result.material_subtotal == 0.0
    assert result.installation_subtotal == 0.0
    assert result.grand_total == 0.0
    assert result.connected_customer_count == 0
    assert result.cost_per_connected_customer is None
    # No fabricated markup or tax items in items
    assert len(result.items) == 0


def test_cable_rates_are_split_by_category_and_unknown_rates_are_incomplete():
    cables = [
        CableSegment(id="f1", name="Feeder", cable_type="feeder", geometry=LineGeometry(coordinates=[(0, 0), (0.001, 0)]), length_m=100),
        CableSegment(id="d1", name="Drop", cable_type="drop", geometry=LineGeometry(coordinates=[(0, 0), (0.002, 0)]), length_m=200),
    ]
    configured_project = Project(id="cable-rates", name="Category quantities", cable_segments=cables,
        settings={"constructionCost": {"cableSlackPercent": 10, "cableUnitCostPerMeter": 2, "cableInstallationCostPerMeter": 3,
            "rateSources": {"cableUnitCostPerMeter": "configured", "cableInstallationCostPerMeter": "configured"}}})
    result = calculate_construction_cost(configured_project)
    supply = {item.code: item for item in result.items if item.code.startswith("CBL-SUPPLY")}
    assert set(supply) == {"CBL-SUPPLY-DROP", "CBL-SUPPLY-FEEDER"}
    assert supply["CBL-SUPPLY-FEEDER"].quantity == 110
    assert supply["CBL-SUPPLY-DROP"].quantity == 220
    assert all(item.unit_cost_source == "configured" for item in supply.values())
    audit = result.summary["cableQuantityAudit"]
    assert {item["category"]: item["cableSegmentIds"] for item in audit} == {"drop": ["d1"], "feeder": ["f1"]}

    unknown_project = Project(id="unknown-rates", name="Missing prices", cable_segments=cables,
        settings={"constructionCost": {"rateSources": {"cableUnitCostPerMeter": "unknown", "cableInstallationCostPerMeter": "unknown"}}})
    unknown = calculate_construction_cost(unknown_project)
    assert unknown.complete is False
    assert len(unknown.incomplete_items) == 4
    assert not any(item.code.startswith("CBL-") for item in unknown.items)


def test_explicit_component_supply_and_installation_prices_and_incomplete_rates():
    from backend.app.domain.models import OpticalComponent
    project = Project(id="component-rab", name="Component RAB", optical_components=[
        OpticalComponent(id="conn", kind="connector-pair", procurement_quantity=2, procurement_unit="pair",
            material_unit_cost=25, installation_unit_cost=10, price_source="configured", price_reference="quote:connector-1"),
        OpticalComponent(id="splice", kind="fusion-splice", procurement_quantity=3, procurement_unit="splice"),
    ])
    result = calculate_construction_cost(project)
    rows = {item.code: item for item in result.items}
    assert rows["CONN-SUPPLY"].amount == 50
    assert rows["CONN-INSTALL"].amount == 20
    assert rows["CONN-SUPPLY"].unit_cost_reference == "quote:connector-1"
    assert result.complete is False
    assert {item["code"] for item in result.incomplete_items} == {"SPLICE-SUPPLY", "SPLICE-INSTALL"}


def test_pole_lifecycle_cost_policy_separates_existing_proposed_shared_and_unverified():
    nodes = [NetworkNode(id=f"p-{status}", type=NodeType.POLE, name=status, location=PointGeometry(coordinates=(0, 0)), properties={"status": status})
             for status in ("existing", "proposed", "shared", "unverified")]
    # First test default policy: existing="exclude", shared="exclude", proposed="supply_and_install", unverified="incomplete"
    default_project = Project(id="pole-policy-default", name="Pole policy default", nodes=nodes)
    default_result = calculate_construction_cost(default_project)
    default_rows = {item.code: item for item in default_result.items}
    assert set(code for code in default_rows if code.startswith("POLE-")) == {"POLE-SUPPLY-PROPOSED", "POLE-INSTALL-PROPOSED"}
    assert default_result.total_amount == 1_200_000
    assert {item["code"] for item in default_result.incomplete_items} == {"POLE-UNVERIFIED"}

    # Second test explicit installation_only for existing and exclude for shared
    project = Project(id="pole-policy", name="Pole policy", nodes=nodes,
        settings={"constructionCost": {"poleCostPolicy": {"existing": "installation_only", "proposed": "supply_and_install", "shared": "exclude", "unverified": "incomplete"}}})
    result = calculate_construction_cost(project)
    rows = {item.code: item for item in result.items}
    assert set(code for code in rows if code.startswith("POLE-")) == {"POLE-INSTALL-EXISTING", "POLE-SUPPLY-PROPOSED", "POLE-INSTALL-PROPOSED"}
    assert result.total_amount == 1_550_000
    assert result.incomplete_items[0]["reason"] == "pole_cost_policy_incomplete"


def test_pole_status_and_cost_policy_full_matrix_and_entity_deduplication():
    """Verify every combination of pole status (existing, shared, proposed, unverified, legacy)
    and cost policy (supply_and_install, installation_only, exclude, incomplete), plus physical ID deduplication."""
    for status in ("existing", "shared", "proposed", "unverified"):
        for policy in ("supply_and_install", "installation_only", "exclude", "incomplete"):
            pole = NetworkNode(id=f"p-{status}", type=NodeType.POLE, name=status, location=PointGeometry(coordinates=(0, 0)), properties={"status": status})
            # Include duplicate node reference with same physical ID to verify deduplication
            project = Project(
                id=f"matrix-{status}-{policy}",
                name="Matrix",
                nodes=[pole, pole],
                settings={"constructionCost": {"poleCostPolicy": {status: policy}}},
            )
            res = calculate_construction_cost(project)
            codes = {item.code: item for item in res.items}
            suffix = f"-{status.upper()}"
            if policy == "supply_and_install":
                assert codes[f"POLE-SUPPLY{suffix}"].quantity == 1.0
                assert codes[f"POLE-INSTALL{suffix}"].quantity == 1.0
                assert res.total_amount == 1_200_000
            elif policy == "installation_only":
                assert f"POLE-SUPPLY{suffix}" not in codes
                assert codes[f"POLE-INSTALL{suffix}"].quantity == 1.0
                assert res.total_amount == 350_000
            elif policy == "exclude":
                assert not any(c.startswith("POLE-") for c in codes)
                assert res.total_amount == 0.0
                assert len(res.incomplete_items) == 0
            elif policy == "incomplete":
                assert not any(c.startswith("POLE-") for c in codes)
                assert res.total_amount == 0.0
                assert res.complete is False
                assert any(i["code"] == f"POLE-{status.upper()}" and i["reason"] == "pole_cost_policy_incomplete" for i in res.incomplete_items)


def test_underground_building_attached_and_unspecified_deployment_costs():
    c_ug = CableSegment(
        id="c-ug", name="UG Route", cable_type="feeder", deployment_method="underground",
        geometry=LineGeometry(coordinates=[(0, 0), (0.001, 0)]), length_m=200.0,
    )
    c_bldg = CableSegment(
        id="c-bldg", name="Building Route", cable_type="distribution", deployment_method="building_attached",
        geometry=LineGeometry(coordinates=[(0.001, 0), (0.002, 0)]), length_m=100.0,
    )
    c_unspec = CableSegment(
        id="c-unspec", name="Unspecified Route", cable_type="drop", deployment_method="unspecified",
        geometry=LineGeometry(coordinates=[(0.002, 0), (0.0025, 0)]), length_m=50.0,
    )

    # 1. With configured underground & building-attached rates, line items are generated and unspecified route is flagged incomplete
    project = Project(
        id="dep-costs",
        name="Deployment Costs",
        cable_segments=[c_ug, c_bldg, c_unspec],
        settings={
            "constructionCost": {
                "ductUnitCostPerMeter": 12000.0,
                "trenchingCostPerMeter": 25000.0,
                "warningTapeCostPerMeter": 1500.0,
                "buildingAttachmentCostPerMeter": 8000.0,
                "rateReferences": {
                    "ductUnitCostPerMeter": "quote:duct-1",
                    "trenchingCostPerMeter": "quote:trench-1",
                    "buildingAttachmentCostPerMeter": "quote:bldg-1",
                },
            }
        },
    )
    res = calculate_construction_cost(project)
    by_code = {item.code: item for item in res.items}
    assert by_code["UG-DUCT-SUPPLY"].quantity == 200.0
    assert by_code["UG-DUCT-SUPPLY"].amount == 2_400_000.0
    assert by_code["UG-DUCT-SUPPLY"].unit_cost_reference == "quote:duct-1"
    assert by_code["UG-TRENCH"].quantity == 200.0
    assert by_code["UG-TRENCH"].amount == 5_000_000.0
    assert by_code["UG-WARNTAPE-SUPPLY"].amount == 300_000.0
    assert by_code["BLDG-ATTACH-INSTALL"].quantity == 100.0
    assert by_code["BLDG-ATTACH-INSTALL"].amount == 800_000.0
    # Because deployment-specific rates are active, the unspecified cable is flagged in incomplete_items
    assert res.complete is False
    assert any(i["code"] == "DEP-UNSPECIFIED" and i["reason"] == "deployment_method_unspecified" for i in res.incomplete_items)




def test_unknown_router_rates_remain_incomplete_without_default_price():
    project = Project(id="unknown-item-rates", name="Unknown item rates",
        nodes=[NetworkNode(id="router", type=NodeType.ROUTER, name="Router", location=PointGeometry(coordinates=(0, 0)))],
        settings={"constructionCost": {"routerUnitCost": 123456, "routerInstallationCost": 654321, "rateSources": {"routerUnitCost": "unknown", "routerInstallationCost": "unknown"}}})
    result = calculate_construction_cost(project)
    rows = {item.code for item in result.items}
    assert "RTR-SUPPLY" not in rows
    assert "RTR-INSTALL" not in rows
    assert result.complete is False
    assert {item["code"] for item in result.incomplete_items} >= {"RTR-SUPPLY", "RTR-INSTALL"}


def test_unknown_pole_and_device_rates_do_not_charge_legacy_numeric_defaults():
    project = Project(id="unknown-item-rates", name="Unknown item rates",
        nodes=[NetworkNode(id="pole", type=NodeType.POLE, name="Pole", location=PointGeometry(coordinates=(0, 0))),
               NetworkNode(id="olt", type=NodeType.OLT, name="OLT", location=PointGeometry(coordinates=(0, 0)))],
        settings={"constructionCost": {"rateSources": {"poleUnitCost": "unknown", "oltUnitCost": "unknown"}}})
    result = calculate_construction_cost(project)
    rows = {item.code for item in result.items}
    assert "POLE-SUPPLY" not in rows
    assert "OLT-SUPPLY" not in rows
    assert result.complete is False
    assert {item["code"] for item in result.incomplete_items} >= {"POLE-SUPPLY", "OLT-SUPPLY"}

