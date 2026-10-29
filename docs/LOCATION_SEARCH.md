# Geographic location search

The map's place search is submitted explicitly; it is not an autocomplete service. The frontend sends a query to the existing FastAPI service. Search results are temporary geographic references and are not added to project data.

## Provider

The default backend adapter calls the Nominatim Search API at `https://nominatim.openstreetmap.org/search` and sends an identifying `FTTHNetworkPlanningSimulator/0.1` User-Agent. `GEOCODING_CONTACT_EMAIL` may be set to provide an operator contact in the request. Search results display OpenStreetMap contributor attribution and are cached in backend memory for six hours. OpenStreetMap data is offered under ODbL; attribution is shown beside the search control, and any reuse of larger data extracts must follow the license/share-alike terms.

The public Nominatim service permits only moderate, user-triggered website/app searches, prohibits client-side autocomplete, requires an identifying User-Agent or Referer, and has an absolute maximum of one request per second for the combined traffic of an application. Its policy recommends a proxy and caching. This adapter serializes requests and enforces at least 1.1 seconds between requests within one backend process. For the public endpoint, run one backend worker/instance so this process-local throttle applies to the whole application. If scaling out or expecting higher traffic, configure a shared rate limiter or move to a separately operated/provider-approved geocoder before adding workers. Do not send confidential or personal data as search queries. Review the [current Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) before deployment; it may change.

The provider can be replaced without changing the map UI by setting `GEOCODING_PROVIDER_URL` to a compatible Search API endpoint that accepts Nominatim JSONv2 query parameters and response fields. For frontend/backend on different origins, set `VITE_API_BASE_URL` to the FastAPI `/api/v1` base URL. In local Vite development, `/api/v1` is proxied to `http://localhost:8000`.

## API deployment and browser origins

Local development defaults `FTTH_ENVIRONMENT` to `development` and permits only `http://localhost:5173` and `http://127.0.0.1:5173`. For a private or public deployment, set `FTTH_ENVIRONMENT=production` and provide `CORS_ALLOWED_ORIGINS` as a comma-separated list of exact `http(s)://host[:port]` origins, for example `https://planner.example`. Startup rejects wildcard, path-bearing, or missing production origin configuration. CORS only controls browser cross-origin access; it is not authentication. Project create, update, and delete endpoints have no authentication in this application, so keep the API on a trusted network or place it behind an authenticated access layer before exposing it to untrusted users.

No API credential is required or exposed by this integration.
