# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
OpenAPI/Swagger configuration for drf-spectacular.

This file contains the complete configuration for API documentation generation.
"""

SPECTACULAR_SETTINGS = {
    # ========================================================================
    # Basic API Information
    # ========================================================================
    "TITLE": "The Plane REST API",
    "DESCRIPTION": (
        "The Plane REST API\n\n"
        "Visit our quick start guide and full API documentation at "
        "[developers.plane.so](https://developers.plane.so/api-reference/introduction)."
    ),
    "CONTACT": {
        "name": "Plane",
        "url": "https://plane.so",
        "email": "support@plane.so",
    },
    "VERSION": "0.0.1",
    "LICENSE": {
        "name": "GNU AGPLv3",
        "url": "https://github.com/makeplane/plane/blob/preview/LICENSE.txt",
    },
    # ========================================================================
    # Schema Generation Settings
    # ========================================================================
    "SERVE_INCLUDE_SCHEMA": False,
    "SCHEMA_PATH_PREFIX": "/api/v1/",
    "SCHEMA_CACHE_TIMEOUT": 0,  # disables caching
    # ========================================================================
    # Processing Hooks
    # ========================================================================
    "PREPROCESSING_HOOKS": [
        "plane.utils.openapi.hooks.preprocess_filter_api_v1_paths",
    ],
    # ========================================================================
    # Server Configuration
    # ========================================================================
    "SERVERS": [
        {"url": "http://localhost:8000", "description": "Local"},
        {"url": "https://api.plane.so", "description": "Production"},
    ],
    # ========================================================================
    # API Tag Definitions
    # ========================================================================
    "TAGS": [
        # System Features
        {
            "name": "Assets",
            "description": (
                "**File Upload & Presigned URLs**\n\n"
                "Generate presigned URLs for direct file uploads to cloud storage. Handle user avatars, "
                "cover images, and generic project assets with secure upload workflows.\n\n"
                "*Key Features:*\n"
                "- Generate presigned URLs for S3 uploads\n"
                "- Support for user avatars and cover images\n"
                "- Generic asset upload for projects\n"
                "- File validation and size limits\n\n"
                "*Use Cases:* User profile images, project file uploads, secure direct-to-cloud uploads."
            ),
        },
        # Project Organization
        {
            "name": "Cycles",
            "description": (
                "**Sprint & Development Cycles**\n\n"
                "Create and manage development cycles (sprints) to organize work into time-boxed iterations. "
                "Track progress, assign tasks, and monitor team velocity.\n\n"
                "*Key Features:*\n"
                "- Create and configure development cycles\n"
                "- Assign tasks to cycles\n"
                "- Track cycle progress and completion\n"
                "- Generate cycle analytics and reports\n\n"
                "*Use Cases:* Sprint planning, iterative development, progress tracking, team velocity."
            ),
        },
        # System Features
        {
            "name": "Intake",
            "description": (
                "**Task Intake Queue**\n\n"
                "Manage incoming tasks through a dedicated intake queue for triage and review. "
                "Submit, update, and process tasks before they enter the main project workflow.\n\n"
                "*Key Features:*\n"
                "- Submit tasks to intake queue\n"
                "- Review and triage incoming tasks\n"
                "- Update intake task status and properties\n"
                "- Accept, reject, or modify tasks before approval\n\n"
                "*Use Cases:* Task triage, external submissions, quality review, approval workflows."
            ),
        },
        # Project Organization
        {
            "name": "Labels",
            "description": (
                "**Labels & Tags**\n\n"
                "Create and manage labels to categorize and organize tasks. Use color-coded labels "
                "for easy identification, filtering, and project organization.\n\n"
                "*Key Features:*\n"
                "- Create custom labels with colors and descriptions\n"
                "- Apply labels to tasks for categorization\n"
                "- Filter and search by labels\n"
                "- Organize labels across projects\n\n"
                "*Use Cases:* Priority marking, feature categorization, bug classification, team organization."
            ),
        },
        # Team & User Management
        {
            "name": "Members",
            "description": (
                "**Team Member Management**\n\n"
                "Manage team members, roles, and permissions within projects and workspaces. "
                "Control access levels and track member participation.\n\n"
                "*Key Features:*\n"
                "- Invite and manage team members\n"
                "- Assign roles and permissions\n"
                "- Control project and workspace access\n"
                "- Track member activity and participation\n\n"
                "*Use Cases:* Team setup, access control, role management, collaboration."
            ),
        },
        # Project Organization
        {
            "name": "Modules",
            "description": (
                "**Feature Modules**\n\n"
                "Group related tasks into modules for better organization and tracking. "
                "Plan features, track progress, and manage deliverables at a higher level.\n\n"
                "*Key Features:*\n"
                "- Create and organize feature modules\n"
                "- Group tasks by module\n"
                "- Track module progress and completion\n"
                "- Manage module leads and assignments\n\n"
                "*Use Cases:* Feature planning, release organization, progress tracking, team coordination."
            ),
        },
        # Core Project Management
        {
            "name": "Projects",
            "description": (
                "**Project Management**\n\n"
                "Create and manage projects to organize your development work. Configure project settings, "
                "manage team access, and control project visibility.\n\n"
                "*Key Features:*\n"
                "- Create, update, and delete projects\n"
                "- Configure project settings and preferences\n"
                "- Manage team access and permissions\n"
                "- Control project visibility and sharing\n\n"
                "*Use Cases:* Project setup, team collaboration, access control, project configuration."
            ),
        },
        # Project Organization
        {
            "name": "States",
            "description": (
                "**Workflow States**\n\n"
                "Define custom workflow states for tasks to match your team's process. "
                "Configure state transitions and track task progress through different stages.\n\n"
                "*Key Features:*\n"
                "- Create custom workflow states\n"
                "- Configure state transitions and rules\n"
                "- Track task progress through states\n"
                "- Set state-based permissions and automation\n\n"
                "*Use Cases:* Custom workflows, status tracking, process automation, progress monitoring."
            ),
        },
        # Team & User Management
        {
            "name": "Users",
            "description": (
                "**Current User Information**\n\n"
                "Get information about the currently authenticated user including profile details "
                "and account settings.\n\n"
                "*Key Features:*\n"
                "- Retrieve current user profile\n"
                "- Access user account information\n"
                "- View user preferences and settings\n"
                "- Get authentication context\n\n"
                "*Use Cases:* Profile display, user context, account information, authentication status."
            ),
        },
        # Task Management
        {
            "name": "Task Activity",
            "description": (
                "**Activity History & Search**\n\n"
                "View activity history and search for tasks across the workspace. "
                "Get detailed activity logs and find tasks using text search.\n\n"
                "*Key Features:*\n"
                "- View task activity history\n"
                "- Search tasks across workspace\n"
                "- Track changes and modifications\n"
                "- Filter search results by project\n\n"
                "*Use Cases:* Activity tracking, task discovery, change history, workspace search."
            ),
        },
        {
            "name": "Task Attachments",
            "description": (
                "**Task File Attachments**\n\n"
                "Generate presigned URLs for uploading files directly to specific tasks. "
                "Upload and manage attachments associated with tasks.\n\n"
                "*Key Features:*\n"
                "- Generate presigned URLs for task attachments\n"
                "- Upload files directly to tasks\n"
                "- Retrieve and manage attachment metadata\n"
                "- Delete attachments from tasks\n\n"
                "*Use Cases:* Screenshots, error logs, design files, supporting documents."
            ),
        },
        {
            "name": "Task Comments",
            "description": (
                "**Comments & Discussions**\n\n"
                "Add comments and discussions to tasks for team collaboration. "
                "Support threaded conversations, mentions, and rich text formatting.\n\n"
                "*Key Features:*\n"
                "- Add comments to tasks\n"
                "- Thread conversations and replies\n"
                "- Mention users and trigger notifications\n"
                "- Rich text and markdown support\n\n"
                "*Use Cases:* Team discussions, progress updates, code reviews, decision tracking."
            ),
        },
        {
            "name": "Task Links",
            "description": (
                "**External Links & References**\n\n"
                "Link tasks to external resources like documentation, repositories, or design files. "
                "Maintain connections between tasks and external systems.\n\n"
                "*Key Features:*\n"
                "- Add external URL links to tasks\n"
                "- Validate and preview linked resources\n"
                "- Organize links by type and category\n"
                "- Track link usage and access\n\n"
                "*Use Cases:* Documentation links, repository connections, design references, external tools."
            ),
        },
        {
            "name": "Tasks",
            "description": (
                "**Tasks & Tasks**\n\n"
                "Create and manage tasks like tasks, bugs, features, and user stories. "
                "The core entities for tracking work in your projects.\n\n"
                "*Key Features:*\n"
                "- Create, update, and manage tasks\n"
                "- Assign to team members and set priorities\n"
                "- Track progress through workflow states\n"
                "- Set due dates, estimates, and relationships\n\n"
                "*Use Cases:* Bug tracking, task management, feature development, sprint planning."
            ),
        },
    ],
    # ========================================================================
    # Security & Authentication
    # ========================================================================
    "AUTHENTICATION_WHITELIST": [
        "plane.api.middleware.api_authentication.APIKeyAuthentication",
    ],
    # ========================================================================
    # Schema Generation Options
    # ========================================================================
    "COMPONENT_NO_READ_ONLY_REQUIRED": True,
    "COMPONENT_SPLIT_REQUEST": True,
    "ENUM_NAME_OVERRIDES": {
        "ModuleStatusEnum": "plane.db.models.module.ModuleStatus",
        "IntakeWorkItemStatusEnum": "plane.db.models.intake.IntakeIssueStatus",
    },
}
