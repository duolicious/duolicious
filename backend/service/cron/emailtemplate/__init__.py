from urllib.parse import urlencode

from serviceshared.unsubscribe import person_token

def frequency_url(person_uuid: str, type: str, frequency: str) -> str:
    base_url = 'https://api.duolicious.app/update-notifications'
    params = {
        'token': person_token(person_uuid),
        'type': type,
        'frequency': frequency
    }
    encoded_params = urlencode(params)
    return f'{base_url}?{encoded_params}'

def notification_emailtemplate(
    person_uuid: str,
    subject: str,
    big: str,
    little: str,
    url: str,
) -> str:
    return f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{subject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif;">
    <table width="100%" cellspacing="0" cellpadding="0" border="0" align="center">
        <tr>
            <td align="center">
                <table style="max-width: 600px; width: 100%;" cellspacing="0" cellpadding="0" border="0" align="center">
                    <tr>
                        <td bgcolor="#70f" align="center">
                            <img src="https://email-assets.duolicious.app/header-logo.png" alt="Duolicious Logo" width="108" height="50" />
                        </td>
                    </tr>
                    <tr>
                        <td bgcolor="#f1e5ff" height="20">&nbsp;</td>
                    </tr>
                    <tr>
                        <td bgcolor="#f1e5ff" align="center" style="color: #70f; padding-left: 20px; padding-right: 20px; padding-bottom: 40px;">
                            <p style="color: #70f; font-size: 24px; font-weight: 900;">{big}</p>
                            <p style="color: #70f; font-size: 16px">{little}</p>
                        </td>
                    </tr>
                    <tr>
                      <td bgcolor="#f1e5ff" align="center" style="padding-bottom:25px">
                        <table border="0" cellspacing="0" cellpadding="0">
                          <tbody><tr>
                            <td style="border-radius:50px; border:3px solid #70f; font-size: 20px; line-height:26px; color: #70f; text-align:center; min-width:auto!important">
                              <a href="{url}" style="display:block;padding:11px 40px;text-decoration:none;color:#70f" target="_blank">
                                <span style="text-decoration:none;color:#70f">
                                  <strong>
                                    Open Duolicious
                                  </strong>
                                </span>
                              </a>
                            </td>
                          </tr>
                        </tbody></table>
                      </td>
                    </tr>
                    <tr>
                        <td bgcolor="#f1e5ff" height="20">&nbsp;</td>
                    </tr>
                    <tr>
                        <td bgcolor="#70f" height="50">&nbsp;</td>
                    </tr>
                    <tr>
                        <td style="font-weight: 900; color: #999; font-size: 13px; background-color: #fff; padding: 10px 0; text-align: center;">
                            <div>
                                <p>Getting too many notifications? You can put a cap on how often you get them:</p>
                                <span>Chats:
                                    <a href="{frequency_url(person_uuid, 'Chats', 'Immediately')}"  style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Immediately</a> |
                                    <a href="{frequency_url(person_uuid, 'Chats', 'Daily')}"        style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Daily</a> |
                                    <a href="{frequency_url(person_uuid, 'Chats', 'Every 3 days')}" style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Every 3 days</a> |
                                    <a href="{frequency_url(person_uuid, 'Chats', 'Weekly')}"       style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Weekly</a> |
                                    <a href="{frequency_url(person_uuid, 'Chats', 'Never')}"        style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Never</a>
                                </span>
                                <br/>
                                <br/>
                                <span>Intros:
                                    <a href="{frequency_url(person_uuid, 'Intros', 'Immediately')}"  style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Immediately</a> |
                                    <a href="{frequency_url(person_uuid, 'Intros', 'Daily')}"        style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Daily</a> |
                                    <a href="{frequency_url(person_uuid, 'Intros', 'Every 3 days')}" style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Every 3 days</a> |
                                    <a href="{frequency_url(person_uuid, 'Intros', 'Weekly')}"       style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Weekly</a> |
                                    <a href="{frequency_url(person_uuid, 'Intros', 'Never')}"        style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Never</a>
                                </span>
                                <br/>
                                <br/>
                                <span>Visitors:
                                    <a href="{frequency_url(person_uuid, 'Visitors', 'Immediately')}"  style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Immediately</a> |
                                    <a href="{frequency_url(person_uuid, 'Visitors', 'Daily')}"        style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Daily</a> |
                                    <a href="{frequency_url(person_uuid, 'Visitors', 'Every 3 days')}" style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Every 3 days</a> |
                                    <a href="{frequency_url(person_uuid, 'Visitors', 'Weekly')}"       style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Weekly</a> |
                                    <a href="{frequency_url(person_uuid, 'Visitors', 'Never')}"        style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Never</a>
                                </span>
                                <p>
                                    <a href="{frequency_url(person_uuid, 'Every', 'Never')}" style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Unsubscribe all</a>
                                </p>
                            </div>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    """
