import { educationInputSchema } from '@platform/schema';

// Synthetic test data, deliberately labeled as a technical proof. Never import
// the owner's existing CV as though its facts had already been verified.
export const spikeEducation = educationInputSchema.parse({
  startDate: '2026-01-01',
  endDate: null,
  schoolUrl: 'https://example.com',
  isVisible: true,
  displayOrder: 0,
  translations: [
    {
      locale: 'en',
      school: 'Sprint 0 test institution',
      degree: 'Technical verification',
      description:
        'Synthetic content: Project Atlas & TypeScript — 100% test data.',
    },
    {
      locale: 'fr',
      school: 'Établissement de test Sprint 0',
      degree: 'Vérification technique',
      description:
        'Données de test : fiabilité, études, ingénierie et résultats mesurés.',
    },
    {
      locale: 'ar',
      school: 'مؤسسة اختبار تقني',
      degree: 'اختبار إنشاء السيرة الذاتية',
      description:
        'بيانات تجريبية لاختبار اللغة العربية مع Project Atlas و TypeScript والتحقق من اتصال الحروف واتجاه النص.',
    },
  ],
});
