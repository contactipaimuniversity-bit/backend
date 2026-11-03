import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { attribuerMatricules, fraisInscriptionPayes } from './matricules';

type Filtres = Record<string, string | undefined>;

const STATUTS = ['EN_COURS', 'COMPLETE', 'ABANDONNEE'];

const valeur = (filtres: Filtres, cle: string) => {
  const brut = filtres[cle];
  return typeof brut === 'string' && brut.trim() ? brut.trim() : null;
};

// La liste des inscrits à imprimer, taillée par les filtres : année, pôle,
// filière, niveau, classe, statut, bourse, matricule et frais d'inscription.
// Sans pagination : on imprime tout ce qui correspond.
export async function listeInscrits(prisma: PrismaService, filtres: Filtres) {
  await attribuerMatricules(prisma);
  const and: Prisma.InscriptionWhereInput[] = [];
  const annee = valeur(filtres, 'anneeScolaire');
  if (annee) and.push({ anneeScolaire: annee });
  const niveau = valeur(filtres, 'niveau');
  if (niveau) and.push({ niveau });
  const filiereId = valeur(filtres, 'filiereId');
  if (filiereId) and.push({ filiereId });
  const pole = valeur(filtres, 'poleId');
  if (pole === 'aucun')
    and.push({ OR: [{ filiereId: null }, { filiereRef: { poleId: null } }] });
  else if (pole) and.push({ filiereRef: { poleId: pole } });
  const classe = valeur(filtres, 'classeId');
  if (classe === 'aucune') and.push({ classeId: null });
  else if (classe) and.push({ classeId: classe });
  const statut = valeur(filtres, 'statut');
  if (statut) {
    if (!STATUTS.includes(statut))
      throw new BadRequestException('Statut inconnu');
    and.push({ statut: statut as 'EN_COURS' | 'COMPLETE' | 'ABANDONNEE' });
  } else and.push({ statut: { not: 'ABANDONNEE' } });
  const bourse = valeur(filtres, 'bourse');
  if (bourse === 'OUI') and.push({ viaBourse: true });
  else if (bourse === 'NON') and.push({ viaBourse: false });
  else if (bourse)
    and.push({ demandeBourse: { is: { typeBourseId: bourse } } });
  const matricule = valeur(filtres, 'matricule');
  if (matricule === 'AVEC')
    and.push({ personne: { matricule: { not: null } } });
  if (matricule === 'SANS') and.push({ personne: { matricule: null } });

  const inscriptions = await prisma.inscription.findMany({
    where: { AND: and },
    select: {
      id: true,
      anneeScolaire: true,
      niveau: true,
      filiere: true,
      statut: true,
      viaBourse: true,
      dateInscription: true,
      personne: {
        select: {
          nom: true,
          prenom: true,
          matricule: true,
          sexe: true,
          telephone: true,
          tuteurTelephone: true,
          dateNaissance: true,
          lieuNaissance: true,
        },
      },
      filiereRef: {
        select: { nom: true, pole: { select: { nom: true, ordre: true } } },
      },
      classe: {
        select: {
          niveau: true,
          groupe: true,
          filiere: { select: { code: true } },
        },
      },
      demandeBourse: { select: { typeBourse: { select: { nom: true } } } },
      elementsDossier: {
        where: {
          montantAttendu: { not: null },
          elementRequis: { categorie: 'FRAIS' },
        },
        select: {
          montantAttendu: true,
          paiements: { select: { montant: true } },
        },
      },
    },
  });
  const frais = valeur(filtres, 'fraisInscription');
  return inscriptions
    .map(({ elementsDossier, ...inscription }) => ({
      ...inscription,
      filiere: inscription.filiereRef?.nom ?? inscription.filiere,
      pole: inscription.filiereRef?.pole?.nom ?? null,
      poleOrdre: inscription.filiereRef?.pole?.ordre ?? null,
      // Même nom de classe que dans Classes et étudiants : « GC L1 », « GC L1 B ».
      classe: inscription.classe
        ? `${inscription.classe.filiere.code} ${inscription.classe.niveau}${inscription.classe.groupe === 'A' ? '' : ` ${inscription.classe.groupe}`}`
        : null,
      bourse: inscription.demandeBourse?.typeBourse?.nom ?? null,
      fraisInscriptionPayes: fraisInscriptionPayes({ elementsDossier }),
      filiereRef: undefined,
      demandeBourse: undefined,
    }))
    .filter(
      (inscription) =>
        !frais || (frais === 'PAYES') === inscription.fraisInscriptionPayes,
    )
    .sort(
      (first, second) =>
        first.personne.nom.localeCompare(second.personne.nom, 'fr') ||
        first.personne.prenom.localeCompare(second.personne.prenom, 'fr'),
    );
}
