import { Injectable } from '@nestjs/common';
import { Acteur, peut } from '../common/acteur';
import { PrismaService } from '../prisma/prisma.service';

// Au-delà de ce délai, l'appareil refait un téléchargement complet.
const ANCIENNETE_MAX_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class SynchronisationService {
  constructor(private readonly prisma: PrismaService) {}

  // Dossiers dont le contenu a changé depuis une date : l'appareil ne
  // retélécharge que ceux-là pour tenir à jour sa copie hors ligne.
  async changements(depuisBrut: string | undefined, acteur: Acteur) {
    const horodatage = new Date();
    const depuis = new Date(depuisBrut ?? '');
    const ecart = horodatage.getTime() - depuis.getTime();
    if (Number.isNaN(ecart) || ecart < 0 || ecart > ANCIENNETE_MAX_MS)
      return { horodatage, complet: true };

    const recent = { gt: depuis };
    // Un dossier change aussi par ses pièces, ses paiements ou sa personne.
    const dossierModifie = {
      OR: [
        { modifieLe: recent },
        { personne: { modifieLe: recent } },
        { elementsDossier: { some: { modifieLe: recent } } },
        { paiements: { some: { enregistreLe: recent } } },
      ],
    };
    const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);
    const voit = (...zones: string[]) =>
      zones.some((zone) => peut(acteur, `view:${zone}`));

    const [demandesBourse, inscriptions, prospects] = await Promise.all([
      voit('scholarships', 'certificates', 'payments')
        ? this.prisma.demandeBourse.findMany({
            where: dossierModifie,
            select: { id: true },
          })
        : [],
      voit('enrollments', 'certificates', 'payments')
        ? this.prisma.inscription.findMany({
            where: dossierModifie,
            select: { id: true },
          })
        : [],
      voit('prospects')
        ? this.prisma.prospect.findMany({
            where: {
              OR: [
                { modifieLe: recent },
                { personne: { modifieLe: recent } },
                { relances: { some: { enregistreLe: recent } } },
              ],
            },
            select: { id: true },
          })
        : [],
    ]);
    return {
      horodatage,
      complet: false,
      demandesBourse: ids(demandesBourse),
      inscriptions: ids(inscriptions),
      prospects: ids(prospects),
    };
  }
}
