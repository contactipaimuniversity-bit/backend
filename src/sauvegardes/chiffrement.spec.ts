import { chiffrer, dechiffrer } from './chiffrement';

const phrase = 'une phrase secrète assez longue';

describe('chiffrement des sauvegardes', () => {
  it('restitue exactement le fichier d’origine avec la bonne phrase', () => {
    const contenu = Buffer.from('données de la base '.repeat(500));
    const chiffre = chiffrer(contenu, phrase);
    expect(chiffre.includes(Buffer.from('données de la base'))).toBe(false);
    expect(dechiffrer(chiffre, phrase).equals(contenu)).toBe(true);
  });

  it('refuse une mauvaise phrase et un fichier altéré', () => {
    const chiffre = chiffrer(Buffer.from('contenu'), phrase);
    expect(() => dechiffrer(chiffre, 'une autre phrase secrète!!')).toThrow(
      /phrase secrète incorrecte/,
    );
    const altere = Buffer.from(chiffre);
    altere[altere.length - 1] ^= 1;
    expect(() => dechiffrer(altere, phrase)).toThrow(/altéré/);
    expect(() => dechiffrer(Buffer.from('pas une sauvegarde'), phrase)).toThrow(
      /reconnue/,
    );
  });

  it('exige une phrase secrète suffisamment longue', () => {
    expect(() => chiffrer(Buffer.from('x'), 'court')).toThrow(/16 caractères/);
  });
});
