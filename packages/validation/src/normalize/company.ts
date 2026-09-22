/** Company name → stable key: lowercase, legal suffixes and punctuation removed (docs 06 §5). */
const LEGAL_SUFFIXES =
  /\b(pvt|private|ltd|limited|inc|incorporated|llc|llp|plc|corp|corporation|co|company|gmbh|sa|ag|bv|technologies|technology|tech|labs|solutions|systems|software|india|group|holdings)\b\.?/g;

export function normalizeCompanyName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // diacritics
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
