import { registerAdapter } from "../integration-adapters";
import { shopifyAdapter } from "./shopify";
import { razorpayAdapter } from "./razorpay";
import { shiprocketAdapter } from "./shiprocket";
import { delhiveryAdapter } from "./delhivery";
import { whatsappAdapter } from "./whatsapp";
import { metaBusinessAdapter, facebookAdapter, instagramAdapter } from "./meta";
import { googleAdsAdapter, googleAnalyticsAdapter, googleBusinessAdapter, gmailAdapter } from "./google";
import { amazonAdapter } from "./amazon";
import { flipkartAdapter } from "./flipkart";
import { zohoAdapter } from "./zoho";
import { shopdeckAdapter } from "./shopdeck";
import { myntraAdapter } from "./myntra";

/**
 * Register all real per-provider adapters.
 * Platforms without an entry here fall back to the honest stub adapter.
 * Call once at server startup (already called from index.ts).
 */
export function registerAdapters(): void {
  // Storefront
  registerAdapter("shopify", shopifyAdapter);
  registerAdapter("shopdeck", shopdeckAdapter);

  // Marketplace
  registerAdapter("amazon", amazonAdapter);
  registerAdapter("flipkart", flipkartAdapter);
  registerAdapter("myntra", myntraAdapter);

  // Social / Messaging
  registerAdapter("meta_business", metaBusinessAdapter);
  registerAdapter("facebook", facebookAdapter);
  registerAdapter("instagram", instagramAdapter);
  registerAdapter("whatsapp", whatsappAdapter);
  registerAdapter("gmail", gmailAdapter);

  // Ads / Analytics
  registerAdapter("google_ads", googleAdsAdapter);
  registerAdapter("google_analytics", googleAnalyticsAdapter);
  registerAdapter("google_business", googleBusinessAdapter);

  // Payments
  registerAdapter("razorpay", razorpayAdapter);

  // Shipping
  registerAdapter("shiprocket", shiprocketAdapter);
  registerAdapter("delhivery", delhiveryAdapter);

  // Accounting
  registerAdapter("zoho", zohoAdapter);
}
