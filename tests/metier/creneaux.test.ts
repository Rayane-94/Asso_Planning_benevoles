/**
 * Les créneaux dans les textes envoyés (étape S3) : liste finale regroupée par créneau,
 * ligne « 🕒 Créneau » des messages privés, détail par créneau dans le récap.
 * On teste directement les fonctions qui fabriquent les textes (pas besoin de Sheet).
 */
import { describe, expect, test } from 'vitest';
import { avecCreneau } from '../../src/metier/confirmations.ts';
import { texteListe } from '../../src/metier/listeFinale.ts';
import { texteRecap } from '../../src/metier/recap.ts';
import type { Action } from '../../src/sheets/actions.ts';
import type { Inscription } from '../../src/sheets/inscriptions.ts';

const MATIN = 'dispo de 10h à 13h';
const APREM = 'dispo de 13h à 16h';

function action(creneaux: string[], statut: Action['statut'] = 'Confirmations envoyées'): Action {
  return {
    numero: 2, id: 'A-0001', type: 'BP', date: '2026-11-28', heure: '10:00', lieu: 'Entrepôt',
    creneaux, places: '', statut, messageId: 'sondage-1',
  };
}

let compteur = 0;
function inscription(nom: string, telephone: string, creneau: string, statut: Inscription['statut'] = 'Confirmé'): Inscription {
  compteur++;
  return {
    numero: compteur + 1, id: `I-0000${compteur}`, actionId: 'A-0001', type: 'BP', date: '2026-11-28', heure: '10:00',
    lieu: 'Entrepôt', telephone, nom, creneau, statut, demandeId: '', misAJour: '',
  };
}

const BOB = inscription('Durand Bob', '33612345678', `${MATIN}, ${APREM}`);
const ALICE = inscription('Martin Alice', '33611223344', APREM);

describe('liste finale', () => {
  test('sans créneaux : une ligne par confirmé, comme avant', () => {
    expect(texteListe(action([]), [inscription('Durand Bob', '33612345678', '')])).toBe(
      'BP – 28/11 – Durand Bob – 06 12 34 56 78',
    );
  });

  test('avec créneaux : regroupée par créneau (ordre du sondage), une personne sur 2 créneaux apparaît 2 fois', () => {
    expect(texteListe(action([MATIN, APREM]), [ALICE, BOB])).toBe([
      'BP – 28/11 – dispo de 10h à 13h – Durand Bob – 06 12 34 56 78',
      'BP – 28/11 – dispo de 13h à 16h – Martin Alice – 06 11 22 33 44',
      'BP – 28/11 – dispo de 13h à 16h – Durand Bob – 06 12 34 56 78',
    ].join('\n'));
  });

  test('créneau inconnu (renommé dans Actions après le vote) : la personne est listée quand même, à la fin', () => {
    const chloe = inscription('Chloé', '33633333333', 'dispo de 9h à 12h');
    expect(texteListe(action([MATIN, APREM]), [chloe, ALICE]).split('\n')).toEqual([
      'BP – 28/11 – dispo de 13h à 16h – Martin Alice – 06 11 22 33 44',
      'BP – 28/11 – dispo de 9h à 12h – Chloé – 06 33 33 33 33',
    ]);
  });

  test('personne : avertissement, avec ou sans créneaux', () => {
    expect(texteListe(action([MATIN]), [])).toBe(
      "⚠️ BP – 28/11 : personne n'a confirmé. Si tu peux venir, contacte le référent.",
    );
  });
});

describe('ligne « 🕒 Créneau » des messages privés', () => {
  test('ajoutée quand la personne a choisi un ou des créneaux', () => {
    expect(avecCreneau('Bonjour Bob', `${MATIN}, ${APREM}`)).toBe('Bonjour Bob\n🕒 Créneau : dispo de 10h à 13h, dispo de 13h à 16h');
  });

  test('absente sans créneau', () => {
    expect(avecCreneau('Bonjour Bob', '')).toBe('Bonjour Bob');
  });
});

describe('récap : détail par créneau', () => {
  const debut = '2026-11-28';
  const fin = '2026-12-04';

  test('confirmés comptés par créneau (une personne compte sur chacun de ses créneaux)', () => {
    const desiste = inscription('David', '33644444444', MATIN, 'Désisté');
    expect(texteRecap([action([MATIN, APREM])], [BOB, ALICE, desiste], debut, fin).split('\n')[1]).toBe(
      '• BP – samedi 28/11 à 10:00 – Entrepôt : 2 confirmés (dispo de 10h à 13h : 1, dispo de 13h à 16h : 2)',
    );
  });

  test('action seulement annoncée : inscrits comptés par créneau', () => {
    const inscrit = inscription('Emma', '33655555555', MATIN, 'Inscrit');
    expect(texteRecap([action([MATIN, APREM], 'Annoncée')], [inscrit], debut, fin).split('\n')[1]).toBe(
      '• BP – samedi 28/11 à 10:00 – Entrepôt : 1 inscrit (dispo de 10h à 13h : 1, dispo de 13h à 16h : 0)',
    );
  });

  test('sans créneaux ou sans personne : pas de détail', () => {
    expect(texteRecap([action([])], [inscription('Bob', '33612345678', '')], debut, fin)).toContain(': 1 confirmé');
    expect(texteRecap([action([MATIN])], [], debut, fin)).toMatch(/: 0 confirmé$/);
  });
});
