# SyncTex

![SyncTex Logo](https://github.com/Ameb8/sync-tex/blob/master/docs/SyncTex.png)

SyncTex is a web-based LaTeX project editor. It allows users to store and save full-fledged projects, containing various file types and resources. Users can collaborate in real time, allowing teams to work together to produce clean and proffesional documentation. 

# Software Design

![Architecture Diagram](https://github.com/Ameb8/sync-tex/blob/master/docs/sync-tex-architecture.png)

## Webpage

## Projects-Service

Projects-Service is responsible for managing user's projects and files. The system stores all projects and their file structures and provide access through a Rest-API. 


### Projects-Service Rest-API
### Projects-Service Database

![Projects-Service-DB ERD](https://github.com/Ameb8/sync-tex/blob/master/docs/projects-service/projects-db-erd.png)

### Projects-Service File Store

## Collab-Service

Collab-Service enables real-time collaborative editing between users, allowing multiple users to edit a document simultaneously. A user connects by utilizing two query parameters, the primary key fo the file being edited and the user's authentication token. This allows Collab-Service to ensure users can only edit documents for which they have permission. The Yjs library allows straightforward implementation of CRDT-style collaborative editing. Thus, SyncTex does not implement its' own CRDT system, instead utilizing a highly reliable and performant existing system.

### Collab-Service Websocket Server

Collab-Service primarily uses the websocket protocol to enable collaborative editing. The server stores an in-memory map of files to connected users. When an edit is received by a server, it is broadcasted to all other users connected to that document. The payload of each update consists of Yjs's binary CRDT protocol. Thus, Collab-Service does not understand, parse, or analyze any file updates, simply broadcasting them to other users.



## Users-Service

Users-Service allows the system to authenticate users, as well as storing and managing user-centric data. It supports password-based accounts, as well as OAuth2-based login. Currently, Users-Service only supports GitHub authentication, but there are future plans to integrate more providers.

Users-Service utilizes JWT tokens for authentication. When a user logs in, they are provided with a JWT tokens, containing a unique identifier for that user. Thus, once a user is logged in, additional calls to Users-Service are not required. Furthermore, other services are able to authenticate and identify a user independently. While they are not able to access the full user data without calling Users-Service, they are able to store and access their own data relative to individual users. 

### Users-Service Rest-API
### Users-Service Database