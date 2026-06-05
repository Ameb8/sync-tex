# SyncTex

![SyncTex Logo](https://github.com/Ameb8/sync-tex/blob/master/docs/SyncTex.png)

SyncTex is a web-based LaTeX project editor. It allows users to store and save full-fledged projects, containing various file types and resources. Users can collaborate in real time, allowing teams to work together to produce clean and professional documentation. Get advice, ask questions, or generate content with built-in LLM assistant. Login with your GitHub or email and start editing now!

## Features

- Real-Time collaborative document editing

- Multi-file and directory project support

- Gemini LLM assistant integration

- Collaborators with editor and read-only privileges

- Login with GitHub or email/password

## Planned Features

- Project compilation to PDF

- Login with Google

- Additional LLM provider support

- Project source/bibliography management

- Auto-context for LLM assistant

## Running

Prerequisites: Docker Compose for the service stack, Node.js/npm for the React frontend, and a populated `.env` file. Start from `.env.example`:

```sh
cp .env.example .env
```

For production, replace all example secrets, database passwords, OAuth credentials, API keys, and public URLs before starting the stack.

### Development

Development mode uses `docker-compose.yml` plus `docker-compose.dev.yml`. Backend services run in containers with reload/watch commands, while nginx proxies the frontend route to the local Vite dev server.

```sh
make dev-build
make dev-up

cd frontend
npm install
npm run dev
```

Open `http://localhost`. Useful dev endpoints are exposed locally: users service on `8001`, projects service on `8003`, assistant service on `8000`, file-data gRPC on `50051`, MinIO API on `9000`, and MinIO console on `9001`.

Common commands:

```sh
make dev-logs                 # follow all service logs
make dev-logs SERVICE=minio   # follow one service
make dev-ps                   # list containers
make dev-down                 # stop and remove dev containers
make dev-reset                # also remove dev volumes
```

### Production

Production Compose mode uses `docker-compose.yml` plus `docker-compose.prod.yml`. It builds production service images, packages the Vite frontend into the nginx gateway image, and starts the Cloudflare tunnel sidecar.

```sh
make prod-build
make prod-up
```

The continuous deployment path uses GHCR images and the Swarm stack in `docker-compose.swarm.yml`; see `docs/deployment-runbook.md`. Keep `docker-compose.prod.yml` as the legacy/manual production path while Swarm is being validated.

Set `FRONTEND_URL` and `EXTERNAL_URL` in `.env` to the public origin clients should use. The app is served by nginx on port `80`; production object URLs and OAuth redirects depend on those external URL values.

Common commands:

```sh
make prod-logs
make prod-ps
make prod-down
make prod-reset    # removes production containers and volumes
```


# Software Design

SyncTex is built on a microservice architecture to support independent scaling and separation of concerns. 

![Architecture Diagram](https://github.com/Ameb8/sync-tex/blob/master/docs/sync-tex-architecture.png)

## Webpage

## Projects-Service

Projects-Service is responsible for managing user's projects and files. The system stores all projects and their file structures and provide access through a Rest-API. 


### Projects-Service Rest-API

Projects-Service provides a set of CRUD operations allowing for easy access and management of project-centric resources by both clients and other backend services. Project-Service's API schema can be [found here](https://ameb8.github.io/sync-tex/projects-service-api.html). 


### Projects-Service Database

![Projects-Service-DB ERD](https://github.com/Ameb8/sync-tex/blob/master/docs/projects-service/projects-db-erd.png)

### Projects-Service File Store

## Collab-Service

Collab-Service enables real-time collaborative editing between users, allowing multiple users to edit a document simultaneously. A user connects by utilizing two query parameters, the primary key fo the file being edited and the user's authentication token. This allows Collab-Service to ensure users can only edit documents for which they have permission. The Yjs library allows straightforward implementation of CRDT-style collaborative editing. Thus, SyncTex does not implement its' own CRDT system, instead utilizing a highly reliable and performant existing system.

### Collab-Service Websocket Server

Collab-Service primarily uses the websocket protocol to enable collaborative editing. The server stores an in-memory map of files to connected users. When an edit is received by a server, it is broadcasted to all other users connected to that document. The payload of each update consists of Yjs's binary CRDT protocol. Thus, Collab-Service does not understand, parse, or analyze any file updates, simply broadcasting them to other users.

In order to ensure consistent states between users, Collab-Service provides an initial seed state for connecting users. When the first user connects to a document, Collab-Service fetches the Yjs-formatted state of a document. This is done by fetching a presigned download URL from Projects-Service, then downloading the file. It is the responsibility of Projects-Service to ensure the download URL links to the Yjs binary version of the document. This document is sent as-is to the first connecting user. However, as new users join, the initial document state no longer suffices, as it has been edited. To handle this, Collab-Service keeps a log of all edits applied to the document. These updates can then be sent to connecting users, ensuring they have the most up-to-date version. When all users disconnect on a given document, these changes will be uploaded to filestore and evicted from Collab-Service memory. 

In order to avoid saving collisions and mismatching document states, clients do not save documents when editing collaboratively. Instead, Collab-Service is responsible for document persistence. Collab-Service utilizes configurable debounce saving, as well as ensuring a final upload when all users disconnect from a given document. The saved document will be in Yjs-binary form. It may be compacted into a more memory-efficient format, but this is not Collab-Service's responsibility. 

Collab-Service ensures users have write access to a document before joining. This is done by first collecting their authentication token from query parameters. Next, a http request is made to projects-service, specifying whether the given user is allowed to edit the document. If write-access is not allowed, the websocket connection is dropped. 


## Users-Service

Users-Service allows the system to authenticate users, as well as storing and managing user-centric data. It supports password-based accounts, as well as OAuth2-based login. Currently, Users-Service only supports GitHub authentication, but there are future plans to integrate more providers.

Users-Service utilizes JWT tokens for authentication. When a user logs in, they are provided with a JWT tokens, containing a unique identifier for that user. Thus, once a user is logged in, additional calls to Users-Service are not required. Furthermore, other services are able to authenticate and identify a user independently. While they are not able to access the full user data without calling Users-Service, they are able to store and access their own data relative to individual users. 

### Users-Service Rest-API
### Users-Service Database
