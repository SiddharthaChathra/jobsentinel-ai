import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { PreferencesStep } from '@/components/onboarding/preferences-step';
import { BottomTabs } from '@/components/layout/BottomTabs';
import { ApplicationDatePickers } from '@/components/reminders/ApplicationDatePickers';
import SkillGapsPage from '@/app/(app)/skill-gaps/page';
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
    it('renders ApplicationDatePickers: stacks pickers vertically and allows inputs to shrink with min-w-0 w-full flex-1', () => {
      render(
        <ApplicationDatePickers
          jobId="job-kanban-test"
          interviewAt="2026-10-21T04:30:00.000Z"
          deadline="2026-10-25T18:29:00.000Z"
        />,
        { wrapper: createWrapper() },
      );

      // Container stacks vertically so inputs fit narrow kanban columns (defect 12)
      const container = screen.getByTestId('date-pickers-job-kanban-test');
      expect(container.className).toContain('flex flex-col');
      expect(container.className).toContain('w-full');

      // Interview input shrinks within column
      const interviewInput = screen.getByTestId('interview-date-job-kanban-test');
      expect(interviewInput.className).toContain('w-full');
      expect(interviewInput.className).toContain('min-w-0');
      expect(interviewInput.className).toContain('flex-1');

      // Interview clear button has shrink-0 to stay inside column
      const clearInterviewBtn = screen.getByLabelText('Clear interview date');
      expect(clearInterviewBtn.className).toContain('shrink-0');

      // Deadline input shrinks within column
      const deadlineInput = screen.getByTestId('deadline-date-job-kanban-test');
      expect(deadlineInput.className).toContain('w-full');
      expect(deadlineInput.className).toContain('min-w-0');
      expect(deadlineInput.className).toContain('flex-1');

      // Deadline clear button has shrink-0 to stay inside column
      const clearDeadlineBtn = screen.getByLabelText('Clear deadline');
      expect(clearDeadlineBtn.className).toContain('shrink-0');

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
});
