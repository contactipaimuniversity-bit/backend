import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';

export type FichierRecu = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

export type FichierHeberge = {
  url: string;
  publicId: string;
  typeRessource: string;
  taille: number;
  nom: string;
};

export const TAILLE_MAX_FICHIER = 10 * 1024 * 1024;
const TYPES_ACCEPTES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

// Hébergement des pièces justificatives sur Cloudinary (envoi signé, sans SDK).
@Injectable()
export class CloudinaryService {
  private config() {
    // Format fourni par Cloudinary : cloudinary://<cle>:<secret>@<cloud>
    const url = process.env.CLOUDINARY_URL?.match(
      /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/,
    );
    const cloudName = url?.[3] ?? process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = url?.[1] ?? process.env.CLOUDINARY_API_KEY;
    const apiSecret = url?.[2] ?? process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret || /[<>*]/.test(apiSecret))
      throw new ServiceUnavailableException(
        "L'hébergement des fichiers n'est pas configuré (CLOUDINARY_URL)",
      );
    return { cloudName, apiKey, apiSecret };
  }

  private sign(params: Record<string, string>, apiSecret: string) {
    const payload = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join('&');
    return createHash('sha1')
      .update(payload + apiSecret)
      .digest('hex');
  }

  verifier(fichier: FichierRecu | undefined, libelle: string): FichierRecu {
    if (!fichier?.buffer?.length)
      throw new BadRequestException(`${libelle} : le fichier est obligatoire`);
    if (!TYPES_ACCEPTES.includes(fichier.mimetype))
      throw new BadRequestException(
        `${libelle} : seuls les fichiers PDF, JPG, PNG ou WEBP sont acceptés`,
      );
    if (fichier.size > TAILLE_MAX_FICHIER)
      throw new BadRequestException(`${libelle} : le fichier dépasse 10 Mo`);
    return fichier;
  }

  async envoyer(
    fichier: FichierRecu,
    dossier: string,
  ): Promise<FichierHeberge> {
    const { cloudName, apiKey, apiSecret } = this.config();
    const params = {
      folder: dossier,
      timestamp: String(Math.floor(Date.now() / 1000)),
    };
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(fichier.buffer)], { type: fichier.mimetype }),
      fichier.originalname,
    );
    form.append('api_key', apiKey);
    form.append('signature', this.sign(params, apiSecret));
    for (const [key, value] of Object.entries(params)) form.append(key, value);

    let response: Response;
    try {
      response = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
        { method: 'POST', body: form },
      );
    } catch {
      throw new BadGatewayException(
        "Le service d'hébergement des fichiers est injoignable",
      );
    }
    const payload = (await response.json().catch(() => null)) as {
      secure_url?: string;
      public_id?: string;
      resource_type?: string;
      bytes?: number;
      error?: { message?: string };
    } | null;
    if (!response.ok || !payload?.secure_url || !payload.public_id)
      throw new BadGatewayException(
        `Le fichier n'a pas pu être hébergé${payload?.error?.message ? ` : ${payload.error.message}` : ''}`,
      );
    return {
      url: payload.secure_url,
      publicId: payload.public_id,
      typeRessource: payload.resource_type ?? 'image',
      taille: payload.bytes ?? fichier.size,
      // Multer lit les noms en latin1 : on rétablit les accents.
      nom: Buffer.from(fichier.originalname, 'latin1')
        .toString('utf8')
        .slice(0, 200),
    };
  }

  // Lit une image par un lien signé de l'API : la diffusion publique
  // (res.cloudinary.com) peut être fermée sur le compte.
  async telechargerImage(
    publicId: string,
    format: string,
  ): Promise<{ contenu: Buffer; type: string }> {
    const { cloudName, apiKey, apiSecret } = this.config();
    const params = {
      format,
      public_id: publicId,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: 'upload',
    };
    const query = new URLSearchParams({
      ...params,
      api_key: apiKey,
      signature: this.sign(params, apiSecret),
    });
    let response: Response;
    try {
      response = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/image/download?${query.toString()}`,
      );
    } catch {
      throw new BadGatewayException(
        "Le service d'hébergement des fichiers est injoignable",
      );
    }
    if (!response.ok)
      throw new BadGatewayException("Le fichier n'a pas pu être lu");
    return {
      contenu: Buffer.from(await response.arrayBuffer()),
      type: response.headers.get('content-type') ?? `image/${format}`,
    };
  }

  // Dépose un fichier brut (ni image ni PDF), par exemple une sauvegarde chiffrée.
  async envoyerBrut(
    contenu: Buffer,
    nom: string,
    dossier: string,
  ): Promise<string> {
    const { cloudName, apiKey, apiSecret } = this.config();
    const params = {
      folder: dossier,
      public_id: nom,
      timestamp: String(Math.floor(Date.now() / 1000)),
    };
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(contenu)]), nom);
    form.append('api_key', apiKey);
    form.append('signature', this.sign(params, apiSecret));
    for (const [key, value] of Object.entries(params)) form.append(key, value);
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`,
      { method: 'POST', body: form },
    );
    const payload = (await response.json().catch(() => null)) as {
      secure_url?: string;
      error?: { message?: string };
    } | null;
    if (!response.ok || !payload?.secure_url)
      throw new Error(
        payload?.error?.message ?? "Dépôt refusé par l'hébergeur de fichiers",
      );
    return payload.secure_url;
  }

  // Retire un fichier devenu inutile ; un échec ne bloque jamais l'opération.
  async supprimer(publicId: string, typeRessource: string): Promise<void> {
    try {
      const { cloudName, apiKey, apiSecret } = this.config();
      const params = {
        public_id: publicId,
        timestamp: String(Math.floor(Date.now() / 1000)),
      };
      const form = new FormData();
      form.append('api_key', apiKey);
      form.append('signature', this.sign(params, apiSecret));
      for (const [key, value] of Object.entries(params))
        form.append(key, value);
      await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/${typeRessource}/destroy`,
        { method: 'POST', body: form },
      );
    } catch {
      // Fichier orphelin côté hébergeur : sans conséquence pour la gestion.
    }
  }
}
