from django.db import migrations

from plane.utils.container_timezone import move_containers_to_timezone


def align_container_timezones(apps, schema_editor):
    """One-time: move every existing container to its workspace's timezone (Geotech3D)."""
    Project = apps.get_model("db", "Project")
    Workspace = apps.get_model("db", "Workspace")
    Cycle = apps.get_model("db", "Cycle")
    for workspace_id, timezone in Workspace.objects.values_list("id", "timezone"):
        move_containers_to_timezone(Project.objects.filter(workspace_id=workspace_id), Cycle.objects.all(), timezone)


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0130_personal_container_named_my_space"),
    ]

    operations = [
        # Irreversible in effect: the zones containers had before are not kept.
        migrations.RunPython(align_container_timezones, migrations.RunPython.noop),
    ]
