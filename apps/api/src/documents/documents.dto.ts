import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { DOCUMENT_LANGUAGES } from './language';

export const DOCUMENT_KINDS = ['CV', 'RESUME', 'LETTER'] as const;
export type RequestedKind = (typeof DOCUMENT_KINDS)[number];

export class DocumentItemDto {
  @IsIn(DOCUMENT_KINDS as unknown as string[]) kind: RequestedKind;
  @IsOptional() @IsIn(DOCUMENT_LANGUAGES) language?: string;
}

/** What the candidate wants the letter to say. Treated as the candidate's own words (data), never as instructions. */
export class LetterInputsDto {
  @IsOptional() @IsString() @MaxLength(2000) motivation?: string;
  /** Why this employer, in the candidate's own words. Never invented: when it is empty the letter states no reason for the employer. */
  @IsOptional() @IsString() @MaxLength(1000) companyReason?: string;
  /** Which experience made the interest in this kind of work clearer, in the candidate's own words. */
  @IsOptional() @IsString() @MaxLength(1000) formative?: string;
  /** The contribution or result the candidate wants the employer to notice, in their own words. */
  @IsOptional() @IsString() @MaxLength(1000) contribution?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(60, { each: true }) storyIds?: string[];
}

/** A reviewed, candidate-provided target. It is stored only on generated documents, never in the shared jobs catalogue. */
export class PrivateVacancyContextDto {
  @IsString() @MaxLength(140) title: string;
  @IsString() @MaxLength(40_000) originalText: string;
  @IsOptional() @IsString() @MaxLength(160) company?: string | null;
  @IsOptional() @IsString() @MaxLength(256) location?: string | null;
  @IsOptional() @IsString() @MaxLength(40_000) description?: string;
  @IsOptional() @IsString() @MaxLength(5_000) requirements?: string;
  @IsOptional() @IsString() @MaxLength(5_000) responsibilities?: string;
  @IsOptional() @IsDateString() deadline?: string | null;
  @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(2_048) sourceUrl?: string | null;
}

export class QuoteDocumentsDto {
  @ValidateIf((o) => !o.privateVacancy) @IsString() @MaxLength(60) matchId?: string;
  @IsOptional() @ValidateNested() @Type(() => PrivateVacancyContextDto) privateVacancy?: PrivateVacancyContextDto;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => DocumentItemDto) items: DocumentItemDto[];
}

export class GenerateDocumentsDto extends QuoteDocumentsDto {
  /** The cost the candidate was shown. A different actual cost is refused (409 COST_MISMATCH) so a bundle never costs more than displayed. */
  @IsInt() @Min(0) @Max(3) expectedUnits: number;
  /** Optional client idempotency key (8-64 chars): replaying the same request returns the same documents without charging again. */
  @IsOptional() @IsString() @MaxLength(64) requestId?: string;
  @IsOptional() @ValidateNested() @Type(() => LetterInputsDto) letter?: LetterInputsDto;
  /** Explicit career-section selection. Omitted means automatic; [] means none of the selectable entries. */
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) @MaxLength(60, { each: true }) selectedCareerEntryIds?: string[];
}

export class RegenerateDocumentDto {
  @IsInt() @Min(1) @Max(1) expectedUnits: number;
  @IsOptional() @IsIn(DOCUMENT_LANGUAGES) language?: string;
  @IsOptional() @IsString() @MaxLength(64) requestId?: string;
  @IsOptional() @ValidateNested() @Type(() => LetterInputsDto) letter?: LetterInputsDto;
  /** Explicit career-section selection. Omitted means automatic; [] means none of the selectable entries. */
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) @MaxLength(60, { each: true }) selectedCareerEntryIds?: string[];
}

export class LetterEditDto {
  @IsOptional() @IsArray() @ArrayMaxSize(5) paragraphs?: { id?: string; text: string; approved?: boolean }[];
}
