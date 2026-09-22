# Build
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY TaikoLabs.Api.csproj ./
RUN dotnet restore TaikoLabs.Api.csproj

COPY . ./
RUN dotnet publish TaikoLabs.Api.csproj -c Release -o /app --no-restore

# Run
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app ./

# Container Apps routes to whatever PORT it assigns; default to 8080 locally.
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

ENTRYPOINT ["dotnet", "TaikoLabs.Api.dll"]
