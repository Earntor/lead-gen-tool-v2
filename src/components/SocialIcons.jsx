import * as SI from "react-icons/si";

/**
 * SocialIcons
 * - Toont social-icoontjes horizontaal (LinkedIn/Facebook/Instagram/X).
 * - Elke knop is een ronde klikbare link (grote tap-target, 36x36).
 * - URLs zonder protocol krijgen automatisch https://
 *
 * Props:
 *  - urls: { linkedin_url?, facebook_url?, instagram_url?, twitter_url? }
 *  - size: icoongrootte in px (default 18)
 *  - className: extra Tailwind classes voor de wrapper
 */
export default function SocialIcons({ urls = {}, size = 18, className = "" }) {
  const TwitterIcon = SI.SiX || SI.SiTwitter; // veilig: X of oude Twitter
  const items = [
    { key: "linkedin_url",  label: "LinkedIn",  Icon: SI.SiLinkedin },
    { key: "facebook_url",  label: "Facebook",  Icon: SI.SiFacebook },
    { key: "instagram_url", label: "Instagram", Icon: SI.SiInstagram },
    { key: "twitter_url",   label: "X (Twitter)", Icon: TwitterIcon },
  ]
    .filter(Boolean)
    .map(({ key, label, Icon }) => {
      const href = normalizeHttps(urls[key]);
      return href ? { href, label, Icon } : null;
    })
    .filter(Boolean);

  if (items.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {items.map(({ href, label, Icon }, idx) => (
        <a
          key={idx}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${label} in nieuw tabblad`}
          title={label}
          className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-gray-200 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
        >
          <Icon size={size} className="text-gray-700" />
        </a>
      ))}
    </div>
  );
}

function normalizeHttps(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // vang 'linkedin.com/...' of 'x.com/...' op
  return `https://${trimmed.replace(/^\/+/, "")}`;
}
