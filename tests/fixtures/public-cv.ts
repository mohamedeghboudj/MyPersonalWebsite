import {
  locales,
  publicSnapshotSchema,
  type PublicSnapshot,
} from '@platform/schema';

// Shared by unit tests and the secret-free Actions compile proof. Every record
// is invented test content, never imported from the owner's TeX references.
export function publicCvFixture(baseline: PublicSnapshot): PublicSnapshot {
  const snapshot = structuredClone(baseline);
  const tr = <T extends Record<string, [string, string, string]>>(fields: T) =>
    locales.map((locale, index) => ({
      locale,
      ...(Object.fromEntries(
        Object.entries(fields).map(([key, values]) => [key, values[index]]),
      ) as { [K in keyof T]: string }),
    }));
  const dated = { startDate: '2024-09-01', endDate: null, displayOrder: 0 };
  snapshot.profile = {
    fullName: 'Synthetic CV Candidate',
    city: null,
    country: null,
    portraitMediaId: null,
    translations: tr({
      headline: [
        'A synthetic multilingual CV',
        'Un CV multilingue fictif',
        'سيرة ذاتية تجريبية متعددة اللغات',
      ],
      bio: ['', '', ''],
    }),
    contacts: [
      { kind: 'email', value: 'candidate@example.com', displayOrder: 0 },
    ],
  };
  snapshot.education = [
    {
      ...dated,
      id: 11,
      city: null,
      country: null,
      logoMediaId: null,
      schoolUrl: 'https://example.com/education',
      translations: tr({
        school: ['Example institute', 'Institut fictif', 'معهد تجريبي'],
        degree: ['Example qualification', 'Diplôme fictif', 'مؤهل تجريبي'],
        field: ['Computer science', 'Informatique', 'علوم الحاسوب'],
        status: ['', '', ''],
        description: [
          'Synthetic coursework, not a real qualification.',
          'Formation fictive, sans qualification réelle.',
          'دراسة تجريبية وليست مؤهلاً حقيقياً.',
        ],
      }),
    },
  ];
  snapshot.experience = [
    {
      ...dated,
      id: 12,
      city: null,
      country: null,
      employmentType: null,
      logoMediaId: null,
      organizationUrl: null,
      translations: tr({
        organization: ['Example studio', 'Studio fictif', 'استوديو تجريبي'],
        role: [
          'Prototype engineer',
          'Ingénieur prototypage',
          'مهندس نماذج تجريبية',
        ],
        description: [
          'A synthetic experience entry.',
          'Une expérience fictive.',
          'خبرة عملية تجريبية.',
        ],
      }),
      highlights: [
        {
          position: 0,
          translations: tr({
            body: [
              'Validated the example with 12 checks.',
              'Validation de l’exemple par 12 contrôles.',
              'التحقق من المثال باستخدام 12 اختباراً.',
            ],
          }),
        },
      ],
      links: [],
    },
  ];
  const evidence = tr({
    title: ['Example distinction', 'Distinction fictive', 'تميز تجريبي'],
    issuer: ['Example organization', 'Organisation fictive', 'جهة تجريبية'],
    description: [
      'Test evidence only.',
      'Justificatif de test uniquement.',
      'دليل تجريبي فقط.',
    ],
  });
  snapshot.achievements = [
    {
      id: 13,
      displayOrder: 0,
      achievedOn: '2025-03-01',
      verificationUrl: null,
      mediaId: null,
      // Exercise French-only fallback inside the English and Arabic PDFs too.
      translations: evidence.filter((row) => row.locale === 'fr'),
    },
  ];
  snapshot.certificates = [
    {
      id: 14,
      displayOrder: 0,
      issuedOn: '2025-04-01',
      expiresOn: null,
      credentialReference: null,
      verificationUrl: 'https://example.com/verify?ref=demo&lang=fr',
      publicMediaId: null,
      translations: tr({
        title: ['Example certificate', 'Certificat fictif', 'شهادة تجريبية'],
        issuer: ['Example issuer', 'Organisme fictif', 'جهة إصدار تجريبية'],
        description: ['', '', ''],
      }),
    },
  ];
  snapshot.initiatives = [
    {
      ...dated,
      id: 15,
      websiteUrl: null,
      mediaId: null,
      collaborators: [],
      projectIds: [],
      translations: tr({
        title: ['Shared learning', 'Apprentissage collectif', 'التعلم الجماعي'],
        role: ['Coordinator', 'Coordinateur', 'منسق'],
        description: [
          'Synthetic initiative.',
          'Initiative fictive.',
          'مبادرة تجريبية.',
        ],
        purpose: [
          'Practice sharing knowledge.',
          'Partager les connaissances.',
          'مشاركة المعرفة.',
        ],
        outcomes: [
          'One example workshop.',
          'Un atelier fictif.',
          'ورشة عمل تجريبية.',
        ],
      }),
    },
  ];
  snapshot.skillCategories = [
    {
      id: 1,
      displayOrder: 0,
      slug: 'software',
      translations: tr({ name: ['Software', 'Logiciel', 'البرمجيات'] }),
    },
  ];
  snapshot.skills = [
    {
      id: 16,
      displayOrder: 0,
      categoryId: 1,
      evidence: [],
      translations: tr({
        name: ['TypeScript', 'TypeScript', 'TypeScript'],
        description: [
          'Typed data models.',
          'Modèles de données typés.',
          'نماذج بيانات مع تحديد الأنواع.',
        ],
      }),
    },
  ];
  snapshot.languages = [
    {
      id: 17,
      displayOrder: 0,
      languageCode: 'fr',
      certificateId: null,
      translations: tr({
        name: ['French', 'Français', 'الفرنسية'],
        proficiency: ['Example proficiency', 'Niveau fictif', 'مستوى تجريبي'],
      }),
    },
  ];
  snapshot.projects = [
    {
      ...dated,
      id: 18,
      slug: 'example-atlas',
      coverMediaId: null,
      isFeatured: true,
      categoryIds: [],
      technologyIds: [1],
      images: [],
      links: [],
      translations: tr({
        title: ['Project Atlas', 'Projet Atlas', 'مشروع Atlas'],
        summary: [
          'A synthetic map of example data.',
          'Une carte fictive de données.',
          'خريطة تجريبية لبيانات توضيحية.',
        ],
        body: ['', '', ''],
        role: [
          'Design and implementation',
          'Conception et réalisation',
          'التصميم والتنفيذ',
        ],
        outcomes: [
          'A&B data displayed with 100% test coverage.',
          'Données A&B avec une couverture de test de 100%.',
          'عرض بيانات A&B مع تغطية اختبارات بنسبة 100%.',
        ],
      }),
    },
  ];
  snapshot.technologies = [{ id: 1, name: 'TypeScript', slug: 'typescript' }];
  snapshot.media = [];
  snapshot.publicVariant.translations = tr({
    summary: [
      'Synthetic compile proof covering all public content types.',
      'Preuve de compilation fictive couvrant tous les types de contenu public.',
      'اختبار تجريبي للتجميع يشمل جميع أنواع المحتوى العام.',
    ],
    profileHeading: ['Profile', 'Profil', 'الملف الشخصي'],
    educationHeading: ['Education', 'Formation', 'التعليم'],
    presentLabel: ['Present', 'Aujourd’hui', 'حتى الآن'],
  });
  snapshot.publicVariant.items = (
    [
      ['education', 11, 'education'],
      ['skill', 16, 'skills'],
      ['project', 18, 'projects'],
      ['experience', 12, 'experience'],
      ['achievement', 13, 'achievements'],
      ['certificate', 14, 'certificates'],
      ['language', 17, 'languages'],
      ['initiative', 15, 'initiatives'],
    ] as const
  ).map(([kind, contentItemId, section], position) => ({
    kind,
    contentItemId,
    section,
    position,
    translations: [],
  }));
  return publicSnapshotSchema.parse(snapshot);
}
