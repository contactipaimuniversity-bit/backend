import { ConflictException } from '@nestjs/common';

type Client = {
  inscription: { count(args: { where: object }): Promise<number> };
};

// Une inscription affectée à une classe porte des présences, des notes et des
// résultats : elle ne se supprime plus, elle se marque « abandonnée ».
export async function refuserSuppressionScolarite(
  client: Client,
  where: object,
): Promise<void> {
  const total = await client.inscription.count({
    where: { AND: [where, { classeId: { not: null } }] },
  });
  if (total > 0)
    throw new ConflictException(
      "Suppression impossible : l'étudiant est affecté à une classe et a un parcours académique. Marquez plutôt l'inscription « abandonnée ».",
    );
}
