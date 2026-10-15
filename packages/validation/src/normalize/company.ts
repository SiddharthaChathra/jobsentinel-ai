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

/**
 * Whether two employer names refer to the same company, for deciding if a posting may inherit a
 * single-company source's website domain. Deliberately narrow: the cost of a false "yes" is that a
 * different employer is verified against someone else's website (D83).
 *
 * Same when the normalized names are equal, when one is the other's acronym ("HPE" / "Hewlett
 * Packard Enterprise"), or when the shorter is a whole-word prefix of the longer ("Rubrik" /
 * "Rubrik Job Board"). "Juniper Networks" and "Juniper Square" are not the same.
 */
export function isSameCompany(a: string, b: string): boolean {
  const na = normalizeCompanyName(a);
  const nb = normalizeCompanyName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  const shortWords = short.split(' ');
  const longWords = long.split(' ');

  if (shortWords.length === 1 && short.length >= 2 && longWords.length >= 2) {
    if (longWords.map((w) => w[0]).join('') === short) return true;
  }
  return (
    short.length >= 3 &&
    shortWords.length < longWords.length &&
    shortWords.every((w, i) => longWords[i] === w)
  );
}
