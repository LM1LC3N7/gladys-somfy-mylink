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

/** Stop and close: the protective commands (ahead of every other command). */
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
   * ONE request in flight per connection (pysomfymylink does the same: a
   * bridge that reads everything waiting on its socket at once may drop
   * requests glued together). An ordinary command waits this long for its
   * answer.
   */
  replyTimeout: 2500,
  /**
   * A protective command waits this long for its answer; a CLOSE without an
   * answer is written again on a new connection within its budget.
   */
  protectiveReplyTimeout: 1500,
  /**
   * A read (list of shades and scenes) waits at most this long for its
   * answers; it is cut at once by any command.
   */
  readTimeout: 6 * SECOND,
  /**
   * A protective command waiting behind a request that got no answer for
   * this long since it was written cuts that connection (by a timer), waits
   * until it is closed and goes on a new one.
   */
  staleAfter: SECOND,
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
   * A CLOSE not confirmed by an answer of the bridge within its budget is
   * held and tried again at these times AFTER THE CLICK (each try lasting
   * `holdTryBudget`): the last try ends about 28 s after the click. Any
   * newer command of that shade, or any MyLink scene, drops it on arrival.
   * Never kept across a restart.
   */
  closeRetriesAt: [5 * SECOND, 12 * SECOND, 25 * SECOND],
  holdTryBudget: 3 * SECOND,
  /**
   * A STOP not written within its budget is tried again from this time after
   * the click, and never written later than `stopHoldMax` after the click:
   * on an RTS motor at rest, "stop" is the "my" button and moves the shade
   * to its favourite position, and a full travel lasts 10 to 25 s.
   */
  stopRetryAt: 4 * SECOND,
  stopHoldMax: 8 * SECOND,
  /** The last read time is written to /data at most this often. */
  attemptPersistEvery: MINUTE,
  /** "Test the connection" and a changed configuration read at most this often. */
  testGap: MINUTE,
  /** getConfig() failed at the start: tried again this often, without end. */
  configRetry: 30 * SECOND,
};
