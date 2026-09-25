PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS forum_members (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  invite_hash TEXT UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS forum_members_display_name ON forum_members(display_name COLLATE NOCASE) WHERE display_name IS NOT NULL;

CREATE TABLE IF NOT EXISTS forum_invites (
  code_hash TEXT PRIMARY KEY,
  created_by TEXT NOT NULL REFERENCES forum_members(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS forum_sessions (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES forum_members(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS forum_sessions_member ON forum_sessions(member_id);

CREATE TABLE IF NOT EXISTS forum_password_resets (
  member_id TEXT PRIMARY KEY REFERENCES forum_members(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES forum_members(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS forum_password_resets_expiry ON forum_password_resets(expires_at);

CREATE TABLE IF NOT EXISTS forum_topics (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES forum_members(id),
  category TEXT NOT NULL CHECK (category IN ('notice', 'technology', 'discussion')),
  discussion_section TEXT CHECK (discussion_section IN ('academic', 'entertainment', 'general') OR discussion_section IS NULL),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  is_locked INTEGER NOT NULL DEFAULT 0,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_featured INTEGER NOT NULL DEFAULT 0,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS forum_topics_feed ON forum_topics(is_hidden, updated_at DESC);
CREATE INDEX IF NOT EXISTS forum_topics_category ON forum_topics(category, is_hidden, updated_at DESC);
CREATE INDEX IF NOT EXISTS forum_topics_pinned_feed ON forum_topics(is_hidden, is_pinned DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS forum_topics_pinned_category ON forum_topics(category, is_hidden, is_pinned DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS forum_topics_section ON forum_topics(category, discussion_section, is_hidden, created_at DESC);
CREATE INDEX IF NOT EXISTS forum_topics_featured_feed ON forum_topics(is_hidden, is_featured DESC, is_pinned DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS forum_topic_likes (
  topic_id TEXT NOT NULL REFERENCES forum_topics(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES forum_members(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (topic_id, member_id)
);
CREATE INDEX IF NOT EXISTS forum_topic_likes_member ON forum_topic_likes(member_id);

CREATE TABLE IF NOT EXISTS forum_replies (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES forum_topics(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES forum_members(id),
  body TEXT NOT NULL,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS forum_replies_topic ON forum_replies(topic_id, is_hidden, created_at);

CREATE TABLE IF NOT EXISTS forum_reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES forum_members(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('topic', 'reply')),
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS forum_reports_open ON forum_reports(resolved_at, created_at DESC);

CREATE TABLE IF NOT EXISTS forum_login_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
