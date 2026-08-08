# Soundwave

A Discord music bot that plays from YouTube and Spotify, with a shared queue per server.

Built with TypeScript, discord.js and [Lavalink](https://lavalink.dev/). Runs in Docker from
development through production.

---

## Contents

- [How it works](#how-it-works)
- [Commands](#commands)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
  - [1. Create the Discord application](#1-create-the-discord-application)
  - [2. Create a Spotify application](#2-create-a-spotify-application)
  - [3. Configure the environment](#3-configure-the-environment)
  - [4. Authorise YouTube (important)](#4-authorise-youtube-important)
- [Running it](#running-it)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

---

## How it works

The bot itself never touches audio. It sends commands over a WebSocket to a **Lavalink**
container, which does all the extraction and streaming:

```
docker compose
├── soundwave   Node 24 / TypeScript — commands, queue logic, embeds
│     └── ws ──► lavalink:2333
└── lavalink    audio extraction and streaming
      ├── youtube-source   YouTube playback
      └── lavasrc          Spotify link resolution
```

This split is deliberate. YouTube challenges requests coming from datacenter IP ranges with
_"Sign in to confirm you're not a bot"_, which is why bots that stream YouTube directly tend to
work locally and fail once deployed to a server. The `youtube-source` plugin handles that with
client rotation and OAuth, and it is actively maintained — when YouTube changes something you
bump a plugin version instead of debugging the bot.

**A note on Spotify:** Spotify's audio is DRM-protected and cannot be streamed by any bot. When
you pass a Spotify link, the `lavasrc` plugin reads its metadata (title, artist, ISRC) and plays
the matching track from YouTube. Playlists and albums work; the audio source is YouTube.

---

## Commands

All commands are slash commands and work per-server — each server has its own independent queue.

| Command         | What it does                                      |
| --------------- | ------------------------------------------------- |
| `/play <query>` | Play a YouTube or Spotify link, or search by name |
| `/queue`        | Show the queue, with paging and a clear button    |
| `/clear`        | Remove every queued track, keep the current one   |
| `/nowplaying`   | Show the current track with a progress bar        |
| `/skip`         | Skip the current track                            |
| `/pause`        | Pause playback                                    |
| `/resume`       | Resume playback                                   |
| `/shuffle`      | Randomise the queued tracks                       |
| `/stop`         | Stop, clear the queue, and leave the channel      |

`/play` accepts:

- a search phrase — `/play never gonna give you up`
- a YouTube video or playlist URL
- a Spotify track, album, or playlist URL

You must be in a voice channel to use the playback commands. The bot leaves automatically once
it is left alone in a channel, or after the queue has been empty for `IDLE_TIMEOUT_MINUTES`.

`/clear` and `/stop` are easy to confuse: `/clear` empties the queue but keeps playing the
current track, while `/stop` also stops playback and disconnects. `/queue` carries a **Clear
queue** button that does the same as `/clear`, usable only by whoever ran the command and only
while they are still in the voice channel.

---

## Prerequisites

- Docker and Docker Compose
- A Discord application with a bot user
- Node 24 and Yarn, only if you want to run tooling outside Docker

---

## Setup

### 1. Create the Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create
   an application.
2. Under **Bot**, click **Reset Token** and copy it — this is `DISCORD_TOKEN`.
3. Copy the **Application ID** from **General Information** — this is `DISCORD_CLIENT_ID`.
4. No privileged intents are needed. The bot reads no message content.
5. Under **OAuth2 → URL Generator**, tick `bot` and `applications.commands`, then grant
   **Connect**, **Speak**, **Send Messages** and **Embed Links**. Use the generated URL to invite
   the bot.

### 2. Create a Spotify application

Only needed if you want Spotify links to work.

Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), create an app,
and copy the Client ID and Client Secret into `.env`.

> **The account that owns the app must have Spotify Premium.** Without it the Web API returns
> `403 Active premium subscription required for the owner of the app`, and every Spotify link
> fails. Creating the app is free, but the API is not usable on a free account. After a
> subscription change Spotify can take a few hours to start allowing requests.

Everything else keeps working without Spotify — searching by name and YouTube links are
unaffected.

### 3. Configure the environment

```bash
cp .env.example .env
```

Fill in `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and a `LAVALINK_PASSWORD` of your choosing. Set
`DISCORD_DEV_GUILD_ID` to your test server's ID during development so slash commands register
instantly instead of taking up to an hour to propagate globally.

### 4. Authorise YouTube (important)

This is what keeps playback working on a server. Leave `YT_REFRESH_TOKEN` empty for the first
run, then:

```bash
docker compose up lavalink
```

Watch the logs for a block like this:

```
!!! DO NOT AUTHORISE WITH YOUR MAIN ACCOUNT, USE A BURNER !!!
OAUTH INTEGRATION: To give youtube-source access to your account,
go to https://www.google.com/device and enter code XXXX-XXXX
```

Visit that URL, enter the code, and authorise.

> **Use a throwaway Google account.** The plugin's own documentation warns that accounts used
> this way can be terminated. Never use your primary account.

Lavalink then logs a refresh token. Copy it into `.env` as `YT_REFRESH_TOKEN` and restart. The
token is long-lived, so this is a one-time step.

Playback still works without this — the other YouTube clients need no authentication — but
authorising makes the bot considerably more resilient on a VPS and unlocks age-restricted
tracks.

---

## Running it

### Development, with hot reload

```bash
docker compose up --build
```

`compose.override.yaml` is merged automatically: it bind-mounts `src/`, runs the bot under
`tsx watch`, and restarts on save without rebuilding the image. Lavalink's port is published on
`localhost:2333` for debugging.

### Production

```bash
docker compose -f compose.yaml up -d --build
```

Passing `-f compose.yaml` explicitly is what skips the development override. Without it you get
hot reload and bind mounts in production.

Check on it with:

```bash
docker compose -f compose.yaml logs -f soundwave
docker compose -f compose.yaml ps
```

Lavalink downloads its plugin JARs on first boot, which takes a minute or so. The bot waits for
Lavalink to report healthy before starting, and retries the connection for about 50 seconds
after that.

---

## Deployment

A single workflow, `.github/workflows/ci.yml`, runs three jobs in sequence:

| Job      | Runs on            | What it does                                                                                                                                      |
| -------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify` | every PR and push  | format check, lint, typecheck, tests                                                                                                              |
| `image`  | every PR and push  | builds the image, then boots it with an empty environment to prove it fails with a readable config error; pushes to the registry only outside PRs |
| `deploy` | pushes to `master` | ships config, renders `.env`, pulls, restarts, verifies                                                                                           |

Pull requests stop after `image`. The image is built **once** and the same bytes that were
smoke-tested are the ones pushed — the push step retags the local image rather than rebuilding.

Images go to a shared registry project rather than to Soundwave's own, one repository per
application:

```
southamerica-east1-docker.pkg.dev/core-platform/soundwave/soundwave
```

They are tagged with the commit SHA and `latest`.

The deploy performs no registry login on the VPS. Artifact Registry hostnames are per-region
rather than per-project, so the VPS holds a single credential for that host and logging in
again would replace the one other services depend on. Read access comes from IAM instead: the
VPS is granted Artifact Registry Reader once at the **project** level, which covers every
repository added later. Setup is in
[docs/artifact-registry-access.md](docs/artifact-registry-access.md).

Concurrency is set per job rather than per workflow: superseded `verify` runs are cancelled,
but `deploy` never is — cancelling between `mv .env.staged .env` and the end of `up -d` would
leave the VPS in a half-applied state.

**The VPS holds no git checkout.** Each deploy ships `compose.yaml` and
`lavalink/application.yml` from the commit being deployed, so the running configuration can
never drift from the running image. `.env` is rendered on the VPS from the repo secrets on
every run, which makes GitHub the source of truth — a value hand-edited on the box is
reverted by the next deploy.

> One consequence worth remembering: if you re-authorise YouTube on the VPS, update the
> `YT_REFRESH_TOKEN` secret too, or the next deploy will overwrite it.

### Required repository secrets

| Secret                  | Purpose                                            |
| ----------------------- | -------------------------------------------------- |
| `GCP_PROJECT_ID`        | The shared registry project (`core-platform`)      |
| `GCP_SA_KEY`            | SA key, Artifact Registry Writer on `soundwave`    |
| `VPS_HOST`              | VPS hostname or IP                                 |
| `VPS_USER`              | SSH user                                           |
| `VPS_SSH_KEY`           | Private deploy key                                 |
| `VPS_SSH_KNOWN_HOSTS`   | Output of `ssh-keyscan <host>` — pins the host key |
| `DISCORD_TOKEN`         | Bot token                                          |
| `DISCORD_CLIENT_ID`     | Application ID                                     |
| `LAVALINK_PASSWORD`     | Shared between the bot and Lavalink                |
| `SPOTIFY_CLIENT_ID`     | Optional, but must be set together with the secret |
| `SPOTIFY_CLIENT_SECRET` | Optional, but must be set together with the ID     |
| `YT_REFRESH_TOKEN`      | Optional; the workflow warns when it is missing    |

Optional repository **variables**: `LOG_LEVEL` (default `info`) and `IDLE_TIMEOUT_MINUTES`
(default `5`).

The VPS needs Docker with the Compose plugin and a writable home directory; the stack is
deployed to `~/soundwave`.

### What the deploy verifies

`docker compose up --wait` only gates on Lavalink's healthcheck — the bot declares none, so
`--wait` settles for "running" and would happily green-light a crash-looping container. Two
further checks close that gap:

1. **Restart-counter dwell** — the counter is sampled, the job waits, and samples again. A
   bot that is crash-looping on a bad token changes the count and fails the deploy.
2. **Readiness assertion** — the job waits for `Soundwave is ready` in the container logs.
   That line is only reached after the gateway connection, the Lavalink handshake, and the
   slash-command deploy have all succeeded, so it covers everything a running-but-broken bot
   would otherwise hide.

### Rollback

Run the **CI** workflow manually and give it a previous commit SHA as the tag. That skips the
build entirely and redeploys the existing image. The previously deployed tag is also on the
VPS in `~/soundwave/.env.prev`.

---

## Troubleshooting

**"Sign in to confirm you're not a bot", or every track fails on the server**

This is YouTube challenging your server's IP. In order:

1. Complete [the OAuth step](#4-authorise-youtube-important) if you skipped it.
2. Bump the `youtube-plugin` version in `lavalink/application.yml` — fixes ship there, and
   the pinned version ages.
3. If the VPS has an IPv6 `/64` block, add a `ratelimit` section to `lavalink/application.yml`
   to rotate outbound addresses.

Note that `clients` in `lavalink/application.yml` must include `TV` for OAuth to have any
effect — it is the only OAuth-capable client. Lavalink warns about this at startup if you
remove it.

**The bot is online but every command errors**

Lavalink is probably not reachable. Check `docker compose ps` and confirm the container is
healthy, and that `LAVALINK_PASSWORD` matches in both services.

**Slash commands do not appear**

Set `DISCORD_DEV_GUILD_ID` for instant per-server registration. Global commands can take up to
an hour to appear. Confirm you invited the bot with the `applications.commands` scope.

**Spotify links do not resolve**

Check the Lavalink logs for the underlying cause — the message the bot shows is deliberately
generic. Three distinct failures look identical from Discord:

1. `403 Active premium subscription required for the owner of the app` — the account owning
   the Spotify app has no Premium subscription. Nothing to fix in the bot.
2. `Failed to retrieve secret from Spotify` — LavaSrc fell back to anonymous tokens because
   the client credentials were missing or empty. Confirm they actually reached the container:
   `docker compose exec lavalink printenv SPOTIFY_CLIENT_SECRET`.
3. `Spotify generated playlists are no longer accessible via anonymous tokens` — same root
   cause as 2, seen on editorial playlists such as Today's Top Hits.

To check the credentials independently of Lavalink:

```bash
curl -s -X POST https://accounts.spotify.com/api/token \
  -d "grant_type=client_credentials&client_id=$SPOTIFY_CLIENT_ID&client_secret=$SPOTIFY_CLIENT_SECRET"
```

**Deploy fails with `Host key verification failed` / `No ED25519 host key is known`**

That message means `known_hosts` held **no entry at all** for the host — most often because
`VPS_SSH_KNOWN_HOSTS` is not set in this repository. GitHub secrets are per-repository, so one
configured for another project does not apply here; only organization-level secrets are shared.

The second cause is a host mismatch: the entry has to match the exact value in `VPS_HOST`,
and a hostname and its IP are separate entries.

```bash
ssh-keyscan your-vps-host
```

Paste the output into the secret. On a non-default port use `ssh-keyscan -p 2222 host`, which
produces `[host]:2222 …` entries. Host keys are public, so capturing all of them is safe.

The `Configure SSH` step fails with a named error when the secret is empty, and otherwise
reports how many entries were pinned and which key types they cover.

**Deploy fails on the VPS with `artifactregistry.repositories.downloadArtifacts denied`**

The push from GitHub and the pull on the VPS authenticate as different identities — the
service account in `GCP_SA_KEY` never touches the VPS. This error means the identity the VPS
uses cannot read the image, so a successful push tells you nothing about whether the pull will
work. See [docs/artifact-registry-access.md](docs/artifact-registry-access.md).

Note that Artifact Registry returns `denied` rather than `not found` for resources you cannot
see, so a wrong `GCP_PROJECT_ID` produces exactly the same message.

**Changes to `.env` are not taking effect**

`docker compose restart` reuses the existing container and its baked-in environment. Use
`docker compose up -d` instead, which recreates a container whose configuration has changed.

---

## Development

```bash
yarn install
yarn dev            # run locally against a Lavalink container
yarn test           # run the test suite
yarn test:watch     # watch mode
yarn lint           # ESLint
yarn typecheck      # tsc --noEmit
yarn format         # Prettier
yarn build          # compile to dist/
```

### Layout

```
src/
  index.ts        entry point
  config/         env parsing and validation
  core/           Bot, command and event registries, DI container
  commands/       one class per slash command
  events/         Discord gateway handlers
  music/          Lavalink service, per-guild players, track resolution
  ui/             embed construction and formatting
  logging/        structured logging
  errors/         error hierarchy and the central handler
lavalink/
  application.yml Lavalink and plugin configuration
tests/            Vitest suites
```

### Adding a command

Create a class in `src/commands/` extending `Command`, then register it in
`src/core/Container.ts`. It is picked up and deployed automatically on the next start.

Commands should not catch their own errors — throw a `UserFacingError` (or a subclass) and the
central `ErrorHandler` turns it into a friendly ephemeral reply. Anything else is logged with a
full stack and answered with a generic message.
