import { IsString, IsNotEmpty } from 'class-validator';

export class RejectCompanyDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}
