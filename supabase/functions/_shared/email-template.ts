// Gedeelde e-mailtemplate voor herinneringen (email-remind + test-email).
export function buildReminderEmail(name: string, stageName: string, deadlineStr: string, appUrl: string): string {
  return `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:#111111;padding:24px 32px;text-align:center;">
            <span style="font-size:28px;">🚴</span>
            <span style="display:block;color:#f5c518;font-size:20px;font-weight:700;letter-spacing:-0.5px;margin-top:6px;">Bagagedrager</span>
            <span style="display:block;color:#888;font-size:12px;margin-top:2px;">Het Wielerspel</span>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 8px;font-size:15px;color:#444;">Hoi <strong>${name}</strong>,</p>
            <p style="margin:0 0 24px;font-size:15px;color:#444;line-height:1.6;">
              Je hebt nog <strong>geen renner gekozen</strong> voor<br>
              <span style="font-size:18px;font-weight:700;color:#111;">${stageName}</span>
            </p>
            <!-- Deadline box -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr>
                <td style="background:#fff8e1;border-left:4px solid #f5c518;border-radius:4px;padding:14px 16px;">
                  <span style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;">Deadline</span><br>
                  <span style="font-size:15px;font-weight:600;color:#111;">${deadlineStr}</span>
                </td>
              </tr>
            </table>
            <!-- CTA -->
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#f5c518;border-radius:8px;">
                  <a href="${appUrl}/#pick" style="display:inline-block;padding:13px 28px;color:#111111;font-weight:700;font-size:15px;text-decoration:none;">Maak je keuze →</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:16px 32px 24px;border-top:1px solid #f0f0f0;">
            <p style="margin:0;font-size:12px;color:#aaa;line-height:1.5;">
              Je ontvangt deze mail omdat je e-mailherinneringen hebt ingeschakeld.<br>
              Uitschakelen kan via <a href="${appUrl}/#account" style="color:#888;">Account → Deadline herinneringen</a>.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
