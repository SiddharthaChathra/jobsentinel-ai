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
    ['Graduate Engineer Trainee', 'software_engineer', 'SOFTWARE'],
    ['Mechanical Design Engineer', 'mechanical_engineer', 'MECHANICAL'],
    ['Marketing Executive', 'unknown', 'UNKNOWN'],
  ])('%s → %s / %s', (title, family, category) => {
    const r = classifyRoleFamily(title);
    expect(r.roleFamily).toBe(family);
    expect(r.category).toBe(category);
  });
});
