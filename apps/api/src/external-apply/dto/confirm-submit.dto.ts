import { IsBoolean, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class ConfirmSubmitDto {
  /** Generated once per confirmation by the client; a repeat is a replay, never a second send. */
  @IsUUID('4')
  attemptId: string;

  /** The review version the candidate looked at; any later change needs a new review. */
  @IsInt()
  @Min(0)
  reviewVersion: number;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
