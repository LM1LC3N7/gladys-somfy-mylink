# Somfy MyLink for Gladys

This integration drives your **Somfy RTS** shades and blinds through the
**Somfy MyLink bridge**, on your local network: open, close, stop, favourite
position ("my") and MyLink scenes. It talks to the "Synergy" API of the bridge
(TCP, port 44100); the Somfy cloud is not used.

> **Unofficial**, not affiliated with Somfy. The integration has **never been
> tested with a real bridge** yet: it follows the protocol of the
> pysomfymylink library (the one of Home Assistant). Your feedback is welcome.

## Before you start

1. Set up the bridge and your shades in the **MyLink** app.
2. In the app, menu **Integration**, note the **System ID**.
3. Give the bridge a fixed IP address in your router (DHCP reservation).

## Configuration

- **Address of the bridge**: its IP address, like `192.168.1.60` (port 44100
  by default; `192.168.1.60:44100` is accepted).
- **System ID**: kept by Gladys in its database, never shown again, sent only
  to your bridge. It never appears in a log, a status or `/data`.
- **Read interval** (60 to 3600 s, 300 by default): the list of shades and
  scenes is read again at this pace, only to know whether the bridge answers.
- **Language** of the feature names.

The **Test the connection** button reads the bridge again (at most once a
minute).

## What you get

- A **shutter** per motor of the bridge: `Open / close` (open, close, stop)
  and a `Favourite position (my)` button.
- A **button** per MyLink scene (`Run`).

Never a switch: a "turn everything off" does not reach your shades.

## The state is assumed, never confirmed

RTS motors are **one-way**: they send back neither their state nor their
position, and the bridge only says it took the command. So:

- there is **no position** in Gladys;
- the value Gladys shows for `Open / close` is the **last command sent**, not
  a measured state: a shade shown "closed" was told to close, nothing more (a
  remote, an obstacle or the thermal protection of the motor may have changed
  it);
- the badge of each shade (orange dot) says "Assumed state" with the last
  command and whether the bridge accepted it;
- no command can be "confirmed by a read": a successful command means
  "accepted by the bridge", and without an answer of the bridge it is told
  "sent, the bridge did not answer", never "not sent".

**Stop and favourite position**: on an RTS motor this is the same "my"
button. While moving, it stops the shade; at rest, it sends it to its
favourite position. The bridge does not know whether the shade moves: pressing
stop while the shade is still moves it to its favourite position.

## Stop and close

Stop and close go **before** everything else: a read in progress is cut, a
connection without an answer for a second is closed then opened again, and
they wait neither for the list of shades, nor for a System ID validated by a
read, nor for a recent read. One exchange at a time with the bridge (it
accepts one connection only); several commands at once (a Gladys scene on five
shades) leave one after the other on the same connection.

They are refused in these cases, and only these:

1. the address or the System ID is missing in the configuration (nothing is
   sent);
2. the value received is not "close" or "stop";
3. a newer command of the same shade has already left (the newest wins);
4. the bridge answers an error (System ID refused, shade unknown to the
   bridge): the message says so;
5. the bridge could not be reached within 3.5 s of the click (tries every
   250 ms): the command is then **held** and tried again 2, 5 and 10 s later.
   A held close is written to `/data` and leaves again after a restart, within
   two minutes of the click. A held stop is dropped 15 s after the click:
   later, the shade has finished its travel and the "stop" would move it to
   its favourite position.

## Open, favourite position, scenes

They are refused, nothing sent, when: the address or the System ID is
missing; the bridge refused the System ID; the shade or scene is not in the
list read from the bridge (Scan button of the Discovery tab); 32 commands are
already waiting; a newer stop or close of the same shade came before they
left; they could not leave within 3.5 s (bridge busy or not reachable). They
are never tried again.

## System ID refused

When the bridge refuses the System ID, the integration stops reading the
bridge (the refusal is kept in `/data` as an 8-bit marker that cannot give the
System ID back) until you save another System ID or **Test the connection**
succeeds. Stop and close are still sent.

## Privacy

Everything stays on your local network. `/data` holds the time of the last
read, the list of shades and scenes (ids and names), the last command of each
shade and the held closes; never the System ID.
