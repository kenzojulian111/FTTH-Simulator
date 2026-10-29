"""Independent numeric fixtures for component losses and explicit pole spans."""
from backend.app.domain.models import (
    CableSegment, LineGeometry, NetworkNode, NodeType, OpticalComponent,
    PointGeometry, PoleSpan, PoleSpanRule, Project, TopologyConnection,
)
from backend.app.engine.optical import calculate_optical_budget
from backend.app.engine.pole import calculate_pole_spans
from backend.app.persistence.repository import ProjectRepository


def test_component_standard_datasheet_and_measurement_are_separate():
    olt = NetworkNode(id="o", type="olt", name="OLT", location=PointGeometry(coordinates=(0, 0)))
    odc = NetworkNode(id="d", type="odc", name="ODC", location=PointGeometry(coordinates=(0.002, 0)), properties={"splitterLossDb": 10.8, "splitterRatio": "1:8"})
    ont = NetworkNode(id="n", type="ont", name="ONT", location=PointGeometry(coordinates=(0.002, 0)))
    cable = CableSegment(id="c", name="route", geometry=LineGeometry(coordinates=[(0, 0), (0.002, 0)]), length_m=2000)
    component = OpticalComponent(
        id="attenuator-1", kind="attenuator", node_id="d", location="ODP",
        configured_loss_db=0.4, configured_source="configured", datasheet_loss_db=0.45,
        datasheet_reference="spec:attenuator-v1", datasheet_model="AT-1",
        measured_loss_db=0.43, measured_at="2026-10-01T00:00:00Z", measurement_method="power meter",
    )
    project = Project(
        id="fixture", name="Optical fixture", nodes=[olt, odc, ont], cable_segments=[cable],
        connections=[TopologyConnection(id="l1", from_node_id="o", to_node_id="d", cable_segment_id="c"),
                     TopologyConnection(id="l2", from_node_id="d", to_node_id="n", cable_segment_id="c")],
        optical_components=[component],
        settings={"opticalBudget": {"projectStandardLossDb": 15.0}},
    )
    # One physical cable: fiber .70 + two logical-hop connector/splice assumptions (2.00 + .20)
    # + splitter 10.80 + extra .40 = 14.10 dB. The physical route is counted once.
    result = calculate_optical_budget(project)
    path = result.paths[0]
    assert path.loss_db == 14.1
    assert path.standard_loss_db == 15.0
    assert path.standard_variance_db == -0.9
    assert path.datasheet_references == [{"componentId": "attenuator-1", "model": "AT-1", "lossDb": 0.45, "reference": "spec:attenuator-v1"}]
    assert path.field_measurements[0]["lossDb"] == 0.43
    additional_loss = next(item for item in path.component_losses if item["componentId"] == "attenuator-1")
    assert additional_loss["lossDb"] == 0.4
    assert path.location_loss_summary["ODP"] == 0.4
    assert path.location_loss_summary["ODC"] == 10.8
    assert path.location_loss_summary["unallocated_route"] == 2.9
    assert path.splitters[0].ideal_loss_db == 9.03


def test_missing_configured_component_loss_withholds_a_pass():
    olt = NetworkNode(id="o", type="olt", name="OLT", location=PointGeometry(coordinates=(0, 0)))
    ont = NetworkNode(id="n", type="ont", name="ONT", location=PointGeometry(coordinates=(0.001, 0)))
    cable = CableSegment(id="c", name="route", geometry=LineGeometry(coordinates=[(0, 0), (0.001, 0)]), length_m=100)
    project = Project(id="unknown-component", name="Missing component", nodes=[olt, ont], cable_segments=[cable],
        connections=[TopologyConnection(id="link", from_node_id="o", to_node_id="n", cable_segment_id="c")],
        optical_components=[OpticalComponent(id="unknown-loss", kind="connector-pair", connection_id="link", configured_source="unknown")])
    path = calculate_optical_budget(project).paths[0]
    assert path.loss_db is None
    assert path.status == "unknown"
    assert path.component_losses[-1]["lossDb"] is None


def test_pole_span_uses_bent_route_and_configured_interval():
    start = NetworkNode(id="p1", type="pole", name="P1", location=PointGeometry(coordinates=(0, 0)), properties={"status": "existing"})
    end = NetworkNode(id="p2", type="pole", name="P2", location=PointGeometry(coordinates=(0.001, 0.001)), properties={"status": "existing"})
    cable = CableSegment(id="c", name="distribution", cable_type="distribution", geometry=LineGeometry(coordinates=[(0, 0), (0.001, 0), (0.001, 0.001)]))
    project = Project(id="p", name="Pole fixture", nodes=[start, end], cable_segments=[cable],
                          pole_spans=[PoleSpan(id="s", cable_segment_id="c", from_pole_id="p1", to_pole_id="p2", geometry=cable.geometry, status="existing")],
                          settings={"poleSpanPlanning": {"rules": [{"cableCategory": "distribution", "maxSpanM": 50, "placementPolicy": "uniform_maximum_spacing"}]}})
    result = calculate_pole_spans(project)
    span = result.spans[0]
    assert span["lengthM"] == 222.39
    assert span["geometrySource"] == "span_geometry"
    assert result.estimated_additional_poles == 4
    assert result.estimation_method == "sum(max(0, ceil(spanLengthM / maxSpanM) - 1))"


def test_pole_estimate_unknown_without_explicit_interval():
    pole = NetworkNode(id="p", type=NodeType.POLE, name="P", location=PointGeometry(coordinates=(0, 0)))
    result = calculate_pole_spans(Project(id="p", name="No rule", nodes=[pole]))
    assert result.estimated_additional_poles is None
    assert {issue["code"] for issue in result.diagnostics} == {"pole_without_cable_span"}


def test_pole_rule_without_placement_policy_cannot_return_complete_zero_estimate():
    pole_a = NetworkNode(id="a", type="pole", name="A", location=PointGeometry(coordinates=(0, 0)), properties={"status": "existing"})
    pole_b = NetworkNode(id="b", type="pole", name="B", location=PointGeometry(coordinates=(0.001, 0)), properties={"status": "existing"})
    cable = CableSegment(id="c", name="distribution", cable_type="distribution", geometry=LineGeometry(coordinates=[(0, 0), (0.001, 0)]))
    project = Project(
        id="unknown-placement",
        name="Unknown placement",
        nodes=[pole_a, pole_b],
        cable_segments=[cable],
        pole_spans=[PoleSpan(id="s", cable_segment_id="c", from_pole_id="a", to_pole_id="b", geometry=cable.geometry, status="existing")],
        settings={"poleSpanPlanning": {"rules": [{"cableCategory": "distribution", "maxSpanM": 300}]}},
    )
    result = calculate_pole_spans(project)
    assert result.spans[0]["estimatedAdditionalPoles"] is None
    assert result.estimated_additional_poles is None
    assert "placement_policy_unconfigured" in result.spans[0]["diagnostics"]


def test_span_and_drop_limits_are_independent_and_inclusive_at_300m():
    from backend.app.domain.models import Customer, CustomerStatus

    start = NetworkNode(id="p1", type="pole", name="P1", location=PointGeometry(coordinates=(0, 0)), properties={"status": "existing"})
    end = NetworkNode(id="p2", type="pole", name="P2", location=PointGeometry(coordinates=(0.0026979611, 0)), properties={"status": "existing"})
    odp = NetworkNode(id="odp", type="odp", name="ODP", location=PointGeometry(coordinates=(0, 0)))
    ont = NetworkNode(id="ont", type="ont", name="ONT", location=PointGeometry(coordinates=(0.0026979611, 0)))
    customer = Customer(id="home", name="Home", location=PointGeometry(coordinates=(0.0026979611, 0)), status=CustomerStatus.CONNECTED, ont_node_id="ont")
    span_cable = CableSegment(id="span-cable", name="distribution", cable_type="distribution", geometry=LineGeometry(coordinates=[(0, 0), (0.0026979611, 0)]), length_m=300.0)
    drop = CableSegment(id="drop-cable", name="drop", cable_type="drop", geometry=LineGeometry(coordinates=[(0, 0), (0.0026979611, 0)]), length_m=300.0)
    project = Project(
        id="independent-limits", name="Independent 300m limits",
        nodes=[start, end, odp, ont], customers=[customer], cable_segments=[span_cable, drop],
        connections=[TopologyConnection(id="drop-link", from_node_id="odp", to_node_id="ont", cable_segment_id="drop-cable")],
        pole_spans=[PoleSpan(id="span", cable_segment_id="span-cable", from_pole_id="p1", to_pole_id="p2", geometry=span_cable.geometry, status="existing")],
        settings={"poleSpanPlanning": {"rules": [{"cableCategory": "distribution", "maxSpanM": 300, "placementPolicy": "uniform_maximum_spacing"}]}},
    )
    result = calculate_pole_spans(project)
    assert result.spans[0]["lengthM"] == 300.0
    assert result.spans[0]["estimatedAdditionalPoles"] == 0
    assert "span_exceeds_300m_limit" not in result.spans[0]["diagnostics"]
    assert result.odp_house_distances[0]["status"] == "pass"
    assert result.odp_house_distances[0]["farthestDistanceM"] == 300.0
    assert result.odp_house_distances[0]["houses"][0]["distanceMethod"] == "drop_route"

    # The same drop is still exactly at the limit while the explicit pole span
    # exceeds it, proving that the checks are separate.
    project.pole_spans[0].length_m = 301.0
    over_span = calculate_pole_spans(project)
    assert "span_exceeds_300m_limit" in over_span.spans[0]["diagnostics"]
    assert over_span.odp_house_distances[0]["status"] == "pass"

    # Conversely, a compliant span does not mask an over-limit drop route.
    project.pole_spans[0].length_m = 300.0
    project.cable_segments[1].length_m = 301.0
    over_drop = calculate_pole_spans(project)
    assert "span_exceeds_300m_limit" not in over_drop.spans[0]["diagnostics"]
    assert over_drop.odp_house_distances[0]["status"] == "fail"
    assert over_drop.odp_house_distances[0]["farthestDistanceM"] == 301.0
    assert over_drop.odp_house_distances[0]["houses"][0]["routeDistanceM"] == 301.0
    assert over_drop.odp_house_distances[0]["houses"][0]["geodesicDistanceM"] == 300.0
    assert over_drop.odp_house_distances[0]["houses"][0]["distanceMethod"] == "drop_route"


def test_geodesic_house_fallback_requires_explicit_odp_association():
    from backend.app.domain.models import Customer

    odp = NetworkNode(id="odp", type="odp", name="ODP", location=PointGeometry(coordinates=(0, 0)))
    customer = Customer(id="house", name="House", location=PointGeometry(coordinates=(0.0027069543, 0)), properties={"odpNodeId": "odp"})
    project = Project(id="odp-fallback", name="ODP fallback", nodes=[odp], customers=[customer])
    result = calculate_pole_spans(project)
    summary = result.odp_house_distances[0]
    assert summary["status"] == "fail"
    assert summary["farthestDistanceM"] == 301.0
    assert summary["houses"][0]["distanceMethod"] == "geodesic_fallback"

    customer.properties.pop("odpNodeId")
    unassociated = calculate_pole_spans(project)
    assert unassociated.odp_house_distances[0]["status"] == "unconnected"


def test_pole_span_rules_cannot_be_configured_above_300m():
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="up to 300 m"):
        Project.model_validate({"id": "too-wide", "name": "Too wide", "settings": {"poleSpanPlanning": {"rules": [{"cableCategory": "feeder", "maxSpanM": 301}]}}})


def test_new_optical_and_span_records_survive_project_save_load(db_session):
    pole_a = NetworkNode(id="pa", type="pole", name="PA", location=PointGeometry(coordinates=(0, 0)), properties={"status": "existing"})
    pole_b = NetworkNode(id="pb", type="pole", name="PB", location=PointGeometry(coordinates=(0.001, 0)), properties={"status": "existing"})
    cable = CableSegment(id="route", name="Road route", geometry=LineGeometry(coordinates=[(0, 0), (0.001, 0)]))
    component = OpticalComponent(id="splice-box", kind="splice", node_id="pa", configured_loss_db=0.12, configured_source="configured")
    project = Project(id="roundtrip", name="Round trip", nodes=[pole_a, pole_b], cable_segments=[cable],
                      pole_spans=[PoleSpan(id="span", cable_segment_id="route", from_pole_id="pa", to_pole_id="pb", covers_entire_cable_route=True, status="existing")],
                      optical_components=[component])
    repository = ProjectRepository(db_session)
    saved = repository.save(project)
    loaded = repository.get("roundtrip")
    assert loaded is not None
    assert loaded.pole_spans[0].length_m == saved.pole_spans[0].length_m
    assert loaded.pole_spans[0].length_m == 111.2
    assert loaded.optical_components[0].configured_loss_db == 0.12
    assert loaded.pole_spans[0].covers_entire_cable_route is True


def test_api_round_trip_preserves_new_optical_and_physical_fields(client):
    project = Project(
        id="api-roundtrip", name="API roundtrip",
        nodes=[NetworkNode(id="pole-a", type="pole", name="Pole A", location=PointGeometry(coordinates=(0, 0)), properties={"status": "existing", "material": "unknown"})],
        cable_segments=[CableSegment(id="cable-a", name="route", geometry=LineGeometry(coordinates=[(0, 0), (0.001, 0)]))],
        pole_spans=[PoleSpan(id="span-a", cable_segment_id="cable-a", from_pole_id="pole-a", to_pole_id="missing-pole", covers_entire_cable_route=True, status="unverified")],
        optical_components=[OpticalComponent(id="attenuator-a", kind="attenuator", node_id="pole-a", location="ODP", configured_loss_db=0.2, configured_source="configured", datasheet_reference="datasheet:42", measured_loss_db=0.21, measured_at="2026-10-01T00:00:00Z", procurement_quantity=1, procurement_unit="unit", material_unit_cost=10, price_source="configured", price_reference="quote:42")],
        settings={"poleSpanPlanning": {"rules": [{"cableCategory": "distribution", "maxSpanM": 50, "placementPolicy": "uniform_maximum_spacing"}]}, "constructionCost": {"rateReferences": {"poleUnitCost": "quote:poles"}}},
    )
    # Exercise the repository update branch: first persist a legacy/minimal
    # aggregate, then PUT the new collections to the same saved project ID.
    initial = client.put(f"/api/v1/projects/{project.id}", json=Project(
        id=project.id, name="Initial saved project"
    ).model_dump(by_alias=True))
    assert initial.status_code == 200
    saved = client.put(f"/api/v1/projects/{project.id}", json=project.model_dump(by_alias=True))
    loaded = client.get(f"/api/v1/projects/{project.id}")
    assert saved.status_code == 200
    assert loaded.status_code == 200
    body = loaded.json()
    assert body["poleSpans"][0]["toPoleId"] == "missing-pole"
    assert body["poleSpans"][0]["lengthM"] is not None
    assert body["opticalComponents"][0]["datasheetReference"] == "datasheet:42"
    assert body["opticalComponents"][0]["priceReference"] == "quote:42"
    assert body["settings"]["poleSpanPlanning"]["rules"][0]["maxSpanM"] == 50
    assert body["settings"]["constructionCost"]["rateReferences"]["poleUnitCost"] == "quote:poles"


def test_lecture_reference_profile_values_and_editable_overrides():
    from backend.app.domain.models import Customer, CustomerStatus, LECTURE_OPTICAL_PROFILE_ID

    olt = NetworkNode(id="olt", type="olt", name="OLT", location=PointGeometry(coordinates=(0, 0)))
    odc = NetworkNode(id="odc", type="odc", name="ODC", location=PointGeometry(coordinates=(0.002, 0)), properties={"splitterRatio": "1:4"})
    odp = NetworkNode(id="odp", type="odp", name="ODP", location=PointGeometry(coordinates=(0.004, 0)), properties={"splitterRatio": "1:8"})
    ont = NetworkNode(id="ont", type="ont", name="ONT", location=PointGeometry(coordinates=(0.0045, 0)))
    cust = Customer(id="c1", name="House 1", location=PointGeometry(coordinates=(0.0045, 0)), status=CustomerStatus.CONNECTED, ont_node_id="ont")

    feeder = CableSegment(
        id="c-feeder", name="Feeder", cable_type="feeder",
        geometry=LineGeometry(coordinates=[(0, 0), (0.002, 0)]), length_m=2000.0,
        properties={"cableCategory": "feeder", "connectorsCount": 2, "splicesCount": 1, "pigtailSplicesCount": 2},
    )
    dist = CableSegment(
        id="c-dist", name="Distribution", cable_type="distribution",
        geometry=LineGeometry(coordinates=[(0.002, 0), (0.004, 0)]), length_m=1000.0,
        properties={"cableCategory": "distribution", "connectorsCount": 2, "splicesCount": 1, "pigtailSplicesCount": 0},
    )
    drop = CableSegment(
        id="c-drop", name="Drop", cable_type="drop",
        geometry=LineGeometry(coordinates=[(0.004, 0), (0.0045, 0)]), length_m=200.0,
        properties={"cableCategory": "drop", "connectorsCount": 2, "splicesCount": 0, "pigtailSplicesCount": 1},
    )

    project = Project(
        id="lecture-profile-test",
        name="Lecture Profile Test",
        nodes=[olt, odc, odp, ont],
        customers=[cust],
        cable_segments=[feeder, dist, drop],
        connections=[
            TopologyConnection(id="l1", from_node_id="olt", to_node_id="odc", cable_segment_id="c-feeder"),
            TopologyConnection(id="l2", from_node_id="odc", to_node_id="odp", cable_segment_id="c-dist"),
            TopologyConnection(id="l3", from_node_id="odp", to_node_id="ont", cable_segment_id="c-drop"),
        ],
        settings={"opticalBudget": {"profileId": LECTURE_OPTICAL_PROFILE_ID}},
    )

    cfg = project.settings.optical_budget
    assert cfg.profile_id == LECTURE_OPTICAL_PROFILE_ID
    assert cfg.fiber_attenuation_db_per_km == 0.35
    assert cfg.drop_fiber_attenuation_db_per_km == 0.35
    assert cfg.connector_loss_db == 0.25
    assert cfg.splice_loss_db == 0.10
    assert cfg.pigtail_splice_loss_db == 0.10
    assert cfg.splitter_loss_table["1:4"] == 7.25
    assert cfg.splitter_loss_table["1:8"] == 10.38
    assert cfg.splitter_loss_table["1:16"] == 15.0
    assert cfg.splitter_loss_table["1:32"] == 18.6
    assert cfg.splitter_loss_table["1:64"] == 22.8
    assert "materi kuliah" in (cfg.profile_note or "")

    result = calculate_optical_budget(project)
    path = result.paths[0]
    assert path.status == "pass"
    # Fiber: (2.0 + 1.0 + 0.2) km * 0.35 = 1.12 dB
    # Connectors: 6 * 0.25 = 1.50 dB
    # Route splices: 2 * 0.10 = 0.20 dB, Pigtail splices: 3 * 0.10 = 0.30 dB -> total splice = 0.50 dB
    # Splitters: 1:4 (7.25) + 1:8 (10.38) = 17.63 dB
    # Total physical loss = 1.12 + 1.50 + 0.50 + 17.63 = 20.75 dB
    assert path.loss_db == 20.75


def test_pole_span_300m_limit_and_odp_to_farthest_house_300m_validation():
    from backend.app.domain.models import Customer, CustomerStatus
    from backend.app.domain.validation import validate_project_topology

    p1 = NetworkNode(id="p1", type="pole", name="P1", location=PointGeometry(coordinates=(0, 0)), properties={"status": "existing"})
    p2 = NetworkNode(id="p2", type="pole", name="P2", location=PointGeometry(coordinates=(0.003, 0)), properties={"status": "proposed"})
    odp = NetworkNode(id="odp-1", type="odp", name="ODP 1", location=PointGeometry(coordinates=(0.003, 0)))
    ont_near = NetworkNode(id="ont-near", type="ont", name="ONT Near", location=PointGeometry(coordinates=(0.004, 0)))
    ont_far = NetworkNode(id="ont-far", type="ont", name="ONT Far", location=PointGeometry(coordinates=(0.0065, 0)))
    cust_near = Customer(id="cust-near", name="Near House", location=PointGeometry(coordinates=(0.004, 0)), status=CustomerStatus.CONNECTED, ont_node_id="ont-near")
    cust_far = Customer(id="cust-far", name="Far House", location=PointGeometry(coordinates=(0.0065, 0)), status=CustomerStatus.CONNECTED, ont_node_id="ont-far")

    c_span = CableSegment(id="c-span", name="Feeder Span", cable_type="feeder", geometry=LineGeometry(coordinates=[(0, 0), (0.003, 0)]), length_m=340.0)
    c_drop_near = CableSegment(id="c-near", name="Drop Near", cable_type="drop", geometry=LineGeometry(coordinates=[(0.003, 0), (0.004, 0)]), length_m=120.0)
    c_drop_far = CableSegment(id="c-far", name="Drop Far", cable_type="drop", geometry=LineGeometry(coordinates=[(0.003, 0), (0.0065, 0)]), length_m=360.0)

    project = Project(
        id="span-and-odp-limits",
        name="300m Limits",
        nodes=[p1, p2, odp, ont_near, ont_far],
        customers=[cust_near, cust_far],
        cable_segments=[c_span, c_drop_near, c_drop_far],
        connections=[
            TopologyConnection(id="conn-near", from_node_id="odp-1", to_node_id="ont-near", cable_segment_id="c-near"),
            TopologyConnection(id="conn-far", from_node_id="odp-1", to_node_id="ont-far", cable_segment_id="c-far"),
        ],
        pole_spans=[
            PoleSpan(id="s-over", cable_segment_id="c-span", from_pole_id="p1", to_pole_id="p2", length_m=340.0, status="proposed"),
        ],
        settings={"poleSpanPlanning": {"rules": [{"cableCategory": "feeder", "maxSpanM": 300.0, "placementPolicy": "uniform_maximum_spacing"}]}},
    )

    span_result = calculate_pole_spans(project)
    assert "span_exceeds_300m_limit" in span_result.spans[0]["diagnostics"]
    assert any(d["code"] == "odp_to_house_exceeds_300m" and d["odpId"] == "odp-1" for d in span_result.diagnostics)
    assert len(span_result.odp_house_distances) == 1
    odp_summary = span_result.odp_house_distances[0]
    assert odp_summary["status"] == "fail"
    assert odp_summary["farthestDistanceM"] > 300.0
    assert odp_summary["farthestTargetId"] == "cust-far"

    topo = validate_project_topology(project)
    warning_codes = {w.code for w in topo.warnings}
    assert "pole_span_exceeds_300m" in warning_codes
    assert "odp_to_house_exceeds_300m" in warning_codes


def test_shared_poles_counted_once_in_rab_across_multiple_spans():
    from backend.app.engine.cost import calculate_construction_cost

    p1 = NetworkNode(id="p1", type="pole", name="P1", location=PointGeometry(coordinates=(0, 0)), properties={"status": "proposed"})
    p_shared = NetworkNode(id="p-shared", type="pole", name="P Shared", location=PointGeometry(coordinates=(0.001, 0)), properties={"status": "shared"})
    p3 = NetworkNode(id="p3", type="pole", name="P3", location=PointGeometry(coordinates=(0.002, 0)), properties={"status": "proposed"})
    c1 = CableSegment(id="c1", name="Feeder", cable_type="feeder", geometry=LineGeometry(coordinates=[(0, 0), (0.001, 0)]), length_m=100.0)
    c2 = CableSegment(id="c2", name="Distribution", cable_type="distribution", geometry=LineGeometry(coordinates=[(0.001, 0), (0.002, 0)]), length_m=100.0)

    project = Project(
        id="shared-pole-rab",
        name="Shared Pole RAB",
        nodes=[p1, p_shared, p3],
        cable_segments=[c1, c2],
        pole_spans=[
            PoleSpan(id="s1", cable_segment_id="c1", from_pole_id="p1", to_pole_id="p-shared", length_m=100.0, status="proposed"),
            PoleSpan(id="s2", cable_segment_id="c2", from_pole_id="p-shared", to_pole_id="p3", length_m=100.0, status="shared"),
        ],
    )
    # Default policy: existing & shared poles are excluded from new procurement unless an explicit policy is configured.
    default_cost = calculate_construction_cost(project)
    assert default_cost.summary["poleCount"] == 3
    assert default_cost.summary["sharedPoleIds"] == ["p-shared"]
    default_by_code = {item.code: item for item in default_cost.items}
    assert "POLE-SUPPLY-SHARED" not in default_by_code
    assert "POLE-INSTALL-SHARED" not in default_by_code
    assert default_by_code["POLE-SUPPLY-PROPOSED"].quantity == 2.0

    # When shared pole policy is explicitly set to installation_only, it is billed once (deduplicated across spans).
    project.settings.construction_cost.pole_cost_policy["shared"] = "installation_only"
    install_cost = calculate_construction_cost(project)
    install_by_code = {item.code: item for item in install_cost.items}
    assert "POLE-SUPPLY-SHARED" not in install_by_code
    assert install_by_code["POLE-INSTALL-SHARED"].quantity == 1.0
    assert install_by_code["POLE-SUPPLY-PROPOSED"].quantity == 2.0


def test_cable_with_intermediate_pole_and_multiple_subspans_never_duplicates_full_cable_length(db_session):
    p1 = NetworkNode(id="p1", type="pole", name="P1", location=PointGeometry(coordinates=(0.0, 0.0)), properties={"status": "existing"})
    p2 = NetworkNode(id="p2", type="pole", name="P2 Mid", location=PointGeometry(coordinates=(0.001, 0.0)), properties={"status": "existing"})
    p3 = NetworkNode(id="p3", type="pole", name="P3 End", location=PointGeometry(coordinates=(0.0025, 0.0)), properties={"status": "existing"})

    # Cable polyline has vertices at P1, P2, and P3 (~111.2m + ~166.8m = ~278.0m)
    cable_aligned = CableSegment(
        id="c-aligned",
        name="Aligned Multi-Span Cable",
        cable_type="distribution",
        geometry=LineGeometry(coordinates=[(0.0, 0.0), (0.001, 0.0), (0.0025, 0.0)]),
    )

    project_aligned = Project(
        id="multi-span-aligned",
        name="Multi Span Aligned",
        nodes=[p1, p2, p3],
        cable_segments=[cable_aligned],
        pole_spans=[
            PoleSpan(id="s1", cable_segment_id="c-aligned", from_pole_id="p1", to_pole_id="p2", covers_entire_cable_route=True, status="existing"),
            PoleSpan(id="s2", cable_segment_id="c-aligned", from_pole_id="p2", to_pole_id="p3", covers_entire_cable_route=True, status="existing"),
        ],
        settings={"poleSpanPlanning": {"rules": [{"cableCategory": "distribution", "maxSpanM": 200.0, "placementPolicy": "uniform_maximum_spacing"}]}},
    )

    res_aligned = calculate_pole_spans(project_aligned)
    spans_by_id = {s["id"]: s for s in res_aligned.spans}
    assert spans_by_id["s1"]["geometrySource"] == "cable_subroute"
    assert spans_by_id["s2"]["geometrySource"] == "cable_subroute"
    assert spans_by_id["s1"]["lengthM"] == 111.2
    assert spans_by_id["s2"]["lengthM"] == 166.79
    assert spans_by_id["s1"]["lengthM"] + spans_by_id["s2"]["lengthM"] == 277.99

    # Persistence also resolves sub-span lengths rather than copying full cable length
    repo = ProjectRepository(db_session)
    saved = repo.save(project_aligned)
    saved_spans = {s.id: s for s in saved.pole_spans}
    assert saved_spans["s1"].length_m == 111.2
    assert saved_spans["s2"].length_m == 166.79
    assert saved_spans["s1"].covers_entire_cable_route is False
    assert saved_spans["s2"].covers_entire_cable_route is False

    # Case 2: Cable has only 2 endpoints [P1, P3] without an intermediate vertex at P2,
    # and spans have no explicit sub-span geometry -> sub-span lengths cannot be determined -> unknown (None)
    cable_unsegmented = CableSegment(
        id="c-unsegmented",
        name="Unsegmented Cable",
        cable_type="distribution",
        geometry=LineGeometry(coordinates=[(0.0, 0.0), (0.0025, 0.0)]),
        length_m=277.99,
    )
    project_unknown = Project(
        id="multi-span-unknown",
        name="Multi Span Unknown",
        nodes=[p1, p2, p3],
        cable_segments=[cable_unsegmented],
        pole_spans=[
            PoleSpan(id="u1", cable_segment_id="c-unsegmented", from_pole_id="p1", to_pole_id="p2", covers_entire_cable_route=True, length_m=277.99, status="existing"),
            PoleSpan(id="u2", cable_segment_id="c-unsegmented", from_pole_id="p2", to_pole_id="p3", covers_entire_cable_route=True, length_m=277.99, status="existing"),
        ],
    )
    res_unknown = calculate_pole_spans(project_unknown)
    for s in res_unknown.spans:
        assert s["lengthM"] is None
        assert s["geometrySource"] is None
        assert "span_route_geometry_unknown" in s["diagnostics"]
        assert "multiple_spans_require_subspan_geometry" in s["diagnostics"]


def test_odp_to_house_unknown_when_coordinates_not_geographically_placed_and_optical_path_unaffected():
    from backend.app.domain.models import Customer, CustomerStatus

    olt = NetworkNode(id="olt", type="olt", name="OLT", location=PointGeometry(coordinates=(0, 0)))
    odp = NetworkNode(id="odp", type="odp", name="ODP", location=PointGeometry(coordinates=(0.001, 0)), properties={"splitterRatio": "1:8"})
    ont_logical = NetworkNode(id="ont-logical", type="ont", name="ONT Logical", location=PointGeometry(coordinates=(0.001, 0)), properties={"geographicPositionSet": False})
    cust_logical = Customer(id="cust-logical", name="House Logical", location=PointGeometry(coordinates=(0.001, 0)), status=CustomerStatus.CONNECTED, ont_node_id="ont-logical", properties={"geographicPositionSet": False})

    c_feeder = CableSegment(id="cf", name="Feeder", cable_type="feeder", geometry=LineGeometry(coordinates=[(0, 0), (0.001, 0)]), length_m=150.0)
    # Drop cable without explicit length_m and connected to logical-only ONT
    c_drop = CableSegment(id="cd", name="Drop", cable_type="drop", geometry=LineGeometry(coordinates=[(0.001, 0), (0.001, 0)]), length_m=None)

    project = Project(
        id="logical-only-odp-distance",
        name="Logical ODP Distance",
        nodes=[olt, odp, ont_logical],
        customers=[cust_logical],
        cable_segments=[c_feeder, c_drop],
        connections=[
            TopologyConnection(id="l1", from_node_id="olt", to_node_id="odp", cable_segment_id="cf"),
            TopologyConnection(id="l2", from_node_id="odp", to_node_id="ont-logical", cable_segment_id="cd"),
        ],
    )

    span_res = calculate_pole_spans(project)
    odp_summary = span_res.odp_house_distances[0]
    assert odp_summary["status"] == "unknown"
    assert odp_summary["farthestDistanceM"] is None
    assert odp_summary["houses"][0]["distanceMethod"] == "unknown"
    assert any(d["code"] == "odp_to_house_distance_unknown" for d in span_res.diagnostics)

    # Even when ODP-to-house distance exceeds 300m, optical connectivity remains valid and evaluated independently
    c_drop.length_m = 350.0
    span_res_over = calculate_pole_spans(project)
    assert span_res_over.odp_house_distances[0]["status"] == "fail"
    opt_res = calculate_optical_budget(project)
    assert len(opt_res.paths) == 1
    assert opt_res.paths[0].status == "pass"


def test_orphan_pole_span_and_optical_component_references_preserve_save_load_and_emit_diagnostics(db_session):
    pole_keep = NetworkNode(id="p-keep", type="pole", name="Pole Keep", location=PointGeometry(coordinates=(0, 0)), properties={"status": "existing"})
    odp_keep = NetworkNode(id="odp-keep", type="odp", name="ODP Keep", location=PointGeometry(coordinates=(0.001, 0)))
    cable_keep = CableSegment(id="c-keep", name="Cable Keep", cable_type="distribution", geometry=LineGeometry(coordinates=[(0, 0), (0.001, 0)]), length_m=111.2)

    # Simulate state after a pole and a node/connection were deleted, leaving an unverified span
    # with a missing pole reference and an orphan optical component alongside valid ones
    project = Project(
        id="orphan-save-load",
        name="Orphan Save Load",
        nodes=[pole_keep, odp_keep],
        cable_segments=[cable_keep],
        pole_spans=[
            PoleSpan(id="s-orphan-pole", cable_segment_id="c-keep", from_pole_id="p-keep", to_pole_id="deleted-pole", covers_entire_cable_route=True, status="unverified"),
        ],
        optical_components=[
            OpticalComponent(id="comp-keep", kind="splice", node_id="odp-keep", configured_loss_db=0.1, configured_source="configured"),
            OpticalComponent(id="comp-orphan-node", kind="attenuator", node_id="deleted-node", configured_loss_db=0.5, configured_source="configured"),
            OpticalComponent(id="comp-orphan-conn", kind="connector", connection_id="deleted-conn", configured_loss_db=0.25, configured_source="configured"),
        ],
    )

    repo = ProjectRepository(db_session)
    saved = repo.save(project)
    loaded = repo.get("orphan-save-load")
    assert loaded is not None
    assert len(loaded.pole_spans) == 1
    assert loaded.pole_spans[0].status == "unverified"

    span_res = calculate_pole_spans(loaded)
    assert "missing_to_pole_reference" in span_res.spans[0]["diagnostics"]

    opt_res = calculate_optical_budget(loaded)
    diag_codes = {(d["code"], d.get("componentId")) for d in opt_res.diagnostics}
    assert ("missing_optical_component_node", "comp-orphan-node") in diag_codes
    assert ("missing_optical_component_connection", "comp-orphan-conn") in diag_codes
    assert all(d.get("componentId") != "comp-keep" for d in opt_res.diagnostics)


def test_optional_deployment_architecture_poleless_underground_building_and_mixed(db_session, client):
    from backend.app.domain.models import Customer, CustomerStatus
    from backend.app.domain.validation import validate_project_topology
    from backend.app.engine.cost import calculate_construction_cost

    # 1 & 2. OLT-to-ONT optical path works without any pole entities or pole spans
    olt = NetworkNode(id="olt", type="olt", name="OLT", location=PointGeometry(coordinates=(0, 0)))
    odc = NetworkNode(id="odc", type="odc", name="ODC", location=PointGeometry(coordinates=(0.002, 0)), properties={"splitterRatio": "1:4"})
    odp = NetworkNode(id="odp", type="odp", name="ODP", location=PointGeometry(coordinates=(0.004, 0)), properties={"splitterRatio": "1:8"})
    ont = NetworkNode(id="ont", type="ont", name="ONT", location=PointGeometry(coordinates=(0.0045, 0)))
    cust = Customer(id="cust", name="Subscriber", location=PointGeometry(coordinates=(0.0045, 0)), status=CustomerStatus.CONNECTED, ont_node_id="ont")

    # 3, 4, 5. Mixed deployment: underground feeder, building_attached distribution, aerial drop (without pole spans)
    c_ug = CableSegment(
        id="c-ug", name="UG Feeder", cable_type="feeder", deployment_method="underground",
        geometry=LineGeometry(coordinates=[(0, 0), (0.002, 0)]), length_m=1000.0,
        properties={"cableCategory": "feeder"},
    )
    c_bldg = CableSegment(
        id="c-bldg", name="Bldg Dist", cable_type="distribution", deployment_method="building_attached",
        geometry=LineGeometry(coordinates=[(0.002, 0), (0.004, 0)]), length_m=500.0,
        properties={"cableCategory": "distribution"},
    )
    c_drop = CableSegment(
        id="c-drop", name="Drop", cable_type="drop", deployment_method="aerial",
        geometry=LineGeometry(coordinates=[(0.004, 0), (0.0045, 0)]), length_m=100.0,
        properties={"cableCategory": "drop"},
    )

    project = Project(
        id="poleless-mixed-deployment",
        name="Poleless Mixed Deployment",
        nodes=[olt, odc, odp, ont],
        customers=[cust],
        cable_segments=[c_ug, c_bldg, c_drop],
        connections=[
            TopologyConnection(id="l1", from_node_id="olt", to_node_id="odc", cable_segment_id="c-ug"),
            TopologyConnection(id="l2", from_node_id="odc", to_node_id="odp", cable_segment_id="c-bldg"),
            TopologyConnection(id="l3", from_node_id="odp", to_node_id="ont", cable_segment_id="c-drop"),
        ],
    )

    topo = validate_project_topology(project)
    assert topo.valid is True
    assert len(topo.errors) == 0

    opt_before = calculate_optical_budget(project)
    assert len(opt_before.paths) == 1
    assert opt_before.paths[0].status == "pass"
    loss_before = opt_before.paths[0].loss_db

    # 6. Optical loss calculations are unchanged by deployment-method metadata alone
    c_ug.deployment_method = "aerial"
    c_bldg.deployment_method = "other"
    c_drop.deployment_method = "unspecified"
    opt_after = calculate_optical_budget(project)
    assert opt_after.paths[0].loss_db == loss_before
    assert opt_after.paths[0].received_power_dbm == opt_before.paths[0].received_power_dbm

    # Restore mixed methods and test save/load round-trip via API & Repository
    c_ug.deployment_method = "underground"
    c_bldg.deployment_method = "building_attached"
    c_drop.deployment_method = "other"

    put_res = client.put(f"/api/v1/projects/{project.id}", json=project.model_dump(by_alias=True))
    assert put_res.status_code == 200
    get_res = client.get(f"/api/v1/projects/{project.id}")
    assert get_res.status_code == 200
    loaded_cables = {c["id"]: c for c in get_res.json()["cableSegments"]}
    assert loaded_cables["c-ug"]["deploymentMethod"] == "underground"
    assert loaded_cables["c-bldg"]["deploymentMethod"] == "building_attached"
    assert loaded_cables["c-drop"]["deploymentMethod"] == "other"

    # Malformed deployment metadata falls back to unspecified with explicit diagnostic & incomplete RAB item
    malformed_project = Project.model_validate({
        "id": "malformed-dep",
        "name": "Malformed Deployment",
        "cableSegments": [{
            "id": "c-bad",
            "name": "Bad Deployment Cable",
            "deploymentMethod": "subsea_laser_tunnel",
            "geometry": {"type": "LineString", "coordinates": [[0, 0], [0.001, 0]]},
            "lengthM": 120.0,
        }],
    })
    assert malformed_project.cable_segments[0].deployment_method == "unspecified"
    assert malformed_project.cable_segments[0].properties.get("deploymentMethodMalformed") is True
    malformed_spans = calculate_pole_spans(malformed_project)
    assert any(d["code"] == "malformed_cable_deployment_method" for d in malformed_spans.diagnostics)
    malformed_cost = calculate_construction_cost(malformed_project)
    assert malformed_cost.complete is False
    assert any(i["reason"] == "malformed_deployment_method" for i in malformed_cost.incomplete_items)





def _span_persistence_fixture(project_id="span-source"):
    start = NetworkNode(id="pa", type=NodeType.POLE, name="PA", location=PointGeometry(coordinates=(0.0, 0.0)))
    end = NetworkNode(id="pb", type=NodeType.POLE, name="PB", location=PointGeometry(coordinates=(0.001, 0.0)))
    cable = CableSegment(id="route", name="route", geometry=LineGeometry(coordinates=[(0.0, 0.0), (0.001, 0.0)]))
    span = PoleSpan(id="span", cable_segment_id="route", from_pole_id="pa", to_pole_id="pb", covers_entire_cable_route=True)
    return Project(id=project_id, name="Span source fixture", nodes=[start, end], cable_segments=[cable], pole_spans=[span])


def test_save_preserves_explicit_field_measurement_over_span_geometry(db_session):
    project = _span_persistence_fixture("measured-span")
    span = project.pole_spans[0]
    span.geometry = LineGeometry(coordinates=[(0.0, 0.0), (0.001, 0.0)])
    span.length_m = 145.6
    span.length_source = "measured"
    repository = ProjectRepository(db_session)

    repository.save(project)
    loaded = repository.get(project.id)
    assert loaded is not None
    assert loaded.pole_spans[0].length_m == 145.6
    assert loaded.pole_spans[0].length_source == "measured"

    loaded.cable_segments[0].geometry = LineGeometry(coordinates=[(0.0, 0.0), (0.002, 0.0)])
    repository.save(loaded)
    reloaded = repository.get(project.id)
    assert reloaded is not None
    assert reloaded.pole_spans[0].length_m == 145.6
    assert reloaded.pole_spans[0].length_source == "measured"


def test_save_recomputes_geometry_source_but_keeps_unknown_length_unknown(db_session):
    project = _span_persistence_fixture("geometry-span")
    project.pole_spans[0].geometry = LineGeometry(coordinates=[(0.0, 0.0), (0.001, 0.0)])
    project.pole_spans[0].length_source = "geometry"
    repository = ProjectRepository(db_session)

    repository.save(project)
    loaded = repository.get(project.id)
    assert loaded is not None
    first_length = loaded.pole_spans[0].length_m
    assert first_length == 111.2
    assert loaded.pole_spans[0].length_source == "geometry"
    loaded.pole_spans[0].geometry = LineGeometry(coordinates=[(0.0, 0.0), (0.002, 0.0)])
    repository.save(loaded)
    reloaded = repository.get(project.id)
    assert reloaded is not None
    assert reloaded.pole_spans[0].length_m == 222.39
    assert reloaded.pole_spans[0].length_source == "geometry"

    unknown = _span_persistence_fixture("unknown-span")
    unknown.pole_spans[0].covers_entire_cable_route = False
    unknown.pole_spans[0].length_source = "unknown"
    unknown.cable_segments[0].geometry = LineGeometry(coordinates=[(1.0, 1.0), (1.001, 1.0)])
    unknown.cable_segments[0].length_m = 500.0
    repository.save(unknown)
    unknown_loaded = repository.get(unknown.id)
    assert unknown_loaded is not None
    assert unknown_loaded.pole_spans[0].length_m is None
    assert unknown_loaded.pole_spans[0].length_source == "unknown"


def test_legacy_span_length_keeps_ambiguous_provenance_across_repeated_saves(db_session):
    project = _span_persistence_fixture("legacy-span")
    project.pole_spans[0] = PoleSpan.model_validate({
        "id": "legacy-span-link",
        "cableSegmentId": "route",
        "fromPoleId": "pa",
        "toPoleId": "pb",
        "coversEntireCableRoute": False,
        "geometry": {"type": "LineString", "coordinates": [[0.0, 0.0], [0.001, 0.0]]},
        "lengthM": 145.6,
    })
    assert project.pole_spans[0].length_source == "legacy"
    repository = ProjectRepository(db_session)

    repository.save(project)
    first = repository.get(project.id)
    assert first is not None
    assert first.pole_spans[0].length_m == 145.6
    assert first.pole_spans[0].length_source == "legacy"
    repository.save(first)
    second = repository.get(project.id)
    assert second is not None
    assert second.pole_spans[0].length_m == 145.6
    assert second.pole_spans[0].length_source == "legacy"


def test_multiple_measured_subspans_keep_each_independent_measurement(db_session):
    project = _span_persistence_fixture("measured-subspans")
    project.nodes.append(NetworkNode(id="pc", type=NodeType.POLE, name="PC", location=PointGeometry(coordinates=(0.0025, 0.0))))
    project.cable_segments[0].geometry = LineGeometry(coordinates=[(0.0, 0.0), (0.001, 0.0), (0.0025, 0.0)])
    first = project.pole_spans[0]
    first.covers_entire_cable_route = False
    first.length_m = 105.4
    first.length_source = "measured"
    second = PoleSpan(id="span-2", cable_segment_id="route", from_pole_id="pb", to_pole_id="pc", covers_entire_cable_route=False, length_m=162.8, length_source="measured")
    project.pole_spans.append(second)

    repository = ProjectRepository(db_session)
    repository.save(project)
    loaded = repository.get(project.id)
    assert loaded is not None
    assert [(span.length_m, span.length_source) for span in loaded.pole_spans] == [(105.4, "measured"), (162.8, "measured")]


def test_subspan_vertex_snap_tolerance_and_reversed_endpoints():
    from math import pi

    from backend.app.engine.pole import VERTEX_MATCH_TOLERANCE_M, extract_subspan_coordinates

    cable = CableSegment(id="snap-route", name="snap route", geometry=LineGeometry(coordinates=[(0.0, 0.0), (0.001, 0.0), (0.002, 0.0)]))
    start = NetworkNode(id="snap-a", type=NodeType.POLE, name="A", location=PointGeometry(coordinates=(0.0, 0.0)))
    middle = NetworkNode(id="snap-b", type=NodeType.POLE, name="B", location=PointGeometry(coordinates=(0.001, 0.0)))
    end = NetworkNode(id="snap-c", type=NodeType.POLE, name="C", location=PointGeometry(coordinates=(0.002, 0.0)))
    # At the equator, this longitude offset is the 1 m snap limit for the engine's mean Earth radius.
    start.location = PointGeometry(coordinates=(VERTEX_MATCH_TOLERANCE_M / (6_371_008.8 * pi / 180), 0.0))

    forward = extract_subspan_coordinates(cable, start, middle)
    reverse = extract_subspan_coordinates(cable, middle, start)
    assert forward == [(0.0, 0.0), (0.001, 0.0)]
    assert reverse == [(0.001, 0.0), (0.0, 0.0)]
    assert extract_subspan_coordinates(cable, middle, end) == [(0.001, 0.0), (0.002, 0.0)]

    outside = NetworkNode(id="outside", type=NodeType.POLE, name="Outside", location=PointGeometry(coordinates=(0.001 + 1.1 / 111_195, 0.0)))
    assert extract_subspan_coordinates(cable, middle, outside) is None
