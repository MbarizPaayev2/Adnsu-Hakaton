import { IsEmail, IsString, MaxLength, MinLength, IsBoolean, IsOptional } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsString()
  @MinLength(8, { message: 'Şifrə ən azı 8 simvoldan ibarət olmalıdır' })
  @MaxLength(128)
  password: string;

  /** The sign-up form's required checkbox (Terms of Use and Privacy Policy). */
  @IsOptional()
  @IsBoolean()
  acceptTerms?: boolean;
}
