import { IsDefined } from 'class-validator';

export class UpdateResumeDto {
  @IsDefined()
  parsedContent: any;
}
