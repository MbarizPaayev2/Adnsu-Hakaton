import { BadRequestException, Controller, Get, Patch, Post, Body, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProfilesService } from './profiles.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateVolunteerOptInDto } from './dto/update-volunteer-opt-in.dto';
import { AddSkillDto } from './dto/add-skill.dto';
import { AddBulkSkillsDto } from './dto/add-bulk-skills.dto';
import { IMAGE_MIME_TYPES } from '../resumes/local-storage.service';

@Controller('profile')
@UseGuards(SessionAuthGuard)
export class ProfilesController {
  constructor(private profilesService: ProfilesService) {}

  @Get()
  async getProfile(
    @GetUser('id') userId: string,
    @GetUser('name') name: string | null,
    @GetUser('email') email: string,
  ) {
    const profile = await this.profilesService.getProfile(userId);
    return (
      profile || {
        name: name || '',
        email,
        headline: '',
        skills: [],
        location: '',
        jobPreferences: { roles: [], locations: [], types: [] },
        experiences: [],
        education: [],
        onboardingCompletedAt: null,
        volunteerOpportunitiesOptIn: false,
      }
    );
  }

  @Patch()
  async updateProfile(@GetUser('id') userId: string, @Body() body: UpdateProfileDto) {
    return this.profilesService.updateProfile(userId, body);
  }

  /** Adds multiple skills confirmed by the candidate in bulk. Matches are re-scored once for the whole batch. */
  @Post('skills/bulk')
  async addBulkSkills(@GetUser('id') userId: string, @Body() body: AddBulkSkillsDto) {
    return this.profilesService.addBulkConfirmedSkills(userId, body.skills);
  }

  /** Adds one skill the candidate confirmed (for example from a posting's "not in your profile" list). Matches are re-scored by the same path as any profile edit. */
  @Post('skills')
  async addSkill(@GetUser('id') userId: string, @Body() body: AddSkillDto) {
    return this.profilesService.addConfirmedSkill(userId, body.skill);
  }

  @Post('complete-onboarding')
  async completeOnboarding(@GetUser('id') userId: string) {
    return this.profilesService.completeOnboarding(userId);
  }

  @Patch('volunteer-opt-in')
  async setVolunteerOptIn(@GetUser('id') userId: string, @Body() body: UpdateVolunteerOptInDto) {
    return this.profilesService.setVolunteerOptIn(userId, body.enabled);
  }

  @Post('id-document')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 4 * 1024 * 1024 }, // 4MB
      fileFilter: (_req, file, callback) => {
        if (!IMAGE_MIME_TYPES.includes(file.mimetype)) {
          callback(new BadRequestException('Yalnız şəkil faylları (PNG/JPEG/WebP) qəbul edilir'), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  async uploadIdDocument(@GetUser('id') userId: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Fayl tələb olunur (form-data sahə adı: file, şəkil, maks. 4MB)');
    }
    return this.profilesService.setIdDocument(userId, file);
  }
}
