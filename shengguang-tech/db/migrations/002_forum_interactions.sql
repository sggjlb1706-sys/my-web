-- Apply once after 001_forum_controls.sql and before deploying the new API.
ALTER TABLE forum_topics ADD COLUMN discussion_section TEXT CHECK (discussion_section IN ('academic', 'entertainment', 'general') OR discussion_section IS NULL);
UPDATE forum_topics SET discussion_section = 'general' WHERE category = 'discussion' AND discussion_section IS NULL;
ALTER TABLE forum_topics ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS forum_topics_section ON forum_topics(category, discussion_section, is_hidden, created_at DESC);
CREATE INDEX IF NOT EXISTS forum_topics_featured_feed ON forum_topics(is_hidden, is_featured DESC, is_pinned DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS forum_topic_likes (
  topic_id TEXT NOT NULL REFERENCES forum_topics(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES forum_members(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (topic_id, member_id)
);
CREATE INDEX IF NOT EXISTS forum_topic_likes_member ON forum_topic_likes(member_id);

CREATE TABLE IF NOT EXISTS forum_password_resets (
  member_id TEXT PRIMARY KEY REFERENCES forum_members(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES forum_members(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS forum_password_resets_expiry ON forum_password_resets(expires_at);
