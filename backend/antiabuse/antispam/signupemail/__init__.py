from antiabuse.antispam.signupemail.sql import *
from dataclasses import dataclass
from database import api_tx
from pathlib import Path

dot_insignificant_email_domains = set([
    "gmail.com",
    "googlemail.com",
])

plus_address_domains = set([
    "fastmail.com",
    "fastmail.fm",
    "gmail.com",
    "googlemail.com",
    "hotmail.co.uk",
    "hotmail.com",
    "hotmail.de",
    "hotmail.fr",
    "icloud.com",
    "live.com",
    "outlook.com",
    "pm.me",
    "proton.me",
    "protonmail.com",
    "zoho.com",
    "zohomail.com",
])

@dataclass(frozen=True)
class EmailInfo:
    domain_ok: bool
    registered: bool


async def get_email_info(email: str, normalized_email: str) -> EmailInfo:
    _, domain = email.split('@')

    params = dict(
        email=email,
        normalized_email=normalized_email,
        domain=domain,
    )

    # Check if we already know about the email domain
    async with api_tx() as tx:
        row = await tx.require_one(Q_EMAIL_INFO, params=params)

    domain_status = row['domain_status']

    if domain_status == 'registered':
        domain_ok = True
    elif domain_status == 'unregistered-good':
        domain_ok = True
    elif domain_status == 'unregistered-bad':
        domain_ok = False
    elif domain_status == 'unregistered-unknown':
        domain_ok = False
    else:
        raise Exception('Unhandled domain status')

    return EmailInfo(domain_ok=domain_ok, registered=row['registered'])


def normalize_email_case(email: str) -> str:
    return email.lower()


def normalize_email_dots(email: str) -> str:
    name, domain = email.split('@')

    if domain not in dot_insignificant_email_domains:
        return email

    name = name.replace('.', '')

    return f'{name}@{domain}'


def normalize_email_pluses(email: str) -> str:
    name, domain = email.split('@')

    if domain not in plus_address_domains:
        return email

    name, *_ = name.split('+')

    return f'{name}@{domain}'

def normalize_email_domain(email: str) -> str:
    name, domain = email.split('@')

    if domain != 'googlemail.com':
        return email

    return f'{name}@gmail.com'


def normalize_email(email: str) -> str:
    if not email:
        return ''

    email = normalize_email_case(email)
    email = normalize_email_dots(email)
    email = normalize_email_pluses(email)
    email = normalize_email_domain(email)

    return email
