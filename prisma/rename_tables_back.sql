-- Rename lowercase tables back to PascalCase expected by current Prisma client
ALTER TABLE "project" RENAME TO "Project";
ALTER TABLE "job" RENAME TO "Job";
ALTER TABLE "research_row" RENAME TO "ResearchRow";
ALTER TABLE "ad_asset" RENAME TO "AdAsset";
ALTER TABLE "script" RENAME TO "Script";
ALTER TABLE "storyboard" RENAME TO "Storyboard";
ALTER TABLE "storyboard_scene" RENAME TO "StoryboardScene";
ALTER TABLE "character" RENAME TO "Character";
ALTER TABLE "user" RENAME TO "User";
ALTER TABLE "audit_log" RENAME TO "AuditLog";
ALTER TABLE "subscription" RENAME TO "Subscription";
ALTER TABLE "usage" RENAME TO "Usage";
ALTER TABLE "auth_throttle" RENAME TO "AuthThrottle";
ALTER TABLE "billing_event" RENAME TO "BillingEvent";
ALTER TABLE "ad_pattern_result" RENAME TO "AdPatternResult";
ALTER TABLE "ad_pattern_reference" RENAME TO "AdPatternReference";
ALTER TABLE "customer_avatar" RENAME TO "CustomerAvatar";
ALTER TABLE "product_intelligence" RENAME TO "ProductIntelligence";
-- Note: leave _prisma_migrations as-is
