# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import logging

# Third party imports
from celery import shared_task

# Django imports
from django.conf import settings
from django.core.mail import EmailMultiAlternatives, get_connection
from django.template.loader import render_to_string

# Module imports
from plane.db.models import Issue, User, UserNotificationPreference
from plane.license.utils.instance_value import get_email_configuration
from plane.utils.email import generate_plain_text_from_html
from plane.utils.exception_logger import log_exception

logger = logging.getLogger("plane.worker")


@shared_task
def issue_assigned_email(issue_id, assignee_id, actor_id, base_url):
    """
    Send a transactional email to a user who has been newly assigned to an issue.

    Guards applied (all must pass for the email to be sent):
    - assignee must be an active user (is_active=True)
    - self-assignment is skipped (assignee_id == actor_id)
    - UserNotificationPreference.property_change must be True (default)

    This task is fire-and-forget: any failure is logged via log_exception()
    and silently swallowed so the task-assignment itself is never affected.
    """
    try:
        # --- Guard: skip self-assignment ---
        if str(assignee_id) == str(actor_id):
            logger.info(
                "issue_assigned_email: skipped self-assignment "
                "issue=%s assignee=%s",
                issue_id,
                assignee_id,
            )
            return

        # --- Fetch assignee, guard inactive ---
        try:
            assignee = User.objects.get(pk=assignee_id)
        except User.DoesNotExist:
            logger.warning(
                "issue_assigned_email: assignee not found assignee_id=%s", assignee_id
            )
            return

        if not assignee.is_active:
            logger.info(
                "issue_assigned_email: skipped inactive assignee assignee_id=%s",
                assignee_id,
            )
            return

        # --- Guard: respect UserNotificationPreference.property_change ---
        # Assignment is a property change; we piggyback on the same preference
        # that notification_task.py (line 346) and issue_reminder_task.py use.
        # Users without a preference row default to True (same as model default).
        preference = UserNotificationPreference.objects.filter(
            user_id=assignee_id
        ).values_list("property_change", flat=True)
        pref_value = preference.first()
        if pref_value is not None and not pref_value:
            logger.info(
                "issue_assigned_email: skipped due to property_change=False "
                "assignee_id=%s",
                assignee_id,
            )
            return

        # --- Fetch issue ---
        try:
            issue = Issue.objects.select_related(
                "project", "project__workspace"
            ).get(pk=issue_id)
        except Issue.DoesNotExist:
            logger.warning(
                "issue_assigned_email: issue not found issue_id=%s", issue_id
            )
            return

        # --- Fetch actor ---
        try:
            actor = User.objects.get(pk=actor_id)
        except User.DoesNotExist:
            logger.warning(
                "issue_assigned_email: actor not found actor_id=%s", actor_id
            )
            return

        # --- Build URL ---
        # Same convention as email_notification_task.py L286:
        # {base_url}/{workspace_slug}/projects/{project_id}/issues/{issue_id}
        # Matches frontend route: :workspaceSlug/projects/:projectId/issues/:issueId
        issue_url = (
            f"{base_url}"
            f"/{issue.project.workspace.slug}"
            f"/projects/{issue.project.id}"
            f"/issues/{issue.id}"
        )

        # --- Build email context ---
        context = {
            "assignee_name": assignee.display_name or assignee.first_name or assignee.email,
            "actor_name": actor.display_name or actor.first_name or actor.email,
            "issue_identifier": f"{issue.project.identifier}-{issue.sequence_id}",
            "issue_name": issue.name,
            "project_name": issue.project.name,
            "issue_url": issue_url,
            "email": assignee.email,
        }

        # --- Fetch SMTP configuration ---
        (
            EMAIL_HOST,
            EMAIL_HOST_USER,
            EMAIL_HOST_PASSWORD,
            EMAIL_PORT,
            EMAIL_USE_TLS,
            EMAIL_USE_SSL,
            EMAIL_FROM,
        ) = get_email_configuration()

        subject = (
            f"You've been assigned to "
            f"{context['issue_identifier']} {issue.name}"
        )

        html_content = render_to_string(
            "emails/notifications/issue_assigned.html", context
        )
        text_content = generate_plain_text_from_html(html_content)

        connection = get_connection(
            host=EMAIL_HOST,
            port=int(EMAIL_PORT),
            username=EMAIL_HOST_USER,
            password=EMAIL_HOST_PASSWORD,
            use_tls=EMAIL_USE_TLS == "1",
            use_ssl=EMAIL_USE_SSL == "1",
        )

        msg = EmailMultiAlternatives(
            subject=subject,
            body=text_content,
            from_email=EMAIL_FROM,
            to=[assignee.email],
            connection=connection,
        )
        msg.attach_alternative(html_content, "text/html")
        msg.send()

        logger.info(
            "issue_assigned_email: sent successfully issue=%s assignee=%s",
            issue_id,
            assignee_id,
        )
        return

    except Exception as e:
        log_exception(e)
        return
