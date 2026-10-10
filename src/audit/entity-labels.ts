import { PrismaService } from '../prisma/prisma.service';

type LabelledEvent = {
  ressource: string;
  entiteId: string | null;
  chemin?: string | null;
  donnees?: unknown;
};

const fullName = (person?: { nom: string; prenom?: string | null } | null) =>
  person ? [person.prenom, person.nom].filter(Boolean).join(' ') : '';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// Identifiant de l'enregistrement principal visé par l'événement : pour une
// route comme /demandes-bourse/:id/decision, c'est le dossier, pas la réponse.
function targetId(event: LabelledEvent): string | null {
  const fromPath = event.chemin?.match(
    /^\/(?:demandes-bourse|inscriptions|personnes|prospects|candidatures-personnel|utilisateurs|paiements|depenses)\/([0-9a-f-]{36})/,
  )?.[1];
  return fromPath ?? event.entiteId;
}

// Donne à chaque événement un libellé lisible (« Mariam Diallo · Informatique »)
// à la place d'un identifiant technique. Les enregistrements supprimés sont
// retrouvés dans la copie conservée par le journal.
export async function resolveEntityLabels(
  prisma: PrismaService,
  events: LabelledEvent[],
): Promise<Map<LabelledEvent, string>> {
  const ids = (ressource: string) => [
    ...new Set(
      events
        .filter((event) => event.ressource === ressource)
        .map(targetId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const [
    demandes,
    inscriptions,
    personnes,
    prospects,
    paiements,
    utilisateurs,
    candidatures,
    depenses,
  ] = await Promise.all([
    prisma.demandeBourse.findMany({
      where: { id: { in: ids('demande de bourse') } },
      select: { id: true, filiereSouhaitee: true, personne: true },
    }),
    prisma.inscription.findMany({
      where: { id: { in: ids('inscription') } },
      select: { id: true, filiere: true, anneeScolaire: true, personne: true },
    }),
    prisma.personne.findMany({
      where: { id: { in: ids('fiche personne') } },
      select: { id: true, nom: true, prenom: true },
    }),
    prisma.prospect.findMany({
      where: { id: { in: ids('prospect') } },
      select: { id: true, personne: true },
    }),
    prisma.paiement.findMany({
      where: { id: { in: ids('paiement') } },
      select: {
        id: true,
        montant: true,
        demandeBourse: { select: { personne: true } },
        inscription: { select: { personne: true } },
      },
    }),
    prisma.utilisateur.findMany({
      where: { id: { in: ids('utilisateur') } },
      select: { id: true, nom: true, prenom: true },
    }),
    prisma.candidaturePersonnel.findMany({
      where: { id: { in: ids('dossier de recrutement') } },
      select: { id: true, nom: true, prenom: true, fonction: true },
    }),
    prisma.depense.findMany({
      where: { id: { in: ids('dépense') } },
      select: { id: true, numero: true, objet: true },
    }),
  ]);

  const labels = new Map<string, string>();
  for (const item of demandes)
    labels.set(
      item.id,
      `${fullName(item.personne)} · ${item.filiereSouhaitee}`,
    );
  for (const item of inscriptions)
    labels.set(
      item.id,
      `${fullName(item.personne)} · ${item.filiere} · ${item.anneeScolaire}`,
    );
  for (const item of personnes) labels.set(item.id, fullName(item));
  for (const item of prospects) labels.set(item.id, fullName(item.personne));
  for (const item of paiements)
    labels.set(
      item.id,
      `${fullName(item.demandeBourse?.personne ?? item.inscription?.personne)} · ${Number(item.montant).toLocaleString('fr-FR')} F`,
    );
  for (const item of utilisateurs) labels.set(item.id, fullName(item));
  for (const item of candidatures)
    labels.set(item.id, `${fullName(item)} · ${item.fonction}`);

  for (const item of depenses)
    labels.set(item.id, `${item.numero} · ${item.objet}`);

  const result = new Map<LabelledEvent, string>();
  for (const event of events) {
    const id = targetId(event);
    const live = id ? labels.get(id) : undefined;
    if (live) {
      result.set(event, live);
      continue;
    }
    // Enregistrement supprimé ou créé avec ses propres valeurs : on lit la copie du journal.
    const donnees = record(event.donnees);
    const source =
      record(donnees?.supprime) ??
      record(record(donnees?.envoye)?.nouvellePersonne) ??
      record(donnees?.envoye);
    const personne = record(source?.personne) ?? source;
    const nom = [personne?.prenom, personne?.nom]
      .filter((part): part is string => typeof part === 'string' && part !== '')
      .join(' ');
    const libelle = typeof source?.libelle === 'string' ? source.libelle : '';
    // Connexion : l'adresse utilisée identifie la tentative.
    const email = typeof source?.email === 'string' ? source.email : '';
    if (nom || libelle || email) result.set(event, nom || libelle || email);
  }
  return result;
}
