import { rechercheSouple } from './recherche';

const fiches = [
  {
    id: 'dinga',
    textes: ['DINGA', 'Dominique Gérard', '06 612 34 56', 'IP-2026-0012'],
  },
  { id: 'mabiala', textes: ['MABIALA', 'Philippe', '05 500 00 01', null] },
  { id: 'nkounkou', textes: ['NKOUNKOU', 'Chancelle', null, null] },
  { id: 'dongo', textes: ['DONGO', 'Domi', null, null] },
];
const cherche = (requete: string) => rechercheSouple(fiches, requete);

describe('rechercheSouple', () => {
  it('ignore accents, majuscules et ordre des mots', () => {
    expect(cherche('gerard')).toEqual(['dinga']);
    expect(cherche('dominique dinga')).toEqual(['dinga']);
    expect(cherche('Dinga Dominique')).toEqual(['dinga']);
  });

  it('accepte un début de mot', () => {
    expect(cherche('nkoun')).toEqual(['nkounkou']);
    expect(cherche('dom')).toEqual(['dinga', 'dongo']);
  });

  it('tolère les fautes quand rien ne correspond exactement', () => {
    expect(cherche('dominik')).toEqual(['dinga']);
    expect(cherche('filipe mabiala')).toEqual(['mabiala']);
    expect(cherche('nkunkou')).toEqual(['nkounkou']);
    expect(cherche('chancel')).toEqual(['nkounkou']);
  });

  it('préfère les correspondances directes', () => {
    expect(cherche('domi')).toEqual(['dinga', 'dongo']);
  });

  it('retrouve téléphone et matricule avec ou sans espaces', () => {
    expect(cherche('066123456')).toEqual(['dinga']);
    expect(cherche('ip-2026-0012')).toEqual(['dinga']);
  });

  it('ne propose rien de trop éloigné', () => {
    expect(cherche('kouassi')).toEqual([]);
    expect(cherche('')).toEqual([]);
  });
});
