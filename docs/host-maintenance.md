# Production Host Log Maintenance

Use **Actions > Host Log Maintenance > Run workflow** with the trusted production
branch. No personal SSH access or Docker image build is needed. The workflow uses
the existing `DEPLOY_HOST` and `DEPLOY_SSH_KEY` secrets as root. Only trusted
maintainers should be allowed to dispatch workflows or change their code.

## Actions

| Action | Inputs | Effect |
| --- | --- | --- |
| `inspect` (default) | `backend` (default) or `mongodb`; confirmation empty | Read-only Docker/filesystem inspection: selected IDs, running state, active JSON log bytes, logging driver/limits, filesystem capacity/free bytes. No log contents. |
| `clear` | One service; confirmation exactly `CLEAR_LOGS` | Emergency only. Stop the selected container if running, save up to the last 64 KiB, truncate only its validated active JSON log, restart it if originally running. Brief outage. |
| `apply-rotation` | One service; confirmation empty | Write the logging override and recreate only that service with the existing local image, without building, pulling, or recreating dependencies. This starts a previously stopped service. Brief outage. |

The workflow and script both validate inputs. Missing containers are reported by
inspect; mutation requires exactly one existing container. Unknown services,
actions, mismatched Compose identities, and ambiguous selections fail closed.
No host-wide prune, wildcard truncation, volume deletion, `down -v`, Docker socket
mount, or privileged web endpoint is involved.

## Disk-Full Recovery

1. Run `inspect` separately for `backend` and `mongodb` to identify the large log.
2. Run `clear` for just the affected service, entering `CLEAR_LOGS` explicitly.
3. Check the run result and run `inspect` again. A restart failure is an error, even
   if truncation succeeded. Both clear and restart failures are reported.
4. Run `apply-rotation` for that service after freeing disk space. Repeat for the
   other service if needed; normal backend deploys also apply the override.

The script and SCP temporary archive go to the private, root-owned
`/dev/shm/goodroad-maintenance` directory. Bounded tail snapshots stay on the server
in `/dev/shm/goodroad-log-tails` (directory `0700`, each file `0600`), never in Actions
output or artifacts. Each clear saves at most 64 KiB; filenames include the full
container ID. Snapshots may contain secrets. They accumulate until a host admin
removes them or the server reboots, and are not durable backups. `/dev/shm` is
normally RAM-backed, so a full root/Docker filesystem does not prevent transfer
or tail capture. A full `/dev/shm`, unavailable SSH/Docker daemon, or missing host
Python 3 still requires an infrastructure administrator. If saving the tail fails,
the script refuses to truncate and attempts to restart the original container.

Clearing is deliberately restricted to Docker's inspected `json-file` `LogPath`:
absolute canonical path, full 64-character container ID directory and filename,
regular file, no symlink or hardlink. Container discovery always uses
`docker compose -f /opt/goodroad/docker-compose.yaml ps -a -q SERVICE`, not a
hardcoded container name or host-wide search. The container is re-inspected after
stopping and the file descriptor is checked before truncation. Only the active
log is truncated, not rotated siblings, volumes, journals, or other applications.
Stopping first avoids truncating while the application writes, but this remains
an emergency intervention in Docker-managed files, not routine log management.

Restart is attempted in `finally`, including on handled interrupt/termination
signals. Do not cancel a clear run. A host crash, SIGKILL, or lost SSH session can
prevent recovery; inspect afterwards and involve the host administrator if the
service is stopped. Automatic recovery cannot be guaranteed in those cases.

## Rotation And Deploy

The script reads the **production** base configuration using
`docker compose -f /opt/goodroad/docker-compose.yaml config --format json`.
It atomically writes `/opt/goodroad/docker-compose.logging.yaml` as JSON-compatible
YAML, containing only `backend` and `mongodb` services actually present in that
configuration. Each gets `json-file`, `max-size: "10m"`, and `max-file: "3"`.
The base file is not replaced by the repository's development Compose file.
Writing the override alone does not change existing containers.

Manual rotation uses both files with `up -d --force-recreate --no-deps --no-build
--pull never SERVICE`. MongoDB recreation requires an existing writable `/data/db`
named volume or persistent bind mount matching the production Compose definition.
Anonymous volumes, tmpfs, missing/mismatched mounts, and read-only mounts are
rejected before writing/recreating. Back up production data through the normal
database backup process before planned MongoDB maintenance. No volumes are deleted.

Deploy keeps its existing image-tag update in the production base, creates the
logging override, and brings up only `backend` with both files. It no longer clears
logs or prunes images/build caches. SHA input travels through environment variables
and is hex-validated before SSH transport. Backend deploy and manual backend
rotation poll `/ready` inside the container for up to 120 seconds, requiring HTTP
200 **and** JSON `status == "ready"`; a timeout fails without dumping application
logs. A rollback image that lacks `/ready` will fail this check.
MongoDB rotation also waits up to 120 seconds for a successful `mongosh` ping;
a stopped/missing container or a ping timeout fails the workflow.

When the disk is already full, run the manual recovery workflow before deployment.
It does not pull a new image. The dashboard's **Host Maintenance** link opens this
workflow; the old public `/api/admin/clear-logs` endpoint now returns HTTP 410 and
never accesses host logs. These changes take effect only after publishing the
workflows and deploying the updated backend.

Both workflows share the `goodroad-production-host` concurrency group with
`cancel-in-progress: false`. A running deploy or maintenance job is never
automatically cancelled by the other. GitHub can replace an older *pending* run
with a newer pending run; this is not a FIFO queue. External/manual host commands
are not covered by the Actions concurrency group.

## Local Tests

```sh
python -m unittest tests.test_host_maintenance -v
```

Tests use a fake Docker command runner and temporary log/config files. No Docker
daemon, SSH, production action, backend dependencies, or image build is needed.
Run on Linux to exercise native descriptor permissions and symlink/hardlink
checks; Windows uses shims for unavailable Linux APIs and skips the link test.
Workflow structure checks run when PyYAML is installed and otherwise skip.
