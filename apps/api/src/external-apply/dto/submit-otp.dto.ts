import { IsString, IsUUID, Matches } from 'class-validator';

export class SubmitOtpDto {
  @IsString()
  @Matches(/^[A-Za-z0-9]{3,12}$/)
  code: string;

  @IsUUID('4')
  attemptId: string;
}
