import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { SignupForm } from '@/components/auth/signup-form';
import { ResumeUploadStep } from '@/components/onboarding/resume-upload-step';
import { ProfileReviewStep } from '@/components/onboarding/profile-review-step';
import { PreferencesStep } from '@/components/onboarding/preferences-step';
import { JobCard } from '@/components/jobs/JobCard';
import { JobDetail } from '@/components/jobs/JobDetail';
import { JobFilters } from '@/components/jobs/JobFilters';
import { TrackerActions } from '@/components/jobs/TrackerActions';
import type { JobCard as JobCardType, JobDetail as JobDetailType } from '@/lib/types/jobs';
import type { ResumeAnalysis } from '@jobsentinel/types';

// ── Mock Next.js navigation ──────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/jobs',
  useSearchParams: () => new URLSearchParams(),
}));

// ── Mock Supabase client ─────────────────────────────────────────────────────

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      signUp: vi.fn(),
    },
  }),
}));

// ── Mock useApi ──────────────────────────────────────────────────────────────

vi.mock('@/hooks/use-api', () => ({
  useApi: () => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  }),
}));

// ── Mock RelativeTime ────────────────────────────────────────────────────────

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

const TEST_JOB: JobCardType = {
  id: 'job-f9-test',
  title: 'Junior Software Engineer',
  company: {
    id: 'c1',
    name: 'Tech Corp',
    domain: 'techcorp.example.com',
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
  salary: null,
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
    overallScore: 85,
    priority: 'HIGH',
    matchedSkills: ['React', 'TypeScript'],
    scoring: 'AI_REFINED',
  },
  tracker: { saved: false, status: null },
  applicationUrl: 'https://techcorp.example.com/apply',
  isNew: false,
};

const TEST_JOB_DETAIL: JobDetailType = {
  ...TEST_JOB,
  description: 'A great role for freshers.',
  requirements: ['B.Tech / B.E.', 'Knowledge of React'],
  skills: ['React', 'TypeScript'],
  sourceUrl: 'https://techcorp.example.com/jobs/1',
  sources: [
    {
      name: 'Tech Careers',
      url: 'https://techcorp.example.com/jobs/1',
      firstSeenAt: '2026-10-18T10:00:00.000Z',
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
    finalUrl: 'https://techcorp.example.com/apply',
    evidence: [],
    suspiciousFlags: [],
    aiAssessment: null,
    checkedAt: '2026-10-18T10:00:00.000Z',
    nextCheckAt: null,
  },
  match: {
    overallScore: 85,
    priority: 'HIGH',
    matchedSkills: ['React', 'TypeScript'],
    scoring: 'AI_REFINED',
    skillScore: 85,
    roleScore: 85,
    experienceScore: 100,
    locationScore: 80,
    missingSkills: [],
    explanation: 'Good fit',
    aiProvider: 'gemini',
    aiPending: false,
  },
  events: [],
};

const MOCK_ANALYSIS: ResumeAnalysis = {
  resumeId: '00000000-0000-0000-0000-000000000001',
  analyzedAt: '2026-10-18T10:00:00.000Z',
  provider: 'gemini',
  model: 'gemini-1.5-pro',
  promptVersion: 'v1',
  deterministicFallback: false,
  draft: {
    name: 'Test Candidate',
    summary: null,
    location: 'Bengaluru, India',
    experienceLevel: 'FRESHER',
    graduationYear: 2026,
    degree: 'B.Tech',
    branch: 'Computer Science',
    college: 'National Institute',
    skills: [
      { name: 'TypeScript', category: 'LANGUAGE', proficiency: null },
      { name: 'React', category: 'FRAMEWORK', proficiency: null },
    ],
    suggestedRoles: [],
    suggestedLocations: ['Bengaluru'],
    education: [],
    projects: [],
    experience: [],
    certifications: [],
  },
};

describe('F9 stable selectors and accessible locators (D122)', () => {
  // ── 1. Sign-up form (renders SignupForm) ───────────────────────────────────
  it('renders SignupForm: stable selector signup-submit and accessible labels', () => {
    render(<SignupForm configured={true} />);

    // Labels required by Playwright
    expect(screen.getByLabelText(/^Email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Confirm password/i)).toBeInTheDocument();

    // Button name and data-testid
    const submitBtn = screen.getByRole('button', { name: 'Create account' });
    expect(submitBtn).toBeInTheDocument();
    expect(submitBtn).toHaveAttribute('data-testid', 'signup-submit');
  });

  // ── 2. Onboarding upload step (renders ResumeUploadStep) ─────────────────────
  it('renders ResumeUploadStep: stable selector onboarding-upload and file input', () => {
    const { container } = render(<ResumeUploadStep onAnalyzed={vi.fn()} />);

    // File input locator
    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).toBeInTheDocument();

    // Button name and data-testid
    const uploadBtn = screen.getByRole('button', { name: 'Upload & analyze' });
    expect(uploadBtn).toBeInTheDocument();
    expect(uploadBtn).toHaveAttribute('data-testid', 'onboarding-upload');
  });

  // ── 3. Onboarding review step (renders ProfileReviewStep) ───────────────────
  it('renders ProfileReviewStep: stable selector onboarding-confirm-profile and accessible landmarks', () => {
    render(<ProfileReviewStep analysis={MOCK_ANALYSIS} onBack={vi.fn()} onSaved={vi.fn()} />);

    // Text "Check what we found"
    expect(screen.getByText('Check what we found')).toBeInTheDocument();

    // List named "Skills"
    const skillsList = screen.getByRole('list', { name: 'Skills' });
    expect(skillsList).toBeInTheDocument();

    // Button "Confirm profile" with data-testid="onboarding-confirm-profile"
    const confirmBtn = screen.getByRole('button', { name: 'Confirm profile' });
    expect(confirmBtn).toBeInTheDocument();
    expect(confirmBtn).toHaveAttribute('data-testid', 'onboarding-confirm-profile');
  });

  // ── 4. Onboarding preferences step (renders PreferencesStep) ────────────────
  it('renders PreferencesStep: stable selector onboarding-start and button name', () => {
    render(
      <PreferencesStep
        suggestedRoles={[]}
        suggestedLocations={['Bengaluru']}
        graduationYear={2026}
        onBack={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    // Button "Start monitoring" with data-testid="onboarding-start"
    const startBtn = screen.getByRole('button', { name: 'Start monitoring' });
    expect(startBtn).toBeInTheDocument();
    expect(startBtn).toHaveAttribute('data-testid', 'onboarding-start');
  });

  // ── 5. JobCard selectors and exact title link (renders JobCard) ─────────────
  it('renders JobCard: stable selectors job-card-<id>, job-card-title-<id>, title link and Not disclosed salary', () => {
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <JobCard job={TEST_JOB} />
      </Wrapper>,
    );

    // Article card testid
    const card = screen.getByTestId(`job-card-${TEST_JOB.id}`);
    expect(card).toBeInTheDocument();

    // Title link testid and exact text
    const titleLink = screen.getByTestId(`job-card-title-${TEST_JOB.id}`);
    expect(titleLink).toBeInTheDocument();
    expect(titleLink).toHaveTextContent(TEST_JOB.title);
    expect(screen.getByRole('link', { name: TEST_JOB.title })).toBeInTheDocument();

    // Salary display: the text "Not disclosed"
    expect(screen.getByText('Not disclosed')).toBeInTheDocument();
  });

  // ── 6. JobFilters selectors and locators (renders JobFilters) ───────────────
  it('renders JobFilters: stable selectors filter-posted, salary controls, and combobox Date Posted', () => {
    render(<JobFilters />);

    // Combobox "Date Posted" and testid filter-posted
    const datePostedCombo = screen.getByRole('combobox', { name: 'Date Posted' });
    expect(datePostedCombo).toBeInTheDocument();
    expect(datePostedCombo).toHaveAttribute('data-testid', 'filter-posted');

    // Open combobox and find option "Last 7 days"
    fireEvent.click(datePostedCombo);
    expect(screen.getByRole('option', { name: 'Last 7 days' })).toBeInTheDocument();

    // Salary min input testid
    expect(screen.getByTestId('salary-min-input')).toBeInTheDocument();

    // Salary undisclosed toggle testid
    expect(screen.getByTestId('salary-undisclosed-toggle')).toBeInTheDocument();
  });

  // ── 7. TrackerActions / JobDetail selectors (renders TrackerActions, JobDetail)
  it('renders TrackerActions: stable selector tracker-status, combobox Status:, and option Applied', () => {
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <TrackerActions job={TEST_JOB_DETAIL} />
      </Wrapper>,
    );

    // Combobox named "Status:" with data-testid="tracker-status"
    const statusCombo = screen.getByRole('combobox', { name: 'Status:' });
    expect(statusCombo).toBeInTheDocument();
    expect(statusCombo).toHaveAttribute('data-testid', 'tracker-status');

    // Open combobox to find option "Applied"
    fireEvent.click(statusCombo);
    expect(screen.getByRole('option', { name: 'Applied' })).toBeInTheDocument();
  });

  it('renders JobDetail: Not disclosed salary text', () => {
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <JobDetail job={TEST_JOB_DETAIL} />
      </Wrapper>,
    );

    // Salary text "Not disclosed"
    expect(screen.getByText('Not disclosed')).toBeInTheDocument();
  });
});
