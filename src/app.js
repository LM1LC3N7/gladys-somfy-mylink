// -----------------------------------------------------------------------------
// The integration: one Somfy MyLink bridge (its IP address and System ID in
// the configuration), its shades (RTS motors) and scenes as Gladys devices,
// the transport badges, the "Test the connection" button and the commands.
// index.js only wires the SDK handlers to it.
//
// RTS gives nothing back: the bridge only says it took a command. No state
// and no position is ever read, so no command can be "confirmed by a read":
// the badge of each shade shows the ASSUMED state (the last command, and
// whether the bridge accepted it), never "closed" as a fact.
//
// Reads: the list of shades and scenes (`mylink.status.info`,
// `mylink.scene.list`) every poll interval (60 s to 1 h), never sooner (the
// time of the last read is kept in /data, written BEFORE the read); "Test the
// connection", Scan and a changed configuration read at most once a minute.
// A refused System ID stops the reads (kept in /data as an 8-bit marker),
// until the System ID changes or the Test button reads with success. A read
// is cut by any command.
//
// Commands (one link per bridge, one request in flight: src/mylink/link.js):
//   - STOP and CLOSE (protective) depend on no option, no read and no
//     refused-System-ID marker: ahead of every other command, from the start
//     (the ids are in the external ids). A failed connection is tried again
//     every 250 ms within 3.5 s of the click. A CLOSE without an answer of
//     the bridge is written again within that budget, then held and tried
//     again 5, 12 and 25 s after the click (3 s each). A STOP is never
//     written twice (a STOP to a motor at rest is the RTS "my" button: it
//     moves the shade to its favourite position): written without an answer
//     it is acked as a failure; not written in its budget, it is tried again
//     from 4 s and never written later than 8 s after the click. Holds live
//     in memory only: a restart drops them (the badge says "not sent");
//   - the others (open, favourite position, scene) are decided on the list
//     read from the bridge (the shade or scene in it) and on a System ID
//     not refused; written within 3.5 s of the click or refused unsent;
//   - order: every command is numbered at its arrival. Any command arriving
//     for a shade drops the held command of that shade, a MyLink scene drops
//     them all, sent or not. A stop or close cancels the older commands of
//     that shade not written yet (and the older scenes); an older command is
//     never written after a newer one of its shade;
//   - success means "answered by the bridge": a command written without an
//     answer is acked as a failure that says it may have left, never
//     "not sent" (the ack never waits past 4.3 s, nor for a publication).
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig, sameConnection } from './config.js';
import {
  COMMANDS,
  COVER_STATE,
  FEATURES,
  LIMITS,
  METHODS,
  PRESSED,
  PROTECTIVE,
  SECOND,
  TIMINGS,
} from './constants.js';
import { buildScene, buildShade, numberIn, parseExternalId } from './devices.js';
import { ERRORS, T, age, commandWord, join, reasonOf, trim, word } from './i18n.js';
import { Link, openTcp } from './mylink/link.js';
import { parseScenes, parseShades } from './mylink/protocol.js';
import { fileStore, normalizeMemory } from './store.js';

/** The fields kept from a feature created in Gladys, when it is published again as it is. */
const KEPT_FIELDS = [
  'name',
  'external_id',
  'category',
  'type',
  'min',
  'max',
  'unit',
  'read_only',
  'has_feedback',
  'keep_history',
];

const METHOD_OF = {
  [COMMANDS.OPEN]: METHODS.UP,
  [COMMANDS.CLOSE]: METHODS.DOWN,
  [COMMANDS.STOP]: METHODS.STOP,
  // The RTS "my" button: the same order as stop (moves to the favourite
  // position when the motor is at rest, stops it when it moves).
  [COMMANDS.FAVORITE]: METHODS.STOP,
  [COMMANDS.SCENE]: METHODS.RUN,
};

/** The reason of a command written without an answer. */
const REASON_NO_ANSWER = {
  en: 'sent, the bridge did not answer',
  fr: 'envoyé, le pont n’a pas répondu',
};

/** Reads that did not happen because of a command: not a failure. */
const NOT_A_FAILURE = new Set(['preempted', 'cancelled', 'late']);

export class MyLinkApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'somfy-mylink' }),
    store = fileStore(),
    now = Date.now,
    monotonic = () => performance.now(),
    timers = globalThis,
    open = openTcp,
    timings = TIMINGS,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.store = store;
    this.now = now;
    this.monotonic = monotonic;
    this.timers = timers;
    this.open = open;
    this.timings = timings;
    this.config = normalizeConfig();
    this.memory = undefined;
    this.generation = 0;
    this.started = false;
    this.link = undefined;
    this.configError = undefined;
    this.configTimer = undefined;
    /** Monotonic time of the last read (exact in this process). */
    this.lastAttemptMono = -Infinity;
    /** A read asked sooner than the interval (Test, Scan, new configuration): its monotonic time. */
    this.readSoonAt = undefined;
    this.readTimer = undefined;
    this.reading = undefined;
    /** The last read: { ok, err? } */
    this.lastRead = undefined;
    /** Commands numbered at their arrival. */
    this.seq = 0;
    /** shade id -> number of its last stop or close (arrived). */
    this.lastProtective = new Map();
    /** shade id -> number of its last command arrived; the last scene arrived. */
    this.lastArrived = new Map();
    this.lastSceneArrived = 0;
    /** The number of the last stop or close of any shade (scenes are older or newer than it). */
    this.lastAnyProtective = 0;
    /** shade id -> number of its last command written. */
    this.lastWritten = new Map();
    /** shade id -> { target, command, seq, clickMono, at, tries, timer } */
    this.holds = new Map();
    /** An answer of the bridge to a command since the last read. */
    this.answered = false;
    /** shade id -> the command that could not be sent at all. */
    this.lost = new Map();
    /** device external id -> device published in this run (a publication never shrinks). */
    this.known = new Map();
    this.published = undefined;
    this.badges = undefined;
    this.lastStatus = undefined;
  }

  // --- Lifecycle -------------------------------------------------------------

  /**
   * Connected to Gladys (`loadConfig`: gladys.getConfig). The first time,
   * start; after a reconnection, send again what Gladys keeps in memory
   * only (status, Discovery tab, badges), without reading the bridge. A
   * configuration that cannot be read is tried again every 30 s, without
   * end, with a status saying so.
   */
  async connected(loadConfig) {
    if (this.configTimer) {
      this.timers.clearTimeout(this.configTimer);
      this.configTimer = undefined;
    }
    let raw;
    try {
      raw = await loadConfig();
      this.configError = undefined;
    } catch (err) {
      this.logger.warn(`Reading the configuration failed: ${err?.message ?? 'error'}`);
      this.configError = true;
      this.lastStatus = undefined;
      await this.updateStatus();
      this.configTimer = this.timers.setTimeout(() => {
        this.configTimer = undefined;
        this.connected(loadConfig).catch(() => {});
      }, this.timings.configRetry);
      return;
    }
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    await this.configUpdated(raw, { republish: true });
  }

  async start(raw = {}) {
    await this.halt();
    const generation = this.generation;
    if (!this.memory) {
      const now = this.now();
      const mono = this.monotonic();
      this.memory = normalizeMemory(await this.store.load().catch(() => null), now);
      if (this.memory.lastAttemptAt > 0) {
        // Written at most once a minute: the real last read may be up to a
        // minute later than the one kept.
        this.lastAttemptMono = Math.min(
          mono,
          mono - (now - this.memory.lastAttemptAt) + this.timings.attemptPersistEvery,
        );
      }
      // The commands held when the integration stopped are NEVER sent again
      // (nobody is behind them any more): only their badge says "not sent".
      for (const [target, command] of Object.entries(this.memory.lost)) {
        this.lost.set(target, command);
      }
    }
    if (generation !== this.generation) {
      return;
    }
    this.applyConfig(normalizeConfig(raw));
    this.lastRead = undefined;
    this.published = undefined;
    this.badges = undefined;
    this.lastStatus = undefined;
    for (const hold of this.holds.values()) {
      this.armHold(hold);
    }
    await this.publishAll();
    if (generation !== this.generation) {
      return;
    }
    this.scheduleRead();
  }

  /** Sets the configuration and the link to the bridge (a new link when the bridge or the System ID changed). */
  applyConfig(config) {
    const previous = this.config;
    this.config = config;
    if (this.link && sameConnection(previous, config)) {
      return;
    }
    this.link?.close().catch(() => {});
    this.link =
      config.address && config.systemId
        ? new Link({
            address: config.address,
            systemId: config.systemId,
            timers: this.timers,
            monotonic: this.monotonic,
            timings: this.timings,
            open: this.open,
          })
        : undefined;
  }

  /** Stops the timers and the link (holds stay, to be armed again by start()). */
  async halt() {
    this.generation += 1;
    if (this.readTimer) {
      this.timers.clearTimeout(this.readTimer);
      this.readTimer = undefined;
    }
    for (const hold of this.holds.values()) {
      if (hold.timer) {
        this.timers.clearTimeout(hold.timer);
        hold.timer = undefined;
      }
    }
    const link = this.link;
    this.link = undefined;
    await link?.close();
  }

  /** Shutdown of the container: everything stopped, /data written. */
  async stop() {
    if (this.configTimer) {
      this.timers.clearTimeout(this.configTimer);
      this.configTimer = undefined;
    }
    await this.halt();
    if (this.memory) {
      await this.saveMemory();
    }
  }

  /** A configuration saved: a new address or System ID starts over; the rest applies at once. */
  async configUpdated(raw = {}, { republish = false } = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    const next = normalizeConfig(raw);
    if (!sameConnection(next, this.config)) {
      await this.start(raw);
      // A new bridge or System ID: read it as soon as the minute allows.
      this.readSoonAt = this.lastAttemptMono + this.timings.testGap;
      this.scheduleRead();
      return;
    }
    const previous = this.config;
    this.config = next;
    if (previous.pollInterval !== next.pollInterval) {
      this.scheduleRead();
    }
    if (republish || previous.language !== next.language) {
      this.published = undefined;
      this.badges = undefined;
      this.lastStatus = undefined;
    }
    await this.publishAll();
  }

  /** Saves /data; the System ID is never in it. */
  async saveMemory() {
    // A held command is kept as "not sent" only: never written again after
    // a restart.
    const lost = Object.fromEntries(this.lost);
    for (const hold of this.holds.values()) {
      lost[hold.target] = hold.command;
    }
    this.memory.lost = lost;
    await this.store
      .save(this.memory)
      .catch((err) => this.logger.warn(`Saving the state to /data failed: ${err.message}`));
  }

  get interval() {
    return this.config.pollInterval * SECOND;
  }

  /** The System ID of the configuration was refused by the bridge (kept in /data). */
  refused() {
    return Boolean(this.memory?.refused && this.memory.refused === this.config.marker);
  }

  // --- Reads -----------------------------------------------------------------

  /** The monotonic time from which the next read may start, from the caller's instant (read once). */
  dueAt(mono) {
    const regular = this.lastAttemptMono + this.interval;
    const soon =
      this.readSoonAt === undefined
        ? Infinity
        : Math.max(this.readSoonAt, this.lastAttemptMono + this.timings.testGap);
    return Math.max(mono, Math.min(regular, soon));
  }

  scheduleRead() {
    if (this.readTimer) {
      this.timers.clearTimeout(this.readTimer);
      this.readTimer = undefined;
    }
    if (!this.link || this.refused() || this.reading) {
      return;
    }
    const generation = this.generation;
    const mono = this.monotonic();
    this.readTimer = this.timers.setTimeout(
      () => {
        this.readTimer = undefined;
        if (generation === this.generation) {
          this.read().catch((err) => this.logger.error(`Read failed: ${err?.message ?? 'error'}`));
        }
      },
      Math.max(0, this.dueAt(mono) - mono),
    );
  }

  /** One read of the lists, when due (or forced by the Test button within its minute). */
  async read({ test = false } = {}) {
    const mono = this.monotonic();
    if (this.reading || !this.link) {
      return this.reading;
    }
    if (!test && (this.refused() || mono < this.dueAt(mono))) {
      this.scheduleRead();
      return undefined;
    }
    this.reading = this.doRead(mono).finally(() => {
      this.reading = undefined;
      this.scheduleRead();
    });
    return this.reading;
  }

  async doRead(mono) {
    const generation = this.generation;
    const link = this.link;
    const marker = this.config.marker;
    this.lastAttemptMono = mono;
    this.readSoonAt = undefined;
    const now = this.now();
    if (now - this.memory.lastAttemptAt >= this.timings.attemptPersistEvery) {
      // Written BEFORE the read: a restart in the middle never reads sooner.
      this.memory.lastAttemptAt = now;
      await this.saveMemory();
    }
    if (generation !== this.generation) {
      return;
    }
    let shades;
    let scenes;
    try {
      shades = parseShades(
        await link.request(
          METHODS.INFO,
          { targetID: '*.*' },
          { kind: 'read', deadline: this.monotonic() + this.timings.readTimeout },
        ),
      );
      if (shades === undefined) {
        throw Object.assign(new Error('format'), { kind: 'format' });
      }
      try {
        scenes = parseScenes(
          await link.request(
            METHODS.SCENES,
            {},
            { kind: 'read', deadline: this.monotonic() + this.timings.readTimeout },
          ),
        );
      } catch (err) {
        if (err?.kind === 'auth' || NOT_A_FAILURE.has(err?.kind)) {
          throw err;
        }
        // Scenes are secondary: an error there never hides the shades.
        scenes = undefined;
      }
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      if (NOT_A_FAILURE.has(err?.kind)) {
        return;
      }
      if (err?.kind === 'auth') {
        this.memory.refused = marker;
        await this.saveMemory();
        this.logger.warn('The bridge refused the System ID: no read until it changes');
      } else {
        this.logger.warn(`Reading the bridge failed: ${reasonOf(err).en}`);
      }
      this.lastRead = { ok: false, err };
      this.answered = false;
      await this.publishAll();
      return;
    }
    if (generation !== this.generation) {
      return;
    }
    this.lastRead = { ok: true };
    this.answered = false;
    this.memory.shades = shades;
    if (scenes !== undefined) {
      this.memory.scenes = scenes;
    }
    this.memory.listedAt = this.now();
    if (this.memory.refused) {
      this.memory.refused = null;
    }
    await this.saveMemory();
    if (generation !== this.generation) {
      return;
    }
    await this.publishAll();
  }

  // --- Status, Discovery, badges ---------------------------------------------

  status() {
    const config = this.config;
    const notes = [
      config.credentialsInHost ? T.credentialsInHost : undefined,
      config.invalid !== undefined ? T.invalid(config.invalid) : undefined,
      config.local ? T.local : undefined,
      config.systemIdInvalid ? T.systemIdInvalid : undefined,
    ];
    if (this.configError) {
      return [false, T.configRetry(age(this.timings.configRetry))];
    }
    if (!config.address) {
      return [false, join(T.noAddress, ...notes)];
    }
    if (!config.systemId) {
      return [false, join(T.noSystemId, ...notes)];
    }
    if (this.refused()) {
      return [false, join(T.refused, ...notes)];
    }
    if (this.lastRead?.ok) {
      return [
        true,
        join(
          T.connected({
            shades: this.memory.shades.length,
            scenes: this.memory.scenes.length,
            interval: config.pollInterval,
          }),
          ...notes,
        ),
      ];
    }
    if (this.lastRead) {
      const mono = this.monotonic();
      const wait = age(Math.max(0, this.dueAt(mono) - mono));
      return [false, join(T.unreachable(reasonOf(this.lastRead.err), wait), ...notes)];
    }
    return [false, join(T.connecting, ...notes)];
  }

  async updateStatus() {
    let connected;
    let message;
    try {
      [connected, message] = this.status();
    } catch (err) {
      this.logger.error(`Status failed: ${err?.message ?? 'error'}`);
      [connected, message] = [false, ERRORS.generic];
    }
    const key = JSON.stringify([connected, message]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  async publishAll() {
    const generation = this.generation;
    await this.publishDevices();
    if (generation !== this.generation) {
      return;
    }
    await this.publishBadges();
    await this.updateStatus();
  }

  /**
   * The Discovery tab: one device per shade and per scene of the last list
   * read (or kept in /data). A created device never loses a feature, and a
   * device seen earlier in this run stays.
   */
  async publishDevices() {
    if (!this.memory) {
      return;
    }
    const language = this.config.language;
    const created = new Map((this.gladys.devices ?? []).map((d) => [d.external_id, d]));
    const fresh = [
      ...this.memory.shades.map((s) => buildShade(this.gladys, s, { language })),
      ...this.memory.scenes.map((s) => buildScene(this.gladys, s, { language })),
    ];
    for (const device of fresh) {
      const published = new Set(device.features.map((f) => f.external_id));
      const kept = [
        ...(created.get(device.external_id)?.features ?? []),
        ...(this.known.get(device.external_id)?.features ?? []),
      ];
      for (const feature of kept) {
        if (!published.has(feature.external_id)) {
          const copy = {};
          for (const field of KEPT_FIELDS) {
            if (feature[field] !== undefined && feature[field] !== null) {
              copy[field] = feature[field];
            }
          }
          device.features.push(copy);
          published.add(feature.external_id);
        }
      }
      this.known.set(device.external_id, device);
    }
    const devices = [...this.known.values()];
    const json = JSON.stringify(devices);
    if (json === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  /** The badge of a created device. */
  badgeOf(target) {
    // A read that failed, or an answer of the bridge to a command since.
    const reachable =
      Boolean(this.link) && !this.refused() && (this.lastRead?.ok !== false || this.answered);
    if (!reachable) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    if (target.kind !== 'shade') {
      return { transport: DEVICE_TRANSPORTS.LOCAL };
    }
    // RTS: never a nominal state, always an assumed one (orange dot).
    const hold = this.holds.get(target.id);
    const lost = this.lost.get(target.id);
    const assumed = this.memory?.assumed[target.id];
    let message;
    if (hold) {
      message = T.badge.held(commandWord(hold.command));
    } else if (lost) {
      message = T.badge.lost(commandWord(lost));
    } else if (assumed) {
      message = T.badge.assumed(commandWord(assumed.command), assumed.answer === 'ok');
    } else {
      message = T.badge.none;
    }
    return { transport: DEVICE_TRANSPORTS.LOCAL, degraded: true, message: trim(message) };
  }

  async publishBadges() {
    // Nothing tried yet since the start: no badge rather than a wrong one.
    if (!this.lastRead && this.link && !this.refused()) {
      return;
    }
    const entries = [];
    for (const device of this.gladys.devices ?? []) {
      const target = parseExternalId(this.gladys, device?.external_id);
      if (!target || target.key !== undefined) {
        continue;
      }
      entries.push({ external_id: device.external_id, ...this.badgeOf(target) });
    }
    const json = JSON.stringify(entries);
    if (entries.length === 0 || json === this.badges) {
      return;
    }
    try {
      for (let i = 0; i < entries.length; i += 100) {
        await this.gladys.publishTransports(entries.slice(i, i + 100));
      }
      this.badges = json;
    } catch (err) {
      this.logger.warn(`Transport badges failed: ${err.message}`);
    }
  }

  /** A device was created (or updated): its badge at once. */
  async deviceCreated() {
    this.badges = undefined;
    await this.publishBadges();
    await this.updateStatus();
  }

  async deviceDeleted() {
    this.badges = undefined;
    await this.updateStatus();
  }

  /** The Discovery tab asks for a scan: the lists sent again, read again if the last read is a minute old. */
  async scan() {
    this.published = undefined;
    await this.publishDevices();
    const mono = this.monotonic();
    if (this.link && !this.refused() && mono >= this.lastAttemptMono + this.timings.testGap) {
      this.readSoonAt = mono;
      await this.read();
    }
  }

  // --- Configuration button --------------------------------------------------

  /**
   * "Test the connection": a read now (also with a refused System ID: a
   * success clears the refusal), unless the last one was less than a minute
   * ago.
   */
  async testConnection() {
    if (!this.link) {
      await this.updateStatus();
      return this.status()[1];
    }
    const mono = this.monotonic();
    const at = this.lastAttemptMono + this.timings.testGap;
    if (mono < at) {
      await this.updateStatus();
      return join(T.test.recent(age(at - mono)), this.status()[1]);
    }
    if (this.readTimer) {
      this.timers.clearTimeout(this.readTimer);
      this.readTimer = undefined;
    }
    this.readSoonAt = mono;
    await this.read({ test: true });
    await this.publishAll();
    return this.status()[1];
  }

  // --- Commands --------------------------------------------------------------

  refusal(text) {
    const error = new Error(word(text, this.config.language));
    error.refusal = true;
    return error;
  }

  /** What a command asks, from the feature and the value. */
  commandOf(target, value) {
    if (target.kind === 'shade' && target.key === FEATURES.STATE) {
      const v = numberIn(value, -1, 1);
      if (v === COVER_STATE.STOP) return COMMANDS.STOP;
      if (v === COVER_STATE.OPEN) return COMMANDS.OPEN;
      if (v === COVER_STATE.CLOSE) return COMMANDS.CLOSE;
      throw this.refusal(ERRORS.badValue);
    }
    if (
      (target.kind === 'shade' && target.key === FEATURES.FAVORITE) ||
      (target.kind === 'scene' && target.key === FEATURES.RUN)
    ) {
      if (numberIn(value, PRESSED, PRESSED) !== PRESSED) {
        throw this.refusal(ERRORS.badValue);
      }
      return target.kind === 'scene' ? COMMANDS.SCENE : COMMANDS.FAVORITE;
    }
    throw this.refusal(ERRORS.readOnly);
  }

  async setValue(_device, feature, value) {
    // The deadlines count from the arrival of the command, before any wait.
    const received = this.monotonic();
    const target = parseExternalId(this.gladys, feature?.external_id);
    if (!target || target.key === undefined) {
      throw this.refusal(ERRORS.readOnly);
    }
    const command = this.commandOf(target, value);
    this.seq += 1;
    const seq = this.seq;
    if (target.kind === 'shade') {
      this.lastArrived.set(target.id, seq);
    } else {
      this.lastSceneArrived = seq;
    }
    // The newest wins from its arrival, whether it leaves or not: a command
    // for a shade drops the held one of that shade; a MyLink scene (whose
    // shades are unknown) drops them all.
    for (const hold of [...this.holds.values()]) {
      if (target.kind === 'scene' || hold.target === target.id) {
        this.dropHold(hold);
        this.logger.info(`Held ${hold.command} dropped by a newer command: ${hold.target}`);
        this.afterCommand();
      }
    }
    if (PROTECTIVE.has(command)) {
      return this.protect(target.id, command, received, seq);
    }
    return this.move(target, command, received, seq);
  }

  /**
   * The order rules, asked right before the bytes are written (no await in
   * between). `key`: the shade, or null for a scene. `tag.why` tells why a
   * request is cancelled; `tag.notAfter`: never written after it (a STOP).
   */
  beforeSend(key, seq, protective, tag) {
    if (!protective) {
      if (key === null && this.lastAnyProtective > seq) {
        tag.why = 'sceneAfter';
        return false;
      }
      if (key !== null && (this.lastProtective.get(key) ?? 0) > seq) {
        tag.why = 'newerProtective';
        return false;
      }
    }
    if (key !== null && (this.lastWritten.get(key) ?? 0) > seq) {
      tag.why = 'newerLeft';
      return false;
    }
    if (tag.notAfter !== undefined && this.monotonic() >= tag.notAfter) {
      tag.why = 'late';
      return false;
    }
    if (key !== null) {
      this.lastWritten.set(key, seq);
      this.lost.delete(key);
    }
    return true;
  }

  /**
   * Waits for a command until its answer deadline. `{ status: 'ok' }`,
   * `'noReply'` (written, no answer), `'refused'` (the bridge answered an
   * error or an unexpected value) or `'notSent'` (with the error).
   */
  async outcome(promise, answerBy, sent, cancel) {
    let timer;
    const late = new Promise((resolve) => {
      timer = this.timers.setTimeout(
        () => resolve({ status: 'wait' }),
        Math.max(0, answerBy - this.monotonic()),
      );
    });
    const result = await Promise.race([
      promise.then(
        (value) => ({ status: 'ok', value }),
        (err) => {
          if (err?.written) {
            return ['auth', 'api', 'unexpected'].includes(err.kind)
              ? { status: 'refused', err }
              : { status: 'noReply', err };
          }
          return { status: 'notSent', err };
        },
      ),
      late,
    ]);
    this.timers.clearTimeout(timer);
    if (result.status !== 'wait') {
      return result;
    }
    if (sent()) {
      return { status: 'noReply' };
    }
    // Not written by its deadline: taken out, never sent late.
    cancel();
    return { status: 'notSent', err: { kind: 'late' } };
  }

  /** One request of a command on the link, with the order rules; its outcome. */
  async send(
    link,
    { method, params, kind, key, seq, deadline, answerBy, retry = false, notAfter },
  ) {
    const tag = { key, seq, why: undefined, notAfter };
    let written = false;
    const promise = link.request(method, params, {
      kind,
      deadline,
      retry,
      tag,
      beforeSend: () => {
        written = this.beforeSend(key, seq, kind === 'protective', tag);
        return written;
      },
    });
    const result = await this.outcome(
      promise,
      answerBy,
      () => written,
      () => link.cancel((job) => job.tag === tag, 'late'),
    );
    if (result.status === 'notSent' && result.err?.kind === 'cancelled') {
      result.why = tag.why ?? result.err.why;
    }
    if (result.status === 'ok') {
      this.bridgeAnswered();
    }
    return result;
  }

  /** The bridge answered a command: reachable, and its System ID accepted. */
  bridgeAnswered() {
    this.answered = true;
    if (this.memory.refused && this.refused()) {
      this.memory.refused = null;
      this.lastStatus = undefined;
      this.updateStatus().catch(() => {});
      this.scheduleRead();
    }
  }

  /** Remembers the command sent to a shade (the assumed state). */
  remember(id, command, answered) {
    const assumed = this.memory.assumed;
    delete assumed[id];
    assumed[id] = { command, at: this.now(), answer: answered ? 'ok' : 'none' };
    const ids = Object.keys(assumed);
    for (const old of ids.slice(0, Math.max(0, ids.length - LIMITS.shades))) {
      delete assumed[old];
    }
  }

  /** After a command: /data and the badges in the background (the ack never waits for them). */
  afterCommand() {
    this.saveMemory().catch(() => {});
    this.badges = undefined;
    this.publishBadges().catch(() => {});
  }

  async noteRefusal(err) {
    if (err?.kind === 'auth') {
      this.memory.refused = this.config.marker;
      this.lastStatus = undefined;
      this.logger.warn('The bridge refused the System ID');
      await this.saveMemory();
      this.updateStatus().catch(() => {});
    }
  }

  notSentError(err, why) {
    if (err?.kind === 'cancelled') {
      return ERRORS.cancelled[why] ?? ERRORS.late;
    }
    if (err?.kind === 'late' || err === undefined) {
      return ERRORS.late;
    }
    return ERRORS.notSent(reasonOf(err));
  }

  /** Why nothing can be sent at all, or undefined. */
  blocked() {
    if (this.configError && !this.link) {
      return ERRORS.configNotRead;
    }
    if (!this.link || !this.memory) {
      return ERRORS.notConfigured;
    }
    return undefined;
  }

  /** Open, favourite position, scene: decided on the list read from the bridge. */
  async move(target, command, received, seq) {
    const link = this.link;
    const blocked = this.blocked();
    if (blocked) {
      throw this.refusal(blocked);
    }
    if (this.refused()) {
      throw this.refusal(ERRORS.refused);
    }
    if (target.kind === 'shade' && !this.memory.shades.some((s) => s.id === target.id)) {
      throw this.refusal(ERRORS.unknownShade);
    }
    if (target.kind === 'scene' && !this.memory.scenes.some((s) => s.id === target.id)) {
      throw this.refusal(ERRORS.unknownScene);
    }
    if (link.queue.filter((j) => j.kind === 'command').length >= LIMITS.queue) {
      throw this.refusal(ERRORS.queueFull);
    }
    const result = await this.send(link, {
      method: METHOD_OF[command],
      params: target.kind === 'scene' ? { sceneID: Number(target.id) } : { targetID: target.id },
      kind: 'command',
      key: target.kind === 'shade' ? target.id : null,
      seq,
      deadline: received + this.timings.commandSendBy,
      answerBy: received + this.timings.commandAnswerBy,
    });
    return this.conclude(target, command, result);
  }

  async conclude(target, command, result) {
    const shade = target.kind === 'shade' ? target.id : undefined;
    const name = shade ?? `scene ${target.id}`;
    if (result.status === 'ok') {
      if (shade) {
        this.remember(shade, command, true);
      }
      this.logger.info(`${command} accepted by the bridge: ${name}`);
      this.afterCommand();
      return;
    }
    if (result.status === 'noReply') {
      // It may have left: the assumed state says so, the ack is a failure.
      if (shade) {
        this.remember(shade, command, false);
      }
      this.logger.warn(`${command} sent, the bridge did not answer: ${name}`);
      this.afterCommand();
      throw this.refusal(command === COMMANDS.STOP ? ERRORS.stopNoReply : ERRORS.noReply);
    }
    if (result.status === 'refused') {
      await this.noteRefusal(result.err);
      this.logger.warn(`${command} refused by the bridge (${reasonOf(result.err).en}): ${name}`);
      throw this.refusal(ERRORS.rejected(reasonOf(result.err)));
    }
    this.logger.warn(`${command} not sent (${result.why ?? result.err?.kind ?? 'late'}): ${name}`);
    throw this.refusal(this.notSentError(result.err, result.why));
  }

  /**
   * Stop and close: no option, no read, no refused marker in the way; ahead
   * of every other command; a connection tried again within the budget, a
   * CLOSE without an answer written again; then held (in memory only).
   */
  async protect(id, command, received, seq) {
    const blocked = this.blocked();
    if (blocked) {
      throw this.refusal(blocked);
    }
    const link = this.link;
    this.lastProtective.set(id, seq);
    this.lastAnyProtective = seq;
    // The older commands of this shade (and the older scenes) never leave after it.
    link.cancel((job) => job.tag && job.tag.seq < seq && job.tag.key === id, 'newerProtective');
    link.cancel((job) => job.tag && job.tag.seq < seq && job.tag.key === null, 'sceneAfter');
    const deadline = received + this.timings.commandSendBy;
    let result;
    for (;;) {
      result = await this.send(link, {
        method: METHOD_OF[command],
        params: { targetID: id },
        kind: 'protective',
        key: id,
        seq,
        deadline,
        answerBy: received + this.timings.commandAnswerBy,
        retry: true,
      });
      // A CLOSE written without an answer is written again (a new connection:
      // the silent one was cut) within its budget; a STOP never (at rest it
      // is the "my" button).
      const again =
        command === COMMANDS.CLOSE &&
        result.status === 'noReply' &&
        result.err !== undefined &&
        this.monotonic() < deadline &&
        this.link === link &&
        this.lastArrived.get(id) === seq &&
        this.lastSceneArrived < seq;
      if (!again) {
        break;
      }
      this.logger.warn(`close without an answer, written again: ${id}`);
    }
    const shade = { kind: 'shade', id };
    if (result.status === 'ok' || result.status === 'refused') {
      return this.conclude(shade, command, result);
    }
    if (result.status === 'notSent' && result.err?.kind === 'cancelled') {
      return this.conclude(shade, command, result);
    }
    if (this.lastArrived.get(id) !== seq || this.lastSceneArrived > seq) {
      // A newer command of this shade, or a MyLink scene, arrived meanwhile: it wins.
      return this.conclude(shade, command, result);
    }
    if (command === COMMANDS.STOP && result.status === 'noReply') {
      return this.conclude(shade, command, result);
    }
    // Not confirmed in its budget: held, tried again in this session only.
    if (result.status === 'noReply') {
      this.remember(id, command, false);
    }
    const hold = { target: id, command, seq, clickMono: received, tries: 0, timer: undefined };
    this.holds.set(id, hold);
    this.armHold(hold);
    this.afterCommand();
    this.logger.warn(
      `${command} not confirmed in time (${result.err?.kind ?? 'late'}), held: ${id}`,
    );
    const reason = result.status === 'noReply' ? REASON_NO_ANSWER : reasonOf(result.err);
    throw this.refusal(
      command === COMMANDS.STOP ? ERRORS.heldStop(reason) : ERRORS.heldClose(reason),
    );
  }

  dropHold(hold) {
    if (hold.timer) {
      this.timers.clearTimeout(hold.timer);
      hold.timer = undefined;
    }
    if (this.holds.get(hold.target) === hold) {
      this.holds.delete(hold.target);
      this.saveMemory().catch(() => {});
    }
  }

  /** Arms the next try of a held command, at its time after the click; none left: lost. */
  armHold(hold) {
    if (hold.timer) {
      this.timers.clearTimeout(hold.timer);
      hold.timer = undefined;
    }
    const offset =
      hold.command === COMMANDS.STOP
        ? hold.tries === 0
          ? this.timings.stopRetryAt
          : undefined
        : this.timings.closeRetriesAt[hold.tries];
    if (offset === undefined) {
      this.loseHold(hold);
      return;
    }
    const generation = this.generation;
    hold.timer = this.timers.setTimeout(
      () => {
        hold.timer = undefined;
        if (generation === this.generation) {
          this.retryHold(hold).catch((err) =>
            this.logger.error(`Held command failed: ${err?.message}`),
          );
        }
      },
      Math.max(0, hold.clickMono + offset - this.monotonic()),
    );
  }

  loseHold(hold) {
    this.dropHold(hold);
    this.lost.set(hold.target, hold.command);
    this.logger.warn(`${hold.command} could not be sent: ${hold.target}`);
    this.afterCommand();
  }

  async retryHold(hold) {
    const link = this.link;
    if (this.holds.get(hold.target) !== hold) {
      return;
    }
    const mono = this.monotonic();
    hold.tries += 1;
    const stop = hold.command === COMMANDS.STOP;
    const notAfter = stop ? hold.clickMono + this.timings.stopHoldMax : undefined;
    // A stop tries until its bound; a close for one try budget.
    const deadline = stop ? notAfter : mono + this.timings.holdTryBudget;
    if (!link || deadline <= mono) {
      this.armHold(hold);
      return;
    }
    const result = await this.send(link, {
      method: METHOD_OF[hold.command],
      params: { targetID: hold.target },
      kind: 'protective',
      key: hold.target,
      seq: hold.seq,
      deadline,
      answerBy: deadline + (this.timings.commandAnswerBy - this.timings.commandSendBy),
      retry: true,
      notAfter,
    });
    if (this.holds.get(hold.target) !== hold) {
      return; // Dropped by a newer command meanwhile.
    }
    if (result.status === 'ok') {
      this.dropHold(hold);
      this.remember(hold.target, hold.command, true);
      this.logger.info(`Held ${hold.command} accepted by the bridge: ${hold.target}`);
    } else if (result.status === 'refused') {
      this.dropHold(hold);
      await this.noteRefusal(result.err);
      this.lost.set(hold.target, hold.command);
      this.logger.warn(`Held ${hold.command} refused by the bridge: ${hold.target}`);
    } else if (
      result.status === 'notSent' &&
      result.err?.kind === 'cancelled' &&
      result.why !== 'late'
    ) {
      this.dropHold(hold);
    } else if (stop && result.status === 'noReply') {
      // Never written twice.
      this.dropHold(hold);
      this.remember(hold.target, hold.command, false);
      this.logger.warn(`Held stop sent, the bridge did not answer: ${hold.target}`);
    } else {
      if (result.status === 'noReply') {
        this.remember(hold.target, hold.command, false);
      }
      this.armHold(hold);
    }
    this.afterCommand();
  }
}
