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
  réussie veut dire « acceptée par le pont » (il a répondu). Sans réponse du
  pont, Gladys affiche une erreur « envoyé, mais le pont n'a pas répondu :
  état inconnu » (la commande a pu partir : elle n'est jamais dite « non
  envoyée »).

**Stop et position favorite** : sur un moteur RTS, c'est le même bouton
« my ». Pendant un mouvement, il arrête le volet ; à l'arrêt, il l'envoie à sa
position favorite. Le pont ne sait pas si le volet bouge : appuyer sur stop
quand le volet est immobile le déplace donc vers sa position favorite.

## Arrêt et fermeture

L'arrêt et la fermeture passent **avant** les autres commandes : une lecture
en cours est coupée, et ils n'attendent ni la liste des volets, ni le System ID
validé par une lecture, ni une lecture récente. Le pont n'accepte qu'une
connexion, et l'intégration n'y envoie **qu'une requête à la fois**, chacune
après la réponse du pont à la précédente. Si la requête en cours n'a pas de
réponse depuis une seconde, la connexion est coupée, et l'arrêt ou la
fermeture part sur une nouvelle connexion une fois l'ancienne fermée. Une
scène Gladys sur cinq volets prend donc cinq fois le temps de réponse du pont ;
ce qui n'a pas pu partir dans les 3,5 s est gardé (voir plus bas).

**La plus récente gagne, dès son arrivée** : tout nouveau clic sur un volet
(ouvrir, fermer, stop, position favorite), qu'il parte ou non, annule la
commande gardée de ce volet ; lancer une scène MyLink annule toutes les
commandes gardées.

Ils sont refusés (message d'erreur dans Gladys) dans ces cas, et seulement
ceux-là :

1. l'adresse ou le System ID manque dans la configuration, ou la configuration
   n'a pas encore pu être lue auprès de Gladys (rien n'est envoyé) ;
2. la valeur reçue n'est pas « fermer » ou « stop » ;
3. une commande plus récente du même volet est déjà partie ;
4. le pont répond une erreur ou une réponse inattendue (System ID refusé,
   volet inconnu du pont) : le message le dit ;
5. **stop** écrit sans réponse du pont : erreur « vérifiez le volet » ; il
   n'est **jamais renvoyé** (à l'arrêt, stop envoie le volet à sa position
   favorite) ;
6. **stop** pas parti dans les 3,5 s (pont injoignable, essais toutes les
   250 ms) : il est gardé et réessayé à partir de 4 s, **jamais écrit plus de
   8 s après le clic** (au-delà, le volet a souvent fini sa course et le stop
   le déplacerait vers sa position favorite) ;
7. **fermeture** sans réponse du pont dans les 3,5 s : elle est réécrite sur
   une nouvelle connexion dans ce délai, puis gardée et réessayée 5, 12 et
   25 s après le clic (3 s chaque fois, jusqu'à environ 30 s).

Une commande gardée vit **en mémoire seulement** : si l'intégration redémarre,
elle est perdue, jamais rejouée ; le badge du volet indique alors « non envoyé
ou non confirmé : vérifiez le volet ».

## Ouverture, position favorite, scènes

Elles sont refusées, sans rien envoyer, si : l'adresse ou le System ID manque
ou la configuration n'est pas encore lue ; le pont a refusé le System ID ; le
volet ou la scène n'est pas dans la liste lue sur le pont (bouton Scanner de
l'onglet Découverte) ; 32 commandes attendent déjà ; un arrêt ou une fermeture
plus récent du même volet (pour une scène : de n'importe quel volet) est
arrivé avant leur envoi ; elles n'ont pas pu partir dans les 3,5 s (pont
occupé ou injoignable). Écrites sans réponse du pont, elles s'affichent en
erreur « état inconnu ». Elles ne sont jamais réessayées.

## Sens de chaque volet

Vérifiez le sens de chaque volet avant de vous en servir dans une scène : sur
un moteur câblé à l'envers, « fermer » ouvre. Home Assistant a une option
d'inversion ; elle est prévue ici plus tard.

## System ID refusé

Si le pont refuse le System ID, l'intégration s'arrête de lire le pont (le
refus est gardé dans `/data` sous une marque de 8 bits qui ne permet pas de
retrouver le System ID) jusqu'à ce que vous enregistriez un autre System ID ou
que **Tester la connexion** réussisse, ou que le pont réponde sans erreur à une
commande. L'arrêt et la fermeture sont quand même envoyés.

## Confidentialité

Tout reste sur votre réseau local. `/data` contient l'heure de la dernière
lecture, la liste des volets et des scènes (identifiants et noms), la dernière
commande de chaque volet et les commandes restées « non envoyées » (pour le
badge, jamais renvoyées) ; jamais le System ID.
