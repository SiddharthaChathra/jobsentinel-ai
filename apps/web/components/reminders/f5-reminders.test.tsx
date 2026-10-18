import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { RemindersSection } from './RemindersSection';
import { ApplicationDatePickers, dateToLocalEodIso } from './ApplicationDatePickers';
import { NotificationCard } from '@/components/settings/NotificationCard';
import NotificationsPage from '@/app/(app)/notifications/page';
import type { ReminderItem } from '@jobsentinel/types';
import type { NotificationSettings } from '@jobsentinel/types';

// Mock Next.js navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/applications',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/components/common/RelativeTime', () => ({
  RelativeTime: ({ date }: { date: string }) => <span>{date}</span>,
}));

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPut = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/hooks/use-api', () => ({
  useApi: () => ({
    get: mockGet,
    post: mockPost,
    put: mockPut,
    patch: mockPatch,
    delete: mockDelete,
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

const MOCK_REMINDERS: ReminderItem[] = [
  {
    id: 'rem-1-due',
    kind: 'FOLLOW_UP',
    status: 'SENT',
    state: 'DUE',
    dueAt: '2026-10-18T06:00:00.000Z',
    snoozedUntil: null,
    sentAt: '2026-10-18T06:00:12.000Z',
    message: 'Follow up on SDE I at Hevo Data: no update for 7 days since you applied.',
    job: {
      id: 'job-hevo-1',
      title: 'SDE I',
      company: 'Hevo Data',
      applicationStatus: 'APPLIED',
    },
  },
  {
    id: 'rem-2-upcoming',
    kind: 'INTERVIEW_DAY_BEFORE',
    status: 'PENDING',
    state: 'UPCOMING',
    dueAt: '2026-10-20T04:30:00.000Z',
    snoozedUntil: null,
    sentAt: null,
    message: 'Interview tomorrow: Associate SDE at Hevo Data.',
    job: {
      id: 'job-hevo-2',
      title: 'Associate SDE',
      company: 'Hevo Data',
      applicationStatus: 'INTERVIEW',
    },
  },
];

const MOCK_SETTINGS: NotificationSettings = {
  mode: 'BOTH',
  digestHourLocal: 8,
  quietHoursStart: 22,
  quietHoursEnd: 7,
  instantMinScore: 80,
  includeNeedsReviewInDigest: true,
  telegramEnabled: true,
  pausedUntil: null,
  remindersEnabled: true,
  followUpDays: 7,
  weeklySummaryEnabled: false,
  telegram: {
    available: true,
    linked: true,
    username: 'test_user',
    linkedAt: '2026-10-15T10:00:00.000Z',
  },
};

describe('Phase 13 F5 Tracker Reminders UI (D119)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Reminders Section: DUE & UPCOMING rendering, Snooze, Dismiss, Empty ──
  describe('RemindersSection component', () => {
    it('renders RemindersSection: renders DUE and UPCOMING reminders with message and job link', async () => {
      mockGet.mockResolvedValueOnce({ data: MOCK_REMINDERS, meta: { count: 2 } });

      render(<RemindersSection />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('reminder-rem-1-due')).toBeInTheDocument();
        expect(screen.getByTestId('reminder-rem-2-upcoming')).toBeInTheDocument();
      });

      expect(
        screen.getByText(
          'Follow up on SDE I at Hevo Data: no update for 7 days since you applied.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Interview tomorrow: Associate SDE at Hevo Data.'),
      ).toBeInTheDocument();

      // Check job links
      const dueLink = screen.getByRole('link', {
        name: /Follow up on SDE I at Hevo Data/i,
      });
      expect(dueLink).toHaveAttribute('href', '/jobs/job-hevo-1');

      const upcomingLink = screen.getByRole('link', {
        name: /Interview tomorrow: Associate SDE/i,
      });
      expect(upcomingLink).toHaveAttribute('href', '/jobs/job-hevo-2');
    });

    it('renders RemindersSection: snooze button calls POST /api/v1/reminders/:id/snooze with 24 hours by default', async () => {
      mockGet.mockResolvedValueOnce({ data: MOCK_REMINDERS, meta: { count: 2 } });
      mockPost.mockResolvedValueOnce({ data: { ...MOCK_REMINDERS[0], state: 'UPCOMING' } });

      render(<RemindersSection />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('reminder-snooze-rem-1-due')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('reminder-snooze-rem-1-due'));

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith('/reminders/rem-1-due/snooze', { hours: 24 });
      });
    });

    it('renders RemindersSection: dismiss button calls POST /api/v1/reminders/:id/dismiss', async () => {
      mockGet.mockResolvedValueOnce({ data: MOCK_REMINDERS, meta: { count: 2 } });
      mockPost.mockResolvedValueOnce({ data: null });

      render(<RemindersSection />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('reminder-dismiss-rem-1-due')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('reminder-dismiss-rem-1-due'));

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith('/reminders/rem-1-due/dismiss');
      });
    });

    it('renders RemindersSection: empty list hides the section completely', async () => {
      mockGet.mockResolvedValueOnce({ data: [], meta: { count: 0 } });

      const { container } = render(<RemindersSection />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(container).toBeEmptyDOMElement();
      });
    });
  });

  // ── 2. ApplicationDatePickers: Interview datetime, Deadline, Clear, Follow-up ──
  describe('ApplicationDatePickers component', () => {
    it('renders ApplicationDatePickers: changing interview date sends ISO string, clear sends null', async () => {
      mockPatch.mockResolvedValueOnce({ data: {} });

      render(
        <ApplicationDatePickers
          jobId="job-test-1"
          interviewAt="2026-10-21T04:30:00.000Z"
          deadline="2026-10-25T18:29:00.000Z"
          followUpAt="2026-10-20T09:00:00.000Z"
        />,
        { wrapper: createWrapper() },
      );

      const interviewInput = screen.getByTestId('interview-date-job-test-1');
      expect(interviewInput).toBeInTheDocument();

      // Clear interview date
      const clearInterviewBtn = screen.getByLabelText('Clear interview date');
      fireEvent.click(clearInterviewBtn);

      await waitFor(() => {
        expect(mockPatch).toHaveBeenCalledWith('/applications/job-test-1/dates', {
          interviewAt: null,
        });
      });

      // Change interview date
      mockPatch.mockClear();
      mockPatch.mockResolvedValueOnce({ data: {} });
      fireEvent.change(interviewInput, { target: { value: '2026-10-22T14:30' } });

      await waitFor(() => {
        expect(mockPatch).toHaveBeenCalledWith(
          '/applications/job-test-1/dates',
          expect.objectContaining({
            interviewAt: new Date('2026-10-22T14:30').toISOString(),
          }),
        );
      });
    });

    it('renders ApplicationDatePickers: changing deadline sends 23:59 local ISO, clear sends null', async () => {
      mockPatch.mockResolvedValueOnce({ data: {} });

      render(<ApplicationDatePickers jobId="job-test-2" deadline="2026-10-25T18:29:00.000Z" />, {
        wrapper: createWrapper(),
      });

      const deadlineInput = screen.getByTestId('deadline-date-job-test-2');
      expect(deadlineInput).toBeInTheDocument();

      // Clear deadline
      const clearDeadlineBtn = screen.getByLabelText('Clear deadline');
      fireEvent.click(clearDeadlineBtn);

      await waitFor(() => {
        expect(mockPatch).toHaveBeenCalledWith('/applications/job-test-2/dates', {
          deadline: null,
        });
      });

      // Change deadline date
      mockPatch.mockClear();
      mockPatch.mockResolvedValueOnce({ data: {} });
      fireEvent.change(deadlineInput, { target: { value: '2026-10-30' } });

      const expectedIso = dateToLocalEodIso('2026-10-30');
      await waitFor(() => {
        expect(mockPatch).toHaveBeenCalledWith('/applications/job-test-2/dates', {
          deadline: expectedIso,
        });
      });
    });

    it('renders ApplicationDatePickers: shows read-only follow-up reminder text when present', () => {
      render(<ApplicationDatePickers jobId="job-test-3" followUpAt="2026-10-24T06:00:00.000Z" />, {
        wrapper: createWrapper(),
      });

      const followUpEl = screen.getByTestId('follow-up-job-test-3');
      expect(followUpEl).toBeInTheDocument();
      expect(followUpEl).toHaveTextContent(/Follow-up reminder on/i);
    });

    it('renders ApplicationDatePickers: deadlineOnly mode hides interview picker', () => {
      render(
        <ApplicationDatePickers
          jobId="job-saved-1"
          deadline="2026-10-30T18:29:00.000Z"
          deadlineOnly
        />,
        { wrapper: createWrapper() },
      );

      expect(screen.queryByTestId('interview-date-job-saved-1')).not.toBeInTheDocument();
      expect(screen.getByTestId('deadline-date-job-saved-1')).toBeInTheDocument();
    });
  });

  // ── 3. NotificationCard: Reminders, Follow-up days, Weekly summary round-trip ─
  describe('NotificationCard component', () => {
    it('renders NotificationCard: renders reminders toggle, followUpDays and weeklySummary, and round-trips on save', async () => {
      mockPut.mockResolvedValueOnce({ data: MOCK_SETTINGS });

      render(<NotificationCard settings={MOCK_SETTINGS} />, { wrapper: createWrapper() });

      expect(screen.getByText('Reminders')).toBeInTheDocument();
      expect(screen.getByLabelText('Follow up after N days')).toHaveValue(7);
      expect(screen.getByText('Weekly summary on Sunday 09:00')).toBeInTheDocument();

      const followUpInput = screen.getByLabelText('Follow up after N days');
      fireEvent.change(followUpInput, { target: { value: '10' } });

      const saveButton = screen.getByRole('button', { name: /Save alert settings/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockPut).toHaveBeenCalledWith(
          '/notifications/settings',
          expect.objectContaining({
            remindersEnabled: true,
            followUpDays: 10,
            weeklySummaryEnabled: false,
          }),
        );
      });
    });
  });

  // ── 4. NotificationsPage (Inbox): REMINDER and WEEKLY items render ──────────
  describe('NotificationsPage component', () => {
    it('renders NotificationsPage: renders REMINDER and WEEKLY items like system items with title and body', async () => {
      mockGet.mockResolvedValueOnce({
        data: [
          {
            id: 'inbox-rem-1',
            type: 'REMINDER',
            channel: 'WEB',
            status: 'SENT',
            jobId: 'job-123',
            title: 'Interview reminder',
            body: 'You have an interview scheduled tomorrow with Acme Corp.',
            score: null,
            readAt: null,
            sentAt: '2026-10-18T07:00:00.000Z',
            createdAt: '2026-10-18T07:00:00.000Z',
          },
          {
            id: 'inbox-weekly-1',
            type: 'WEEKLY',
            channel: 'WEB',
            status: 'SENT',
            jobId: null,
            title: 'Weekly summary — 12-18 Oct 2026',
            body: '5 new valid jobs, 2 applications updated, 1 interview scheduled.',
            score: null,
            readAt: null,
            sentAt: '2026-10-18T03:30:00.000Z',
            createdAt: '2026-10-18T03:30:00.000Z',
          },
        ],
      });

      render(<NotificationsPage />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText('Interview reminder')).toBeInTheDocument();
        expect(
          screen.getByText('You have an interview scheduled tomorrow with Acme Corp.'),
        ).toBeInTheDocument();
        expect(screen.getByText('Weekly summary — 12-18 Oct 2026')).toBeInTheDocument();
        expect(
          screen.getByText('5 new valid jobs, 2 applications updated, 1 interview scheduled.'),
        ).toBeInTheDocument();
      });
    });
  });
});
