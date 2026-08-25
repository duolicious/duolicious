SELECT
    person_id,
    gender_ids, orientation_ids, ethnicity_ids, has_profile_picture_ids,
    looking_for_ids, smoking_ids, drinking_ids, drugs_ids, long_distance_ids,
    relationship_status_ids, has_kids_ids, wants_kids_ids, exercise_ids,
    religion_ids, star_sign_ids,
    min_age, max_age, min_height_cm, max_height_cm, distance,
    last_online_id,
    club_name IS NOT NULL AS has_club_filter,
    two_way_gender, two_way_age, two_way_furthest_distance, two_way_orientation,
    two_way_relationship_status, two_way_looking_for, two_way_wants_kids,
    two_way_has_kids, two_way_has_a_profile_picture, two_way_drugs,
    two_way_long_distance, two_way_ethnicity, two_way_smoking, two_way_religion,
    two_way_drinking, two_way_height, two_way_exercise, two_way_star_sign
FROM search_preference
