// -----------------------------------------------------------------------------
// The link to ONE bridge: one TCP connection at a time (the bridge accepts no
// more), opened when there is something to send and closed when idle (the
// bridge drops idle sockets), the requests written in order of priority:
//
// ONE request in flight per connection: the next one is written only after
// the answer to the previous one (a bridge that reads everything waiting on
// its socket at once could drop requests glued together; pysomfymylink never
// has two in flight either). In order of priority:
//
//   1. protective commands (stop, close), in their order of arrival: at once
//      on an idle connection, else right after the answer to the request in
//      flight; when that request got no answer for 1 s since it was written,
//      a timer cuts the connection, waits until it is closed, and the
//      command goes on a new one. A connection that fails before the bytes
//      are written is tried again every 250 ms within the deadline;
//   2. the other commands (open, favourite position, scenes), in their order
//      of arrival, after the answer to the previous request (never cutting
//      anything);
//   3. reads (list of shades and scenes): only on an idle link, and cut at
//      once by any command.
//
// No request is written after its deadline, and `beforeSend()` (the order
// rules of the app) is asked right before the bytes, with no await in
// between. A request whose bytes may have left is always told `written`:
// never "not sent". The System ID only goes into the bytes written.
// -----------------------------------------------------------------------------

import { connect as tcpConnect } from 'node:net';
import { AUTH_ERROR_CODES, TIMINGS } from '../constants.js';
import { LinkError, ObjectScanner, encodeRequest, parseObject } from './protocol.js';

export const openTcp = ({ host, port }) => tcpConnect({ host, port });

const PRIORITY = { protective: 0, command: 1, read: 2 };

export class Link {
  constructor({
    address,
    systemId,
    timers = globalThis,
    monotonic = () => performance.now(),
    timings = TIMINGS,
    open = openTcp,
  }) {
    this.address = address;
    this.systemId = systemId;
    this.timers = timers;
    this.monotonic = monotonic;
    this.timings = timings;
    this.open = open;
    /** Jobs not written yet. */
    this.queue = [];
    this.order = 0;
    this.nextId = 1;
    /** The open connection: { socket, scanner, pending (one entry at most), dead, closed, reason } */
    this.conn = undefined;
    /** Connections being closed: a new one waits for them. */
    this.closing = new Set();
    this.running = false;
    this.again = false;
    this.wakeTimer = undefined;
    this.idleTimer = undefined;
    this.shut = false;
  }

  /**
   * Sends one request. `kind`: 'protective' | 'command' | 'read'.
   * `deadline` (monotonic): never written after it. `beforeSend()`: false
   * cancels it right before the bytes. `retry`: a failed connection is tried
   * again every `protectiveRetry` ms within the deadline. `tag`: anything the
   * app needs to find the job again (cancel, has).
   * Resolves with the `result` of the bridge; rejects with a LinkError.
   */
  request(method, params, { kind = 'command', deadline, beforeSend, retry = false, tag } = {}) {
    if (this.shut) {
      return Promise.reject(new LinkError('closed'));
    }
    return new Promise((resolve, reject) => {
      this.queue.push({
        method,
        params,
        kind,
        deadline: deadline ?? this.monotonic() + this.timings.commandSendBy,
        beforeSend,
        retry,
        tag,
        notBefore: -Infinity,
        order: (this.order += 1),
        lastError: undefined,
        resolve,
        reject,
      });
      this.kick();
    });
  }

  /** Rejects the jobs not written yet that match (`cancelled`, never sent). */
  cancel(match, why) {
    const kept = [];
    for (const job of this.queue) {
      if (match(job)) {
        const error = new LinkError('cancelled');
        error.why = why;
        job.reject(error);
      } else {
        kept.push(job);
      }
    }
    this.queue = kept;
  }

  /** Whether a job matching is waiting to be written. */
  has(match) {
    return this.queue.some(match);
  }

  /** Closes everything: queued jobs rejected (never sent), the connection cut. */
  async close() {
    this.shut = true;
    this.clearTimers();
    for (const job of this.queue) {
      job.reject(new LinkError('closed'));
    }
    this.queue = [];
    if (this.conn) {
      await this.cut(this.conn);
    }
    await Promise.all([...this.closing]);
  }

  clearTimers() {
    if (this.wakeTimer) {
      this.timers.clearTimeout(this.wakeTimer);
      this.wakeTimer = undefined;
    }
    if (this.idleTimer) {
      this.timers.clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  kick() {
    if (this.shut) {
      return;
    }
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    (async () => {
      try {
        do {
          this.again = false;
          await this.step();
        } while (this.again && !this.shut);
      } catch {
        // step() handles its errors; nothing may escape a background loop.
      } finally {
        this.running = false;
      }
    })();
  }

  wakeAt(at) {
    if (!Number.isFinite(at)) {
      return;
    }
    if (this.wakeTimer) {
      this.timers.clearTimeout(this.wakeTimer);
    }
    this.wakeTimer = this.timers.setTimeout(
      () => {
        this.wakeTimer = undefined;
        this.kick();
      },
      Math.max(0, at - this.monotonic()),
    );
  }

  /** The next job to write: protective first, then commands, then reads; ready ones only. */
  pick(mono) {
    let best;
    for (const job of this.queue) {
      if (job.notBefore > mono) {
        continue;
      }
      if (
        !best ||
        PRIORITY[job.kind] < PRIORITY[best.kind] ||
        (PRIORITY[job.kind] === PRIORITY[best.kind] && job.order < best.order)
      ) {
        best = job;
      }
    }
    return best;
  }

  /** The nearest deadline of the jobs waiting (Infinity when none). */
  nextDeadline() {
    return Math.min(...this.queue.map((j) => j.deadline));
  }

  remove(job) {
    this.queue = this.queue.filter((j) => j !== job);
  }

  /** One decision: one read of the clock, then at most one await before starting over. */
  async step() {
    const mono = this.monotonic();
    for (const job of [...this.queue]) {
      if (mono >= job.deadline) {
        this.remove(job);
        job.reject(job.lastError ?? new LinkError('late'));
      }
    }
    const job = this.pick(mono);
    if (!job) {
      const next = Math.min(...this.queue.map((j) => j.notBefore));
      if (Number.isFinite(next)) {
        this.wakeAt(next);
      }
      this.idleCheck();
      return;
    }
    if (this.idleTimer) {
      this.timers.clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    const conn = this.conn && !this.conn.dead ? this.conn : undefined;
    if (conn && conn.pending.size > 0) {
      const [entry] = conn.pending.values();
      if (entry.job.kind === 'read' && job.kind !== 'read') {
        // A command never waits for a read.
        await this.cut(conn, 'preempted');
        this.again = true;
        return;
      }
      if (job.kind === 'protective') {
        const staleAt = entry.writtenAt + this.timings.staleAfter;
        if (mono >= staleAt) {
          // No answer for a second: the connection may be stuck; a new one
          // for the stop or close, once this one is closed.
          await this.cut(conn, 'stale');
          this.again = true;
          return;
        }
        this.wakeAt(Math.min(staleAt, this.nextDeadline()));
        return;
      }
      // Wait for the answer (it starts this loop again); a queued job past
      // its deadline is still rejected on time.
      this.wakeAt(this.nextDeadline());
      return;
    }
    if (!conn) {
      await this.connect(job, mono);
      this.again = true;
      return;
    }
    this.write(conn, job);
    this.again = true;
  }

  /** Opens the connection for `job` (after the old ones are closed), or fails `job`. */
  async connect(job, mono) {
    if (this.closing.size > 0) {
      await Promise.all([...this.closing]);
    }
    if (this.shut || this.conn) {
      return;
    }
    const budget = Math.min(this.timings.connectTimeout, job.deadline - mono);
    try {
      this.conn = await this.openConnection(Math.max(1, budget));
    } catch (err) {
      const now = this.monotonic();
      job.lastError = err;
      if (job.retry && now + this.timings.protectiveRetry < job.deadline) {
        job.notBefore = now + this.timings.protectiveRetry;
        return;
      }
      if (this.queue.includes(job)) {
        this.remove(job);
        job.reject(err);
      }
    }
  }

  openConnection(timeout) {
    return new Promise((resolve, reject) => {
      let socket;
      try {
        socket = this.open(this.address);
      } catch (err) {
        reject(new LinkError('unreachable', { cause: err }));
        return;
      }
      const closed = new Promise((done) => socket.once('close', done));
      this.closing.add(closed);
      closed.then(() => this.closing.delete(closed));
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        this.timers.clearTimeout(timer);
        socket.destroy();
        reject(error);
      };
      const timer = this.timers.setTimeout(() => fail(new LinkError('timeout')), timeout);
      socket.once('error', (err) => fail(new LinkError('unreachable', { cause: err })));
      socket.once('connect', () => {
        if (settled) return;
        settled = true;
        this.timers.clearTimeout(timer);
        if (this.shut) {
          socket.destroy();
          reject(new LinkError('closed'));
          return;
        }
        const conn = {
          socket,
          scanner: new ObjectScanner(),
          pending: new Map(),
          dead: false,
          closed,
          reason: 'closed',
        };
        socket.setNoDelay?.(true);
        socket.on('error', () => {});
        socket.on('data', (chunk) => this.onData(conn, chunk));
        socket.on('close', () => this.onClose(conn));
        resolve(conn);
      });
    });
  }

  write(conn, job) {
    const mono = this.monotonic();
    this.remove(job);
    if (mono >= job.deadline) {
      job.reject(job.lastError ?? new LinkError('late'));
      return;
    }
    if (job.beforeSend && job.beforeSend() === false) {
      job.reject(new LinkError('cancelled'));
      return;
    }
    const id = this.nextId;
    this.nextId = id >= 2 ** 31 ? 1 : id + 1;
    const timeout =
      job.kind === 'read'
        ? this.timings.readTimeout
        : job.kind === 'protective'
          ? this.timings.protectiveReplyTimeout
          : this.timings.replyTimeout;
    const entry = {
      job,
      writtenAt: mono,
      timer: this.timers.setTimeout(() => {
        if (conn.pending.get(id) === entry) {
          conn.pending.delete(id);
          job.reject(new LinkError('timeout', { written: true }));
          // The bridge stopped answering: this connection is not trusted any more.
          this.cut(conn).catch(() => {});
        }
      }, timeout),
    };
    conn.pending.set(id, entry);
    conn.socket.write(encodeRequest(id, job.method, job.params, this.systemId));
  }

  onData(conn, chunk) {
    if (conn.dead) {
      return;
    }
    let texts;
    try {
      texts = conn.scanner.push(chunk);
    } catch (err) {
      conn.reason = err.kind ?? 'format';
      this.cut(conn, conn.reason).catch(() => {});
      return;
    }
    for (const text of texts) {
      const message = parseObject(text);
      if (!message || message.keepalive) {
        continue;
      }
      const entry = conn.pending.get(message.id);
      if (!entry) {
        continue;
      }
      conn.pending.delete(message.id);
      this.timers.clearTimeout(entry.timer);
      if (message.error) {
        const code = message.error.code;
        entry.job.reject(
          new LinkError(AUTH_ERROR_CODES.has(code) ? 'auth' : 'api', {
            written: true,
            code: code ?? undefined,
          }),
        );
      } else if (message.result === false) {
        // Meaning unknown (see TODO.md): never taken as "accepted".
        entry.job.reject(new LinkError('unexpected', { written: true }));
      } else {
        entry.job.resolve(message.result);
      }
    }
    this.kick();
  }

  onClose(conn) {
    conn.dead = true;
    for (const entry of conn.pending.values()) {
      this.timers.clearTimeout(entry.timer);
      entry.job.reject(
        new LinkError(
          entry.job.kind === 'read' && conn.reason === 'preempted' ? 'preempted' : conn.reason,
          {
            written: true,
          },
        ),
      );
    }
    conn.pending.clear();
    if (this.conn === conn) {
      this.conn = undefined;
    }
    this.kick();
  }

  /** Closes a connection and waits until it is closed. */
  async cut(conn, reason) {
    if (reason && conn.reason === 'closed') {
      conn.reason = reason;
    }
    conn.dead = true;
    if (this.conn === conn) {
      this.conn = undefined;
    }
    conn.socket.destroy();
    await conn.closed;
  }

  /** An idle connection (nothing pending, nothing queued) is closed shortly after. */
  idleCheck() {
    const conn = this.conn;
    if (!conn || conn.pending.size > 0 || this.queue.length > 0 || this.idleTimer) {
      return;
    }
    this.idleTimer = this.timers.setTimeout(() => {
      this.idleTimer = undefined;
      if (this.conn === conn && conn.pending.size === 0 && this.queue.length === 0) {
        this.cut(conn).catch(() => {});
      }
    }, this.timings.idleClose);
  }
}
