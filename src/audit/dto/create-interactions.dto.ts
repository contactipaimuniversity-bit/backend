export class CreateInteractionsDto {
  evenements!: Array<{
    page: string;
    titre: string;
    element: string;
    type: string;
    contexte?: string | null;
    date: string;
  }>;
}
