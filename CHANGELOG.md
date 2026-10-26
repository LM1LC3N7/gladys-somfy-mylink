# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Somfy RTS shades of a MyLink bridge as Gladys shutters (open, close, stop)
  with a favourite position ("my") button, and MyLink scenes as buttons, on
  the local network (Synergy API, TCP port 44100).
- The assumed state of each shade on its badge (RTS gives no feedback: never
  shown as confirmed, no position).
- Stop and close ahead of everything, tried again within 3.5 s, then held
  (a held close survives a restart; a held stop is dropped after 15 s).
- One connection at a time to the bridge; a scene of five shades fits the
  deadlines; a refused System ID stops the reads until it changes.
- Documentation in English and French, cover image.
