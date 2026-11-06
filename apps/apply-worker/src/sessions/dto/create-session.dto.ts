import { Type } from 'class-transformer';
import { IsObject, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';

export class GlorriFillDataDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  citizenship?: string;

  @IsOptional()
  @IsString()
  dob?: string;

  @IsOptional()
  @IsString()
  salary?: string;

  @IsOptional()
  @IsString()
  netGross?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  resumeFilePath?: string;

  @IsOptional()
  @IsString()
  idPhotoFilePath?: string;

  @IsOptional()
  @IsString()
  motivationLetter?: string;

  @IsOptional()
  @IsObject()
  questionAnswers?: Record<string, string>;
}

export class PrivacyAuthorityDto {
  @Matches(/^[a-f0-9]{64}$/)
  noticeHash: string;

  @IsString()
  noticeVersion: string;
}

export class CreateSessionDto {
  @IsString()
  applicationId: string;

  /** Validated against the worker's own destination allowlist before use. */
  @IsString()
  applyUrl: string;

  @IsObject()
  @ValidateNested()
  @Type(() => GlorriFillDataDto)
  fillData: GlorriFillDataDto;

  @ValidateNested()
  @Type(() => PrivacyAuthorityDto)
  privacyAuthority: PrivacyAuthorityDto;
}
