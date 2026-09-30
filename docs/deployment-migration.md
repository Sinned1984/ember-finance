# Existing installation: Bloom service to Ember

The active service and Linux user/group are now `ember`. UID/GID remain **1001**;
the mount remains `/var/lib/ember-auth`, and its Compose volume key remains
`ember-auth-state`. There is deliberately no new top-level Compose project name.
Changing the directory or project name can still select a different volume.
Do not start the new service until the existing volume is identified and backed
up. Never use `docker compose down -v`, remove volumes, or reset TOTP to migrate.

## Identify the existing installation before replacing its Compose file

Run from the old source directory with its original project name and any original
override flags. The examples below assume the original base file; retain your
actual flags. These commands inspect only the project label and relevant mount,
not the container environment or complete inspect output.

```sh
old_container=$(docker compose ps -a -q bloom)
test -n "$old_container" || { echo 'Old service not found; stop and inspect your project selection.'; exit 1; }
old_project=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$old_container")
auth_volume=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/ember-auth"}}{{if eq .Type "volume"}}{{.Name}}{{end}}{{end}}{{end}}' "$old_container")
test -n "$old_project" && test -n "$auth_volume" || { echo 'Project or named auth volume not verified; stop.'; exit 1; }
docker volume inspect --format '{{.Name}}' "$auth_volume"
```

If the old service does not exist, the mount is a bind mount, or more than one
matching container is returned, stop and resolve the actual deployment first.
Do not guess a volume from a directory name. Record the verified project and
volume names securely. Keep the existing username, password hash and
**EMBER_AUTH_SECRET**; the existing secret decrypts enrolled TOTP state.

Stop the old service before backup and before starting the new service:

```sh
docker compose stop bloom
umask 077
backup_dir="$HOME/ember-auth-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -m 700 "$backup_dir"
cp -p .env "$backup_dir/environment.env"
docker run --rm --user 1001:1001 --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --mount "type=volume,src=$auth_volume,dst=/state,readonly" \
  alpine:3.23 tar -C /state -czf - . > "$backup_dir/auth-state.tar.gz" \
  || { echo 'Auth backup failed; stop before migration.'; exit 1; }
chmod 600 "$backup_dir/environment.env" "$backup_dir/auth-state.tar.gz"
test -s "$backup_dir/auth-state.tar.gz"
```

The helper reads only the verified Ember auth volume as its existing UID/GID
1001, without capabilities, network or Firefly credentials. Shell redirection
writes the archive as your host user in the protected directory. The backup is
outside the checkout; retain it in
your secure backup location. Verify the archive contents locally without
printing state/secrets. An empty state directory may be legitimate for a user
who never enrolled; investigate unexpected emptiness before proceeding.

## Start the new service using that exact volume

Obtain the new source while retaining private `.env` and backups. Update any
custom override from `services: bloom` to `services: ember`. Preserve other
network settings; if an existing Docker proxy used the old DNS service name,
change its upstream to `ember:3000`. Host-IP/port proxy configurations can remain.

Add `EMBER_AUTH_STATE_VOLUME` to `.env` with the **verified** volume name; do not
copy an example name. Export the same value for these commands:

```sh
export EMBER_AUTH_STATE_VOLUME="$auth_volume"
docker compose -p "$old_project" -f compose.yaml -f compose.auth-state.yaml config --quiet
docker compose -p "$old_project" -f compose.yaml -f compose.auth-state.yaml build --pull ember
docker compose -p "$old_project" -f compose.yaml -f compose.auth-state.yaml up -d --wait --wait-timeout 120
docker compose -p "$old_project" -f compose.yaml -f compose.auth-state.yaml exec -T ember node scripts/healthcheck.mjs
```

The override sets `external: true` and an explicit volume name. Compose refuses
to start if that volume does not exist; it cannot silently create fresh auth
state. Retain the override and project selection in **every** later lifecycle,
update, reset and backup command. When choosing bundled HTTPS, add
`-f compose.https.yaml` between the base and auth-state files, satisfy its DNS/port
prerequisites, and use the same volume pin. Switching modes must keep this pin.

Verify the recreated service mounts the recorded volume:

```sh
new_container=$(docker compose -p "$old_project" -f compose.yaml -f compose.auth-state.yaml ps -q ember)
actual_volume=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/ember-auth"}}{{.Name}}{{end}}{{end}}' "$new_container")
test "$actual_volume" = "$auth_volume" || { echo 'Auth volume mismatch; stop Ember and investigate.'; exit 1; }
```

Through the real HTTPS origin, confirm existing password login still requires
the enrolled TOTP code and a fresh code succeeds. Old sessions are expected to
be invalid after recreation. Check account/transaction pages and health. If a
previously enrolled user receives password-only access, stop Ember and restore
the verified volume/secret rather than enrolling into an unintended new state.
Do not run old and new Ember processes against the same state concurrently.

Only after successful verification, remove the **stopped old container** by its
recorded ID:

```sh
docker rm "$old_container"
```

Do not add `-v` or use blanket orphan/volume cleanup. For rollback, stop the new
service, restore the old source/configuration, select the same project and volume,
then start the old service. Keep the backup and original secret. No Firefly data
is migrated or modified.

## Restore and ownership

Restore the backed-up encrypted state and its matching private environment
together while Ember is stopped. Preserve UID/GID 1001, mode 0700 on the directory
and 0600 on state files. Do not make the directory world-readable or generate a
new secret as a workaround. If restoring on another host, create/restore the
volume deliberately using your backup tooling and pin its verified name with
the external-volume override before starting Ember. Test restoration in an
isolated environment first. An intentional authenticator reset uses the
host-admin command in [installation](../README.md#updates-backups-and-recovery), not volume deletion.
