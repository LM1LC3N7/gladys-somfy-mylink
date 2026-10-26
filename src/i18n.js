// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, refusals of commands, badges,
// feature names), in English and French. Never an address nor the System ID.
// -----------------------------------------------------------------------------

import { LIMITS } from './constants.js';

/** Feature names, by key. */
const LABELS = {
  state: { en: 'Open / close', fr: 'Ouverture / fermeture' },
  favorite: { en: 'Favourite position (my)', fr: 'Position favorite (my)' },
  run: { en: 'Run', fr: 'Lancer' },
};

/** The label of a key in a language. */
export function label(key, language = 'fr') {
  return LABELS[key]?.[language] ?? LABELS[key]?.en ?? key;
}

/** One text of a { en, fr } pair, in a language. */
export const word = (pair, language = 'fr') => pair?.[language] ?? pair?.en ?? '';

/** Pairs joined by a space (undefined ones skipped). */
export const join = (...pairs) => {
  const list = pairs.filter(Boolean);
  return {
    en: list.map((p) => p.en).join(' '),
    fr: list.map((p) => p.fr).join(' '),
  };
};

/** A duration: "45 s", "3 min", "2 h" (59.99 s is "1 min", never "60 s"). */
export function age(ms) {
  const s = Math.max(1, Math.ceil(ms / 1000));
  if (s < 60) {
    return `${s} s`;
  }
  const min = Math.ceil(s / 60);
  return min < 90 ? `${min} min` : `${Math.round(min / 60)} h`;
}

export const trim = (pair, max = LIMITS.badgeMessage) => ({
  en: pair.en.length > max ? `${pair.en.slice(0, max - 1)}…` : pair.en,
  fr: pair.fr.length > max ? `${pair.fr.slice(0, max - 1)}…` : pair.fr,
});

/** Why the bridge failed, in English and French (never an address). */
export function reasonOf(err) {
  switch (err?.kind) {
    case 'unreachable':
      return { en: 'no connection', fr: 'pas de connexion' };
    case 'timeout':
      return { en: 'no answer in time', fr: 'pas de réponse à temps' };
    case 'closed':
      return { en: 'connection closed by the bridge', fr: 'connexion fermée par le pont' };
    case 'stale':
      return { en: 'no answer, connection cut', fr: 'pas de réponse, connexion coupée' };
    case 'preempted':
      return { en: 'cut by a command', fr: 'coupée par une commande' };
    case 'unexpected':
      return { en: 'unexpected answer of the bridge', fr: 'réponse inattendue du pont' };
    case 'tooLarge':
      return { en: 'answer too large', fr: 'réponse trop grande' };
    case 'format':
      return { en: 'not a MyLink answer', fr: 'réponse qui n’est pas celle d’un MyLink' };
    case 'auth':
      return { en: 'System ID refused by the bridge', fr: 'System ID refusé par le pont' };
    case 'api':
      return {
        en: `error of the bridge${err.code !== undefined ? ` (code ${err.code})` : ''}`,
        fr: `erreur du pont${err.code !== undefined ? ` (code ${err.code})` : ''}`,
      };
    default:
      return { en: 'unexpected error', fr: 'erreur inattendue' };
  }
}

const COMMAND_WORDS = {
  open: { en: 'open', fr: 'ouvrir' },
  close: { en: 'close', fr: 'fermer' },
  stop: { en: 'stop', fr: 'stop' },
  favorite: { en: 'favourite position', fr: 'position favorite' },
  scene: { en: 'scene', fr: 'scène' },
};

export const commandWord = (command) => COMMAND_WORDS[command] ?? { en: command, fr: command };

export const T = {
  noAddress: {
    en: 'Type the IP address of your MyLink bridge and its System ID, then save.',
    fr: 'Saisissez l’adresse IP de votre pont MyLink et son System ID, puis enregistrez.',
  },
  noSystemId: {
    en: 'Type the System ID of the bridge (MyLink app: Integration), then save.',
    fr: 'Saisissez le System ID du pont (application MyLink : Intégration), puis enregistrez.',
  },
  invalid: (length) => ({
    en: `The address typed (${length} characters) is not valid: type an IP address like 192.168.1.60.`,
    fr: `L’adresse saisie (${length} caractères) n’est pas valide : saisissez une adresse IP comme 192.168.1.60.`,
  }),
  local: {
    en: 'Names in .local do not resolve in the container: type the IP address.',
    fr: 'Les noms en .local ne se résolvent pas dans le conteneur : saisissez l’adresse IP.',
  },
  credentialsInHost: {
    en: 'The address must not hold a user name or a password: type the IP address only.',
    fr: 'L’adresse ne doit contenir ni nom d’utilisateur ni mot de passe : saisissez seulement l’adresse IP.',
  },
  systemIdInvalid: {
    en: 'The System ID typed is not valid (printable characters only, 64 at most, no space).',
    fr: 'Le System ID saisi n’est pas valide (caractères imprimables seulement, 64 au plus, sans espace).',
  },
  refused: {
    en: 'The bridge refused the System ID: copy it again from the MyLink app (Integration), save, or press "Test the connection". No read until then.',
    fr: 'Le pont a refusé le System ID : recopiez-le depuis l’application MyLink (Intégration), enregistrez, ou appuyez sur « Tester la connexion ». Aucune lecture d’ici là.',
  },
  connected: ({ shades, scenes, interval }) => ({
    en: `Connected: ${shades} shade(s), ${scenes} scene(s), read every ${interval} s. RTS motors give no feedback: states are assumed.`,
    fr: `Connecté : ${shades} volet(s), ${scenes} scène(s), lus toutes les ${interval} s. Les moteurs RTS ne renvoient rien : les états sont supposés.`,
  }),
  unreachable: (reason, wait) => ({
    en: `Bridge not reachable (${reason.en}); next read in ${wait}. Stop and close are still sent.`,
    fr: `Pont injoignable (${reason.fr}) ; prochaine lecture dans ${wait}. L’arrêt et la fermeture partent quand même.`,
  }),
  connecting: {
    en: 'Reading the bridge…',
    fr: 'Lecture du pont…',
  },
  configRetry: (wait) => ({
    en: `The configuration could not be read from Gladys; tried again in ${wait}.`,
    fr: `La configuration n’a pas pu être lue auprès de Gladys ; nouvel essai dans ${wait}.`,
  }),
  test: {
    recent: (wait) => ({
      en: `Read less than a minute ago: next read possible in ${wait}.`,
      fr: `Lu il y a moins d’une minute : prochaine lecture possible dans ${wait}.`,
    }),
  },
  badge: {
    none: {
      en: 'Assumed state: RTS motors give no feedback, no command sent yet.',
      fr: 'État supposé : les moteurs RTS ne renvoient rien, aucune commande envoyée.',
    },
    assumed: (command, answered) => ({
      en: `Assumed state: last command "${command.en}" ${answered ? 'accepted by the bridge' : 'sent, the bridge did not answer'}; never confirmed (RTS: no feedback).`,
      fr: `État supposé : dernière commande « ${command.fr} » ${answered ? 'acceptée par le pont' : 'envoyée, sans réponse du pont'} ; jamais confirmée (RTS : pas de retour).`,
    }),
    held: (command) =>
      command.en === 'stop'
        ? {
            en: '"stop" not confirmed yet: tried again until 8 s after the click; a new click on this shade cancels it.',
            fr: '« stop » pas encore confirmé : nouvel essai jusqu’à 8 s après le clic ; un nouveau clic sur ce volet l’annule.',
          }
        : {
            en: `"${command.en}" not confirmed yet: tried again until about 30 s after the click; a new click on this shade cancels it.`,
            fr: `« ${command.fr} » pas encore confirmé : nouveaux essais jusqu’à environ 30 s après le clic ; un nouveau clic sur ce volet les annule.`,
          },
    lost: (command) => ({
      en: `"${command.en}" not sent or not confirmed (bridge not reachable, or the integration restarted): check the shade.`,
      fr: `« ${command.fr} » non envoyé ou non confirmé (pont injoignable, ou intégration redémarrée) : vérifiez le volet.`,
    }),
  },
};

/** Refusals of a command (the real cause, never "the bridge did not answer" when nothing was asked). */
export const ERRORS = {
  generic: { en: 'Unexpected error.', fr: 'Erreur inattendue.' },
  readOnly: { en: 'This feature cannot be set.', fr: 'Cette fonctionnalité ne se commande pas.' },
  badValue: { en: 'Unexpected value.', fr: 'Valeur inattendue.' },
  notConfigured: {
    en: 'Not sent: the address or the System ID of the bridge is missing.',
    fr: 'Non envoyé : l’adresse ou le System ID du pont manque.',
  },
  refused: {
    en: 'Not sent: the bridge refused the System ID (see the configuration).',
    fr: 'Non envoyé : le pont a refusé le System ID (voir la configuration).',
  },
  unknownShade: {
    en: 'Not sent: this shade is not in the list read from the bridge (press Scan in the Discovery tab).',
    fr: 'Non envoyé : ce volet n’est pas dans la liste lue sur le pont (bouton Scanner de l’onglet Découverte).',
  },
  unknownScene: {
    en: 'Not sent: this scene is not in the list read from the bridge.',
    fr: 'Non envoyé : cette scène n’est pas dans la liste lue sur le pont.',
  },
  queueFull: {
    en: 'Not sent: too many commands are waiting for the bridge.',
    fr: 'Non envoyé : trop de commandes attendent le pont.',
  },
  configNotRead: {
    en: 'Not sent: the configuration was not read from Gladys yet (tried again every 30 s).',
    fr: 'Non envoyé : la configuration n’a pas encore été lue auprès de Gladys (nouvel essai toutes les 30 s).',
  },
  cancelled: {
    newerProtective: {
      en: 'Not sent: a newer stop or close of this shade came first.',
      fr: 'Non envoyé : un arrêt ou une fermeture plus récent de ce volet est passé avant.',
    },
    newerLeft: {
      en: 'Not sent: a newer command of this shade left first.',
      fr: 'Non envoyé : une commande plus récente de ce volet est partie avant.',
    },
    sceneAfter: {
      en: 'Not sent: a stop or close of a shade arrived after this scene was launched.',
      fr: 'Non envoyé : un arrêt ou une fermeture d’un volet est arrivé après le lancement de cette scène.',
    },
  },
  noReply: {
    en: 'Sent, but the bridge did not answer: state unknown.',
    fr: 'Envoyé, mais le pont n’a pas répondu : état inconnu.',
  },
  stopNoReply: {
    en: 'Stop sent, but the bridge did not answer: check the shade (a stop is never sent twice: at rest it moves the shade to its favourite position).',
    fr: 'Stop envoyé, mais le pont n’a pas répondu : vérifiez le volet (un stop n’est jamais envoyé deux fois : à l’arrêt il envoie le volet à sa position favorite).',
  },
  notSent: (reason) => ({
    en: `Not sent: ${reason.en}.`,
    fr: `Non envoyé : ${reason.fr}.`,
  }),
  late: {
    en: 'Not sent: the bridge was busy or not reachable in time.',
    fr: 'Non envoyé : le pont était occupé ou injoignable à temps.',
  },
  rejected: (reason) => ({
    en: `The bridge refused the command: ${reason.en}.`,
    fr: `Le pont a refusé la commande : ${reason.fr}.`,
  }),
  heldStop: (reason) => ({
    en: `Stop not sent yet (${reason.en}): tried again until 8 s after the click, never later; a new click on this shade cancels it.`,
    fr: `Stop pas encore envoyé (${reason.fr}) : nouvel essai jusqu’à 8 s après le clic, jamais plus tard ; un nouveau clic sur ce volet l’annule.`,
  }),
  heldClose: (reason) => ({
    en: `Close not confirmed (${reason.en}): tried again 5, 12 and 25 s after the click (until about 30 s), lost if the integration restarts; a new click on this shade cancels it.`,
    fr: `Fermeture non confirmée (${reason.fr}) : nouveaux essais 5, 12 et 25 s après le clic (jusqu’à environ 30 s), perdus si l’intégration redémarre ; un nouveau clic sur ce volet les annule.`,
  }),
};
