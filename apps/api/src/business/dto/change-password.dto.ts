import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MaxLength(128)
  currentPassword: string;

  @IsString()
  @MinLength(8, { message: 'Yeni şifrə ən azı 8 simvoldan ibarət olmalıdır' })
  @MaxLength(128)
  newPassword: string;
}
