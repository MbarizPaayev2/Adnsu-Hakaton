import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class GoogleSignInDto {
  @IsString()
  @MinLength(20)
  @MaxLength(8192)
  idToken!: string;

  /** The notice next to the Google button (Terms of Use and Privacy Policy) was shown; recorded only if a NEW account is created. */
  @IsOptional()
  @IsBoolean()
  acceptTerms?: boolean;
}
