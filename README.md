# Somfy MyLink for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) external integration that
drives **Somfy RTS** shades through the **Somfy MyLink** bridge, on the local
network (the "Synergy" JSON-RPC API of the bridge, TCP port 44100): open,
close, stop, favourite position ("my") and MyLink scenes.

Unofficial, not affiliated with Somfy. It has **never been tested with a real
bridge** yet.

- User guide: [English](docs/en.md) · [Français](docs/fr.md)
- RTS motors give **no feedback**: Gladys shows the last command as an
  **assumed** state (badge with an orange dot), never a confirmed one, and
  there is no position.
- Stop and close go first, one request at a time, tried again within 3.5 s,
  then held in memory only, never replayed after a restart (see the
  guide for the exact cases where they are refused).
- The System ID is kept by Gladys in its database and only ever sent to the
  bridge: never logged, never in `/data`.

## Development

```bash
npm install
npm test            # node --test (simulated bridge on 127.0.0.1, sped-up real clock)
npm run lint
npm run format:check
npm run cover       # cover.png, 800×534, plain Node
```

See `CLAUDE.md` for the architecture and the rules, `TODO.md` for the state
and the decisions.

## Credits

The protocol comes from [pysomfymylink](https://github.com/sslivins/pysomfymylink)
(MIT, Stefan Slivinski), itself a rewrite of
[somfy-mylink-synergy](https://github.com/bendews/somfy-mylink-synergy) (MIT,
Ben Dews). See `THIRD_PARTY_NOTICES.md`.

## License

Apache-2.0, see `LICENSE`.
