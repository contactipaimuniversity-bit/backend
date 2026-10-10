// Organisation de départ d'IPAIM UNIVERSITY : quatre pôles et leurs filières.
// Ce n'est qu'un point de départ, chargé à la demande : tout se modifie ensuite
// depuis « Structure académique ».
export const STRUCTURE_TYPE: Array<{
  nom: string;
  description: string;
  filieres: Array<[code: string, nom: string]>;
}> = [
  {
    nom: 'Pôle Industriel',
    description:
      'Former des techniciens supérieurs et des ingénieurs compétents, capables de concevoir, réaliser, exploiter et maintenir les infrastructures, équipements et systèmes industriels répondant aux besoins du développement économique et industriel.',
    filieres: [
      ['GC', 'Génie Civil'],
      ['GE', 'Génie Électrique'],
      ['GM', 'Génie Mécanique'],
      ['GI', 'Génie Industriel'],
      ['MI', 'Maintenance Industrielle'],
      ['ELT', 'Électrotechnique'],
      ['ER', 'Énergies Renouvelables'],
    ],
  },
  {
    nom: 'Pôle Management',
    description:
      "Développer des professionnels qualifiés en gestion, finance, commerce et administration, aptes à piloter efficacement les organisations publiques et privées tout en favorisant l'innovation, l'entrepreneuriat et la création de valeur.",
    filieres: [
      ['GRH', 'Gestion des Ressources Humaines'],
      ['CF', 'Comptabilité et Finance'],
      ['BA', 'Banque et Assurance'],
      ['MC', 'Marketing et Communication'],
      ['LT', 'Logistique et Transport'],
      ['CI', 'Commerce International'],
      ['DRI', 'Diplomatie et Relations Internationales'],
      ['ENT', 'Entrepreneuriat'],
      ['GO', 'Gestion des Organisations'],
      ['DA', 'Droit des Affaires'],
    ],
  },
  {
    nom: 'Pôle Technologique',
    description:
      "Former des experts en technologies numériques, capables de concevoir des solutions innovantes en informatique, intelligence artificielle, cybersécurité, réseaux et développement d'applications afin d'accompagner la transformation digitale.",
    filieres: [
      ['GL', 'Génie Logiciel'],
      ['IG', 'Informatique de Gestion'],
      ['RT', 'Réseaux et Télécommunications'],
      ['CYB', 'Cybersécurité'],
      ['IA', 'Intelligence Artificielle'],
      ['DS', 'Data Science'],
      ['DWM', 'Développement Web & Mobile'],
      ['SE', 'Systèmes Embarqués'],
    ],
  },
  {
    nom: 'Pôle Agricole et Environnement',
    description:
      "Former des professionnels capables de promouvoir une agriculture moderne, durable et compétitive, tout en assurant la gestion responsable des ressources naturelles et la protection de l'environnement, au service de la sécurité alimentaire et du développement rural.",
    filieres: [
      ['AGRO', 'Agronomie'],
      ['PV', 'Production Végétale'],
      ['PA', 'Production Animale'],
      ['AGA', 'Agroalimentaire'],
      ['GRN', 'Gestion des Ressources Naturelles'],
      ['EDD', 'Environnement et Développement Durable'],
      ['AGB', 'Agrobusiness'],
      ['GR', 'Génie Rural'],
    ],
  },
];
