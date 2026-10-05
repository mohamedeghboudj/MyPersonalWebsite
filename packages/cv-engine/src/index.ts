import {
  cvTargetSchema,
  localeSchema,
  snapshotSchema,
  type Locale,
} from '@platform/schema';
import { resolveTranslation } from '@platform/database';
import { sha256 } from '@platform/config';

export const templateVersion = 'reference-1';
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
    profileHeading: summary.profileHeading,
    educationHeading: summary.educationHeading,
    presentLabel: summary.presentLabel,
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
    .map((part) => {
      if (!/^[A-Za-z0-9]/u.test(part)) return escapeLatex(part);
      // Keep boundary whitespace in the Arabic paragraph. Polyglossia can
      // otherwise swallow it inside the isolated English run.
      const run = part.trimEnd();
      return `\\textenglish{${escapeLatex(run)}}${part.slice(run.length)}`;
    })
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
    if (source !== payload.locale)
      return `\\text${source === 'fr' ? 'french' : 'english'}{${escapeLatex(value)}}`;
    return escapeLatex(value);
  };
  const rtl = payload.locale === 'ar';
  const french = payload.locale === 'fr';
  return `\\documentclass[10pt,a4paper]{article}
\\usepackage[a4paper,left=${french ? '15' : '17'}mm,right=${french ? '15' : '17'}mm,top=${french ? '9.5' : '11'}mm,bottom=${french ? '9.5' : '11'}mm]{geometry}
\\usepackage{fontspec}
\\usepackage{xcolor}
\\usepackage{enumitem}
\\usepackage{needspace}
\\usepackage{microtype}
\\usepackage{polyglossia}
\\setdefaultlanguage{${language}}
\\setotherlanguages{${['english', 'french', 'arabic'].filter((item) => item !== language).join(',')}}
\\setmainfont{Poppins}[Path=./fonts/,Extension=.ttf,UprightFont=*-Regular,BoldFont=*-Bold,ItalicFont=*-Italic,BoldItalicFont=*-BoldItalic]
\\newfontfamily\\arabicfont[Script=Arabic]{Amiri}
\\newfontfamily\\englishfont{Poppins}[Path=./fonts/,Extension=.ttf,UprightFont=*-Regular,BoldFont=*-Bold,ItalicFont=*-Italic,BoldItalicFont=*-BoldItalic]
\\newfontfamily\\frenchfont{Poppins}[Path=./fonts/,Extension=.ttf,UprightFont=*-Regular,BoldFont=*-Bold,ItalicFont=*-Italic,BoldItalicFont=*-BoldItalic]
\\newfontfamily\\cvmedium{Poppins-Medium.ttf}[Path=./fonts/]
\\newfontfamily\\cvlight{Poppins-Light.ttf}[Path=./fonts/]
\\definecolor{ink}{HTML}{1A1A1A}
\\definecolor{slate}{HTML}{4D4D4D}
\\definecolor{hairline}{HTML}{B3B3B3}
\\color{ink}
\\newcommand{\\cvsection}[1]{\\par\\needspace{5\\baselineskip}\\vspace{${french ? '5' : '7'}pt}{\\bfseries\\fontsize{${rtl ? '13' : '11.3'}}{15}\\selectfont #1}\\par\\vspace{2pt}{\\color{hairline}\\hrule height 0.8pt}\\vspace{4pt}}
\\newcommand{\\cventry}[3]{\\par\\needspace{4\\baselineskip}\\noindent\\parbox[t]{0.74\\linewidth}{{${rtl ? '\\bfseries' : '\\cvmedium'}\\fontsize{${rtl ? '11.5' : '9.9'}}{${rtl ? '15' : '12'}}\\selectfont #1}\\par{\\color{slate}\\fontsize{${rtl ? '11' : '9.3'}}{${rtl ? '15' : '11.8'}}\\selectfont #2}}\\hfill\\parbox[t]{0.23\\linewidth}{${rtl ? '\\raggedright' : '\\raggedleft'}\\color{slate}\\fontsize{${rtl ? '10.5' : '8.7'}}{13}\\selectfont #3}\\par\\vspace{2pt}}
\\newenvironment{tightitemize}{\\begin{itemize}[leftmargin=11pt,itemsep=${french ? '0' : '0.5'}pt,topsep=2pt,parsep=0pt,partopsep=0pt]}{\\end{itemize}}
\\newcommand{\\skillrow}[2]{\\noindent{\\bfseries #1${french ? '~' : ''}: }#2\\par\\vspace{2pt}}
\\pagestyle{empty}
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{0pt}
\\emergencystretch=1.2em
\\begin{document}
\\fontsize{${rtl ? '11.2' : french ? '9.3' : '9.4'}}{${rtl ? '15.4' : french ? '12' : '12.5'}}\\selectfont
\\begin{center}
{\\bfseries\\fontsize{20}{23}\\selectfont ${text(payload.name, 'en')}}\\par\\vspace{3pt}
{\\color{slate}\\fontsize{${rtl ? '12' : '10.3'}}{15}\\selectfont ${text(payload.headline, payload.headlineLocale)}}\\par
\\end{center}
\\cvsection{${text(payload.profileHeading, payload.summaryLocale)}}
${text(payload.summary, payload.summaryLocale)}\\par
${payload.target ? `\\medskip${text('Application to', 'en')} ${text(payload.target.company, /[\u0600-\u06ff]/u.test(payload.target.company) ? 'ar' : 'en')} --- ${text(payload.target.role, /[\u0600-\u06ff]/u.test(payload.target.role) ? 'ar' : 'en')}\\par` : ''}
${payload.items.length ? `\\cvsection{${text(payload.educationHeading, payload.summaryLocale)}}` : ''}
${payload.items
  .map(
    (
      item,
    ) => `\\cventry{${text(item.degree, item.locale)}}{${text(item.school, item.locale)}}{${text(item.startDate, 'en')} --- ${item.endDate ? text(item.endDate, 'en') : text(payload.presentLabel, payload.summaryLocale)}}
${text(item.description, item.locale)}\\par
${item.schoolUrl ? text(item.schoolUrl, 'en') + '\\par' : ''}\\vspace{3pt}`,
  )
  .join('\n')}
\\end{document}
`;
}
