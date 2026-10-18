-- Comments on shared documents. A thread is a root comment (threadId NULL)
-- plus its replies. The anchor pins the thread to an element of the page.
CREATE TABLE "comment" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "documentId" TEXT NOT NULL REFERENCES "document"("id") ON DELETE CASCADE,
  "threadId" TEXT REFERENCES "comment"("id") ON DELETE CASCADE,
  "authorId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "body" TEXT NOT NULL,
  -- JSON: { pos (Yjs relative position, base64), tag, snippet }. Roots only.
  "anchor" TEXT,
  "resolved" INTEGER NOT NULL DEFAULT 0,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);
CREATE INDEX "comment_document" ON "comment"("documentId", "createdAt");
CREATE INDEX "comment_thread" ON "comment"("threadId");

CREATE TABLE "notification" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  "documentId" TEXT NOT NULL REFERENCES "document"("id") ON DELETE CASCADE,
  "commentId" TEXT NOT NULL REFERENCES "comment"("id") ON DELETE CASCADE,
  "actorId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  -- mention | reply | comment
  "kind" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL,
  "readAt" INTEGER
);
CREATE INDEX "notification_recipient" ON "notification"("recipientEmail", "readAt", "createdAt");
