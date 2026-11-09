# Changelog

## 1.3.3
- Device-list flag is absolutely positioned inside the IP link: it no longer changes cell width or shifts the centered IP text.
- Added an immediate MutationObserver on #xdevices: new rows are decorated before paint, not after a debounce.
- Browser cache and throttled fallback decoration are retained.
- New or changed IPs are still looked up separately and cached.

## 1.3.2
- Browser-side localStorage cache for immediate flags after page load and row re-renders.
- Fixed badges disappearing when list rows are re-created.
- Throttled scroll/DOM decoration (80-100 ms).
- Faster device-card refresh.

## 1.3.1
- Repository cleanup and publication preparation.
- MIT license, English and Russian documentation.
- Cleaned flag set (ISO 3166-1 alpha-2 only) and removed development artifacts.
- No functional changes.

## 1.3.0
- Instant custom tooltip; no native title delay.
- Batch prefetch of visible IPs through ip-api.com/batch.
- Batch results cached for 7 days; visible-only lazy loading retained.
- Fallback to individual lookups for non-ip-api providers.

## 1.2.0
- Prefetch only visible device rows (viewport + 200px margin).
- Lazy loading on scroll, resize, focus and tab return.
- Prevents thousands of external lookups on large device lists.

## 1.1.1
- Fixed native hover tooltip.
- Provider fallback: ISP, organization, ASN organization.
- Image alt text includes the provider name.

## 1.1.0
- Bundled local SVG country flags (flag-icons, MIT).
- Flags served by the plugin under /plugin/ipgeo/flags/.
- Subpath deployment support; emoji fallback.

## 1.0.1
- Compact country-flag badge; provider shown on hover.

## 1.0.0
- Initial release.
