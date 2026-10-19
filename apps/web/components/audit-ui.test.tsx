import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { PreferencesStep } from '@/components/onboarding/preferences-step';
import { BottomTabs } from '@/components/layout/BottomTabs';
import { ApplicationDatePickers } from '@/components/reminders/ApplicationDatePickers';
import SkillGapsPage from '@/app/(app)/skill-gaps/page';
import ApplicationsPage from '@/app/(app)/applications/page';
import type { SkillGapReport } from '@jobsentinel/types';

// Mock Next.js navigation
let mockCurrentPathname = '/dashboard';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => mockCurrentPathname,
  useSearchParams: () => new URLSearchParams(),
}));

const mockGet = vi.fn();

vi.mock('@/hooks/use-api', () => ({
  useApi: () => ({
    get: mockGet,
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
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

const MOCK_REPORT_WITH_SOFT_SKILLS: SkillGapReport = {
  basedOn: 15,
  generatedAt: '2026-10-18T06:00:00.000Z',
  gaps: [
    {
      skill: 'SQL',
      missingIn: 9,
      of: 15,
      jobs: [
        {
          id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c01',
          title: 'SDE I',
          company: 'Hevo Data',
        },
      ],
      links: [],
    },
  ],
  softSkills: [
    {
      skill: 'Communication',
      missingIn: 11,
      of: 15,
    },
    {
      skill: 'Teamwork',
      missingIn: 8,
      of: 15,
    },
  ],
};

const MOCK_REPORT_WITHOUT_SOFT_SKILLS: SkillGapReport = {
  basedOn: 15,
  generatedAt: '2026-10-18T06:00:00.000Z',
  gaps: [
    {
      skill: 'SQL',
      missingIn: 9,
      of: 15,
      jobs: [],
      links: [],
    },
  ],
  softSkills: [],
};

describe('Audit UI Fixes (D127, Defects 11-13, Soft skills note)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentPathname = '/dashboard';
  });

  // ── 1. Onboarding Default Job Types (D127) ──────────────────────────────────
  describe('Onboarding default selection', () => {
    it('renders PreferencesStep: pre-selects Full-time and Trainee by default, leaving Internship unselected', () => {
      render(
        <PreferencesStep
          suggestedRoles={[]}
          suggestedLocations={['Bengaluru']}
          graduationYear={2026}
          onBack={vi.fn()}
          onDone={vi.fn()}
        />,
      );

      const fullTimeCheckbox = screen.getByRole('checkbox', { name: 'Full-time' });
      const traineeCheckbox = screen.getByRole('checkbox', { name: 'Trainee / GET' });
      const internshipCheckbox = screen.getByRole('checkbox', { name: 'Internship' });
      const contractCheckbox = screen.getByRole('checkbox', { name: 'Contract' });
      const partTimeCheckbox = screen.getByRole('checkbox', { name: 'Part-time' });

      // Owner's default (D127): Full-time + Trainee
      expect(fullTimeCheckbox).toBeChecked();
      expect(traineeCheckbox).toBeChecked();

      // Internship stays available but unselected by default
      expect(internshipCheckbox).not.toBeChecked();
      expect(contractCheckbox).not.toBeChecked();
      expect(partTimeCheckbox).not.toBeChecked();
    });
  });

  // ── 2. Mobile Navigation Reaching /skill-gaps (Defect 11) ───────────────────
  describe('Mobile navigation reaching /skill-gaps', () => {
    it('renders BottomTabs: opens More menu and reaches /skill-gaps without crowding the bottom bar', () => {
      render(<BottomTabs />, { wrapper: createWrapper() });

      // The bar has 5 thumb-friendly items: Dashboard, Jobs, Saved, Applications, and More
      expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Jobs' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Saved' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Applications' })).toBeInTheDocument();

      const moreButton = screen.getByTestId('bottom-nav-more');
      expect(moreButton).toBeInTheDocument();
      expect(moreButton).toHaveAttribute('aria-expanded', 'false');

      // More menu dialog is initially closed
      expect(screen.queryByTestId('bottom-nav-more-menu')).not.toBeInTheDocument();

      // Click More button to open secondary navigation
      fireEvent.click(moreButton);
      expect(moreButton).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByTestId('bottom-nav-more-menu')).toBeInTheDocument();

      // /skill-gaps is present in the More menu with correct href
      const skillGapsLink = screen.getByTestId('more-nav-skill-gaps');
      expect(skillGapsLink).toBeInTheDocument();
      expect(skillGapsLink).toHaveAttribute('href', '/skill-gaps');
      expect(skillGapsLink).toHaveTextContent('Skill gaps');

      // Other secondary items are also accessible
      expect(screen.getByTestId('more-nav-notifications')).toHaveAttribute(
        'href',
        '/notifications',
      );
      expect(screen.getByTestId('more-nav-resume')).toHaveAttribute('href', '/resume');
      expect(screen.getByTestId('more-nav-preferences')).toHaveAttribute('href', '/preferences');
      expect(screen.getByTestId('more-nav-system')).toHaveAttribute('href', '/system');
      expect(screen.getByTestId('more-nav-settings')).toHaveAttribute('href', '/settings');

      // Clicking /skill-gaps closes the menu
      fireEvent.click(skillGapsLink);
      expect(screen.queryByTestId('bottom-nav-more-menu')).not.toBeInTheDocument();
    });

    it('renders BottomTabs: marks More tab as active when viewing /skill-gaps', () => {
      mockCurrentPathname = '/skill-gaps';

      render(<BottomTabs />, { wrapper: createWrapper() });

      const moreButton = screen.getByTestId('bottom-nav-more');
      // When on /skill-gaps, More tab shows text-primary and the top indicator
      expect(moreButton.className).toContain('text-primary');

      // Open More menu and confirm the /skill-gaps link has aria-current="page"
      fireEvent.click(moreButton);
      const skillGapsLink = screen.getByTestId('more-nav-skill-gaps');
      expect(skillGapsLink).toHaveAttribute('aria-current', 'page');
    });
  });

  // ── 3. Date Pickers Container Classes & Dark Mode (Defects 12 & 13) ─────────
  describe('Date pickers container classes and dark-mode styling', () => {
    it('renders ApplicationDatePickers: interview input and clear button are not in the same flex row, and input takes full width (defect 12)', () => {
      render(
        <ApplicationDatePickers
          jobId="job-kanban-test"
          interviewAt="2026-10-21T04:30:00.000Z"
          deadline="2026-10-25T18:29:00.000Z"
        />,
        { wrapper: createWrapper() },
      );

      // Container stacks vertically so inputs fit narrow kanban columns
      const container = screen.getByTestId('date-pickers-job-kanban-test');
      expect(container.className).toContain('flex flex-col');
      expect(container.className).toContain('w-full');

      // Interview input has full width so full date and time are readable at 1280px (defect 12)
      const interviewInput = screen.getByTestId('interview-date-job-kanban-test');
      expect(interviewInput.className).toContain('w-full');

      // Clear button is inside the label row, NOT in the same flex row as the input
      const clearInterviewBtn = screen.getByLabelText('Clear interview date');
      expect(interviewInput.parentElement).not.toBe(clearInterviewBtn.parentElement);
      expect(clearInterviewBtn.parentElement).not.toContainElement(interviewInput);

      // Deadline input has full width and its clear button is also in the label row
      const deadlineInput = screen.getByTestId('deadline-date-job-kanban-test');
      expect(deadlineInput.className).toContain('w-full');
      const clearDeadlineBtn = screen.getByLabelText('Clear deadline');
      expect(deadlineInput.parentElement).not.toBe(clearDeadlineBtn.parentElement);

      // Dark-mode date styling (defect 13): color-scheme: dark
      expect(interviewInput.className).toContain('dark:[color-scheme:dark]');
      expect(deadlineInput.className).toContain('dark:[color-scheme:dark]');
    });
  });

  // ── 4. Soft-Skills Note on /skill-gaps (F7, D120) ────────────────────────────
  describe('Soft-skills note on /skill-gaps', () => {
    it('renders SkillGapsPage: shows soft-skills note with items and line format when present', async () => {
      mockGet.mockResolvedValueOnce({ data: MOCK_REPORT_WITH_SOFT_SKILLS });

      render(<SkillGapsPage />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('soft-skills-note')).toBeInTheDocument();
      });

      const note = screen.getByTestId('soft-skills-note');
      expect(note).toBeInTheDocument();

      // Heading "Soft skills"
      expect(screen.getByRole('heading', { name: 'Soft skills' })).toBeInTheDocument();

      // Item lines formatted as "<skill> — mentioned in <missingIn> of <of>"
      expect(screen.getByText('Communication — mentioned in 11 of 15')).toBeInTheDocument();
      expect(screen.getByText('Teamwork — mentioned in 8 of 15')).toBeInTheDocument();

      // Soft skills must NOT have progress bars or learning links (kept lighter than gaps)
      expect(screen.queryByLabelText(/Communication: missing in/i)).not.toBeInTheDocument();
      expect(screen.queryByTestId('skill-gap-links-Communication')).not.toBeInTheDocument();
    });

    it('renders SkillGapsPage: hides soft-skills note when softSkills is empty or absent', async () => {
      mockGet.mockResolvedValueOnce({ data: MOCK_REPORT_WITHOUT_SOFT_SKILLS });

      render(<SkillGapsPage />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('skill-gap-SQL')).toBeInTheDocument();
      });

      // When softSkills is empty or absent, soft-skills-note is completely hidden
      expect(screen.queryByTestId('soft-skills-note')).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Soft skills' })).not.toBeInTheDocument();
    });
  });

  // ── 5. Applications Page Error State vs Empty State (Defect 14) ─────────────
  describe('Applications page error state vs empty state (defect 14)', () => {
    it('renders ApplicationsPage: renders error state with retry button when hook reports an error, NOT the empty state', async () => {
      mockGet.mockImplementation((url: string) => {
        if (url === '/applications') {
          return Promise.reject(new Error('Internal Server Error'));
        }
        if (url === '/reminders') {
          return Promise.resolve({ data: [] });
        }
        return Promise.resolve({ data: [] });
      });

      render(<ApplicationsPage />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('applications-error')).toBeInTheDocument();
      });

      // Shows error message and Retry button
      expect(
        screen.getByText('Could not load applications. Please try again.'),
      ).toBeInTheDocument();
      const retryBtn = screen.getByRole('button', { name: 'Retry' });
      expect(retryBtn).toBeInTheDocument();

      // Must NEVER show the empty state when the API call fails
      expect(screen.queryByText('No applications tracked yet')).not.toBeInTheDocument();

      // Clicking Retry calls refetch
      fireEvent.click(retryBtn);
      await waitFor(() => {
        expect(mockGet).toHaveBeenCalledWith('/applications', {});
      });
    });

    it('renders ApplicationsPage: renders empty state only when API call succeeds with 0 applications', async () => {
      mockGet.mockImplementation((url: string) => {
        if (url === '/applications') {
          return Promise.resolve({ data: [], meta: { count: 0 } });
        }
        if (url === '/reminders') {
          return Promise.resolve({ data: [] });
        }
        return Promise.resolve({ data: [] });
      });

      render(<ApplicationsPage />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText('No applications tracked yet')).toBeInTheDocument();
      });

      // Does NOT show the error state
      expect(screen.queryByTestId('applications-error')).not.toBeInTheDocument();
    });
  });
});
