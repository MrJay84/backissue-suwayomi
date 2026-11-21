# BackIssue Suwayomi Plugin

A BackIssue source plugin that searches installed remote extensions in [Suwayomi](https://github.com/Suwayomi/Suwayomi-Server) (via its GraphQL and REST APIs), queues and downloads matching comic issues, transfers the resulting `.cbz` archives into BackIssue, and optionally deletes the local chapter copies from Suwayomi afterward.

> **Tested with:** Suwayomi Server `v2.4.2366` (`ghcr.io/suwayomi/suwayomi-server:latest`)

---

## Features

- **Multi-Source Search:** Queries one or more selected Suwayomi extensions (such as BatCave, XOXO Comics, Read Comics Online, or any other installed comic/manga source) or searches all installed remote sources automatically.
- **Smart Title & Issue Matching:** Expands series titles into normalized variations (stripping parenthetical release years, converting colons to hyphens, and matching subtitles) to improve hit rates across different comic sites.
- **Automated Download Queue Management:** Enqueues matched chapters via GraphQL, kicks Suwayomi's download worker, clears stale `isDownloaded` flags if an archive is missing, and waits for completion.
- **Direct CBZ Transfer:** Fetches the finished `.cbz` archive from Suwayomi into memory and passes it straight to BackIssue's import pipeline.
- **Post-Copy Cleanup:** Includes a **Delete originals** toggle in the UI to automatically remove downloaded chapters from Suwayomi once BackIssue has copied the `.cbz`.
- **Dynamic UI Source Picker:** Fetches installed remote extensions live from your Suwayomi instance into a checklist inside BackIssue's settings panel.

---

## How the Plugin Works

The plugin consists of a Node.js backend (`index.js`), a client-side settings UI script (`client/ui.js`), and an ES module manifest (`package.json`):

1. **Settings & Source Discovery (`client/ui.js` & `/api/plugins/suwayomi/sources`):**
   - Registers a custom **Suwayomi** configuration block inside BackIssue's plugin settings slot.
   - Exposes a backend route (`/api/plugins/suwayomi/sources`) that queries Suwayomi's GraphQL `sources` endpoint, filtering out the local source (`id: "0"`) and populating clickable source checkboxes in the UI.

2. **Search & Matching (`find` & `manualSearch` in `index.js`):**
   - Generates cleaned title variations from BackIssue's `seriesTitle` and `seriesNames` (removing `(YYYY)` tags, normalizing punctuation, and testing colon/hyphen variants).
   - Runs `fetchSourceManga` (`SEARCH`) across each enabled extension in parallel, fetches chapter lists via `fetchMangaAndChapters`, and matches chapters by normalized issue number.

3. **Download, Transfer & Cleanup (`fetch` in `index.js`):**
   - Verifies the selected manga and chapter still exist in Suwayomi. If Suwayomi reports `isDownloaded: true` from an older run, the plugin clears the stale flag first so a fresh archive is generated.
   - Calls `enqueueChapterDownloads` and triggers `POST /api/v1/downloads/start` until `isDownloaded` becomes `true` and the archive settles on disk.
   - Downloads the `.cbz` stream from `GET /api/v1/chapter/{chapterId}/download` into a `Buffer`.
   - If **Delete originals** (`suwayomi_deleteAfterCopy`) is enabled, runs `deleteDownloadedChapter` / `deleteDownloadedChapters` via GraphQL to remove Suwayomi's local download copy before returning `{ buffer, format: 'cbz', name, url }` to BackIssue.

---

## Prerequisites: Suwayomi Server, FlareSolverr & Extensions

### 1. Required Suwayomi Docker Image & Tested Version
You **must** use the official `ghcr.io/suwayomi/suwayomi-server:latest` Docker image (tested with **Server version `v2.4.2366`**). Older or third-party builds may lack the required GraphQL mutations, REST endpoints, or built-in WebView support needed for Cloudflare-protected sources.

### 2. Configure FlareSolverr in Suwayomi
Many comic extensions (including **BatCave** and others) sit behind Cloudflare protection. Configure FlareSolverr in Suwayomi so automated searches and downloads do not get blocked:

1. Deploy a **FlareSolverr** container (`ghcr.io/flaresolverr/flaresolverr:latest`) reachable from your Suwayomi container (default port `8191`).
2. Open the **Suwayomi Web UI** and go to **Settings** (gear icon) → **Browse** (or **General / Network** depending on UI layout).
3. Locate the **FlareSolverr** settings section:
   - Enable **FlareSolverr**.
   - Set the **FlareSolverr URL** to your FlareSolverr instance address (e.g., `http://192.168.1.111:8191` or `http://flaresolverr:8191`).
   - Leave the timeout at the default (or set `60` seconds) and save.

### 3. Add the Extension Repository & Install Comic Sources
1. In the **Suwayomi Web UI**, go to **Settings** → **Browse** → **Extension repositories**.
2. Click **Add repository** and add the Keiyoushi extension repository index URL (used across Uchiyomi/Suwayomi):

        https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json

3. Go to **Browse** → **Extensions** and install any comic or manga sources you want to use—for example **BatCave**, **XOXO Comics**, **Read Comics Online**, or other English comic extensions available in the repository.

### 4. Initialize Sources & Log In via the WebView Window
Before BackIssue can query Cloudflare-protected or login-gated extensions over GraphQL, initialize them using Suwayomi's built-in WebView window (using **BatCave (EN)** as an example—note that **BatCave requires a free `batcave.biz` account** to view and download issues):

1. In Suwayomi, go to **Browse** → **Sources** and locate **BatCave (EN)** (or whichever extension you installed).
2. Click the **WebView** (globe/browser icon) next to the source to open the site inside Suwayomi's web window.
3. Wait for any Cloudflare check to finish and the site homepage to load completely.
4. For **BatCave**, log into your `batcave.biz` account inside the WebView window so Suwayomi stores your authenticated session cookie, then close the WebView window.
5. Click into the source inside Suwayomi and run a quick test search to verify titles and chapters load cleanly. Repeat the WebView step for any other Cloudflare-protected or account-based sources you install.

---

## Installation in BackIssue

1. Copy or clone this repository into your BackIssue plugins directory (for example, on Unraid):

        cd /mnt/user/appdata/backissue/plugins
        git clone https://github.com/MrJay84/backissue-suwayomi.git suwayomi

   Ensure the directory contains:
   - `package.json`
   - `index.js`
   - `client/ui.js`

2. Restart or reload your **BackIssue** container so it registers the plugin.
3. Hard-refresh the BackIssue web interface (`Ctrl+Shift+R` / `Cmd+Shift+R`).

---

## Configuration

Open **Settings** → **Suwayomi** in BackIssue:

| Setting | Description |
| :--- | :--- |
| **Suwayomi (Enable toggle)** | Enables or disables Suwayomi as a comic/manga search source in BackIssue. |
| **Suwayomi server address** | Base URL of your Suwayomi server reachable from the BackIssue container (e.g., `http://192.168.1.111:4568`). |
| **Suwayomi Username** | Optional Basic Auth username if authentication is enabled in Suwayomi. |
| **Suwayomi Password** | Optional Basic Auth password if authentication is enabled in Suwayomi. |
| **Delete originals** | When enabled, instructs Suwayomi to delete its downloaded chapter files immediately after BackIssue copies the `.cbz`. |
| **Suwayomi Extensions / Sources** | Click **Refresh Sources** to load all installed remote extensions from Suwayomi (BatCave, XOXO Comics, Read Comics Online, etc.). Tick specific sources to restrict searches, or leave all unticked to search every installed remote source. |

Save your settings after making changes.
