import { scrapeWebsiteData } from '../src/lib/scrapeWebsite.js';

const test = async () => {
  const result = await scrapeWebsiteData('moreketing.nl');
  console.log('🔎 Resultaat:', result);
};

test();
