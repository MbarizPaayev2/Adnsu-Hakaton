import { IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class MfaLoginDto {
  @Matches(/^[a-f0-9]{64}$/)
  challengeToken: string;

  @IsString()
  @Length(6, 32)
  code: string;
}

export class SetupDto {
  @Matches(/^[a-f0-9]{64}$/)
  token: string;

  @IsString()
  @Length(12, 200)
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(200)
  currentPassword: string;

  @IsString()
  @Length(12, 200)
  newPassword: string;

  @IsOptional()
  @IsString()
  @Length(6, 32)
  code?: string;
}

export class MfaCodeDto {
  @IsString()
  @Length(6, 32)
  code: string;
}

export class DisableMfaDto {
  @IsString()
  @MaxLength(200)
  password: string;

  @IsString()
  @Length(6, 32)
  code: string;
}

export class InviteOperatorDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsIn(['SUPER_ADMIN', 'ADMIN', 'SUPPORT'])
  role: 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT';
}

export class ChangeRoleDto {
  @IsIn(['SUPER_ADMIN', 'ADMIN', 'SUPPORT'])
  role: 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT';
}

export class DisableOperatorDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
