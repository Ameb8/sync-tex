# Create Production Dockerfile

Use this skill when asked to create or update a production Dockerfile for a service.

## Workflow

1. Read `resources/conventions.md` first and follow it as the baseline policy.
2. Identify the service language/framework from the repository files, README, package manifests, existing Dockerfile, or user request.
3. If a matching language-specific instruction file exists in `resources/`, read it and apply it after the baseline conventions.
   - `resources/fastapi.md` for Python FastAPI/Uvicorn services.
   - `resources/go.md` for Go services.
   - `resources/rust.md` for Rust services.
4. Treat language-specific instructions as higher priority than generic conventions when they conflict.
5. Inspect the target service before editing so the Dockerfile matches the actual build command, dependency manager, module path, application entry point, port, health endpoint, and runtime needs.
6. If the service has a `Dockerfile.dev`, read it for discovery only: entry point, port, dependency manager, build commands, working directory, and service-specific environment defaults. Do not copy dev-only patterns into the production Dockerfile unless they are explicitly appropriate for production.
7. Read `docker-compose.yml` and `docker-compose.prod.yml` when present to understand build context, Dockerfile path, service port, environment variables, dependencies, healthcheck expectations, and runtime command overrides.
8. If any required implementation detail is unclear, unknown, or ambiguous after inspecting the repository, ask the user for the missing context before generating the Dockerfile.
9. Implement the Dockerfile in the target service directory unless the user specifies a different path.
10. Add or update a `.dockerignore` for the same build context when needed, following the minimum exclusions in `resources/conventions.md` and any project-specific generated artifacts.
11. Keep the image production-focused:
   - Multi-stage build with `builder` and `runtime` stages.
   - BuildKit syntax pragma as the first Dockerfile line.
   - Runtime container runs as non-root.
   - Runtime stage contains only necessary runtime artifacts.
   - Exec-form `ENTRYPOINT` or `CMD`.
   - `EXPOSE`, `STOPSIGNAL`, safe runtime `ENV` defaults, OCI labels, and `HEALTHCHECK`.
12. Do not bake secrets, `.env` files, credentials, dev-only dependencies, or unnecessary source/build caches into the runtime image.
13. If the selected runtime image cannot support the generic healthcheck approach, follow the language-specific healthcheck guidance and use the smallest Dockerfile-only alternative, or document the missing application support if no reliable Dockerfile-only option exists.

## Scope Boundary

This skill only authorizes Dockerfile and `.dockerignore` changes unless the user explicitly asks for application code or Compose changes.

If the service does not already expose a healthcheck endpoint, signal handler, healthcheck flag, or other required runtime behavior, do not modify application code. Instead:

- Implement the best Dockerfile-level healthcheck that works with the existing service behavior.
- If no reliable Dockerfile-only healthcheck is possible, add a clear Dockerfile comment documenting the missing application support.
- Report the required application change in the final response.
- Do not add endpoints, CLI flags, signal handlers, shutdown logic, dependencies, or service configuration outside the Dockerfile/build context.

Do not modify `docker-compose.yml` or `docker-compose.prod.yml` unless the user explicitly asks for Compose changes. If the production Dockerfile requires a Compose update, report the needed change instead.

## Verification

After editing, run the narrowest practical validation for the service:

- Build the image if dependencies and network access are available.
- Otherwise, validate Dockerfile syntax and explain what could not be run.
