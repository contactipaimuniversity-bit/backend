import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  isForeignKeyViolation,
  isUniqueConstraintViolation,
} from '../common/prisma-errors';

type SnapshotRecord = Record<string, unknown>;

function snapshotRecord(value: unknown): SnapshotRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as SnapshotRecord)
    : {};
}

function snapshotRecords(value: unknown): SnapshotRecord[] {
  return Array.isArray(value) ? value.map(snapshotRecord) : [];
}

function stringValue(record: SnapshotRecord, key: string) {
  return typeof record[key] === 'string' ? record[key] : '';
}

function nullableString(record: SnapshotRecord, key: string) {
  const value = record[key];
  return typeof value === 'string' && value.length ? value : null;
}

function nullableDate(record: SnapshotRecord, key: string) {
  const value = record[key];
  return typeof value === 'string' && value ? new Date(value) : null;
}

function requiredDate(record: SnapshotRecord, key: string) {
  const value = nullableDate(record, key);
  if (!value)
    throw new ConflictException(`La date archivée ${key} est invalide`);
  return value;
}

function uniqueRows(rows: SnapshotRecord[]) {
  return [
    ...new Map(
      rows
        .filter((row) => stringValue(row, 'id'))
        .map((row) => [stringValue(row, 'id'), row]),
    ).values(),
  ];
}

@Injectable()
export class CorbeilleService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.elementCorbeille.findMany({
      select: {
        id: true,
        type: true,
        entiteId: true,
        libelle: true,
        motif: true,
        supprimeParId: true,
        supprimeParNom: true,
        dateSuppression: true,
      },
      orderBy: { dateSuppression: 'desc' },
    });
  }

  async findOne(id: string) {
    const entry = await this.prisma.elementCorbeille.findUnique({
      where: { id },
    });
    if (!entry)
      throw new NotFoundException('Élément introuvable dans la corbeille');
    if (entry.type === 'UTILISATEUR') {
      const donnees = snapshotRecord(entry.donnees);
      delete donnees.motDePasse;
      return { ...entry, donnees };
    }
    return entry;
  }

  async restore(id: string) {
    try {
      return await this.restoreEntry(id);
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ConflictException(
          'Restauration impossible : un référentiel lié à cette archive (type de bourse, échéance ou élément requis) n’existe plus',
        );
      }
      if (isUniqueConstraintViolation(error)) {
        throw new ConflictException(
          'Restauration impossible : un enregistrement identique existe déjà',
        );
      }
      throw error;
    }
  }

  private restoreEntry(id: string) {
    return this.prisma.$transaction(async (transaction) => {
      const entry = await transaction.elementCorbeille.findUnique({
        where: { id },
      });
      if (!entry)
        throw new NotFoundException('Élément introuvable dans la corbeille');
      const data = snapshotRecord(entry.donnees);

      if (entry.type === 'UTILISATEUR') {
        const user = snapshotRecord(data);
        const posteId = nullableString(user, 'posteId');
        const poste = posteId
          ? await transaction.poste.findUnique({
              where: { id: posteId },
              select: { id: true },
            })
          : null;
        await transaction.utilisateur.create({
          data: {
            id: stringValue(user, 'id'),
            nom: stringValue(user, 'nom'),
            prenom: nullableString(user, 'prenom'),
            email: stringValue(user, 'email'),
            role: stringValue(user, 'role'),
            motDePasse: stringValue(user, 'motDePasse'),
            posteId: poste?.id ?? null,
            permissions: Array.isArray(user.permissions)
              ? user.permissions.filter(
                  (permission): permission is string =>
                    typeof permission === 'string',
                )
              : [],
          } as never,
        });
      } else if (entry.type === 'PERSONNE') {
        const personne = snapshotRecord(data.personne);
        const personneId = stringValue(personne, 'id');
        const deletedBy = nullableString(personne, 'creeParId');
        const creator = deletedBy
          ? await transaction.utilisateur.findUnique({
              where: { id: deletedBy },
              select: { id: true },
            })
          : null;
        await transaction.personne.create({
          data: {
            id: personneId,
            nom: stringValue(personne, 'nom'),
            prenom: stringValue(personne, 'prenom'),
            telephone: nullableString(personne, 'telephone'),
            quartier: nullableString(personne, 'quartier'),
            dateNaissance: nullableDate(personne, 'dateNaissance'),
            lieuNaissance: nullableString(personne, 'lieuNaissance'),
            tuteurNom: nullableString(personne, 'tuteurNom'),
            tuteurPrenom: nullableString(personne, 'tuteurPrenom'),
            tuteurTelephone: nullableString(personne, 'tuteurTelephone'),
            photoUrl: nullableString(personne, 'photoUrl'),
            photoPublicId: nullableString(personne, 'photoPublicId'),
            dateEnregistrement: requiredDate(personne, 'dateEnregistrement'),
            creeParId: creator?.id ?? null,
          } as never,
        });

        const prospect = data.prospect ? snapshotRecord(data.prospect) : null;
        if (prospect) {
          const prospectId = stringValue(prospect, 'id');
          await transaction.prospect.create({
            data: {
              id: prospectId,
              personneId,
              filiereSouhaitee: nullableString(prospect, 'filiereSouhaitee'),
              intention: nullableString(prospect, 'intention'),
              sourceConnaissance: nullableString(
                prospect,
                'sourceConnaissance',
              ),
              statutRelance:
                stringValue(prospect, 'statutRelance') || 'A_RELANCER',
            } as never,
          });
          const themes = snapshotRecords(prospect.themes);
          if (themes.length) {
            await transaction.themeDiscussion.createMany({
              data: themes.map((theme) => ({
                id: stringValue(theme, 'id'),
                prospectId,
                theme: stringValue(theme, 'theme'),
                date: requiredDate(theme, 'date'),
              })) as never,
            });
          }
          const relances = snapshotRecords(prospect.relances);
          if (relances.length) {
            const authorIds = [
              ...new Set(
                relances.flatMap((relance) => {
                  const authorId = nullableString(relance, 'utilisateurId');
                  return authorId ? [authorId] : [];
                }),
              ),
            ];
            const authors = new Set(
              (
                await transaction.utilisateur.findMany({
                  where: { id: { in: authorIds } },
                  select: { id: true },
                })
              ).map((author) => author.id),
            );
            await transaction.prospectRelance.createMany({
              data: relances.map((relance) => {
                const authorId = nullableString(relance, 'utilisateurId');
                return {
                  id: stringValue(relance, 'id'),
                  prospectId,
                  utilisateurId:
                    authorId && authors.has(authorId) ? authorId : null,
                  utilisateurNom: stringValue(relance, 'utilisateurNom'),
                  commentaire: stringValue(relance, 'commentaire'),
                  intention: nullableString(relance, 'intention'),
                  statutRelance: stringValue(relance, 'statutRelance'),
                  date: requiredDate(relance, 'date'),
                  dateProchaineRelance: nullableDate(
                    relance,
                    'dateProchaineRelance',
                  ),
                };
              }) as never,
            });
          }
        }

        const demandes = snapshotRecords(data.demandesBourse);
        const inscriptions = snapshotRecords(data.inscriptions);
        for (const demande of demandes) {
          await this.restoreDemande(transaction, demande, personneId);
        }
        for (const inscription of inscriptions) {
          await this.restoreInscription(transaction, inscription, personneId);
        }
        await this.restoreElements(
          transaction,
          snapshotRecords(data.elementsDossier),
        );
        await this.restorePaiements(
          transaction,
          snapshotRecords(data.paiements),
        );
      } else if (entry.type === 'DEMANDE_BOURSE') {
        const demande = snapshotRecord(data);
        const personneId = stringValue(demande, 'personneId');
        if (
          !(await transaction.personne.findUnique({
            where: { id: personneId },
            select: { id: true },
          }))
        ) {
          throw new ConflictException(
            'Restaurez d’abord la personne liée à cette demande',
          );
        }
        await this.restoreDemande(transaction, demande, personneId);
        const inscriptions = snapshotRecords(demande.inscriptions);
        for (const inscription of inscriptions) {
          await this.restoreInscription(transaction, inscription, personneId);
        }
        await this.restoreElements(
          transaction,
          uniqueRows([
            ...snapshotRecords(demande.elementsDossier),
            ...inscriptions.flatMap((inscription) =>
              snapshotRecords(inscription.elementsDossier),
            ),
          ]),
        );
        await this.restorePaiements(
          transaction,
          uniqueRows([
            ...snapshotRecords(demande.paiements),
            ...inscriptions.flatMap((inscription) =>
              snapshotRecords(inscription.paiements),
            ),
          ]),
        );
      } else if (entry.type === 'INSCRIPTION') {
        const inscription = snapshotRecord(data);
        const personneId = stringValue(inscription, 'personneId');
        if (
          !(await transaction.personne.findUnique({
            where: { id: personneId },
            select: { id: true },
          }))
        ) {
          throw new ConflictException(
            'Restaurez d’abord la personne liée à cette inscription',
          );
        }
        const demandeBourseId = nullableString(inscription, 'demandeBourseId');
        if (
          demandeBourseId &&
          !(await transaction.demandeBourse.findUnique({
            where: { id: demandeBourseId },
            select: { id: true },
          }))
        ) {
          throw new ConflictException(
            'Restaurez d’abord la demande de bourse liée à cette inscription',
          );
        }
        await this.restoreInscription(transaction, inscription, personneId);
        await this.restoreElements(
          transaction,
          snapshotRecords(inscription.elementsDossier),
        );
        await this.restorePaiements(
          transaction,
          snapshotRecords(inscription.paiements),
        );
      } else if (entry.type === 'ELEMENT_REQUIS') {
        await this.restoreElementRequis(transaction, data);
      } else if (entry.type === 'TYPE_BOURSE') {
        const typeBourseId = stringValue(data, 'id');
        await transaction.typeBourse.create({
          data: {
            id: typeBourseId,
            nom: stringValue(data, 'nom'),
            fraisInscription: data.fraisInscription,
            tauxReduction: data.tauxReduction ?? null,
          } as never,
        });
        const echeances = snapshotRecords(data.echeances);
        if (echeances.length) {
          await transaction.echeanceBourse.createMany({
            data: echeances.map((echeance) => ({
              id: stringValue(echeance, 'id'),
              typeBourseId,
              libelle: stringValue(echeance, 'libelle'),
              ordre: Number(echeance.ordre),
              dateEcheance: nullableDate(echeance, 'dateEcheance'),
              montantAttendu: echeance.montantAttendu ?? null,
            })) as never,
          });
        }
      } else {
        throw new ConflictException(
          'Ce type d’archive ne peut pas être restauré',
        );
      }

      await transaction.elementCorbeille.delete({ where: { id } });
      return { id, restaure: true };
    });
  }

  // L'élément retrouve sa place dans les dossiers qui existent encore, et les
  // versements restés non affectés depuis son retrait lui sont de nouveau rattachés.
  private async restoreElementRequis(
    transaction: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    data: SnapshotRecord,
  ) {
    const element = snapshotRecord(data.elementRequis);
    const elementId = stringValue(element, 'id');
    const idsOf = (rows: SnapshotRecord[], key: string) =>
      rows.flatMap((row) => nullableString(row, key) ?? []);
    const stringIds = (value: unknown) =>
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
    const rows = snapshotRecords(data.elementsDossier);
    const [catalogue, demandes, inscriptions] = await Promise.all([
      transaction.elementRequis.findMany({
        where: {
          id: {
            in: [
              ...idsOf([element], 'elementSubstitutId'),
              ...idsOf(rows, 'elementSubstitutUtiliseId'),
            ],
          },
        },
        select: { id: true },
      }),
      transaction.demandeBourse.findMany({
        where: { id: { in: idsOf(rows, 'demandeBourseId') } },
        select: { id: true },
      }),
      transaction.inscription.findMany({
        where: { id: { in: idsOf(rows, 'inscriptionId') } },
        select: { id: true },
      }),
    ]);
    const existe = new Set(
      [...catalogue, ...demandes, ...inscriptions].map((row) => row.id),
    );
    const encoreLa = (row: SnapshotRecord, key: string) => {
      const id = nullableString(row, key);
      return id && existe.has(id) ? id : null;
    };

    await transaction.elementRequis.create({
      data: {
        id: elementId,
        nom: stringValue(element, 'nom'),
        categorie: stringValue(element, 'categorie'),
        contexte: stringValue(element, 'contexte'),
        niveauApplicable: stringValue(element, 'niveauApplicable'),
        obligatoire: element.obligatoire !== false,
        montantAttendu: element.montantAttendu ?? null,
        elementSubstitutId: encoreLa(element, 'elementSubstitutId'),
      } as never,
    });

    const restaurables = rows.filter(
      (row) =>
        encoreLa(row, 'demandeBourseId') ?? encoreLa(row, 'inscriptionId'),
    );
    await this.restoreElements(
      transaction,
      restaurables.map((row) => ({
        ...row,
        elementSubstitutUtiliseId: encoreLa(row, 'elementSubstitutUtiliseId'),
      })),
    );
    for (const row of restaurables) {
      const paiementIds = stringIds(row.paiementIds);
      if (!paiementIds.length) continue;
      await transaction.paiement.updateMany({
        where: { id: { in: paiementIds }, elementDossierId: null },
        data: { elementDossierId: stringValue(row, 'id') },
      });
    }
    await transaction.elementRequis.updateMany({
      where: {
        id: { in: stringIds(data.substituePourIds) },
        elementSubstitutId: null,
      },
      data: { elementSubstitutId: elementId },
    });
    await transaction.elementDossier.updateMany({
      where: {
        id: { in: stringIds(data.substitutUtiliseDansIds) },
        statut: 'ATTENDU',
        elementSubstitutUtiliseId: null,
      },
      data: { elementSubstitutUtiliseId: elementId, statut: 'SUBSTITUE' },
    });
  }

  private async restoreDemande(
    transaction: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    demande: SnapshotRecord,
    personneId: string,
  ) {
    await transaction.demandeBourse.create({
      data: {
        id: stringValue(demande, 'id'),
        personneId,
        niveauDemande: stringValue(demande, 'niveauDemande'),
        filiereSouhaitee: stringValue(demande, 'filiereSouhaitee'),
        filiereSecondaireSouhaitee: nullableString(
          demande,
          'filiereSecondaireSouhaitee',
        ),
        ecoleOrigine: nullableString(demande, 'ecoleOrigine'),
        dateDepot: requiredDate(demande, 'dateDepot'),
        dateEntretien: nullableDate(demande, 'dateEntretien'),
        equipeEntretien: nullableString(demande, 'equipeEntretien'),
        dateDecision: nullableDate(demande, 'dateDecision'),
        typeBourseId: nullableString(demande, 'typeBourseId'),
        statut: stringValue(demande, 'statut'),
      } as never,
    });
  }

  private async restoreInscription(
    transaction: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    inscription: SnapshotRecord,
    personneId: string,
  ) {
    await transaction.inscription.create({
      data: {
        id: stringValue(inscription, 'id'),
        personneId,
        anneeScolaire: stringValue(inscription, 'anneeScolaire'),
        niveau: stringValue(inscription, 'niveau'),
        filiere: stringValue(inscription, 'filiere'),
        viaBourse: Boolean(inscription.viaBourse),
        demandeBourseId: nullableString(inscription, 'demandeBourseId'),
        dateInscription: requiredDate(inscription, 'dateInscription'),
        statut: stringValue(inscription, 'statut'),
      } as never,
    });
  }

  private async restoreElements(
    transaction: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    elements: SnapshotRecord[],
  ) {
    if (!elements.length) return;
    await transaction.elementDossier.createMany({
      data: elements.map((element) => ({
        id: stringValue(element, 'id'),
        demandeBourseId: nullableString(element, 'demandeBourseId'),
        inscriptionId: nullableString(element, 'inscriptionId'),
        elementRequisId: stringValue(element, 'elementRequisId'),
        statut: stringValue(element, 'statut'),
        montantAttendu: element.montantAttendu ?? null,
        dateFourniture: nullableDate(element, 'dateFourniture'),
        elementSubstitutUtiliseId: nullableString(
          element,
          'elementSubstitutUtiliseId',
        ),
      })) as never,
    });
  }

  private async restorePaiements(
    transaction: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    paiements: SnapshotRecord[],
  ) {
    if (!paiements.length) return;
    await transaction.paiement.createMany({
      data: paiements.map((payment) => ({
        id: stringValue(payment, 'id'),
        demandeBourseId: nullableString(payment, 'demandeBourseId'),
        inscriptionId: nullableString(payment, 'inscriptionId'),
        echeanceId: nullableString(payment, 'echeanceId'),
        elementDossierId: nullableString(payment, 'elementDossierId'),
        montant: payment.montant as string,
        datePaiement: requiredDate(payment, 'datePaiement'),
        typePaiement: stringValue(payment, 'typePaiement'),
        motif: nullableString(payment, 'motif'),
        saisiParNom: nullableString(payment, 'saisiParNom'),
      })) as never,
    });
  }

  async remove(id: string) {
    const entry = await this.prisma.elementCorbeille.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!entry)
      throw new NotFoundException('Élément introuvable dans la corbeille');
    await this.prisma.elementCorbeille.delete({ where: { id } });
    return { id };
  }
}
