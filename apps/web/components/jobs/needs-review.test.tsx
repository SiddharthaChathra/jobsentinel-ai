import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { JobCard } from './JobCard';
import { NeedsReviewList } from './NeedsReviewList';
import JobsPage from '@/app/(app)/jobs/page';
import SystemPage from '@/app/(app)/system/page';
import type { ReviewJobCard, JobCard as JobCardType } from '@/lib/types/jobs';

// ── Sample data matching docs/contracts/needs-review.mock.json ──────────────

const MOCK_REVIEW_JOBS: ReviewJobCard[] = [
  {
    id: '1b31481b-98cc-442f-b80a-953ad99fd0bc',
    title: 'Graduate Engineer Trainee',
    company: {
      id: '6dbb492d-e34b-4eba-bd32-61cbb2b388d1',
      name: 'Example Industries',
      domain: null,
      verificationStatus: 'UNVERIFIED',
    },
    location: {
      text: null,
      city: 'Pune',
      country: 'India',
      isRemote: false,
    },
    employmentType: 'UNKNOWN',
    experienceLevel: 'FRESHER',
    fresherEligible: true,
    experienceText: null,
    salary: {
      min: null,
      max: null,
      currency: null,
      period: null,
      text: null,
      disclosed: false,
    },
    postedAt: null,
    firstSeenAt: '2026-10-15T16:32:26.279Z',
    deadline: null,
    validation: {
      status: 'PENDING',
      confidence: null,
      companyVerified: false,
      applicationVerified: false,
      jobActive: true,
    },
    match: {
      overallScore: 90,
      priority: 'VERY_HIGH',
      matchedSkills: [],
    },
    tracker: {
      saved: false,
      status: null,
    },
    applicationUrl: 'https://jobs.example.com/category-held/apply',
    isNew: false,
    held: {
      kind: 'CATEGORY_UNKNOWN',
      label: 'Category unclear: the posting does not say what kind of work it is',
      reason: 'category unknown',
    },
  },
  {
    id: 'b7e6fc9f-430c-4ae4-9520-74953fc4b71a',
    title: 'Software Engineer',
    company: {
      id: '6dbb492d-e34b-4eba-bd32-61cbb2b388d1',
      name: 'Example Tech Pvt Ltd',
      domain: null,
      verificationStatus: 'UNVERIFIED',
    },
    location: {
      text: null,
      city: 'Pune',
      country: 'India',
      isRemote: false,
    },
    employmentType: 'UNKNOWN',
    experienceLevel: 'FRESHER',
    fresherEligible: true,
    experienceText: null,
    salary: {
      min: null,
      max: null,
      currency: null,
      period: null,
      text: null,
      disclosed: false,
    },
    postedAt: null,
    firstSeenAt: '2026-10-15T16:32:26.290Z',
    deadline: null,
    validation: {
      status: 'NEEDS_REVIEW',
      confidence: null,
      companyVerified: false,
      applicationVerified: false,
      jobActive: true,
    },
    match: {
      overallScore: 90,
      priority: 'VERY_HIGH',
      matchedSkills: [],
    },
    tracker: {
      saved: false,
      status: null,
    },
    applicationUrl: 'https://jobs.example.com/company-held/apply',
    isNew: false,
    held: {
      kind: 'COMPANY_UNVERIFIED',
      label: 'Company not verified: the job board links only to its own page, not the employer',
      reason: 'company could not be verified',
    },
  },
  {
    id: '5f2c8d3b-0a4e-4d9f-86b7-3e8f9a0b1c2d',
    title: 'Junior Network Engineer',
    company: {
      id: '6dbb492d-e34b-4eba-bd32-61cbb2b388d1',
      name: 'Example Tech Pvt Ltd',
      domain: null,
      verificationStatus: 'UNVERIFIED',
    },
    location: {
      text: null,
      city: 'Pune',
      country: 'India',
      isRemote: false,
    },
    employmentType: 'UNKNOWN',
    experienceLevel: 'FRESHER',
    fresherEligible: true,
    experienceText: null,
    salary: {
      min: null,
      max: null,
      currency: null,
      period: null,
      text: null,
      disclosed: false,
    },
    postedAt: null,
    firstSeenAt: '2026-10-15T16:32:26.290Z',
    deadline: null,
    validation: {
      status: 'NEEDS_REVIEW',
      confidence: null,
      companyVerified: false,
      applicationVerified: false,
      jobActive: true,
    },
    match: {
      overallScore: 90,
      priority: 'VERY_HIGH',
      matchedSkills: [],
    },
    tracker: {
      saved: false,
      status: null,
    },
    applicationUrl: 'https://jobs.example.com/url-held/apply',
    isNew: false,
    held: {
      kind: 'URL_UNREACHABLE',
      label: 'Application page could not be reached',
      reason: 'application page could not be reached',
    },
  },
  {
    id: '6a3d9e4c-1b5f-4e0a-97c8-4f9a0b1c2d3e',
    title: 'Trainee Data Analyst',
    company: {
      id: '6dbb492d-e34b-4eba-bd32-61cbb2b388d1',
      name: 'Example Tech Pvt Ltd',
      domain: null,
      verificationStatus: 'UNVERIFIED',
    },
    location: {
      text: null,
      city: 'Pune',
      country: 'India',
      isRemote: false,
    },
    employmentType: 'UNKNOWN',
    experienceLevel: 'FRESHER',
    fresherEligible: true,
    experienceText: null,
    salary: {
      min: null,
      max: null,
      currency: null,
      period: null,
      text: null,
      disclosed: false,
    },
    postedAt: null,
    firstSeenAt: '2026-10-15T16:32:26.290Z',
    deadline: null,
    validation: {
      status: 'NEEDS_REVIEW',
      confidence: null,
      companyVerified: false,
      applicationVerified: false,
      jobActive: true,
    },
    match: {
      overallScore: 90,
      priority: 'VERY_HIGH',
      matchedSkills: [],
    },
    tracker: {
      saved: false,
      status: null,
    },
    applicationUrl: 'https://jobs.example.com/other-held/apply',
    isNew: false,
    held: {
      kind: 'OTHER',
      label: 'Held for review: unusual salary for the role',
      reason: 'unusual salary for the role',
    },
  },
];

const MOCK_VALID_JOB: JobCardType = {
  id: 'valid-job-1',
  title: 'Frontend Developer',
  company: {
    id: 'comp-1',
    name: 'Verified Tech',
    domain: 'verified.com',
    verificationStatus: 'VERIFIED',
  },
  location: { text: 'Bengaluru', city: 'Bengaluru', country: 'India', isRemote: false },
  employmentType: 'FULL_TIME',
  experienceLevel: 'FRESHER',
  fresherEligible: true,
  experienceText: '0-2 years',
  salary: {
    min: 600000,
    max: 900000,
    currency: 'INR',
    period: 'YEARLY',
    text: '₹6-9 LPA',
    disclosed: true,
  },
  postedAt: '2026-10-16T10:00:00.000Z',
  firstSeenAt: '2026-10-16T11:00:00.000Z',
  deadline: null,
  validation: {
    status: 'VALID',
    confidence: 0.95,
    companyVerified: true,
    applicationVerified: true,
    jobActive: true,
  },
  match: { overallScore: 85, priority: 'HIGH', matchedSkills: ['React', 'TypeScript'] },
  tracker: { saved: false, status: null },
  applicationUrl: 'https://verified.com/apply',
  isNew: true,
};

// ── Mock hooks & API ────────────────────────────────────────────────────────

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
    data: { user: { isAdmin: true } },
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useFilterParams', () => ({
  useFilterParams: () => ({
    query: { q: 'engineer' },
    setFilter: vi.fn(),
    resetFilters: vi.fn(),
  }),
}));

vi.mock('@/components/common/RelativeTime', () => ({
  RelativeTime: ({ date }: { date: string }) => <span>{date}</span>,
}));

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('Needs Review View (C step 2, D106)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/jobs') {
        return { data: [MOCK_VALID_JOB], meta: { nextCursor: null } };
      }
      if (path === '/jobs/needs-review') {
        return { data: MOCK_REVIEW_JOBS, meta: { nextCursor: null } };
      }
      if (path === '/sources') {
        return { data: [] };
      }
      if (path === '/system/status') {
        return {
          data: {
            worker: { alive: true },
            ai: {
              callsToday: 100,
              callBudget: 500,
              tokensToday: 10000,
              tokenBudget: 50000,
              byPurpose: {
                CATEGORY_CLASSIFY: 73,
                RESUME_PARSE: 12,
              },
            },
            sources: { active: 1, total: 1 },
            jobsLast24h: { found: 10, new: 5 },
          },
        };
      }
      return { data: [] };
    });
  });

  // ── 1. Each of the 4 held.kind renders banner, icon, and verbatim label ────

  it('renders all 4 held.kind values with their verbatim labels and kind tags', () => {
    for (const job of MOCK_REVIEW_JOBS) {
      const { unmount } = render(<JobCard job={job} held={job.held} />, {
        wrapper: createWrapper(),
      });

      const banner = screen.getByTestId(`held-banner-${job.id}`);
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveTextContent(job.held.label);

      const kindEl = screen.getByTestId(`held-kind-${job.id}`);
      expect(kindEl).toBeInTheDocument();
      expect(kindEl).toHaveTextContent(job.held.kind);

      unmount();
    }
  });

  // ── 2. Tab switching between /jobs and /jobs/needs-review ──────────────────

  it('switches between All Jobs and Needs Review tabs with isolated requests', async () => {
    render(<JobsPage />, { wrapper: createWrapper() });

    // Initially on "All Jobs" tab -> fetches /jobs
    await waitFor(() => {
      expect(screen.getByText('Frontend Developer')).toBeInTheDocument();
      expect(mockGet).toHaveBeenCalledWith('/jobs', expect.objectContaining({ q: 'engineer' }));
    });

    // Default list never shows held jobs
    expect(screen.queryByText('Graduate Engineer Trainee')).not.toBeInTheDocument();

    // Click "Needs Review" tab
    const needsReviewTab = screen.getByTestId('needs-review-tab');
    fireEvent.click(needsReviewTab);

    // Switches view -> calls /jobs/needs-review with the current filters
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(
        '/jobs/needs-review',
        expect.objectContaining({ q: 'engineer' }),
      );
      expect(screen.getByText('Graduate Engineer Trainee')).toBeInTheDocument();
    });

    // Needs review view never shows the default list's valid jobs
    expect(screen.queryByText('Frontend Developer')).not.toBeInTheDocument();
  });

  // ── 3. Header note verbatim text ──────────────────────────────────────────

  it('displays the exact required header note on the Needs Review view', async () => {
    render(<NeedsReviewList query={{}} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(
        screen.getByText(
          "These jobs passed the India, fresher and 60-day checks but couldn't be fully verified. They're never sent to Telegram. Check each one before applying.",
        ),
      ).toBeInTheDocument();
    });
  });

  // ── 4. Apply action caution step ──────────────────────────────────────────

  it('shows caution step on apply and opens URL only upon confirmation', async () => {
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const reviewJob = MOCK_REVIEW_JOBS[0]!;

    render(<JobCard job={reviewJob} held={reviewJob.held} />, {
      wrapper: createWrapper(),
    });

    // Apply button is present
    const applyBtn = screen.getByRole('button', { name: `Apply to ${reviewJob.title}` });
    fireEvent.click(applyBtn);

    // Caution dialog appears
    await waitFor(() => {
      expect(screen.getByText("This job isn't verified. Open anyway?")).toBeInTheDocument();
      expect(screen.getByTestId('apply-caution-confirm')).toBeInTheDocument();
    });

    expect(windowOpenSpy).not.toHaveBeenCalled();

    // Confirm opening
    fireEvent.click(screen.getByTestId('apply-caution-confirm'));

    expect(windowOpenSpy).toHaveBeenCalledWith(
      reviewJob.applicationUrl,
      '_blank',
      'noopener,noreferrer',
    );

    windowOpenSpy.mockRestore();
  });

  // ── 5. Loading, empty and error states ─────────────────────────────────────

  it('renders loading skeleton when loading', () => {
    mockGet.mockImplementation(() => new Promise(() => {}));

    render(<NeedsReviewList query={{}} />, { wrapper: createWrapper() });

    expect(screen.getByLabelText('Loading review jobs')).toBeInTheDocument();
  });

  it('renders empty state when no jobs need review', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/jobs/needs-review') return { data: [], meta: { nextCursor: null } };
      return { data: [] };
    });

    render(<NeedsReviewList query={{}} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('needs-review-empty')).toBeInTheDocument();
      expect(screen.getByText('Nothing needs review right now')).toBeInTheDocument();
    });
  });

  it('renders error state with retry button', async () => {
    mockGet.mockRejectedValueOnce(new Error('Network error'));

    render(<NeedsReviewList query={{}} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('needs-review-error')).toBeInTheDocument();
      expect(screen.getByText('Could not load review jobs')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  // ── 6. Pagination via meta.nextCursor ─────────────────────────────────────

  it('supports cursor pagination when nextCursor is returned', async () => {
    mockGet.mockImplementation(async (path: string, params?: Record<string, unknown>) => {
      if (path === '/jobs/needs-review') {
        if (!params?.cursor) {
          return {
            data: [MOCK_REVIEW_JOBS[0]],
            meta: { nextCursor: 'cursor_page_2' },
          };
        }
        if (params.cursor === 'cursor_page_2') {
          return {
            data: [MOCK_REVIEW_JOBS[1]],
            meta: { nextCursor: null },
          };
        }
      }
      return { data: [] };
    });

    render(<NeedsReviewList query={{}} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Graduate Engineer Trainee')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument();
    });

    // Click Load more
    fireEvent.click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(
        '/jobs/needs-review',
        expect.objectContaining({ cursor: 'cursor_page_2' }),
      );
      expect(screen.getByText('Software Engineer')).toBeInTheDocument();
      // Previous job is still retained
      expect(screen.getByText('Graduate Engineer Trainee')).toBeInTheDocument();
    });
  });

  // ── R6 requirement: Salary "Not disclosed" test ───────────────────────────

  it('shows "Not disclosed" when salary.disclosed is false or salary.text is null', () => {
    // Case 1: salary.disclosed is false with null text
    const jobUndisclosed: JobCardType = {
      ...MOCK_VALID_JOB,
      salary: {
        min: null,
        max: null,
        currency: null,
        period: null,
        text: null,
        disclosed: false,
      },
    };
    const { unmount: u1 } = render(<JobCard job={jobUndisclosed} />, { wrapper: createWrapper() });
    expect(screen.getByText('Not disclosed')).toBeInTheDocument();
    u1();

    // Case 2: salary.text is null even if disclosed is true
    const jobNullText: JobCardType = {
      ...MOCK_VALID_JOB,
      salary: {
        min: 500000,
        max: 800000,
        currency: 'INR',
        period: 'YEARLY',
        text: null,
        disclosed: true,
      },
    };
    const { unmount: u2 } = render(<JobCard job={jobNullText} />, { wrapper: createWrapper() });
    expect(screen.getByText('Not disclosed')).toBeInTheDocument();
    u2();

    // Case 3: salary itself is null
    const jobNoSalary: JobCardType = {
      ...MOCK_VALID_JOB,
      salary: null,
    };
    const { unmount: u3 } = render(<JobCard job={jobNoSalary} />, { wrapper: createWrapper() });
    expect(screen.getByText('Not disclosed')).toBeInTheDocument();
    u3();

    // Case 4: salary disclosed with text displays actual text
    const jobWithSalary: JobCardType = {
      ...MOCK_VALID_JOB,
      salary: {
        min: 600000,
        max: 900000,
        currency: 'INR',
        period: 'YEARLY',
        text: '₹6-9 LPA',
        disclosed: true,
      },
    };
    const { unmount: u4 } = render(<JobCard job={jobWithSalary} />, { wrapper: createWrapper() });
    expect(screen.getByText('₹6-9 LPA')).toBeInTheDocument();
    u4();
  });

  // ── System Status: status.ai.byPurpose ────────────────────────────────────

  it('renders AI calls by purpose table when status.ai.byPurpose is present', async () => {
    render(<SystemPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Calls by purpose')).toBeInTheDocument();
      expect(screen.getByText('Category check:')).toBeInTheDocument();
      expect(screen.getByText('73')).toBeInTheDocument();
      expect(screen.getByText('Resume parsing:')).toBeInTheDocument();
      expect(screen.getByText('12')).toBeInTheDocument();
    });
  });
});
