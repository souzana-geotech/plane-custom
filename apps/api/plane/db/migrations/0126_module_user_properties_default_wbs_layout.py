# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Geotech3D: the module is the WBS scope, so the WBS layout is the default for
# every module. get_default_display_filters (plane/db/models/module.py) now
# returns layout "wbs" for records created from here on; this data migration
# flips the records that already exist, so modules opened before this change
# behave exactly like new ones. Users can still switch layouts per module —
# this is a one-time default, not an enforcement.

from django.db import migrations


def set_module_layout_to_wbs(apps, schema_editor):
    ModuleUserProperties = apps.get_model("db", "ModuleUserProperties")

    batch = []
    for prop in ModuleUserProperties.objects.all().iterator(chunk_size=1000):
        display_filters = prop.display_filters if isinstance(prop.display_filters, dict) else {}
        if display_filters.get("layout") == "wbs":
            continue
        display_filters["layout"] = "wbs"
        prop.display_filters = display_filters
        batch.append(prop)
        if len(batch) >= 1000:
            ModuleUserProperties.objects.bulk_update(batch, ["display_filters"])
            batch = []
    if batch:
        ModuleUserProperties.objects.bulk_update(batch, ["display_filters"])


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0125_module_module_code_and_more"),
    ]

    operations = [
        # reverse is a no-op: rolling back the code does not need the stored
        # per-user layout choices to be rewritten
        migrations.RunPython(set_module_layout_to_wbs, migrations.RunPython.noop),
    ]
