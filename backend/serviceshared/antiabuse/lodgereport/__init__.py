from serviceshared.database import (
    api_tx,
    row_bool,
    row_int,
    row_str,
    row_str_list,
    row_value,
)
from serviceshared.antiabuse.sql import (
    Q_LAST_MESSAGES,
    Q_MAKE_REPORT,
    Q_INSERT_SKIPPED,
    Q_TRUSTWORTHY_REPORTS,
    Q_SHADOW_BAN,
)
from serviceshared.antiabuse.lodgereport.constants import (
    PRIMARY_REPORT_EMAIL,
    REPORT_EMAILS,
    SHADOW_BAN_REPORT_THRESHOLD,
    TRUSTWORTHY_MIN_ACCOUNT_AGE_DAYS,
    TRUSTWORTHY_MIN_BIO_LENGTH,
    TRUSTWORTHY_MIN_PEOPLE_MESSAGED,
    TRUSTWORTHY_MIN_QUESTIONS_ANSWERED,
)
from serviceshared.smtp import aws_smtp
import logging
import threading
import html
import yaml
from io import StringIO
import re
import random
from collections.abc import Mapping, Sequence
from typing import Literal
from serviceshared.antiabuse.lodgereport.constants import EmailEntry

logger = logging.getLogger(__name__)

ReportSource = Literal['member report', 'profile reporter', 'chat model']


def _repack_last_messages_in_place(
    last_messages: list[dict[str, object]],
) -> None:
    for i in range(len(last_messages)):
        m = last_messages[i]

        last_messages[i] = { row_str(m, 'sent_by'): row_value(m, 'body') }


def _obj_to_yaml_string(obj: object) -> str:
    class IndentDumper(yaml.Dumper):
        def increase_indent(
            self,
            flow: bool = False,
            indentless: bool = False,
        ) -> None:
            super(IndentDumper, self).increase_indent(flow, False)

    output = StringIO()
    yaml.dump(obj, output, indent=2, allow_unicode=True, Dumper=IndentDumper)
    return output.getvalue()


def _photo_links_to_html(photo_links: Sequence[str]) -> str:
    def link_to_html(photo_link: str) -> str:
        return f'''
            <img src="{photo_link}" style="max-width: 200px;
            max-height: 200px; width: auto; height: auto;
            border: 1px solid black;">
            '''

    return ''.join(
        link_to_html(l) + ('<br>' if ((i + 1) % 3 == 0 and i > 0) else '')
        for i, l in enumerate(photo_links)
    )


def report_template(
    report_obj: Sequence[Mapping[str, object]],
    reason: str,
    last_messages: list[dict[str, object]],
) -> str:
    reporter_token = row_str(report_obj[0], 'token')
    accused_token = row_str(report_obj[1], 'token')

    accused_photo_links = row_str_list(report_obj[1], 'photo_links')

    object_person_id = row_value(report_obj[1], 'id')

    _repack_last_messages_in_place(last_messages)

    report_str = _obj_to_yaml_string(report_obj)
    last_messages_str = _obj_to_yaml_string(last_messages)

    safe_report_str = html.escape(report_str)
    safe_reason = html.escape(reason)
    safe_last_messages = html.escape(last_messages_str)

    accused_img_html = _photo_links_to_html(accused_photo_links)

    return f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Report</title>
</head>
<body>

<pre>
{safe_report_str}
</pre>


<p><b>Accused person's images:</b></p>
{accused_img_html}


<p><b>Messages:</b></p>
<pre>
{safe_last_messages}
</pre>


<p><b>Reporter's reason:</b></p>
<pre>
{safe_reason}
</pre>


<p><b>Ban REPORTING user for one month:</b></p>
<a href="https://api.duolicious.app/admin/ban-link/{reporter_token}">
         https://api.duolicious.app/admin/ban-link/{reporter_token}
</a>

<br/>
<br/>

<p><b>Ban ACCUSED user for one month:</b></p>
<a href="https://api.duolicious.app/admin/ban-link/{accused_token}">
         https://api.duolicious.app/admin/ban-link/{accused_token}
</a>

</body>
</html>
"""


def _sample_email_addresses(email_entries: Sequence[EmailEntry]) -> str:
    # Extract the emails and their respective weights from the list of EmailEntry instances
    emails = [entry.email for entry in email_entries]
    weights = [entry.count for entry in email_entries]

    # Use random.choices() to perform weighted sampling and return a single email
    sampled_email = random.choices(emails, weights=weights, k=1)[0]  # Get the first item from the result

    return sampled_email


def report_subject(
    report_obj: Sequence[Mapping[str, object]],
    is_automoded: bool,
    is_shadow_banned: bool,
    underage_source: ReportSource | None,
) -> str:
    subject_person_id = row_int(report_obj[0], 'id')
    object_person_id = row_int(report_obj[1], 'id')
    times_reported = row_int(report_obj[1], 'times_reported')

    subject = f"Report: ({times_reported}) {subject_person_id} - {object_person_id}"

    if is_shadow_banned:
        subject += ' [automoded - shadow banned]'
    elif is_automoded:
        subject += ' [automoded]'

    if underage_source:
        subject += f' [underage - {underage_source}]'

    return subject


def _send_report_email(
    reason: str,
    report_obj: Sequence[Mapping[str, object]],
    last_messages: list[dict[str, object]],
    is_automoded: bool,
    is_shadow_banned: bool,
    underage_source: ReportSource | None,
) -> None:
    report_email = _sample_email_addresses(REPORT_EMAILS)

    try:
        aws_smtp.send(
            subject=report_subject(
                report_obj=report_obj,
                is_automoded=is_automoded,
                is_shadow_banned=is_shadow_banned,
                underage_source=underage_source,
            ),
            body=report_template(
                report_obj=report_obj,
                reason=reason,
                last_messages=last_messages,
            ),
            to_addr=report_email,
            from_addr=PRIMARY_REPORT_EMAIL,
        )
    except:
        logger.exception('Sending report email failed')


async def lodge_report(
    subject_uuid: str,
    object_uuid: str,
    reason: str,
    is_automoded: bool,
    is_shadow_banned: bool,
    underage_source: ReportSource | None,
    messages: list[dict[str, object]] | None,
) -> None:
    params = dict(
        subject_uuid=subject_uuid,
        object_uuid=object_uuid,
        reason=reason,
    )

    async with api_tx() as tx:
        last_messages = messages or await (await tx.execute(Q_LAST_MESSAGES, params=params)).fetchall()

        report_obj = await (await tx.execute(Q_MAKE_REPORT, params=params)).fetchall()

    # Fire-and-forget: the blocking SMTP send runs on its own thread so the
    # report request returns without waiting on email delivery.
    threading.Thread(
        target=_send_report_email,
        kwargs=dict(
            report_obj=report_obj,
            reason=reason,
            last_messages=last_messages,
            is_automoded=is_automoded,
            is_shadow_banned=is_shadow_banned,
            underage_source=underage_source,
        )
    ).start()


def _reason_matches(detection_pattern: str, reason: str) -> bool:
    clean_reason = ' '.join(re.sub('[^0-9a-zA-Z]+', ' ', reason).split())

    return bool(re.search(rf'\b({detection_pattern})\b', clean_reason, re.I))


def is_bot_report(reason: str) -> bool:
    return _reason_matches(
        r'fake|(cat\s*fish(ing)?)|scam|scammer|spam|spammer|bot|clanker|'
        r'not real|impersonating|impersonation',
        reason,
    )


def is_underage_report(reason: str) -> bool:
    return _reason_matches(
        r'minors?|under ?aged?|under (the age of )?(18|eighteen)|'
        r'(not|isn ?t|aren ?t|ain ?t) (even )?(18|eighteen|an adult)|'
        r'too young|child|kid|teens?|teenagers?|high ?school|'
        r'(is|s|are|re|am|m|im|be|aged?) (actually |only |just |really )?1[0-7]'
        r'(?! (min|minutes?|hours?|days?|weeks?|months?|years?|times|km|'
        r'miles?|cm|feet|ft|inches|kg|lbs?|pounds))|'
        r'1[0-7] ?(yo|y o|(years?|yrs?) old)',
        reason,
    )


def _should_shadow_ban(
    has_gold: bool,
    trustworthy_report_reasons: list[str],
) -> bool:
    if has_gold:
        return False

    bot_report_count = sum(
        1 for reason in trustworthy_report_reasons if is_bot_report(reason)
    )

    return bot_report_count >= SHADOW_BAN_REPORT_THRESHOLD


async def skip_by_uuid(
    subject_uuid: str,
    object_uuid: str,
    reason: str,
    source: ReportSource,
    messages: list[dict[str, object]] | None = None,
) -> None:
    is_underage_member_report = (
        source == 'member report' and is_underage_report(reason))

    params = dict(
        subject_uuid=subject_uuid,
        object_uuid=object_uuid,
        reported=bool(reason),
        report_reason=reason or '',
        requires_verification=(
            is_bot_report(reason) or is_underage_member_report),
    )

    is_shadow_banned = False

    async with api_tx() as tx:
        is_automoded = row_bool(
            await tx.require_one(Q_INSERT_SKIPPED, params=params),
            'is_automoded',
        )

        if reason:
            row = await tx.require_one(
                Q_TRUSTWORTHY_REPORTS,
                params=dict(
                    object_uuid=object_uuid,
                    min_account_age_days=TRUSTWORTHY_MIN_ACCOUNT_AGE_DAYS,
                    min_bio_length=TRUSTWORTHY_MIN_BIO_LENGTH,
                    min_people_messaged=TRUSTWORTHY_MIN_PEOPLE_MESSAGED,
                    min_questions_answered=TRUSTWORTHY_MIN_QUESTIONS_ANSWERED,
                ),
            )

            is_shadow_banned = _should_shadow_ban(
                has_gold=row_bool(row, 'has_gold'),
                trustworthy_report_reasons=row_str_list(
                    row,
                    'trustworthy_report_reasons',
                ),
            )

            if is_shadow_banned:
                await tx.execute(Q_SHADOW_BAN, params=params)

    if reason:
        await lodge_report(
            subject_uuid=subject_uuid,
            object_uuid=object_uuid,
            reason=reason,
            is_automoded=is_automoded,
            is_shadow_banned=is_shadow_banned,
            underage_source=(
                source
                if is_underage_member_report or source == 'chat model'
                else None),
            messages=messages,
        )
