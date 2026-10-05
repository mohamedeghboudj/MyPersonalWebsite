import { describe, expect, it } from 'vitest';
import {
  contactSchema,
  cvTargetSchema,
  educationInputSchema,
  localeSchema,
  profileSchema,
  snapshotSchema,
  webUrlSchema,
  type Snapshot,
} from '@platform/schema';
import {
  assembleCv,
  cvCacheKey,
  escapeLatex,
  renderLatex,
} from '@platform/cv-engine';
import { resolveTranslation } from '@platform/database';
import {
  adminEnvSchema,
  boundedJson,
  contactEnvSchema,
  dummyTurnstile,
} from '@platform/config';
import { spikeEducation } from '../scripts/fixtures';

export const snapshot: Snapshot = {
  schemaVersion: 1,
  revision: 7,
  generatedAt: '2026-10-04T12:00:00.000Z',
  profile: {
    fullName: 'Test Owner',
    translations: [{ locale: 'en', headline: 'Synthetic test' }],
  },
  education: [
    {
      id: 1,
      startDate: spikeEducation.startDate,
      endDate: null,
      schoolUrl: null,
      displayOrder: 0,
      translations: spikeEducation.translations,
    },
  ],
  publicVariant: {
    id: 1,
    translations: [
      {
        locale: 'en',
        summary: 'Synthetic summary',
        profileHeading: 'Profile',
        educationHeading: 'Education',
        presentLabel: 'Present',
      },
    ],
    items: [{ contentItemId: 1, position: 0 }],
  },
};
describe('temporary Sprint 0 Turnstile configuration', () => {
  const config = {
    PUBLIC_ORIGIN: 'http://localhost:4321',
    TURNSTILE_HOSTNAME: 'example.com',
    TURNSTILE_SECRET: dummyTurnstile.secret,
    RATE_LIMIT_SALT: 'local-test-salt-000000000000000000',
    NOTIFICATION_FROM: 'contact@example.com',
    NOTIFICATION_TO: 'owner@example.com',
  };
  it('rejects dummy keys unless explicitly configured for the isolated spike', () => {
    expect(contactEnvSchema.safeParse(config).success).toBe(false);
    expect(
      contactEnvSchema.safeParse({ ...config, TURNSTILE_MODE: 'spike' })
        .success,
    ).toBe(true);
    expect(
      contactEnvSchema.safeParse({
        ...config,
        TURNSTILE_MODE: 'spike',
        PUBLIC_ORIGIN: 'https://example.com',
      }).success,
    ).toBe(false);
    expect(
      contactEnvSchema.safeParse({
        ...config,
        TURNSTILE_MODE: 'spike',
        TURNSTILE_HOSTNAME: 'wrong.example.com',
      }).success,
    ).toBe(false);
    expect(
      contactEnvSchema.safeParse({
        ...config,
        TURNSTILE_MODE: 'spike',
        PUBLIC_ORIGIN:
          'https://mohamedeghboudj-site-spike.test-account.workers.dev',
      }).success,
    ).toBe(true);
  });
});
describe('shared schemas', () => {
  it('accepts bounded multilingual content and rejects duplicate locales, unknown fields and invalid dates', () => {
    expect(educationInputSchema.parse(spikeEducation)).toEqual(spikeEducation);
    for (const change of [
      {
        translations: [
          spikeEducation.translations[0],
          spikeEducation.translations[0],
        ],
      },
      { startDate: '2026-02-30' },
      { endDate: '2025-01-01' },
      { privateNote: 'leak' },
      { isVisible: 'yes' },
      { displayOrder: -1 },
    ])
      expect(
        educationInputSchema.safeParse({ ...spikeEducation, ...change })
          .success,
      ).toBe(false);
    expect(profileSchema.safeParse(snapshot.profile).success).toBe(true);
    expect(
      profileSchema.safeParse({ ...snapshot.profile, translations: [] })
        .success,
    ).toBe(false);
    expect(
      profileSchema.safeParse({
        fullName: 'A\nB',
        translations: snapshot.profile.translations,
      }).success,
    ).toBe(false);
    expect(localeSchema.safeParse('ar').success).toBe(true);
    expect(localeSchema.safeParse('de').success).toBe(false);
    expect(
      cvTargetSchema.safeParse({
        company: 'Université & Co.',
        role: 'Engineer',
      }).success,
    ).toBe(true);
    expect(
      cvTargetSchema.safeParse({ company: '', role: 'A\r\nB' }).success,
    ).toBe(false);
  });
  it('allows HTTP(S) links only', () => {
    expect(webUrlSchema.safeParse('https://example.com/path').success).toBe(
      true,
    );
    for (const link of [
      'javascript:alert(1)',
      'data:text/html,hello',
      'file:///etc/passwd',
    ])
      expect(webUrlSchema.safeParse(link).success).toBe(false);
  });
  it('rejects email header injection, unknown fields and oversized contact input', () => {
    const base = {
      name: 'Visitor',
      email: 'visitor@example.com',
      message: 'Hello',
      website: '',
      startedAt: Date.now(),
      idempotencyKey: crypto.randomUUID(),
      turnstileToken: 'test',
    };
    expect(contactSchema.safeParse(base).success).toBe(true);
    for (const change of [
      { name: 'A\r\nBcc: victim@example.com' },
      { email: 'a@example.com\nX: y' },
      { message: 'x'.repeat(5001) },
      { idempotencyKey: 'short' },
      { to: 'victim@example.com' },
    ])
      expect(contactSchema.safeParse({ ...base, ...change }).success).toBe(
        false,
      );
  });
  it('fails closed on malformed environment values', () => {
    const admin = {
      ACCESS_ISSUER: 'https://test.cloudflareaccess.com',
      ACCESS_AUDIENCE: 'test-audience-0001',
      ADMIN_ORIGIN: 'https://admin.example.com',
      OWNER_EMAIL: 'owner@example.com',
    };
    expect(adminEnvSchema.safeParse(admin).success).toBe(true);
    expect(
      adminEnvSchema.safeParse({
        ...admin,
        ACCESS_ISSUER: 'http://localhost:8787',
      }).success,
    ).toBe(false);
    expect(contactEnvSchema.safeParse({}).success).toBe(false);
    expect(
      contactEnvSchema.safeParse({
        PUBLIC_ORIGIN: 'https://example.com',
        TURNSTILE_HOSTNAME: 'example.com',
        TURNSTILE_SECRET: 'test-secret-long',
        RATE_LIMIT_SALT: 'x'.repeat(32),
        NOTIFICATION_FROM: 'n@example.com',
        NOTIFICATION_TO: 'o@example.com',
      }).success,
    ).toBe(true);
  });
  it('caps streamed bodies without trusting Content-Length', async () => {
    await expect(
      boundedJson(
        new Request('https://example.com', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'x'.repeat(100),
        }),
        20,
      ),
    ).rejects.toThrow('body-size');
    expect(
      await boundedJson(
        new Request('https://example.com', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{"ok":true}',
        }),
        20,
      ),
    ).toEqual({ ok: true });
  });
});
describe('LaTeX security and multilingual assembly', () => {
  it.each([
    '\\input{secret}',
    '\\include{secret}',
    '\\write18{curl evil}',
    '\\immediate\\write18{x}',
    '\\catcode`x=0',
    '\\csname input\\endcsname',
    '\\directlua{os.execute("x")}',
    '\\openout1=file',
    '\\read1',
    '\\special{x}',
    '\\usepackage{shellesc}',
    '\\def\\x{bad}',
    '\\end{document}',
    '^^5cinput{x}',
    '\\\ninput{x}',
    'a\u0000b',
  ])('rejects control input: %s', (value) => {
    expect(() => escapeLatex(value)).toThrow();
  });
  it('escapes every special character in a single pass and preserves Unicode', () => {
    expect(escapeLatex('\\ {} $ & # ^ _ % ~')).toBe(
      '\\textbackslash{} \\{\\} \\$ \\& \\# \\textasciicircum{} \\_ \\% \\textasciitilde{}',
    );
    expect(escapeLatex('École — العربية')).toBe('École — العربية');
  });
  it('uses requested, English, then deterministic available translation', () => {
    expect(resolveTranslation(spikeEducation.translations, 'ar').locale).toBe(
      'ar',
    );
    expect(
      resolveTranslation([{ locale: 'en', value: 'English' }] as const, 'ar')
        .value,
    ).toBe('English');
    expect(
      resolveTranslation([{ locale: 'fr', value: 'Français' }] as const, 'ar')
        .value,
    ).toBe('Français');
    expect(() => resolveTranslation([], 'ar')).toThrow();
  });
  it('enforces selection integrity and variant order', () => {
    const two = structuredClone(snapshot);
    two.education.push({ ...two.education[0]!, id: 2 });
    two.publicVariant.items = [
      { contentItemId: 1, position: 2 },
      { contentItemId: 2, position: 0 },
    ];
    expect(assembleCv(two, 'fr').items.map((item) => item.id)).toEqual([2, 1]);
    two.publicVariant.items.push({ contentItemId: 999, position: 3 });
    expect(() => assembleCv(two, 'en')).toThrow('missing public content');
  });
  it('renders Arabic with explicit English runs and rejects unsplit injection', () => {
    const payload = assembleCv(snapshot, 'ar');
    const tex = renderLatex(payload);
    expect(tex).toContain('\\setdefaultlanguage{arabic}');
    expect(tex).toContain('\\textenglish{Project Atlas} ');
    expect(tex).toContain('\\textenglish{TypeScript} ');
    payload.items[0]!.description = 'العربية \\input{secret}';
    expect(() => renderLatex(payload)).toThrow();
  });
  it('keeps URLs outside French punctuation spacing rules', () => {
    const payload = assembleCv(snapshot, 'fr');
    payload.items[0]!.schoolUrl = 'https://example.com/cv?lang=fr&year=2026';
    expect(renderLatex(payload)).toContain(
      '\\textenglish{https://example.com/cv?lang=fr\\&year=2026}',
    );
  });
  it('escapes target fields and invalidates cache for every resolved input change', async () => {
    const base = assembleCv(snapshot, 'en', { company: 'A&B', role: 'R&D' });
    expect(renderLatex(base)).toContain('A\\&B');
    expect(() =>
      renderLatex({ ...base, target: { company: '\\input{x}', role: 'test' } }),
    ).toThrow();
    const key = await cvCacheKey(base);
    expect(await cvCacheKey(structuredClone(base))).toBe(key);
    for (const change of [
      { name: 'Changed' },
      { locale: 'fr' as const },
      { variantId: 2 },
      { target: { company: 'Different', role: 'R&D' } },
      { target: { company: 'A&B', role: 'Different' } },
      { summary: 'New facts' },
    ])
      expect(await cvCacheKey({ ...base, ...change })).not.toBe(key);
  });
  it('strictly rejects unexpected fields at all snapshot boundaries', () => {
    expect(snapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      snapshotSchema.safeParse({ ...snapshot, contact_messages: [] }).success,
    ).toBe(false);
    expect(
      snapshotSchema.safeParse({
        ...snapshot,
        profile: { ...snapshot.profile, privateNote: 'secret' },
      }).success,
    ).toBe(false);
  });
});
