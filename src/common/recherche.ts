// Recherche souple : on retrouve quelqu'un sans taper exactement son nom.
//  - accents et majuscules ignorés (« gerard » trouve « Gérard ») ;
//  - mots dans n'importe quel ordre, nom et prénom mélangés
//    (« dominique dinga » trouve DINGA Dominique) ;
//  - début de mot suffisant (« domin ») ;
//  - fautes de frappe et graphies proches tolérées (« dominik », « filipe »),
//    mais seulement quand rien ne correspond directement, pour ne pas noyer
//    les bons résultats.
import type { PrismaService } from '../prisma/prisma.service';

export type Fiche = { id: string; textes: Array<string | null | undefined> };

export const normaliser = (valeur: string) =>
  valeur
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Forme « sonore » d'un mot : ph/f, qu/k, c dur/k, y/i, h muet, lettres doublées.
const phonetique = (mot: string) =>
  mot
    .replace(/ph/g, 'f')
    .replace(/qu/g, 'k')
    .replace(/c(?=[aou]|$)/g, 'k')
    .replace(/ck/g, 'k')
    .replace(/y/g, 'i')
    .replace(/h/g, '')
    .replace(/(.)\1+/g, '$1');

const distance = (a: string, b: string) => {
  const ligne = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let precedent = ligne[0];
    ligne[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const courant = ligne[j];
      ligne[j] = Math.min(
        ligne[j] + 1,
        ligne[j - 1] + 1,
        precedent + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      precedent = courant;
    }
  }
  return ligne[b.length];
};

const tolerance = (longueur: number) =>
  longueur < 4 ? 0 : longueur < 7 ? 1 : 2;

// Correspondance directe : début d'un mot, morceau du texte, ou numéro saisi
// avec ou sans espaces (téléphone, matricule).
const direct = (
  terme: string,
  mots: string[],
  texte: string,
  compact: string,
) =>
  texte.includes(terme) ||
  mots.some((mot) => mot.startsWith(terme)) ||
  (/\d/.test(terme) && compact.includes(terme));

// Correspondance approchée d'un mot : même son, ou quelques lettres de
// différence avec le mot entier ou avec son début. Les chiffres (téléphones,
// matricules) ne sont jamais approchés.
const approche = (sonore: string, marge: number, mot: string) => {
  if (/\d/.test(mot)) return false;
  const forme = phonetique(mot);
  return (
    forme.startsWith(sonore) ||
    (Math.abs(forme.length - sonore.length) <= marge &&
      distance(sonore, forme) <= marge) ||
    (forme.length > sonore.length &&
      distance(sonore, forme.slice(0, sonore.length)) <= marge)
  );
};

// Identifiants des fiches qui correspondent : les correspondances directes,
// ou, s'il n'y en a aucune, les approchées.
export function rechercheSouple(fiches: Fiche[], requete: string, max = 500) {
  const termes = normaliser(requete).split(' ').filter(Boolean);
  if (!termes.length) return [];
  const preparees = fiches.map((fiche) => {
    const texte = normaliser(fiche.textes.filter(Boolean).join(' '));
    return {
      id: fiche.id,
      texte,
      mots: texte.split(' '),
      compact: texte.replace(/ /g, ''),
    };
  });
  const directes = preparees
    .filter((fiche) =>
      termes.every((terme) =>
        direct(terme, fiche.mots, fiche.texte, fiche.compact),
      ),
    )
    .map((fiche) => fiche.id);
  if (directes.length) return directes.slice(0, max);

  // Aucun résultat exact : on tolère les fautes de frappe. Les noms se
  // répètent beaucoup ; chaque mot n'est évalué qu'une fois par terme.
  const sons = termes.map((terme) => ({
    terme,
    sonore: phonetique(terme),
    marge: tolerance(terme.length),
    deja: new Map<string, boolean>(),
  }));
  const approchees: string[] = [];
  for (const fiche of preparees) {
    const ok = sons.every(({ terme, sonore, marge, deja }) => {
      if (direct(terme, fiche.mots, fiche.texte, fiche.compact)) return true;
      if (!marge) return false;
      return fiche.mots.some((mot) => {
        let resultat = deja.get(mot);
        if (resultat === undefined) {
          resultat = approche(sonore, marge, mot);
          deja.set(mot, resultat);
        }
        return resultat;
      });
    });
    if (ok) approchees.push(fiche.id);
    if (approchees.length >= max) break;
  }
  return approchees;
}

// Personnes (étudiants, candidats, prospects) qui correspondent à la saisie.
export async function personnesCorrespondantes(
  prisma: PrismaService,
  requete: string,
) {
  const personnes = await prisma.personne.findMany({
    select: {
      id: true,
      nom: true,
      prenom: true,
      telephone: true,
      matricule: true,
    },
  });
  return rechercheSouple(
    personnes.map((item) => ({
      id: item.id,
      textes: [item.nom, item.prenom, item.telephone, item.matricule],
    })),
    requete,
  );
}
