CREATE TABLE IF NOT EXISTS update_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS one_default_update_group
    ON update_groups ((is_default))
    WHERE is_default = true;

CREATE TABLE IF NOT EXISTS update_group_members (
    update_group_id UUID NOT NULL REFERENCES update_groups(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (update_group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_update_group_members_user_id
    ON update_group_members(user_id);

INSERT INTO update_groups (name, is_default)
VALUES ('production', true)
ON CONFLICT (name) DO NOTHING;

ALTER TABLE releases
    ADD COLUMN IF NOT EXISTS update_group_id UUID REFERENCES update_groups(id);

UPDATE releases
SET update_group_id = (SELECT id FROM update_groups WHERE is_default = true)
WHERE update_group_id IS NULL;

ALTER TABLE releases
    ALTER COLUMN update_group_id SET NOT NULL;
