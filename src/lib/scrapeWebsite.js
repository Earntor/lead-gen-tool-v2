import * as cheerio from 'cheerio';

export async function fetchWebsiteHTML(domain) {
  try {
    const url = domain.startsWith('http') ? domain : `https://${domain}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (LeadGenBot)',
      },
    });

    if (!res.ok) {
      console.error('❌ Fout bij ophalen HTML:', res.status);
      return null;
    }

    return await res.text();
  } catch (err) {
    console.error('❌ Fout bij fetch:', err.message);
    return null;
  }
}

export async function scrapeWebsiteData(domain) {
  const html = await fetchWebsiteHTML(domain);
  if (!html) return null;

  const $ = cheerio.load(html);
  const text = $.text();

  // Verzamel alle hrefs
  const links = $('a[href]')
    .map((_, el) => $(el).attr('href'))
    .get()
    .filter(Boolean);

  // Telefoonnummer via <a href="tel:...">
  const phoneMatch = [...new Set(
    links
      .filter((href) => href.startsWith("tel:"))
      .map((href) => href.replace("tel:", "").replace(/\s+/g, "").trim())
  )];
  const phone = phoneMatch.length > 0 ? phoneMatch[0] : null;

  // E-mailadres via <a href="mailto:...">
  const emailMatch = [...new Set(
    links
      .filter((href) => href.startsWith("mailto:"))
      .map((href) => href.replace("mailto:", "").trim())
  )];
  const email = emailMatch.length > 0 ? emailMatch[0] : null;

  // Social media links
  const findLink = (keyword) =>
    links.find((href) => href?.includes(keyword)) || null;

  const linkedin = findLink('linkedin.com');
  const facebook = findLink('facebook.com');
  const instagram = findLink('instagram.com');
  const twitter = findLink('twitter.com');

  // Meta description
  const metaDescription = $('meta[name="description"]').attr('content') || null;

  return {
    phone,
    email,
    linkedin_url: linkedin,
    facebook_url: facebook,
    instagram_url: instagram,
    twitter_url: twitter,
    meta_description: metaDescription,
  };
}
