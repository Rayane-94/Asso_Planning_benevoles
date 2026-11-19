/**
 * metier/surveillance.ts — Surveille la connexion WhatsApp (CLAUDE.md §6).
 *
 * À chaque tick, on demande à WhatsApp « es-tu connecté ? ». On ne prévient l'équipe que
 * quand l'état CHANGE (connecté → déconnecté, ou l'inverse), jamais à chaque minute.
 * L'état précédent est gardé dans l'état local (il survit aux redémarrages).
 */
import { ELEMENTS_ETAT } from '../sheets/schema.ts';
import { decrireErreur } from '../utils/logger.ts';
import type { Contexte } from './contexte.ts';

const CLE_ETAT = 'surveillance:whatsapp'; // valeur : 'connecte' ou 'deconnecte'

export async function surveillerWhatsApp(ctx: Contexte): Promise<void> {
  let connexion;
  try {
    connexion = await ctx.messagerie.verifierConnexion();
  } catch (erreur) {
    connexion = { ok: false, numero: null, detail: decrireErreur(erreur) };
  }
  const nouvelEtat = connexion.ok ? 'connecte' : 'deconnecte';
  if (ctx.etat.lire(CLE_ETAT) === nouvelEtat) return; // rien n'a changé : on ne dit rien

  const maintenant = ctx.horloge.maintenant();
  if (connexion.ok) {
    await ctx.alertes.lever(ELEMENTS_ETAT.WHATSAPP, '🟢 Connecté', maintenant);
    if (ctx.etat.lire(CLE_ETAT) === 'deconnecte') ctx.logger.info('WhatsApp reconnecté');
  } else {
    await ctx.alertes.declencher({
      id: ELEMENTS_ETAT.WHATSAPP,
      titre: '🔴 Déconnecté',
      conseil: 'Aucun message ne part ! Rescanner le QR code dans WAHA (voir le guide d\'exploitation). ' +
        'Vérifier aussi que le téléphone du bot est allumé et connecté à Internet.',
      depuis: maintenant,
    });
    ctx.logger.erreur(`WhatsApp déconnecté${connexion.detail ? ` : ${connexion.detail}` : ''}`);
  }
  ctx.etat.ecrire(CLE_ETAT, nouvelEtat); // noté APRÈS l'alerte : si elle échoue, on réessaiera
}
