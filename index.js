const DEFAULT_URL = 'http://localhost:4567';
const DOWNLOAD_WAIT_MS = 10 * 60 * 1000;
const POLL_MS = 2500;
const ARCHIVE_POLL_MS = 4000;
const ARCHIVE_SETTLE_MS = 2500;

function serverUrl(config) {
  return String(config?.suwayomi_bridgeUrl || DEFAULT_URL).trim().replace(/\/+$/, '');
}

function headers(config) {
  const username = String(config?.suwayomi_bridgeUser ?? '');
  const password = String(config?.suwayomi_bridgePass ?? '');
  const result = { 'content-type': 'application/json', accept: 'application/json' };
  if (username || password) {
    result.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }
  return result;
}

async function graphql(config, query, variables = {}) {
  const response = await fetch(`${serverUrl(config)}/api/graphql`, {
    method: 'POST',
    headers: headers(config),
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Suwayomi returned HTTP ${response.status}`);
  if (!body) throw new Error('Suwayomi returned an unreadable GraphQL response');
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).filter(Boolean).join('; ') || 'Suwayomi GraphQL request failed');
  }
  return body.data || {};
}

const SOURCE_QUERY = `query BackIssueSources {
  sources(first: 100) { nodes { id name displayName lang } }
}`;

const SEARCH_MUTATION = `mutation BackIssueSearch($input: FetchSourceMangaInput!) {
  fetchSourceManga(input: $input) {
    hasNextPage
    mangas { id title sourceId url thumbnailUrl }
  }
}`;

const MANGA_CHAPTERS_MUTATION = `mutation BackIssueMangaChapters($input: FetchMangaAndChaptersInput!) {
  fetchMangaAndChapters(input: $input) {
    manga { id title sourceId }
    chapters { id name chapterNumber pageCount isDownloaded }
  }
}`;

const ENQUEUE_MUTATION = `mutation BackIssueEnqueue($input: EnqueueChapterDownloadsInput!) {
  enqueueChapterDownloads(input: $input) {
    downloadStatus { state }
  }
}`;

const DELETE_DOWNLOADED_CHAPTER_MUTATION = `mutation BackIssueDeleteDownloadedChapter($input: DeleteDownloadedChapterInput!) {
  deleteDownloadedChapter(input: $input) {
    chapters { id isDownloaded }
  }
}`;

const DELETE_DOWNLOADED_CHAPTERS_MUTATION = `mutation BackIssueDeleteDownloadedChapters($input: DeleteDownloadedChaptersInput!) {
  deleteDownloadedChapters(input: $input) {
    chapters { id isDownloaded }
  }
}`;

async function getInstalledSources(config) {
  const data = await graphql(config, SOURCE_QUERY);
  return data.sources?.nodes || [];
}

async function getInstalledRemoteSources(config) {
  const installed = await getInstalledSources(config);
  return installed.filter((s) => String(s.id) !== '0');
}

async function resolveSources(config) {
  let installed = [];
  try {
    installed = await getInstalledSources(config);
  } catch {
    installed = [];
  }
  const remoteSources = installed.filter((s) => String(s.id) !== '0');

  const rawSetting = String(config?.suwayomi_sources || config?.suwayomi_sourceId || '').trim();
  if (!rawSetting) {
    return remoteSources.length > 0
      ? remoteSources
      : [{ id: '7422099479605463706', name: 'BatCave', displayName: 'BatCave (EN)' }];
  }

  const wantedTokens = rawSetting
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const matched = [];
  for (const token of wantedTokens) {
    const cleanToken = token.replace(/\s*\([^)]*\)\s*$/, '').trim();
    const found = installed.find((src) => {
      const id = String(src.id).toLowerCase();
      const name = String(src.name || '').toLowerCase();
      const displayName = String(src.displayName || '').toLowerCase();
      return (
        id === token ||
        id === cleanToken ||
        name === token ||
        name === cleanToken ||
        displayName === token ||
        displayName.startsWith(`${cleanToken} (`)
      );
    });
    if (found && !matched.some((m) => String(m.id) === String(found.id))) {
      matched.push(found);
    } else if (/^\d+$/.test(cleanToken) && !matched.some((m) => String(m.id) === cleanToken)) {
      matched.push({ id: cleanToken, name: cleanToken, displayName: cleanToken });
    }
  }

  if (matched.length > 0) return matched;
  if (remoteSources.length > 0) return remoteSources;
  return [{ id: '7422099479605463706', name: 'BatCave', displayName: 'BatCave (EN)' }];
}

function normalizeTitle(value) {
  return String(value || '').toLocaleLowerCase('en')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function titlesMatch(candidateTitle, wantedTitle) {
  const a = normalizeTitle(candidateTitle);
  const b = normalizeTitle(wantedTitle);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  return false;
}

function issueNumber(ctx) {
  const raw = ctx?.issue?.issue_number ?? ctx?.issue?.number ?? '';
  const text = String(raw).trim();
  const match = text.match(/(?:^|[^\d])(\d+(?:\.\d+)?)(?:$|[^\d])/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

function chapterNumber(chapter) {
  const number = Number(chapter?.chapterNumber);
  if (Number.isFinite(number) && number > 0) return number;
  const name = String(chapter?.name || '');
  const labelled = name.match(/(?:#|issue\s*|chapter\s*|no\.?\s*)0*(\d+(?:\.\d+)?)/i);
  if (labelled) return Number(labelled[1]);
  const anywhere = name.match(/(?:^|[^\d])0*(\d+(?:\.\d+)?)(?:$|[^\d])/);
  return anywhere ? Number(anywhere[1]) : null;
}

function mangaQueries(ctx) {
  const baseTitles = [ctx.seriesTitle, ...(Array.isArray(ctx.seriesNames) ? ctx.seriesNames : [])]
    .map((s) => String(s || '').trim())
    .filter(Boolean);

  const expanded = [];
  for (const title of baseTitles) {
    expanded.push(title);
    const noYear = title.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
    if (noYear) expanded.push(noYear);

    const hyphenated = noYear.replace(/\s*:\s*/g, ' - ').replace(/\s+/g, ' ').trim();
    if (hyphenated) expanded.push(hyphenated);

    const spacesOnly = noYear.replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
    if (spacesOnly) expanded.push(spacesOnly);

    const afterColon = noYear.includes(':') ? noYear.split(':').slice(1).join(':').trim() : '';
    if (afterColon && afterColon.length >= 4) expanded.push(afterColon);
  }

  return expanded
    .filter((s, i, all) => s && all.indexOf(s) === i)
    .slice(0, 8);
}

async function searchSourceChapters(source, query, ctx) {
  const config = ctx.config || {};
  const sourceId = String(source.id);
  const sourceLabel = source.name || source.displayName || sourceId;
  const wantTitle = ctx.seriesTitle || ctx.seriesNames?.[0];
  const wantNumber = issueNumber(ctx);
  if (!query || !wantTitle || wantNumber == null) return [];

  let mangas = [];
  try {
    const result = await graphql(config, SEARCH_MUTATION, {
      input: { source: sourceId, type: 'SEARCH', page: 1, query },
    });
    mangas = (result.fetchSourceManga?.mangas || [])
      .filter((manga) => String(manga.sourceId) === sourceId);
  } catch {
    return [];
  }

  if (mangas.length === 0) return [];

  const exactMangas = mangas.filter((manga) => normalizeTitle(manga.title) === normalizeTitle(wantTitle));
  const fallbackMangas = exactMangas.length > 0
    ? exactMangas
    : mangas.filter((manga) => titlesMatch(manga.title, wantTitle) || titlesMatch(manga.title, query));
  const targetMangas = fallbackMangas.length > 0 ? fallbackMangas : mangas.slice(0, 5);

  const settledDetails = await Promise.allSettled(targetMangas.slice(0, 8).map(async (manga) => {
    const data = await graphql(config, MANGA_CHAPTERS_MUTATION, {
      input: { id: Number(manga.id), fetchManga: true, fetchChapters: true },
    });
    return data.fetchMangaAndChapters;
  }));

  const issueLabel = ctx.issue?.issue_number ?? ctx.issue?.number ?? String(wantNumber);
  const candidates = [];
  for (const settled of settledDetails) {
    if (settled.status !== 'fulfilled') continue;
    const detail = settled.value;
    const manga = detail?.manga;
    if (!manga || String(manga.sourceId) !== sourceId) continue;
    for (const chapter of detail.chapters || []) {
      if (chapterNumber(chapter) !== wantNumber) continue;
      candidates.push({
        title: `[${sourceLabel}] ${manga.title} #${issueLabel}${chapter.name ? ` — ${chapter.name}` : ''}`,
        series: manga.title,
        number: String(issueLabel),
        sourceId,
        mangaId: Number(manga.id),
        chapterId: Number(chapter.id),
        chapterName: chapter.name,
        alreadyDownloaded: !!chapter.isDownloaded,
        url: `${serverUrl(config)}/api/v1/chapter/${Number(chapter.id)}/download`,
      });
    }
  }

  return candidates;
}

async function searchAllSources(query, ctx) {
  const sources = await resolveSources(ctx.config || {});
  const results = await Promise.allSettled(
    sources.map((source) => searchSourceChapters(source, query, ctx))
  );
  const candidates = [];
  for (const res of results) {
    if (res.status === 'fulfilled') {
      candidates.push(...res.value);
    }
  }
  return candidates;
}

async function kickDownloadsStart(config) {
  await fetch(`${serverUrl(config)}/api/v1/downloads/start`, {
    method: 'POST',
    headers: headers(config),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}

async function clearStaleDownloadedFlag(config, chapterId) {
  try {
    await graphql(config, DELETE_DOWNLOADED_CHAPTER_MUTATION, {
      input: { id: Number(chapterId) },
    });
    return;
  } catch {
    // Fall back to plural mutation if schema uses DeleteDownloadedChaptersInput
  }

  try {
    await graphql(config, DELETE_DOWNLOADED_CHAPTERS_MUTATION, {
      input: { ids: [Number(chapterId)] },
    });
  } catch {
    // Ignore if already cleared or unsupported
  }
}

async function deleteDownloadedChapterAfterCopy(config, chapterId) {
  if (config?.suwayomi_deleteAfterCopy === false) return;
  try {
    await clearStaleDownloadedFlag(config, chapterId);
  } catch {
    // Do not fail a completed transfer if cleanup fails
  }
}

async function startAndEnqueueChapter(config, chapterId, onProgress) {
  onProgress({ phase: 'connecting', detail: 'Queueing and starting download in Suwayomi' });
  await kickDownloadsStart(config);

  const queued = await graphql(config, ENQUEUE_MUTATION, { input: { ids: [chapterId] } });
  if (!queued.enqueueChapterDownloads) {
    throw new Error('Suwayomi did not accept the chapter download');
  }

  await kickDownloadsStart(config);
}

async function waitForChapter(config, candidate, onProgress) {
  const deadline = Date.now() + DOWNLOAD_WAIT_MS;
  let lastProgressAt = 0;
  let lastKickAt = Date.now();

  while (Date.now() < deadline) {
    const detailData = await graphql(config, MANGA_CHAPTERS_MUTATION, {
      input: { id: Number(candidate.mangaId), fetchManga: true, fetchChapters: true },
    });
    const detail = detailData.fetchMangaAndChapters;
    const chapter = (detail?.chapters || []).find((item) => Number(item.id) === Number(candidate.chapterId));
    if (!chapter) throw new Error('Suwayomi no longer lists the selected chapter');
    if (chapter.isDownloaded) {
      await new Promise((resolve) => setTimeout(resolve, ARCHIVE_SETTLE_MS));
      return;
    }

    if (Date.now() - lastKickAt > 10_000) {
      await kickDownloadsStart(config);
      lastKickAt = Date.now();
    }

    if (Date.now() - lastProgressAt > 15_000) {
      onProgress({ phase: 'downloading', detail: 'Waiting for Suwayomi to finish downloading the chapter' });
      lastProgressAt = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error('Timed out waiting for Suwayomi to finish the chapter download');
}

async function downloadArchiveBuffer(config, downloadUrl) {
  let response;
  let lastBodyText = '';
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    try {
      response = await fetch(downloadUrl, {
        method: 'GET',
        headers: { ...headers(config), accept: '*/*' },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) {
        const contentType = response.headers.get('content-type') || '';
        if (!/json|html|text\//i.test(contentType)) {
          const buffer = Buffer.from(await response.arrayBuffer());
          if (buffer.length > 0) {
            return { ok: true, buffer, status: response.status, bodyText: '' };
          }
        } else {
          lastBodyText = await response.text().catch(() => '');
        }
      } else {
        lastBodyText = await response.text().catch(() => '');
      }
    } catch (err) {
      lastBodyText = err?.message || '';
    }
    await new Promise((resolve) => setTimeout(resolve, ARCHIVE_POLL_MS));
  }

  return {
    ok: false,
    buffer: null,
    status: response?.status || 'unknown',
    bodyText: lastBodyText,
  };
}

function registerSourcesRoute(api) {
  if (typeof api.registerRoute !== 'function') return;

  const handler = async (reqOrCtx, maybeRes) => {
    const isExpress = Boolean(maybeRes && typeof maybeRes.status === 'function');
    const req = isExpress ? reqOrCtx : (reqOrCtx?.req || reqOrCtx || {});
    const res = isExpress ? maybeRes : reqOrCtx?.res;

    const urlObj = new URL(req.url || '/api/plugins/suwayomi/sources', 'http://localhost');
    const query = req.query || Object.fromEntries(urlObj.searchParams.entries());
    const body = (req.body && typeof req.body === 'object') ? req.body : {};

    const config = {
      suwayomi_bridgeUrl: query.url || body.url || process.env.SUWAYOMI_URL || DEFAULT_URL,
      suwayomi_bridgeUser: query.user ?? body.user ?? '',
      suwayomi_bridgePass: query.pass ?? body.pass ?? '',
    };

    try {
      const sources = await getInstalledRemoteSources(config);
      const payload = { ok: true, sources };
      if (isExpress) {
        return res.status(200).json(payload);
      }
      if (res && typeof res.end === 'function') {
        res.writeHead?.(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
        return;
      }
      return payload;
    } catch (err) {
      const payload = { ok: false, error: err?.message || 'Failed to query Suwayomi sources', sources: [] };
      if (isExpress) {
        return res.status(502).json(payload);
      }
      if (res && typeof res.end === 'function') {
        res.writeHead?.(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
        return;
      }
      return payload;
    }
  };

  try {
    api.registerRoute('GET', '/api/plugins/suwayomi/sources', handler);
  } catch {
    try {
      api.registerRoute('/api/plugins/suwayomi/sources', handler);
    } catch {
      // Ignore if route registration signature differs
    }
  }
}

export default function register(api) {
  if (typeof api.registerSource !== 'function') return;

  registerSourcesRoute(api);
  api.registerClientAsset?.({ js: 'client/ui.js' });

  api.registerSettings?.({
    suwayomi_bridgeEnabled: { type: 'bool' },
    suwayomi_bridgeUrl: { type: 'string', allowEmpty: true },
    suwayomi_bridgeUser: { type: 'string', allowEmpty: true },
    suwayomi_bridgePass: { type: 'string', allowEmpty: true },
    suwayomi_sources: { type: 'string', allowEmpty: true },
    suwayomi_deleteAfterCopy: { type: 'bool' },
  });

  api.registerSource({
    id: 'suwayomi',
    label: 'Suwayomi',
    kind: 'immediate',
    types: ['comic', 'manga'],
    isEnabled: (config) => config?.suwayomi_bridgeEnabled !== false,

    async find(ctx) {
      const names = mangaQueries(ctx);
      for (const name of names) {
        const candidates = await searchAllSources(name, ctx);
        if (candidates.length > 0) return candidates[0];
      }
      return null;
    },

    async manualSearch(ctx) {
      const names = mangaQueries(ctx);
      const found = [];
      for (const name of names) {
        found.push(...await searchAllSources(name, ctx));
        if (found.length >= 30) break;
      }
      const seen = new Set();
      return found.filter((candidate) => {
        const key = `${candidate.mangaId}:${candidate.chapterId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 30).map((candidate) => ({ ...candidate, size: '' }));
    },

    async fetch(candidate, ctx, onProgress = () => {}) {
      const mangaId = Number(candidate.mangaId);
      const chapterId = Number(candidate.chapterId);
      if (!Number.isSafeInteger(mangaId) || mangaId < 1 || !Number.isSafeInteger(chapterId) || chapterId < 1) {
        throw new Error('Suwayomi returned an invalid manga or chapter id');
      }

      const config = ctx.config || {};
      const activeSources = await resolveSources(config);
      const allowedIds = new Set(activeSources.map((s) => String(s.id)));

      const detailData = await graphql(config, MANGA_CHAPTERS_MUTATION, {
        input: { id: mangaId, fetchManga: true, fetchChapters: true },
      });
      const detail = detailData.fetchMangaAndChapters;
      const chapter = (detail?.chapters || []).find((item) => Number(item.id) === chapterId);
      if (!detail?.manga || !allowedIds.has(String(detail.manga.sourceId)) || !chapter) {
        throw new Error('The selected chapter is no longer available in Suwayomi');
      }

      const downloadCandidate = {
        ...candidate,
        url: `${serverUrl(config)}/api/v1/chapter/${chapterId}/download`,
      };

      if (chapter.isDownloaded) {
        await clearStaleDownloadedFlag(config, chapterId);
      }

      await startAndEnqueueChapter(config, chapterId, onProgress);
      await waitForChapter(config, { ...downloadCandidate, mangaId }, onProgress);

      onProgress({ phase: 'downloading', detail: 'Transferring the finished CBZ to BackIssue' });
      const archive = await downloadArchiveBuffer(config, downloadCandidate.url);

      if (!archive.ok || !archive.buffer?.length) {
        throw new Error(`Suwayomi could not serve the finished chapter archive (HTTP ${archive.status})`);
      }

      await deleteDownloadedChapterAfterCopy(config, chapterId);

      return {
        buffer: archive.buffer,
        format: 'cbz',
        name: candidate.title,
        url: downloadCandidate.url,
      };
    },
  });
}