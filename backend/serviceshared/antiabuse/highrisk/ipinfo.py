from functools import cache
from pathlib import Path

import maxminddb
from pydantic import BaseModel

_DIR = Path(__file__).parent


class _Names(BaseModel):
    en: str = ''


class _Country(BaseModel):
    names: _Names = _Names()


class _Continent(BaseModel):
    code: str = ''


class _Location(BaseModel):
    latitude: float | None = None
    longitude: float | None = None


class _City(BaseModel):
    country: _Country = _Country()
    continent: _Continent = _Continent()
    location: _Location = _Location()


class _Asn(BaseModel):
    autonomous_system_number: int | None = None
    autonomous_system_organization: str = ''


class IpInfo(BaseModel):
    country: str
    continent: str
    latitude: float | None
    longitude: float | None
    asn: int | None
    organization: str


@cache
def _readers() -> tuple[maxminddb.Reader, maxminddb.Reader]:
    return (
        maxminddb.open_database(str(_DIR / 'dbip-city-lite.mmdb')),
        maxminddb.open_database(str(_DIR / 'dbip-asn-lite.mmdb')),
    )


@cache
def lookup(ip: str) -> IpInfo:
    city_reader, asn_reader = _readers()
    city = _City.model_validate(city_reader.get(ip) or {})
    asn = _Asn.model_validate(asn_reader.get(ip) or {})
    return IpInfo(
        country=city.country.names.en,
        continent=city.continent.code,
        latitude=city.location.latitude,
        longitude=city.location.longitude,
        asn=asn.autonomous_system_number,
        organization=asn.autonomous_system_organization,
    )
