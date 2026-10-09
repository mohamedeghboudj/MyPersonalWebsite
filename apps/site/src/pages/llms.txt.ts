import { readSnapshot, resolveTranslation, absoluteUrl } from '../lib/content';
export async function GET() {
  const snapshot = await readSnapshot();
  const profile = resolveTranslation(snapshot.profile.translations, 'en');
  return new Response(
    `# ${snapshot.profile.fullName}\n\n${profile.headline}\n\n${absoluteUrl('/')}\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
