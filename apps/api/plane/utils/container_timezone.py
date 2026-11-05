# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytz


def keep_local_time(value, old_timezone, new_timezone):
    """Return the moment that reads the same on the clock in new_timezone as value did in old_timezone."""
    local_value = value.astimezone(pytz.timezone(old_timezone)).replace(tzinfo=None)
    return pytz.timezone(new_timezone).localize(local_value).astimezone(pytz.utc)


def move_containers_to_timezone(projects, cycles, new_timezone):
    """
    Move containers to new_timezone without changing the dates their cycles show.

    Cycle dates are stored as exact moments worked out from the container's
    timezone, so they must be recalculated or an end date of 23:59 could show as
    the next day. Takes querysets so that migrations can pass historical models.
    """
    # Bad stored values must never fail a deploy: nothing valid to move to means no
    # move, and a container with an unreadable zone has been showing dates as UTC.
    if new_timezone not in pytz.all_timezones_set:
        return

    to_move = projects.exclude(timezone=new_timezone)
    for project_id, old_timezone in to_move.values_list("id", "timezone"):
        if old_timezone not in pytz.all_timezones_set:
            old_timezone = "UTC"
        changed = []
        for cycle in cycles.filter(project_id=project_id):
            if not cycle.start_date and not cycle.end_date:
                continue
            if cycle.start_date:
                cycle.start_date = keep_local_time(cycle.start_date, old_timezone, new_timezone)
            if cycle.end_date:
                cycle.end_date = keep_local_time(cycle.end_date, old_timezone, new_timezone)
            changed.append(cycle)
        cycles.bulk_update(changed, ["start_date", "end_date"], batch_size=500)
    to_move.update(timezone=new_timezone)
