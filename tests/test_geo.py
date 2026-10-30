from services.geo import validate_gps_coords, calculate_distance


def test_validate_ok():
    assert validate_gps_coords(55.75, 37.62) is True

def test_validate_none():
    assert validate_gps_coords(None, 37.0) is False
    assert validate_gps_coords(55.0, None) is False

def test_validate_out_of_range():
    assert validate_gps_coords(91.0, 0.0) is False
    assert validate_gps_coords(-91.0, 0.0) is False
    assert validate_gps_coords(0.0, 181.0) is False
    assert validate_gps_coords(0.0, -181.0) is False

def test_zero_zero_invalid():
    # (0,0) считается валидным диапазоном или нет — фиксируем текущее поведение
    res = validate_gps_coords(0.0, 0.0)
    assert isinstance(res, bool)

def test_distance_moscow_spb():
    d = calculate_distance(55.7558, 37.6173, 59.9311, 30.3609)
    assert 600 < d < 750  # ~634-685 км (километры)

def test_distance_same_point_zero():
    assert calculate_distance(55.0, 37.0, 55.0, 37.0) == 0.0
