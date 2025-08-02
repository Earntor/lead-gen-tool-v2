import { scrapeWebsiteData } from './src/lib/scrapeWebsite.js';

(async () => {
  const result = await scrapeWebsiteData("moreketing.nl");
  console.log("🔍 Scrape result:", result);
})();
