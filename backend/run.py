"""Helper script to run the FTTH Simulator API server."""

import os
import uvicorn

if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    reload = os.environ.get("RELOAD", "true").lower() in ("1", "true", "yes")
    uvicorn.run("backend.app.main:app", host=host, port=port, reload=reload)
