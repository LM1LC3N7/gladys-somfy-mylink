# Somfy MyLink pour Gladys

Cette intégration pilote vos volets et stores à moteur **Somfy RTS** par le
**pont Somfy MyLink**, sur votre réseau local : ouverture, fermeture, arrêt,
position favorite (« my ») et scènes MyLink. Elle parle à l'API « Synergy » du
pont (TCP, port 44100) ; le cloud Somfy n'est pas utilisé.

> **Non officiel**, sans lien avec Somfy. L'intégration n'a **jamais été
> testée avec un vrai pont** pour l'instant : elle suit le protocole de la
> bibliothèque pysomfymylink (celle de Home Assistant). Vos retours sont les
> bienvenus.

## Avant de commencer

1. Installez le pont et vos volets dans l'application **MyLink**.
2. Dans l'application, menu **Intégration**, notez le **System ID**.
3. Donnez au pont une adresse IP fixe dans votre box (réservation DHCP).

## Configuration

- **Adresse du pont** : son adresse IP, par exemple `192.168.1.60` (port
  44100 par défaut ; `192.168.1.60:44100` est accepté).
- **System ID** : gardé par Gladys dans sa base, jamais réaffiché, envoyé
  seulement à votre pont. Il n'apparaît dans aucun journal, aucun statut ni
  dans `/data`.
- **Intervalle de lecture** (60 à 3600 s, 300 par défaut) : la liste des
  volets et des scènes est relue à ce rythme, seulement pour savoir si le pont
  répond.
- **Langue** des noms des fonctionnalités.

Le bouton **Tester la connexion** relit le pont (au plus une fois par minute).

## Ce que vous obtenez

- Un **volet** par moteur du pont : `Ouverture / fermeture` (ouvrir, fermer,
  stop) et un bouton `Position favorite (my)`.
- Un **bouton** par scène MyLink (`Lancer`).

Jamais d'interrupteur : un « tout éteindre » n'atteint pas vos volets.

## L'état est supposé, jamais confirmé

Les moteurs RTS sont à **sens unique** : ils ne renvoient ni leur état ni leur
position, et le pont dit seulement qu'il a pris la commande. Donc :

- il n'y a **pas de position** dans Gladys ;
- la valeur que Gladys affiche pour `Ouverture / fermeture` est la **dernière
  commande envoyée**, pas un état mesuré : un volet indiqué « fermé » a reçu
  l'ordre de fermer, rien de plus (télécommande, obstacle, protection
  thermique du moteur peuvent l'avoir changé) ;
- le badge de chaque volet (point orange) dit « État supposé » avec la
  dernière commande et si le pont l'a acceptée ;
- aucune commande ne peut être « confirmée par une relecture » : une commande
  réussie veut dire « acceptée par le pont », et sans réponse du pont elle est
  dite « envoyée, sans réponse du pont », jamais « non envoyée ».

**Stop et position favorite** : sur un moteur RTS, c'est le même bouton
« my ». Pendant un mouvement, il arrête le volet ; à l'arrêt, il l'envoie à sa
position favorite. Le pont ne sait pas si le volet bouge : appuyer sur stop
quand le volet est immobile le déplace donc vers sa position favorite.

## Arrêt et fermeture

L'arrêt et la fermeture passent **avant** tout le reste : une lecture en cours
est coupée, une connexion sans réponse depuis une seconde est fermée puis
rouverte, et ils n'attendent ni la liste des volets, ni le System ID validé
par une lecture, ni une lecture récente. Un seul échange à la fois avec le
pont (il n'accepte qu'une connexion) ; plusieurs commandes simultanées (une
scène Gladys sur cinq volets) partent à la suite sur la même connexion.

Ils sont refusés dans ces cas, et seulement ceux-là :

1. l'adresse ou le System ID manque dans la configuration (rien n'est envoyé) ;
2. la valeur reçue n'est pas « fermer » ou « stop » ;
3. une commande plus récente du même volet est déjà partie (la plus récente
   gagne) ;
4. le pont répond une erreur (System ID refusé, volet inconnu du pont) : le
   message le dit ;
5. le pont n'a pas pu être joint dans les 3,5 s qui suivent le clic (essais
   toutes les 250 ms) : la commande est alors **gardée** et réessayée 2, 5 et
   10 s plus tard. Une fermeture gardée est notée dans `/data` et repart
   après un redémarrage, dans les deux minutes du clic. Un arrêt gardé est
   abandonné 15 s après le clic : plus tard, le volet a fini sa course et le
   « stop » le déplacerait vers sa position favorite.

## Ouverture, position favorite, scènes

Elles sont refusées, sans rien envoyer, si : l'adresse ou le System ID manque ;
le pont a refusé le System ID ; le volet ou la scène n'est pas dans la liste
lue sur le pont (bouton Scanner de l'onglet Découverte) ; 32 commandes
attendent déjà ; un arrêt ou une fermeture plus récent du même volet est
arrivé avant leur envoi ; elles n'ont pas pu partir dans les 3,5 s (pont
occupé ou injoignable). Elles ne sont jamais réessayées.

## System ID refusé

Si le pont refuse le System ID, l'intégration s'arrête de lire le pont (le
refus est gardé dans `/data` sous une marque de 8 bits qui ne permet pas de
retrouver le System ID) jusqu'à ce que vous enregistriez un autre System ID ou
que **Tester la connexion** réussisse. L'arrêt et la fermeture sont quand même
envoyés.

## Confidentialité

Tout reste sur votre réseau local. `/data` contient l'heure de la dernière
lecture, la liste des volets et des scènes (identifiants et noms), la dernière
commande de chaque volet et les fermetures gardées ; jamais le System ID.
