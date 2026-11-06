import { IsBoolean, IsUUID } from 'class-validator';

export class ConfirmSubmitDto {
  @IsUUID('4')
  attemptId: string;

  @IsBoolean()
  dryRun: boolean;
}
