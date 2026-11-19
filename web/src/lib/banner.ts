// Sitewide announcement banner — a single Sanity singleton (same pattern
// as siteSettings/utmeBuilderSettings) so TECHMED can change it — free
// tutorials today, paid tutorials or JAMB/UTME news later — from Studio
// alone. No fallback content: an unreachable Sanity or an unseeded/unset
// document should simply show no banner, never an invented announcement.
import { fetchSanity } from './sanity';

export interface AnnouncementBanner {
  active: boolean;
  message: string;
  /** Purely decorative (the message text already carries the meaning),
   * so it's rendered with alt="" rather than requiring editors to write
   * alt text for a small accompanying icon. */
  iconUrl?: string;
  ctaLabel: string;
  ctaUrl: string;
}

const BANNER_QUERY = `*[_id == "announcementBanner"][0]{
  active,
  message,
  "iconUrl": icon.asset->url,
  ctaLabel,
  ctaUrl,
  startDate,
  endDate
}`;

export async function getAnnouncementBanner(): Promise<AnnouncementBanner | null> {
  const banner = await fetchSanity<(Partial<AnnouncementBanner> & { startDate?: string; endDate?: string }) | null>(BANNER_QUERY, null);
  if (!banner || !banner.active || !banner.message || !banner.ctaLabel || !banner.ctaUrl) return null;
  // Static site: checked at build time. The daily 05:50 rebuild (and every Studio publish) applies the window.
  const now = Date.now();
  if (banner.startDate && Date.parse(banner.startDate) > now) return null;
  if (banner.endDate && Date.parse(banner.endDate) < now) return null;
  return {
    active: true,
    message: banner.message,
    iconUrl: banner.iconUrl,
    ctaLabel: banner.ctaLabel,
    ctaUrl: banner.ctaUrl,
  };
}
