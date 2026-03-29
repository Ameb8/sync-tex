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

In order to ensure consistent states between users, Collab-Service provides an initial seed state for connecting users. When the first user connects to a document, Collab-Service fetches the Yjs-formatted state of a document. This is done by fetching a presigned download URL from Projects-Service, then downloading the file. It is the responsibility of Projects-Service to ensure the download URL links to the Yjs binary version of the document. This document is sent as-is to the first connecting user. However, as new users join, the initial document state no longer suffices, as it has been edited. To handle this, Collab-Service keeps a log of all edits applied to the document. These updates can then be sent to connecting users, ensuring they have the most up-to-date version. When all users disconnect on a given document, these changes will be uploaded to filestore and evicted from Collab-Service memory. 

In order to avoid saving collisions and mismatching document states, clients do not save documents when editing collaboratively. Instead, Collab-Service is responsible for document persistence. Collab-Service utilizes configurable debounce saving, as well as ensuring a final upload when all users disconnect from a given document. The saved document will be in Yjs-binary form. It may be compacted into a more memory-efficient format, but this is not Collab-Service's responsibility. 


## Users-Service

Users-Service allows the system to authenticate users, as well as storing and managing user-centric data. It supports password-based accounts, as well as OAuth2-based login. Currently, Users-Service only supports GitHub authentication, but there are future plans to integrate more providers.

Users-Service utilizes JWT tokens for authentication. When a user logs in, they are provided with a JWT tokens, containing a unique identifier for that user. Thus, once a user is logged in, additional calls to Users-Service are not required. Furthermore, other services are able to authenticate and identify a user independently. While they are not able to access the full user data without calling Users-Service, they are able to store and access their own data relative to individual users. 

### Users-Service Rest-API
### Users-Service Database