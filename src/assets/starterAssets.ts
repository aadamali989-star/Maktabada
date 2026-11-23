import artSuugaantaMaansadaUrl from './images/art_suugaanta_maansada_1795420923125.jpg';
import artTaariikhdaGeeskaUrl from './images/art_taariikhda_geeska_1795420922526.jpg';
import artTignoolajiyadaWebkaUrl from './images/art_tignoolajiyada_webka_1795420923395.jpg';
import artXiddigiskaSoomaaliUrl from './images/art_xiddigiska_soomaali_1795427946263.jpg';
import heroLibrarySanctuaryUrl from './images/hero_library_sanctuary_1795275335858.jpg';

export {
  artSuugaantaMaansadaUrl,
  artTaariikhdaGeeskaUrl,
  artTignoolajiyadaWebkaUrl,
  artXiddigiskaSoomaaliUrl,
  heroLibrarySanctuaryUrl,
};

const BUNDLED_COVER_BY_FILENAME: Record<string, string> = {
  'art_taariikhda_geeska_1795420922526.jpg': artTaariikhdaGeeskaUrl,
  'cover_taariikhda_soomaaliya_1795275336344.jpg': artTaariikhdaGeeskaUrl,
  'art_xiddigiska_soomaali_1795427946263.jpg': artXiddigiskaSoomaaliUrl,
  'art_xiddigiska_dhaqanka_1795420923302.jpg': artXiddigiskaSoomaaliUrl,
  'cover_sayniska_xiddigiska_1795275336746.jpg': artXiddigiskaSoomaaliUrl,
  'art_suugaanta_maansada_1795420923125.jpg': artSuugaantaMaansadaUrl,
  'cover_suugaanta_soomaaliyeed_1795275336487.jpg': artSuugaantaMaansadaUrl,
  'art_tignoolajiyada_webka_1795420923395.jpg': artTignoolajiyadaWebkaUrl,
  'cover_tignoolajiyada_casriga_1795275335465.jpg': artTignoolajiyadaWebkaUrl,
  'hero_library_sanctuary_1795275335858.jpg': heroLibrarySanctuaryUrl,
};

export function resolveBundledStarterAsset(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  const cleanNoQuery = trimmed.split('?')[0].split('#')[0];
  const fileName = cleanNoQuery.split('/').pop() || '';
  if (fileName && BUNDLED_COVER_BY_FILENAME[fileName]) {
    return BUNDLED_COVER_BY_FILENAME[fileName];
  }

  return null;
}
