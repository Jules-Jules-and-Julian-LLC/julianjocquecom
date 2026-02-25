package discuss;

import java.io.IOException;
import java.io.InputStream;
import java.sql.*;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;

public class Db {
    private final String url;

    public Db(String dbPath) {
        this.url = "jdbc:sqlite:" + dbPath;
        initSchema();
    }

    private Connection connect() throws SQLException {
        Connection conn = DriverManager.getConnection(url);
        try (Statement s = conn.createStatement()) {
            s.execute("PRAGMA journal_mode = WAL");
            s.execute("PRAGMA foreign_keys = ON");
            s.execute("PRAGMA busy_timeout = 5000");
            s.execute("PRAGMA synchronous = NORMAL");
        }
        return conn;
    }

    private void initSchema() {
        try (Connection conn = connect(); Statement s = conn.createStatement()) {
            // check if posts table exists
            ResultSet rs = s.executeQuery(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='posts'");
            if (!rs.next()) {
                InputStream is = getClass().getResourceAsStream("/schema.sql");
                if (is == null) throw new RuntimeException("schema.sql not found in resources");
                String sql = new String(is.readAllBytes());
                for (String stmt : splitSql(sql)) {
                    s.execute(stmt);
                }
                System.out.println("Database schema created.");

                // load seed data if available
                InputStream seed = getClass().getResourceAsStream("/seed.sql");
                if (seed != null) {
                    String seedSql = new String(seed.readAllBytes());
                    for (String stmt : splitSql(seedSql)) {
                        s.execute(stmt);
                    }
                    System.out.println("Seed data loaded.");
                }
            }
        } catch (SQLException | IOException e) {
            throw new RuntimeException("Failed to init schema", e);
        }
    }

    // -------------------------------------------------------
    // POSTS: read
    // -------------------------------------------------------

    public List<Post> getTopLevelPosts(int page, int pageSize, Long daySeed) {
        List<Post> pinned = new ArrayList<>();
        List<Post> unpinned = new ArrayList<>();

        String sql = """
            SELECT * FROM posts
            WHERE parent_id IS NULL AND state = 'visible'
            ORDER BY pinned DESC, pin_order ASC, weight DESC, created_at DESC
            """;

        try (Connection conn = connect();
             PreparedStatement ps = conn.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                Post p = mapPost(rs);
                if (p.pinned() == 1) {
                    pinned.add(p);
                } else {
                    unpinned.add(p);
                }
            }
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }

        // day-seeded shuffle for non-pinned
        if (daySeed != null) {
            Collections.shuffle(unpinned, new Random(daySeed));
        }

        List<Post> all = new ArrayList<>(pinned);
        all.addAll(unpinned);

        // paginate
        int start = page * pageSize;
        if (start >= all.size()) return List.of();
        int end = Math.min(start + pageSize, all.size());
        return all.subList(start, end);
    }

    public int getTopLevelCount() {
        String sql = "SELECT COUNT(*) FROM posts WHERE parent_id IS NULL AND state = 'visible'";
        try (Connection conn = connect();
             Statement s = conn.createStatement();
             ResultSet rs = s.executeQuery(sql)) {
            return rs.getInt(1);
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    public Post getPost(int id) {
        String sql = "SELECT * FROM posts WHERE id = ?";
        try (Connection conn = connect();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setInt(1, id);
            ResultSet rs = ps.executeQuery();
            if (rs.next()) return mapPost(rs);
            return null;
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    public List<Post> getThreadReplies(int topLevelId) {
        // get the top-level post's path prefix to find all descendants
        Post root = getPost(topLevelId);
        if (root == null) return List.of();

        String sql = """
            SELECT * FROM posts
            WHERE path LIKE ? AND id != ? AND state IN ('visible', 'removed', 'collapsed')
            ORDER BY path ASC
            """;

        try (Connection conn = connect();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, root.path() + ".%");
            ps.setInt(2, topLevelId);
            ResultSet rs = ps.executeQuery();
            List<Post> replies = new ArrayList<>();
            while (rs.next()) {
                replies.add(mapPost(rs));
            }
            return replies;
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    public int getReplyCount(int topLevelId) {
        Post root = getPost(topLevelId);
        if (root == null) return 0;

        String sql = """
            SELECT COUNT(*) FROM posts
            WHERE path LIKE ? AND id != ? AND state = 'visible'
            """;

        try (Connection conn = connect();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, root.path() + ".%");
            ps.setInt(2, topLevelId);
            ResultSet rs = ps.executeQuery();
            return rs.getInt(1);
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    // -------------------------------------------------------
    // POSTS: write
    // -------------------------------------------------------

    public int createPost(String title, String url, String body, String author,
                          String color1, String color2, String ip, boolean isOwner) {
        // generate next top-level path
        String nextPath = nextTopLevelPath();
        String state = isOwner ? "visible" : "queued";

        String sql = """
            INSERT INTO posts (path, url, title, body, author, color1, color2, ip, created_at, state)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """;

        try (Connection conn = connect();
             PreparedStatement ps = conn.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            ps.setString(1, nextPath);
            ps.setString(2, blankToNull(url));
            ps.setString(3, title);
            ps.setString(4, body);
            ps.setString(5, author.isEmpty() ? "anon" : author);
            ps.setString(6, blankToNull(color1));
            ps.setString(7, blankToNull(color2));
            ps.setString(8, ip);
            ps.setLong(9, System.currentTimeMillis() / 1000);
            ps.setString(10, state);
            ps.executeUpdate();
            ResultSet keys = ps.getGeneratedKeys();
            keys.next();
            return keys.getInt(1);
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    public int createReply(int parentId, String body, String url, String author,
                           String color1, String color2, String ip, boolean isOwner) {
        Post parent = getPost(parentId);
        if (parent == null) throw new IllegalArgumentException("Parent not found");

        String replyPath = nextReplyPath(parent.path());
        String state = isOwner ? "visible" : "queued";

        String sql = """
            INSERT INTO posts (parent_id, path, url, body, author, color1, color2, ip, created_at, state)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """;

        try (Connection conn = connect();
             PreparedStatement ps = conn.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            ps.setInt(1, parentId);
            ps.setString(2, replyPath);
            ps.setString(3, blankToNull(url));
            ps.setString(4, body);
            ps.setString(5, author.isEmpty() ? "anon" : author);
            ps.setString(6, blankToNull(color1));
            ps.setString(7, blankToNull(color2));
            ps.setString(8, ip);
            ps.setLong(9, System.currentTimeMillis() / 1000);
            ps.setString(10, state);
            ps.executeUpdate();
            ResultSet keys = ps.getGeneratedKeys();
            keys.next();
            return keys.getInt(1);
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    // -------------------------------------------------------
    // MODERATION
    // -------------------------------------------------------

    public List<Post> getQueue() {
        String sql = "SELECT * FROM posts WHERE state = 'queued' ORDER BY created_at ASC";
        try (Connection conn = connect();
             Statement s = conn.createStatement();
             ResultSet rs = s.executeQuery(sql)) {
            List<Post> queue = new ArrayList<>();
            while (rs.next()) queue.add(mapPost(rs));
            return queue;
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    public void moderatePost(int postId, String action, String reason) {
        String newState = switch (action) {
            case "approve" -> "visible";
            case "remove" -> "removed";
            case "collapse" -> "collapsed";
            default -> throw new IllegalArgumentException("Unknown action: " + action);
        };

        String sql;
        if ("remove".equals(action)) {
            sql = "UPDATE posts SET state = ?, mod_reason = ? WHERE id = ?";
        } else {
            sql = "UPDATE posts SET state = ? WHERE id = ?";
        }

        try (Connection conn = connect()) {
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setString(1, newState);
                if ("remove".equals(action)) {
                    ps.setString(2, reason);
                    ps.setInt(3, postId);
                } else {
                    ps.setInt(2, postId);
                }
                ps.executeUpdate();
            }

            // log it
            try (PreparedStatement ps = conn.prepareStatement(
                    "INSERT INTO mod_log (action, target_id, reason, created_at) VALUES (?, ?, ?, ?)")) {
                ps.setString(1, action);
                ps.setInt(2, postId);
                ps.setString(3, blankToNull(reason));
                ps.setLong(4, System.currentTimeMillis() / 1000);
                ps.executeUpdate();
            }
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    public void pinPost(int postId, int pinOrder) {
        String sql = "UPDATE posts SET pinned = 1, pin_order = ? WHERE id = ?";
        try (Connection conn = connect();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setInt(1, pinOrder);
            ps.setInt(2, postId);
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    public void unpinPost(int postId) {
        String sql = "UPDATE posts SET pinned = 0, pin_order = NULL WHERE id = ?";
        try (Connection conn = connect();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setInt(1, postId);
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    // -------------------------------------------------------
    // PATH GENERATION
    // -------------------------------------------------------

    private String nextTopLevelPath() {
        String sql = """
            SELECT path FROM posts WHERE parent_id IS NULL
            ORDER BY path DESC LIMIT 1
            """;
        try (Connection conn = connect();
             Statement s = conn.createStatement();
             ResultSet rs = s.executeQuery(sql)) {
            if (rs.next()) {
                int current = Integer.parseInt(rs.getString("path"));
                return String.format("%04d", current + 1);
            }
            return "0001";
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    private String nextReplyPath(String parentPath) {
        // if parent is already at depth 4, flatten: reply becomes sibling (Tildes-style)
        int parentDepth = (int) parentPath.chars().filter(c -> c == '.').count() + 1;
        String prefix;
        if (parentDepth >= 4) {
            // go up one level — reply at same depth as parent
            int lastDot = parentPath.lastIndexOf('.');
            prefix = parentPath.substring(0, lastDot);
        } else {
            prefix = parentPath;
        }

        String sql = """
            SELECT path FROM posts WHERE path LIKE ? AND path NOT LIKE ?
            ORDER BY path DESC LIMIT 1
            """;

        try (Connection conn = connect();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            // match direct children: prefix.XXXX but not prefix.XXXX.%
            ps.setString(1, prefix + ".____");
            ps.setString(2, prefix + ".____.__%");
            ResultSet rs = ps.executeQuery();
            if (rs.next()) {
                String lastChild = rs.getString("path");
                String lastSegment = lastChild.substring(lastChild.lastIndexOf('.') + 1);
                int next = Integer.parseInt(lastSegment) + 1;
                return prefix + "." + String.format("%04d", next);
            }
            return prefix + ".0001";
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    // -------------------------------------------------------
    // RATE LIMITING
    // -------------------------------------------------------

    public boolean isRateLimited(String ip, int seconds) {
        long cutoff = (System.currentTimeMillis() / 1000) - seconds;
        String sql = "SELECT COUNT(*) FROM posts WHERE ip = ? AND created_at > ?";
        try (Connection conn = connect();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, ip);
            ps.setLong(2, cutoff);
            ResultSet rs = ps.executeQuery();
            return rs.getInt(1) > 0;
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    // -------------------------------------------------------
    // HELPERS
    // -------------------------------------------------------

    private Post mapPost(ResultSet rs) throws SQLException {
        return new Post(
            rs.getInt("id"),
            rs.getObject("parent_id") != null ? rs.getInt("parent_id") : null,
            rs.getString("path"),
            rs.getString("url"),
            rs.getString("title"),
            rs.getString("body"),
            rs.getString("author"),
            rs.getString("color1"),
            rs.getString("color2"),
            rs.getString("ip"),
            rs.getLong("created_at"),
            rs.getString("state"),
            rs.getString("mod_reason"),
            rs.getInt("pinned"),
            rs.getObject("pin_order") != null ? rs.getInt("pin_order") : null,
            rs.getInt("weight")
        );
    }

    private String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s;
    }

    /** Split SQL text into statements, respecting string literals and comments. */
    private static List<String> splitSql(String sql) {
        List<String> stmts = new ArrayList<>();
        StringBuilder buf = new StringBuilder();
        boolean inString = false;
        for (int i = 0; i < sql.length(); i++) {
            char c = sql.charAt(i);
            if (inString) {
                buf.append(c);
                if (c == '\'' && i + 1 < sql.length() && sql.charAt(i + 1) == '\'') {
                    buf.append('\'');
                    i++; // skip escaped quote
                } else if (c == '\'') {
                    inString = false;
                }
            } else if (c == '\'') {
                inString = true;
                buf.append(c);
            } else if (c == '-' && i + 1 < sql.length() && sql.charAt(i + 1) == '-') {
                // line comment — skip to end of line
                int nl = sql.indexOf('\n', i);
                i = (nl == -1) ? sql.length() - 1 : nl;
            } else if (c == ';') {
                String trimmed = buf.toString().trim();
                if (!trimmed.isEmpty()) stmts.add(trimmed);
                buf.setLength(0);
            } else {
                buf.append(c);
            }
        }
        String trimmed = buf.toString().trim();
        if (!trimmed.isEmpty()) stmts.add(trimmed);
        return stmts;
    }
}
