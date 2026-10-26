# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.
It drives Somfy RTS shades through the Somfy MyLink bridge and its local
"Synergy" JSON-RPC API on TCP port 44100 (protocol ported from pysomfymylink,
MIT).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "stop"    # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run cover                             # cover.png (800×534) in plain Node
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only (src/handlers.js registers before connect())
src/app.js                        MyLinkApp: reads, commands, order rules, holds, badges, status
src/mylink/link.js                one TCP connection at a time, priorities, deadlines
src/mylink/protocol.js            requests, stream cut into objects (bounded), answers, lists (pure)
src/devices.js                    shades and scenes -> Gladys devices, ids (pure)
src/store.js                      /data/somfy-mylink-state.json (never the System ID)
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/constants.js                  keys, methods, limits, timings
src/i18n.js                       texts in English and French
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
scripts/cover.mjs                 generates cover.png
test/                             node --test, against the SDK's fake Gladys and a simulated
                                  bridge on 127.0.0.1, on a sped-up REAL clock
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Safety rules of this integration

- RTS gives no feedback: never publish a state or a position as a fact, never
  claim a command "confirmed". The badge says "assumed".
- A shade is a `shutter`, the favourite position and the scenes are
  `button/push`: never `switch`/`binary`.
- STOP and CLOSE depend on no option, no read, no refused-System-ID marker:
  they go ahead on the link, cut a read, cut a connection silent for 1 s
  (the new one opens only after the old one closed), are tried again every
  250 ms within 3.5 s, then held (retries at 2, 5, 10 s; a STOP never later
  than 15 s after the click: at rest it is the "my" button).
- Every command is numbered at its arrival: an older one never leaves after a
  newer stop or close of its shade; a newer one written drops a held one.
- A command whose bytes may have left is never "not sent".
- One clock read per decision (`dueAt(mono)`); pauses and deadlines on the
  monotonic clock, the wall clock only for /data.
- The System ID only goes into the bytes of a request: never in a log, a
  status, an error, /data. Never a wildcard target (`*.*`) from an external id.

## Rules

- **External ids are forever.** `shade:<targetID>`, `scene:<sceneID>` (see
  src/devices.js). The same goes for every key users store: manifest
  `config_schema`, `actions`, feature keys.
- **A device published again never loses a feature.**
- **The container rootfs is read-only.** Write only under `/data`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree (never a pinned value).
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md`. Never write a version heading.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`.
  The catalog `description` holds 10 to 100 characters per language. Gladys
  keeps a secret in clear in its database: never write otherwise.
- **User-facing text** is bilingual (English and French), kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (loopback only). No Bluetooth.
