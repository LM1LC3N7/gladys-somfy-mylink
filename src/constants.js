// -----------------------------------------------------------------------------
// Keys shared with the manifest (frozen: users store them in their
// configuration), the vocabulary of the MyLink bridge and the tuning of the
// integration.
// -----------------------------------------------------------------------------

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

/** Manifest `actions` keys. */
export const ACTIONS = {
  TEST: 'test_connection',
};

/** Languages of the feature names (manifest `language` options). */
export const LANGUAGES = ['fr', 'en'];

/** Bounds of the read interval (seconds), mirrored by the manifest. */
export const POLL_INTERVAL = { min: 60, max: 3600, default: 300 };

/**
 * The Somfy MyLink "Synergy" API (pysomfymylink, MIT, the library of the Home
 * Assistant integration): JSON-RPC objects over a plain TCP socket on port
 * 44100, every request carrying the "System ID" of the bridge in
 * `params.auth`. The bridge accepts one connection at a time, sends
 * `{"keepalive": …}` objects between the answers and drops idle sockets.
 */
export const BRIDGE = {
  port: 44100,
};

export const METHODS = {
  INFO: 'mylink.status.info',
  UP: 'mylink.move.up',
  DOWN: 'mylink.move.down',
  STOP: 'mylink.move.stop',
  SCENES: 'mylink.scene.list',
  RUN: 'mylink.scene.run',
};

/** JSON-RPC error codes of a refused System ID (pysomfymylink: seen on real bridges). */
export const AUTH_ERROR_CODES = new Set([-32652]);

/** The feature keys (frozen: the external ids end with them). */
export const FEATURES = {
  STATE: 'state',
  FAVORITE: 'favorite',
  RUN: 'run',
};

/** Gladys COVER_STATE values (shutter `state`). */
export const COVER_STATE = { STOP: 0, OPEN: 1, CLOSE: -1 };

/** Gladys BUTTON_PUSH.PRESSED: the one value of a `button/push` command. */
export const PRESSED = 1;

/** The commands of the integration (what the assumed state remembers). */
export const COMMANDS = {
  OPEN: 'open',
  CLOSE: 'close',
  STOP: 'stop',
  FAVORITE: 'favorite',
  SCENE: 'scene',
};

/** Stop and close: the protective commands (never queued behind anything). */
export const PROTECTIVE = new Set([COMMANDS.STOP, COMMANDS.CLOSE]);

export const LIMITS = {
  /** One JSON object of the bridge (the list of 64 shades is a few KB). */
  objectBytes: 64 * 1024,
  /** Bytes read on one connection, all objects and keepalives together. */
  connectionBytes: 512 * 1024,
  /** Shades and scenes of one bridge taken into account. */
  shades: 64,
  scenes: 64,
  /** Characters of a name read from the bridge kept in Gladys. */
  name: 60,
  /** Characters of a transport badge message (SDK limit). */
  badgeMessage: 200,
  /** Commands waiting for the bridge (not counting the protective ones, one per shade). */
  queue: 32,
  /** Characters of a System ID. */
  systemId: 64,
};

export const TIMINGS = {
  /** TCP connection to the bridge. */
  connectTimeout: 3 * SECOND,
  /**
   * An answer of the bridge to a request written (the bridge answers in
   * order: the fifth of five requests waits for the four before it).
   */
  replyTimeout: 8 * SECOND,
  /**
   * A read (list of shades and scenes) waits at most this long for its
   * answers; it is cut at once by any command.
   */
  readTimeout: 6 * SECOND,
  /**
   * A connection whose requests got no byte for this long is cut before a
   * protective command, which then opens a new one (after the old one is
   * closed).
   */
  staleAfter: SECOND,
  /**
   * The next command is written after the answer to the previous one, or
   * this long after it at most (a scene of five shades with slow answers
   * still fits the deadlines; the bridge handles them in order).
   */
  pipelineAfter: 400,
  /** A connection with nothing to send nor to wait for is closed this long after. */
  idleClose: 100,
  /**
   * Gladys acks a set_value within 5 s: a command not written within 3.5 s
   * of its arrival is refused, never sent late; its answer is awaited until
   * 4.3 s.
   */
  commandSendBy: 3500,
  commandAnswerBy: 4300,
  /** A protective command that could not be written is tried again this often within its budget. */
  protectiveRetry: 250,
  /**
   * A protective command still not written at its deadline is held and
   * tried again at these delays after the deadline (3 times at most).
   */
  holdRetries: [2 * SECOND, 5 * SECOND, 10 * SECOND],
  /** Budget of one of those tries. */
  holdTryBudget: 3 * SECOND,
  /**
   * A held STOP is dropped this long after the click: on an RTS motor at
   * rest, "stop" is the "my" button and moves the shade to its favourite
   * position, so a late STOP is a move nobody asked for.
   */
  stopHoldMax: 15 * SECOND,
  /** A held CLOSE (harmless when repeated) survives a restart for this long. */
  closeHoldMax: 2 * MINUTE,
  /** The last read time is written to /data at most this often. */
  attemptPersistEvery: MINUTE,
  /** "Test the connection" and a changed configuration read at most this often. */
  testGap: MINUTE,
  /** getConfig() failed at the start: tried again this often, without end. */
  configRetry: 30 * SECOND,
};
