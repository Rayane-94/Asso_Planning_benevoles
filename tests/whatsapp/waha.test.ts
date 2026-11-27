import { describe, expect, test } from 'vitest';
import {
  convertirWebhook, convertirWebhookVote, idCourt, MessagerieWaha, telephoneDepuisIdentifiant, versChatId, type Fetch,
} from '../../src/whatsapp/waha.ts';
import {
  BENEVOLE, copie, GROUPE, ID_ANNONCE, ID_SONDAGE, messageDuBot, messagePrive, reponseCiteeDansLeGroupe, statutSession,
  voteSondage,
} from './exemplesWaha.ts';

describe('convertirWebhook : du JSON de WAHA vers un MessageRecu', () => {
  test('réponse citée dans le groupe : vrai numéro (SenderAlt), ID court cité, nom WhatsApp', () => {
    expect(convertirWebhook(reponseCiteeDansLeGroupe)).toEqual({
      id: 'ACD54338BDF3D3994A704555DBC6E65A',
      discussionId: GROUPE,
      estGroupe: true,
      telephone: BENEVOLE.numero,
      idBrut: BENEVOLE.lid,
      nomWhatsApp: BENEVOLE.nom,
      texte: 'oui',
      citeId: ID_ANNONCE,
      date: new Date(1795118988 * 1000),
    });
  });

  test('message privé : discussion = le numéro, pas de citation', () => {
    expect(convertirWebhook(messagePrive)).toMatchObject({
      estGroupe: false, discussionId: BENEVOLE.numero, telephone: BENEVOLE.numero, citeId: null, texte: 'oui',
    });
  });

  test('numéro masqué (pas de SenderAlt) : telephone = null, le LID reste dans idBrut', () => {
    const sansNumero = copie(reponseCiteeDansLeGroupe);
    delete (sansNumero.payload._data.Info as Partial<typeof sansNumero.payload._data.Info>).SenderAlt;
    const message = convertirWebhook(sansNumero);
    expect(message?.telephone).toBeNull();
    expect(message?.idBrut).toBe(BENEVOLE.lid);
  });

  test('ID cité au format long : ramené au format court', () => {
    const variante = copie(reponseCiteeDansLeGroupe);
    variante.payload.replyTo.id = `true_${GROUPE}_${ID_ANNONCE}_111@lid`;
    expect(convertirWebhook(variante)?.citeId).toBe(ID_ANNONCE);
  });

  test.each([
    ['un message envoyé par le bot lui-même (fromMe)', messageDuBot],
    ['un changement d\'état de session', statutSession],
    ['n\'importe quoi', { hello: 'world' }],
    ['rien du tout', null],
  ])('ignore %s', (_cas, evenement) => {
    expect(convertirWebhook(evenement)).toBeNull();
  });

  test('ignore un message sans texte (photo sans légende, sticker…)', () => {
    const photo = copie(messagePrive);
    photo.payload.body = '';
    expect(convertirWebhook(photo)).toBeNull();
  });
});

describe('convertirWebhookVote : du JSON de WAHA vers un VoteRecu', () => {
  test('vote dans le sondage : ID court du sondage, vrai numéro (SenderAlt), choix en clair', () => {
    expect(convertirWebhookVote(voteSondage)).toEqual({
      id: 'ACVOTE0000000000000000000000001',
      sondageId: ID_SONDAGE,
      discussionId: GROUPE,
      telephone: BENEVOLE.numero,
      idBrut: BENEVOLE.lid,
      nomWhatsApp: BENEVOLE.nom,
      choix: ['dispo de 10h à 13h', 'dispo de 13h à 16h'],
      date: new Date(1795200000 * 1000),
    });
  });

  test('vote retiré : choix = []', () => {
    const retire = copie(voteSondage);
    retire.payload.vote.selectedOptions = [];
    expect(convertirWebhookVote(retire)?.choix).toEqual([]);
  });

  test('sans payload.poll : l\'ID du sondage est pris dans le message de vote', () => {
    const variante = copie(voteSondage);
    delete (variante.payload as Partial<typeof variante.payload>).poll;
    expect(convertirWebhookVote(variante)?.sondageId).toBe(ID_SONDAGE);
  });

  test('numéro masqué (pas de SenderAlt) : telephone = null', () => {
    const sansNumero = copie(voteSondage);
    delete (sansNumero.payload._data.Info as Partial<typeof sansNumero.payload._data.Info>).SenderAlt;
    expect(convertirWebhookVote(sansNumero)?.telephone).toBeNull();
  });

  test('horodatage en millisecondes : accepté aussi', () => {
    const variante = copie(voteSondage);
    variante.payload.vote.timestamp = 1795200000123;
    expect(convertirWebhookVote(variante)?.date).toEqual(new Date(1795200000123));
  });

  test.each([
    ['un vote du bot lui-même (fromMe)', (() => { const v = copie(voteSondage); v.payload.vote.fromMe = true; return v; })()],
    ['un message (pas un vote)', reponseCiteeDansLeGroupe],
    ['un changement d\'état de session', statutSession],
    ['rien du tout', null],
  ])('ignore %s', (_cas, evenement) => {
    expect(convertirWebhookVote(evenement)).toBeNull();
  });

  test('un vote n\'est jamais pris pour un message', () => {
    expect(convertirWebhook(voteSondage)).toBeNull();
  });
});

describe('formats d\'identifiants WhatsApp', () => {
  test.each([
    ['33612345678@c.us', '33612345678'],
    ['33612345678@s.whatsapp.net', '33612345678'],
    ['33612345678:11@s.whatsapp.net', '33612345678'], // « :11 » = numéro d'appareil
    ['273667112104190@lid', null], // identifiant masqué : ce n'est PAS un numéro
    ['120363000000000001@g.us', null], // un groupe
    ['', null],
  ])('telephoneDepuisIdentifiant(« %s ») → %s', (identifiant, attendu) => {
    expect(telephoneDepuisIdentifiant(identifiant)).toBe(attendu);
  });

  test('idCourt', () => {
    expect(idCourt(`true_${GROUPE}_${ID_ANNONCE}_111@lid`)).toBe(ID_ANNONCE);
    expect(idCourt(`false_222@lid_${ID_ANNONCE}`)).toBe(ID_ANNONCE);
    expect(idCourt(ID_ANNONCE)).toBe(ID_ANNONCE);
  });

  test('versChatId', () => {
    expect(versChatId('33612345678')).toBe('33612345678@c.us');
    expect(versChatId(GROUPE)).toBe(GROUPE);
  });
});

describe('MessagerieWaha (avec un faux WAHA)', () => {
  const CONFIG = { url: 'http://waha:3000', cleApi: 'cle-de-test', session: 'default' };

  /** Faux fetch : note les appels et renvoie la réponse prévue. */
  function fauxWaha(reponses: Record<string, { status?: number; corps: unknown }>) {
    const appels: { url: string; methode: string; corps: unknown; cle: string | null }[] = [];
    const fetchFn: Fetch = async (url, init) => {
      const chemin = String(url).replace(CONFIG.url, '');
      appels.push({
        url: chemin, methode: init?.method ?? 'GET',
        corps: init?.body ? JSON.parse(String(init.body)) : undefined,
        cle: new Headers(init?.headers).get('X-Api-Key'),
      });
      const prevue = reponses[chemin];
      if (!prevue) return new Response('introuvable', { status: 404 });
      return new Response(JSON.stringify(prevue.corps), { status: prevue.status ?? 200 });
    };
    return { messagerie: new MessagerieWaha(CONFIG, fetchFn), appels };
  }

  test('envoyerTexte : bonne requête (clé, session, chatId) et renvoie l\'ID COURT', async () => {
    const { messagerie, appels } = fauxWaha({
      '/api/sendText': { status: 201, corps: { id: `true_${GROUPE}_${ID_ANNONCE}_111@lid` } },
    });
    const id = await messagerie.envoyerTexte(GROUPE, '📣 BP – samedi 28/11');
    expect(id).toBe(ID_ANNONCE);
    expect(appels).toEqual([{
      url: '/api/sendText', methode: 'POST', cle: 'cle-de-test',
      corps: { session: 'default', chatId: GROUPE, text: '📣 BP – samedi 28/11' },
    }]);
  });

  test('retrouverTelephone : demande l\'annuaire LID → numéro de WAHA (route /lids/{lid})', async () => {
    const { messagerie, appels } = fauxWaha({
      [`/api/default/lids/${encodeURIComponent(BENEVOLE.lid)}`]: { corps: { lid: BENEVOLE.lid, pn: `${BENEVOLE.numero}@c.us` } },
    });
    expect(await messagerie.retrouverTelephone(BENEVOLE.lid)).toBe(BENEVOLE.numero);
    expect(appels[0]).toMatchObject({ methode: 'GET', cle: 'cle-de-test' });
  });

  test('retrouverTelephone : LID inconnu de WAHA → null (jamais d\'erreur)', async () => {
    const { messagerie } = fauxWaha({}); // 404
    expect(await messagerie.retrouverTelephone(BENEVOLE.lid)).toBeNull();
  });

  test('retrouverTelephone : un vrai numéro (…@c.us) est rendu tel quel, sans appeler WAHA', async () => {
    const { messagerie, appels } = fauxWaha({});
    expect(await messagerie.retrouverTelephone(`${BENEVOLE.numero}@c.us`)).toBe(BENEVOLE.numero);
    expect(appels).toEqual([]);
  });

  test('envoyerSondage : requête au format du spike (poll.name / options / multipleAnswers), renvoie l\'ID COURT', async () => {
    const { messagerie, appels } = fauxWaha({
      '/api/sendPoll': { status: 201, corps: { id: `true_${GROUPE}_3EB06AE4FF8398BBED51EC_33700000001@c.us` } },
    });
    const id = await messagerie.envoyerSondage(GROUPE, 'BP – samedi 28/11 à 14:00', ['dispo de 10h à 13h', 'pas dispo :/'], true);
    expect(id).toBe('3EB06AE4FF8398BBED51EC');
    expect(appels[0]).toEqual({
      url: '/api/sendPoll', methode: 'POST', cle: 'cle-de-test',
      corps: {
        session: 'default', chatId: GROUPE,
        poll: { name: 'BP – samedi 28/11 à 14:00', options: ['dispo de 10h à 13h', 'pas dispo :/'], multipleAnswers: true },
      },
    });
  });

  test('envoyerTexte vers un numéro : converti en …@c.us', async () => {
    const { messagerie, appels } = fauxWaha({ '/api/sendText': { corps: { id: 'true_33612345678@c.us_ABC' } } });
    await messagerie.envoyerTexte('33612345678', 'Bonjour');
    expect((appels[0].corps as { chatId: string }).chatId).toBe('33612345678@c.us');
  });

  test('erreur 401 : message qui pointe vers la clé d\'API', async () => {
    const { messagerie } = fauxWaha({ '/api/sendText': { status: 401, corps: { message: 'Unauthorized' } } });
    await expect(messagerie.envoyerTexte(GROUPE, 'x')).rejects.toThrow('vérifier WAHA_API_KEY');
  });

  test('WAHA arrêté : erreur « WAHA injoignable »', async () => {
    const messagerie = new MessagerieWaha(CONFIG, async () => { throw new Error('ECONNREFUSED'); });
    await expect(messagerie.envoyerTexte(GROUPE, 'x')).rejects.toThrow('WAHA injoignable');
  });

  test('listerGroupes : comprend le format du moteur GOWS (JID / Name)', async () => {
    const { messagerie } = fauxWaha({
      '/api/default/groups': { corps: [{ JID: GROUPE, Name: 'Test bot bénévoles', Participants: [] }] },
    });
    expect(await messagerie.listerGroupes()).toEqual([{ id: GROUPE, nom: 'Test bot bénévoles', genre: 'groupe' }]);
  });

  test('listerGroupes : comprend aussi le format général (objet { id: { subject } })', async () => {
    const { messagerie } = fauxWaha({ '/api/default/groups': { corps: { [GROUPE]: { id: GROUPE, subject: 'Bénévoles' } } } });
    expect(await messagerie.listerGroupes()).toEqual([{ id: GROUPE, nom: 'Bénévoles', genre: 'groupe' }]);
  });

  test('listerGroupes : distingue la communauté, son canal d\'annonces et ses sous-groupes (même nom)', async () => {
    // Structure du test réel du 23/11/2026 (IDs anonymisés) : la communauté et son canal
    // d'annonces portent le même nom ; seul le canal d'annonces peut recevoir les annonces.
    const { messagerie } = fauxWaha({
      '/api/default/groups': {
        corps: [
          { JID: '120000000000000001@g.us', Name: 'Asso', IsParent: true },
          { JID: '120000000000000002@g.us', Name: 'Asso', IsAnnounce: true, IsDefaultSubGroup: true, LinkedParentJID: '120000000000000001@g.us' },
          { JID: '120000000000000003@g.us', Name: 'Discussions', LinkedParentJID: '120000000000000001@g.us' },
        ],
      },
    });
    expect(await messagerie.listerGroupes()).toEqual([
      { id: '120000000000000001@g.us', nom: 'Asso', genre: 'communaute' },
      { id: '120000000000000002@g.us', nom: 'Asso', genre: 'annonces', communaute: 'Asso' },
      { id: '120000000000000003@g.us', nom: 'Discussions', genre: 'groupe', communaute: 'Asso' },
    ]);
  });

  test('verifierConnexion : WORKING → connecté, avec le numéro du bot', async () => {
    const { messagerie } = fauxWaha({ '/api/sessions/default': { corps: { status: 'WORKING', me: { id: '33700000001@c.us' } } } });
    expect(await messagerie.verifierConnexion()).toEqual({ ok: true, numero: '33700000001' });
  });

  test('verifierConnexion : SCAN_QR_CODE → déconnecté, avec la marche à suivre', async () => {
    const { messagerie } = fauxWaha({ '/api/sessions/default': { corps: { status: 'SCAN_QR_CODE' } } });
    const etat = await messagerie.verifierConnexion();
    expect(etat.ok).toBe(false);
    expect(etat.detail).toContain('QR code à rescanner');
  });

  test('verifierConnexion : ne lève jamais d\'erreur, même si WAHA est arrêté', async () => {
    const messagerie = new MessagerieWaha(CONFIG, async () => { throw new Error('ECONNREFUSED'); });
    const etat = await messagerie.verifierConnexion();
    expect(etat).toMatchObject({ ok: false, numero: null });
    expect(etat.detail).toContain('WAHA injoignable');
  });
});
