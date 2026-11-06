import { ArrayMinSize, IsArray, IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export enum AcademyStaffRoleDto {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  COACH = 'COACH',
}

export enum ConsentScopeDto {
  AGGREGATE_ONLY = 'AGGREGATE_ONLY',
  IDENTIFIABLE_ROSTER = 'IDENTIFIABLE_ROSTER',
  SHARED_DOCUMENTS = 'SHARED_DOCUMENTS',
}

export class InviteStaffDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsEnum(AcademyStaffRoleDto)
  @IsNotEmpty()
  role!: AcademyStaffRoleDto;
}

export class InviteStudentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsEmail({}, { each: true })
  emails!: string[];
}

export class AcceptInvitationDto {
  @IsOptional()
  @IsEnum(ConsentScopeDto)
  scope?: ConsentScopeDto;
}
