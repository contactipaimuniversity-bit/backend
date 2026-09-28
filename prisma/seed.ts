import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { $Enums, PrismaClient } from '../generated/prisma/client';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL est obligatoire pour le seed');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = (process.env.ADMIN_EMAIL || 'admin@ipaim.local').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'Admin123!';

  await prisma.utilisateur.upsert({
    where: { email },
    update: { role: 'admin' },
    create: {
      nom: 'Administrateur',
      email,
      motDePasse: await bcrypt.hash(password, 12),
      role: 'admin',
    },
  });

  const catalog = [
    {
      nom: 'Frais de depot de dossier',
      categorie: $Enums.CategorieElement.FRAIS,
      contexte: $Enums.ContexteElement.BOURSE,
      niveauApplicable: $Enums.NiveauApplicable.TOUS,
      montantAttendu: '10000.00',
    },
    {
      nom: "Copie de l'acte de naissance",
      categorie: $Enums.CategorieElement.DOCUMENT,
      contexte: $Enums.ContexteElement.BOURSE,
      niveauApplicable: $Enums.NiveauApplicable.TOUS,
      montantAttendu: null,
    },
    {
      nom: "Copie de la piece d'identite",
      categorie: $Enums.CategorieElement.DOCUMENT,
      contexte: $Enums.ContexteElement.BOURSE,
      niveauApplicable: $Enums.NiveauApplicable.TOUS,
      montantAttendu: null,
    },
    {
      nom: 'Dernier releve de notes',
      categorie: $Enums.CategorieElement.DOCUMENT,
      contexte: $Enums.ContexteElement.BOURSE,
      niveauApplicable: $Enums.NiveauApplicable.TOUS,
      montantAttendu: null,
    },
    {
      nom: "Photo d'identite",
      categorie: $Enums.CategorieElement.DOCUMENT,
      contexte: $Enums.ContexteElement.BOURSE,
      niveauApplicable: $Enums.NiveauApplicable.TOUS,
      montantAttendu: null,
    },
    {
      nom: "Frais d'inscription",
      categorie: $Enums.CategorieElement.FRAIS,
      contexte: $Enums.ContexteElement.INSCRIPTION_DIRECTE,
      niveauApplicable: $Enums.NiveauApplicable.TOUS,
      montantAttendu: '30000.00',
    },
    {
      nom: 'Paquet de feuilles rames',
      categorie: $Enums.CategorieElement.FOURNITURE,
      contexte: $Enums.ContexteElement.INSCRIPTION_DIRECTE,
      niveauApplicable: $Enums.NiveauApplicable.TOUS,
      montantAttendu: null,
    },
    {
      nom: 'Paquet de marqueurs',
      categorie: $Enums.CategorieElement.FOURNITURE,
      contexte: $Enums.ContexteElement.INSCRIPTION_DIRECTE,
      niveauApplicable: $Enums.NiveauApplicable.TOUS,
      montantAttendu: null,
    },
    {
      nom: 'Chemise cartonnée',
      categorie: $Enums.CategorieElement.FOURNITURE,
      contexte: $Enums.ContexteElement.INSCRIPTION_DIRECTE,
      niveauApplicable: $Enums.NiveauApplicable.TOUS,
      montantAttendu: null,
    },
    {
      nom: 'Enveloppe kaki',
      categorie: $Enums.CategorieElement.FOURNITURE,
      contexte: $Enums.ContexteElement.INSCRIPTION_DIRECTE,
      niveauApplicable: $Enums.NiveauApplicable.TOUS,
      montantAttendu: null,
    },
  ];

  for (const item of catalog) {
    const existing = await prisma.elementRequis.findFirst({
      where: { nom: item.nom, contexte: item.contexte },
      select: { id: true },
    });
    if (!existing) {
      await prisma.elementRequis.create({ data: item });
    } else {
      await prisma.elementRequis.update({ where: { id: existing.id }, data: item });
    }
  }

  console.log(`Administrateur initialise: ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
