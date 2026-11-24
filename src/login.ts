import { chromium } from "playwright";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

const profile = resolve(".local", "browser-profile");
await mkdir(profile, { recursive: true });
const context = await chromium.launchPersistentContext(profile, { headless: false });
const prompt = createInterface({ input: process.stdin, output: process.stdout });
try {
  console.log("Use the dedicated browser to open the school's approved login page manually.");
  console.log("No credentials are collected, no actions on the site are automated.");
  await prompt.question("When finished, press Enter here to close the browser: ");
} finally {
  prompt.close();
  await context.close();
}
