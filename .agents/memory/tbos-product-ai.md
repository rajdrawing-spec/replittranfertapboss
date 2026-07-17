---
name: TBOS Product AI module
description: Lessons and constraints for the TBOS product/inventory AI module (e-commerce catalog, image analysis, SKU, health score, bulk import).
---

- Startup migrations must create the product AI tables (`product_images`, `product_variants`, `product_ai_metadata`, `product_import_jobs`, `product_marketplace_templates`) with `CREATE TABLE IF NOT EXISTS`, not just alter existing columns. Dev and prod Supabase databases may lag behind the drizzle schema, so the app must self-heal on every restart.
- Reuse the existing `@workspace/integrations-gemini-ai` provider and `ObjectStorageService` for image uploads; do not invent a separate AI pipeline.
- Sharp is externalized in `api-server/build.mjs` so image resize operations work without extra build configuration.
- Multi-image analysis sends one Gemini user content with multiple `inlineData` parts. Pass the parts array as `any` to avoid SDK type friction with the `role` field.
- Image resize/background-removal flows upload a new object via `getObjectEntityUploadURL()`, then use `storage.normalizeObjectEntityPath(uploadUrl)` to obtain the correct `/objects/...` path for the database.
- Background removal requires a remove.bg API key configured as `remove_bg_api_key` in `ai_config` or via `REMOVE_BG_API_KEY` env.
