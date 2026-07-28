# Production image for the Ladybug SPA. Built in CI: a `tsc -b && vite build` on the
# 1 vCPU / 960 MiB server would be slow at best and OOM at worst, and would repeat on
# every deploy.
#
# Build context is the REPO ROOT (see release.yml).

FROM node:20 AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Deliberately NO VITE_API_BASE_URL: the SPA and API share an origin in production, and
# Api.base() (frontend/src/lib/api.ts) already falls back to '' when the var is unset.
# Note also that no secret may EVER be passed as a VITE_* var -- Vite inlines those into
# the JavaScript served to every visitor.
RUN npm run build

FROM nginx:alpine
COPY deploy/web/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
