/**
 * Azerbaijani labels for the profile fields auto-apply requires.
 *
 * The API returns `missingProfileFields` as raw column names — `phone`,
 * `preferredNetGross`, `idDocumentUrl` — and the matches page rendered them
 * verbatim, so an Azerbaijani user chasing the product's headline feature was
 * shown a list of English camelCase identifiers.
 *
 * Keys must stay in step with REQUIRED_PROFILE_FIELDS in
 * apps/api/src/external-apply/external-apply.service.ts. `profileFieldLabel`
 * falls back to the raw key, so a field added there without a label here
 * degrades to the old behaviour rather than rendering blank.
 */
const PROFILE_FIELD_LABELS: Record<string, string> = {
  phone: "Telefon nömrəsi",
  address: "Ünvan",
  dob: "Doğum tarixi",
  citizenship: "Vətəndaşlıq",
  salaryExpectation: "Maaş gözləntisi",
  preferredNetGross: "Maaş növü (net/gross)",
  preferredCurrency: "Valyuta",
  idDocumentUrl: "Şəxsiyyət sənədi",
};

export function profileFieldLabel(field: string): string {
  return PROFILE_FIELD_LABELS[field] ?? field;
}

export function profileFieldLabels(fields: string[]): string {
  return fields.map(profileFieldLabel).join(", ");
}
