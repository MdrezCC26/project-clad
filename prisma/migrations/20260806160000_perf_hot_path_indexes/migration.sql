-- Indexes for query shapes that previously fell back to sequential scans or unindexed sorts.
-- All are additive; no columns or data change.

-- Offline Admin token resolution runs on storefront proxy requests. Session had no indexes at all.
CREATE INDEX IF NOT EXISTS "Session_shop_isOnline_idx" ON "Session"("shop", "isOnline");

-- Project lists scope by shop and sort newest-first.
CREATE INDEX IF NOT EXISTS "Project_shop_createdAt_idx" ON "Project"("shop", "createdAt");

-- Order queues, order tabs, exports and Mission Control filter on lifecycle status and sort by a timestamp.
CREATE INDEX IF NOT EXISTS "Job_orderLifecycleStatus_createdAt_idx" ON "Job"("orderLifecycleStatus", "createdAt");
CREATE INDEX IF NOT EXISTS "Job_orderLifecycleStatus_paidAt_idx" ON "Job"("orderLifecycleStatus", "paidAt");
CREATE INDEX IF NOT EXISTS "Job_createdAt_idx" ON "Job"("createdAt");
CREATE INDEX IF NOT EXISTS "Job_completedAt_idx" ON "Job"("completedAt");

-- Mission Control sync selects jobs whose phases changed since a cutoff.
CREATE INDEX IF NOT EXISTS "JobDeliveryPhase_updatedAt_idx" ON "JobDeliveryPhase"("updatedAt");

-- Timeline reads page by project + createdAt; notification and export lookups key on job + type.
CREATE INDEX IF NOT EXISTS "ProjectActivityEvent_projectId_createdAt_idx" ON "ProjectActivityEvent"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProjectActivityEvent_projectId_type_idx" ON "ProjectActivityEvent"("projectId", "type");
CREATE INDEX IF NOT EXISTS "ProjectActivityEvent_jobId_type_idx" ON "ProjectActivityEvent"("jobId", "type");

-- Comment feed pages by project + createdAt.
CREATE INDEX IF NOT EXISTS "ProjectComment_projectId_createdAt_idx" ON "ProjectComment"("projectId", "createdAt");

-- Pending-approval scans filter by project + approvedAt; work orders look up by job alone.
CREATE INDEX IF NOT EXISTS "ApprovalRequest_projectId_approvedAt_idx" ON "ApprovalRequest"("projectId", "approvedAt");
CREATE INDEX IF NOT EXISTS "ApprovalRequest_jobId_idx" ON "ApprovalRequest"("jobId");
