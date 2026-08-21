def otp_template(otp: str) -> str:
    return f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sign in to Duolicious</title>
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
                        <td bgcolor="#f1e5ff" align="center" style="color: #70f;">
                            <p style="color: #70f; font-size: 16px">Your one-time password is:</p>
                            <table cellspacing="0" cellpadding="0" border="0" align="center">
                                <tr>
                                    <td bgcolor="#70f" style="font-weight: 900; font-size: 32px; color: white; padding: 15px; border-radius: 15px;">{otp}</td>
                                </tr>
                            </table>
                            <p style="color: #70f; font-size: 16px">If you didn’t request this, you can ignore this message.</p>
                        </td>
                    </tr>
                    <tr>
                        <td bgcolor="#f1e5ff" height="20">&nbsp;</td>
                    </tr>
                    <tr>
                        <td bgcolor="#70f" height="50">&nbsp;</td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
"""
