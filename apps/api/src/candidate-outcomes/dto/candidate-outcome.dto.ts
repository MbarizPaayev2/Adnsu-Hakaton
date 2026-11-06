import { IsBoolean, IsDateString, IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { CandidateOutcomeType, OutcomeVerificationStatus } from '@prisma/client';

export class ReportCandidateOutcomeDto {
  @IsEnum(CandidateOutcomeType, {
    message: 'Nəticə növü düzgün deyil (INTERVIEW, OFFER_RECEIVED, OFFER_ACCEPTED, JOB_STARTED, REJECTED, WITHDRAWN)',
  })
  @IsNotEmpty({ message: 'Nəticə növü mütləqdir' })
  outcomeType: CandidateOutcomeType;

  @IsDateString({}, { message: 'Tarix düzgün ISO formatda olmalıdır' })
  @IsNotEmpty({ message: 'Hadisə tarixi mütləqdir' })
  occurredAt: string;

  @IsOptional()
  @IsString({ message: 'Vəzifə adı mətn olmalıdır' })
  @MaxLength(120, { message: 'Vəzifə adı 120 simvoldan çox ola bilməz' })
  jobTitle?: string;

  @IsOptional()
  @IsString({ message: 'Şirkət adı mətn olmalıdır' })
  @MaxLength(120, { message: 'Şirkət adı 120 simvoldan çox ola bilməz' })
  companyName?: string;

  @IsOptional()
  @IsString({ message: 'Kanal adı mətn olmalıdır' })
  channel?: string;

  @IsOptional()
  @IsString({ message: 'Müraciət identifikatoru mətn olmalıdır' })
  applicationId?: string;

  @IsOptional()
  @IsIn([OutcomeVerificationStatus.STUDENT_ATTESTED, OutcomeVerificationStatus.UNVERIFIED], {
    message: 'Namizəd yalnız STUDENT_ATTESTED və ya UNVERIFIED statusu seçə bilər. EMPLOYER_CONFIRMED statusu qadağandır.',
  })
  verificationStatus?: OutcomeVerificationStatus;

  @IsOptional()
  @IsString({ message: 'Qeyd mətn olmalıdır' })
  @MaxLength(500, { message: 'Qeyd 500 simvoldan çox ola bilməz' })
  note?: string;

  @IsOptional()
  @IsBoolean({ message: 'Akademiya ilə paylaşım məntiqi sahə olmalıdır' })
  shareWithAcademy?: boolean;
}

export class UpdateCandidateOutcomeDto {
  @IsOptional()
  @IsEnum(CandidateOutcomeType, {
    message: 'Nəticə növü düzgün deyil',
  })
  outcomeType?: CandidateOutcomeType;

  @IsOptional()
  @IsDateString({}, { message: 'Tarix düzgün ISO formatda olmalıdır' })
  occurredAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  jobTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  companyName?: string;

  @IsOptional()
  @IsIn([OutcomeVerificationStatus.STUDENT_ATTESTED, OutcomeVerificationStatus.UNVERIFIED], {
    message: 'Namizəd yalnız STUDENT_ATTESTED və ya UNVERIFIED statusu seçə bilər. EMPLOYER_CONFIRMED statusu qadağandır.',
  })
  verificationStatus?: OutcomeVerificationStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsBoolean()
  shareWithAcademy?: boolean;

  @IsOptional()
  @IsBoolean()
  withdrawn?: boolean;
}
