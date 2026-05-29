import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.9';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SMTP_HOST         = Deno.env.get('SMTP_HOST') ?? '';
const SMTP_USER         = Deno.env.get('SMTP_USER') ?? '';
const SMTP_PASS         = Deno.env.get('SMTP_PASS') ?? '';
const SITE_URL          = Deno.env.get('SITE_URL') ?? 'https://patchflow.fr';

const VALID_ROLES = new Set(['admin', 'editor', 'viewer']);
const NAVY = '#1d3a5f', ORANGE = '#ff6b1a';

const transporter = nodemailer.createTransport({
  host: SMTP_HOST, port: 465, secure: true,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  tls: { rejectUnauthorized: false },
});

function roleLabel(role: string) {
  return role === 'admin' ? 'Administrateur (droits complets)'
       : role === 'editor' ? 'Éditeur'
       : 'Lecture seule';
}

function emailShell(title: string, body: string, btnLabel: string, btnUrl: string, footer: string) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/></head>
<body style="font-family:Outfit,Arial,sans-serif;background:#f4f6fb;margin:0;padding:32px">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)">
  <div style="background:${NAVY};padding:28px;text-align:center">
    <div style="font-size:24px;font-weight:800;color:#fff;letter-spacing:-.5px">PatchFlow</div>
    <div style="font-size:11px;color:rgba(255,255,255,.6);margin-top:4px;letter-spacing:2px;text-transform:uppercase">Par des techniciens, pour des techniciens</div>
  </div>
  <div style="padding:36px 32px">
    <h1 style="font-size:20px;font-weight:700;color:${NAVY};margin:0 0 14px">${title}</h1>
    <div style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 28px">${body}</div>
    <div style="text-align:center;margin-bottom:28px">
      <a href="${btnUrl}" style="display:inline-block;background:${ORANGE};color:#fff;font-size:15px;font-weight:700;padding:14px 32px;border-radius:8px;text-decoration:none">${btnLabel}</a>
    </div>
    <p style="font-size:12px;color:#94a3b8;text-align:center;margin:0">${footer}</p>
  </div>
  <div style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;text-align:center">
    <p style="font-size:11px;color:#94a3b8;margin:0">© ${new Date().getFullYear()} PatchFlow ·
      <a href="${SITE_URL}" style="color:${ORANGE};text-decoration:none">patchflow.fr</a> ·
      <a href="mailto:support@patchflow.fr" style="color:${ORANGE};text-decoration:none">support@patchflow.fr</a></p>
  </div>
</div></body></html>`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    /* ── 1. Authenticate caller ── */
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(401, { error: 'Non autorisé' });

    /* User client — scoped to the caller's JWT */
    const sbUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: authErr } = await sbUser.auth.getUser();
    if (authErr || !caller) return json(401, { error: 'Non autorisé' });

    /* Admin client — service role, bypasses RLS */
    const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    /* ── 2. Parse & validate body ── */
    const { showId, email, role } = await req.json();
    if (!showId || !email || !role) return json(400, { error: 'showId, email et role requis' });
    if (!VALID_ROLES.has(role)) return json(400, { error: 'Rôle invalide (admin|editor|viewer)' });
    const normalEmail = email.trim().toLowerCase();

    /* ── 3. Verify caller owns the show ── */
    const { data: show } = await sbAdmin.from('shows').select('id,name,owner_id').eq('id', showId).maybeSingle();
    if (!show) return json(404, { error: 'Show introuvable' });
    if (show.owner_id !== caller.id) return json(403, { error: 'Vous n\'êtes pas le propriétaire de ce show' });

    /* ── 4. Cannot invite yourself ── */
    if (normalEmail === caller.email?.toLowerCase()) return json(400, { error: 'Vous ne pouvez pas vous inviter vous-même' });

    const inviterName = caller.user_metadata?.full_name || caller.email || 'Un technicien';
    const showName    = show.name || 'Show sans nom';

    /* ── 5. Check if user already exists in auth.users ── */
    const { data: { users: existingUsers } } = await sbAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existingUser = existingUsers?.find((u: { email?: string }) => u.email?.toLowerCase() === normalEmail);

    if (existingUser) {
      /* User already has an account → add directly to show_members */

      /* Check not already a member */
      const { data: existing } = await sbAdmin
        .from('show_members')
        .select('id')
        .eq('show_id', showId)
        .eq('user_id', existingUser.id)
        .maybeSingle();
      if (existing) return json(409, { error: 'Cet utilisateur est déjà membre du show' });

      const { error: insertErr } = await sbAdmin.from('show_members').insert({
        show_id: showId,
        user_id: existingUser.id,
        role,
      });
      if (insertErr) throw insertErr;

      /* Send notification email */
      const html = emailShell(
        `Vous avez été ajouté au show "${showName}" 🎧`,
        `<strong>${inviterName}</strong> vous a ajouté au show <strong>${showName}</strong> sur PatchFlow en tant que <strong>${roleLabel(role)}</strong>.<br/><br/>Vous pouvez désormais accéder à ce show depuis votre compte.`,
        'Ouvrir PatchFlow',
        `${SITE_URL}/app.html`,
        'Si vous ne connaissez pas cet utilisateur, ignorez cet email.',
      );
      await transporter.sendMail({
        from: `PatchFlow <${SMTP_USER}>`,
        to: normalEmail,
        subject: `Vous avez été ajouté au show "${showName}" — PatchFlow`,
        html,
      });

      return json(200, { ok: true, action: 'added_directly' });

    } else {
      /* User has no account → send invite via Supabase auth admin */

      /* Store pending invite (upsert = re-invite with updated role) */
      const { error: invErr } = await sbAdmin.from('show_invites').upsert({
        show_id: showId,
        invited_email: normalEmail,
        role,
        invited_by: caller.id,
        show_name: showName,
        inviter_name: inviterName,
      }, { onConflict: 'show_id,invited_email' });
      if (invErr) throw invErr;

      /* Invite via GoTrue — our auth-email-hook will send the branded email */
      const { error: inviteErr } = await sbAdmin.auth.admin.inviteUserByEmail(normalEmail, {
        redirectTo: `${SITE_URL}/app.html`,
        data: { invited_to_show: showId, invited_role: role, inviter: inviterName, show_name: showName },
      });

      /* If invite API fails (e.g. user already invited), send our own email as fallback */
      if (inviteErr) {
        console.warn('GoTrue invite failed, sending custom email:', inviteErr.message);
        const html = emailShell(
          `${inviterName} vous invite sur PatchFlow 🎧`,
          `<strong>${inviterName}</strong> vous invite à rejoindre le show <strong>${showName}</strong> sur PatchFlow en tant que <strong>${roleLabel(role)}</strong>.<br/><br/>PatchFlow est l'outil de gestion de patch son professionnel — créé par des techniciens, pour des techniciens.`,
          'Créer mon compte',
          `${SITE_URL}/app.html`,
          'Ce lien vous permettra de créer votre compte et d\'accéder directement au show.',
        );
        await transporter.sendMail({
          from: `PatchFlow <${SMTP_USER}>`,
          to: normalEmail,
          subject: `${inviterName} vous invite sur PatchFlow — "${showName}"`,
          html,
        });
      }

      return json(200, { ok: true, action: 'invite_sent' });
    }

  } catch (e) {
    console.error('invite-member error:', e);
    return json(500, { error: String((e as Error).message || e) });
  }
});

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
