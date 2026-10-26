# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported to JavaScript from the project below, distributed under
its own licence, whose notice is reproduced here as that licence requires.

## pysomfymylink

- Source: https://github.com/sslivins/pysomfymylink (version 1.1.0, 2026-07-19)
- Licence: MIT
- What was ported: the Somfy MyLink Synergy JSON-RPC API as that library
  speaks it (TCP port 44100, the methods `mylink.status.info`,
  `mylink.move.up`, `mylink.move.down`, `mylink.move.stop`,
  `mylink.scene.list`, `mylink.scene.run`, the System ID in `params.auth`,
  the answer matched by its id, the `keepalive` objects skipped, the error
  code -32652 of a refused System ID, one connection at a time). The
  transport of this integration (one connection with priorities, the
  cutting of the stream into objects, the deadlines) is its own:
  `src/mylink/`.

```
MIT License

Copyright (c) 2026 Stefan Slivinski

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The NOTICE file of pysomfymylink:

```
This project is a clean-room rewrite of "somfy-mylink-synergy"
Copyright (c) 2019 Ben Dews (https://github.com/bendews/somfy-mylink-synergy),
which is also MIT licensed.

The original library's public method surface informed this one; the transport
layer (connection handling, framing, and the fix for the connection-timeout
deadlock) was rewritten from scratch. Full credit and thanks to Ben Dews for
the original work and protocol reverse-engineering.
```

The original library, somfy-mylink-synergy
(https://github.com/bendews/somfy-mylink-synergy, Copyright (c) 2019 Ben
Dews, MIT licence), did the reverse engineering of the protocol; no code of
it is copied here.
