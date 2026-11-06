import { BadRequestException, type ValidationError } from '@nestjs/common';

/**
 * class-validator's default messages are English and name internal fields ("organization must be longer than or equal to 2 characters"). A
 * candidate never sees that: a message the DTO wrote itself (Azerbaijani) is kept, a default one becomes a plain Azerbaijani sentence. The
 * response keeps Nest's shape ({ message: string[] }), so existing clients still work.
 */
const DEFAULTS: Record<string, string> = {
  isEmail: 'E-poçt ünvanı düzgün deyil.',
  isNotEmpty: 'Məcburi sahə boşdur.',
  isString: 'Mətn sahəsi düzgün deyil.',
  minLength: 'Mətn çox qısadır.',
  maxLength: 'Mətn çox uzundur.',
  isDateString: 'Tarix düzgün deyil.',
  isDate: 'Tarix düzgün deyil.',
  isInt: 'Tam ədəd yazın.',
  isNumber: 'Rəqəm yazın.',
  min: 'Rəqəm çox kiçikdir.',
  max: 'Rəqəm çox böyükdür.',
  isIn: 'Seçim düzgün deyil.',
  isEnum: 'Seçim düzgün deyil.',
  isBoolean: 'Seçim düzgün deyil.',
  isUrl: 'Keçid düzgün deyil.',
  isArray: 'Siyahı düzgün deyil.',
  whitelistValidation: 'Formada gözlənilməyən məlumat var.',
};
const FALLBACK = 'Formada düzgün olmayan sahə var.';

/** A message the DTO author wrote: anything that is not class-validator's English default. */
const authored = (m: string) => /[əğıöşüçƏĞİÖŞÜÇ]/.test(m) || !/\b(?:must|should|is not|has failed)\b/.test(m);

function collect(errors: ValidationError[], out: string[]) {
  for (const e of errors) {
    for (const [key, message] of Object.entries(e.constraints ?? {})) out.push(authored(message) ? message : DEFAULTS[key] ?? FALLBACK);
    if (e.children?.length) collect(e.children, out);
  }
}

export function validationException(errors: ValidationError[]): BadRequestException {
  const messages: string[] = [];
  collect(errors, messages);
  return new BadRequestException([...new Set(messages.length ? messages : [FALLBACK])]);
}
