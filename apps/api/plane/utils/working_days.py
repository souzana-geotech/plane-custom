# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Working-day date arithmetic for dependency-aware scheduling.

Mirrors the frontend helpers in ``packages/utils/src/working-days.ts``:
working days run Monday through Saturday, only Sunday is excluded.
All functions operate on ``datetime.date`` objects and never mutate inputs.
"""

from datetime import date, timedelta

# ``date.weekday()`` index that is never counted as a working day (Monday=0 .. Sunday=6).
NON_WORKING_WEEKDAY = 6


def is_working_day(value: date) -> bool:
    """True when the date falls on a working day (Monday to Saturday)."""
    return value.weekday() != NON_WORKING_WEEKDAY


def next_working_day(value: date) -> date:
    """The first working day strictly after ``value`` (a Saturday rolls to Monday)."""
    result = value + timedelta(days=1)
    while not is_working_day(result):
        result += timedelta(days=1)
    return result


def add_working_days(start: date, working_days: int) -> date:
    """
    The date on which the nth working day falls, counting ``start`` as the first one.

    Matches ``getDueDateFromWorkingDays``: a start date landing on a Sunday rolls
    forward to the next working day, which then counts as day one.
    """
    if working_days < 1:
        raise ValueError("working_days must be a positive integer")
    result = start
    if not is_working_day(result):
        result += timedelta(days=1)
    remaining = working_days - 1
    while remaining > 0:
        result += timedelta(days=1)
        if is_working_day(result):
            remaining -= 1
    return result


def shift_by_working_days(value: date, delta: int) -> date:
    """
    Move ``delta`` working days along the calendar (signed; 0 keeps the date).

    A Sunday input first rolls forward to Monday, so the result is always a
    working day. Inverse of ``working_days_delta`` for working-day inputs.
    """
    result = value
    if not is_working_day(result):
        result += timedelta(days=1)
    step = timedelta(days=1) if delta >= 0 else timedelta(days=-1)
    remaining = abs(delta)
    while remaining > 0:
        result += step
        if is_working_day(result):
            remaining -= 1
    return result


def working_days_delta(start: date, end: date) -> int:
    """
    Signed number of working days stepped from ``start`` to ``end``
    (exclusive of ``start``, inclusive of ``end``). Sundays are not counted,
    so e.g. Friday -> Monday is +2 (Saturday, Monday) and Monday -> Friday is -2.
    """
    if start == end:
        return 0
    step = timedelta(days=1) if end > start else timedelta(days=-1)
    sign = 1 if end > start else -1
    delta = 0
    cursor = start
    while cursor != end:
        cursor += step
        if is_working_day(cursor):
            delta += sign
    return delta


def working_days_between(start: date, end: date) -> int | None:
    """
    Number of working days in the inclusive range, or None when the range is invalid.

    Matches ``getWorkingDaysBetweenDates``: Sundays in the range are not counted.
    """
    if start > end:
        return None
    count = 0
    cursor = start
    while cursor <= end:
        if is_working_day(cursor):
            count += 1
        cursor += timedelta(days=1)
    return count
