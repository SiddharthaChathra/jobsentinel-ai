import { classifyPostingType } from './posting-type';

const type = (title: string, description = '') => classifyPostingType({ title, description });

describe('classifyPostingType (F3, D114)', () => {
  it.each([
    ['Off Campus Drive 2027 - Software Engineer', ''],
    ['Software Engineer', 'Apply for our off-campus hiring for 2026/27 graduates.'],
    ['Graduate Engineer Trainee Programme 2027', ''],
    ['Associate Engineer', 'Join our Early Careers Program for new graduates.'],
    ['Freshers Hiring Drive', 'Open to all B.E./B.Tech graduates.'],
    ['Software Engineer', 'Register for the TCS National Qualifier Test (NQT).'],
    ['Developer', 'Take part in our hiring challenge to get an interview.'],
  ])('OFF_CAMPUS_PROGRAM: %s', (title, description) => {
    expect(type(title, description)).toBe('OFF_CAMPUS_PROGRAM');
  });

  it.each([
    ['Campus Drive - Graduate Engineer Trainee', 'For students of partner colleges.'],
    ['Software Engineer', 'On-campus recruitment at IIT Madras for the 2027 batch.'],
    ['Trainee', 'Pool campus placement drive at Pune.'],
    ['Junior Engineer', 'Campus placements for final-year students.'],
  ])('CAMPUS_DRIVE: %s', (title, description) => {
    expect(type(title, description)).toBe('CAMPUS_DRIVE');
  });

  it.each([
    // Known false positives: an office campus, a programme manager, a regular opening.
    ['Software Engineer', 'Work from our Hyderabad campus with 5,000 colleagues.'],
    ['Technical Program Manager', 'Own the delivery program for our platform.'],
    ['Backend Engineer', 'Build APIs. 0-2 years. Freshers welcome.'],
    ['Walk-in Drive for Freshers - Customer Support', 'Walk in on Saturday.'],
  ])('REGULAR: %s', (title, description) => {
    expect(type(title, description)).toBe('REGULAR');
  });

  it('reads "off-campus" before "campus drive", which it contains', () => {
    expect(type('Off-campus drive', '')).toBe('OFF_CAMPUS_PROGRAM');
  });
});
