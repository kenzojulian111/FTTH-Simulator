# FTTH Network Planning Simulator — Backend & Engineering Specification

## 1. Overview and Architecture

The backend engine provides persistence, topological validation, authoritative route length calculation, optical power budget analysis, and Bill of Quantities (BoQ) CAPEX estimation for the FTTH Network Planning Simulator.

### Stack
- **Python 3.14**
- **FastAPI**: REST API layer with OpenAPI/Swagger auto-documentation
- **Pydantic v2**: Request/response serialization, validation, and camelCase conversion
- **SQLAlchemy 2.0 & SQLite**: Persistent relational storage for project aggregates
- **pytest**: Automated unit and integration testing suite

### Architecture & Layer Separation
```
backend/
├── app/
│   ├── main.py              # Application entry point, lifespan, CORS, and routing
│   ├── api/
│   │   ├── routes.py        # HTTP endpoint handlers (v1)
│   │   └── error_handlers.py# Predictable error mapping conforming to API_CONTRACT.md
│   ├── domain/
│   │   ├── models.py        # Pydantic schemas (Project, Nodes, Cables, Calculations)
│   │   └── validation.py    # Cross-entity integrity & network topology validation
│   ├── engine/
│   │   ├── geo.py           # WGS-84 Haversine distance & route length calculation
│   │   ├── optical.py       # Optical link budget, attenuation, and margin evaluation
│   │   ├── pole.py           # Explicit pole spans, configured interval estimates, diagnostics
│   │   └── cost.py          # Bill of Quantities (BoQ) and CAPEX estimation
│   └── persistence/
│       ├── database.py      # SQLite connection & session management
│       ├── models.py        # SQLAlchemy ORM entity models
│       └── repository.py    # Project CRUD repository with upsert logic
└── tests/                   # Automated pytest test suites
```

---

## 2. API Contract Compliance & Reconciliation

All endpoints and payloads strictly follow `docs/API_CONTRACT.md`:
- **Base path**: `/api/v1`
- **Field casing**: camelCase across the wire (`projectId`, `fromNodeId`, `toNodeId`, `cableSegmentId`, `cableType`, `fiberCount`, `lengthM`, `totalAmount`, `unitCost`, `receivedPowerDbm`, `lossDb`, `createdAt`, `updatedAt`).
- **Coordinates**: GeoJSON RFC 7946 `[longitude, latitude]` in WGS 84 decimal degrees.
- **Authoritative Lengths**: `lengthM` on cable segments is computed server-side using the Haversine formula over route vertices.

### Implemented Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Root health check |
| `GET` | `/api/v1/health` | API v1 health check |
| `GET` | `/api/v1/projects` | List project summaries (`{ projects: ProjectSummary[] }`) |
| `GET` | `/api/v1/projects/{projectId}` | Load complete project aggregate |
| `PUT` | `/api/v1/projects/{projectId}` | Create or atomically replace project; computes route lengths |
| `DELETE` | `/api/v1/projects/{projectId}` | Delete project (`204 No Content`) |
| `POST` | `/api/v1/projects/{projectId}/calculations/optical-budget` | Compute optical link power budgets and margins |
| `POST` | `/api/v1/projects/{projectId}/calculations/construction-cost` | Compute Bill of Quantities (BoQ) and CAPEX |
| `POST` | `/api/v1/projects/{projectId}/calculations/pole-spans` | Compute explicit pole span diagnostics and configured estimates |

---

## 3. Engineering Calculations & Formulas

### 3.1 Geographic Route Length (WGS-84)
Using the spherical Haversine formula with mean Earth radius $R = 6,371,008.8\text{ m}$:
$$\Delta \phi = \text{radians}(\text{lat}_2 - \text{lat}_1), \quad \Delta \lambda = \text{radians}(\text{lon}_2 - \text{lon}_1)$$
$$h = \sin^2\left(\frac{\Delta \phi}{2}\right) + \cos(\text{radians}(\text{lat}_1)) \cdot \cos(\text{radians}(\text{lat}_2)) \cdot \sin^2\left(\frac{\Delta \lambda}{2}\right)$$
$$d = 2 \cdot R \cdot \text{atan2}\left(\sqrt{h}, \sqrt{1 - h}\right)$$
Total route length is the cumulative sum of segment distances between consecutive line vertices.

### 3.2 Optical Power Budget
Parameters and units:
- Route distance $L$ (km) = $\text{lengthM} / 1000.0$
- Fiber attenuation coefficient $\alpha$ (dB/km): legacy application default $0.35\text{ dB/km}$; verify/configure it for the deployed fiber type and wavelength. It is not universal.
- Splitter insertion loss $A_{\text{splitter}}$ (dB): use configured device insertion loss. The legacy table below is an illustrative planning assumption, not a manufacturer-specific profile. A splitter with unknown ratio and no explicit loss is unknown and cannot pass. `idealLossDb = 10 log_{10}(N)` for a known 1:N ratio is informational only and is never substituted for actual device insertion loss:
  - 1:2 $\to 3.5\text{ dB}$
  - 1:4 $\to 7.2\text{ dB}$
  - 1:8 $\to 10.5\text{ dB}$
  - 1:16 $\to 13.8\text{ dB}$
  - 1:32 $\to 17.1\text{ dB}$
  - 1:64 $\to 20.5\text{ dB}$
- Connector insertion loss $A_{\text{conn}}$ (dB): $N_{\text{conn}} \times 0.50\text{ dB}$ (legacy configured assumption: 2 interfaces)
- Splice loss $A_{\text{splice}}$ (dB): $N_{\text{splice}} \times 0.10\text{ dB}$ (legacy configured assumption: 1 fusion splice)
- Design safety margin $A_{\text{margin}}$ (dB): default $3.0\text{ dB}$ (aging, temperature, repair splices)

The defaults above are grouped under `profileId: illustrative_gpon_planning_v1`. They preserve existing application behavior for new projects and are planning assumptions, not verified equipment specifications or manufacturer data. The profile inputs are: transmit power $+2.5$ dBm; fiber attenuation $0.35$ dB/km with fiber label G.652.D at 1310 nm; connector loss $0.50$ dB per assumed interface with 2 assumed interfaces per link; fusion splice loss $0.10$ dB per assumed splice with 1 assumed splice per link; the splitter table above; receiver sensitivity $-27.0$ dBm; overload $-8.0$ dBm; design reserve 3.0 dB; and minimum design margin 0 dB. Replace these with documented project/equipment inputs before treating a result as a project-specific engineering determination.

Every optical configuration parameter has a `parameterSources` value: `configured`, `profile_default`, `legacy_fallback`, or `unknown`. New empty settings use the illustrative profile. A pre-provenance serialized optical config containing values but no source metadata is migrated to `legacy_fallback` without changing its numeric values; output values remain available, but its end-to-end status becomes `unknown` with `legacy_fallback_parameters`. An `unknown` attenuation or component-loss input nulls affected loss and dependent totals/power while preserving route length and other known components. Unknown transmitter/receiver inputs null only dependent power/headroom fields. Cable properties `fiberType`, `wavelengthNm`, `attenuationDbPerKm`, `connectorLossDb`, `connectorsCount`, `spliceLossDb`, and `splicesCount`, when present, are treated as explicit configured overrides.

For an end-to-end OLT-to-ONT path, physical attenuation accumulates each cable segment's fiber, connector, and splice losses and each traversed splitter's insertion loss once. The reserve is applied once to the design margin:
$$A_{\text{physical}} = \sum_i (L_i \times \alpha_i + A_{\text{conn},i} + A_{\text{splice},i}) + \sum_j A_{\text{splitter},j}$$
$$P_{\text{rx}} = P_{\text{tx}} - A_{\text{physical}}, \quad M_{\text{design}} = P_{\text{rx}} - P_{\text{sensitivity}} - A_{\text{margin}}$$

The `links` response remains per-connection diagnostic data. Use `paths` for end-to-end optical decisions; a set of independent edge results must not be treated as a complete subscriber budget.

Received optical power is physical receiver power and does not deduct the reserve. $P_{\text{tx}}$ is transmitter power in dBm; the illustrative profile uses $+2.5\text{ dBm}$ as an unverified planning assumption, not a verified OLT/SFP specification.

Optical power margin:
$$M_{\text{design}} = P_{\text{rx}} - P_{\text{sensitivity}} - A_{\text{margin}}$$
where $P_{\text{sensitivity}}$ is receiver sensitivity in dBm; the illustrative profile uses $-27.0\text{ dBm}$ as an unverified planning assumption, not a verified ONT specification.

The response also exposes `sensitivityMarginDb = P_rx - P_sensitivity` and `overloadMarginDb = P_overload - P_rx`, both in dB and calculated from physical received power. These receiver-limit headrooms do not include the reserve; `marginDb` remains design margin after reserve.

Status evaluation:
- `"pass"`: if $P_{\text{rx}} \ge P_{\text{sensitivity}}$ and $P_{\text{rx}} \le P_{\text{overload}}$ (default $-8.0\text{ dBm}$) and $M \ge M_{\text{min}}$ ($0.0\text{ dB}$).
- `"fail"`: if $P_{\text{rx}} < P_{\text{sensitivity}}$ (insufficient optical signal) or $P_{\text{rx}} > P_{\text{overload}}$ (receiver saturation).
- `"unknown"`: non-optical edge endpoint, missing/ambiguous route, an explicitly unknown critical input, or legacy fallback values without provenance. Results retain unaffected quantities and null only dependent measurements; `parameterSources` identifies fallback inputs.

### 3.3 Construction Cost & Bill of Quantities (BoQ)
- Cable Slack / Reserve Allowance: configurable percentage (default $10\%$) added to physical route lengths for slack coiling, pole drop loops, and splice trays. Billed length is used for both cable supply and cable installation quantities:
  $$\text{Billed Length} = \sum L_{\text{cable}} \times (1 + \text{slack\_percent} / 100)$$
- Bill of Quantities items:
  1. `CBL-SUPPLY`: Fiber Optic Cable Supply (billed length $\times$ unit rate)
  2. `CBL-INSTALL`: Cable Aerial / Duct Pulling & Installation
  3. `POLE-SUPPLY`: Distribution Pole Supply (7m/9m)
  4. `POLE-INSTALL`: Pole Erection & Civil Works
  5. `OLT-SUPPLY`: GPON OLT Hardware Supply
  6. `OLT-INSTALL`: Central Office Rack Mount & Commissioning
  7. `ODC-SUPPLY`: ODC Distribution Cabinet Supply
  8. `ODC-INSTALL`: ODC Pad Foundation & Feeder Termination
  9. `ODP-SUPPLY`: ODP Distribution Box Enclosure Supply
  10. `ODP-INSTALL`: ODP Pole Mounting & Fiber Termination
  11. `SPL-SUPPLY`: Optical PLC Splitter Supply
  12. `SPL-INSTALL`: Splitter Fusion Splicing & Tray Mounting
  13. `ONT-SUPPLY`: GPON ONT Terminal Device Supply
  14. `ONT-INSTALL`: Customer Home Drop Wire & ONT Installation
- CAPEX: sum of all item amounts.
- Cost per connected customer:
  $$\text{Cost per Customer} = \frac{\text{Total CAPEX}}{\text{Connected Customer Count}}$$

---

## 4. Limitations & Future Work

1. **Multiple Directed Paths**:
   End-to-end optical results are calculated per ONT. Missing and ambiguous directed OLT-to-ONT paths are reported as `unknown`. The engine does not model PON port capacity or branch power sharing beyond summing configured splitter insertion losses.
2. **Customer Association**:
   `Customer.ontNodeId` is optional for backward compatibility. Connected customers without a reachable associated ONT are returned in `disconnectedCustomerIds`.
3. **Cost Rate Provenance**:
   Default unit prices are illustrative, configurable planning inputs. They have not been verified against current vendor or construction market quotes.
4. **Topological Auto-Routing**:
   Cables are drawn manually by users. GIS shortest-path auto-routing along road networks is excluded from this milestone per spec.
5. **Hardware Integration**:
   Direct physical router integration (MikroTik HTB, SNMP, TR-069) is excluded from this phase.
