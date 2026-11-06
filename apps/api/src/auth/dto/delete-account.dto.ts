import { IsString, MaxLength } from 'class-validator';

export class DeleteAccountDto {
  @IsString()
  @MaxLength(128)
  password: string;
}
