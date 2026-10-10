import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';

// Chiffrement des sauvegardes avant leur dépôt hors du serveur (AES-256-GCM).
// Le fichier chiffré ne peut être relu qu'avec la phrase secrète : sans elle,
// la copie externe ne révèle aucune donnée.

const SIGNATURE = Buffer.from('IPAIMSAUV1');
const TAILLE_SEL = 16;
const TAILLE_VECTEUR = 12;
const TAILLE_SCEAU = 16;
export const LONGUEUR_MIN_PHRASE = 16;

const cle = (phrase: string, sel: Buffer) => scryptSync(phrase, sel, 32);

export function chiffrer(contenu: Buffer, phrase: string): Buffer {
  if (phrase.length < LONGUEUR_MIN_PHRASE)
    throw new Error(
      `La phrase secrète doit compter au moins ${LONGUEUR_MIN_PHRASE} caractères`,
    );
  const sel = randomBytes(TAILLE_SEL);
  const vecteur = randomBytes(TAILLE_VECTEUR);
  const chiffreur = createCipheriv('aes-256-gcm', cle(phrase, sel), vecteur);
  const corps = Buffer.concat([chiffreur.update(contenu), chiffreur.final()]);
  return Buffer.concat([
    SIGNATURE,
    sel,
    vecteur,
    chiffreur.getAuthTag(),
    corps,
  ]);
}

export function dechiffrer(contenu: Buffer, phrase: string): Buffer {
  if (!contenu.subarray(0, SIGNATURE.length).equals(SIGNATURE))
    throw new Error("Ce fichier n'est pas une sauvegarde chiffrée reconnue");
  let position = SIGNATURE.length;
  const lire = (taille: number) => {
    const morceau = contenu.subarray(position, position + taille);
    position += taille;
    return morceau;
  };
  const sel = lire(TAILLE_SEL);
  const vecteur = lire(TAILLE_VECTEUR);
  const sceau = lire(TAILLE_SCEAU);
  const dechiffreur = createDecipheriv(
    'aes-256-gcm',
    cle(phrase, sel),
    vecteur,
  );
  dechiffreur.setAuthTag(sceau);
  try {
    return Buffer.concat([
      dechiffreur.update(contenu.subarray(position)),
      dechiffreur.final(),
    ]);
  } catch {
    // Mauvaise phrase, ou fichier altéré : le sceau ne correspond pas.
    throw new Error(
      'Déchiffrement impossible : phrase secrète incorrecte ou fichier altéré',
    );
  }
}
