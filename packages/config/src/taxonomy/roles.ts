import type { JobCategory } from '@jobsentinel/types';

/**
 * Role families: canonical keys for grouping job titles and preferred roles.
 * `patterns` are matched against a normalized title (lowercase, punctuation stripped) —
 * first family whose pattern matches wins, so more specific families come first.
 * Extended in Phase 5 with the full engineering taxonomy.
 */
export interface RoleFamily {
  key: string;
  label: string;
  category: JobCategory;
  patterns: RegExp[];
}

export const ROLE_FAMILIES: RoleFamily[] = [
  {
    key: 'technical_support_engineer',
    label: 'Technical Support Engineer',
    category: 'IT_SUPPORT',
    patterns: [
      /\b(technical|tech|it|application|product|customer) support\b/,
      /\bsupport engineer\b/,
      /\bservice desk\b/,
      /\bhelp ?desk\b/,
    ],
  },
  {
    key: 'network_engineer',
    label: 'Network Engineer',
    category: 'NETWORK',
    patterns: [/\bnetwork(ing)?\b/, /\bnoc\b/],
  },
  {
    key: 'security_engineer',
    label: 'Security Engineer',
    category: 'NETWORK',
    patterns: [/\b(cyber ?)?security\b/, /\bsoc analyst\b/],
  },
  {
    key: 'cloud_engineer',
    label: 'Cloud Engineer',
    category: 'CLOUD_DEVOPS',
    patterns: [/\bcloud\b/, /\baws\b/, /\bazure\b/, /\bgcp\b/],
  },
  {
    key: 'devops_engineer',
    label: 'DevOps / SRE',
    category: 'CLOUD_DEVOPS',
    patterns: [/\bdev ?ops\b/, /\bsre\b/, /\bsite reliability\b/, /\bplatform engineer\b/],
  },
  {
    key: 'data_engineer',
    label: 'Data Engineer',
    category: 'DATA',
    patterns: [/\bdata engineer/, /\betl\b/, /\bdata platform\b/],
  },
  {
    key: 'data_analyst',
    label: 'Data Analyst',
    category: 'DATA',
    patterns: [/\bdata analy/, /\bbusiness analy/, /\bbi (analyst|developer)\b/, /\banalytics\b/],
  },
  {
    key: 'data_scientist',
    label: 'Data Scientist / ML',
    category: 'DATA',
    patterns: [
      /\bdata scien/,
      /\bmachine learning\b/,
      /\bml engineer\b/,
      /\bai engineer\b/,
      /\bartificial intelligence\b/,
    ],
  },
  {
    key: 'qa_engineer',
    label: 'QA / Test Engineer',
    category: 'SOFTWARE',
    patterns: [
      /\bqa\b/,
      /\btest(ing)? engineer\b/,
      /\bquality (assurance|engineer)\b/,
      /\bsdet\b/,
      /\bautomation (test|engineer)/,
    ],
  },
  {
    key: 'frontend_engineer',
    label: 'Frontend Engineer',
    category: 'SOFTWARE',
    patterns: [/\bfront ?end\b/, /\bui developer\b/, /\breact\b/, /\bangular\b/],
  },
  {
    key: 'backend_engineer',
    label: 'Backend Engineer',
    category: 'SOFTWARE',
    patterns: [/\bback ?end\b/, /\bjava developer\b/, /\bnode\b/, /\bapi developer\b/],
  },
  {
    key: 'fullstack_engineer',
    label: 'Full-stack Engineer',
    category: 'SOFTWARE',
    patterns: [/\bfull ?stack\b/, /\bweb developer\b/, /\bmern\b/],
  },
  {
    key: 'mobile_engineer',
    label: 'Mobile Engineer',
    category: 'SOFTWARE',
    patterns: [
      /\bandroid\b/,
      /\bios\b/,
      /\bmobile (app )?developer\b/,
      /\bflutter\b/,
      /\breact native\b/,
    ],
  },
  {
    key: 'embedded_engineer',
    label: 'Embedded / Firmware',
    category: 'ELECTRICAL_ELECTRONICS',
    patterns: [/\bembedded\b/, /\bfirmware\b/, /\bvlsi\b/, /\bfpga\b/],
  },
  {
    key: 'software_engineer',
    label: 'Software Engineer / SDE',
    category: 'SOFTWARE',
    patterns: [
      /\bsoftware (development )?engineer\b/,
      /\bsoftware developer\b/,
      /\bsde\b/,
      /\bprogrammer\b/,
      /\bdeveloper\b/,
      /\bmember of technical staff\b/,
      /\bgraduate engineer\b/,
      /\bengineer trainee\b/,
    ],
  },
  {
    key: 'system_engineer',
    label: 'System / IT Engineer',
    category: 'IT_SUPPORT',
    patterns: [
      /\bsystem(s)? (engineer|administrator|admin)\b/,
      /\bit engineer\b/,
      /\blinux (engineer|admin)/,
      /\bdesktop support\b/,
    ],
  },
  {
    key: 'electrical_engineer',
    label: 'Electrical / Electronics',
    category: 'ELECTRICAL_ELECTRONICS',
    patterns: [/\belectrical\b/, /\belectronics?\b/, /\bpower systems?\b/],
  },
  {
    key: 'mechanical_engineer',
    label: 'Mechanical Engineer',
    category: 'MECHANICAL',
    patterns: [/\bmechanical\b/, /\bdesign engineer\b/, /\bcad\b/, /\bproduction engineer\b/],
  },
  {
    key: 'civil_engineer',
    label: 'Civil Engineer',
    category: 'CIVIL',
    patterns: [/\bcivil\b/, /\bstructural\b/, /\bsite engineer\b/],
  },
];

export const UNKNOWN_ROLE_FAMILY = 'unknown';
