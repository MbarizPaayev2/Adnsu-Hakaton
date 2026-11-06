import { FAILED_JOB_RETENTION } from '../common/queue-retention';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { canonicalSkill } from '../jobs/job-skills';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../database/database.service';
import { LocalStorageService } from '../resumes/local-storage.service';

/** Only "YEAR" is stored; month precision is the default and is stored as null. */
const yearOnly = (v: unknown): 'YEAR' | null => (v === 'YEAR' ? 'YEAR' : null);

@Injectable()
export class ProfilesService {
  constructor(
    private prisma: PrismaService,
    private storageService: LocalStorageService,
    @InjectQueue('profile-onboarded') private profileOnboardedQueue: Queue,
  ) {}

  async getProfile(userId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      include: {
        experiences: true,
        education: true,
        user: { select: { name: true, email: true } },
      },
    });
    if (!profile) return profile;
    // name/email live on User (shared with auth/session), not Profile —
    // flatten them onto the response so callers (e.g. the apply form, which
    // shows the candidate's own name/email back to them) have a single place
    // to read from instead of needing a separate /profile + /auth/me call.
    const { user, ...rest } = profile;
    return { ...rest, name: user.name || '', email: user.email };
  }

  async updateProfile(userId: string, data: any) {
    const {
      name,
      headline,
      summary,
      skills,
      location,
      jobPreferences,
      experiences,
      education,
      phone,
      address,
      dob,
      citizenship,
      salaryExpectation,
      preferredNetGross,
      preferredCurrency,
      defaultCoverLetter,
    } = data;

    const saved = await this.prisma.$transaction(async (tx) => {
      // 0. Update the user's display name, if provided
      if (name) {
        await tx.user.update({ where: { id: userId }, data: { name } });
      }

      // 1. Upsert profile
      const profile = await tx.profile.upsert({
        where: { userId },
        create: {
          userId,
          headline: headline || '',
          summary: summary || null,
          skills: skills || [],
          location: location || '',
          jobPreferences: jobPreferences || { roles: [], locations: [], types: [] },
          phone,
          address,
          dob,
          citizenship,
          salaryExpectation,
          preferredNetGross,
          preferredCurrency,
          defaultCoverLetter,
        },
        update: {
          headline: headline ?? undefined,
          summary: summary ?? undefined,
          skills: skills ?? undefined,
          location: location ?? undefined,
          jobPreferences: jobPreferences ?? undefined,
          phone: phone ?? undefined,
          address: address ?? undefined,
          dob: dob ?? undefined,
          citizenship: citizenship ?? undefined,
          salaryExpectation: salaryExpectation ?? undefined,
          preferredNetGross: preferredNetGross ?? undefined,
          preferredCurrency: preferredCurrency ?? undefined,
          defaultCoverLetter: defaultCoverLetter ?? undefined,
        },
      });

      // 2. Sync experiences if provided
      if (experiences && Array.isArray(experiences)) {
        // Delete existing experiences
        await tx.experience.deleteMany({
          where: { profileId: profile.id },
        });

        // Insert new ones
        if (experiences.length > 0) {
          await tx.experience.createMany({
            data: experiences.map((exp: any) => ({
              profileId: profile.id,
              title: exp.title,
              company: exp.company,
              location: exp.location ? String(exp.location).trim() || null : null,
              startDate: new Date(exp.startDate),
              endDate: exp.endDate ? new Date(exp.endDate) : null,
              startPrecision: yearOnly(exp.startPrecision),
              endPrecision: exp.endDate ? yearOnly(exp.endPrecision) : null,
              description: exp.description || '',
            })),
          });
        }
      }

      // 3. Sync education if provided
      if (education && Array.isArray(education)) {
        // Delete existing education
        await tx.education.deleteMany({
          where: { profileId: profile.id },
        });

        // Insert new ones
        if (education.length > 0) {
          await tx.education.createMany({
            data: education.map((edu: any) => ({
              profileId: profile.id,
              institution: edu.institution,
              degree: edu.degree,
              fieldOfStudy: edu.fieldOfStudy,
              location: edu.location ? String(edu.location).trim() || null : null,
              startDate: edu.startDate ? new Date(edu.startDate) : null,
              endDate: edu.endDate ? new Date(edu.endDate) : null,
              startPrecision: edu.startDate ? yearOnly(edu.startPrecision) : null,
              endPrecision: edu.endDate ? yearOnly(edu.endPrecision) : null,
            })),
          });
        }
      }

      // Return complete profile
      return tx.profile.findUnique({
        where: { id: profile.id },
        include: {
          experiences: true,
          education: true,
        },
      });
    });

    // Matches are scored from the saved profile, so a corrected profile must
    // be re-scored (existing matches refreshed, newly relevant jobs added).
    // Before onboarding completes, completeOnboarding() runs the first pass.
    let matchingQueued: boolean | null = null;
    if (saved?.onboardingCompletedAt) {
      try {
        await this.profileOnboardedQueue.add('run-for-profile', { userId }, {
          removeOnComplete: true, removeOnFail: FAILED_JOB_RETENTION, attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        });
        matchingQueued = true;
      } catch (err) {
        matchingQueued = false;
        console.error(`Failed to enqueue profile re-match for user ${userId}`, err);
      }
    }

    return saved ? { ...saved, matchingQueued } : saved;
  }

  /** One confirmed skill, de-duplicated against the saved ones under the same synonym rules the guidance uses; saved through the normal edit path so matches are re-scored. */
  async addConfirmedSkill(userId: string, skill: string) {
    const text = String(skill ?? '').replace(/\s+/g, ' ').trim();
    if (text.length < 2 || text.length > 60 || /[\r\n<>]/.test(text) || !/\p{L}/u.test(text)) throw new BadRequestException('Bacarığın adı düzgün deyil');
    const profile = await this.prisma.profile.findUnique({ where: { userId }, select: { skills: true } });
    if (!profile) throw new NotFoundException('Əvvəlcə profilinizi doldurun');
    const { key, label } = canonicalSkill(text);
    if (profile.skills.some((s) => canonicalSkill(s).key === key)) return { added: false, skill: label, skills: profile.skills };
    const skills = [...profile.skills, label];
    const saved = await this.updateProfile(userId, { skills });
    return { added: true, skill: label, skills, matchingQueued: (saved as { matchingQueued?: boolean | null } | null)?.matchingQueued ?? null };
  }

  /** Multiple confirmed skills, de-duplicated against saved ones under canonical synonym rules; updates profile and triggers match rescore. */
  async addBulkConfirmedSkills(userId: string, skills: string[]) {
    if (!Array.isArray(skills) || skills.length === 0) {
      throw new BadRequestException('Ən azı bir bacarıq təqdim olunmalıdır');
    }
    const profile = await this.prisma.profile.findUnique({ where: { userId }, select: { skills: true } });
    if (!profile) throw new NotFoundException('Əvvəlcə profilinizi doldurun');

    const existingKeys = new Set(profile.skills.map((s) => canonicalSkill(s).key));
    const added: string[] = [];
    const nextSkills = [...profile.skills];

    for (const raw of skills) {
      const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
      if (text.length < 2 || text.length > 60 || /[\r\n<>]/.test(text) || !/\p{L}/u.test(text)) {
        continue;
      }
      const { key, label } = canonicalSkill(text);
      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        added.push(label);
        nextSkills.push(label);
      }
    }

    if (added.length === 0) {
      return { addedCount: 0, addedSkills: [], skills: profile.skills, matchingQueued: null };
    }

    const saved = await this.updateProfile(userId, { skills: nextSkills });
    return {
      addedCount: added.length,
      addedSkills: added,
      skills: nextSkills,
      matchingQueued: (saved as { matchingQueued?: boolean | null } | null)?.matchingQueued ?? null,
    };
  }

  // Marks the first-login step-by-step wizard as finished. Idempotent: once
  // set, later calls don't move the original completion timestamp or
  // re-trigger the matching pass below.
  async completeOnboarding(userId: string) {
    const existing = await this.prisma.profile.findUnique({ where: { userId } });
    if (!existing) {
      throw new NotFoundException('Tamamlamadan əvvəl profilinizi doldurun');
    }
    if (existing.onboardingCompletedAt) {
      return existing;
    }
    const updated = await this.prisma.profile.update({
      where: { userId },
      data: { onboardingCompletedAt: new Date() },
    });

    // Matching otherwise only runs when a new job is ingested — without this,
    // a user would never be checked against vacancies already sitting in the
    // database at the moment they finish onboarding. Async (BullMQ), so the
    // onboarding response doesn't wait on scoring every existing job.
    await this.profileOnboardedQueue.add(
      'run-for-profile',
      { userId },
      { removeOnComplete: true, removeOnFail: FAILED_JOB_RETENTION, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    ).catch((err) => console.error(`Failed to enqueue onboarding match run for user ${userId}`, err));

    return updated;
  }

  // Deliberately an upsert, not gated on onboarding/a filled-out profile —
  // volunteering opt-in is meant to be frictionless (free, no CV matching),
  // so a user can flip this on before ever filling in a career profile.
  async setVolunteerOptIn(userId: string, enabled: boolean) {
    return this.prisma.profile.upsert({
      where: { userId },
      create: {
        userId,
        headline: '',
        skills: [],
        location: '',
        jobPreferences: { roles: [], locations: [], types: [] },
        volunteerOpportunitiesOptIn: enabled,
      },
      update: { volunteerOpportunitiesOptIn: enabled },
    });
  }

  // Stores the uploaded ID-document image and records its URL on the
  // profile. Uses LocalStorageService (server-generated filename) rather than
  // ever trusting a client-supplied file path/URL directly.
  async setIdDocument(userId: string, file: Express.Multer.File) {
    const existing = await this.prisma.profile.findUnique({ where: { userId } });
    if (!existing) {
      throw new NotFoundException('Şəxsiyyət sənədi yükləmədən əvvəl profilinizi doldurun');
    }
    const idDocumentUrl = await this.storageService.uploadFile(file);
    const updated = await this.prisma.profile.update({
      where: { userId },
      data: { idDocumentUrl },
    });

    if (existing.idDocumentUrl && existing.idDocumentUrl !== idDocumentUrl) {
      await this.storageService.deleteFile(existing.idDocumentUrl);
    }

    return updated;
  }
}
