import { cleanText, redactForAi, sniffResumeMime } from './parsers';

describe('sniffResumeMime', () => {
  it('detects PDF by magic bytes regardless of declared type', () => {
    expect(sniffResumeMime(Buffer.from('%PDF-1.7 rest'))).toBe('application/pdf');
  });
  it('detects DOCX (zip with word/ entries) and rejects plain zips', () => {
    const docx = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('....word/document.xml'),
    ]);
    expect(sniffResumeMime(docx)).toContain('wordprocessingml');
    const zip = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('....photos/a.jpg'),
    ]);
    expect(sniffResumeMime(zip)).toBeNull();
  });
  it('rejects anything else', () => {
    expect(sniffResumeMime(Buffer.from('<html>'))).toBeNull();
    expect(sniffResumeMime(Buffer.alloc(0))).toBeNull();
  });
});

describe('redactForAi', () => {
  it('replaces emails, phones and links but keeps names and skills', () => {
    const out = redactForAi(
      'Siddharth C — siddharth@example.com, +91 98765 43210, https://github.com/sid, linkedin.com/in/sid. Skills: Python (2024)',
    );
    expect(out).not.toMatch(/example\.com|98765|github\.com|linkedin/);
    expect(out).toMatch(/Siddharth C/);
    expect(out).toMatch(/Python \(2024\)/);
  });
});

describe('cleanText', () => {
  it('normalizes whitespace and line breaks', () => {
    expect(cleanText('a \t b\r\n\r\n\r\n\r\nc')).toBe('a b\n\nc');
  });
});
