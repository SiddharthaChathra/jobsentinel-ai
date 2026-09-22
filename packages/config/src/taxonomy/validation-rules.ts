/**
 * Validation rule data (docs 08). Kept as data, not code, so patterns can be tuned and tested
 * without touching the engine. Every entry carries the weight it contributes to the confidence
 * score; positive weights are evidence of legitimacy, negative of risk.
 */

/** Hosts that legitimately serve application pages on behalf of a company. */
export const KNOWN_ATS_DOMAINS: string[] = [
  'greenhouse.io',
  'boards.greenhouse.io',
  'job-boards.greenhouse.io',
  'lever.co',
  'jobs.lever.co',
  'ashbyhq.com',
  'jobs.ashbyhq.com',
  'myworkdayjobs.com',
  'myworkdaysite.com',
  'smartrecruiters.com',
  'workable.com',
  'recruitee.com',
  'teamtailor.com',
  'personio.de',
  'personio.com',
  'bamboohr.com',
  'jazzhr.com',
  'breezy.hr',
  'workatastartup.com',
  'taleo.net',
  'icims.com',
  'successfactors.com',
  'successfactors.eu',
  'oraclecloud.com',
  'peoplestrong.com',
  'darwinbox.in',
  'darwinbox.com',
  'keka.com',
  'zohorecruit.com',
  'zohorecruit.in',
  'freshteam.com',
  'hirist.tech',
  'eightfold.ai',
  'phenompeople.com',
  'avature.net',
  'jobvite.com',
  'applytojob.com',
  'paylocity.com',
  'dayforcehcm.com',
  'wd1.myworkdayjobs.com',
];

/** URL shorteners: legitimate employers rarely hide an application link behind one. */
export const URL_SHORTENERS: string[] = [
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'buff.ly',
  'rb.gy',
  'cutt.ly',
  'shorturl.at',
  'rebrand.ly',
  'bit.do',
  'tiny.cc',
  'lnkd.in',
];

/** Free mail providers — a contact address here is weak evidence when the company has a domain. */
export const FREEMAIL_DOMAINS: string[] = [
  'gmail.com',
  'yahoo.com',
  'yahoo.co.in',
  'outlook.com',
  'hotmail.com',
  'rediffmail.com',
  'protonmail.com',
  'proton.me',
  'aol.com',
  'zoho.com',
  'mail.com',
  'gmx.com',
  'yandex.com',
  'icloud.com',
];

export interface SuspiciousPattern {
  code: string;
  label: string;
  pattern: RegExp;
  /** Negative contribution to the confidence score (docs 08 §3.5). */
  weight: number;
  /** A hard flag alone is enough to mark a job SUSPICIOUS. */
  hard?: boolean;
  /** Skip the match when the surrounding sentence negates it ("we never charge a fee"). */
  honorNegation?: boolean;
}

/**
 * Scam indicators. Ordered roughly by severity. Each has unit tests for both a true positive
 * and a known false positive (e.g. "no fee is charged by us" must NOT fire FEE_REQUEST).
 */
export const SUSPICIOUS_PATTERNS: SuspiciousPattern[] = [
  {
    code: 'FEE_REQUEST',
    label: 'Asks the candidate for money',
    // "registration fee", "pay ₹500 to apply", "security deposit" — but not "no fee", "we never charge"
    pattern:
      /(?<!no |never |zero |without |not )\b(registration|processing|training|placement|security|joining|refundable)\s+(fee|charge|amount|deposit)\b|\bpay\s+(rs\.?|₹|inr)?\s*\d[\d,]*\s*(\/-)?\s*(to|for|before)\s+(apply|application|join|register|interview)/i,
    weight: -0.6,
    hard: true,
    honorNegation: true,
  },
  {
    code: 'PAYMENT_APP_MENTION',
    label: 'UPI / wallet payment details in a job ad',
    pattern:
      /\b([\w.-]+@(ok(axis|hdfcbank|icici|sbi)|paytm|ybl|upi|apl|ibl))\b|\b(paytm|phonepe|google\s?pay|gpay)\s+(number|id|this|to)\b/i,
    weight: -0.5,
    hard: true,
  },
  {
    code: 'NO_INTERVIEW',
    label: 'Promises a job without an interview',
    pattern:
      /\b(no|without)\s+(interview|test|screening)\s*(required|needed)?\b|\bdirect\s+(joining|selection|offer)\b|\bspot\s+offer\s+guaranteed\b/i,
    weight: -0.35,
  },
  {
    code: 'SENSITIVE_INFO_REQUEST',
    label: 'Asks for identity or bank details up front',
    pattern:
      /\b(aadhaar|aadhar|pan\s?card|passport|bank\s+(account|details|passbook)|cancelled\s+cheque|atm\s+(card|pin)|cvv|otp)\b[^.]{0,80}\b(share|send|submit|provide|upload|whatsapp|email)\b|\b(share|send|submit)\b[^.]{0,60}\b(aadhaar|aadhar|pan\s?card|bank\s+(account|details))\b/i,
    weight: -0.4,
    honorNegation: true,
  },
  {
    code: 'WORK_FROM_HOME_SCAM',
    label: 'Classic work-from-home scam wording',
    pattern:
      /\b(earn\s+(daily|weekly|upto|up to)\s*(rs\.?|₹)?\s*\d|copy\s*[-–]?\s*paste\s+(job|work)|data\s+entry\s+(job|work)\s+from\s+home|typing\s+job|part\s*time\s+income|work\s+from\s+mobile)\b/i,
    weight: -0.45,
  },
  {
    code: 'MESSAGING_APP_CONTACT',
    label: 'Directs applicants to WhatsApp/Telegram',
    pattern:
      /\b(whats\s?app|telegram)\b[^.]{0,40}(\+?\d[\d\s-]{7,}|\bnow\b|\bus\b|\bme\b)|\bcontact\s+(on|via|through)\s+(whats\s?app|telegram)\b/i,
    weight: -0.3,
  },
  {
    code: 'URGENCY_PRESSURE',
    label: 'Artificial urgency',
    pattern:
      /\b(limited\s+(seats|vacancies|positions)|hurry\s+up|apply\s+(fast|now)\s+before|only\s+\d+\s+(seats|positions)\s+left|immediate\s+joining\s+required\s+today)\b/i,
    weight: -0.15,
  },
  {
    code: 'GENERIC_COMPANY',
    label: 'Employer is not named',
    pattern:
      /\b(leading|reputed|well[\s-]known|top)\s+(mnc|company|organisation|organization|firm|client)\b|\bconfidential\s+(company|client)\b|\bcompany\s+name\s+will\s+be\s+disclosed\b/i,
    weight: -0.2,
  },
  {
    code: 'UNREALISTIC_PROMISE',
    label: 'Unrealistic guarantees',
    pattern:
      /\b(guaranteed|assured)\s+(placement|job|salary|income)\b|\b100%\s+(placement|job)\s+guarantee\b/i,
    weight: -0.3,
  },
];

/**
 * Sentence-level negation: employers routinely warn "we never charge a fee", which must not be
 * read as a fee demand. Applied to the text preceding a match within the same sentence.
 */
export const NEGATION_CONTEXT =
  /\b(never|not|no|without|don.?t|doesn.?t|won.?t|neither|nor|beware|scam|fraud|fake|caution|warning|avoid|free of)\b/i;

/** Phrases meaning the posting is closed (docs 08 §3.4), incl. ATS-specific wording. */
export const CLOSED_PAGE_MARKERS: { code: string; pattern: RegExp }[] = [
  { code: 'NO_LONGER_ACCEPTING', pattern: /no longer accepting applications/i },
  {
    code: 'NO_LONGER_AVAILABLE',
    pattern:
      /(this )?(job|position|role|posting|opportunity)\s+(is\s+)?no longer (available|open|active|accepting)/i,
  },
  { code: 'POSITION_FILLED', pattern: /(position|role|job)\s+(has been|is)\s+(filled|closed)/i },
  {
    code: 'POSTING_EXPIRED',
    pattern: /(this )?(posting|job|listing|application)\s+(has )?expired/i,
  },
  {
    code: 'GREENHOUSE_CLOSED',
    pattern: /the job you are looking for is no longer open|job is no longer available/i,
  },
  { code: 'LEVER_CLOSED', pattern: /this job (posting )?is no longer accepting applications/i },
  { code: 'WORKDAY_CLOSED', pattern: /job is not available|requisition (is )?(closed|cancelled)/i },
  { code: 'NOT_FOUND_TEXT', pattern: /\b(404|page not found|we can'?t find the page)\b/i },
  { code: 'APPLICATIONS_CLOSED', pattern: /applications? (are )?closed/i },
];

/** Signals that an application form/flow exists on the page. */
export const APPLY_FORM_MARKERS: RegExp[] = [
  /<form[^>]*>[\s\S]{0,4000}?(type=["']file["']|apply|resume|cv)/i,
  /\b(apply (now|for this job|to this job)|submit (your )?application|start (your )?application)\b/i,
  /id=["'](application|apply)[-_]?(form|button)?["']/i,
  /data-(mapped|qa)=["']apply/i,
];

/** Per-category sanity bands for a fresher salary, used by UNREALISTIC_SALARY (INR per year). */
export const FRESHER_SALARY_CEILING_INR = 4_000_000;
