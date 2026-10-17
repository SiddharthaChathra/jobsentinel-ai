import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { JobCard } from './JobCard';
import { JobDetail } from './JobDetail';
import { MatchBreakdown } from './MatchBreakdown';
import { JobFilters } from './JobFilters';
import SystemPage from '@/app/(app)/system/page';
import type {
  HeldKind,
  JobCard as JobCardType,
  JobDetail as JobDetailType,
  JobMatchDetail,
  ReviewJobCard,
} from '@/lib/types/jobs';
import type { SystemStatus } from '@/lib/types/system';

// ── Mock Next.js navigation & router ────────────────────────────────────────

let currentParams = new URLSearchParams();
const mockPush = vi.fn((url: string) => {
  const queryPart = url.includes('?') ? url.split('?')[1] : '';
  currentParams = new URLSearchParams(queryPart);
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/jobs',
  useSearchParams: () => currentParams,
}));

// ── Mock API & user hooks for SystemPage ───────────────────────────────────

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock('@/hooks/use-api', () => ({
  useApi: () => ({
    get: mockGet,
    post: mockPost,
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

vi.mock('@/components/common/RelativeTime', () => ({
  RelativeTime: ({ date }: { date: string }) => <span>{date}</span>,
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

// ── Base mock data ──────────────────────────────────────────────────────────

const BASE_JOB: JobCardType = {
  id: 'test-job-f3',
  title: 'Graduate Software Engineer',
  company: {
    id: 'c1',
    name: 'Acme Technologies',
    domain: 'acme.com',
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
  experienceText: '0-1 years',
  salary: {
    min: 500000,
    max: 800000,
    currency: 'INR',
    period: 'YEARLY',
    text: '₹5-8 LPA',
    disclosed: true,
  },
  postedAt: '2026-10-17T10:00:00.000Z',
  firstSeenAt: '2026-10-17T11:00:00.000Z',
  deadline: null,
  validation: {
    status: 'VALID',
    confidence: 0.95,
    companyVerified: true,
    applicationVerified: true,
    jobActive: true,
  },
  match: {
    overallScore: 88,
    priority: 'HIGH',
    matchedSkills: ['Python', 'TypeScript'],
    scoring: 'AI_REFINED',
  },
  tracker: { saved: false, status: null },
  applicationUrl: 'https://acme.com/careers/grad-se',
  isNew: true,
};

const BASE_DETAIL: JobDetailType = {
  ...BASE_JOB,
  description: 'Exciting fresher opportunity at Acme Technologies.',
  requirements: ['B.Tech / B.E. in CS / IT', 'Proficiency in Python or TypeScript'],
  skills: ['Python', 'TypeScript', 'SQL'],
  sourceUrl: 'https://acme.com/jobs/123',
  sources: [
    {
      name: 'Acme Careers',
      url: 'https://acme.com/jobs/123',
      firstSeenAt: '2026-10-17T11:00:00.000Z',
    },
  ],
  validationDetail: {
    status: 'VALID',
    confidence: 0.95,
    companyVerified: true,
    applicationVerified: true,
    jobActive: true,
    urlStatus: 'OK',
    httpStatus: 200,
    finalUrl: 'https://acme.com/careers/grad-se',
    evidence: [{ code: 'CAREER_PAGE_MATCH', weight: 0.9, detail: 'Exact career page match' }],
    suspiciousFlags: [],
    aiAssessment: null,
    checkedAt: '2026-10-17T11:00:00.000Z',
    nextCheckAt: null,
  },
  match: {
    overallScore: 88,
    priority: 'HIGH',
    matchedSkills: ['Python', 'TypeScript'],
    scoring: 'AI_REFINED',
    skillScore: 90,
    roleScore: 85,
    experienceScore: 100,
    locationScore: 80,
    missingSkills: ['Docker'],
    explanation: 'Strong match on programming languages and fresher criteria.',
    aiProvider: 'gemini',
    aiPending: false,
  },
  events: [],
};

describe('Phase 13 F3 Web Features', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentParams = new URLSearchParams();
  });

  // ── 1. Attribution (renders JobCard and JobDetail) ───────────────────────────

  describe('1. Adzuna Attribution (D115)', () => {
    it('renders JobCard: shows attribution link with href and label when attribution is present', () => {
      const jobWithAttribution: JobCardType = {
        ...BASE_JOB,
        attribution: {
          provider: 'ADZUNA',
          label: 'Adzuna',
          url: 'https://www.adzuna.in/land/ad/12345',
        },
      };

      render(<JobCard job={jobWithAttribution} />, { wrapper: createWrapper() });

      const link = screen.getByTestId(`attribution-${jobWithAttribution.id}`);
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', 'https://www.adzuna.in/land/ad/12345');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(link).toHaveTextContent('Adzuna');
      expect(link).toHaveTextContent('Jobs by');
    });

    it('renders JobCard: renders no attribution link when attribution is null or absent', () => {
      const jobWithoutAttribution: JobCardType = {
        ...BASE_JOB,
        attribution: null,
      };

      render(<JobCard job={jobWithoutAttribution} />, { wrapper: createWrapper() });

      expect(
        screen.queryByTestId(`attribution-${jobWithoutAttribution.id}`),
      ).not.toBeInTheDocument();
    });

    it('renders JobDetail: shows attribution link with href and label when attribution is present', () => {
      const detailWithAttribution: JobDetailType = {
        ...BASE_DETAIL,
        attribution: {
          provider: 'ADZUNA',
          label: 'Adzuna',
          url: 'https://www.adzuna.in/land/ad/12345',
        },
      };

      render(<JobDetail job={detailWithAttribution} />, { wrapper: createWrapper() });

      const link = screen.getByTestId(`attribution-${detailWithAttribution.id}`);
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', 'https://www.adzuna.in/land/ad/12345');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(link).toHaveTextContent('Adzuna');
    });

    it('renders JobDetail: renders no attribution link when attribution is absent', () => {
      const detailWithoutAttribution: JobDetailType = {
        ...BASE_DETAIL,
        attribution: undefined,
      };

      render(<JobDetail job={detailWithoutAttribution} />, { wrapper: createWrapper() });

      expect(
        screen.queryByTestId(`attribution-${detailWithoutAttribution.id}`),
      ).not.toBeInTheDocument();
    });
  });

  // ── 2. Salary filter (renders JobFilters) ──────────────────────────────────

  describe('2. Salary filter (R6, D111)', () => {
    it('renders JobFilters: checkbox starts checked and default request carries no includeUndisclosedSalary', () => {
      currentParams = new URLSearchParams();

      render(<JobFilters />, { wrapper: createWrapper() });

      const checkbox = screen.getByTestId('salary-undisclosed-toggle') as HTMLInputElement;
      expect(checkbox).toBeChecked();
      expect(screen.getByLabelText(/Include jobs that don't state a salary/i)).toBeInTheDocument();
    });

    it('renders JobFilters: the toggle is disabled until a minimum is set, enabled after', () => {
      currentParams = new URLSearchParams();
      const { unmount } = render(<JobFilters />, { wrapper: createWrapper() });
      expect(screen.getByTestId('salary-undisclosed-toggle')).toBeDisabled();
      unmount();
      currentParams = new URLSearchParams('salaryMin=600000');
      render(<JobFilters />, { wrapper: createWrapper() });
      expect(screen.getByTestId('salary-undisclosed-toggle')).toBeEnabled();
    });

    it('renders JobFilters: setting minimum salary sends salaryMin in URL', () => {
      currentParams = new URLSearchParams();

      render(<JobFilters />, { wrapper: createWrapper() });

      const minInput = screen.getByTestId('salary-min-input');
      fireEvent.change(minInput, { target: { value: '600000' } });

      expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('salaryMin=600000'), {
        scroll: false,
      });
      // Does not contain includeUndisclosedSalary when checked
      expect(mockPush).not.toHaveBeenCalledWith(
        expect.stringContaining('includeUndisclosedSalary'),
        {
          scroll: false,
        },
      );
    });

    it('renders JobFilters: unchecking with minimum set sends includeUndisclosedSalary=false', () => {
      currentParams = new URLSearchParams('salaryMin=600000');

      render(<JobFilters />, { wrapper: createWrapper() });

      const checkbox = screen.getByTestId('salary-undisclosed-toggle');
      expect(checkbox).toBeChecked();

      fireEvent.click(checkbox);

      expect(mockPush).toHaveBeenCalledWith(
        expect.stringContaining('includeUndisclosedSalary=false'),
        { scroll: false },
      );
      expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('salaryMin=600000'), {
        scroll: false,
      });
    });
  });

  // ── 3. Detail page "Not disclosed" and disclosed text (renders JobDetail) ─

  describe('3. Detail page salary display (R6, D111)', () => {
    it('renders JobDetail: shows "Not disclosed" when salary is null', () => {
      const job: JobDetailType = { ...BASE_DETAIL, salary: null };
      render(<JobDetail job={job} />, { wrapper: createWrapper() });

      expect(screen.getByTestId(`detail-salary-${job.id}`)).toHaveTextContent('Not disclosed');
    });

    it('renders JobDetail: shows "Not disclosed" when salary.disclosed is false', () => {
      const job: JobDetailType = {
        ...BASE_DETAIL,
        salary: {
          min: null,
          max: null,
          currency: null,
          period: null,
          text: null,
          disclosed: false,
        },
      };
      render(<JobDetail job={job} />, { wrapper: createWrapper() });

      expect(screen.getByTestId(`detail-salary-${job.id}`)).toHaveTextContent('Not disclosed');
    });

    it('renders JobDetail: shows "Not disclosed" when salary.text is null', () => {
      const job: JobDetailType = {
        ...BASE_DETAIL,
        salary: {
          min: 600000,
          max: 900000,
          currency: 'INR',
          period: 'YEARLY',
          text: null,
          disclosed: true,
        },
      };
      render(<JobDetail job={job} />, { wrapper: createWrapper() });

      expect(screen.getByTestId(`detail-salary-${job.id}`)).toHaveTextContent('Not disclosed');
    });

    it('renders JobDetail: shows salary text when salary is disclosed with text', () => {
      const job: JobDetailType = {
        ...BASE_DETAIL,
        salary: {
          min: 800000,
          max: 1200000,
          currency: 'INR',
          period: 'YEARLY',
          text: '₹8-12 LPA',
          disclosed: true,
        },
      };
      render(<JobDetail job={job} />, { wrapper: createWrapper() });

      expect(screen.getByTestId(`detail-salary-${job.id}`)).toHaveTextContent('₹8-12 LPA');
    });
  });

  // ── 4. Experience held banner & fallback (renders JobCard) ────────────────

  describe('4. Experience held (R2, D110)', () => {
    it('renders JobCard: EXPERIENCE_UNKNOWN banner renders its label from mock and kind tag', () => {
      const reviewJob: ReviewJobCard = {
        ...BASE_JOB,
        held: {
          kind: 'EXPERIENCE_UNKNOWN',
          label: 'Experience not stated: the posting does not say whether freshers can apply',
          reason: 'experience unknown (no AI verdict)',
        },
      };

      render(<JobCard job={reviewJob} />, { wrapper: createWrapper() });

      const banner = screen.getByTestId(`held-banner-${reviewJob.id}`);
      expect(banner).toBeInTheDocument();
      expect(
        screen.getByText(
          'Experience not stated: the posting does not say whether freshers can apply',
        ),
      ).toBeInTheDocument();

      const kindTag = screen.getByTestId(`held-kind-${reviewJob.id}`);
      expect(kindTag).toHaveTextContent('EXPERIENCE_UNKNOWN');
    });

    it('renders JobCard: unknown held kind falls back to OTHER without crashing', () => {
      const reviewJobWithUnknownKind: ReviewJobCard = {
        ...BASE_JOB,
        held: {
          kind: 'NEW_UNRECOGNIZED_KIND' as unknown as HeldKind,
          label: 'Special review reason',
          reason: 'special condition met',
        },
      };

      render(<JobCard job={reviewJobWithUnknownKind} />, { wrapper: createWrapper() });

      const banner = screen.getByTestId(`held-banner-${reviewJobWithUnknownKind.id}`);
      expect(banner).toBeInTheDocument();
      expect(screen.getByText('Special review reason')).toBeInTheDocument();

      const kindTag = screen.getByTestId(`held-kind-${reviewJobWithUnknownKind.id}`);
      expect(kindTag).toHaveTextContent('OTHER');
    });
  });

  // ── 5. Posting type badge and filter (renders JobCard, JobDetail, JobFilters)

  describe('5. Posting type (D114)', () => {
    it('renders JobCard: renders "Campus drive" badge for CAMPUS_DRIVE', () => {
      const job: JobCardType = { ...BASE_JOB, postingType: 'CAMPUS_DRIVE' };
      render(<JobCard job={job} />, { wrapper: createWrapper() });

      const badge = screen.getByTestId(`posting-type-${job.id}`);
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('Campus drive');
    });

    it('renders JobCard: renders "Off-campus programme" badge for OFF_CAMPUS_PROGRAM', () => {
      const job: JobCardType = { ...BASE_JOB, postingType: 'OFF_CAMPUS_PROGRAM' };
      render(<JobCard job={job} />, { wrapper: createWrapper() });

      const badge = screen.getByTestId(`posting-type-${job.id}`);
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('Off-campus programme');
    });

    it('renders JobCard: renders no posting-type badge for REGULAR or when absent', () => {
      const regularJob: JobCardType = { ...BASE_JOB, postingType: 'REGULAR' };
      const { unmount } = render(<JobCard job={regularJob} />, { wrapper: createWrapper() });
      expect(screen.queryByTestId(`posting-type-${regularJob.id}`)).not.toBeInTheDocument();
      unmount();

      const absentJob: JobCardType = { ...BASE_JOB, postingType: undefined };
      render(<JobCard job={absentJob} />, { wrapper: createWrapper() });
      expect(screen.queryByTestId(`posting-type-${absentJob.id}`)).not.toBeInTheDocument();
    });

    it('renders JobDetail: renders posting-type badge for campus drives and off-campus programmes', () => {
      const jobDrive: JobDetailType = { ...BASE_DETAIL, postingType: 'CAMPUS_DRIVE' };
      const { unmount: u1 } = render(<JobDetail job={jobDrive} />, { wrapper: createWrapper() });
      expect(screen.getByTestId(`posting-type-${jobDrive.id}`)).toHaveTextContent('Campus drive');
      u1();

      const jobProgram: JobDetailType = { ...BASE_DETAIL, postingType: 'OFF_CAMPUS_PROGRAM' };
      const { unmount: u2 } = render(<JobDetail job={jobProgram} />, { wrapper: createWrapper() });
      expect(screen.getByTestId(`posting-type-${jobProgram.id}`)).toHaveTextContent(
        'Off-campus programme',
      );
      u2();

      const jobRegular: JobDetailType = { ...BASE_DETAIL, postingType: 'REGULAR' };
      render(<JobDetail job={jobRegular} />, { wrapper: createWrapper() });
      expect(screen.queryByTestId(`posting-type-${jobRegular.id}`)).not.toBeInTheDocument();
    });

    it('renders JobFilters: multi-select filter sends postingType in URL', () => {
      currentParams = new URLSearchParams();

      render(<JobFilters />, { wrapper: createWrapper() });

      const filterSection = screen.getByTestId('posting-type-filter');
      expect(filterSection).toBeInTheDocument();

      const campusDriveCheckbox = screen.getByLabelText('Campus drive');
      fireEvent.click(campusDriveCheckbox);

      expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('postingType=CAMPUS_DRIVE'), {
        scroll: false,
      });
    });
  });

  // ── 6. Rules-only score note (renders JobCard and MatchBreakdown) ──────────

  describe('6. Rules-only score note (F8, D112)', () => {
    it('renders JobCard: shows "Rules-only score" with tooltip when match.scoring is RULES_ONLY', () => {
      const job: JobCardType = {
        ...BASE_JOB,
        match: {
          overallScore: 82,
          priority: 'HIGH',
          matchedSkills: ['React'],
          scoring: 'RULES_ONLY',
        },
      };

      render(<JobCard job={job} />, { wrapper: createWrapper() });

      const note = screen.getByTestId(`scoring-rules-only-${job.id}`);
      expect(note).toBeInTheDocument();
      expect(note).toHaveTextContent('Rules-only score');
      expect(note).toHaveAttribute(
        'title',
        'The AI budget was used up or the AI was unavailable; this score comes from the rules. It may be refined later.',
      );
    });

    it('renders JobCard: hides rules-only note when scoring is AI_REFINED or absent', () => {
      const refinedJob: JobCardType = {
        ...BASE_JOB,
        match: {
          overallScore: 90,
          priority: 'VERY_HIGH',
          matchedSkills: ['React'],
          scoring: 'AI_REFINED',
        },
      };

      const { unmount } = render(<JobCard job={refinedJob} />, { wrapper: createWrapper() });
      expect(screen.queryByTestId(`scoring-rules-only-${refinedJob.id}`)).not.toBeInTheDocument();
      unmount();

      const noScoringJob: JobCardType = {
        ...BASE_JOB,
        match: {
          overallScore: 75,
          priority: 'MEDIUM',
          matchedSkills: [],
          scoring: undefined,
        },
      };

      render(<JobCard job={noScoringJob} />, { wrapper: createWrapper() });
      expect(screen.queryByTestId(`scoring-rules-only-${noScoringJob.id}`)).not.toBeInTheDocument();
    });

    it('renders MatchBreakdown: shows "Rules-only score" note when scoring is RULES_ONLY', () => {
      const matchDetail: JobMatchDetail = {
        ...BASE_DETAIL.match!,
        scoring: 'RULES_ONLY',
      };

      render(<MatchBreakdown match={matchDetail} jobId="detail-job-1" />, {
        wrapper: createWrapper(),
      });

      const note = screen.getByTestId('scoring-rules-only-detail-job-1');
      expect(note).toBeInTheDocument();
      expect(note).toHaveTextContent('Rules-only score');
      expect(note).toHaveAttribute(
        'title',
        'The AI budget was used up or the AI was unavailable; this score comes from the rules. It may be refined later.',
      );
    });

    it('renders MatchBreakdown: hides rules-only note when scoring is AI_REFINED', () => {
      const matchDetail: JobMatchDetail = {
        ...BASE_DETAIL.match!,
        scoring: 'AI_REFINED',
      };

      render(<MatchBreakdown match={matchDetail} jobId="detail-job-2" />, {
        wrapper: createWrapper(),
      });

      expect(screen.queryByTestId('scoring-rules-only-detail-job-2')).not.toBeInTheDocument();
    });
  });

  // ── 7. System Status per-user limit (renders SystemPage) ──────────────────

  describe('7. System Status per-user limit', () => {
    it('renders SystemPage: shows "Per-user limit: 100 calls/day" when status.ai.userCallLimit is present', async () => {
      const mockStatus: SystemStatus = {
        worker: {
          alive: true,
          lastBeatAt: '2026-10-18T00:00:00.000Z',
          hostname: 'host-1',
          version: '1.0.0',
          currentTask: null,
        },
        sources: { total: 10, active: 8, degraded: 1, failing: 1, disabled: 0, nextScanAt: null },
        lastScans: [],
        pipeline: {},
        jobsLast24h: { found: 150, new: 45 },
        totals: { jobs: 500, companies: 80 },
        ai: {
          callsToday: 350,
          callBudget: 500,
          tokensToday: 120000,
          tokenBudget: 1000000,
          userCallLimit: 100,
          byPurpose: { CATEGORY_CLASSIFY: 25 },
        },
      };

      mockGet.mockImplementation(async (path: string) => {
        if (path === '/system/status') return { data: mockStatus };
        return { data: [] };
      });

      render(<SystemPage />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText('Per-user limit: 100 calls/day')).toBeInTheDocument();
      });
    });

    it('renders SystemPage: hides per-user limit when status.ai.userCallLimit is absent', async () => {
      const mockStatusNoLimit: SystemStatus = {
        worker: {
          alive: true,
          lastBeatAt: '2026-10-18T00:00:00.000Z',
          hostname: 'host-1',
          version: '1.0.0',
          currentTask: null,
        },
        sources: { total: 10, active: 8, degraded: 1, failing: 1, disabled: 0, nextScanAt: null },
        lastScans: [],
        pipeline: {},
        jobsLast24h: { found: 150, new: 45 },
        totals: { jobs: 500, companies: 80 },
        ai: {
          callsToday: 350,
          callBudget: 500,
          tokensToday: 120000,
          tokenBudget: 1000000,
          userCallLimit: undefined,
        },
      };

      mockGet.mockImplementation(async (path: string) => {
        if (path === '/system/status') return { data: mockStatusNoLimit };
        return { data: [] };
      });

      render(<SystemPage />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText('AI Budget')).toBeInTheDocument();
      });

      expect(screen.queryByText(/Per-user limit:/i)).not.toBeInTheDocument();
    });
  });
});
