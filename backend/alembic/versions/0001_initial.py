"""initial schema

Revision ID: 0001_initial
Revises:
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def uuid_type():
    return postgresql.UUID(as_uuid=True)


def jsonb_type():
    return postgresql.JSONB()


def upgrade() -> None:
    op.create_table(
        "anonymous_sessions",
        sa.Column("id", uuid_type(), nullable=False),
        sa.Column("fingerprint", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "portfolios",
        sa.Column("id", uuid_type(), nullable=False),
        sa.Column("anon_id", uuid_type(), nullable=True),
        sa.Column("holdings_json", jsonb_type(), nullable=False),
        sa.Column("raw_input", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["anon_id"], ["anonymous_sessions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_portfolios_anon_id", "portfolios", ["anon_id"])
    op.create_table(
        "diagnoses",
        sa.Column("id", uuid_type(), nullable=False),
        sa.Column("portfolio_id", uuid_type(), nullable=False),
        sa.Column("anon_id", uuid_type(), nullable=True),
        sa.Column("mode", sa.String(length=32), nullable=False),
        sa.Column("masters", postgresql.ARRAY(sa.String()), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("events_jsonb", jsonb_type(), server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("report_json", jsonb_type(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["anon_id"], ["anonymous_sessions.id"]),
        sa.ForeignKeyConstraint(["portfolio_id"], ["portfolios.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_diagnoses_anon_id", "diagnoses", ["anon_id"])
    op.create_table(
        "share_links",
        sa.Column("code", sa.String(length=16), nullable=False),
        sa.Column("diagnosis_id", uuid_type(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("visit_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["diagnosis_id"], ["diagnoses.id"]),
        sa.PrimaryKeyConstraint("code"),
    )
    op.create_table(
        "short_term_analysis_tasks",
        sa.Column("id", uuid_type(), nullable=False),
        sa.Column("anon_id", uuid_type(), nullable=True),
        sa.Column("code", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="done", nullable=False),
        sa.Column("report_json", jsonb_type(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["anon_id"], ["anonymous_sessions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_short_term_analysis_tasks_anon_id", "short_term_analysis_tasks", ["anon_id"])
    op.create_index("ix_short_term_analysis_tasks_code", "short_term_analysis_tasks", ["code"])
    op.create_table(
        "short_term_share_links",
        sa.Column("code", sa.String(length=16), nullable=False),
        sa.Column("task_id", uuid_type(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("visit_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["short_term_analysis_tasks.id"]),
        sa.PrimaryKeyConstraint("code"),
    )
    op.create_table(
        "users",
        sa.Column("id", uuid_type(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("accepted_disclaimer_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_users_email", "users", ["email"])
    op.create_table(
        "user_sessions",
        sa.Column("id", uuid_type(), nullable=False),
        sa.Column("user_id", uuid_type(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_user_sessions_user_id", "user_sessions", ["user_id"])
    op.create_index("ix_user_sessions_token_hash", "user_sessions", ["token_hash"])
    op.create_table(
        "credit_accounts",
        sa.Column("user_id", uuid_type(), nullable=False),
        sa.Column("plan", sa.String(length=32), server_default="free", nullable=False),
        sa.Column("trial_credits", sa.Integer(), server_default="0", nullable=False),
        sa.Column("paid_credits", sa.Integer(), server_default="0", nullable=False),
        sa.Column("daily_free_used", sa.Integer(), server_default="0", nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_table(
        "user_preferences",
        sa.Column("id", uuid_type(), nullable=False),
        sa.Column("anon_id", uuid_type(), nullable=False),
        sa.Column("scope", sa.String(length=64), nullable=False),
        sa.Column("instruction", sa.Text(), nullable=False),
        sa.Column("summary", sa.String(length=120), nullable=True),
        sa.Column("source", sa.String(length=32), server_default="conversation", nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("applied_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("origin_diagnosis_id", uuid_type(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["anon_id"], ["anonymous_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["origin_diagnosis_id"], ["diagnoses.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_preferences_anon_id", "user_preferences", ["anon_id"])
    op.create_index("ix_user_preferences_scope", "user_preferences", ["scope"])
    op.create_index("ix_user_preferences_active", "user_preferences", ["active"])
    op.create_index("ix_user_pref_anon_scope_active", "user_preferences", ["anon_id", "scope", "active"])
    op.create_table(
        "preference_changelog",
        sa.Column("id", uuid_type(), nullable=False),
        sa.Column("anon_id", uuid_type(), nullable=False),
        sa.Column("diagnosis_id", uuid_type(), nullable=True),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("preference_id", uuid_type(), nullable=True),
        sa.Column("before", jsonb_type(), nullable=True),
        sa.Column("after", jsonb_type(), nullable=True),
        sa.Column("user_utterance", sa.Text(), nullable=True),
        sa.Column("rerun_plan", jsonb_type(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["anon_id"], ["anonymous_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["diagnosis_id"], ["diagnoses.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_preference_changelog_anon_id", "preference_changelog", ["anon_id"])
    op.create_index("ix_preference_changelog_diagnosis_id", "preference_changelog", ["diagnosis_id"])
    op.create_table(
        "user_signals",
        sa.Column("id", uuid_type(), nullable=False),
        sa.Column("anon_id", uuid_type(), nullable=False),
        sa.Column("diagnosis_id", uuid_type(), nullable=True),
        sa.Column("signal_type", sa.String(length=48), nullable=False),
        sa.Column("payload", jsonb_type(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["anon_id"], ["anonymous_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["diagnosis_id"], ["diagnoses.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_signals_anon_id", "user_signals", ["anon_id"])
    op.create_index("ix_user_signals_diagnosis_id", "user_signals", ["diagnosis_id"])
    op.create_index("ix_user_signals_signal_type", "user_signals", ["signal_type"])
    op.create_index("ix_user_signals_created_at", "user_signals", ["created_at"])
    op.create_index("ix_signal_anon_type_time", "user_signals", ["anon_id", "signal_type", "created_at"])
    op.create_table(
        "diagnosis_cards",
        sa.Column("id", uuid_type(), nullable=False),
        sa.Column("anon_id", uuid_type(), nullable=False),
        sa.Column("diagnosis_id", uuid_type(), nullable=False),
        sa.Column("card", jsonb_type(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["anon_id"], ["anonymous_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["diagnosis_id"], ["diagnoses.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("diagnosis_id"),
    )
    op.create_index("ix_diagnosis_cards_anon_id", "diagnosis_cards", ["anon_id"])
    op.create_index("ix_diagnosis_cards_created_at", "diagnosis_cards", ["created_at"])
    op.create_table(
        "user_profile",
        sa.Column("anon_id", uuid_type(), nullable=False),
        sa.Column("narrative", sa.Text(), nullable=True),
        sa.Column("risk_appetite", sa.Float(), nullable=True),
        sa.Column("preferred_horizon", sa.String(length=16), nullable=True),
        sa.Column("decision_speed", sa.String(length=16), nullable=True),
        sa.Column("focus_themes", jsonb_type(), nullable=True),
        sa.Column("avoided_styles", jsonb_type(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("reflection_version", sa.Integer(), server_default="0", nullable=False),
        sa.Column("source_signal_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("source_card_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("contradictions", jsonb_type(), nullable=True),
        sa.Column("last_reflected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["anon_id"], ["anonymous_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("anon_id"),
    )


def downgrade() -> None:
    op.drop_table("user_profile")
    op.drop_index("ix_diagnosis_cards_created_at", table_name="diagnosis_cards")
    op.drop_index("ix_diagnosis_cards_anon_id", table_name="diagnosis_cards")
    op.drop_table("diagnosis_cards")
    op.drop_index("ix_signal_anon_type_time", table_name="user_signals")
    op.drop_index("ix_user_signals_created_at", table_name="user_signals")
    op.drop_index("ix_user_signals_signal_type", table_name="user_signals")
    op.drop_index("ix_user_signals_diagnosis_id", table_name="user_signals")
    op.drop_index("ix_user_signals_anon_id", table_name="user_signals")
    op.drop_table("user_signals")
    op.drop_index("ix_preference_changelog_diagnosis_id", table_name="preference_changelog")
    op.drop_index("ix_preference_changelog_anon_id", table_name="preference_changelog")
    op.drop_table("preference_changelog")
    op.drop_index("ix_user_pref_anon_scope_active", table_name="user_preferences")
    op.drop_index("ix_user_preferences_active", table_name="user_preferences")
    op.drop_index("ix_user_preferences_scope", table_name="user_preferences")
    op.drop_index("ix_user_preferences_anon_id", table_name="user_preferences")
    op.drop_table("user_preferences")
    op.drop_table("credit_accounts")
    op.drop_index("ix_user_sessions_token_hash", table_name="user_sessions")
    op.drop_index("ix_user_sessions_user_id", table_name="user_sessions")
    op.drop_table("user_sessions")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
    op.drop_table("short_term_share_links")
    op.drop_index("ix_short_term_analysis_tasks_code", table_name="short_term_analysis_tasks")
    op.drop_index("ix_short_term_analysis_tasks_anon_id", table_name="short_term_analysis_tasks")
    op.drop_table("short_term_analysis_tasks")
    op.drop_table("share_links")
    op.drop_index("ix_diagnoses_anon_id", table_name="diagnoses")
    op.drop_table("diagnoses")
    op.drop_index("ix_portfolios_anon_id", table_name="portfolios")
    op.drop_table("portfolios")
    op.drop_table("anonymous_sessions")
