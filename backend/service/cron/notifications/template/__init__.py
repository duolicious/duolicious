from urllib.parse import urlencode

VISITOR_PART = 'Someone visited your profile!'

def message_part(has_intro: bool, has_chat: bool) -> str | None:
    if has_intro and has_chat:
        return 'You have new messages in your chats and intros!'
    if has_intro:
        return 'You have a new message in your intros!'
    if has_chat:
        return 'You have a new message in your chats!'
    return None

def big_part(has_intro: bool, has_chat: bool, has_visitor: bool) -> str:
    message = message_part(has_intro, has_chat)
    if message and has_visitor:
        return f'{message} {VISITOR_PART}'
    if message:
        return message
    if has_visitor:
        return VISITOR_PART
    return (
        "Our notifier is broken 😵‍💫. Please report this "
        "to support@duolicious.app")

def little_part(has_intro: bool, has_chat: bool, has_visitor: bool) -> str:
    if has_visitor and not has_intro and not has_chat:
        return 'Open the app to see who'
    if has_visitor:
        return 'Open the app to catch up'
    if has_intro and has_chat:
        return 'Open the app to read them'
    return 'Open the app to read it'

def subject_line(has_intro: bool, has_chat: bool, has_visitor: bool) -> str:
    if has_visitor and not has_intro and not has_chat:
        return 'Someone visited your profile 👀'
    return 'You have a new message 😍'

def frequency_url(email: str, type: str, frequency: str) -> str:
    base_url = 'https://api.duolicious.app/update-notifications'
    params = {
        'email': email,
        'type': type,
        'frequency': frequency
    }
    encoded_params = urlencode(params)
    return f'{base_url}?{encoded_params}'

def open_url(has_intro: bool, has_chat: bool, has_visitor: bool) -> str:
    if has_visitor and not has_intro and not has_chat:
        return 'https://get.duolicious.app/visitors'
    return 'https://get.duolicious.app/inbox'

def emailtemplate(
    email: str,
    has_intro: bool,
    has_chat: bool,
    has_visitor: bool,
) -> str:
    return f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{subject_line(has_intro, has_chat, has_visitor)}</title>
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
                            <p style="color: #70f; font-size: 24px; font-weight: 900;">{big_part(has_intro, has_chat, has_visitor)}</p>
                            <p style="color: #70f; font-size: 16px">{little_part(has_intro, has_chat, has_visitor)}</p>
                        </td>
                    </tr>
                    <tr>
                      <td bgcolor="#f1e5ff" align="center" style="padding-bottom:25px">
                        <table border="0" cellspacing="0" cellpadding="0">
                          <tbody><tr>
                            <td style="border-radius:50px; border:3px solid #70f; font-size: 20px; line-height:26px; color: #70f; text-align:center; min-width:auto!important">
                              <a href="{open_url(has_intro, has_chat, has_visitor)}" style="display:block;padding:11px 40px;text-decoration:none;color:#70f" target="_blank">
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
                                    <a href="{frequency_url(email, 'Chats', 'Immediately')}"  style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Immediately</a> |
                                    <a href="{frequency_url(email, 'Chats', 'Daily')}"        style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Daily</a> |
                                    <a href="{frequency_url(email, 'Chats', 'Every 3 days')}" style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Every 3 days</a> |
                                    <a href="{frequency_url(email, 'Chats', 'Weekly')}"       style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Weekly</a> |
                                    <a href="{frequency_url(email, 'Chats', 'Never')}"        style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Never</a>
                                </span>
                                <br/>
                                <br/>
                                <span>Intros:
                                    <a href="{frequency_url(email, 'Intros', 'Immediately')}"  style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Immediately</a> |
                                    <a href="{frequency_url(email, 'Intros', 'Daily')}"        style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Daily</a> |
                                    <a href="{frequency_url(email, 'Intros', 'Every 3 days')}" style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Every 3 days</a> |
                                    <a href="{frequency_url(email, 'Intros', 'Weekly')}"       style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Weekly</a> |
                                    <a href="{frequency_url(email, 'Intros', 'Never')}"        style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Never</a>
                                </span>
                                <br/>
                                <br/>
                                <span>Visitors:
                                    <a href="{frequency_url(email, 'Visitors', 'Immediately')}"  style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Immediately</a> |
                                    <a href="{frequency_url(email, 'Visitors', 'Daily')}"        style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Daily</a> |
                                    <a href="{frequency_url(email, 'Visitors', 'Every 3 days')}" style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Every 3 days</a> |
                                    <a href="{frequency_url(email, 'Visitors', 'Weekly')}"       style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Weekly</a> |
                                    <a href="{frequency_url(email, 'Visitors', 'Never')}"        style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Never</a>
                                </span>
                                <p>
                                    <a href="{frequency_url(email, 'Every', 'Never')}" style="font-weight: 400; color: #bbb; padding: 3px; text-decoration: none;">Unsubscribe all</a>
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
