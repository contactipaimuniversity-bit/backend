import {
  ConflictException,
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUtilisateurDto } from './dto/create-utilisateur.dto';

@Injectable()
export class UtilisateursService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createDto: CreateUtilisateurDto) {
    const nom = createDto.nom?.trim();
    const email = createDto.email?.trim().toLowerCase();
    const motDePasse = createDto.motDePasse;
    const role = createDto.role?.trim() || 'staff';

    if (!nom || !email || !motDePasse) {
      throw new BadRequestException('nom, email et motDePasse sont obligatoires');
    }

    if (motDePasse.length < 8) {
      throw new BadRequestException('Le mot de passe doit contenir au moins 8 caracteres');
    }

    try {
      const utilisateur = await this.prisma.utilisateur.create({
        data: {
          nom,
          email,
          motDePasse: await bcrypt.hash(motDePasse, 12),
          role,
        },
        select: {
          id: true,
          nom: true,
          email: true,
          role: true,
        },
      });

      return utilisateur;
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Cette adresse email existe deja');
      }

      throw error;
    }
  }

  findAll() {
    return this.prisma.utilisateur.findMany({
      select: {
        id: true,
        nom: true,
        email: true,
        role: true,
      },
      orderBy: { nom: 'asc' },
    });
  }

  async remove(id: string) {
    const utilisateur = await this.prisma.utilisateur.findUnique({
      where: { id },
      select: { id: true, role: true },
    });
    if (!utilisateur) {
      throw new BadRequestException('Utilisateur introuvable');
    }

    if (utilisateur.role === 'admin') {
      const admins = await this.prisma.utilisateur.count({ where: { role: 'admin' } });
      if (admins <= 1) {
        throw new BadRequestException('Le dernier administrateur ne peut pas etre supprime');
      }
    }

    return this.prisma.utilisateur.delete({
      where: { id },
      select: { id: true, nom: true, email: true, role: true },
    });
  }
}
