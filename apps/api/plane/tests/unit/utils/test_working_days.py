# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Unit tests for the working-day date arithmetic used by dependency-aware scheduling.

The calendar mirrors the frontend (`packages/utils/src/working-days.ts`):
Monday-Saturday are working days, Sunday is excluded.
"""

from datetime import date

import pytest

from plane.utils.working_days import (
    add_working_days,
    is_working_day,
    next_working_day,
    shift_by_working_days,
    working_days_between,
    working_days_delta,
)

MONDAY = date(2026, 9, 7)
FRIDAY = date(2026, 9, 11)
SATURDAY = date(2026, 9, 12)
SUNDAY = date(2026, 9, 13)
NEXT_MONDAY = date(2026, 9, 14)


@pytest.mark.unit
class TestIsWorkingDay:
    def test_monday_through_saturday_are_working_days(self):
        for offset in range(6):  # Mon .. Sat
            assert is_working_day(date(2026, 9, 7 + offset)) is True

    def test_sunday_is_not_a_working_day(self):
        assert is_working_day(SUNDAY) is False


@pytest.mark.unit
class TestNextWorkingDay:
    def test_weekday_advances_one_day(self):
        assert next_working_day(MONDAY) == date(2026, 9, 8)

    def test_saturday_rolls_to_monday(self):
        # Saturday -> Monday: Sunday is skipped.
        assert next_working_day(SATURDAY) == NEXT_MONDAY

    def test_sunday_rolls_to_monday(self):
        assert next_working_day(SUNDAY) == NEXT_MONDAY


@pytest.mark.unit
class TestAddWorkingDays:
    def test_start_counts_as_first_working_day(self):
        # Mon + 3 working days -> Mon, Tue, Wed
        assert add_working_days(MONDAY, 3) == date(2026, 9, 9)

    def test_range_spanning_sunday_skips_it(self):
        # Sat + 2 working days -> Sat, [skip Sun], Mon
        assert add_working_days(SATURDAY, 2) == NEXT_MONDAY

    def test_sunday_start_rolls_forward_first(self):
        assert add_working_days(SUNDAY, 1) == NEXT_MONDAY

    def test_rejects_non_positive_counts(self):
        with pytest.raises(ValueError):
            add_working_days(MONDAY, 0)


@pytest.mark.unit
class TestShiftByWorkingDays:
    def test_zero_delta_keeps_the_date(self):
        assert shift_by_working_days(MONDAY, 0) == MONDAY

    def test_forward_shift_skips_sunday(self):
        # Fri + 2 -> Sat, [skip Sun], Mon
        assert shift_by_working_days(FRIDAY, 2) == NEXT_MONDAY

    def test_backward_shift_skips_sunday(self):
        # Mon - 2 -> [skip Sun], Sat, Fri
        assert shift_by_working_days(NEXT_MONDAY, -2) == FRIDAY

    def test_sunday_input_rolls_forward_first(self):
        assert shift_by_working_days(SUNDAY, 0) == NEXT_MONDAY
        assert shift_by_working_days(SUNDAY, 1) == date(2026, 9, 15)


@pytest.mark.unit
class TestWorkingDaysDelta:
    def test_equal_dates_are_zero(self):
        assert working_days_delta(MONDAY, MONDAY) == 0

    def test_forward_delta_over_sunday(self):
        assert working_days_delta(FRIDAY, NEXT_MONDAY) == 2

    def test_backward_delta_is_negative(self):
        assert working_days_delta(NEXT_MONDAY, FRIDAY) == -2

    def test_inverse_of_shift(self):
        for delta in range(-10, 11):
            shifted = shift_by_working_days(MONDAY, delta)
            assert working_days_delta(MONDAY, shifted) == delta


@pytest.mark.unit
class TestWorkingDaysBetween:
    def test_inclusive_weekday_range(self):
        assert working_days_between(MONDAY, date(2026, 9, 9)) == 3

    def test_sunday_in_range_is_not_counted(self):
        # Fri, Sat, [Sun], Mon -> 3 working days
        assert working_days_between(FRIDAY, NEXT_MONDAY) == 3

    def test_single_day_range(self):
        assert working_days_between(MONDAY, MONDAY) == 1

    def test_single_sunday_counts_zero(self):
        assert working_days_between(SUNDAY, SUNDAY) == 0

    def test_inverted_range_is_invalid(self):
        assert working_days_between(NEXT_MONDAY, MONDAY) is None

    def test_inverse_of_add_working_days(self):
        for days in range(1, 15):
            end = add_working_days(MONDAY, days)
            assert working_days_between(MONDAY, end) == days
