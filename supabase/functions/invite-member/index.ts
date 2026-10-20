import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.9';
import { renderEmail, p, details, esc as escHtml } from '../_shared/email.ts';

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

/* Journal des envois (table email_log, lue par l'onglet E-mails de l'administration). Jamais le corps,
   jamais de lien : le type, le destinataire masqué, l'objet et le résultat. Sans effet si la table manque. */
async function logEmail(source: string, kind: string, to: string, subject: string, err?: unknown) {
  try {
    const at = to.indexOf('@');
    const masked = at > 1 ? to[0] + '***' + to.slice(at) : '***' + to.slice(Math.max(at, 0));
    await createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
      .from('email_log').insert({
        source, kind: String(kind || 'inconnu').slice(0, 60), to_masked: masked, subject: String(subject || '').slice(0, 160),
        status: err ? 'failed' : 'sent', error: err ? String((err as Error)?.message ?? err).slice(0, 300) : null,
      });
  } catch { /* le journal ne doit jamais empêcher un envoi */ }
}

const transporter = nodemailer.createTransport({
  host: SMTP_HOST, port: 465, secure: true,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  /* Certificat vérifié (Let's Encrypt, valide pour mail.patchflow.fr et
     patchflow.fr) : sans vérification, une interception pouvait récupérer
     le mot de passe SMTP et le contenu des emails (liens de connexion…). */
  tls: { minVersion: 'TLSv1.2' },
});

function roleLabel(role: string) {
  return role === 'admin' ? 'Administrateur (droits complets)'
       : role === 'editor' ? 'Éditeur'
       : 'Lecture seule';
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
    if (typeof showId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(showId)) {
      return json(400, { error: 'Show invalide' });
    }
    const normalEmail = String(email).trim().toLowerCase();
    if (normalEmail.length > 254 || !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(normalEmail)) {
      return json(400, { error: 'Adresse email invalide' });
    }

    /* ── 3. Verify caller owns the show ── */
    const { data: show } = await sbAdmin.from('shows').select('id,name,owner_id').eq('id', showId).maybeSingle();
    if (!show) return json(404, { error: 'Show introuvable' });
    if (show.owner_id !== caller.id) return json(403, { error: 'Vous n\'êtes pas le propriétaire de ce show' });

    /* ── 3b. Plan Gratuit : 3 collaborateurs par show (invitations en attente comprises). Même règle que
       l'interface et que le déclencheur trg_pf_limit_members en base ; renvoyer à une adresse déjà
       invitée reste possible. ── */
    const { data: ownerProf } = await sbAdmin.from('profiles').select('plan').eq('id', show.owner_id).maybeSingle();
    if (ownerProf?.plan !== 'pro') {
      const { count: nMembers } = await sbAdmin.from('show_members').select('user_id', { count: 'exact', head: true }).eq('show_id', showId);
      const { count: nPending } = await sbAdmin.from('show_invites').select('id', { count: 'exact', head: true })
        .eq('show_id', showId).neq('invited_email', normalEmail);
      if ((nMembers ?? 0) + (nPending ?? 0) >= 3) {
        return json(403, { error: 'Le plan Gratuit est limité à 3 collaborateurs par show. Passez au Pro pour une équipe illimitée.', code: 'plan_limit' });
      }
    }

    /* ── 4. Cannot invite yourself ── */
    if (normalEmail === caller.email?.toLowerCase()) return json(400, { error: 'Vous ne pouvez pas vous inviter vous-même' });

    /* ── 4b. Anti-abus ── sans plafond, un compte gratuit pouvait envoyer des
       emails en masse depuis le domaine PatchFlow avec un nom de show piégé
       (hameçonnage), ou bombarder une même adresse (le renvoi mettait à jour
       la même ligne, donc rien n'était compté). */
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count: sentToday } = await sbAdmin.from('show_invites')
      .select('id', { count: 'exact', head: true })
      .eq('invited_by', caller.id).gte('created_at', dayAgo);
    if ((sentToday ?? 0) >= 30) {
      return json(429, { error: "Limite atteinte : 30 invitations en 24 h. Réessayez plus tard." });
    }
    const { data: prevInv } = await sbAdmin.from('show_invites')
      .select('created_at').eq('show_id', showId).eq('invited_email', normalEmail).maybeSingle();
    if (prevInv?.created_at && Date.now() - new Date(prevInv.created_at).getTime() < 3600 * 1000) {
      return json(429, { error: 'Invitation déjà envoyée à cette adresse il y a moins d\'une heure.' });
    }

    // Échappement HTML pour les valeurs injectées dans les emails (anti-phishing/XSS)
    const esc = (s: string) => String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const inviterNameRaw = caller.user_metadata?.full_name || caller.email || 'Un technicien';
    const showNameRaw    = show.name || 'Show sans nom';
    const inviterName    = esc(inviterNameRaw);  // utilisé dans les corps HTML
    const showName       = esc(showNameRaw);     // utilisé dans les corps HTML

    /* ── 5. Check if user already exists in auth.users ── */
    const { data: { users: existingUsers } } = await sbAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existingUser = existingUsers?.find((u: { email?: string }) => u.email?.toLowerCase() === normalEmail);

    if (existingUser) {
      /* User already has an account → créer une INVITATION (notification)
         qu'il accepte depuis l'interface (au lieu de l'ajouter en silence). */

      /* Déjà membre ? */
      const { data: existing } = await sbAdmin
        .from('show_members')
        .select('id')
        .eq('show_id', showId)
        .eq('user_id', existingUser.id)
        .maybeSingle();
      if (existing) return json(409, { error: 'Cet utilisateur est déjà membre du show' });

      /* Créer/mettre à jour l'invitation en attente → apparaît en notification.
         On récupère l'id pour le mettre dans l'URL d'acceptation. */
      const { data: invRow, error: invErr } = await sbAdmin.from('show_invites').upsert({
        show_id: showId,
        invited_email: normalEmail,
        role,
        invited_by: caller.id,
        show_name: showNameRaw,
        inviter_name: inviterNameRaw,
        created_at: new Date().toISOString(),
      }, { onConflict: 'show_id,invited_email' }).select('id').maybeSingle();
      if (invErr) throw invErr;
      const inviteId = invRow?.id || '';

      /* Email de notification (lien direct → auto-accept côté app) */
      const acceptUrl = `${SITE_URL}/app.html?invite=${inviteId}`;
      const mail = renderEmail({
        tag: 'Invitation', title: `${inviterName} vous invite à rejoindre un show`, preheader: `Rejoignez « ${showName} » sur PatchFlow.`,
        body: p(`<strong style="color:#101828">${inviterName}</strong> vous a ajouté à son équipe sur PatchFlow.`) +
          details([['Show', showName], ['Rôle', roleLabel(role)], ['Invité', escHtml(normalEmail)]]) +
          p('Ouvrez l\'invitation : le show apparaîtra dans vos sessions dès votre connexion.'),
        cta: { label: 'Rejoindre le show', url: acceptUrl }, fallback: true,
        note: 'Vous ne connaissez pas cette personne ? Ignorez cet e-mail : vous ne serez ajouté à rien sans l\'avoir accepté.',
        reason: `Cet e-mail a été envoyé à ${escHtml(normalEmail)} à la demande de ${inviterName}, qui utilise PatchFlow.`,
      });
      const subjA = `${inviterNameRaw} vous invite sur le show « ${showNameRaw} »`;
      await transporter.sendMail({ from: `PatchFlow <${SMTP_USER}>`, to: normalEmail, subject: subjA, ...mail })
        .then(() => logEmail('invite-member', 'invite', normalEmail, subjA))
        .catch((e: unknown) => logEmail('invite-member', 'invite', normalEmail, subjA, e));

      return json(200, { ok: true, action: 'invite_sent' });

    } else {
      /* Utilisateur sans compte → invitation en attente + email nodemailer.
         On n'utilise PAS inviteUserByEmail (GoTrue) pour éviter le double email
         (GoTrue envoie son propre email, et si GoTrue échoue le fallback envoie
         un second email → doublon systématique). On envoie un unique email
         via nodemailer avec un lien vers l'inscription. */

      const { data: invRow, error: invErr } = await sbAdmin.from('show_invites').upsert({
        show_id: showId,
        invited_email: normalEmail,
        role,
        invited_by: caller.id,
        show_name: showNameRaw,
        inviter_name: inviterNameRaw,
        created_at: new Date().toISOString(),
      }, { onConflict: 'show_id,invited_email' }).select('id').maybeSingle();
      if (invErr) throw invErr;
      const inviteId = invRow?.id || '';

      const acceptUrl = `${SITE_URL}/app.html?invite=${inviteId}`;
      const mail = renderEmail({
        tag: 'Invitation', title: `${inviterName} vous invite sur PatchFlow`, preheader: `Rejoignez « ${showName} » : création du compte en une minute.`,
        body: p(`<strong style="color:#101828">${inviterName}</strong> vous invite à collaborer sur PatchFlow, l'outil de préparation technique des équipes son et scène : input lists, patchs, plans, RF et riders partagés.`) +
          details([['Show', showName], ['Rôle', roleLabel(role)], ['Invité', escHtml(normalEmail)]]) +
          p(`Créez votre compte avec <strong style="color:#101828">${escHtml(normalEmail)}</strong> : le show vous attendra dès votre inscription. L'inscription est gratuite.`),
        cta: { label: 'Créer mon compte', url: acceptUrl }, fallback: true,
        note: 'Vous ne connaissez pas cette personne ? Ignorez cet e-mail : aucun compte n\'est créé sans vous.',
        reason: `Cet e-mail a été envoyé à ${escHtml(normalEmail)} à la demande de ${inviterName}, qui utilise PatchFlow.`,
      });
      const subjB = `${inviterNameRaw} vous invite sur PatchFlow : « ${showNameRaw} »`;
      try { await transporter.sendMail({ from: `PatchFlow <${SMTP_USER}>`, to: normalEmail, subject: subjB, ...mail }); }
      catch (e) { await logEmail('invite-member', 'invite', normalEmail, subjB, e); throw e; }
      await logEmail('invite-member', 'invite', normalEmail, subjB);

      return json(200, { ok: true, action: 'invite_sent' });
    }

  } catch (e) {
    console.error('invite-member error:', e);
    return json(500, { error: "Erreur lors de l'envoi de l'invitation" });
  }
});

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
