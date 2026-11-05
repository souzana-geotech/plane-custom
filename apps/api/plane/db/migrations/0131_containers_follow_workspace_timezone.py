from django.db import migrations
from django.db.models import OuterRef, Subquery


def align_container_timezones(apps, schema_editor):
    """One-time: move every existing container to its workspace's timezone (Geotech3D)."""
    Project = apps.get_model("db", "Project")
    Workspace = apps.get_model("db", "Workspace")
    Project.objects.update(timezone=Subquery(Workspace.objects.filter(pk=OuterRef("workspace_id")).values("timezone")[:1]))


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0130_personal_container_named_my_space"),
    ]

    operations = [
        # Irreversible in effect: the zones containers had before are not kept.
        migrations.RunPython(align_container_timezones, migrations.RunPython.noop),
    ]
