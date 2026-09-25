-- Apply once to an existing production D1 database before deploying the new API.
ALTER TABLE forum_members ADD COLUMN display_name TEXT;
UPDATE forum_members SET display_name = username WHERE display_name IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS forum_members_display_name ON forum_members(display_name COLLATE NOCASE) WHERE display_name IS NOT NULL;

ALTER TABLE forum_topics ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS forum_topics_pinned_feed ON forum_topics(is_hidden, is_pinned DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS forum_topics_pinned_category ON forum_topics(category, is_hidden, is_pinned DESC, updated_at DESC);
