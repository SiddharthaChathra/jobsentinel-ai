import { placeholderMatch } from './placeholder';

describe('placeholderMatch (D117)', () => {
  it.each([
    "Don't see what you're looking for?", // Sigmoid's posting, verbatim
    'Don’t see the right role? Apply here',
    'General Application',
    'General Application - Engineering (Bengaluru)',
    'Talent Community',
    'Join our Talent Network',
    'Future Opportunities',
    'Future Opportunities - India',
    'Open Application',
    'Spontaneous application',
    'Expression of Interest - Software',
    'Submit your resume',
    'Software Engineering Talent Pool',
  ])('flags a placeholder: %s', (title) => {
    expect(placeholderMatch(title)).not.toBeNull();
  });

  it.each([
    'Graduate Engineer Trainee',
    'General Manager',
    'General Engineer',
    'General Manager - Engineering',
    'Network Engineer',
    'Join our team as a Backend Engineer',
    'Talent Acquisition Intern',
    'Future of Work Analyst',
    'Software Engineer - Applications',
    'Open Source Developer',
    'Community Manager',
  ])('leaves a real role alone: %s', (title) => {
    expect(placeholderMatch(title)).toBeNull();
  });
});
