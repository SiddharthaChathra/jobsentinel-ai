/**
 * Fresher / experience indicators (docs 09 §4). Calibrated against 2,651 real postings ingested
 * in Phase 4: titles carry seniority far more reliably than descriptions, and "5+ years" style
 * requirement lines are the single strongest negative signal.
 */

/** Title tokens that make a job clearly NOT for a fresher, whatever the body says. */
export const SENIOR_TITLE_PATTERNS: RegExp[] = [
  /\b(senior|sr\.?|staff|principal|lead|leader|head|chief|director|vp|vice president|architect)\b/i,
  /\b(manager|management)\b/i, // "Engineering Manager", "Account Manager" — not "Trainee Manager"
  /\bmts\s*(ii|iii|iv|[2-9])\b/i,
  /\b(ii|iii|iv|v)\b/i, // Roman numerals II+ (plain "I" is entry level)
  /\b(sde|swe|se)\s*-?\s*(iii|iv|[3-9])\b/i,
  // Level suffixes: "Software Engineer 3", "Engineer II", "(L2)", "SDE-2" all mean "not a first job".
  /\b(engineer|developer|analyst|specialist|consultant|scientist|designer|administrator)\s*-?\s*([2-9])\b/i,
  /\bl\s*-?\s*[2-9]\b/i,
  /\b(sde|swe|se)\s*-?\s*2\b/i,
  /\b(expert|specialist iv|distinguished|fellow)\b/i,
];

/** Title tokens that positively indicate a fresher/entry-level opening. */
export const FRESHER_TITLE_PATTERNS: RegExp[] = [
  /\b(fresher|freshers)\b/i,
  /\b(fresh|recent|new)\s+(graduate|grad)\b/i,
  /\b(new\s?grad|newgrad)\b/i,
  /\b(graduate|grad)\s+(engineer|trainee|programme?|program|analyst|developer|associate|scheme)\b/i,
  /\bgraduate\s+(software|data|network|cloud|mechanical|electrical|civil)\b/i,
  /\b(entry[\s-]?level|early\s+career|campus\s+hire|campus\s+recruitment)\b/i,
  /\b(trainee|apprentice|apprenticeship)\b/i,
  /\bintern(ship)?\b/i,
  /\b(junior|jr\.?)\b/i,
  /\b(associate\s+(software|data|network|cloud|qa|test|systems?|support)\s*(engineer|developer|analyst)?)\b/i,
  /\b(get|net)\b(?=\s*[-–(]|\s*$)/i, // Graduate/Network Engineer Trainee abbreviations
  /\b(sde|swe|se|l)\s*-?\s*(i|1)\b/i,
  /\b(engineer|developer|analyst|associate)\s*-?\s*(I|1)\b/, // level I/1 = entry (case-sensitive so the pronoun "I" never matches)
  /\b(20\d{2})\s*(batch|grads?|graduates?|passouts?)\b/i,
];

/** Body phrases that positively indicate fresher eligibility. */
export const FRESHER_BODY_PATTERNS: RegExp[] = [
  /\bfreshers?\s+(are\s+)?(welcome|can apply|may apply|eligible|encouraged)\b/i,
  /\bno\s+(prior\s+)?(work\s+)?experience\s+(is\s+)?(required|needed|necessary|expected)\b/i,
  /\b0\s*[-–to]+\s*[12]\s*(years?|yrs?)\b/i,
  /\b(0|zero)\s+(years?|yrs?)\s+(of\s+)?experience\b/i,
  /\b(final[\s-]year|pre[\s-]final[\s-]year)\s+(students?|candidates?)\b/i,
  /\b(recent|new)\s+(graduates?|grads?)\s+(are\s+)?(welcome|encouraged|eligible)\b/i,
  /\bgraduating\s+in\s+20\d{2}\b/i,
  /\b(20\d{2})\s*(batch|pass\s?outs?)\b/i,
  /\bcampus\s+(hiring|placement|recruitment)\b/i,
  /\bstudents?\s+(currently\s+)?(enrolled|pursuing)\b/i,
  /\bentry[\s-]?level\b/i,
  /\b(suitable|ideal|perfect)\s+for\s+(freshers?|graduates?|beginners?)\b/i,
];

/** Body phrases that indicate significant required experience. */
export const EXPERIENCED_BODY_PATTERNS: RegExp[] = [
  /\b([3-9]|1\d)\s*\+?\s*(years?|yrs?)\b[^.]{0,40}\b(experience|exp)\b/i,
  /\b(minimum|min\.?|at least|atleast)\s+([3-9]|1\d)\s*(years?|yrs?)/i,
  /\bproven\s+track\s+record\b/i,
  /\b(people|team)\s+management\s+experience\b/i,
  /\bexperience\s+(leading|managing|mentoring)\s+(teams?|engineers?)\b/i,
];

/**
 * Role families that are not engineering jobs at all. Matched against the normalized title;
 * these dominate large ATS boards (sales, marketing, HR, finance, legal, support-sales).
 */
export const NON_ENGINEERING_PATTERNS: RegExp[] = [
  /\b(account executive|account manager|sales|seller|business development|bdr|sdr|revenue|quota)\b/i,
  /\b(customer success|renewals|partner manager|partner specialist|channels?|alliances?|ecosystem|reseller|distributor)\b/i,
  /\b(marketing|brand|content writer|copywriter|seo|social media|growth marketer|demand generation|communications|pr manager)\b/i,
  /\b(recruit(er|ers|ing|ment)?|sourcer|talent acquisition|emerging talent|human resources|hr|people operations|people partner|compensation|payroll|benefits)\b/i,
  /\b(finance|accountant|accounting|controller|treasury|audit|tax|fp&a|bookkeep)\b/i,
  /\b(legal|counsel|paralegal|compliance officer|privacy counsel)\b/i,
  /\b(product manager|product management|product owner|product marketing)\b/i,
  /\b(designer|design lead|ux researcher|ui designer|graphic|illustrator|video editor|photographer)\b/i,
  /\b(office manager|executive assistant|administrative|receptionist|facilities)\b/i,
  /\b(teacher|trainer|instructor|curriculum|counsellor|counselor)\b/i,
  /\b(nurse|physician|medical coder|clinical|pharmac)\b/i,
  /\b(driver|delivery|warehouse|logistics coordinator|store manager|cashier|chef|barista)\b/i,
  /\b(strategy|operations manager|program manager|project manager|chief of staff|business analyst manager)\b/i,
  /\b(procurement|sourcing|supply chain planner|vendor manager|category manager)\b/i,
];

/** Engineering-ish words that override a non-engineering match (e.g. "Sales Engineer" is technical). */
export const ENGINEERING_OVERRIDE_PATTERNS: RegExp[] = [
  /\b(software|data|network|cloud|devops|platform|systems?|security|qa|test|automation|firmware|embedded|hardware|mechanical|electrical|electronics|civil|structural|chemical|aerospace|robotics)\s+engineer\b/i,
  /\b(developer|programmer|sde|full[\s-]?stack|back[\s-]?end|front[\s-]?end)\b/i,
  /\b(solutions?|sales|support|field|customer|technical|implementation|forward deployed)\s+engineer\b/i,
  /\b(data (scientist|analyst)|machine learning|analytics engineer)\b/i,
  /\btechnical (account manager|consultant|specialist|analyst)\b/i,
  /\b(site reliability|sre)\b/i,
];
