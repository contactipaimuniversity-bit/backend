import {
  ConflictException,
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUtilisateurDto } from './dto/create-utilisateur.dto';
import { UpdateProfilDto } from './dto/update-profil.dto';
import { requiredDeletionReason, toTrashSnapshot } from '../corbeille/corbeille.utils';
import { isAccessPermission } from '../auth/access-control';

@Injectable()
export class UtilisateursService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createDto: CreateUtilisateurDto) {
    const nom = createDto.nom?.trim();
    const email = createDto.email?.trim().toLowerCase();
    const motDePasse = createDto.motDePasse;
    const role = createDto.role?.trim() || 'employe';

    if (!nom || !email || !motDePasse) {
      throw new BadRequestException('nom, email et motDePasse sont obligatoires');
    }

    if (motDePasse.length < 8) {
      throw new BadRequestException('Le mot de passe doit contenir au moins 8 caracteres');
    }

    const poste = createDto.posteId
      ? await this.prisma.poste.findUnique({ where: { id: createDto.posteId } })
      : null;
    if (createDto.posteId && !poste) throw new BadRequestException('Poste introuvable');
    const permissions = this.validPermissions(createDto.permissions ?? poste?.permissions ?? []);

    try {
      const utilisateur = await this.prisma.utilisateur.create({
        data: {
          nom,
          email,
          motDePasse: await bcrypt.hash(motDePasse, 12),
          role,
          posteId: poste?.id,
          permissions,
        },
        select: {
          id: true,
          nom: true,
          email: true,
          role: true,
          posteId: true,
          permissions: true,
          poste: { select: { id: true, nom: true } },
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
        posteId: true,
        permissions: true,
        poste: { select: { id: true, nom: true } },
      },
      orderBy: { nom: 'asc' },
    });
  }

  listPostes() {
    return this.prisma.poste.findMany({
      orderBy: { nom: 'asc' },
      include: { _count: { select: { utilisateurs: true } } },
    });
  }

  async createPoste(nom: string, rawPermissions: string[]) {
    const normalizedNom = nom?.trim();
    if (!normalizedNom) throw new BadRequestException('Le nom du poste est obligatoire');
    try {
      return await this.prisma.poste.create({
        data: { nom: normalizedNom, permissions: this.validPermissions(rawPermissions) },
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002')
        throw new ConflictException('Ce poste existe deja');
      throw error;
    }
  }

  async updatePoste(id: string, nom: string, rawPermissions: string[]) {
    const normalizedNom = nom?.trim();
    if (!normalizedNom) throw new BadRequestException('Le nom du poste est obligatoire');
    try {
      return await this.prisma.poste.update({
        where: { id },
        data: { nom: normalizedNom, permissions: this.validPermissions(rawPermissions) },
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002')
        throw new ConflictException('Ce poste existe deja');
      throw error;
    }
  }

  async updateAccess(id: string, posteId: string | null, rawPermissions: string[]) {
    const utilisateur = await this.prisma.utilisateur.findUnique({ where: { id } });
    if (!utilisateur) throw new BadRequestException('Utilisateur introuvable');
    const poste = posteId ? await this.prisma.poste.findUnique({ where: { id: posteId } }) : null;
    if (posteId && !poste) throw new BadRequestException('Poste introuvable');
    return this.prisma.utilisateur.update({
      where: { id },
      data: { posteId: poste?.id ?? null, permissions: this.validPermissions(rawPermissions) },
      select: {
        id: true,
        nom: true,
        prenom: true,
        email: true,
        role: true,
        posteId: true,
        permissions: true,
        poste: { select: { id: true, nom: true } },
      },
    });
  }

  private validPermissions(permissions: string[]) {
    if (!Array.isArray(permissions) || permissions.some((permission) => !isAccessPermission(permission)))
      throw new BadRequestException('La liste des fonctionnalités contient une valeur invalide');
    const normalized = new Set(permissions);
    for (const permission of normalized) {
      if (permission.startsWith('edit:')) normalized.add(`view:${permission.slice(5)}`);
    }
    return [...normalized];
  }

  async updateProfile(id: string, dto: UpdateProfilDto) {
    const current = await this.prisma.utilisateur.findUnique({ where: { id } });
    if (!current) throw new BadRequestException('Utilisateur introuvable');
    const nom = dto.nom?.trim();
    const prenom = dto.prenom?.trim() || null;
    const email = dto.email?.trim().toLowerCase();
    if (!nom || !email) throw new BadRequestException('Le nom et l email sont obligatoires');
    if (dto.nouveauMotDePasse !== undefined) {
      if (!dto.ancienMotDePasse || !(await bcrypt.compare(dto.ancienMotDePasse, current.motDePasse)))
        throw new BadRequestException('L ancien mot de passe est incorrect');
      if (dto.nouveauMotDePasse.length < 8)
        throw new BadRequestException('Le nouveau mot de passe doit contenir au moins 8 caracteres');
    }
    try {
      return await this.prisma.utilisateur.update({
        where: { id },
        data: { nom, prenom, email, ...(dto.nouveauMotDePasse ? { motDePasse: await bcrypt.hash(dto.nouveauMotDePasse, 12) } : {}) },
        select: {
          id: true,
          nom: true,
          prenom: true,
          email: true,
          role: true,
          posteId: true,
          poste: { select: { id: true, nom: true } },
          permissions: true,
        },
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002')
        throw new ConflictException('Cette adresse email existe deja');
      throw error;
    }
  }

  async remove(id: string, rawReason: string, deletedById: string) {
    const motif = requiredDeletionReason(rawReason);
    return this.prisma.$transaction(async (transaction) => {
      const utilisateur = await transaction.utilisateur.findUnique({
        where: { id },
        select: { id: true, nom: true, prenom: true, email: true, role: true, motDePasse: true },
      });
      if (!utilisateur) throw new BadRequestException('Utilisateur introuvable');
      if (utilisateur.role === 'admin') {
        const admins = await transaction.utilisateur.count({ where: { role: 'admin' } });
        if (admins <= 1) {
          throw new BadRequestException('Le dernier administrateur ne peut pas etre supprime');
        }
      }
      const author = await transaction.utilisateur.findUnique({
        where: { id: deletedById },
        select: { id: true, nom: true, prenom: true },
      });
      await transaction.elementCorbeille.create({
        data: {
          type: 'UTILISATEUR',
          entiteId: id,
          libelle: `${utilisateur.nom} · ${utilisateur.email}`,
          motif,
          supprimeParId: author?.id ?? deletedById,
          supprimeParNom: [author?.prenom, author?.nom].filter(Boolean).join(' ') || 'Utilisateur inconnu',
          donnees: toTrashSnapshot(utilisateur),
        },
      });
      await transaction.personne.updateMany({ where: { creeParId: id }, data: { creeParId: null } });
      await transaction.idempotencyRecord.deleteMany({ where: { userId: id } });
      await transaction.utilisateur.delete({ where: { id } });
      return { id, nom: utilisateur.nom, email: utilisateur.email, role: utilisateur.role };
    });
  }
}
