# ADR-0002: Keep bounded content-addressed document history

## Status

Accepted

## Context

Writers need to inspect and recover earlier saved text without requiring Git or
polluting every workspace with an application directory. History must never make
the primary save path less reliable.

## Decision

After an atomic write succeeds, best-effort record the prior and new UTF-8 bodies
under the operating system's Viva app-data directory. Scope workspace, document,
and content with domain-separated SHA-256 keys. Deduplicate identical content,
keep at most 100 versions per document and about 256 MiB globally, and verify every
snapshot on read. Loading a version only replaces the editor draft; saving remains
an explicit ordinary document save.

## Consequences

### Positive

- History works for every local folder without Git.
- Workspace contents and filenames are not copied into sidecar directory names.
- Corrupt or unavailable history cannot break a successful document write.

### Negative

- History is device-local and is not a collaboration or backup system.
- A 256 MiB bound can prune old versions across workspaces.

## Alternatives considered

- A `.viva` folder in each workspace: rejected because it pollutes and may be committed.
- Git-only history: rejected because many writing folders are not repositories.
- SQLite: rejected because immutable content files and metadata need less machinery.
