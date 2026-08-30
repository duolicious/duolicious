"""The key-value matching model (see backend/kvmatching). `watched` is the
write-side mirror of the read side's single input list
(serviceshared/kvmatching/sql.py:person_rows_query, plus the answer
tables): every write that can move a model input lands here, and nothing
else does -- sort order and the show-messaged/skipped toggles are absent
by construction, not by a check at each call site. The answer tables are
captured so a change arrives as an (old, new) pair and patches the cached
first-layer sums instead of re-reading every answer.
"""
from collections.abc import Sequence

from serviceshared.database.triggers import Capture, CapturedChange, Watch
from serviceshared.database.tx import Tx
from serviceshared.kvmatching import refresh

_ANSWER_CAPTURE = Capture(key_column='question_id', value_column='answer')


class _LongerConversationsModel:
    name = 'longer_conversations'
    subject_column = 'person_id'
    watched: Sequence[Watch] = (
        Watch(
            table='person',
            update_columns=frozenset({
                'date_of_birth', 'height_cm', 'coordinates',
                'location_country', 'gender_id', 'orientation_id',
                'ethnicity_id', 'looking_for_id', 'smoking_id',
                'drinking_id', 'drugs_id', 'long_distance_id',
                'relationship_status_id', 'has_kids_id', 'wants_kids_id',
                'exercise_id', 'religion_id', 'star_sign_id',
                'verification_level_id', 'about',
                'count_intros_received', 'count_intros_received_with_reply',
                'count_intros_sent', 'count_messages_received',
            }),
            inserts=True,
        ),
        Watch(
            table='search_preference',
            update_columns=frozenset({
                'gender_ids', 'orientation_ids', 'ethnicity_ids',
                'has_profile_picture_ids', 'looking_for_ids', 'smoking_ids',
                'drinking_ids', 'drugs_ids', 'long_distance_ids',
                'relationship_status_ids', 'has_kids_ids', 'wants_kids_ids',
                'exercise_ids', 'religion_ids', 'star_sign_ids',
                'min_age', 'max_age', 'min_height_cm', 'max_height_cm',
                'distance', 'last_online_id', 'club_name',
                'two_way_gender', 'two_way_age', 'two_way_furthest_distance',
                'two_way_orientation', 'two_way_relationship_status',
                'two_way_looking_for', 'two_way_wants_kids',
                'two_way_has_kids', 'two_way_has_a_profile_picture',
                'two_way_drugs', 'two_way_long_distance', 'two_way_ethnicity',
                'two_way_smoking', 'two_way_religion', 'two_way_drinking',
                'two_way_height', 'two_way_exercise', 'two_way_star_sign',
            }),
            inserts=True,
        ),
        Watch(
            table='answer',
            update_columns=frozenset({'answer'}),
            inserts=True,
            deletes=True,
            capture=_ANSWER_CAPTURE,
        ),
        Watch(
            table='search_preference_answer',
            update_columns=frozenset({'answer'}),
            inserts=True,
            deletes=True,
            capture=_ANSWER_CAPTURE,
        ),
        Watch(table='photo', inserts=True, deletes=True),
        Watch(table='person_club', inserts=True, deletes=True),
    )

    async def fire(
        self,
        tx: Tx,
        person_id: int,
        changes: Sequence[CapturedChange],
    ) -> None:
        await refresh.refresh(tx, person_id, changes)


MODEL = _LongerConversationsModel()
