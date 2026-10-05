import {
  cvTargetSchema,
  localeSchema,
  snapshotSchema,
  type Locale,
} from '@platform/schema';
import { resolveTranslation } from '@platform/database';
import { sha256 } from '@platform/config';

export const templateVersion = 'spike-1';
const escapeMap: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  $: '\\$',
  '&': '\\&',
  '#': '\\#',
  '^': '\\textasciicircum{}',
  _: '\\_',
  '%': '\\%',
  '~': '\\textasciitilde{}',
};
export function escapeLatex(value: string): string {
  // Reject ALL control-word-shaped input, including obfuscation primitives,
  // rather than maintaining a blacklist of a handful of TeX commands.
  if (
    /\\\s*[a-zA-Z@]|\^\^|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(
      value,
    )
  )
    throw new Error('TeX control input is not allowed');
  return value.replace(
    /[\\{}$&#^_%~]/gu,
    (character) => escapeMap[character] ?? character,
  );
}
export function assembleCv(raw: unknown, locale: Locale, target?: unknown) {
  const snapshot = snapshotSchema.parse(raw);
  localeSchema.parse(locale);
  const resolvedTarget =
    target === undefined ? null : cvTargetSchema.parse(target);
  const profile = resolveTranslation(snapshot.profile.translations, locale);
  const summary = resolveTranslation(
    snapshot.publicVariant.translations,
    locale,
  );
  const items = [...snapshot.publicVariant.items]
    .sort(
      (a, b) => a.position - b.position || a.contentItemId - b.contentItemId,
    )
    .map((selection) => {
      const item = snapshot.education.find(
        (entry) => entry.id === selection.contentItemId,
      );
      if (!item)
        throw new Error('CV selection references missing public content');
      const translated = resolveTranslation(item.translations, locale);
      return {
        id: item.id,
        startDate: item.startDate,
        endDate: item.endDate,
        schoolUrl: item.schoolUrl,
        locale: translated.locale,
        school: translated.school,
        degree: translated.degree,
        description: translated.description,
      };
    });
  return {
    variantId: snapshot.publicVariant.id,
    locale,
    name: snapshot.profile.fullName,
    headline: profile.headline,
    headlineLocale: profile.locale,
    summary: summary.summary,
    summaryLocale: summary.locale,
    target: resolvedTarget,
    items,
  };
}
export async function cvCacheKey(payload: ReturnType<typeof assembleCv>) {
  return sha256(JSON.stringify({ templateVersion, payload }));
}
// Latin runs inside Arabic are wrapped by trusted code, never by form-entered TeX.
function arabicText(value: string): string {
  return value
    .split(/([A-Za-z0-9][A-Za-z0-9 .:/@_+%&#?=()–-]*)/u)
    .map((part) =>
      /^[A-Za-z0-9]/u.test(part)
        ? `\\textenglish{${escapeLatex(part)}}`
        : escapeLatex(part),
    )
    .join('');
}
export function renderLatex(payload: ReturnType<typeof assembleCv>): string {
  const language = { en: 'english', fr: 'french', ar: 'arabic' }[
    payload.locale
  ];
  const text = (value: string, source: Locale = payload.locale) => {
    // Check the whole field before segmenting it, so a control sequence cannot
    // be separated into harmless-looking fragments by bidi handling.
    escapeLatex(value);
    if (payload.locale === 'ar' && source !== 'ar')
      return `\\textenglish{${escapeLatex(value)}}`;
    if (source === 'ar')
      return payload.locale === 'ar'
        ? arabicText(value)
        : `\\textarabic{${arabicText(value)}}`;
    return escapeLatex(value);
  };
  return `\\documentclass[11pt,a4paper]{article}
\\usepackage[margin=20mm]{geometry}
\\usepackage{fontspec}
\\usepackage{polyglossia}
\\setdefaultlanguage{${language}}
\\setotherlanguages{${['english', 'french', 'arabic'].filter((item) => item !== language).join(',')}}
\\setmainfont{TeX Gyre Termes}
\\newfontfamily\\arabicfont[Script=Arabic]{Amiri}
\\newfontfamily\\englishfont{TeX Gyre Termes}
\\pagestyle{empty}
\\setlength{\\parindent}{0pt}
\\begin{document}
{\\Large ${text(payload.name, 'en')}}\\par
${text(payload.headline, payload.headlineLocale)}\\par
\\medskip
${text(payload.summary, payload.summaryLocale)}\\par
${payload.target ? `\\medskip${text('Application to', 'en')} ${text(payload.target.company, /[\u0600-\u06ff]/u.test(payload.target.company) ? 'ar' : 'en')} --- ${text(payload.target.role, /[\u0600-\u06ff]/u.test(payload.target.role) ? 'ar' : 'en')}\\par` : ''}
${payload.items
  .map(
    (item) => `\\bigskip
{\\large ${text(item.school, item.locale)}}\\par
${text(item.degree, item.locale)}\\par
${text(`${item.startDate} — ${item.endDate ?? ''}`, 'en')}\\par
${text(item.description, item.locale)}\\par
${item.schoolUrl ? text(item.schoolUrl, 'en') : ''}`,
  )
  .join('\n')}
\\end{document}
`;
}
