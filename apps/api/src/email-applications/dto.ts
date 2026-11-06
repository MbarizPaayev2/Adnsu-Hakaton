import { IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';

const STATES = ['SENT', 'ACKNOWLEDGED', 'INTERVIEW_INVITED', 'INTERVIEW_SCHEDULED', 'OFFER', 'REJECTED', 'WITHDRAWN', 'HIRED'] as const;

export class PrepareEmailApplicationDto {
  @IsString() @Length(1, 64) jobId: string;
  @IsOptional() @IsString() @Length(1, 64) resumeId?: string;
  /** An approved motivation letter made for this vacancy, attached as a second document. */
  @IsOptional() @IsString() @Length(1, 64) letterId?: string;
}

export class UpdateDraftDto {
  @IsOptional() @IsString() @MaxLength(6000) body?: string;
  @IsOptional() @IsString() @MaxLength(400) subject?: string;
  @IsOptional() @IsString() @Length(1, 64) resumeId?: string;
  @IsOptional() @IsString() @Length(1, 64) letterId?: string;
  @IsOptional() @IsBoolean() removeLetter?: boolean;
  @IsOptional() @IsBoolean() copyToSelf?: boolean;
}

export class ApproveDto {
  @IsString() @Length(64, 64) payloadSha256: string;
  @IsBoolean() consent: boolean;
  @IsOptional() @IsBoolean() instructionsAcknowledged?: boolean;
}

export class RetryUncertainDto {
  @IsBoolean() acknowledgeDuplicateRisk: boolean;
}

export class UpdateRecruitmentDto {
  @IsOptional() @IsIn(STATES) state?: (typeof STATES)[number];
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsISO8601() interviewAt?: string;
  @IsOptional() @IsString() @MaxLength(64) interviewTimezone?: string;
  @IsOptional() @IsString() @MaxLength(2000) interviewNotes?: string;
  @IsOptional() @IsBoolean() reminderOptIn?: boolean;
}

export class ConfirmReplyDto {
  @IsBoolean() accept: boolean;
  @IsOptional() @IsIn(STATES) state?: (typeof STATES)[number];
  @IsOptional() @IsISO8601() interviewAt?: string;
  @IsOptional() @IsString() @MaxLength(64) interviewTimezone?: string;
}

export class AutomationDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() consent?: boolean;
  @IsOptional() @IsArray() allowedRoles?: string[];
  @IsOptional() @IsArray() allowedLocations?: string[];
  @IsOptional() @IsArray() allowedEmployers?: string[];
  @IsOptional() @IsArray() excludedEmployers?: string[];
  @IsOptional() @IsArray() excludedKeywords?: string[];
  @IsOptional() @IsInt() @Min(1) @Max(10) dailyLimit?: number;
  @IsOptional() @IsString() @Length(1, 64) cvResumeId?: string;
  @IsOptional() @IsString() @MaxLength(2500) letterTemplate?: string;
  @IsOptional() @IsBoolean() reviewQueue?: boolean;
}
