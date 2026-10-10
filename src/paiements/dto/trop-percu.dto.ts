export class ReporterTropPercuDto {
  elementDossierId!: string;
  cibleElementDossierId!: string;
  montant!: string | number;
}

export class RembourserTropPercuDto {
  elementDossierId!: string;
  montant!: string | number;
  motif!: string;
}
