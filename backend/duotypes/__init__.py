from typing import (
    ClassVar,
    DefaultDict,
    Dict,
    List,
    Optional,
    Annotated,
    Literal,
    Union,
)
from collections.abc import MutableMapping
from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    EmailStr,
    Field,
    RootModel,
    StringConstraints,
    field_validator,
    model_validator,
    ValidationError,
    TypeAdapter,
)
from datetime import datetime, date
from dateutil.relativedelta import relativedelta
from PIL import Image
from pillow_heif import register_heif_opener
import constants
import io
import base64
import binascii
from duoaudio import transcode_and_trim_audio_from_base64
import traceback
import antiabuse.antirude.profile
from antiabuse.antispam.urldetector import has_url
from antiabuse.antispam.phonenumberdetector import detect_phone_numbers
from antiabuse.antispam.solicitation import has_solicitation
from util import human_readable_size_metric
from duohash import md5

register_heif_opener()

CLUB_PATTERN = r"""^[a-zA-Z0-9/#'":_-]+( [a-zA-Z0-9/#'":_-]+)*$"""
CLUB_MAX_LEN = 42
PATCH_PROFILE_INFO_LOOKUP_BASICS = frozenset({
    'orientation',
    'ethnicity',
    'looking_for',
    'smoking',
    'drinking',
    'drugs',
    'long_distance',
    'relationship_status',
    'has_kids',
    'wants_kids',
    'exercise',
    'religion',
    'star_sign',
})
PATCH_PROFILE_INFO_NULL_BASICS = frozenset({
    'occupation',
    'education',
    'height',
})
PATCH_PROFILE_INFO_NULLABLE_FIELDS = (
    PATCH_PROFILE_INFO_LOOKUP_BASICS | PATCH_PROFILE_INFO_NULL_BASICS
)


def _normalize_email_input(value: object) -> object:
    if not isinstance(value, str):
        return value
    return value.lower().strip() if value else ''


def _string_field(values: MutableMapping[str, object], key: str) -> str:
    value = values[key]
    if not isinstance(value, str):
        raise ValueError(f'Field {key} must be a valid string')
    return value


def _normalize_club_name(value: object) -> object:
    # Non-str values pass through so pydantic's type layer reports them
    # instead of this raising AttributeError.
    if not isinstance(value, str):
        return value
    return ' '.join(value.split()).lower()


ClubName = Annotated[
    str,
    BeforeValidator(_normalize_club_name),
    StringConstraints(pattern=CLUB_PATTERN, min_length=1, max_length=CLUB_MAX_LEN),
]

# Optional variant for /request-otp, /sign-in-with-google,
# /sign-in-with-apple, where the client passes a pending-club-invite name.
PendingClubName = Annotated[
    Optional[str],
    BeforeValidator(_normalize_club_name),
]

_club_name_adapter = TypeAdapter(ClubName)


def parse_club_name(value: object) -> Optional[str]:
    """Returns the canonical club name, or None if invalid. For call
    sites that want to 404 or skip on bad input rather than raise."""
    try:
        return _club_name_adapter.validate_python(value)
    except ValidationError:
        return None

HEX_COLOR_PATTERN = r"^#[0-9a-fA-F]{6}$"

MIN_NAME_LEN = 1
MAX_NAME_LEN = 64

MIN_ABOUT_LEN = 0
MAX_ABOUT_LEN = 10000

MAX_IMAGE_DIM = 5000
MIN_IMAGE_DIM = 50

MAX_GIF_DIM = 800
MIN_GIF_DIM = 10

MIN_PHOTO_POSITION = 1
MAX_PHOTO_POSITION = 7


def validate_gif_dimensions(larger_dim: int, smaller_dim: int) -> None:
    if larger_dim > MAX_GIF_DIM:
        raise ValueError(
                f'Image must be less than '
                f'{MAX_GIF_DIM}x{MAX_GIF_DIM} '
                'pixels')

    if smaller_dim < MIN_GIF_DIM:
        raise ValueError(
                f'Image must be greater than '
                f'{MIN_GIF_DIM}x{MIN_GIF_DIM} '
                'pixels')


def validate_image_dimensions(larger_dim: int, smaller_dim: int) -> None:
    if larger_dim > MAX_IMAGE_DIM:
        raise ValueError(
                f'Image must be less than '
                f'{MAX_IMAGE_DIM}x{MAX_IMAGE_DIM} '
                'pixels')

    if smaller_dim < MIN_IMAGE_DIM:
        raise ValueError(
                f'Image must be greater than '
                f'{MIN_IMAGE_DIM}x{MIN_IMAGE_DIM} '
                'pixels')


class ClubItem(BaseModel):
    name: str
    count_members: int
    search_preference: Optional[bool]


class Base64AudioFile(BaseModel):
    base64: str
    transcoded: bytes
    bytes: bytes

    @model_validator(mode='before')
    def convert_base64(cls, values: object) -> object:
        if not isinstance(values, dict):
            return values

        # Avoid performing transcoding a second time
        if 'base64' in values and 'bytes' in values and 'transcoded' in values:
            return values

        response = transcode_and_trim_audio_from_base64(
            _string_field(values, 'base64'))

        if isinstance(response, ValueError):
            raise response

        decoded_bytes, transcoded = response

        values['bytes'] = decoded_bytes
        values['transcoded'] = transcoded

        return values
    class Config:
        arbitrary_types_allowed = True

# Even though this class has a very generic name, it's used exclusively for
# uploading photos
class Base64File(BaseModel):
    position: int = Field(ge=MIN_PHOTO_POSITION, le=MAX_PHOTO_POSITION)
    base64: str
    bytes: bytes
    image: Image.Image
    top: int
    left: int
    md5_hash: str

    @model_validator(mode='before')
    def convert_base64(cls, values: object) -> object:
        if not isinstance(values, dict):
            return values

        try:
            base64_value = _string_field(values, 'base64').split(',')[-1]
        except:
            raise ValueError('Field base64 must be a valid base64 string')

        try:
            decoded_bytes = base64.b64decode(base64_value)
        except binascii.Error as e:
            raise ValueError(f'Field base64 must be a valid base64 string')

        if len(decoded_bytes) > constants.MAX_IMAGE_BYTES:
            raise ValueError(
                f'File must be smaller than '
                f'{human_readable_size_metric(constants.MAX_IMAGE_BYTES)}')

        try:
            image = Image.open(io.BytesIO(decoded_bytes))
        except:
            raise ValueError(f'Base64 string is valid but is not an image')

        try:
            image.load()
        except:
            raise ValueError(f'Image invalid')

        md5_hash = md5(base64_value)

        # NOTE: the banned-photo check that used to live here now runs in the
        # request handlers (person.patch_onboardee_info / patch_profile_info),
        # since it needs the async DB and pydantic validators can't be async.

        width, height = image.size

        larger_dim = max(width, height)
        smaller_dim = min(width, height)

        if image.format == 'GIF':
            validate_gif_dimensions(larger_dim, smaller_dim)
        else:
            validate_image_dimensions(larger_dim, smaller_dim)

        values['image'] = image
        values['bytes'] = decoded_bytes
        values['md5_hash'] = md5_hash

        return values

    class Config:
        arbitrary_types_allowed = True


class PhotoAssignments(RootModel[Dict[int, int]]):
    @field_validator("root")
    @classmethod
    def validate_root(cls, root: Dict[int, int]) -> Dict[int, int]:
        values = list(root.values())

        if len(values) != len(set(values)):
            raise ValueError('Many photos were assigned to one position')

        for k, v in root.items():
            # Validate that both keys and values are within the allowed range
            if not (MIN_PHOTO_POSITION <= k <= MAX_PHOTO_POSITION):
                raise ValueError('Invalid photo position')
            if not (MIN_PHOTO_POSITION <= v <= MAX_PHOTO_POSITION):
                raise ValueError('Invalid photo position')

            if k == v:
                raise ValueError("Item can't be assigned to itself")

        if not root:
            raise ValueError('Must have at least one assignment')

        return root

class Theme(BaseModel):
    title_color: str = Field(pattern=HEX_COLOR_PATTERN)
    body_color: str = Field(pattern=HEX_COLOR_PATTERN)
    background_color: str = Field(pattern=HEX_COLOR_PATTERN)


class SessionInfo(BaseModel):
    email: str
    session_token_hash: str
    person_id: Optional[int]
    person_uuid: Optional[str]
    onboarded: bool = False
    signed_in: bool
    pending_club_name: Optional[str]

    @model_validator(mode='before')
    def set_onboarded(cls, values: object) -> object:
        if not isinstance(values, dict):
            return values

        values['onboarded'] = values.get('person_id') is not None
        return values


class PostAnswer(BaseModel):
    question_id: int
    answer: Optional[bool]
    public: bool


class DeleteAnswer(BaseModel):
    question_id: int


# The number of questions an unauthenticated user may answer before signing up.
# Must match `PUBLIC_ANSWER_LIMIT` in the frontend
PUBLIC_ANSWER_LIMIT = 10


class PublicAnswer(BaseModel):
    question_id: int
    answer: Optional[bool]
    public: bool = True


class PublicSearchRequest(BaseModel):
    answers: List[PublicAnswer] = Field(
        default_factory=list, max_length=PUBLIC_ANSWER_LIMIT)
    n: int = Field(default=10, ge=0, le=10)
    o: int = Field(default=0, ge=0)


class PostRequestOtp(BaseModel):
    email: EmailStr
    pending_club_name: PendingClubName = Field(
        default=None,
        pattern=CLUB_PATTERN,
        min_length=1,
        max_length=CLUB_MAX_LEN,
    )
    answers: List[PublicAnswer] = Field(
        default_factory=list, max_length=PUBLIC_ANSWER_LIMIT)

    @field_validator('email', mode='before')
    def validate_email(cls, value: object) -> object:
        return _normalize_email_input(value)


class PostCheckOtp(BaseModel):
    otp: str = Field(pattern=r"^\d{6}$")


class PostSignInWithGoogle(BaseModel):
    # Google ID token (a JWT). Verified server-side against Google's JWKS.
    id_token: str = Field(min_length=1, max_length=4096)
    pending_club_name: PendingClubName = Field(
        default=None,
        pattern=CLUB_PATTERN,
        min_length=1,
        max_length=CLUB_MAX_LEN,
    )


class PostSignInWithApple(BaseModel):
    # Apple identity token (a JWT). Verified server-side against Apple's JWKS.
    identity_token: str = Field(min_length=1, max_length=4096)
    # Random hex string the client passed to Apple as the `nonce` parameter
    # (native `signInAsync({ nonce })` on iOS, `&nonce=` URL param on
    # web/Android). Apple echoes it verbatim into the JWT's `nonce` claim;
    # the backend compares the two to bind the token to this client session.
    nonce: str = Field(min_length=16, max_length=128, pattern=r'^[a-zA-Z0-9_-]+$')
    pending_club_name: PendingClubName = Field(
        default=None,
        pattern=CLUB_PATTERN,
        min_length=1,
        max_length=CLUB_MAX_LEN,
    )


class SocialClaims(BaseModel):
    sub: str
    email: str
    email_verified: bool

    @field_validator('email', mode='before')
    def validate_email(cls, value: object) -> object:
        return _normalize_email_input(value)


class PatchOnboardeeInfo(BaseModel):
    name: Optional[str] = Field(
        default=None,
        min_length=MIN_NAME_LEN,
        max_length=MAX_NAME_LEN,
    )
    date_of_birth: Optional[str] = None
    location: Optional[str] = Field(default=None, min_length=1)
    gender: Optional[str] = Field(default=None, min_length=1)
    other_peoples_genders: Optional[List[str]] = Field(default=None, min_length=1)
    base64_file: Optional[Base64File] = None

    @field_validator('name', mode='before')
    @classmethod
    def strip_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        return value.strip()

    @field_validator('other_peoples_genders')
    @classmethod
    def validate_other_peoples_genders(
        cls,
        value: Optional[List[str]],
    ) -> Optional[List[str]]:
        if value is None:
            return value
        for gender in value:
            if len(gender) < 1:
                raise ValueError('each gender must be at least 1 character long')
        return value

    @field_validator('date_of_birth')
    def age_must_be_18_or_up(cls, date_of_birth: Optional[str]) -> Optional[str]:
        if date_of_birth is None:
            return date_of_birth
        date_of_birth_date = datetime.strptime(date_of_birth, '%Y-%m-%d').date()
        today = date.today()
        age = relativedelta(today, date_of_birth_date).years
        if age < 18:
            raise ValueError('Age must be 18 or up')
        return date_of_birth

    # NOTE: name_must_not_be_rude moved to the request handler
    # (person.patch_onboardee_info) — the rude-name check needs the async DB and
    # pydantic validators can't be async.

    @model_validator(mode='after')
    def check_exactly_one(self) -> "PatchOnboardeeInfo":
        if len(self.__pydantic_fields_set__) != 1:
            raise ValueError('Exactly one value must be set')

        [field_name] = self.__pydantic_fields_set__
        field_value = getattr(self, field_name)

        if field_value is None:
            raise ValueError(f'Field {field_name} must not be None')

        return self

    class Config:
        arbitrary_types_allowed = True


class DeleteProfileInfo(BaseModel):
    files: Optional[List[int]] = Field(
        default=None,
        min_length=1,
        max_length=MAX_PHOTO_POSITION,
    )

    audio_files: Optional[List[int]] = Field(
        default=None,
        min_length=1,
        max_length=1,
    )

    @field_validator("files")
    @classmethod
    def validate_files(
        cls,
        files: Optional[List[int]],
    ) -> Optional[List[int]]:
        if files is None:
            return files
        for pos in files:
            if not (MIN_PHOTO_POSITION <= pos <= MAX_PHOTO_POSITION):
                raise ValueError("Invalid photo position")
        return files

    @field_validator("audio_files")
    @classmethod
    def validate_audio_files(
        cls,
        audio_files: Optional[List[int]],
    ) -> Optional[List[int]]:
        if audio_files is None:
            return audio_files
        for value in audio_files:
            if value != -1:
                raise ValueError("Audio file positions must be -1")
        return audio_files


class PatchProfileInfo(BaseModel):
    base64_file: Optional[Base64File] = None
    base64_audio_file: Optional[Base64AudioFile] = None
    photo_assignments: Optional[PhotoAssignments] = None
    name: Optional[str] = Field(
        default=None,
        min_length=MIN_NAME_LEN,
        max_length=MAX_NAME_LEN,
    )
    about: Optional[str] = Field(
        default=None,
        min_length=MIN_ABOUT_LEN,
        max_length=MAX_ABOUT_LEN,
    )
    gender: Optional[str] = None
    orientation: Optional[str] = None
    ethnicity: Optional[str] = None
    location: Optional[str] = None
    occupation: Optional[str] = Field(default=None, min_length=1, max_length=64)
    education: Optional[str] = Field(default=None, min_length=1, max_length=64)
    height: Optional[int] = None
    looking_for: Optional[str] = None
    smoking: Optional[str] = None
    drinking: Optional[str] = None
    drugs: Optional[str] = None
    long_distance: Optional[str] = None
    relationship_status: Optional[str] = None
    has_kids: Optional[str] = None
    wants_kids: Optional[str] = None
    exercise: Optional[str] = None
    religion: Optional[str] = None
    star_sign: Optional[str] = None
    units: Optional[str] = None
    chats: Optional[str] = None
    intros: Optional[str] = None
    verification_level: Optional[str] = None
    show_my_location: Optional[str] = None
    show_my_age: Optional[str] = None
    show_my_looking_for: Optional[str] = None
    hide_me_from_strangers: Optional[str] = None
    browse_invisibly: Optional[str] = None
    public_profile: Optional[str] = None
    theme: Optional[Theme] = None

    @model_validator(mode='after')
    def check_exactly_one(self) -> "PatchProfileInfo":
        if len(self.__pydantic_fields_set__) != 1:
            raise ValueError('Exactly one value must be set')

        [field_name] = self.__pydantic_fields_set__
        field_value = getattr(self, field_name)

        if field_value is None and field_name not in PATCH_PROFILE_INFO_NULLABLE_FIELDS:
            raise ValueError(f'Field {field_name} must not be None')

        return self

    @model_validator(mode='before')
    def strip_strs(cls, values: object) -> object:
        if not isinstance(values, dict):
            return values

        for key, val in values.items():
            values[key] = val.strip() if type(val) is str else val

        return values

    # NOTE: name/occupation/education rude checks moved to the request handler
    # (person.patch_profile_info) — they need the async DB (via
    # is_allowed_club_name) and pydantic validators can't be async. The `about`
    # rude/spam checks below stay: they're pure and don't touch the DB.

    @field_validator('about')
    def about_must_not_be_rude(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        if antiabuse.antirude.profile.is_rude(value):
            raise ValueError('Too rude')
        return value

    @field_validator('about')
    def about_must_not_have_spam(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        if \
                has_url(value) or \
                detect_phone_numbers(value) or \
                has_solicitation(value):
            raise ValueError('Spam')
        return value

    class Config:
        arbitrary_types_allowed = True


class PostSearchFilter(BaseModel):
    class Age(BaseModel):
        min_age: Optional[int]
        max_age: Optional[int]

    class Height(BaseModel):
        min_height_cm: Optional[int]
        max_height_cm: Optional[int]

    gender: Optional[List[str]] = Field(default=None, min_length=1)
    orientation: Optional[List[str]] = Field(default=None, min_length=1)
    ethnicity: Optional[List[str]] = Field(default=None, min_length=1)
    age: Optional[Age] = None
    furthest_distance: Optional[int] = None
    height: Optional[Height] = None
    has_a_profile_picture: Optional[List[str]] = Field(default=None, min_length=1)
    looking_for: Optional[List[str]] = Field(default=None, min_length=1)
    smoking: Optional[List[str]] = Field(default=None, min_length=1)
    drinking: Optional[List[str]] = Field(default=None, min_length=1)
    drugs: Optional[List[str]] = Field(default=None, min_length=1)
    long_distance: Optional[List[str]] = Field(default=None, min_length=1)
    relationship_status: Optional[List[str]] = Field(default=None, min_length=1)
    has_kids: Optional[List[str]] = Field(default=None, min_length=1)
    wants_kids: Optional[List[str]] = Field(default=None, min_length=1)
    exercise: Optional[List[str]] = Field(default=None, min_length=1)
    religion: Optional[List[str]] = Field(default=None, min_length=1)
    star_sign: Optional[List[str]] = Field(default=None, min_length=1)

    people_you_messaged: Optional[str] = None
    people_you_skipped: Optional[str] = None

    @model_validator(mode='after')
    def check_exactly_one(self) -> "PostSearchFilter":
        if len(self.__pydantic_fields_set__) != 1:
            raise ValueError('Exactly one value must be set')

        [field_name] = self.__pydantic_fields_set__
        field_value = getattr(self, field_name)

        if field_name == 'furthest_distance':
            pass
        elif field_value is None:
            raise ValueError(f'Field {field_name} must not be None')

        return self

    class Config:
        arbitrary_types_allowed = True


class PostSearchFilterAnswer(BaseModel):
    question_id: int
    answer: Optional[bool]
    accept_unanswered: bool


class PostInboxInfo(BaseModel):
    person_uuids: List[str]


class PostJoinClub(BaseModel):
    name: ClubName


class PostLeaveClub(BaseModel):
    name: ClubName


class PostSkip(BaseModel):
    report_reason: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=10000,
    )

    @field_validator('report_reason', mode='before')
    @classmethod
    def strip_report_reason(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        return value.strip()


class PostVerificationSelfie(BaseModel):
    base64_file: Base64File


class ValidDatetime(BaseModel):
    datetime: datetime

    @field_validator('datetime', mode='before')
    def _validate_iso8601(cls, v: object) -> object:
        """
        Allow None or anything `datetime.fromisoformat` can parse.
        Accept the common trailing ‘Z’ (UTC) designator as well.
        """
        if isinstance(v, datetime):
            return v
        if not isinstance(v, str):
            return v
        try:
            return datetime.fromisoformat(v.replace('Z', '+00:00'))
        except ValueError:
            raise ValueError('`datetime` must be an ISO-8601 datetime')

class RevenuecatBase(BaseModel):
    model_config = ConfigDict(extra='ignore')

class InitialPurchaseEvent(RevenuecatBase):
    type: Literal['INITIAL_PURCHASE']
    app_user_id: str

class RenewalEvent(RevenuecatBase):
    type: Literal['RENEWAL']
    app_user_id: str

class ExpirationEvent(RevenuecatBase):
    type: Literal['EXPIRATION']
    app_user_id: str

class TransferEvent(RevenuecatBase):
    type: Literal['TRANSFER']
    transferred_to: List[str]
    transferred_from: List[str]

RevenuecatEvent = Annotated[
    Union[InitialPurchaseEvent, RenewalEvent, ExpirationEvent, TransferEvent],
    Field(discriminator='type'),
]

class PostRevenuecat(BaseModel):
    model_config = ConfigDict(extra='ignore')

    api_version: Optional[str] = None
    event: Optional[RevenuecatEvent] = None
    # keep the raw payload for unknown types (or failed parses)
    raw_event: Optional[Dict[str, object]] = None
    raw_event_error: Optional[str] = None

    # one adapter reused for all validations
    _EVENT_ADAPTER: ClassVar[TypeAdapter[RevenuecatEvent]] = TypeAdapter(
        RevenuecatEvent)

    @model_validator(mode='before')
    @classmethod
    def _coerce_event(cls, values: Dict[str, object]) -> Dict[str, object]:
        ev = values.get('event')
        if isinstance(ev, dict):
            try:
                # Try to parse into one of the known discriminated variants
                values['event'] = cls._EVENT_ADAPTER.validate_python(ev)
            except ValidationError as e:
                # Unknown type or bad payload → stash and null out event
                values['raw_event'] = ev
                values['raw_event_error'] = str(e)
                values['event'] = None
        return values
