// -----------------------------------------------------------------------------
// The shades and scenes of the bridge -> Gladys devices (pure).
//
// One Gladys device per shade, a `shutter` (never a switch nor a binary: a
// "turn everything off" never reaches it):
//   state     shutter/state  open, close, stop (write only, no feedback)
//   favorite  button/push    the RTS "my" button (favourite position)
// RTS motors never tell their state nor their position: no position feature,
// and the value Gladys shows for `state` is the last command, nothing more
// (the badge says so).
//
// One Gladys device per scene of the bridge:
//   run       button/push    runs the scene
//
// Identity rule (frozen: it fixes the external ids): the id the bridge gives
// (the shade's `targetID`, which starts with the id of the bridge itself, or
// the scene's `sceneID`), case kept:
//   device   ext:<selector>:shade:<targetID>   ext:<selector>:scene:<sceneID>
//   feature  <device>:<key>
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
} from '@gladysassistant/integration-sdk';
import { COVER_STATE, FEATURES, PRESSED } from './constants.js';
import { label } from './i18n.js';
import { SCENE_ID, TARGET_ID } from './mylink/protocol.js';

const KINDS = { shade: TARGET_ID, scene: SCENE_ID };
const KEYS = {
  shade: new Set([FEATURES.STATE, FEATURES.FAVORITE]),
  scene: new Set([FEATURES.RUN]),
};

export const shadeIds = (gladys, id) => gladys.externalIds('shade', id);
export const sceneIds = (gladys, id) => gladys.externalIds('scene', id);

/**
 * `{ kind: 'shade'|'scene', id, key }` of an external id of this
 * integration (key undefined for a device), or undefined. The prefix is
 * matched exactly and the id checked like the bridge's: never a wildcard.
 */
export function parseExternalId(gladys, externalId) {
  if (typeof externalId !== 'string' || externalId.length > 200) {
    return undefined;
  }
  const prefix = gladys.externalId('');
  if (!externalId.startsWith(prefix)) {
    return undefined;
  }
  const [kind, id, key, ...rest] = externalId.slice(prefix.length).split(':');
  if (!Object.hasOwn(KINDS, kind) || !KINDS[kind].test(id ?? '') || rest.length > 0) {
    return undefined;
  }
  if (key !== undefined && !KEYS[kind].has(key)) {
    return undefined;
  }
  return { kind, id, key };
}

/** The name of a shade in Gladys: its name in the app, else "Shade" and its id. */
export const shadeName = (shade, language = 'fr') =>
  shade.name || `${language === 'en' ? 'Shade' : 'Volet'} ${shade.id}`;

export const sceneName = (scene, language = 'fr') =>
  `${language === 'en' ? 'Scene' : 'Scène'} ${scene.name || scene.id}`;

const button = (name, externalId) => ({
  name,
  external_id: externalId,
  category: C.BUTTON,
  type: T.BUTTON.PUSH,
  min: PRESSED,
  max: PRESSED,
  read_only: false,
  has_feedback: false,
  keep_history: false,
});

/** The Gladys device of a shade. */
export function buildShade(gladys, shade, { language = 'fr' } = {}) {
  const ids = shadeIds(gladys, shade.id);
  const params = [{ name: 'MYLINK_TARGET', value: shade.id }];
  if (shade.type !== null && shade.type !== undefined) {
    params.push({ name: 'MYLINK_TYPE', value: String(shade.type) });
  }
  return {
    name: shadeName(shade, language),
    external_id: ids.device,
    should_poll: false,
    params,
    features: [
      {
        name: label(FEATURES.STATE, language),
        external_id: ids.feature(FEATURES.STATE),
        category: C.SHUTTER,
        type: T.SHUTTER.STATE,
        min: COVER_STATE.CLOSE,
        max: COVER_STATE.OPEN,
        read_only: false,
        has_feedback: false,
        keep_history: false,
      },
      button(label(FEATURES.FAVORITE, language), ids.feature(FEATURES.FAVORITE)),
    ],
  };
}

/** The Gladys device of a scene. */
export function buildScene(gladys, scene, { language = 'fr' } = {}) {
  const ids = sceneIds(gladys, scene.id);
  return {
    name: sceneName(scene, language),
    external_id: ids.device,
    should_poll: false,
    params: [{ name: 'MYLINK_SCENE', value: scene.id }],
    features: [button(label(FEATURES.RUN, language), ids.feature(FEATURES.RUN))],
  };
}

/** A value of a command: a finite number, never null nor '' nor a boolean (they are not 0). */
export function numberIn(value, min, max) {
  if (typeof value === 'string' && !/^\s*-?\d+(\.\d+)?\s*$/.test(value)) {
    return undefined;
  }
  if (typeof value !== 'number' && typeof value !== 'string') {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}
