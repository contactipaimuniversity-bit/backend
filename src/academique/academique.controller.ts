import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { acteurDe } from '../common/acteur';
import { DeliberationsService } from './deliberations.service';
import { EvaluationsService } from './evaluations.service';
import { ScolariteService } from './scolarite.service';
import { StatistiquesAcademiquesService } from './statistiques.service';
import { StructureService } from './structure.service';
import { TableauAcademiqueService } from './tableau.service';

type Body = Record<string, unknown>;

// Structure : années, filières, salles, classes, maquettes, cours, emploi du temps.
@Controller('academique')
@UseGuards(JwtAuthGuard)
export class AcademiqueController {
  constructor(
    private readonly structure: StructureService,
    private readonly tableau: TableauAcademiqueService,
  ) {}

  @Get('tableau-de-bord')
  tableauDeBord() {
    return this.tableau.aujourdhui();
  }

  @Get('parametres')
  parametres() {
    return this.structure.parametres();
  }

  @Patch('parametres')
  updateParametres(@Body() body: Body) {
    return this.structure.updateParametres(body);
  }

  @Post('importer')
  importer() {
    return this.structure.importerDepuisInscriptions();
  }

  @Get('annees')
  annees() {
    return this.structure.annees();
  }

  @Post('annees')
  createAnnee(@Body() body: Body) {
    return this.structure.createAnnee(body);
  }

  @Patch('annees/:id')
  updateAnnee(@Param('id') id: string, @Body() body: Body) {
    return this.structure.updateAnnee(id, body);
  }

  @Get('niveaux')
  niveaux() {
    return this.structure.niveaux();
  }

  @Post('niveaux')
  createNiveau(@Body() body: Body) {
    return this.structure.createNiveau(body);
  }

  @Patch('niveaux/:id')
  updateNiveau(@Param('id') id: string, @Body() body: Body) {
    return this.structure.updateNiveau(id, body);
  }

  @Get('poles')
  poles() {
    return this.structure.poles();
  }

  @Post('poles/structure-type')
  chargerStructureType() {
    return this.structure.chargerStructureType();
  }

  @Post('poles')
  createPole(@Body() body: Body) {
    return this.structure.createPole(body);
  }

  @Patch('poles/:id')
  updatePole(@Param('id') id: string, @Body() body: Body) {
    return this.structure.updatePole(id, body);
  }

  @Get('filieres')
  filieres() {
    return this.structure.filieres();
  }

  @Get('filieres/rapprochement')
  filieresARapprocher() {
    return this.structure.filieresARapprocher();
  }

  @Post('filieres/rapprochement')
  rapprocher(@Body() body: Body) {
    return this.structure.rapprocher(body);
  }

  @Post('filieres')
  createFiliere(@Body() body: Body) {
    return this.structure.createFiliere(body);
  }

  @Patch('filieres/:id')
  updateFiliere(@Param('id') id: string, @Body() body: Body) {
    return this.structure.updateFiliere(id, body);
  }

  @Get('salles')
  salles() {
    return this.structure.salles();
  }

  @Post('salles')
  createSalle(@Body() body: Body) {
    return this.structure.createSalle(body);
  }

  @Patch('salles/:id')
  updateSalle(@Param('id') id: string, @Body() body: Body) {
    return this.structure.updateSalle(id, body);
  }

  @Get('classes')
  classes(
    @Query('anneeId') anneeId?: string,
    @Query('poleId') poleId?: string,
  ) {
    return this.structure.classes(anneeId, poleId);
  }

  @Post('classes')
  createClasse(@Body() body: Body) {
    return this.structure.createClasse(body);
  }

  @Get('classes/:id')
  classe(@Param('id') id: string) {
    return this.structure.classe(id);
  }

  @Get('classes/:id/candidats')
  candidats(@Param('id') id: string) {
    return this.structure.candidats(id);
  }

  @Post('classes/:id/affectations')
  affecter(@Param('id') id: string, @Body() body: Body) {
    return this.structure.affecter(id, body);
  }

  @Delete('classes/:id/affectations/:inscriptionId')
  retirer(
    @Param('id') id: string,
    @Param('inscriptionId') inscriptionId: string,
  ) {
    return this.structure.retirer(id, inscriptionId);
  }

  @Get('maquette')
  maquette(
    @Query('filiereId') filiereId: string,
    @Query('niveau') niveau: string,
    @Query('anneeId') anneeId?: string,
  ) {
    return this.structure.maquette(filiereId, niveau, anneeId);
  }

  @Get('maquettes')
  maquettes(@Query('anneeId') anneeId?: string) {
    return this.structure.maquettes(anneeId);
  }

  @Post('maquette/copier')
  copierMaquette(@Body() body: Body) {
    return this.structure.copierMaquette(body);
  }

  @Post('maquette/reconduire')
  reconduireMaquettes(@Body() body: Body) {
    return this.structure.reconduireMaquettes(body);
  }

  @Post('maquette/importer')
  importerMaquette(@Body() body: Body) {
    return this.structure.importerMaquette(body);
  }

  @Post('unites')
  createUnite(@Body() body: Body) {
    return this.structure.createUnite(body);
  }

  @Patch('unites/:id')
  updateUnite(@Param('id') id: string, @Body() body: Body) {
    return this.structure.updateUnite(id, body);
  }

  @Delete('unites/:id')
  removeUnite(@Param('id') id: string) {
    return this.structure.removeUnite(id);
  }

  @Post('matieres')
  createMatiere(@Body() body: Body) {
    return this.structure.createMatiere(body);
  }

  @Patch('matieres/:id')
  updateMatiere(@Param('id') id: string, @Body() body: Body) {
    return this.structure.updateMatiere(id, body);
  }

  @Delete('matieres/:id')
  removeMatiere(@Param('id') id: string) {
    return this.structure.removeMatiere(id);
  }

  @Get('cours')
  cours(
    @Query() query: { classeId?: string; enseignantId?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.structure.cours(query, acteurDe(request));
  }

  @Patch('cours/:id')
  updateCours(@Param('id') id: string, @Body() body: Body) {
    return this.structure.updateCours(id, body);
  }

  @Get('emploi-du-temps')
  emploiDuTemps(
    @Query()
    query: { classeId?: string; enseignantId?: string; salleId?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.structure.emploiDuTemps(query, acteurDe(request));
  }

  @Post('creneaux')
  createCreneau(@Body() body: Body) {
    return this.structure.createCreneau(body);
  }

  @Delete('creneaux/:id')
  removeCreneau(@Param('id') id: string) {
    return this.structure.removeCreneau(id);
  }
}

// Séances tenues, appel et cahier de textes.
@Controller('scolarite')
@UseGuards(JwtAuthGuard)
export class ScolariteController {
  constructor(private readonly scolarite: ScolariteService) {}

  @Get('seances')
  seances(
    @Query()
    query: { coursId?: string; classeId?: string; du?: string; au?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.scolarite.seances(query, acteurDe(request));
  }

  @Post('seances')
  createSeance(@Body() body: Body, @Req() request: AuthenticatedRequest) {
    return this.scolarite.createSeance(body, acteurDe(request));
  }

  @Patch('seances/:id')
  updateSeance(
    @Param('id') id: string,
    @Body() body: Body,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.scolarite.updateSeance(id, body, acteurDe(request));
  }

  @Delete('seances/:id')
  removeSeance(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.scolarite.removeSeance(id, acteurDe(request));
  }

  @Patch('absences/:id')
  justifier(
    @Param('id') id: string,
    @Body() body: Body,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.scolarite.justifier(id, body, acteurDe(request));
  }

  @Get('assiduite/:classeId')
  assiduite(@Param('classeId') classeId: string) {
    return this.scolarite.assiduite(classeId);
  }
}

// Évaluations et saisie des notes.
@Controller('notes')
@UseGuards(JwtAuthGuard)
export class NotesController {
  constructor(private readonly evaluations: EvaluationsService) {}

  @Get('calendrier')
  calendrier(@Query() query: { anneeId?: string; du?: string; au?: string }) {
    return this.evaluations.calendrier(query);
  }

  @Get('cours/:coursId')
  grille(
    @Param('coursId') coursId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.evaluations.grille(coursId, acteurDe(request));
  }

  @Post('evaluations')
  create(@Body() body: Body, @Req() request: AuthenticatedRequest) {
    return this.evaluations.create(body, acteurDe(request));
  }

  @Patch('evaluations/:id')
  update(
    @Param('id') id: string,
    @Body() body: Body,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.evaluations.update(id, body, acteurDe(request));
  }

  @Delete('evaluations/:id')
  remove(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.evaluations.remove(id, acteurDe(request));
  }

  @Put('evaluations/:id/notes')
  saisirNotes(
    @Param('id') id: string,
    @Body() body: Body,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.evaluations.saisirNotes(id, body, acteurDe(request));
  }

  @Post('evaluations/:id/anonymat')
  anonymiser(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.evaluations.anonymiser(id, acteurDe(request));
  }

  @Get('evaluations/:id/copies')
  copies(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.evaluations.copies(id, acteurDe(request));
  }

  @Put('evaluations/:id/copies')
  saisirCopies(
    @Param('id') id: string,
    @Body() body: Body,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.evaluations.saisirCopies(id, body, acteurDe(request));
  }

  @Get('evaluations/:id/absents')
  absents(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.evaluations.absents(id, acteurDe(request));
  }

  @Put('evaluations/:id/absents')
  marquerAbsents(
    @Param('id') id: string,
    @Body() body: Body,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.evaluations.marquerAbsents(id, body, acteurDe(request));
  }

  @Get('evaluations/:id/correspondance')
  correspondance(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.evaluations.correspondance(id, acteurDe(request));
  }

  @Post('evaluations/:id/valider')
  valider(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.evaluations.valider(id, acteurDe(request));
  }

  @Post('evaluations/:id/rouvrir')
  rouvrir(
    @Param('id') id: string,
    @Body() body: Body,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.evaluations.rouvrir(id, body, acteurDe(request));
  }
}

// Résultats, délibérations, bulletins et passage.
@Controller('deliberations')
@UseGuards(JwtAuthGuard)
export class DeliberationsController {
  constructor(
    private readonly deliberations: DeliberationsService,
    private readonly statistiques: StatistiquesAcademiquesService,
  ) {}

  @Get()
  tableau(@Query('anneeId') anneeId?: string) {
    return this.deliberations.tableau(anneeId);
  }

  @Get('statistiques')
  stats(@Query('anneeId') anneeId?: string) {
    return this.statistiques.synthese(anneeId);
  }

  @Get('dettes')
  dettes(@Query() query: { statut?: string; q?: string }) {
    return this.deliberations.dettes(query);
  }

  @Post('dettes/:id/rattrapage')
  rattraper(
    @Param('id') id: string,
    @Body() body: Body,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.deliberations.rattraper(id, body, acteurDe(request));
  }

  @Get('etudiants')
  etudiants(@Query('q') q?: string) {
    return this.deliberations.rechercherEtudiants(q);
  }

  @Get('etudiants/:personneId/parcours')
  parcours(@Param('personneId') personneId: string) {
    return this.deliberations.parcours(personneId);
  }

  @Get('releves/:inscriptionId')
  releve(@Param('inscriptionId') inscriptionId: string) {
    return this.deliberations.releve(inscriptionId);
  }

  @Get('classes/:classeId/releves')
  releves(@Param('classeId') classeId: string) {
    return this.deliberations.releves(classeId);
  }

  @Get('classes/:classeId/semestres/:semestre')
  resultats(
    @Param('classeId') classeId: string,
    @Param('semestre') semestre: string,
  ) {
    return this.deliberations.resultats(classeId, semestre);
  }

  @Post('classes/:classeId/semestres/:semestre/cloturer')
  cloturer(
    @Param('classeId') classeId: string,
    @Param('semestre') semestre: string,
    @Body() body: Body,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.deliberations.cloturer(
      classeId,
      semestre,
      body,
      acteurDe(request),
    );
  }

  @Post('classes/:classeId/semestres/:semestre/rouvrir')
  rouvrir(
    @Param('classeId') classeId: string,
    @Param('semestre') semestre: string,
    @Body() body: Body,
  ) {
    return this.deliberations.rouvrir(classeId, semestre, body);
  }

  @Get('classes/:classeId/semestres/:semestre/bulletins')
  bulletins(
    @Param('classeId') classeId: string,
    @Param('semestre') semestre: string,
  ) {
    return this.deliberations.bulletins(classeId, semestre);
  }

  @Get('bulletins/:inscriptionId/:semestre')
  bulletin(
    @Param('inscriptionId') inscriptionId: string,
    @Param('semestre') semestre: string,
  ) {
    return this.deliberations.bulletin(inscriptionId, semestre);
  }

  @Get('classes/:classeId/passage')
  passage(@Param('classeId') classeId: string) {
    return this.deliberations.passage(classeId);
  }

  @Post('classes/:classeId/reinscriptions')
  reinscrire(
    @Param('classeId') classeId: string,
    @Body() body: Body,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.deliberations.reinscrire(classeId, body, acteurDe(request));
  }
}
