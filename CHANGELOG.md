# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-10-26

### Added

- Somfy RTS shades of a MyLink bridge as Gladys shutters (open, close, stop)
  with a favourite position ("my") button, and MyLink scenes as buttons, on
  the local network (Synergy API, TCP port 44100).
- The assumed state of each shade on its badge (RTS gives no feedback: never
  shown as confirmed, no position).
- Stop and close ahead of the other commands, tried again within 3.5 s, then
  held in memory only (a stop never later than 8 s after the click, never
  written twice; a close tried again until about 30 s); never replayed after
  a restart; any newer click on the shade, or a MyLink scene, cancels it.
- A stop or close never cuts another stop or close in flight, even on a bridge
  slower than 1 s: it waits for that answer.
- One connection and one request at a time to the bridge; a command without
  an answer of the bridge is shown as an error, never as a success; a
  refused System ID stops the reads until it changes.
- Documentation in English and French, cover image.

[Unreleased]: https://github.com/LM1LC3N7/gladys-somfy-mylink/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-somfy-mylink/releases/tag/v0.1.1
