import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.9';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SMTP_HOST      = Deno.env.get('SMTP_HOST')      ?? '';
const SMTP_PORT      = parseInt(Deno.env.get('SMTP_PORT') ?? '465');
const SMTP_USER      = Deno.env.get('SMTP_USER')      ?? '';
const SMTP_PASS      = Deno.env.get('SMTP_PASS')      ?? '';
const SUPPORT_EMAIL  = Deno.env.get('SUPPORT_EMAIL')  ?? 'support@patchflow.fr';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';

const MAX_PER_DAY = 3;

/* Transport SMTP via nodemailer — MÊME méthode que invite-member, qui délivre
   de façon fiable vers des domaines externes (gmail, yahoo, etc.). L'ancien
   SMTP fait-main échouait silencieusement sur le relay externe → le client
   ne recevait jamais sa confirmation. */
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  tls: { rejectUnauthorized: false },
});

/* Email via Resend API (optionnel) — utilisé seulement si RESEND_API_KEY est
   défini ; sinon on passe par nodemailer/SMTP (chemin par défaut, éprouvé). */
async function sendEmailResend(to: string, subject: string, html: string): Promise<void> {
  const fromEmail = SMTP_USER || 'noreply@patchflow.fr';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `PatchFlow <${fromEmail}>`, to: [to], subject, html }),
  });
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`);
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (RESEND_API_KEY) {
    await sendEmailResend(to, subject, html);
  } else if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    await transporter.sendMail({ from: `PatchFlow <${SMTP_USER}>`, to, subject, html });
  } else {
    throw new Error('Aucun service email configuré (RESEND_API_KEY ou SMTP_* requis)');
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Non autorisé' }, 401);

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authErr } = await sb.auth.getUser();
    if (authErr || !user) return json({ error: 'Non autorisé' }, 401);

    const body = await req.json();
    const { subject, message, userName } = body as { subject?: string; message?: string; userName?: string };

    if (!message?.trim()) {
      return json({ error: 'Message requis' }, 400);
    }
    const subjectSafe = (subject || 'Support PatchFlow').slice(0, 200);
    const messageSafe = message.trim().slice(0, 5000);

    /* Rate limiting */
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await sb
      .from('support_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', since);

    if ((count ?? 0) >= MAX_PER_DAY) {
      return json({ error: `Limite atteinte : max ${MAX_PER_DAY} messages par 24h.` }, 429);
    }

    /* Save ticket en base */
    const { error: insertErr } = await sb.from('support_tickets').insert({
      user_id: user.id,
      user_email: user.email,
      user_name: userName || user.user_metadata?.full_name || '',
      subject: subjectSafe,
      message: messageSafe,
    });
    if (insertErr) {
      console.error('insert ticket:', insertErr);
      // Non bloquant : on continue l'envoi même si la DB échoue
    }

    // Échappement HTML pour empêcher l'injection de markup/liens (phishing) dans les emails
    const esc = (s: string) => String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const displayNameRaw = userName || user.user_metadata?.full_name || user.email || 'Utilisateur';
    const displayName  = esc(displayNameRaw);
    const subjectHtml  = esc(subjectSafe);
    const messageHtml  = esc(messageSafe);
    const now = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });

    /* Auto-reply to user */
    const userHtml = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/></head>
<body style="font-family:sans-serif;background:#f4f6fb;margin:0;padding:32px">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)">
  <div style="background:#1d3a5f;padding:24px 28px">
    <span style="font-size:22px;font-weight:800;color:#fff">PatchFlow</span>
    <span style="font-size:12px;color:#ff6b1a;font-weight:700;background:rgba(255,107,26,.15);padding:3px 9px;border-radius:20px;margin-left:10px">Support</span>
  </div>
  <div style="padding:28px">
    <p style="font-size:15px;font-weight:600;color:#1d3a5f;margin:0 0 10px">Bonjour ${displayName},</p>
    <p style="font-size:13px;color:#475569;line-height:1.6;margin:0 0 18px">
      Nous avons bien reçu votre message concernant <strong>&quot;${subjectHtml}&quot;</strong>.<br/>
      Notre équipe vous répondra dans les plus brefs délais (24 à 48h).
    </p>
    <div style="background:#f8fafc;border-left:3px solid #ff6b1a;border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:20px">
      <p style="font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px">Votre message</p>
      <p style="font-size:13px;color:#334155;line-height:1.5;margin:0;white-space:pre-wrap">${messageHtml}</p>
    </div>
    <p style="font-size:12px;color:#94a3b8;margin:0">Envoyé le ${now}</p>
  </div>
  <div style="background:#f8fafc;padding:14px 28px;border-top:1px solid #e2e8f0;text-align:center">
    <p style="font-size:11px;color:#94a3b8;margin:0">© ${new Date().getFullYear()} PatchFlow · <a href="https://patchflow.fr" style="color:#ff6b1a;text-decoration:none">patchflow.fr</a></p>
  </div>
</div></body></html>`;

    /* Team notification */
    const teamHtml = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/></head>
<body style="font-family:sans-serif;background:#0f1525;margin:0;padding:32px">
<div style="max-width:560px;margin:0 auto;background:#1a2340;border-radius:12px;overflow:hidden;border:1px solid #2c3f5f">
  <div style="background:#ff6b1a;padding:16px 24px">
    <p style="color:#fff;font-weight:800;font-size:16px;margin:0">&#127911; Nouveau ticket support</p>
    <p style="color:rgba(255,255,255,.8);font-size:12px;margin:4px 0 0">${now}</p>
  </div>
  <div style="padding:24px">
    <table style="width:100%;border-collapse:collapse;margin-bottom:18px">
      <tr><td style="padding:6px 0;font-size:11px;color:#64748b;width:100px">Utilisateur</td>
          <td style="padding:6px 0;font-size:13px;color:#e2e8f0;font-weight:600">${displayName}</td></tr>
      <tr><td style="padding:6px 0;font-size:11px;color:#64748b">Email</td>
          <td style="padding:6px 0;font-size:13px;color:#ff6b1a">${esc(user.email ?? '')}</td></tr>
      <tr><td style="padding:6px 0;font-size:11px;color:#64748b">Sujet</td>
          <td style="padding:6px 0;font-size:13px;color:#e2e8f0;font-weight:600">${subjectHtml}</td></tr>
    </table>
    <div style="background:#0f1525;border-radius:8px;padding:16px;border:1px solid #2c3f5f">
      <p style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px">Message</p>
      <p style="font-size:13px;color:#cbd5e1;line-height:1.6;margin:0;white-space:pre-wrap">${messageHtml}</p>
    </div>
    <div style="margin-top:16px;padding:12px;background:rgba(255,107,26,.08);border-radius:8px;border:1px solid rgba(255,107,26,.2)">
      <p style="font-size:12px;color:#94a3b8;margin:0">Répondre à : <a href="mailto:${esc(user.email ?? '')}" style="color:#ff6b1a">${esc(user.email ?? '')}</a></p>
    </div>
  </div>
</div></body></html>`;

    /* 1. Notification équipe support (domaine interne) */
    let teamOk = false;
    try {
      await sendEmail(SUPPORT_EMAIL, `[Support] ${subjectSafe} — ${displayNameRaw} (${user.email})`, teamHtml);
      teamOk = true;
    } catch (teamErr) {
      console.error('[send-support-email] Notification support échouée:', teamErr instanceof Error ? teamErr.message : teamErr);
    }

    /* 2. Confirmation au client (même transport nodemailer/SMTP éprouvé) */
    let clientOk = false;
    try {
      await sendEmail(user.email!, `[PatchFlow] Votre message a bien été reçu — ${subjectSafe}`, userHtml);
      clientOk = true;
    } catch (emailErr) {
      console.error('[send-support-email] Confirmation client échouée:', emailErr instanceof Error ? emailErr.message : emailErr);
    }

    return json({ ok: true, teamOk, clientOk });

  } catch (e) {
    console.error('[send-support-email]', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
