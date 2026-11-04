// Un enseignant ne tient qu'une séance à la fois : un cours commun à plusieurs
// classes (une séance par classe, même jour, même heure) ne compte qu'une fois
// pour ses heures et sa paie.
export function seancesUniques<T extends { date: Date; heureDebut: string }>(
  seances: T[],
) {
  const vues = new Set<string>();
  return seances.filter((seance) => {
    const cle = `${seance.date.toISOString().slice(0, 10)}|${seance.heureDebut}`;
    if (vues.has(cle)) return false;
    vues.add(cle);
    return true;
  });
}
