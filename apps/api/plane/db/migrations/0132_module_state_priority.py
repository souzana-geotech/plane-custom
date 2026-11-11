# Geotech3D: Jobs (modules) use their container's task States, and gain a
# priority. The legacy `status` column is NOT changed or removed: it stays as
# the record of each Job's old value and is kept in sync from the state's
# group afterwards.

from django.db import migrations, models
import django.db.models.deletion
from django.template.defaultfilters import slugify


STATUS_TO_GROUP = {
    "backlog": "backlog",
    "planned": "unstarted",
    "in-progress": "started",
    "paused": "started",
    "completed": "completed",
    "cancelled": "cancelled",
}

# Used only when a container has no state in the group a Job needs
FALLBACK_STATE = {
    "backlog": ("Backlog", "#60646C"),
    "planned": ("Planned", "#60646C"),
    "in-progress": ("In Progress", "#F59E0B"),
    "paused": ("Paused", "#F97316"),
    "completed": ("Completed", "#46A758"),
    "cancelled": ("Cancelled", "#9AA4BC"),
}


def _find_state(usable, status, group):
    """An existing state of the right group for a legacy status, or None."""
    in_group = usable.filter(group=group)
    if status == "paused":
        return in_group.filter(name__iexact="Paused").first()
    if status == "planned":
        default = in_group.filter(default=True).first()
        if default:
            return default
    return in_group.order_by("sequence").first()


def assign_states(apps, schema_editor):
    Module = apps.get_model("db", "Module")
    State = apps.get_model("db", "State")
    Project = apps.get_model("db", "Project")

    # Every Job not yet given a state, archived and soft-deleted ones included,
    # so re-running the migration changes nothing.
    # (_base_manager: the default manager hides soft-deleted rows)
    pending = Module._base_manager.filter(state__isnull=True)
    project_ids = set(pending.order_by().values_list("project_id", flat=True))

    for project_id in project_ids:
        project_is_live = Project._base_manager.filter(pk=project_id, deleted_at__isnull=True).exists()
        # every live state, triage included, so a new state's name never collides
        live_states = State._base_manager.filter(project_id=project_id, deleted_at__isnull=True)
        usable = live_states.filter(is_triage=False).exclude(group="triage")
        project_modules = pending.filter(project_id=project_id)

        for status in set(project_modules.order_by().values_list("status", flat=True)):
            group = STATUS_TO_GROUP.get(status, "unstarted")
            jobs = project_modules.filter(status=status)
            state = _find_state(usable, status, group)

            if state is None:
                # Only a live Job in a live container may add a state to the
                # container; deleted Jobs keep no state rather than leaving a
                # new, visible state behind on the States page.
                live_job = jobs.filter(deleted_at__isnull=True).first()
                if not project_is_live or live_job is None:
                    continue
                name, color = FALLBACK_STATE.get(status, ("Planned", "#60646C"))
                candidate, n = name, 1
                while live_states.filter(name__iexact=candidate).exists():
                    n += 1
                    candidate = f"{name} {n}"
                last = live_states.aggregate(largest=models.Max("sequence"))["largest"]
                state = State._base_manager.create(
                    name=candidate,
                    slug=slugify(candidate),
                    color=color,
                    group=group,
                    sequence=(last or 0) + 15000,
                    project_id=project_id,
                    workspace_id=live_job.workspace_id,
                )

            jobs.update(state=state)


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0131_containers_follow_workspace_timezone"),
    ]

    operations = [
        migrations.AddField(
            model_name="module",
            name="state",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="state_modules",
                to="db.state",
            ),
        ),
        migrations.AddField(
            model_name="module",
            name="priority",
            field=models.CharField(
                choices=[
                    ("urgent", "Urgent"),
                    ("high", "High"),
                    ("medium", "Medium"),
                    ("low", "Low"),
                    ("none", "None"),
                ],
                default="none",
                max_length=30,
                verbose_name="Module Priority",
            ),
        ),
        # Reverse leaves states in place; removing the column (the AddField
        # reverse) is enough to return to the old schema.
        migrations.RunPython(assign_states, migrations.RunPython.noop),
    ]
