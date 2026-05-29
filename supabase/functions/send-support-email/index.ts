import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/* ── SMTP via o2switch ── */
const SMTP_HOST     = Deno.env.get('SMTP_HOST')     ?? '';
const SMTP_PORT     = parseInt(Deno.env.get('SMTP_PORT') ?? '465');
const SMTP_USER     = Deno.env.get('SMTP_USER')     ?? '';
const SMTP_PASS     = Deno.env.get('SMTP_PASS')     ?? '';
const SUPPORT_EMAIL = Deno.env.get('SUPPORT_EMAIL') ?? 'support@patchflow.app';
const FROM_NAME     = 'PatchFlow Support';

/* Rate limit: max 3 tickets per user per 24h */
const MAX_PER_DAY = 3;

async function sendEmail(to: string, subject: string, html: string) {
  // Use Deno SMTP library
  const { SmtpClient } = await import('https://deno.land/x/smtp@v0.7.0/mod.ts');
  const client = new SmtpClient();
  await client.connectTLS({ hostname: SMTP_HOST, port: SMTP_PORT, username: SMTP_USER, password: SMTP_PASS });
  await client.send({
    from: `${FROM_NAME} <${SMTP_USER}>`,
    to,
    subject,
    content: html,
    mimeType: 'text/html',
  });
  await client.close();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Non autorise' }), { status: 401, headers: CORS });

    /* Init Supabase with user's token */
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    /* Get current user */
    const { data: { user }, error: authErr } = await sb.auth.getUser();
    if (authErr || !user) return new Response(JSON.stringify({ error: 'Non autorise' }), { status: 401, headers: CORS });

    /* Parse body */
    const { subject, message, userName } = await req.json();
    if (!subject || !message?.trim()) {
      return new Response(JSON.stringify({ error: 'Sujet et message requis' }), { status: 400, headers: CORS });
    }

    /* Rate limiting: count tickets in last 24h */
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await sb
      .from('support_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', since);

    if ((count ?? 0) >= MAX_PER_DAY) {
      return new Response(
        JSON.stringify({ error: `Limite atteinte : max ${MAX_PER_DAY} messages par 24h.` }),
        { status: 429, headers: CORS }
      );
    }

    /* Save ticket to DB */
    const { error: insertErr } = await sb.from('support_tickets').insert({
      user_id: user.id,
      user_email: user.email,
      user_name: userName || user.user_metadata?.full_name || '',
      subject,
      message: message.trim(),
    });
    if (insertErr) throw insertErr;

    const userName2 = userName || user.user_metadata?.full_name || user.email;
    const now = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });

    /* ── Auto-reply to user ── */
    const userHtml = `
<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/></head>
<body style="font-family:Outfit,sans-serif;background:#f4f6fb;margin:0;padding:32px">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)">
  <div style="background:#1d3a5f;padding:24px 28px;display:flex;align-items:center;gap:12px">
    <span style="font-size:22px;font-weight:800;color:#fff">PatchFlow</span>
    <span style="font-size:12px;color:#ff6b1a;font-weight:700;background:rgba(255,107,26,.15);padding:3px 9px;border-radius:20px">Support</span>
  </div>
  <div style="padding:28px">
    <p style="font-size:15px;font-weight:600;color:#1d3a5f;margin:0 0 10px">Bonjour ${userName2},</p>
    <p style="font-size:13px;color:#475569;line-height:1.6;margin:0 0 18px">
      Nous avons bien reçu votre message concernant <strong>"${subject}"</strong>.<br/>
      Notre équipe vous répondra dans les plus brefs délais, généralement sous 24 à 48h.
    </p>
    <div style="background:#f8fafc;border-left:3px solid #ff6b1a;border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:20px">
      <p style="font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px">Votre message</p>
      <p style="font-size:13px;color:#334155;line-height:1.5;margin:0;white-space:pre-wrap">${message.trim()}</p>
    </div>
    <p style="font-size:12px;color:#94a3b8;margin:0">
      Message envoyé le ${now}<br/>
      Pour toute urgence : <a href="mailto:${SUPPORT_EMAIL}" style="color:#ff6b1a">${SUPPORT_EMAIL}</a>
    </p>
  </div>
  <div style="background:#f8fafc;padding:14px 28px;border-top:1px solid #e2e8f0">
    <p style="font-size:11px;color:#94a3b8;margin:0;text-align:center">
      © ${new Date().getFullYear()} PatchFlow · <a href="https://patchflow.app" style="color:#ff6b1a;text-decoration:none">patchflow.app</a>
    </p>
  </div>
</div>
</body></html>`;

    /* ── Notification to support team ── */
    const teamHtml = `
<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/></head>
<body style="font-family:Outfit,sans-serif;background:#0f1525;margin:0;padding:32px">
<div style="max-width:560px;margin:0 auto;background:#1a2340;border-radius:12px;overflow:hidden;border:1px solid #2c3f5f">
  <div style="background:#ff6b1a;padding:16px 24px">
    <p style="color:#fff;font-weight:800;font-size:16px;margin:0">🎧 Nouveau ticket support</p>
    <p style="color:rgba(255,255,255,.8);font-size:12px;margin:4px 0 0">${now}</p>
  </div>
  <div style="padding:24px">
    <table style="width:100%;border-collapse:collapse;margin-bottom:18px">
      <tr><td style="padding:6px 0;font-size:11px;color:#64748b;width:100px">Utilisateur</td>
          <td style="padding:6px 0;font-size:13px;color:#e2e8f0;font-weight:600">${userName2}</td></tr>
      <tr><td style="padding:6px 0;font-size:11px;color:#64748b">Email</td>
          <td style="padding:6px 0;font-size:13px;color:#ff6b1a">${user.email}</td></tr>
      <tr><td style="padding:6px 0;font-size:11px;color:#64748b">Sujet</td>
          <td style="padding:6px 0;font-size:13px;color:#e2e8f0;font-weight:600">${subject}</td></tr>
    </table>
    <div style="background:#0f1525;border-radius:8px;padding:16px;border:1px solid #2c3f5f">
      <p style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px">Message</p>
      <p style="font-size:13px;color:#cbd5e1;line-height:1.6;margin:0;white-space:pre-wrap">${message.trim()}</p>
    </div>
    <div style="margin-top:18px;padding:12px;background:rgba(255,107,26,.08);border-radius:8px;border:1px solid rgba(255,107,26,.2)">
      <p style="font-size:12px;color:#94a3b8;margin:0">
        Répondre directement à : <a href="mailto:${user.email}" style="color:#ff6b1a">${user.email}</a>
      </p>
    </div>
  </div>
</div>
</body></html>`;

    /* Send both emails in parallel */
    await Promise.all([
      sendEmail(user.email!, `[PatchFlow] Votre message a bien été reçu — ${subject}`, userHtml),
      sendEmail(SUPPORT_EMAIL, `[Support] ${subject} — ${userName2} (${user.email})`, teamHtml),
    ]);

    return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS });
  }
});
