import { classifyRoleFamily } from './role-family';

describe('classifyRoleFamily', () => {
  it.each([
    ['Software Engineer', 'software_engineer', 'SOFTWARE'],
    ['SDE-1 (Fresher)', 'software_engineer', 'SOFTWARE'],
    ['Technical Support Engineer', 'technical_support_engineer', 'IT_SUPPORT'],
    ['Network Engineer - L1', 'network_engineer', 'NETWORK'],
    ['Associate Cloud Engineer', 'cloud_engineer', 'CLOUD_DEVOPS'],
    ['Data Analyst Intern', 'data_analyst', 'DATA'],
    ['Junior Data Engineer', 'data_engineer', 'DATA'],
    // A programme, not a discipline: its qualifier decides, or the AI reads the description (D109).
    ['Graduate Engineer Trainee', 'graduate_engineer_trainee', 'UNKNOWN'],
    ['Graduate Engineer Trainee GET', 'graduate_engineer_trainee', 'UNKNOWN'],
    ['Graduate Engineer, Operations', 'graduate_engineer_trainee', 'UNKNOWN'],
    ['GET - Production', 'mechanical_engineer', 'MECHANICAL'],
    ['Graduate Engineer Trainee - Production', 'mechanical_engineer', 'MECHANICAL'],
    ['Graduate Engineer Trainee (GET) – Materials & Quality', 'mechanical_engineer', 'MECHANICAL'],
    [
      'Graduate Engineer Trainee FOR POWER PLAT, RAIPUR, C.G.',
      'electrical_engineer',
      'ELECTRICAL_ELECTRONICS',
    ],
    ['GET Mechanical Engineer', 'mechanical_engineer', 'MECHANICAL'],
    ['Software Engineer Trainee', 'software_engineer', 'SOFTWARE'],
    ['Network Engineer Trainee', 'network_engineer', 'NETWORK'],
    ['Trainee Engineer', 'graduate_engineer_trainee', 'UNKNOWN'],
    // Plurals classify like the singular (D109).
    ['Software Engineers', 'software_engineer', 'SOFTWARE'],
    ['Hiring Software Developers - Freshers', 'software_engineer', 'SOFTWARE'],
    ['Data Analysts', 'data_analyst', 'DATA'],
    ['Network Engineers (L1)', 'network_engineer', 'NETWORK'],
    ['Mechanical Design Engineer', 'mechanical_engineer', 'MECHANICAL'],
    ['Marketing Executive', 'unknown', 'UNKNOWN'],
    // The qualifier list is read only for trainee titles: these words alone decide nothing.
    ['Video Production Lead', 'unknown', 'UNKNOWN'],
    ['Quality Lead', 'unknown', 'UNKNOWN'],
  ])('%s → %s / %s', (title, family, category) => {
    const r = classifyRoleFamily(title);
    expect(r.roleFamily).toBe(family);
    expect(r.category).toBe(category);
  });
});
