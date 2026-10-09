import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  capturePublicSnapshot,
  saveEditor,
  editorOverview,
} from '@platform/database';
import {
  editorRegistry,
  emptyEditorRecord,
  type EditorRecord,
} from '@platform/schema';
import { localDatabase, migrateTestDatabase } from './local-database.ts';

// Ephemeral and explicitly synthetic. Never reads the owner's private CV or
// remote data and never mutates the captured publish artifacts.
const local = await localDatabase();
try {
  await migrateTestDatabase(local.content, local.inbox);
  async function save(key: string, fields: EditorRecord) {
    const module = editorRegistry.get(key)!;
    return saveEditor(
      local.content,
      key,
      module.singleton ? 1 : null,
      { ...emptyEditorRecord(module), ...fields },
      (await editorOverview(local.content)).revision,
      'synthetic-preview',
    );
  }
  const translated = (en: EditorRecord, fr: EditorRecord, ar: EditorRecord) => [
    { locale: 'en', ...en },
    { locale: 'fr', ...fr },
    { locale: 'ar', ...ar },
  ];
  await save('profile', {
    fullName: 'MOHAMED CHARAF EDDINE DEGHBOUDJ',
    city: '',
    country: '',
    translations: translated(
      {
        headline: 'Ideas, made tangible.',
        bio: 'Synthetic design preview. Explore example projects across software, research and community. Replace this content through the private console.',
      },
      {
        headline: 'Des idées qui prennent forme.',
        bio: 'Aperçu de conception avec des données fictives. Explorez des exemples de projets en logiciel, recherche et engagement collectif.',
      },
      {
        headline: 'أفكار تتحول إلى واقع.',
        bio: 'معاينة تصميم ببيانات تجريبية. استكشف أمثلة لمشاريع في البرمجيات والبحث والمبادرات المجتمعية.',
      },
    ),
    contacts: [
      {
        kind: 'email',
        value: 'preview@example.com',
        isPublic: true,
        displayOrder: 0,
      },
    ],
  });
  await save('siteSettings', {
    brandName: 'mohamedeghboudj',
    theme: 'light',
    contactEnabled: false,
    defaultLocale: 'en',
    translations: translated(
      {
        availability: 'Design preview · synthetic content',
        footerText:
          'A private design study. The projects and descriptions in this preview are examples.',
      },
      {
        availability: 'Aperçu · contenu fictif',
        footerText:
          'Étude de conception. Les projets et descriptions présentés sont des exemples.',
      },
      {
        availability: 'معاينة تصميم · بيانات تجريبية',
        footerText:
          'دراسة تصميم. المشاريع والأوصاف في هذه المعاينة أمثلة تجريبية.',
      },
    ),
  });
  for (const [position, path, en, fr, ar] of [
    [0, '/about/', 'About', 'À propos', 'نبذة عني'],
    [1, '/projects/', 'Projects', 'Projets', 'المشاريع'],
    [2, '/contact/', 'Contact', 'Contact', 'تواصل'],
  ] as const)
    await save('navigation', {
      path,
      displayOrder: position,
      isVisible: true,
      translations: translated({ label: en }, { label: fr }, { label: ar }),
    });
  const categoryIds: number[] = [];
  for (const [position, slug, en, fr, ar] of [
    [0, 'software', 'Software', 'Logiciel', 'البرمجيات'],
    [1, 'research', 'Research', 'Recherche', 'البحث'],
    [2, 'community', 'Community', 'Communauté', 'المجتمع'],
  ] as const) {
    const result = await save('projectCategories', {
      slug,
      displayOrder: position,
      isVisible: true,
      translations: translated(
        {
          name: en,
          description: 'A collection of synthetic project examples.',
        },
        { name: fr, description: 'Une sélection de projets fictifs.' },
        { name: ar, description: 'مجموعة من أمثلة المشاريع التجريبية.' },
      ),
    });
    categoryIds.push(result.id);
  }
  const technology = await save('technologies', {
    name: 'TypeScript',
    slug: 'typescript',
  });
  for (const [position, slug, title, summary, frTitle, arTitle] of [
    [
      0,
      'field-notes',
      'Field notes',
      'A quieter way to organize a growing body of knowledge.',
      'Notes de terrain',
      'ملاحظات ميدانية',
    ],
    [
      1,
      'open-atlas',
      'Open atlas',
      'Making a complex dataset easier to explore and understand.',
      'Atlas ouvert',
      'أطلس مفتوح',
    ],
    [
      2,
      'common-ground',
      'Common ground',
      'A shared space for people to turn an idea into a useful initiative.',
      'Terrain commun',
      'أرضية مشتركة',
    ],
    [
      3,
      'small-systems',
      'Small systems',
      'Testing the details that make an everyday tool dependable.',
      'Petits systèmes',
      'أنظمة صغيرة',
    ],
  ] as const) {
    const body =
      'This is a synthetic case study for reviewing the public template. It does not describe a real project or make claims about the owner.\n\nThe page gives the work room to explain itself: context first, then the decisions, evidence and outcomes.';
    const translations = translated(
      {
        title,
        summary,
        body,
        role: 'Design and implementation · example',
        outcomes:
          'Example outcome text. Real results will be entered by the owner.',
      },
      {
        title: frTitle,
        summary: 'Un exemple fictif pour explorer la présentation du projet.',
        body: 'Cette étude de cas est fictive et sert uniquement à examiner la mise en page.\n\nLe contexte, les décisions et les résultats sont gérés dans la console.',
        role: 'Conception et réalisation · exemple',
        outcomes: 'Les résultats réels seront renseignés par le propriétaire.',
      },
      {
        title: arTitle,
        summary: 'مثال تجريبي لاستكشاف طريقة عرض المشروع.',
        body: 'دراسة حالة تجريبية لمراجعة التصميم، ولا تصف مشروعًا حقيقيًا.\n\nتُدار تفاصيل السياق والقرارات والنتائج من لوحة التحكم.',
        role: 'التصميم والتنفيذ · مثال',
        outcomes: 'سيضيف صاحب الموقع النتائج الفعلية من لوحة التحكم.',
      },
    );
    await save('projects', {
      slug,
      startDate: '2026-01-01',
      endDate: null,
      displayOrder: position,
      isVisible: true,
      isFeatured: position < 2,
      translations: position === 3 ? translations.slice(0, 1) : translations,
      categories: [
        { categoryId: categoryIds[position % 3] },
        ...(position === 1 ? [{ categoryId: categoryIds[0] }] : []),
      ],
      technologies: [{ technologyId: technology.id }],
      links: [
        {
          kind: 'repo',
          url: 'https://example.com/source',
          position: 0,
          translations: [{ locale: 'en', label: 'Example source reference' }],
        },
      ],
    });
  }
  await save('education', {
    startDate: '2022-09-01',
    endDate: null,
    isVisible: true,
    displayOrder: 0,
    translations: translated(
      {
        school: 'Example institution',
        degree: 'Learning through practice',
        field: 'Synthetic programme',
        status: 'In progress · example',
        description:
          'A synthetic education record, used to review chronology and translation fallback.',
      },
      {
        school: 'Établissement fictif',
        degree: 'Apprendre par la pratique',
        field: 'Programme fictif',
        status: 'En cours · exemple',
        description:
          'Un parcours fictif pour vérifier la chronologie et la présentation.',
      },
      {
        school: 'مؤسسة تجريبية',
        degree: 'التعلم بالممارسة',
        field: 'برنامج تجريبي',
        status: 'مستمر · مثال',
        description: 'سجل تعليمي تجريبي لمراجعة التسلسل الزمني وطريقة العرض.',
      },
    ),
  });
  await save('experience', {
    startDate: '2025-06-01',
    endDate: '2025-09-01',
    isVisible: true,
    displayOrder: 0,
    translations: translated(
      {
        organization: 'Example studio',
        role: 'From a question to a working prototype',
        description:
          'Synthetic experience, shown only to evaluate the template.',
      },
      {
        organization: 'Studio fictif',
        role: 'D’une question à un prototype',
        description: 'Expérience fictive destinée à examiner la mise en page.',
      },
      {
        organization: 'استوديو تجريبي',
        role: 'من سؤال إلى نموذج عملي',
        description: 'خبرة تجريبية لمراجعة تصميم الصفحة.',
      },
    ),
  });
  const path = resolve('artifacts/public-preview/snapshot.json');
  await mkdir(resolve('artifacts/public-preview'), { recursive: true });
  await writeFile(
    path,
    JSON.stringify(await capturePublicSnapshot(local.content), null, 2),
  );
  console.log(
    'Synthetic public snapshot prepared. No remote data or credentials used.',
  );
} finally {
  await local.runtime.dispose();
}
const require = createRequire(import.meta.url);
const result = spawnSync(
  process.execPath,
  [
    resolve(dirname(require.resolve('astro/package.json')), 'bin/astro.mjs'),
    'build',
  ],
  {
    cwd: resolve('apps/site'),
    stdio: 'inherit',
    env: {
      ...process.env,
      SITE_SNAPSHOT_PATH: resolve('artifacts/public-preview/snapshot.json'),
      SITE_MODE: 'preview',
      SITE_ORIGIN: 'http://127.0.0.1:4321',
    },
  },
);
if (result.status !== 0) throw new Error('Public preview build failed');
