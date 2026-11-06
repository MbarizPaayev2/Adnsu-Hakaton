import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

/** Picks one of the candidate's confirmed career entries for this document (optionally rewording its description). */
export class EntryPickDto {
  @IsString() @MaxLength(60) entryId: string;
  @IsOptional() @IsString() @MaxLength(1500) description?: string;
}

/** One paragraph of a motivation letter. `id` is the paragraph's stable id (omit for a new paragraph); `approved` makes regeneration keep it word for word. */
export class LetterParagraphDto {
  @IsOptional() @IsString() @MaxLength(60) id?: string;
  @IsString() @MaxLength(1500) text: string;
  @IsOptional() @IsBoolean() approved?: boolean;
}

// Shape is re-checked against the saved profile in applyReviewEdits();
// these bounds only keep oversized bodies out.
export class TailorReviewDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  headline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  summary?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  experience?: { highlights?: string[] }[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  skills?: any[];


  @IsOptional() @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => EntryPickDto) projects?: EntryPickDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => EntryPickDto) activities?: EntryPickDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => EntryPickDto) awards?: EntryPickDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => EntryPickDto) certifications?: EntryPickDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => EntryPickDto) languages?: EntryPickDto[];

  // Motivation letters only: the full paragraph list after the edit (1 to 5).
  @IsOptional() @IsArray() @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => LetterParagraphDto) paragraphs?: LetterParagraphDto[];
}
