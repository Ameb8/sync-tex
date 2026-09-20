const API_BASE_URL = '/projects/v1';

export const downloadEndpoint = (projectId, target) => {
  const project = encodeURIComponent(projectId);
  if (target.kind === 'file') return `${API_BASE_URL}/projects/${project}/files/${encodeURIComponent(target.id)}/download`;
  if (target.kind === 'directory') return `${API_BASE_URL}/projects/${project}/directories/${encodeURIComponent(target.id)}/download`;
  if (target.kind === 'project') return `${API_BASE_URL}/projects/${project}/download`;
  throw new Error('Unknown download target');
};

const safeFilename = (value) => {
  if (typeof value !== 'string') return '';
  const filename = value.replace(/[\\/\u0000-\u001f\u007f]/g, '').trim().replace(/^\.+/, '');
  return filename.slice(0, 255);
};

/** Extract a safe filename from an RFC 6266 Content-Disposition header. */
export const filenameFromDisposition = (header, fallback) => {
  let candidate = '';
  const extended = header?.match(/(?:^|;)\s*filename\*\s*=\s*([^;]+)/i)?.[1];
  if (extended) {
    const encoded = extended.trim().replace(/^"|"$/g, '');
    const parts = encoded.match(/^([^']*)'[^']*'(.*)$/);
    if (parts && /^utf-8$/i.test(parts[1])) {
      try { candidate = decodeURIComponent(parts[2]); } catch { /* use fallback below */ }
    }
  }
  if (!candidate) {
    const plain = header?.match(/(?:^|;)\s*filename\s*=\s*(?:"([^\"]*)"|([^;\s]*))/i);
    candidate = plain?.[1] ?? plain?.[2] ?? '';
  }
  return safeFilename(candidate) || safeFilename(fallback) || 'download';
};

const downloadError = async (response) => {
  let message = '';
  try {
    const body = await response.clone().json();
    message = body?.error?.message || body?.error || body?.message || body?.detail || '';
  } catch { /* errors are often empty or non-JSON */ }
  throw new Error(typeof message === 'string' && message.trim()
    ? message.trim()
    : `Could not download this item (${response.status}). Please try again.`);
};

export const triggerBrowserDownload = (blob, filename) => {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  try {
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
};

/**
 * Fetch and save an authenticated file, directory archive, or project archive.
 * fetcher is injected by the API boundary so this module can verify the real
 * Response/Blob/header lifecycle without knowing how authentication is stored.
 */
export async function downloadProjectTarget(projectId, target, { signal, fetcher }) {
  if (typeof fetcher !== 'function') throw new Error('Authenticated download fetch is unavailable');
  const response = await fetcher(downloadEndpoint(projectId, target), { method: 'GET', signal });
  if (!response.ok) await downloadError(response);
  const blob = await response.blob();
  const fallback = target.kind === 'file' ? target.name : `${target.name || 'project'}.zip`;
  const filename = filenameFromDisposition(response.headers.get('Content-Disposition'), fallback);
  triggerBrowserDownload(blob, filename);
  return { filename };
}
