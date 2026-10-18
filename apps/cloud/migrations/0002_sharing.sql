-- Shared documents. Only files their owner explicitly shared ever exist here.
CREATE TABLE "document" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "ownerId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "title" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  -- HTML plus assets, counted against the owner's quota.
  "sizeBytes" INTEGER NOT NULL DEFAULT 0,
  -- Bumped whenever content or assets change; clients compare it to pull.
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);
CREATE INDEX "document_owner" ON "document"("ownerId");

-- Access is granted by email so people can be invited before they sign up.
-- Emails are verified at sign-in (email code or Google), so matching is safe.
CREATE TABLE "member" (
  "documentId" TEXT NOT NULL REFERENCES "document"("id") ON DELETE CASCADE,
  "email" TEXT NOT NULL,
  "role" TEXT NOT NULL CHECK ("role" IN ('editor', 'commenter', 'viewer')),
  "invitedBy" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL,
  PRIMARY KEY ("documentId", "email")
);
CREATE INDEX "member_email" ON "member"("email");

-- Files a document uses (CSS, JS, images, data), stored once by content hash in R2.
CREATE TABLE "asset" (
  "documentId" TEXT NOT NULL REFERENCES "document"("id") ON DELETE CASCADE,
  "path" TEXT NOT NULL,
  "hash" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  PRIMARY KEY ("documentId", "path")
);
CREATE INDEX "asset_hash" ON "asset"("hash");
