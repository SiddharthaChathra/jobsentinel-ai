import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { JobCard } from './JobCard';
import { JobDetail } from './JobDetail';
import type { JobCard as JobCardType, JobDetail as JobDetailType } from '@/lib/types/jobs';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/jobs',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/hooks/use-api', () => ({
  useApi: () => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  }),
}));

vi.mock('@/hooks/useUser', () => ({
  useMe: () => ({
    data: { user: { isAdmin: false } },
    isLoading: false,
  }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const BASE_JOB: JobCardType = {
  id: 'test-job-f4',
  title: 'Junior Backend Developer',
  company: {
    id: 'c4',
    name: 'FresherCorp',
    domain: 'freshercorp.com',
    verificationStatus: 'VERIFIED',
  },
  location: {
    text: 'Bengaluru, India',
    city: 'Bengaluru',
    country: 'India',
    isRemote: false,
  },
  employmentType: 'FULL_TIME',
  experienceLevel: 'FRESHER',
  fresherEligible: true,
  experienceText: '0 years',
  salary: {
    min: 600000,
    max: 900000,
    currency: 'INR',
    period: 'YEARLY',
    text: '₹6-9 LPA',
    disclosed: true,
  },
  postedAt: '2026-10-18T10:00:00.000Z',
  firstSeenAt: '2026-10-18T10:00:00.000Z',
  deadline: null,
  validation: {
    status: 'VALID',
    confidence: 0.95,
    companyVerified: true,
    applicationVerified: true,
    jobActive: true,
  },
  match: {
    overallScore: 92,
    priority: 'HIGH',
    matchedSkills: ['Node.js', 'PostgreSQL'],
    scoring: 'AI_REFINED',
  },
  tracker: { saved: false, status: null },
  applicationUrl: 'https://freshercorp.com/careers/junior-dev',
  isNew: true,
};

const BASE_DETAIL: JobDetailType = {
  ...BASE_JOB,
  description: 'Great opportunity for entry-level backend engineers.',
  requirements: ['B.Tech in CS or related field', 'Knowledge of SQL'],
  skills: ['Node.js', 'PostgreSQL'],
  sourceUrl: 'https://freshercorp.com/jobs/junior-dev',
  sources: [],
  validationDetail: {
    status: 'VALID',
    confidence: 0.95,
    companyVerified: true,
    applicationVerified: true,
    jobActive: true,
    urlStatus: 'OK',
    httpStatus: 200,
    finalUrl: 'https://freshercorp.com/careers/junior-dev',
    evidence: [],
    suspiciousFlags: [],
    aiAssessment: null,
    checkedAt: '2026-10-18T10:00:00.000Z',
    nextCheckAt: null,
  },
  match: {
    overallScore: 92,
    priority: 'HIGH',
    matchedSkills: ['Node.js', 'PostgreSQL'],
    scoring: 'AI_REFINED',
    skillScore: 90,
    roleScore: 95,
    experienceScore: 100,
    locationScore: 85,
    missingSkills: [],
    explanation: 'Matches fresher requirements perfectly.',
    aiProvider: 'gemini',
    aiPending: false,
  },
  events: [],
};

const TOOLTIP_TEXT =
  'This company often posts roles open to freshers. Shown for information only; it never hides or ranks jobs.';

describe('Phase 13 F4 "Hires freshers often" Badge (D118)', () => {
  describe('JobCard component', () => {
    it('renders JobCard: shows "Hires freshers often" badge with tooltip when hiresFreshersOften is true', () => {
      const job: JobCardType = {
        ...BASE_JOB,
        company: {
          ...BASE_JOB.company,
          hiresFreshersOften: true,
        },
      };

      render(<JobCard job={job} />, { wrapper: createWrapper() });

      const badge = screen.getByTestId(`fresher-badge-${job.id}`);
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('Hires freshers often');
      expect(badge).toHaveAttribute('title', TOOLTIP_TEXT);
    });

    it('renders JobCard: hides badge when hiresFreshersOften is false', () => {
      const job: JobCardType = {
        ...BASE_JOB,
        company: {
          ...BASE_JOB.company,
          hiresFreshersOften: false,
        },
      };

      render(<JobCard job={job} />, { wrapper: createWrapper() });

      expect(screen.queryByTestId(`fresher-badge-${job.id}`)).not.toBeInTheDocument();
    });

    it('renders JobCard: hides badge when hiresFreshersOften is absent (undefined)', () => {
      const job: JobCardType = {
        ...BASE_JOB,
        company: {
          ...BASE_JOB.company,
          hiresFreshersOften: undefined,
        },
      };

      render(<JobCard job={job} />, { wrapper: createWrapper() });

      expect(screen.queryByTestId(`fresher-badge-${job.id}`)).not.toBeInTheDocument();
    });
  });

  describe('JobDetail component', () => {
    it('renders JobDetail: shows "Hires freshers often" badge with tooltip when hiresFreshersOften is true', () => {
      const detail: JobDetailType = {
        ...BASE_DETAIL,
        company: {
          ...BASE_DETAIL.company,
          hiresFreshersOften: true,
        },
      };

      render(<JobDetail job={detail} />, { wrapper: createWrapper() });

      const badge = screen.getByTestId(`fresher-badge-${detail.id}`);
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('Hires freshers often');
      expect(badge).toHaveAttribute('title', TOOLTIP_TEXT);
    });

    it('renders JobDetail: hides badge when hiresFreshersOften is false', () => {
      const detail: JobDetailType = {
        ...BASE_DETAIL,
        company: {
          ...BASE_DETAIL.company,
          hiresFreshersOften: false,
        },
      };

      render(<JobDetail job={detail} />, { wrapper: createWrapper() });

      expect(screen.queryByTestId(`fresher-badge-${detail.id}`)).not.toBeInTheDocument();
    });

    it('renders JobDetail: hides badge when hiresFreshersOften is absent (undefined)', () => {
      const detail: JobDetailType = {
        ...BASE_DETAIL,
        company: {
          ...BASE_DETAIL.company,
          hiresFreshersOften: undefined,
        },
      };

      render(<JobDetail job={detail} />, { wrapper: createWrapper() });

      expect(screen.queryByTestId(`fresher-badge-${detail.id}`)).not.toBeInTheDocument();
    });
  });
});
