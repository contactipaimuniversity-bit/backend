import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(loginDto: LoginDto) {
    const email = loginDto.email?.trim().toLowerCase();
    const motDePasse = loginDto.motDePasse;

    if (!email || !motDePasse) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    const utilisateur = await this.prisma.utilisateur.findUnique({
      where: { email },
    });

    if (!utilisateur || !(await bcrypt.compare(motDePasse, utilisateur.motDePasse))) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    const payload = {
      sub: utilisateur.id,
      email: utilisateur.email,
      nom: utilisateur.nom,
      prenom: utilisateur.prenom,
      role: utilisateur.role,
    };

    return {
      access_token: await this.jwtService.signAsync(payload),
      utilisateur: {
        id: utilisateur.id,
        nom: utilisateur.nom,
        prenom: utilisateur.prenom,
        email: utilisateur.email,
        role: utilisateur.role,
      },
    };
  }
}
