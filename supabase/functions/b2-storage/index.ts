import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from 'npm:@aws-sdk/client-s3@3.490.0';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3.490.0';

// ── B2 configuration from environment ──
// Ensure the endpoint always starts with https:// (common mistake to omit it)
const _rawEndpoint = Deno.env.get('B2_ENDPOINT') || '';
const B2_ENDPOINT = _rawEndpoint.startsWith('http') ? _rawEndpoint : 'https://' + _rawEndpoint;
const B2_REGION   = Deno.env.get('B2_REGION')!;     // e.g. us-east-005
const B2_BUCKET   = Deno.env.get('B2_BUCKET')!;     // e.g. patchflow-files
const B2_KEY_ID   = Deno.env.get('B2_KEY_ID')!;     // Application Key ID
const B2_APP_KEY  = Deno.env.get('B2_APP_KEY')!;    // Application Key (secret)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const s3 = new S3Client({
  endpoint: B2_ENDPOINT,
  region: B2_REGION,
  credentials: { accessKeyId: B2_KEY_ID, secretAccessKey: B2_APP_KEY },
  forcePathStyle: true, // required for Backblaze B2
});

const SKIP = new Set(['.keep', '.emptyFolderPlaceholder']);

// ── Auth helper ──
async function getUser(req: Request) {
  const auth = req.headers.get('Authorization');
  if (!auth) { console.error('[b2-auth] No Authorization header'); return null; }
  // Use service role key so getUser() always has full access to verify any JWT
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY')!;
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    serviceKey,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } }
  );
  const { data: { user }, error } = await sb.auth.getUser();
  if (error) console.error('[b2-auth] getUser error:', error.message, '| status:', error.status);
  return error ? null : user;
}

// ── Response helpers ──
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const body = await req.json();
    const { action } = body;

    const user = await getUser(req);
    if (!user) return json({ error: 'Unauthorized — session token invalid or missing' }, 401);

    // ── list ──
    if (action === 'list') {
      const { prefix } = body as { prefix: string };
      const cmd = new ListObjectsV2Command({
        Bucket: B2_BUCKET,
        Prefix: prefix,
        Delimiter: '/',
      });
      const resp = await s3.send(cmd);

      // Folders (common prefixes)
      const folders = (resp.CommonPrefixes ?? []).map((p) => ({
        name: p.Prefix!.slice(prefix.length).replace(/\/$/, ''),
        id: null,
        metadata: null,
        created_at: null,
      }));

      // Files (filter .keep / placeholders)
      const files = (resp.Contents ?? [])
        .filter((o) => {
          const name = o.Key!.slice(prefix.length);
          return name && !SKIP.has(name);
        })
        .map((o) => ({
          name: o.Key!.slice(prefix.length),
          id: o.ETag ?? o.Key,
          metadata: { size: o.Size ?? 0 },
          created_at: o.LastModified?.toISOString() ?? null,
        }));

      return json({ data: [...folders, ...files], error: null });
    }

    // ── upload-presigned : return a presigned PUT URL ──
    if (action === 'upload-presigned') {
      const { path, contentType } = body as { path: string; contentType: string };
      const cmd = new PutObjectCommand({
        Bucket: B2_BUCKET,
        Key: path,
        ContentType: contentType || 'application/octet-stream',
      });
      const url = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
      return json({ data: { uploadUrl: url, key: path }, error: null });
    }

    // ── signed-url : presigned GET for download / view ──
    if (action === 'signed-url') {
      const { path, expiresIn } = body as { path: string; expiresIn?: number };
      const cmd = new GetObjectCommand({ Bucket: B2_BUCKET, Key: path });
      const url = await getSignedUrl(s3, cmd, { expiresIn: expiresIn ?? 3600 });
      return json({ data: { signedUrl: url }, error: null });
    }

    // ── move (copy + delete) ──
    if (action === 'move') {
      const { fromPath, toPath } = body as { fromPath: string; toPath: string };
      await s3.send(new CopyObjectCommand({
        Bucket: B2_BUCKET,
        CopySource: encodeURIComponent(B2_BUCKET + '/' + fromPath),
        Key: toPath,
      }));
      await s3.send(new DeleteObjectCommand({ Bucket: B2_BUCKET, Key: fromPath }));
      return json({ data: {}, error: null });
    }

    // ── delete one or many objects ──
    if (action === 'delete') {
      const { paths } = body as { paths: string[] };
      if (!paths?.length) return json({ data: {}, error: null });
      if (paths.length === 1) {
        await s3.send(new DeleteObjectCommand({ Bucket: B2_BUCKET, Key: paths[0] }));
      } else {
        await s3.send(new DeleteObjectsCommand({
          Bucket: B2_BUCKET,
          Delete: { Objects: paths.map((k) => ({ Key: k })) },
        }));
      }
      return json({ data: {}, error: null });
    }

    // ── storage-used : total bytes for a show (for storage bar) ──
    if (action === 'storage-used') {
      const { showId } = body as { showId: string };
      let total = 0;
      let continuationToken: string | undefined;
      do {
        const cmd = new ListObjectsV2Command({
          Bucket: B2_BUCKET,
          Prefix: showId + '/',
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        });
        const resp = await s3.send(cmd);
        (resp.Contents ?? []).forEach((o) => { total += o.Size ?? 0; });
        continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
      } while (continuationToken);
      return json({ data: { bytes: total }, error: null });
    }

    // ── user-storage : total B2 + DB storage for the authenticated user ──
    if (action === 'user-storage') {
      const { showIds } = body as { showIds: string[] };

      // 1. B2 — scan all shows in parallel (max 10 concurrent)
      let b2Bytes = 0;
      const chunkSize = 10;
      for (let i = 0; i < showIds.length; i += chunkSize) {
        const chunk = showIds.slice(i, i + chunkSize);
        const counts = await Promise.all(chunk.map(async (sid) => {
          let bytes = 0;
          let token: string | undefined;
          do {
            const cmd = new ListObjectsV2Command({
              Bucket: B2_BUCKET, Prefix: sid + '/',
              ContinuationToken: token, MaxKeys: 1000,
            });
            const r = await s3.send(cmd);
            (r.Contents ?? []).forEach((o) => { bytes += o.Size ?? 0; });
            token = r.IsTruncated ? r.NextContinuationToken : undefined;
          } while (token);
          return bytes;
        }));
        counts.forEach((n) => { b2Bytes += n; });
      }

      // 2. DB — use service role Supabase client to run size queries
      const sbAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );

      // shows.synoptique_data + shows.stage_data
      const { data: showsData } = await sbAdmin
        .from('shows')
        .select('synoptique_data, stage_data')
        .in('id', showIds);

      let dbBytes = 0;
      (showsData ?? []).forEach((s: Record<string, unknown>) => {
        if (s.synoptique_data) dbBytes += JSON.stringify(s.synoptique_data).length;
        if (s.stage_data)      dbBytes += JSON.stringify(s.stage_data).length;
      });

      // show_scenes.data
      const { data: scenesData } = await sbAdmin
        .from('show_scenes')
        .select('data')
        .in('show_id', showIds);
      (scenesData ?? []).forEach((sc: Record<string, unknown>) => {
        if (sc.data) dbBytes += JSON.stringify(sc.data).length;
      });

      // channels (estimate 400 bytes each)
      const { count: chCount } = await sbAdmin
        .from('channels')
        .select('id', { count: 'exact', head: true })
        .in('show_id', showIds);
      dbBytes += (chCount ?? 0) * 400;

      return json({ data: { b2_bytes: b2Bytes, db_bytes: dbBytes, total_bytes: b2Bytes + dbBytes }, error: null });
    }

    return json({ error: 'Unknown action: ' + action }, 400);

  } catch (err) {
    console.error('[b2-storage]', err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
