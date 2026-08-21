from dataclasses import dataclass
import logging
import re

from serviceshared.duoenv.shared import REPORT_EMAIL

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EmailEntry:
    email: str
    count: int


def parse_email_string(email_string: str) -> list[EmailEntry]:
    # Regular expression to match an email followed optionally by a number
    pattern = r'(\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b)(?:\s+(\d+))?'
    matches = re.findall(pattern, email_string)

    result = []
    for email, count in matches:
        # If no number is given, default to 1
        if count == '':
            count = 1
        else:
            count = int(count)
        result.append(EmailEntry(email, count))

    return result


REPORT_EMAILS = parse_email_string(REPORT_EMAIL)
PRIMARY_REPORT_EMAIL = REPORT_EMAILS[0].email
logger.info(f'Report emails: {REPORT_EMAILS}')


SHADOW_BAN_REPORT_THRESHOLD = 2

# A reporter's account must satisfy all of these before its reports count
# toward the shadow-ban automod.
TRUSTWORTHY_MIN_ACCOUNT_AGE_DAYS = 30
TRUSTWORTHY_MIN_BIO_LENGTH = 10
TRUSTWORTHY_MIN_PEOPLE_MESSAGED = 5
TRUSTWORTHY_MIN_QUESTIONS_ANSWERED = 10
