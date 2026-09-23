/**
 * Extracts a specific batch year from a job description if one is mentioned.
 * Looks for patterns like "2025 batch", "Batch of 2025", "Class of 2027",
 * "Graduating 2027", "2025 passouts", etc.
 */
export function extractJobBatchYear(text: string): number | null {
  const candidates: number[] = [];

  // Specific batch requirement patterns
  const batchPatterns = [
    /(?:20\d{2})\s*batch(?:\s*only)?/gi,
    /batch\s*of\s*(20\d{2})/gi,
    /(?:20\d{2})\s*pass\s?outs?/gi,
    /class\s*of\s*(20\d{2})/gi,
    /graduating\s*(?:in\s*)?(20\d{2})/gi,
    /(?:20\d{2})\s*graduates/gi,
  ];

  for (const pattern of batchPatterns) {
    const matches = Array.from(text.matchAll(pattern));
    for (const match of matches) {
      // Find the 4 digit year in the match string
      const yearMatch = match[0].match(/(20\d{2})/);
      if (yearMatch) {
        const yearString = yearMatch[1];
        if (yearString) {
          const year = parseInt(yearString, 10);
          candidates.push(year);
        }
      }
    }
  }

  if (candidates.length === 0) return null;
  // Return the most recent year if multiple are found (e.g. "2024 or 2025 batch")
  return Math.max(...candidates);
}

/**
 * Checks if a user's graduation year is compatible with a job's stated batch year.
 * - If the job doesn't state a batch year, it's compatible.
 * - If we don't know the user's graduation year, we can't definitively reject, so it's compatible.
 * - If both are known, they must match.
 */
export function isBatchYearCompatible(
  jobBatchYear: number | null,
  profileGraduationYear: number | null,
): boolean {
  if (jobBatchYear === null) return true;
  if (profileGraduationYear === null) return true;

  return jobBatchYear === profileGraduationYear;
}
