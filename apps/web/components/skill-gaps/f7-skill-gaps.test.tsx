import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import SkillGapsPage from '@/app/(app)/skill-gaps/page';
import type { SkillGapReport } from '@jobsentinel/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/skill-gaps',
  useSearchParams: () => new URLSearchParams(),
}));

const mockGet = vi.fn();

vi.mock('@/hooks/use-api', () => ({
  useApi: () => ({
    get: mockGet,
    post: vi.fn(),
    put: vi.fn(),
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

const MOCK_REPORT: SkillGapReport = {
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
        {
          id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c02',
          title: 'Associate SDE',
          company: 'Hevo Data',
        },
        {
          id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c03',
          title: 'Graduate Engineer Trainee',
          company: 'Zeta',
        },
      ],
      links: [
        {
          title: 'PostgreSQL tutorial: the SQL language',
          url: 'https://www.postgresql.org/docs/current/tutorial-sql.html',
          publisher: 'PostgreSQL Global Development Group',
        },
      ],
    },
    {
      skill: 'Kubernetes',
      missingIn: 4,
      of: 15,
      jobs: [
        {
          id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c04',
          title: 'Cloud Engineer Trainee',
          company: 'Groww',
        },
      ],
      links: [],
    },
  ],
};

describe('Phase 13 F7 /skill-gaps Page (D120)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('SkillGapsPage component', () => {
    it('renders SkillGapsPage: rows render with counts and proportional descriptions', async () => {
      mockGet.mockResolvedValueOnce({ data: MOCK_REPORT });

      render(<SkillGapsPage />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('skill-gap-SQL')).toBeInTheDocument();
        expect(screen.getByTestId('skill-gap-Kubernetes')).toBeInTheDocument();
      });

      // Assert header description reflects basedOn
      expect(screen.getByText('Based on your top 15 matches')).toBeInTheDocument();

      // Assert row text format: "<skill> — missing in <missingIn> of <of>"
      expect(screen.getByText('SQL — missing in 9 of 15')).toBeInTheDocument();
      expect(screen.getByText('Kubernetes — missing in 4 of 15')).toBeInTheDocument();

      // Assert example jobs are rendered with links to /jobs/<id>
      const jobLink = screen.getByRole('link', { name: /SDE I \(Hevo Data\)/i });
      expect(jobLink).toBeInTheDocument();
      expect(jobLink).toHaveAttribute('href', '/jobs/9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c01');
    });

    it('renders SkillGapsPage: linked and unlinked gaps both render properly', async () => {
      mockGet.mockResolvedValueOnce({ data: MOCK_REPORT });

      render(<SkillGapsPage />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('skill-gap-SQL')).toBeInTheDocument();
      });

      // Linked gap (SQL) has links container
      expect(screen.getByTestId('skill-gap-links-SQL')).toBeInTheDocument();

      // Unlinked gap (Kubernetes) has row but no links container
      expect(screen.getByTestId('skill-gap-Kubernetes')).toBeInTheDocument();
      expect(screen.queryByTestId('skill-gap-links-Kubernetes')).not.toBeInTheDocument();
    });

    it('renders SkillGapsPage: learning links have target="_blank" and rel="noopener noreferrer"', async () => {
      mockGet.mockResolvedValueOnce({ data: MOCK_REPORT });

      render(<SkillGapsPage />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('skill-gap-links-SQL')).toBeInTheDocument();
      });

      const learningLink = screen.getByRole('link', {
        name: /PostgreSQL tutorial: the SQL language/i,
      });
      expect(learningLink).toBeInTheDocument();
      expect(learningLink).toHaveAttribute('target', '_blank');
      expect(learningLink).toHaveAttribute('rel', 'noopener noreferrer');
      expect(learningLink).toHaveAttribute(
        'href',
        'https://www.postgresql.org/docs/current/tutorial-sql.html',
      );
    });

    it('renders SkillGapsPage: empty state shows when basedOn is 0', async () => {
      mockGet.mockResolvedValueOnce({
        data: {
          basedOn: 0,
          generatedAt: '2026-10-18T06:00:00.000Z',
          gaps: [],
        },
      });

      render(<SkillGapsPage />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(
          screen.getByText('No matches yet — upload a resume or check back after the next scan.'),
        ).toBeInTheDocument();
      });

      expect(screen.queryByTestId('skill-gap-SQL')).not.toBeInTheDocument();
    });

    it('renders SkillGapsPage: soft-skills note shows with items and is hidden when empty or absent (F7, D120)', async () => {
      // 1. When present with items
      mockGet.mockResolvedValueOnce({
        data: {
          ...MOCK_REPORT,
          softSkills: [
            { skill: 'Communication', missingIn: 11, of: 15 },
            { skill: 'Teamwork', missingIn: 8, of: 15 },
          ],
        },
      });

      const { unmount } = render(<SkillGapsPage />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('soft-skills-note')).toBeInTheDocument();
      });

      expect(screen.getByRole('heading', { name: 'Soft skills' })).toBeInTheDocument();
      expect(screen.getByText('Communication — mentioned in 11 of 15')).toBeInTheDocument();
      expect(screen.getByText('Teamwork — mentioned in 8 of 15')).toBeInTheDocument();

      unmount();

      // 2. When empty or absent
      mockGet.mockResolvedValueOnce({
        data: {
          ...MOCK_REPORT,
          softSkills: [],
        },
      });

      render(<SkillGapsPage />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('skill-gap-SQL')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('soft-skills-note')).not.toBeInTheDocument();
    });
  });
});
