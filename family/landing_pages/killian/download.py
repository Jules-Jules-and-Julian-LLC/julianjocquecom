
import instaloader
import time
import os
from http.cookiejar import MozillaCookieJar

def download_with_cookies(target_username, cookie_file='cookies.txt'):
    # --- PASTE YOUR EXACT USER AGENT BELOW ---
    # Example: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
    REAL_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0"
    # -----------------------------------------

    L = instaloader.Instaloader(
        download_videos=False,
        save_metadata=False,
        compress_json=False,
        user_agent=REAL_USER_AGENT
    )

    if not os.path.exists(cookie_file):
        print(f"CRITICAL: '{cookie_file}' not found.")
        return

    try:
        print(f"Loading cookies from {cookie_file}...")
        cookie_jar = MozillaCookieJar(cookie_file)
        cookie_jar.load(ignore_discard=True, ignore_expires=True)
        L.context._session.cookies = cookie_jar

        # CRITICAL: Update the session headers to match the UA
        L.context._session.headers.update({'User-Agent': REAL_USER_AGENT})

        print("Cookies injected successfully.")
    except Exception as e:
        print(f"Error loading cookies: {e}")
        return

    try:
        print(f"Attempting to access profile: {target_username}")
        profile = instaloader.Profile.from_username(L.context, target_username)

        # Verify relationship again just to be sure
        if profile.is_private and not profile.followed_by_viewer:
            print("Auth Error: Cookies loaded, but Instagram still treats you as a stranger.")
            return

        print(f"Verified! Downloading photos for {profile.username}...")

        count = 0
        for post in profile.get_posts():
            # Skip if it's not a graph image (optional, keeps it strictly to photos)
            if post.typename not in ['GraphImage', 'GraphSidecar']:
                continue

            print(f"Downloading post {post.shortcode} ({post.date_local})...")
            L.download_post(post, target=profile.username)
            count += 1

            # Rate limit protection
            time.sleep(12)

        print(f"\nDownload complete! Grabbed {count} posts.")

    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    download_with_cookies('aviankillian', 'cookies.txt')
