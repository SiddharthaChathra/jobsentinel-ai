import { z } from 'zod';
import { EmploymentType, ExperienceLevel, JobCategory, RemotePreference, RoleTier } from '../enums';

/** Sub-documents stored as jsonb on `profiles` (docs 02 §3.1). */
export const EducationEntry = z.object({
  institution: z.string().min(1).max(200),
  degree: z.string().max(120).nullable().default(null),
  field: z.string().max(120).nullable().default(null),
  startYear: z.number().int().min(1980).max(2040).nullable().default(null),
  endYear: z.number().int().min(1980).max(2040).nullable().default(null),
  score: z.string().max(40).nullable().default(null),
});
export type EducationEntry = z.infer<typeof EducationEntry>;

export const ProjectEntry = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(1000).nullable().default(null),
  skills: z.array(z.string().max(60)).max(30).default([]),
});
export type ProjectEntry = z.infer<typeof ProjectEntry>;

export const ExperienceEntry = z.object({
  company: z.string().min(1).max(160),
  title: z.string().max(160).nullable().default(null),
  kind: z.enum(['INTERNSHIP', 'JOB', 'FREELANCE', 'OTHER']).default('OTHER'),
  start: z.string().max(20).nullable().default(null),
  end: z.string().max(20).nullable().default(null),
  description: z.string().max(1000).nullable().default(null),
});
export type ExperienceEntry = z.infer<typeof ExperienceEntry>;

export const CertificationEntry = z.object({
  name: z.string().min(1).max(160),
  issuer: z.string().max(120).nullable().default(null),
  year: z.number().int().min(1990).max(2040).nullable().default(null),
});
export type CertificationEntry = z.infer<typeof CertificationEntry>;

export const SkillCategory = z.enum([
  'LANGUAGE',
  'FRAMEWORK',
  'DATABASE',
  'CLOUD',
  'NETWORKING',
  'OS',
  'DEVOPS',
  'DATA_AI',
  'TOOL',
  'SOFT',
  'OTHER',
]);
export type SkillCategory = z.infer<typeof SkillCategory>;

export const ProfileSkillInput = z.object({
  name: z.string().min(1).max(60),
  category: SkillCategory.default('OTHER'),
  proficiency: z.enum(['BASIC', 'INTERMEDIATE', 'ADVANCED']).nullable().default(null),
});
export type ProfileSkillInput = z.infer<typeof ProfileSkillInput>;

/** What the AI proposes after reading a resume; the user edits/confirms it (docs 09 §3). */
export const ResumeProfileDraft = z.object({
  name: z.string().max(120).nullable().default(null),
  summary: z.string().max(600).nullable().default(null),
  experienceLevel: ExperienceLevel.default('FRESHER'),
  graduationYear: z.number().int().min(2000).max(2040).nullable().default(null),
  degree: z.string().max(120).nullable().default(null),
  branch: z.string().max(120).nullable().default(null),
  college: z.string().max(200).nullable().default(null),
  location: z.string().max(120).nullable().default(null),
  education: z.array(EducationEntry).max(10).default([]),
  skills: z.array(ProfileSkillInput).max(60).default([]),
  projects: z.array(ProjectEntry).max(15).default([]),
  experience: z.array(ExperienceEntry).max(15).default([]),
  certifications: z.array(CertificationEntry).max(20).default([]),
  suggestedRoles: z
    .array(
      z.object({
        title: z.string().min(1).max(80),
        tier: RoleTier,
        reason: z.string().max(200).nullable().default(null),
      }),
    )
    .max(12)
    .default([]),
  suggestedLocations: z.array(z.string().max(80)).max(10).default([]),
});
export type ResumeProfileDraft = z.infer<typeof ResumeProfileDraft>;

/** Full replacement of the confirmed profile (PUT /profile). */
export const ProfileInput = z.object({
  sourceResumeId: z.string().uuid().nullable().default(null),
  experienceLevel: ExperienceLevel,
  graduationYear: z.number().int().min(2000).max(2040).nullable(),
  degree: z.string().max(120).nullable(),
  branch: z.string().max(120).nullable(),
  college: z.string().max(200).nullable(),
  locationText: z.string().max(120).nullable(),
  summary: z.string().max(600).nullable(),
  education: z.array(EducationEntry).max(10),
  projects: z.array(ProjectEntry).max(15),
  experience: z.array(ExperienceEntry).max(15),
  certifications: z.array(CertificationEntry).max(20),
  skills: z.array(ProfileSkillInput).min(1).max(60),
});
export type ProfileInput = z.infer<typeof ProfileInput>;

export const ProfileSkill = ProfileSkillInput.extend({
  id: z.string().uuid(),
  normalizedName: z.string(),
  origin: z.enum(['RESUME', 'USER']),
});
export type ProfileSkill = z.infer<typeof ProfileSkill>;

export const Profile = ProfileInput.omit({ skills: true }).extend({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  skills: z.array(ProfileSkill),
  confirmedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type Profile = z.infer<typeof Profile>;

export const PreferredRoleInput = z.object({
  title: z.string().min(2).max(80),
  tier: RoleTier,
  enabled: z.boolean().default(true),
});
export type PreferredRoleInput = z.infer<typeof PreferredRoleInput>;

export const PreferredRole = PreferredRoleInput.extend({
  id: z.string().uuid(),
  normalizedTitle: z.string(),
  roleFamily: z.string(),
});
export type PreferredRole = z.infer<typeof PreferredRole>;

export const PreferencesInput = z.object({
  locations: z.array(z.string().min(1).max(80)).max(20),
  remotePreference: RemotePreference,
  employmentTypes: z.array(EmploymentType).min(1),
  categories: z.array(JobCategory).min(1),
  fresherOnly: z.boolean(),
  includeUnknownExperience: z.boolean(),
  salaryMin: z.number().int().positive().nullable(),
  salaryCurrency: z.string().length(3).toUpperCase(),
  graduationYear: z.number().int().min(2000).max(2040).nullable(),
  timezone: z.string().min(1).max(64),
  instantMinScore: z.number().int().min(0).max(100),
});
export type PreferencesInput = z.infer<typeof PreferencesInput>;

export const Preferences = PreferencesInput.extend({
  userId: z.string().uuid(),
  updatedAt: z.string(),
});
export type Preferences = z.infer<typeof Preferences>;

export const Me = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string(),
    displayName: z.string().nullable(),
    isAdmin: z.boolean(),
  }),
  onboardingCompleted: z.boolean(),
  profileVersion: z.number().int(),
  hasActiveResume: z.boolean(),
  hasProfile: z.boolean(),
  telegramLinked: z.boolean(),
});
export type Me = z.infer<typeof Me>;

export const MePatch = z.object({ displayName: z.string().min(1).max(80).nullable().optional() });
export type MePatch = z.infer<typeof MePatch>;
