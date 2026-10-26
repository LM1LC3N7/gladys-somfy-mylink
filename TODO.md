# TODO — Somfy MyLink

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test` (Node
  22 and 24), `npm run audit`, `npx github:GladysAssistant/integration-store .`,
  then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only. No forum post from a module session (one post per wave in /t/10385).

## Status

- [x] **Milestone 1 — core** (2026-10-26): Synergy JSON-RPC over TCP 44100
      (pysomfymylink), stream cut into objects (bounded, one pass), one
      connection at a time with priorities (protective, commands, reads),
      shades as shutters (state + favourite button), scenes as buttons,
      assumed state on the badges, stop and close ahead of everything with
      retries and holds, order rules, refused System ID kept as an 8-bit
      marker, reads paced and kept in /data, en/fr, docs, cover. Tested
      against a simulated bridge on 127.0.0.1 only.
- [ ] **Milestone 2 — real bridge**: run against a real MyLink and compare
      with the app (see "To check"); turn the answers (anonymized) into
      fixtures.
- [ ] **Milestone 3 — more**: per-shade "reversed" option (Home Assistant has
      one), several bridges, a "stop all" only if asked (never the wildcard
      from an external id).
- [ ] **Milestone 4 — first release**: Docker image build check, Release
      workflow, topic, GHCR package public.

## To check on a real bridge

- Whether the bridge accepts a request written before the answer to the
  previous one on the same connection (the link writes the next command after
  the answer or 400 ms after the previous write, and a stop at once). If not,
  the pipelining must go and a scene of five shades needs another answer.
- How long the bridge takes to answer a move and `status.info` (pysomfymylink
  says 1 to 2 s for the list); whether it closes the socket after each answer.
- The exact format of the `targetID` (bridge id, a dot, the channel) and of
  the `sceneID` (number or string); the `type` values (0 blind, 1 shutter).
- The answer of `mylink.scene.list` on a bridge without scenes, and of a move
  to an unknown `targetID` (error code).
- Whether the System ID ever contains a space (refused for now).

## Decisions

- **Version 0.1.0 set by hand** (package.json, package-lock.json, manifest,
  `docker_image` tag) for the first milestone, as the lot asks; from now on the
  Release workflow owns it (the first patch release gives 0.1.1).
- **SDK `^0.15.0`**: 0.16.0 is not published yet (`npm view` on 2026-10-26
  gives 0.15.0); migration planned when it is (types ai/tts/music only,
  nothing breaking).
- **No "confirmed" command**: RTS gives no feedback and the bridge only
  acknowledges, so the rule "a command succeeds only after a read showing it"
  cannot apply. A command is "accepted by the bridge" (its answer) or "sent,
  without answer"; the badge shows the assumed state; no position feature;
  `has_feedback: false` (Gladys keeps the last command as the value: the docs
  say it is the last command, not a measure).
- **Held STOP limited to 15 s** after the click, instead of "held and re-sent
  by the next read": on an RTS motor at rest, stop is the "my" button and
  would move the shade to its favourite position. A held CLOSE (harmless when
  repeated) is kept in /data for two minutes and survives a restart. Retries
  at 2, 5 and 10 s after the deadline rather than at the next read (the read
  interval is 60 s to 1 h).
- **Favourite position** is a `button/push` sending `mylink.move.stop` (the
  same RTS order as stop): an ordinary command (one try, cancelled by a newer
  stop or close), not a protective one.
- **Protective commands are sent even with a refused System ID marker** (one
  local bridge, no lockout to fear, and the marker may be a 1-in-256
  collision); the opens, favourites and scenes are refused.
- **Identity**: the System ID is checked by the bridge on every request and
  the `targetID` starts with the id of the bridge, so a DHCP swap to another
  bridge answers "Invalid auth" or "unknown target". Opens need the shade in
  the list read (kept in /data); stop and close need nothing.
- **One connection at a time, written in order**: protective at once, other
  commands after the previous answer or 400 ms, reads only on an idle link and
  cut by any command (a cut read is not a failure and waits for the next
  interval). A connection silent for 1 s with requests waiting is cut before
  the next command; a new connection opens only after the old one closed.
- **Reads**: the list of shades and scenes only (no state exists), every
  60 s to 1 h (300 s by default); Test, Scan and a new configuration at most
  once a minute; the time of the last read written to /data BEFORE the read.
- **Refused System ID**: 8 bits of its SHA-256 in /data (a brute force gives
  hundreds of candidates); cleared by a successful read (Test button) or a
  different System ID.
- **Category** `appliances` (like the other shade integrations).
- **Store fields for Gladys >= 5.3.0** (not set yet, the manifest stays
  `>=5.1.0`): `keywords` somfy, mylink, rts, volet, store, shutter, blind,
  synergy; `countries` FR, BE, CH, DE, NL, GB, US.
