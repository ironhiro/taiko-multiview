# One image for a whole environment: the API, with the frontend build in its wwwroot, so
# the page and /api share an origin. Build from the repository root:
#   docker build -t taikolabs .
#
# Both build stages run on the builder's own platform: the frontend is static files and the
# API is published framework-dependent (plain IL), so neither depends on the target CPU.
# Only the last stage, which runs nothing, is the target's - so an amd64 image for Azure
# builds at native speed on an ARM Mac:
#   docker buildx build --platform linux/amd64 -t taikolabs .

# Frontend
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# API
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0 AS backend
WORKDIR /src
COPY backend/TaikoLabs.Api/TaikoLabs.Api.csproj ./
RUN dotnet restore TaikoLabs.Api.csproj
COPY backend/TaikoLabs.Api/ ./
RUN dotnet publish TaikoLabs.Api.csproj -c Release -o /app --no-restore

# Run
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
LABEL org.opencontainers.image.source=https://github.com/ironhiro/taiko-multiview
WORKDIR /app
COPY --from=backend /app ./
COPY --from=frontend /src/dist ./wwwroot

# Container Apps routes to the port the app is told; 8080 matches its default target port.
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

# Runs as the image's non-root user, which cannot write /app: the closure cache (a startup
# shortcut, rebuilt when missing) goes to /tmp instead.
ENV Venues__ClosureCachePath=/tmp/closures.cache.json
USER $APP_UID

ENTRYPOINT ["dotnet", "TaikoLabs.Api.dll"]
