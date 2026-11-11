# Geotech3D: Jobs (modules) can carry labels from their container's label list.
# Additive only: a new join table, no existing rows change.

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0132_module_state_priority"),
    ]

    operations = [
        migrations.AddField(
            model_name="module",
            name="labels",
            field=models.ManyToManyField(blank=True, related_name="label_modules", to="db.label"),
        ),
    ]
