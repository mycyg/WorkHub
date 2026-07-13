-- R13 批 A2（派人推荐 v2）：user_profiles 加 title（职位/角色头衔）。这张表此前是零接线死表——
-- bioMd/skillsText/skillTags/availabilityPref/onboardedAt 早就在 schema 里，但没有 repository、
-- 没有 service、没有路由、没有 UI。补的第一个真字段可空，历史行（如果有）不受影响。
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "title" varchar(128);
