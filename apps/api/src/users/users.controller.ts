import { Body, Controller, Get, Inject, Patch, Put, Query } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  Me,
  MePatch,
  PreferencesInput,
  PreferredRoleInput,
  ProfileInput,
  type Preferences,
  type PreferredRole,
  type Profile,
} from '@jobsentinel/types';
import type { AuthenticatedUser } from '../auth/auth.types';
import { DB, type Db } from '../common/db/db.module';
import { resumes, users } from '../common/db/schema';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AppError } from '../common/errors/app-error';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PreferencesService } from './preferences.service';
import { ProfilesService } from './profiles.service';

const SkillSearchQuery = z.object({ q: z.string().min(1).max(60) });
const RolesBody = z.array(PreferredRoleInput).max(30);

@Controller()
export class UsersController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly profiles: ProfilesService,
    private readonly prefs: PreferencesService,
  ) {}

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser): Promise<Me> {
    const row = await this.db.query.users.findFirst({ where: eq(users.id, user.id) });
    if (!row) throw AppError.notFound('USER_NOT_FOUND');
    const activeResume = await this.db.query.resumes.findFirst({
      where: (r, { and }) => and(eq(r.userId, user.id), eq(resumes.isActive, true)),
      columns: { id: true },
    });
    return {
      user: { id: row.id, email: row.email, displayName: row.displayName, isAdmin: row.isAdmin },
      onboardingCompleted: row.onboardingCompletedAt !== null,
      profileVersion: row.profileVersion,
      hasActiveResume: Boolean(activeResume),
      hasProfile: await this.profiles.hasProfile(user.id),
      telegramLinked: false, // Phase 9
    };
  }

  @Patch('me')
  async patchMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(MePatch)) body: MePatch,
  ): Promise<Me> {
    if (body.displayName !== undefined) {
      await this.db
        .update(users)
        .set({ displayName: body.displayName, updatedAt: new Date() })
        .where(eq(users.id, user.id));
    }
    return this.me(user);
  }

  @Get('profile')
  async getProfile(@CurrentUser() user: AuthenticatedUser): Promise<Profile> {
    const profile = await this.profiles.get(user.id);
    if (!profile)
      throw AppError.notFound('PROFILE_NOT_FOUND', 'Confirm your profile during onboarding first');
    return profile;
  }

  @Put('profile')
  putProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(ProfileInput)) body: ProfileInput,
  ): Promise<Profile> {
    return this.profiles.replace(user.id, body);
  }

  @Get('preferences')
  getPreferences(@CurrentUser() user: AuthenticatedUser): Promise<Preferences> {
    return this.prefs.get(user.id);
  }

  @Put('preferences')
  putPreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(PreferencesInput)) body: PreferencesInput,
  ): Promise<Preferences> {
    return this.prefs.replace(user.id, body);
  }

  @Get('preferred-roles')
  getRoles(@CurrentUser() user: AuthenticatedUser): Promise<PreferredRole[]> {
    return this.prefs.listRoles(user.id);
  }

  @Put('preferred-roles')
  putRoles(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(RolesBody)) body: PreferredRoleInput[],
  ): Promise<PreferredRole[]> {
    return this.prefs.replaceRoles(user.id, body);
  }

  @Get('skills/search')
  searchSkills(
    @Query(new ZodValidationPipe(SkillSearchQuery)) query: z.infer<typeof SkillSearchQuery>,
  ) {
    return this.profiles.searchSkills(query.q);
  }
}
