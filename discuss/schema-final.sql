-- ===========================================================
-- julianjocque.com/discuss
-- SQLite 3.x — forum schema
-- ===========================================================
--
-- Set these pragmas at every connection open in Java:
--
--   PRAGMA journal_mode = WAL;
--   PRAGMA foreign_keys = ON;
--   PRAGMA busy_timeout = 5000;
--   PRAGMA synchronous = NORMAL;
--

CREATE TABLE posts (
    id          INTEGER PRIMARY KEY,

    -- Threading via materialized path.
    -- Each post gets a zero-padded 4-digit segment appended to its parent's path.
    -- Top-level post: "0001". First reply: "0001.0001". Reply to that: "0001.0001.0001".
    -- Sorting by path gives depth-first thread order with a plain ORDER BY.
    -- Max depth 4 = max 19 chars. 9999 children per node.
    -- Replies at max depth flatten into the parent's level (Tildes-style).
    --
    -- Thread listing is paginated (classic page numbers, no infinite scroll).
    -- Individual threads render all comments in full, no pagination.
    parent_id   INTEGER     REFERENCES posts(id) ON DELETE CASCADE,
    path        VARCHAR(19) NOT NULL,

    -- content
    url         VARCHAR(512),                   -- utf-8 allowed, only field exempt from ascii
    title       VARCHAR(128),                   -- required on top-level, null on replies
    body        VARCHAR(4096) NOT NULL,

    -- identity
    author      VARCHAR(32)  NOT NULL DEFAULT 'anon',
    color1      CHAR(7),                        -- gradient start, e.g. #4a8a6e
    color2      CHAR(7),                        -- gradient end, e.g. #c4a24e
    ip          VARCHAR(45)  NOT NULL,           -- ipv4 or ipv6

    -- timestamps (unix epoch seconds)
    created_at  INTEGER      NOT NULL,

    -- moderation
    state       VARCHAR(10)  NOT NULL DEFAULT 'queued',
    mod_reason  VARCHAR(256),                   -- visible to users on removed posts

    -- display
    pinned      INTEGER      NOT NULL DEFAULT 0,
    pin_order   INTEGER,                        -- ordering among pinned posts, lower = first
    weight      INTEGER      NOT NULL DEFAULT 0, -- manual ordering for non-pinned, higher = higher

    -- -------------------------------------------------------
    -- CONSTRAINTS
    -- -------------------------------------------------------

    -- path: 1-4 segments of exactly 4 digits separated by dots
    CONSTRAINT chk_path_format
        CHECK (path GLOB '[0-9][0-9][0-9][0-9]'
            OR path GLOB '[0-9][0-9][0-9][0-9].[0-9][0-9][0-9][0-9]'
            OR path GLOB '[0-9][0-9][0-9][0-9].[0-9][0-9][0-9][0-9].[0-9][0-9][0-9][0-9]'
            OR path GLOB '[0-9][0-9][0-9][0-9].[0-9][0-9][0-9][0-9].[0-9][0-9][0-9][0-9].[0-9][0-9][0-9][0-9]'),

    -- colors: lowercase hex or null; both must be set or both null
    CONSTRAINT chk_color1_format
        CHECK (color1 IS NULL
            OR color1 GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
    CONSTRAINT chk_color2_format
        CHECK (color2 IS NULL
            OR color2 GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
    CONSTRAINT chk_colors_paired
        CHECK ((color1 IS NULL AND color2 IS NULL)
            OR (color1 IS NOT NULL AND color2 IS NOT NULL)),

    -- ascii: author is printable ascii, no whitespace (!-~)
    CONSTRAINT chk_author_ascii
        CHECK (author NOT GLOB '*[^!-~]*'),
    -- ascii: body is printable ascii + newline
    CONSTRAINT chk_body_ascii
        CHECK (body NOT GLOB '*[^ -~' || X'0A' || ']*'),
    -- ascii: title is printable ascii, no newlines
    CONSTRAINT chk_title_ascii
        CHECK (title IS NULL
            OR title NOT GLOB '*[^ -~]*'),
    -- ascii: mod_reason is printable ascii, no newlines
    CONSTRAINT chk_mod_reason_ascii
        CHECK (mod_reason IS NULL
            OR mod_reason NOT GLOB '*[^ -~]*'),

    -- content: no empty strings after trimming
    CONSTRAINT chk_body_nonempty
        CHECK (LENGTH(TRIM(body)) > 0),
    CONSTRAINT chk_title_nonempty_when_present
        CHECK (title IS NULL OR LENGTH(TRIM(title)) > 0),
    CONSTRAINT chk_url_nonempty_when_present
        CHECK (url IS NULL OR LENGTH(TRIM(url)) > 0),
    CONSTRAINT chk_author_nonempty
        CHECK (LENGTH(TRIM(author)) > 0),

    -- structure: top-level posts must have a title
    CONSTRAINT chk_toplevel_has_title
        CHECK (parent_id IS NOT NULL OR title IS NOT NULL),

    -- state machine
    CONSTRAINT chk_state_values
        CHECK (state IN ('queued', 'visible', 'removed', 'collapsed')),
    -- removed posts must have a reason (editorial voice)
    CONSTRAINT chk_removed_has_reason
        CHECK (state != 'removed' OR mod_reason IS NOT NULL),

    -- pinned logic: pin_order required when pinned, null otherwise
    CONSTRAINT chk_pinned_bool
        CHECK (pinned IN (0, 1)),
    CONSTRAINT chk_pin_order_when_pinned
        CHECK ((pinned = 1 AND pin_order IS NOT NULL)
            OR (pinned = 0 AND pin_order IS NULL)),
    CONSTRAINT chk_pin_order_positive
        CHECK (pin_order IS NULL OR pin_order > 0),

    -- timestamps
    CONSTRAINT chk_created_at_positive
        CHECK (created_at > 0)
);

-- primary read path: visible posts sorted by materialized path
CREATE INDEX idx_posts_live
    ON posts(path)
    WHERE state = 'visible';

-- front page: pinned first by pin_order, then non-pinned by weight
CREATE INDEX idx_posts_toplevel
    ON posts(pinned DESC, pin_order ASC, weight DESC)
    WHERE parent_id IS NULL AND state = 'visible';

-- moderation queue: oldest first
CREATE INDEX idx_posts_queue
    ON posts(created_at ASC)
    WHERE state = 'queued';

-- threading: find children of a post
CREATE INDEX idx_posts_parent
    ON posts(parent_id);

-- rate limiting: recent posts by ip
CREATE INDEX idx_posts_ip_created
    ON posts(ip, created_at);


-- ===========================================================
-- MOD LOG
-- ===========================================================
-- append-only audit trail. one actor (julian). never deleted.

CREATE TABLE mod_log (
    id          INTEGER PRIMARY KEY,

    action      VARCHAR(16)  NOT NULL,
    target_id   INTEGER      NOT NULL,
    reason      VARCHAR(256),

    created_at  INTEGER      NOT NULL,

    CONSTRAINT chk_modlog_action
        CHECK (action IN ('approve', 'remove', 'collapse', 'pin', 'unpin', 'reweight')),
    CONSTRAINT chk_modlog_reason_ascii
        CHECK (reason IS NULL
            OR reason NOT GLOB '*[^ -~]*'),
    CONSTRAINT chk_modlog_timestamp
        CHECK (created_at > 0)
);

CREATE INDEX idx_modlog_created
    ON mod_log(created_at DESC);
CREATE INDEX idx_modlog_target
    ON mod_log(target_id);
