# Stage 1: Build the React + Vite + TypeScript frontend
FROM node:22-alpine AS frontend-builder

WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts ./
COPY src ./src

# Default to same-origin /api/v1 for single-container deployment
ARG VITE_API_BASE_URL=/api/v1
ARG VITE_EARTH_TILE_PROVIDER=esri_world_imagery
ARG VITE_EARTH_TILE_URL=
ARG VITE_EARTH_TILE_ATTRIBUTION=
ARG VITE_EARTH_LABELS_TILE_URL=
ARG VITE_EARTH_LABELS_ATTRIBUTION=
ARG VITE_MAPBOX_ACCESS_TOKEN=

ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_EARTH_TILE_PROVIDER=${VITE_EARTH_TILE_PROVIDER} \
    VITE_EARTH_TILE_URL=${VITE_EARTH_TILE_URL} \
    VITE_EARTH_TILE_ATTRIBUTION=${VITE_EARTH_TILE_ATTRIBUTION} \
    VITE_EARTH_LABELS_TILE_URL=${VITE_EARTH_LABELS_TILE_URL} \
    VITE_EARTH_LABELS_ATTRIBUTION=${VITE_EARTH_LABELS_ATTRIBUTION} \
    VITE_MAPBOX_ACCESS_TOKEN=${VITE_MAPBOX_ACCESS_TOKEN}

RUN npm run build

# Stage 2: Production FastAPI + Static SPA runtime
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=10000

WORKDIR /app

# Install Python backend dependencies
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r backend/requirements.txt

# Copy backend application and seed SQLite database
COPY backend ./backend
COPY ftth_simulator.db ./ftth_simulator.db

# Copy built frontend assets from Stage 1
COPY --from=frontend-builder /build/dist ./dist

EXPOSE 10000

# Single worker as required for SQLite write serialization and process-local geocoding rate limiting.
# Note: On Render Free, the container filesystem is ephemeral; SQLite changes do not survive container restarts or redeployments.
CMD ["sh", "-c", "exec uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1"]
